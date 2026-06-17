/**
 * Blaze Hero Abilities Hook
 * 
 * Handles Blaze-specific abilities:
 * - Fireballs (primary fire)
 * - Meteor Strike (secondary fire - targeting)
 * - Flamethrower (E ability - hold)
 * - Rocket Jump (Q ability)
 * - Infernal Gearstorm (Ultimate - hero-centered AOE)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_SOCKET,
  BLAZE_BOMB_SPLASH_RADIUS,
  BLAZE_ROCKET_STAFF_SOCKET,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import {
  BLAZE_ROCKET_FIRE_INTERVAL,
  BLAZE_ROCKET_SPEED,
  BLAZE_BOMB_COOLDOWN,
  BLAZE_BOMB_FALL_DURATION,
  BLAZE_BOMB_WARNING_LEAD,
  FUEL_UPDATE_THRESHOLD,
  calculatePlayerSocketPosition,
  calculateLookDirection,
} from '../constants';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import { setFlamethrowerVisualPose } from '../../../store/visualStore';
import {
  BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS,
  BLAZE_STAFF_RETURN_TO_IDLE_MS,
  BLAZE_STAFF_SHOCKWAVE_DURATION_MS,
  clearBlazeRocketJumpStaffSlam,
  getBlazeFlamethrowerHeldBlend,
  setBlazeFlamethrowerHeld,
  setBlazeBombTargetHeld,
  triggerBlazeStaffShockwave,
  triggerBlazeRocketJumpStaffSlam,
  type BlazeRocketStaffPoseSampleContext,
} from '../../../viewmodel/blazePose';
import {
  resolveAbilitySocketOrigin,
  type ResolvedAbilitySocketOrigin,
} from '../../../model-system/abilitySocketResolver';
import type { AbilityContext, PlayerSounds } from '../types';
import { markPredictedLocalAbilitySound } from '../useLocalAbilityAudioPrediction';
import { markPredictedLocalAbilityVisual } from '../useLocalAbilityVisualPrediction';

const FUEL_AUTHORITY_EPSILON = 0.05;

function clampFlamethrowerFuel(fuel: number): number {
  return Math.max(0, Math.min(BLAZE_FLAMETHROWER_MAX_FUEL, fuel));
}

export function projectBlazeFlamethrowerFuel({
  currentFuel,
  authoritativeFuel,
  lastAuthoritativeFuel,
  isTryingToFire,
  deltaSeconds,
  tempoMultiplier,
}: {
  currentFuel: number;
  authoritativeFuel: number;
  lastAuthoritativeFuel: number;
  isTryingToFire: boolean;
  deltaSeconds: number;
  tempoMultiplier: number;
}): { fuel: number; lastAuthoritativeFuel: number } {
  const nextAuthoritativeFuel = clampFlamethrowerFuel(authoritativeFuel);
  if (Math.abs(nextAuthoritativeFuel - lastAuthoritativeFuel) > FUEL_AUTHORITY_EPSILON) {
    return {
      fuel: nextAuthoritativeFuel,
      lastAuthoritativeFuel: nextAuthoritativeFuel,
    };
  }

  const fuelRate = isTryingToFire && currentFuel > 0
    ? -BLAZE_FLAMETHROWER_FUEL_DRAIN
    : BLAZE_FLAMETHROWER_FUEL_REGEN;

  return {
    fuel: clampFlamethrowerFuel(
      currentFuel + fuelRate * Math.max(0, deltaSeconds) * Math.max(0, tempoMultiplier)
    ),
    lastAuthoritativeFuel,
  };
}

function vectorToPlainPosition(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function sampleBlazeStaffTipPose(
  ctx: AbilityContext,
  abilityId: string,
  nowMs: number,
  holdBlend: number
): ResolvedAbilitySocketOrigin | null {
  if (!ctx.camera) return null;

  ctx.camera.updateMatrixWorld();

  return resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId,
    sampledContext: {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      holdBlend,
      timestampMs: ctx.viewmodelNowMs ?? nowMs,
    } satisfies BlazeRocketStaffPoseSampleContext,
    preferSampled: true,
    warnOnSampleDrift: true,
  });
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
  lastBombTimeRef: React.MutableRefObject<number>;
  lastRocketTimeRef: React.MutableRefObject<number>;
  rocketIdRef: React.MutableRefObject<number>;
  bombTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  bombValidRef: React.MutableRefObject<boolean>;
  flamethrowerFuelRef: React.MutableRefObject<number>;
  flamethrowerActiveRef: React.MutableRefObject<boolean>;
  secondaryFirePressedRef: React.MutableRefObject<boolean>;
  pendingRocketJumpRef: React.MutableRefObject<PendingRocketJump | null>;
  actionLockUntilRef: React.MutableRefObject<number>;

  // Methods
  lockActions: (durationMs: number, timestampMs?: number) => void;
  clearActionLock: () => void;
  isActionLocked: (timestampMs?: number) => boolean;
  handleBombTargeting: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  fireRocket: (ctx: AbilityContext) => void;
  executeBombDrop: (sounds: PlayerSounds) => void;
  handleFlamethrower: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setFlamethrowerActive: (active: boolean) => void,
    setFlamethrowerFuel: (fuel: number) => void
  ) => void;
  executeRocketJump: (ctx: AbilityContext) => void;
  updateRocketJump: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  resetRocketJump: () => void;
  executeAirStrike: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void
  ) => void;
  handleBombTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

interface PendingRocketJump {
  ownerId: string;
  activateAtMs: number;
}

export function useBlazeAbilities(): UseBlazeAbilitiesReturn {
  const lastRocketTimeRef = useRef(0);
  const rocketIdRef = useRef(0);

  // Meteor Strike state
  const lastBombTimeRef = useRef(0);
  const bombTargetRef = useRef<THREE.Vector3 | null>(null);
  const bombValidRef = useRef(false);
  const secondaryFirePressedRef = useRef(false);

  // Flamethrower state
  const flamethrowerFuelRef = useRef(BLAZE_FLAMETHROWER_MAX_FUEL);
  const flamethrowerAuthorityOwnerRef = useRef<string | null>(null);
  const lastAuthoritativeFlamethrowerFuelRef = useRef(BLAZE_FLAMETHROWER_MAX_FUEL);
  const flamethrowerActiveRef = useRef(false);
  const pendingRocketJumpRef = useRef<PendingRocketJump | null>(null);

  const actionLockUntilRef = useRef(0);

  const lockActions = useCallback((durationMs: number, timestampMs = Date.now()) => {
    actionLockUntilRef.current = Math.max(
      actionLockUntilRef.current,
      timestampMs + Math.max(0, durationMs)
    );
  }, []);

  const clearActionLock = useCallback(() => {
    actionLockUntilRef.current = 0;
  }, []);

  const isActionLocked = useCallback((timestampMs = Date.now()) => (
    actionLockUntilRef.current > timestampMs
  ), []);

  // Handle Meteor Strike targeting mode
  const handleBombTargeting = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const store = useGameStore.getState();
    const bombTargeting = store.bombTargeting;
    const now = Date.now();
    const timestampMs = ctx.viewmodelNowMs ?? now;
    const isHoldingSecondary = ctx.inputState.secondaryFire;
    const wasHoldingSecondary = secondaryFirePressedRef.current;

    if (isHoldingSecondary) {
      if (!bombTargeting) {
        const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
        if (now - lastBombTimeRef.current >= BLAZE_BOMB_COOLDOWN / tempoMultiplier) {
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
          lockActions(BLAZE_STAFF_RETURN_TO_IDLE_MS, timestampMs);
        }
      } else {
        setBlazeBombTargetHeld(false, timestampMs);
      }
    } else if (!bombTargeting) {
      setBlazeBombTargetHeld(false, timestampMs);
    }

    secondaryFirePressedRef.current = isHoldingSecondary;
  }, []);

  const fireRocket = useCallback((ctx: AbilityContext) => {
    if (!ctx.inputState.primaryFire) return;
    const store = useGameStore.getState();
    if (store.bombTargeting) return;

    const now = Date.now();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastRocketTimeRef.current < BLAZE_ROCKET_FIRE_INTERVAL / tempoMultiplier) return;

    lastRocketTimeRef.current = now;
    rocketIdRef.current += 1;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const holdBlend = 1;
    const staffTipPose = sampleBlazeStaffTipPose(ctx, 'blaze_rocket', now, holdBlend);
    const startPosition = staffTipPose
      ? vectorToPlainPosition(staffTipPose.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, BLAZE_ROCKET_STAFF_SOCKET);
    const visualId = `predicted_blaze_rocket_${ctx.localPlayer.id}_${rocketIdRef.current}`;

    store.addRocket({
      id: visualId,
      position: startPosition,
      velocity: {
        x: direction.x * BLAZE_ROCKET_SPEED,
        y: direction.y * BLAZE_ROCKET_SPEED,
        z: direction.z * BLAZE_ROCKET_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
    });
    if (store.isTutorialMode) {
      store.recordPrimaryFire(now);
    }
    markPredictedLocalAbilityVisual('blaze_rocket', ctx.localPlayer.id, visualId, { now });
  }, []);

  // Execute Meteor Strike
  const executeBombDrop = useCallback((sounds: PlayerSounds) => {
    if (!bombTargetRef.current || !bombValidRef.current) return;

    const now = Date.now();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastBombTimeRef.current < BLAZE_BOMB_COOLDOWN / tempoMultiplier) return;

    triggerBlazeStaffShockwave(now);
    lockActions(BLAZE_STAFF_SHOCKWAVE_DURATION_MS + BLAZE_STAFF_RETURN_TO_IDLE_MS, now);
    markPredictedLocalAbilitySound('blaze_bomb', now);
    sounds.playBlazeBombRelease();

    lastBombTimeRef.current = now;
    const store = useGameStore.getState();
    store.setClientCooldown('blaze_bomb', now + BLAZE_BOMB_COOLDOWN / tempoMultiplier);

    if (store.isPracticeMode && store.localPlayer?.heroId === 'blaze') {
      const targetPosition = vectorToPlainPosition(bombTargetRef.current);
      const startPosition = {
        x: store.localPlayer.position.x,
        y: store.localPlayer.position.y + 1.35,
        z: store.localPlayer.position.z,
      };
      const meteorStartTime = now + BLAZE_BOMB_WARNING_LEAD;
      store.addBomb({
        id: `practice_blaze_bomb_${store.localPlayer.id}_${now}`,
        targetPosition,
        startPosition,
        warningStartTime: now,
        startTime: meteorStartTime,
        impactTime: meteorStartTime + BLAZE_BOMB_FALL_DURATION,
        radius: BLAZE_BOMB_SPLASH_RADIUS,
        ownerId: store.localPlayer.id,
        ownerTeam: (store.localPlayer.team || 'red') as 'red' | 'blue',
        hasExploded: false,
      });
      window.setTimeout(() => {
        sounds.playBlazeBombFall();
      }, BLAZE_BOMB_WARNING_LEAD);
      window.setTimeout(() => {
        sounds.playBlazeBombExplode();
      }, BLAZE_BOMB_WARNING_LEAD + BLAZE_BOMB_FALL_DURATION);
    }

    // Exit targeting mode
    store.setBombTargeting(false, false);
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
    const store = useGameStore.getState();
    const localPlayer = store.localPlayer;
    const canUsePracticeFuel = store.isPracticeMode && localPlayer?.heroId === 'blaze' && localPlayer.state === 'alive';
    const authorityOwner = localPlayer?.heroId === 'blaze' ? localPlayer.id : null;
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    const fuelStepSeconds = Math.min(Math.max(ctx.dt, 0), 0.1);
    const authoritativeFuel = localPlayer?.heroId === 'blaze'
      ? clampFlamethrowerFuel(localPlayer.movement?.jetpackFuel ?? BLAZE_FLAMETHROWER_MAX_FUEL)
      : BLAZE_FLAMETHROWER_MAX_FUEL;
    let fuel = authoritativeFuel;

    if (flamethrowerAuthorityOwnerRef.current !== authorityOwner) {
      flamethrowerAuthorityOwnerRef.current = authorityOwner;
      flamethrowerFuelRef.current = authoritativeFuel;
      lastAuthoritativeFlamethrowerFuelRef.current = authoritativeFuel;
    }

    const isTryingToFire = ctx.inputState.ability1 && flamethrowerFuelRef.current > 0;

    if (canUsePracticeFuel) {
      const fuelDelta = (isTryingToFire ? -BLAZE_FLAMETHROWER_FUEL_DRAIN : BLAZE_FLAMETHROWER_FUEL_REGEN) *
        fuelStepSeconds *
        tempoMultiplier;
      fuel = clampFlamethrowerFuel(flamethrowerFuelRef.current + fuelDelta);
      lastAuthoritativeFlamethrowerFuelRef.current = fuel;
    } else if (authorityOwner) {
      const projectedFuel = projectBlazeFlamethrowerFuel({
        currentFuel: flamethrowerFuelRef.current,
        authoritativeFuel,
        lastAuthoritativeFuel: lastAuthoritativeFlamethrowerFuelRef.current,
        isTryingToFire,
        deltaSeconds: fuelStepSeconds,
        tempoMultiplier,
      });
      fuel = projectedFuel.fuel;
      lastAuthoritativeFlamethrowerFuelRef.current = projectedFuel.lastAuthoritativeFuel;
    }
    const isHoldingFlamethrower = ctx.inputState.ability1 && fuel > 0;
    const serverActive = Boolean(
      localPlayer?.heroId === 'blaze' &&
      localPlayer.state === 'alive' &&
      (localPlayer.movement?.isJetpacking || (canUsePracticeFuel && isHoldingFlamethrower)) &&
      fuel > 0
    );
    const shouldPlayLocalFlamethrowerSound = isHoldingFlamethrower;

    flamethrowerFuelRef.current = fuel;
    if (
      Math.abs(store.flamethrowerFuel - fuel) >= FUEL_UPDATE_THRESHOLD ||
      (fuel === 0 && store.flamethrowerFuel !== 0) ||
      (fuel === BLAZE_FLAMETHROWER_MAX_FUEL && store.flamethrowerFuel !== BLAZE_FLAMETHROWER_MAX_FUEL)
    ) {
      setFlamethrowerFuel(fuel);
    }
    setBlazeFlamethrowerHeld(isHoldingFlamethrower || serverActive, timestampMs);

    if (shouldPlayLocalFlamethrowerSound && !flamethrowerActiveRef.current) {
      flamethrowerActiveRef.current = true;
      store.recordSkillCast(timestampMs);
      sounds.startFlamethrowerSound();
    } else if (!shouldPlayLocalFlamethrowerSound && flamethrowerActiveRef.current) {
      flamethrowerActiveRef.current = false;
      sounds.stopFlamethrowerSound();
    }

    if (serverActive) {
      setFlamethrowerActive(true);

      const holdBlend = getBlazeFlamethrowerHeldBlend(timestampMs);
      const staffTipPose = sampleBlazeStaffTipPose(ctx, 'blaze_flamethrower', now, holdBlend);
      const staffTipOrigin = staffTipPose ? vectorToPlainPosition(staffTipPose.position) : undefined;
      const { origin, direction } = calculateBlazeFlamethrowerPose(ctx, staffTipOrigin);
      setFlamethrowerVisualPose(origin, direction);
    } else {
      setFlamethrowerActive(false);
      setFlamethrowerVisualPose(null, { x: 0, y: 0, z: -1 });
    }
  }, []);

  const applyRocketJump = useCallback((_ctx: AbilityContext, _sounds: PlayerSounds) => {
    // Server-confirmed blaze_rocketjump events own movement, explosion, and sound.
  }, []);

  // Execute Rocket Jump (Q ability)
  const executeRocketJump = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    triggerBlazeRocketJumpStaffSlam(now);
    lockActions(BLAZE_ROCKET_JUMP_ANIMATION_DURATION_MS + BLAZE_STAFF_RETURN_TO_IDLE_MS, now);
    markPredictedLocalAbilityVisual('blaze_rocketjump', ctx.localPlayer.id, `predicted_blaze_rocketjump_${ctx.localPlayer.id}_${now}`, {
      now,
    });
    pendingRocketJumpRef.current = null;
  }, []);

  const updateRocketJump = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const pendingRocketJump = pendingRocketJumpRef.current;
    if (!pendingRocketJump) return;

    if (ctx.heroId !== 'blaze' || ctx.localPlayer.id !== pendingRocketJump.ownerId) {
      pendingRocketJumpRef.current = null;
      clearBlazeRocketJumpStaffSlam();
      return;
    }

    if (Date.now() < pendingRocketJump.activateAtMs) return;

    pendingRocketJumpRef.current = null;
    applyRocketJump(ctx, sounds);
  }, [applyRocketJump]);

  const resetRocketJump = useCallback(() => {
    pendingRocketJumpRef.current = null;
    clearBlazeRocketJumpStaffSlam();
  }, []);

  // Execute Infernal Gearstorm (Ultimate)
  const executeAirStrike = useCallback((
    ctx: AbilityContext,
    _sounds: PlayerSounds,
    _updateLocalPlayer: (data: any) => void
  ) => {
    const localPlayer = useGameStore.getState().localPlayer;
    if (!localPlayer || (localPlayer.ultimateCharge ?? 0) < 100) return;

    lockActions(BLAZE_STAFF_RETURN_TO_IDLE_MS, ctx.viewmodelNowMs ?? Date.now());
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

  return {
    lastRocketTimeRef,
    rocketIdRef,
    lastBombTimeRef,
    bombTargetRef,
    bombValidRef,
    flamethrowerFuelRef,
    flamethrowerActiveRef,
    secondaryFirePressedRef,
    pendingRocketJumpRef,
    actionLockUntilRef,
    lockActions,
    clearActionLock,
    isActionLocked,
    handleBombTargeting,
    fireRocket,
    executeBombDrop,
    handleFlamethrower,
    executeRocketJump,
    updateRocketJump,
    resetRocketJump,
    executeAirStrike,
    handleBombTargetUpdate,
  };
}
