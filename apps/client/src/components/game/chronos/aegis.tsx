import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import {
  getChronosAegisCenter,
  getChronosAegisForward,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import {
  CHRONOS_AEGIS_PANEL_HEIGHT,
  CHRONOS_AEGIS_PANEL_WIDTH,
  createChronosAegisPanelGeometry,
} from './aegisGeometry';
import { getFrameClock } from '../../../utils/frameClock';
import {
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../../movement/networkDiagnostics';

const CHRONOS_AEGIS_COLOR = 0x22c55e;
const CHRONOS_AEGIS_EDGE_COLOR = 0x86efac;
const CHRONOS_AEGIS_STALE_MS = 320;
const CHRONOS_AEGIS_WORLD_WIDTH = CHRONOS_AEGIS_PANEL_WIDTH * 1.05;
const CHRONOS_AEGIS_WORLD_HEIGHT = CHRONOS_AEGIS_PANEL_HEIGHT * 1.05;
const CHRONOS_AEGIS_EDGE_THICKNESS = 0.09;
const CHRONOS_AEGIS_FADE_IN_SECONDS = 0.18;
const CHRONOS_AEGIS_FILL_OPACITY = 0.2;
const CHRONOS_AEGIS_EDGE_OPACITY = 0.72;
const CHRONOS_AEGIS_WIRE_OPACITY = 0.28;
const CHRONOS_AEGIS_DAMAGED_FILL_COLOR = 0xfacc15;
const CHRONOS_AEGIS_DAMAGED_EDGE_COLOR = 0xfde68a;
const CHRONOS_AEGIS_CRACK_COLOR = 0xfff7c2;
const ACTIVE_ID_SCAN_INTERVAL_MS = 80;

type ChronosAegisFrameUpdater = (state: RootState, delta: number) => void;
const chronosAegisFrameUpdaters = new Map<string, ChronosAegisFrameUpdater>();

function useChronosAegisFrameUpdater(effectId: string, updater: ChronosAegisFrameUpdater): void {
  const updaterRef = useRef(updater);
  updaterRef.current = updater;

  useEffect(() => {
    const registeredUpdater: ChronosAegisFrameUpdater = (state, delta) => updaterRef.current(state, delta);
    chronosAegisFrameUpdaters.set(effectId, registeredUpdater);
    return () => {
      chronosAegisFrameUpdaters.delete(effectId);
    };
  }, [effectId]);
}

function runChronosAegisFrameUpdaters(state: RootState, delta: number): void {
  for (const updater of chronosAegisFrameUpdaters.values()) {
    updater(state, delta);
  }
}

function createAegisFillMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createAegisRingMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_EDGE_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function createAegisWireMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_EDGE_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    wireframe: true,
    toneMapped: false,
  });
}

function createAegisCrackMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_CRACK_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function collectActiveChronosAegisIds(target: string[], now: number): string[] {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id;
  const visual = visualStore.getState();
  const activeIds = visual.activeChronosAegisPlayerIds;
  target.length = 0;

  for (let index = 0; index < activeIds.length; index++) {
    const playerId = activeIds[index];
    if (playerId === localPlayerId) continue;
    const player = store.players.get(playerId);
    if (!player) continue;
    if (player.heroId !== 'chronos' || player.state !== 'alive') continue;

    const aegis = visual.chronosAegisStates.get(player.id);
    if (!aegis?.active || now - aegis.updatedAtMs > CHRONOS_AEGIS_STALE_MS) continue;

    target.push(player.id);
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

function ChronosAegisShield({ playerId }: { playerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const braceRef = useRef<THREE.Group>(null);
  const crackRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const fillGeometry = useMemo(
    () => createChronosAegisPanelGeometry(
      CHRONOS_AEGIS_WORLD_WIDTH,
      CHRONOS_AEGIS_WORLD_HEIGHT,
      0.24,
      1
    ),
    []
  );
  const wireGeometry = useMemo(
    () => createChronosAegisPanelGeometry(
      CHRONOS_AEGIS_WORLD_WIDTH * 0.96,
      CHRONOS_AEGIS_WORLD_HEIGHT * 0.94,
      0.2,
      1,
      6,
      5
    ),
    []
  );
  const fillMaterialRef = useRef(createAegisFillMaterial());
  const ringMaterialRef = useRef(createAegisRingMaterial());
  const wireMaterialRef = useRef(createAegisWireMaterial());
  const crackMaterialRef = useRef(createAegisCrackMaterial());
  const fillFreshColor = useMemo(() => new THREE.Color(CHRONOS_AEGIS_COLOR), []);
  const fillDamagedColor = useMemo(() => new THREE.Color(CHRONOS_AEGIS_DAMAGED_FILL_COLOR), []);
  const edgeFreshColor = useMemo(() => new THREE.Color(CHRONOS_AEGIS_EDGE_COLOR), []);
  const edgeDamagedColor = useMemo(() => new THREE.Color(CHRONOS_AEGIS_DAMAGED_EDGE_COLOR), []);
  const localNormal = useMemo(() => new THREE.Vector3(0, 0, 1), []);
  const forwardVector = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => () => {
    fillGeometry.dispose();
    wireGeometry.dispose();
    fillMaterialRef.current.dispose();
    ringMaterialRef.current.dispose();
    wireMaterialRef.current.dispose();
    crackMaterialRef.current.dispose();
  }, [fillGeometry, wireGeometry]);

  useChronosAegisFrameUpdater(`chronos-aegis:${playerId}`, () => {
    measureFrameWork('frame.effects.chronosAegisShield', () => {
      const group = groupRef.current;
      const player = useGameStore.getState().players.get(playerId);
      const aegis = visualStore.getState().chronosAegisStates.get(playerId);
      if (!group || !player || !aegis?.active) {
        if (group) group.visible = false;
        return;
      }

      const now = getFrameClock().epochNowMs;
      if (now - aegis.updatedAtMs > CHRONOS_AEGIS_STALE_MS) {
        group.visible = false;
        return;
      }

      const visualPosition = visualStore.getState().playerPositions.get(playerId) ?? player.position;
      const visualYaw = visualStore.getState().playerRotations.get(playerId) ?? player.lookYaw;
      const visualPitch = player.lookPitch ?? 0;
      const center = getChronosAegisCenter({
        playerId,
        position: visualPosition,
        lookYaw: visualYaw,
        lookPitch: visualPitch,
      });
      const forward = getChronosAegisForward(visualYaw, visualPitch);
      const elapsed = Math.max(0, (now - aegis.activatedAtMs) / 1000);
      const fade = THREE.MathUtils.smoothstep(elapsed, 0, CHRONOS_AEGIS_FADE_IN_SECONDS);
      const durability = THREE.MathUtils.clamp(aegis.durabilityRatio, 0, 1);
      const damage = 1 - durability;
      const pulse = 1 + Math.sin(elapsed * 5.4) * 0.018;
      const shieldScale = THREE.MathUtils.lerp(0.74, 1.05, fade) * pulse;

      group.visible = fade > 0.01;
      group.position.set(center.x, center.y, center.z);
      forwardVector.set(forward.x, forward.y, forward.z).normalize();
      group.quaternion.setFromUnitVectors(localNormal, forwardVector);
      group.scale.set(shieldScale, shieldScale, 1);

      fillMaterialRef.current.color.copy(fillFreshColor).lerp(fillDamagedColor, damage * 0.74);
      ringMaterialRef.current.color.copy(edgeFreshColor).lerp(edgeDamagedColor, damage * 0.86);
      wireMaterialRef.current.color.copy(edgeFreshColor).lerp(edgeDamagedColor, damage * 0.68);

      fillMaterialRef.current.opacity = CHRONOS_AEGIS_FILL_OPACITY * fade * (0.42 + durability * 0.58);
      ringMaterialRef.current.opacity = CHRONOS_AEGIS_EDGE_OPACITY * fade * (0.42 + durability * 0.58);
      wireMaterialRef.current.opacity = CHRONOS_AEGIS_WIRE_OPACITY * fade * (0.32 + durability * 0.68);

      if (fillRef.current) {
        fillRef.current.scale.set(1, 1 + Math.sin(elapsed * 4.2) * 0.006, 1);
      }
      if (wireRef.current) {
        wireRef.current.scale.setScalar(0.97 + Math.sin(elapsed * 6.1) * (0.01 + damage * 0.018));
      }
      if (braceRef.current) {
        braceRef.current.position.z = 0.02 + Math.sin(elapsed * 4.8) * (0.008 + damage * 0.02);
      }
      if (crackRef.current) {
        const crackPulse = 0.72 + Math.sin(elapsed * 13.4) * 0.16;
        crackMaterialRef.current.opacity = fade * THREE.MathUtils.smoothstep(damage, 0.08, 0.74) * crackPulse;
        crackRef.current.position.x = Math.sin(elapsed * 18.7) * damage * 0.04;
        crackRef.current.position.y = Math.cos(elapsed * 16.2) * damage * 0.025;
      }
      if (lightRef.current) {
        lightRef.current.intensity = 1.35 * fade * (0.45 + durability * 0.55);
        lightRef.current.distance = 4.4;
      }
    });
  });

  const halfWidth = CHRONOS_AEGIS_WORLD_WIDTH * 0.5;
  const halfHeight = CHRONOS_AEGIS_WORLD_HEIGHT * 0.5;
  const edgeThickness = CHRONOS_AEGIS_EDGE_THICKNESS;

  return (
    <group ref={groupRef} visible={false} frustumCulled={false}>
      <mesh ref={fillRef} geometry={fillGeometry} material={fillMaterialRef.current} frustumCulled={false} />
      <mesh ref={wireRef} geometry={wireGeometry} material={wireMaterialRef.current} frustumCulled={false} />
      <group ref={braceRef}>
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[0, halfHeight, 0.018]} scale={[CHRONOS_AEGIS_WORLD_WIDTH + edgeThickness * 1.8, edgeThickness, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[0, -halfHeight, 0.018]} scale={[CHRONOS_AEGIS_WORLD_WIDTH + edgeThickness * 1.8, edgeThickness, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[-halfWidth, 0, 0.018]} scale={[edgeThickness, CHRONOS_AEGIS_WORLD_HEIGHT + edgeThickness * 1.8, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[halfWidth, 0, 0.018]} scale={[edgeThickness, CHRONOS_AEGIS_WORLD_HEIGHT + edgeThickness * 1.8, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[-halfWidth, halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[halfWidth, halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[-halfWidth, -halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={ringMaterialRef.current} position={[halfWidth, -halfHeight, 0.026]} scale={[edgeThickness * 2.1, edgeThickness * 2.1, 0.036]} frustumCulled={false} />
      </group>
      <group ref={crackRef} position={[0, 0, 0.032]}>
        <mesh geometry={SHARED_GEOMETRIES.box} material={crackMaterialRef.current} position={[-1.35, 0.48, 0]} rotation={[0, 0, -0.56]} scale={[0.032, 1.26, 0.018]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={crackMaterialRef.current} position={[0.76, -0.18, 0]} rotation={[0, 0, 0.7]} scale={[0.026, 0.98, 0.018]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={crackMaterialRef.current} position={[1.62, 0.52, 0]} rotation={[0, 0, -0.34]} scale={[0.024, 0.76, 0.018]} frustumCulled={false} />
      </group>
      <BudgetedPointLight ref={lightRef} budgetPriority={0.2} position={[0, 0, 0.08]} color={CHRONOS_AEGIS_COLOR} intensity={0} distance={4.4} decay={2} />
    </group>
  );
}

export function ChronosAegisManager() {
  const [activeIds, setActiveIds] = useState<string[]>([]);
  const activeIdsRef = useRef<string[]>([]);
  const scratchIdsRef = useRef<string[]>([]);
  const scanAccumulatorRef = useRef(ACTIVE_ID_SCAN_INTERVAL_MS);

  useFrame((state, delta) => {
    measureFrameWork('frame.effects.chronos', () => {
      runChronosAegisFrameUpdaters(state, delta);
      scanAccumulatorRef.current += delta * 1000;
      if (scanAccumulatorRef.current < ACTIVE_ID_SCAN_INTERVAL_MS) {
        recordEffectSlotDiagnostics('chronosAegis', {
          active: activeIdsRef.current.length,
          capacity: activeIdsRef.current.length,
          hiddenMounted: 0,
        });
        return;
      }
      scanAccumulatorRef.current = 0;

      const nextIds = collectActiveChronosAegisIds(scratchIdsRef.current, getFrameClock().epochNowMs);
      if (sameIds(nextIds, activeIdsRef.current)) {
        recordEffectSlotDiagnostics('chronosAegis', {
          active: activeIdsRef.current.length,
          capacity: activeIdsRef.current.length,
          hiddenMounted: 0,
        });
        return;
      }

      const committedIds = nextIds.slice();
      activeIdsRef.current = committedIds;
      setActiveIds(committedIds);
      recordEffectSlotDiagnostics('chronosAegis', {
        active: committedIds.length,
        capacity: committedIds.length,
        hiddenMounted: 0,
      });
    });
  });

  return (
    <group>
      {activeIds.map((playerId) => (
        <ChronosAegisShield key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
