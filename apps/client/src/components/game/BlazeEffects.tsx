import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { type Player } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { playSharedLoop, setSharedLoopPosition, stopSharedLoop } from '../../hooks/useAudio';
import { visualStore } from '../../store/visualStore';
import { resolveAbilitySocketOrigin } from '../../model-system/abilitySocketResolver';
import { BLAZE_COLORS, SHARED_GEOMETRIES } from './effectResources';
import { BudgetedPointLight } from './systems/DynamicLightBudget';
import { getFrameClock } from '../../utils/frameClock';
import { getPlayerFeetY, getVisiblePlayerHeight } from './playerWorldAnchors';
import {
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../movement/networkDiagnostics';
import {
  RocketsManager,
  RocketJumpExplosions,
  AirStrikeEffects,
  BombEffect,
  FlamethrowerEffect,
  type FlamethrowerPose,
} from './blaze';

// Re-export trigger functions and targeting indicators for external use
export { 
  triggerRocketJumpExplosion,
  triggerAirStrike,
  BombTargetingIndicator,
  AirStrikeTargetingIndicator,
} from './blaze';

// ============================================================================
// BLAZE EFFECTS MANAGER
// ============================================================================

const BLAZE_EFFECT_SCAN_INTERVAL_MS = 80;
const BURN_FADE_OUT_MS = 600;
const BURN_FLAME_RADIUS = 0.42;
const BURN_EMBER_RADIUS = 0.58;
const BURN_SMOKE_RADIUS = 0.34;

const BURN_FLAMES = Array.from({ length: 9 }, (_, index) => ({
  angle: index * Math.PI * 2 / 9,
  phase: index / 9,
  radiusScale: 0.62 + (index % 3) * 0.16,
  heightScale: 0.18 + (index % 4) * 0.18,
  size: 0.18 + (index % 3) * 0.045,
}));

const BURN_EMBERS = Array.from({ length: 14 }, (_, index) => ({
  angle: index * Math.PI * 2 / 14,
  phase: index / 14,
  speed: 0.85 + (index % 5) * 0.12,
  size: 0.035 + (index % 4) * 0.008,
}));

const BURN_SMOKE_PUFFS = Array.from({ length: 4 }, (_, index) => ({
  angle: index * Math.PI * 2 / 4 + 0.4,
  phase: index / 4,
  size: 0.18 + index * 0.035,
}));

type BlazeFrameUpdater = (state: RootState, delta: number) => void;
const blazeFrameUpdaters = new Map<string, BlazeFrameUpdater>();

function useBlazeFrameUpdater(effectId: string, updater: BlazeFrameUpdater): void {
  const updaterRef = useRef(updater);
  updaterRef.current = updater;

  useEffect(() => {
    const registeredUpdater: BlazeFrameUpdater = (state, delta) => updaterRef.current(state, delta);
    blazeFrameUpdaters.set(effectId, registeredUpdater);
    return () => {
      blazeFrameUpdaters.delete(effectId);
    };
  }, [effectId]);
}

function runBlazeFrameUpdaters(state: RootState, delta: number): void {
  for (const updater of blazeFrameUpdaters.values()) {
    updater(state, delta);
  }
}

function collectRemoteFlamethrowerPlayerIds(target: string[]): string[] {
  const players = useGameStore.getState().players;
  const activeIds = visualStore.getState().activeBlazeFlamethrowerPlayerIds;
  target.length = 0;

  for (let index = 0; index < activeIds.length; index++) {
    const playerId = activeIds[index];
    if (resolveRemoteFlamethrowerPose(players.get(playerId))) {
      target.push(playerId);
    }
  }

  return target;
}

function shouldShowBurningPlayer(player: Player | null | undefined, now: number): player is Player {
  return Boolean(
    player &&
    player.state === 'alive' &&
    (player.onFireUntil ?? 0) > now &&
    player.visibility !== 'hidden' &&
    player.visibility !== 'last_known' &&
    player.visibility !== 'audible'
  );
}

function collectBurningPlayerIds(target: string[]): string[] {
  const state = useGameStore.getState();
  const activeIds = visualStore.getState().activeBlazeBurningPlayerIds;
  const now = getFrameClock().epochNowMs || Date.now();
  target.length = 0;

  for (let index = 0; index < activeIds.length; index++) {
    const playerId = activeIds[index];
    const player = state.localPlayer?.id === playerId
      ? state.localPlayer
      : state.players.get(playerId);
    if (shouldShowBurningPlayer(player, now)) {
      target.push(playerId);
    }
  }

  return target;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function getBurningPlayer(playerId: string): Player | undefined {
  const state = useGameStore.getState();
  return state.localPlayer?.id === playerId
    ? state.localPlayer
    : state.players.get(playerId);
}

function applyMeshOpacity(mesh: THREE.Mesh | null | undefined, opacity: number): void {
  if (!mesh) return;
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.opacity = opacity;
}

function getBurnFlameColor(index: number): number {
  switch (index % 4) {
    case 0:
      return BLAZE_COLORS.fireYellow;
    case 1:
      return BLAZE_COLORS.fireOrange;
    case 2:
      return BLAZE_COLORS.fireRed;
    default:
      return BLAZE_COLORS.fireWhite;
  }
}

function resolveRemoteFlamethrowerPose(player: Player | undefined): FlamethrowerPose | null {
  if (!player || player.state !== 'alive' || player.heroId !== 'blaze' || !player.movement.isJetpacking) {
    return null;
  }

  const visualState = visualStore.getState();
  const visualPosition = visualState.playerPositions.get(player.id) ?? player.position;
  const yaw = visualState.playerRotations.get(player.id) ?? player.lookYaw;
  const pitch = player.lookPitch;
  const cosPitch = Math.cos(pitch);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const socketOrigin = resolveAbilitySocketOrigin({
    ownerScope: 'remoteBody',
    playerId: player.id,
    abilityId: 'blaze_flamethrower',
    fallback: {
      position: visualPosition,
      yaw,
    },
  });

  return {
    origin: socketOrigin
      ? {
        x: socketOrigin.position.x,
        y: socketOrigin.position.y,
        z: socketOrigin.position.z,
      }
      : visualPosition,
    direction: {
      x: forwardX * cosPitch,
      y: Math.sin(pitch),
      z: forwardZ * cosPitch,
    },
  };
}

function RemoteBlazeFlamethrower({ playerId }: { playerId: string }) {
  const loopId = useMemo(() => `remote-blaze-flamethrower:${playerId}`, [playerId]);
  const poseProvider = useCallback(() => (
    resolveRemoteFlamethrowerPose(useGameStore.getState().players.get(playerId))
  ), [playerId]);

  useEffect(() => {
    const pose = poseProvider();
    void playSharedLoop(loopId, 'blazeFlamethrower', {
      position: pose?.origin,
      fadeInMs: 100,
    });

    return () => {
      stopSharedLoop(loopId, 150);
    };
  }, [loopId, poseProvider]);

  useBlazeFrameUpdater(loopId, () => {
    const pose = poseProvider();
    if (pose) {
      setSharedLoopPosition(loopId, pose.origin);
    }
  });

  return <FlamethrowerEffect isActive poseProvider={poseProvider} />;
}

function BurningHeroFire({ playerId }: { playerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const flameRefs = useRef<(THREE.Mesh | null)[]>([]);
  const emberRefs = useRef<(THREE.Mesh | null)[]>([]);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);

  useBlazeFrameUpdater(`burning:${playerId}`, (state) => {
    measureFrameWork('frame.effects.blazeBurning', () => {
      const group = groupRef.current;
      if (!group) return;

      const now = getFrameClock().epochNowMs;
      const player = getBurningPlayer(playerId);
      if (!shouldShowBurningPlayer(player, now)) {
        group.visible = false;
        if (lightRef.current) lightRef.current.intensity = 0;
        return;
      }

      const remainingMs = Math.max(0, (player.onFireUntil ?? 0) - now);
      const fade = THREE.MathUtils.smoothstep(Math.min(remainingMs, BURN_FADE_OUT_MS), 0, BURN_FADE_OUT_MS);
      const time = state.clock.elapsedTime;
      const visualState = visualStore.getState();
      const visualPosition = visualState.playerPositions.get(playerId) ?? player.position;
      const visibleHeight = getVisiblePlayerHeight(player.heroId, player.movement);
      const flicker = 0.88 + Math.sin(time * 19.0 + playerId.length) * 0.08 + Math.sin(time * 43.0) * 0.04;

      group.visible = fade > 0.01;
      group.position.set(
        visualPosition.x,
        getPlayerFeetY(visualPosition.y),
        visualPosition.z
      );

      for (let index = 0; index < BURN_FLAMES.length; index++) {
        const flame = BURN_FLAMES[index];
        const mesh = flameRefs.current[index];
        if (!mesh) continue;

        const sway = Math.sin(time * 7.4 + flame.phase * Math.PI * 2);
        const angle = flame.angle + sway * 0.18;
        const radius = BURN_FLAME_RADIUS * flame.radiusScale * (0.92 + Math.sin(time * 5.2 + flame.phase * 9.1) * 0.08);
        const height = Math.max(0.22, flame.heightScale * visibleHeight);
        const flameScale = flame.size * fade * flicker;

        mesh.position.set(
          Math.cos(angle) * radius,
          height + Math.max(0, sway) * 0.08,
          Math.sin(angle) * radius
        );
        mesh.rotation.set(sway * 0.24, -angle, Math.cos(time * 6.1 + flame.phase) * 0.18);
        mesh.scale.set(
          flameScale * (0.75 + Math.abs(sway) * 0.2),
          flameScale * (1.75 + Math.max(0, sway) * 0.45),
          flameScale * (0.75 + Math.abs(sway) * 0.2)
        );
        applyMeshOpacity(mesh, fade * (0.34 + Math.max(0, sway) * 0.14));
      }

      for (let index = 0; index < BURN_EMBERS.length; index++) {
        const ember = BURN_EMBERS[index];
        const mesh = emberRefs.current[index];
        if (!mesh) continue;

        const cycle = (time * ember.speed + ember.phase) % 1;
        const angle = ember.angle + time * (0.9 + ember.phase);
        const radius = BURN_EMBER_RADIUS * (0.42 + cycle * 0.55);
        const emberScale = ember.size * fade * (1 - cycle * 0.35);

        mesh.position.set(
          Math.cos(angle) * radius,
          0.18 + cycle * visibleHeight * 0.92,
          Math.sin(angle) * radius
        );
        mesh.scale.setScalar(emberScale);
        applyMeshOpacity(mesh, fade * (1 - cycle) * 0.74);
      }

      for (let index = 0; index < BURN_SMOKE_PUFFS.length; index++) {
        const puff = BURN_SMOKE_PUFFS[index];
        const mesh = smokeRefs.current[index];
        if (!mesh) continue;

        const cycle = (time * 0.34 + puff.phase) % 1;
        const angle = puff.angle + Math.sin(time * 0.8 + puff.phase * 4) * 0.3;
        const radius = BURN_SMOKE_RADIUS * (0.5 + cycle * 0.9);
        const puffScale = puff.size * (0.72 + cycle * 0.9) * fade;

        mesh.position.set(
          Math.cos(angle) * radius,
          visibleHeight * (0.54 + cycle * 0.34),
          Math.sin(angle) * radius
        );
        mesh.scale.setScalar(puffScale);
        applyMeshOpacity(mesh, fade * (1 - cycle) * 0.12);
      }

      if (lightRef.current) {
        lightRef.current.position.set(0, visibleHeight * 0.48, 0);
        lightRef.current.intensity = fade * (0.95 + Math.sin(time * 22.0) * 0.16);
        lightRef.current.distance = 4.2;
      }
    });
  });

  return (
    <group ref={groupRef} visible={false}>
      {BURN_FLAMES.map((_flame, index) => (
        <mesh
          key={`burn-flame-${index}`}
          ref={(mesh) => { flameRefs.current[index] = mesh; }}
          geometry={SHARED_GEOMETRIES.cone8}
        >
          <meshBasicMaterial
            color={getBurnFlameColor(index)}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      ))}

      {BURN_EMBERS.map((_ember, index) => (
        <mesh
          key={`burn-ember-${index}`}
          ref={(mesh) => { emberRefs.current[index] = mesh; }}
          geometry={SHARED_GEOMETRIES.sphere6}
        >
          <meshBasicMaterial
            color={index % 3 === 0 ? BLAZE_COLORS.fireWhite : BLAZE_COLORS.fireOrange}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      {BURN_SMOKE_PUFFS.map((_puff, index) => (
        <mesh
          key={`burn-smoke-${index}`}
          ref={(mesh) => { smokeRefs.current[index] = mesh; }}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial
            color={BLAZE_COLORS.smokeDark}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}

      <BudgetedPointLight
        ref={lightRef}
        color={0xff6a00}
        intensity={0}
        distance={4.2}
        decay={2}
        budgetPriority={1.25}
        budgetRadius={4.2}
      />
    </group>
  );
}

export function BlazeEffectsManager() {
  const bombs = useGameStore(state => state.bombs);
  const flamethrowerActive = useGameStore(state => state.flamethrowerActive);
  const [remoteFlamethrowerPlayerIds, setRemoteFlamethrowerPlayerIds] = useState<string[]>([]);
  const [burningPlayerIds, setBurningPlayerIds] = useState<string[]>([]);
  const activeRemoteIdsRef = useRef<string[]>([]);
  const activeBurningIdsRef = useRef<string[]>([]);
  const scratchRemoteIdsRef = useRef<string[]>([]);
  const scratchBurningIdsRef = useRef<string[]>([]);
  const scanAccumulatorRef = useRef(BLAZE_EFFECT_SCAN_INTERVAL_MS);

  useFrame((state, delta) => {
    measureFrameWork('frame.effects.blaze', () => {
      runBlazeFrameUpdaters(state, delta);
      scanAccumulatorRef.current += delta * 1000;
      if (scanAccumulatorRef.current < BLAZE_EFFECT_SCAN_INTERVAL_MS) {
        recordEffectSlotDiagnostics('blazeFlamethrower', {
          active: activeRemoteIdsRef.current.length + (flamethrowerActive ? 1 : 0),
          capacity: activeRemoteIdsRef.current.length + (flamethrowerActive ? 1 : 0),
          hiddenMounted: 0,
        });
        recordEffectSlotDiagnostics('blazeBurning', {
          active: activeBurningIdsRef.current.length,
          capacity: activeBurningIdsRef.current.length,
          hiddenMounted: 0,
        });
        return;
      }
      scanAccumulatorRef.current = 0;

      const nextIds = collectRemoteFlamethrowerPlayerIds(scratchRemoteIdsRef.current);
      if (!sameIds(nextIds, activeRemoteIdsRef.current)) {
        const committedIds = nextIds.slice();
        activeRemoteIdsRef.current = committedIds;
        setRemoteFlamethrowerPlayerIds(committedIds);
      }

      const nextBurningIds = collectBurningPlayerIds(scratchBurningIdsRef.current);
      if (!sameIds(nextBurningIds, activeBurningIdsRef.current)) {
        const committedBurningIds = nextBurningIds.slice();
        activeBurningIdsRef.current = committedBurningIds;
        setBurningPlayerIds(committedBurningIds);
      }
      recordEffectSlotDiagnostics('blazeFlamethrower', {
        active: activeRemoteIdsRef.current.length + (flamethrowerActive ? 1 : 0),
        capacity: activeRemoteIdsRef.current.length + (flamethrowerActive ? 1 : 0),
        hiddenMounted: 0,
      });
      recordEffectSlotDiagnostics('blazeBurning', {
        active: activeBurningIdsRef.current.length,
        capacity: activeBurningIdsRef.current.length,
        hiddenMounted: 0,
      });
    });
  });
  
  return (
    <group>
      {/* Fireballs with shared light */}
      <RocketsManager />
      
      {bombs.map(bomb => (
        <BombEffect key={bomb.id} bomb={bomb} />
      ))}
      
      {/* Rocket jump explosions */}
      <RocketJumpExplosions />
      
      {/* Infernal Gearstorm ultimate */}
      <AirStrikeEffects />
      
      <FlamethrowerEffect isActive={flamethrowerActive} />
      {remoteFlamethrowerPlayerIds.map(playerId => (
        <RemoteBlazeFlamethrower key={playerId} playerId={playerId} />
      ))}
      {burningPlayerIds.map(playerId => (
        <BurningHeroFire key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
