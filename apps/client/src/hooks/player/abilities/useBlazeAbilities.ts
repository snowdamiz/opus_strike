/**
 * Blaze Hero Abilities Hook
 * 
 * Handles Blaze-specific abilities:
 * - Rockets (primary fire)
 * - Bomb (secondary fire - targeting)
 * - Flamethrower (E ability - hold)
 * - Rocket Jump (Q ability)
 * - Air Strike (Ultimate - targeting)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { triggerRocketJumpExplosion, triggerAirStrike } from '../../../components/game/BlazeEffects';
import { isPhysicsReady, raycastDirection } from '../../usePhysics';
import {
  BLAZE_ROCKET_FIRE_INTERVAL,
  BLAZE_ROCKET_SPEED,
  BLAZE_BOMB_COOLDOWN,
  BLAZE_BOMB_FALL_DURATION,
  EYE_HEIGHT,
  calculatePlayerSocketPosition,
  calculateLookDirection,
} from '../constants';
import { setFlamethrowerVisualPose } from '../../../store/visualStore';
import {
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  getBlazeFlamethrowerHeldBlend,
  getBlazeRocketHeldBlend,
  setBlazeFlamethrowerHeld,
  setBlazeBombTargetHeld,
  triggerBlazeStaffShockwave,
  type BlazeRocketStaffPoseSampleContext,
} from '../../../viewmodel/blazePose';
import {
  assertViewmodelLaunchMatchesPose,
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../../../viewmodel/viewmodelSocketRegistry';
import type { AbilityContext, PlayerSounds } from '../types';

const BLAZE_FLAMETHROWER_SOCKET = {
  handHeight: BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  forwardOffset: BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  sideOffset: BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
};
const BLAZE_ROCKET_AIM_DISTANCE = 120;
const BLAZE_ROCKET_STAFF_FALLBACK_SOCKET = {
  handHeight: 0.24,
  forwardOffset: 0.64,
  sideOffset: 0.22,
};
const BLAZE_ROCKET_FIRE_READY_BLEND = 0.86;

function vectorToPlainPosition(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function sampleBlazeStaffTipPose(
  ctx: AbilityContext,
  nowMs: number,
  holdBlend: number
): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  ctx.camera.updateMatrixWorld();

  return sampleViewmodelPose<BlazeRocketStaffPoseSampleContext>(
    BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      holdBlend,
      timestampMs: ctx.viewmodelNowMs ?? nowMs,
    }
  );
}

function calculateBlazeRocketLaunch(
  ctx: AbilityContext,
  spawnOverride?: { x: number; y: number; z: number }
) {
  const lookDirection = calculateLookDirection(ctx.yaw, ctx.pitch);
  const fallbackSpawnPos = calculatePlayerSocketPosition(
    ctx.position,
    ctx.yaw,
    BLAZE_ROCKET_STAFF_FALLBACK_SOCKET
  );
  const spawnPos = spawnOverride ?? fallbackSpawnPos;
  const aimOrigin = {
    x: ctx.position.x,
    y: ctx.position.y + EYE_HEIGHT,
    z: ctx.position.z,
  };
  const aimPoint = {
    x: aimOrigin.x + lookDirection.x * BLAZE_ROCKET_AIM_DISTANCE,
    y: aimOrigin.y + lookDirection.y * BLAZE_ROCKET_AIM_DISTANCE,
    z: aimOrigin.z + lookDirection.z * BLAZE_ROCKET_AIM_DISTANCE,
  };

  if (isPhysicsReady()) {
    const hit = raycastDirection(
      aimOrigin.x,
      aimOrigin.y,
      aimOrigin.z,
      lookDirection.x,
      lookDirection.y,
      lookDirection.z,
      BLAZE_ROCKET_AIM_DISTANCE
    );

    if (hit?.hit) {
      aimPoint.x = hit.point.x;
      aimPoint.y = hit.point.y;
      aimPoint.z = hit.point.z;
    }
  }

  const aimDelta = {
    x: aimPoint.x - spawnPos.x,
    y: aimPoint.y - spawnPos.y,
    z: aimPoint.z - spawnPos.z,
  };
  const aimLength = Math.sqrt(aimDelta.x ** 2 + aimDelta.y ** 2 + aimDelta.z ** 2) || 1;

  return {
    spawnPos,
    direction: {
      x: aimDelta.x / aimLength,
      y: aimDelta.y / aimLength,
      z: aimDelta.z / aimLength,
    },
  };
}

function calculateBlazeFlamethrowerPose(
  ctx: AbilityContext,
  originOverride?: { x: number; y: number; z: number }
) {
  return {
    origin: originOverride ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, BLAZE_FLAMETHROWER_SOCKET),
    direction: calculateLookDirection(ctx.yaw, ctx.pitch),
  };
}

export interface UseBlazeAbilitiesReturn {
  // State refs
  lastRocketTimeRef: React.MutableRefObject<number>;
  rocketIdRef: React.MutableRefObject<number>;
  lastBombTimeRef: React.MutableRefObject<number>;
  bombIdRef: React.MutableRefObject<number>;
  bombTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  bombValidRef: React.MutableRefObject<boolean>;
  flamethrowerFuelRef: React.MutableRefObject<number>;
  flamethrowerActiveRef: React.MutableRefObject<boolean>;
  airStrikeTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  airStrikeValidRef: React.MutableRefObject<boolean>;
  secondaryFirePressedRef: React.MutableRefObject<boolean>;

  // Methods
  fireRocket: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  handleBombTargeting: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  executeBombDrop: (sounds: PlayerSounds) => void;
  handleFlamethrower: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setFlamethrowerActive: (active: boolean) => void,
    setFlamethrowerFuel: (fuel: number) => void
  ) => void;
  executeRocketJump: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  executeAirStrike: (
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void
  ) => void;
  handleBombTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
  handleAirStrikeTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

export function useBlazeAbilities(): UseBlazeAbilitiesReturn {
  // Rocket state
  const lastRocketTimeRef = useRef(0);
  const rocketIdRef = useRef(0);

  // Bomb state
  const lastBombTimeRef = useRef(0);
  const bombIdRef = useRef(0);
  const bombTargetRef = useRef<THREE.Vector3 | null>(null);
  const bombValidRef = useRef(false);
  const secondaryFirePressedRef = useRef(false);

  // Flamethrower state
  const flamethrowerFuelRef = useRef(BLAZE_FLAMETHROWER_MAX_FUEL);
  const flamethrowerActiveRef = useRef(false);

  // Air Strike state
  const airStrikeTargetRef = useRef<THREE.Vector3 | null>(null);
  const airStrikeValidRef = useRef(false);

  // Fire Rocket (primary fire)
  const fireRocket = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const now = Date.now();
    const holdBlend = getBlazeRocketHeldBlend(ctx.viewmodelNowMs ?? now);
    if (holdBlend < BLAZE_ROCKET_FIRE_READY_BLEND) return;
    if (now - lastRocketTimeRef.current < BLAZE_ROCKET_FIRE_INTERVAL) return;

    lastRocketTimeRef.current = now;
    rocketIdRef.current++;
    const rocketId = `rocket_${ctx.localPlayer.id}_${rocketIdRef.current}`;
    const launchPose = sampleBlazeStaffTipPose(ctx, now, holdBlend);
    const spawnOverride = launchPose ? vectorToPlainPosition(launchPose.position) : undefined;
    const { spawnPos, direction } = calculateBlazeRocketLaunch(ctx, spawnOverride);
    assertViewmodelLaunchMatchesPose({
      eventId: rocketId,
      launchPosition: spawnPos,
      pose: launchPose,
    });

    useGameStore.getState().addRocket({
      id: rocketId,
      position: spawnPos,
      velocity: {
        x: direction.x * BLAZE_ROCKET_SPEED,
        y: direction.y * BLAZE_ROCKET_SPEED,
        z: direction.z * BLAZE_ROCKET_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
    });

    sounds.playBlazeRocket();
  }, []);

  // Handle bomb targeting mode
  const handleBombTargeting = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const store = useGameStore.getState();
    const bombTargeting = store.bombTargeting;
    const now = Date.now();
    const timestampMs = ctx.viewmodelNowMs ?? now;
    const isHoldingSecondary = ctx.inputState.secondaryFire;
    const wasHoldingSecondary = secondaryFirePressedRef.current;

    if (isHoldingSecondary) {
      if (!bombTargeting) {
        if (now - lastBombTimeRef.current >= BLAZE_BOMB_COOLDOWN) {
          store.setBombTargeting(true);
          setBlazeBombTargetHeld(true, timestampMs);
          sounds.playBlazeBombTarget();
        } else {
          setBlazeBombTargetHeld(false, timestampMs);
        }
      } else {
        setBlazeBombTargetHeld(true, timestampMs);
      }
    } else if (wasHoldingSecondary) {
      if (bombTargeting) {
        if (bombValidRef.current && bombTargetRef.current) {
          executeBombDrop(sounds);
        } else {
          store.setBombTargeting(false, false);
          bombTargetRef.current = null;
          bombValidRef.current = false;
          setBlazeBombTargetHeld(false, timestampMs);
        }
      } else {
        setBlazeBombTargetHeld(false, timestampMs);
      }
    } else if (!bombTargeting) {
      setBlazeBombTargetHeld(false, timestampMs);
    }

    secondaryFirePressedRef.current = isHoldingSecondary;
  }, []);

  // Execute bomb drop
  const executeBombDrop = useCallback((sounds: PlayerSounds) => {
    if (!bombTargetRef.current || !bombValidRef.current) return;

    const now = Date.now();
    if (now - lastBombTimeRef.current < BLAZE_BOMB_COOLDOWN) return;

    const target = bombTargetRef.current.clone();
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer) return;

    const groundY = target.y < 1 ? (localPlayer.position.y - 1) : target.y;

    bombIdRef.current++;
    const bombId = `bomb_${localPlayer.id}_${bombIdRef.current}`;

    useGameStore.getState().addBomb({
      id: bombId,
      targetPosition: { x: target.x, y: groundY, z: target.z },
      startPosition: {
        x: localPlayer.position.x,
        y: localPlayer.position.y,
        z: localPlayer.position.z,
      },
      startTime: now,
      impactTime: now + BLAZE_BOMB_FALL_DURATION,
      ownerId: localPlayer.id,
      ownerTeam: (localPlayer.team || 'red') as 'red' | 'blue',
      hasExploded: false,
    });

    sounds.playBlazeBombTarget();
    triggerBlazeStaffShockwave(now);

    setTimeout(() => {
      sounds.playBlazeBombExplode();
    }, BLAZE_BOMB_FALL_DURATION);

    lastBombTimeRef.current = now;

    // Exit targeting mode
    useGameStore.getState().setBombTargeting(false, false);
    bombTargetRef.current = null;
    bombValidRef.current = false;
    setBlazeBombTargetHeld(false, now);
  }, []);

  // Handle flamethrower (E ability - hold)
  const handleFlamethrower = useCallback((
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setFlamethrowerActive: (active: boolean) => void,
    setFlamethrowerFuel: (fuel: number) => void
  ) => {
    const now = Date.now();
    const timestampMs = ctx.viewmodelNowMs ?? now;
    const isHoldingFlamethrower = ctx.inputState.ability1 && flamethrowerFuelRef.current > 0;
    setBlazeFlamethrowerHeld(isHoldingFlamethrower, timestampMs);

    if (isHoldingFlamethrower) {
      if (!flamethrowerActiveRef.current) {
        flamethrowerActiveRef.current = true;
        setFlamethrowerActive(true);
        sounds.startFlamethrowerSound();
      }

      const holdBlend = getBlazeFlamethrowerHeldBlend(timestampMs);
      const staffTipPose = sampleBlazeStaffTipPose(ctx, now, holdBlend);
      const staffTipOrigin = staffTipPose ? vectorToPlainPosition(staffTipPose.position) : undefined;
      const { origin, direction } = calculateBlazeFlamethrowerPose(ctx, staffTipOrigin);
      setFlamethrowerVisualPose(origin, direction);

      // Consume fuel
      flamethrowerFuelRef.current -= BLAZE_FLAMETHROWER_FUEL_DRAIN * ctx.dt;
      if (flamethrowerFuelRef.current <= 0) {
        flamethrowerFuelRef.current = 0;
        flamethrowerActiveRef.current = false;
        setFlamethrowerActive(false);
        setBlazeFlamethrowerHeld(false, timestampMs);
        setFlamethrowerVisualPose(null, { x: 0, y: 0, z: -1 });
        sounds.stopFlamethrowerSound();
      }
      setFlamethrowerFuel(flamethrowerFuelRef.current);
    } else {
      if (flamethrowerActiveRef.current) {
        flamethrowerActiveRef.current = false;
        setFlamethrowerActive(false);
        setFlamethrowerVisualPose(null, { x: 0, y: 0, z: -1 });
        sounds.stopFlamethrowerSound();
      }

      // Regenerate fuel when grounded
      if (ctx.isGrounded && flamethrowerFuelRef.current < BLAZE_FLAMETHROWER_MAX_FUEL) {
        flamethrowerFuelRef.current = Math.min(
          BLAZE_FLAMETHROWER_MAX_FUEL,
          flamethrowerFuelRef.current + BLAZE_FLAMETHROWER_FUEL_REGEN * ctx.dt
        );
        setFlamethrowerFuel(flamethrowerFuelRef.current);
      }
    }
  }, []);

  // Execute Rocket Jump (Q ability)
  const executeRocketJump = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    ctx.velocity.y = BLAZE_ROCKET_JUMP_VERTICAL_FORCE;
    ctx.position.y += 0.5;

    // Small horizontal push
    const rjYaw = ctx.yaw;
    ctx.velocity.x += -Math.sin(rjYaw) * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE;
    ctx.velocity.z += -Math.cos(rjYaw) * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE;

    // Visual explosion
    triggerRocketJumpExplosion({ x: ctx.position.x, y: ctx.position.y, z: ctx.position.z });

    sounds.playBlazeRocketJump();
  }, []);

  // Execute Air Strike (Ultimate)
  const executeAirStrike = useCallback((
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void
  ) => {
    if (!airStrikeTargetRef.current || !airStrikeValidRef.current) return;

    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer || (localPlayer.ultimateCharge ?? 0) < 100) return;

    const target = airStrikeTargetRef.current.clone();
    triggerAirStrike({ x: target.x, y: target.y, z: target.z });

    updateLocalPlayer({ ultimateCharge: 0 });
    sounds.playBlazeAirstrike();

    // Exit targeting mode
    useGameStore.getState().setAirStrikeTargeting(false, false);
    airStrikeTargetRef.current = null;
    airStrikeValidRef.current = false;
  }, []);

  // Handle bomb target updates
  const handleBombTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    bombTargetRef.current = position;
    bombValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.bombTargeting && store.bombTargetValid !== isValid) {
      store.setBombTargeting(true, isValid);
    }
  }, []);

  // Handle air strike target updates
  const handleAirStrikeTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    airStrikeTargetRef.current = position;
    airStrikeValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.airStrikeTargeting && store.airStrikeTargetValid !== isValid) {
      store.setAirStrikeTargeting(true, isValid);
    }
  }, []);

  return {
    lastRocketTimeRef,
    rocketIdRef,
    lastBombTimeRef,
    bombIdRef,
    bombTargetRef,
    bombValidRef,
    flamethrowerFuelRef,
    flamethrowerActiveRef,
    airStrikeTargetRef,
    airStrikeValidRef,
    secondaryFirePressedRef,
    fireRocket,
    handleBombTargeting,
    executeBombDrop,
    handleFlamethrower,
    executeRocketJump,
    executeAirStrike,
    handleBombTargetUpdate,
    handleAirStrikeTargetUpdate,
  };
}
