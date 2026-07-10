/**
 * Blaze Hero Abilities Hook
 * 
 * Handles Blaze-specific abilities:
 * - Fireballs (primary fire)
 * - Meteor Strike or Phosphor Flare (selected secondary fire)
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
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_FLAMETHROWER_SOCKET,
  BLAZE_BOMB_SPLASH_RADIUS,
  BLAZE_PHOSPHOR_FLARE_COOLDOWN_MS,
  BLAZE_PHOSPHOR_FLARE_DURATION_MS,
  BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
  BLAZE_PHOSPHOR_FLARE_MIN_RANGE,
  BLAZE_PHOSPHOR_FLARE_RADIUS,
  BLAZE_AFTERBURNER_DASH_DURATION_MS,
  BLAZE_AFTERBURNER_TRAIL_DURATION_MS,
  BLAZE_PRIMARY_RELOAD_MS,
  BLAZE_ROCKET_STAFF_SOCKET,
  BLAZE_SCRAPSHOT_RANGE,
  getBlazePrimaryAbilityId,
  getBlazePrimaryMagazineSize,
  getBlazeScrapshotPelletDirections,
  getBlazePhosphorFlareFlightDurationMs,
  type BlazePrimarySkill,
  type BlazeSecondarySkill,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import {
  BLAZE_ROCKET_FIRE_INTERVAL,
  BLAZE_ROCKET_SPEED,
  BLAZE_BOMB_COOLDOWN,
  BLAZE_BOMB_FALL_DURATION,
  BLAZE_BOMB_WARNING_LEAD,
  EYE_HEIGHT,
  FUEL_UPDATE_THRESHOLD,
  calculatePlayerSocketPosition,
} from '../constants';
import { resolveAbilityAimDirection } from '../abilityAim';
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
import { isActionLockBlocking } from '../actionLock';
import { markPredictedLocalAbilitySound } from '../useLocalAbilityAudioPrediction';
import { markPredictedLocalAbilityVisual } from '../useLocalAbilityVisualPrediction';
import { playSharedSound } from '../../useAudio';
import {
  addScrapshotEffects,
  type ScrapshotEffectImpactInput,
} from '../../../components/game/Effects';
import { triggerAfterburnerTrail } from '../../../components/game/blaze';
import { startLocalBlazeAfterburnerDash } from '../../../movement/localPrediction';
import { applyTutorialOfflineTrainingScrapshot } from '../../../utils/tutorialOfflineCombatRuntime';
import {
  checkGroundWithNormal,
  createRaycastDirectionHitResult,
  isPhysicsReady,
  raycastDirectionInto,
} from '../../usePhysics';

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

function playPredictedBlazePrimaryReload(now: number): void {
  markPredictedLocalAbilitySound('blaze_reload', now, BLAZE_PRIMARY_RELOAD_MS + 250);
  const fadeOutMs = Math.min(180, BLAZE_PRIMARY_RELOAD_MS);
  void playSharedSound('blazeReload', {
    durationMs: BLAZE_PRIMARY_RELOAD_MS,
    fadeOutMs,
  });
}

function resolveBlazeStaffTipPose(
  ctx: AbilityContext,
  abilityId: string,
  nowMs: number,
  holdBlend: number
): ResolvedAbilitySocketOrigin | null {
  ctx.camera?.updateMatrixWorld();

  return resolveAbilitySocketOrigin({
    ownerScope: 'localViewmodel',
    abilityId,
    fallback: {
      position: ctx.position,
      yaw: ctx.yaw,
    },
    sampledContext: ctx.camera
      ? {
        camera: ctx.camera,
        elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
        holdBlend,
        timestampMs: ctx.viewmodelNowMs ?? nowMs,
      } satisfies BlazeRocketStaffPoseSampleContext
      : undefined,
    preferSampled: false,
    warnOnSampleDrift: true,
  });
}

function calculateBlazeFlamethrowerPose(
  ctx: AbilityContext,
  originOverride?: { x: number; y: number; z: number }
) {
  const origin = originOverride ?? calculatePlayerSocketPosition(ctx.position, ctx.yaw, BLAZE_FLAMETHROWER_SOCKET);
  return {
    origin,
    direction: resolveAbilityAimDirection(ctx, origin, BLAZE_FLAMETHROWER_RANGE),
  };
}

export interface UseBlazeAbilitiesReturn {
  // State refs
  lastBombTimeRef: React.MutableRefObject<number>;
  lastPrimaryTimeRef: React.MutableRefObject<number>;
  primaryShotIdRef: React.MutableRefObject<number>;
  blazePrimaryAmmoRef: React.MutableRefObject<number>;
  blazePrimaryReloadingRef: React.MutableRefObject<boolean>;
  blazePrimaryReloadStartRef: React.MutableRefObject<number>;
  bombTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  bombValidRef: React.MutableRefObject<boolean>;
  phoenixDiveTargetRef: React.MutableRefObject<THREE.Vector3 | null>;
  phoenixDiveValidRef: React.MutableRefObject<boolean>;
  flamethrowerFuelRef: React.MutableRefObject<number>;
  flamethrowerActiveRef: React.MutableRefObject<boolean>;
  secondaryFirePressedRef: React.MutableRefObject<boolean>;
  pendingRocketJumpRef: React.MutableRefObject<PendingRocketJump | null>;
  actionLockUntilRef: React.MutableRefObject<number>;

  // Methods
  lockActions: (durationMs: number, timestampMs?: number) => void;
  clearActionLock: () => void;
  isActionLocked: (timestampMs?: number, overlapGraceMs?: number) => boolean;
  updateBlazePrimaryReload: (now?: number) => void;
  reloadBlazePrimary: (now?: number) => boolean;
  resetBlazePrimaryMagazine: () => void;
  handleSecondaryFire: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  firePrimary: (ctx: AbilityContext) => void;
  executeBombDrop: (sounds: PlayerSounds) => void;
  handleFlamethrower: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    isTryingToFire: boolean,
    setFlamethrowerActive: (active: boolean) => void,
    setFlamethrowerFuel: (fuel: number) => void
  ) => void;
  executeRocketJump: (ctx: AbilityContext) => void;
  executeAfterburner: (ctx: AbilityContext) => void;
  updateRocketJump: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  resetRocketJump: () => void;
  handleBombTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
  handlePhoenixDiveTargetUpdate: (position: THREE.Vector3 | null, isValid: boolean) => void;
}

interface PendingRocketJump {
  ownerId: string;
  activateAtMs: number;
}

export function useBlazeAbilities(
  blazePrimarySkill: BlazePrimarySkill,
  blazeSecondarySkill: BlazeSecondarySkill
): UseBlazeAbilitiesReturn {
  const primaryMagazineSize = getBlazePrimaryMagazineSize(blazePrimarySkill);
  const lastPrimaryTimeRef = useRef(0);
  const primaryShotIdRef = useRef(0);
  const blazePrimaryAmmoRef = useRef(primaryMagazineSize);
  const blazePrimaryReloadingRef = useRef(false);
  const blazePrimaryReloadStartRef = useRef(0);
  const scrapshotTerrainHitRef = useRef(createRaycastDirectionHitResult());
  const phosphorTerrainHitRef = useRef(createRaycastDirectionHitResult());

  // Meteor Strike state
  const lastBombTimeRef = useRef(0);
  const bombTargetRef = useRef<THREE.Vector3 | null>(null);
  const bombValidRef = useRef(false);
  const phoenixDiveTargetRef = useRef<THREE.Vector3 | null>(null);
  const phoenixDiveValidRef = useRef(false);
  const secondaryFirePressedRef = useRef(false);

  // Flamethrower state
  const flamethrowerFuelRef = useRef(BLAZE_FLAMETHROWER_MAX_FUEL);
  const flamethrowerAuthorityOwnerRef = useRef<string | null>(null);
  const lastAuthoritativeFlamethrowerFuelRef = useRef(BLAZE_FLAMETHROWER_MAX_FUEL);
  const flamethrowerActiveRef = useRef(false);
  const pendingRocketJumpRef = useRef<PendingRocketJump | null>(null);

  const actionLockUntilRef = useRef(0);

  const getOwnerTeam = (team?: string | null): Team => team || 'red';

  const lockActions = useCallback((durationMs: number, timestampMs = Date.now()) => {
    actionLockUntilRef.current = Math.max(
      actionLockUntilRef.current,
      timestampMs + Math.max(0, durationMs)
    );
  }, []);

  const clearActionLock = useCallback(() => {
    actionLockUntilRef.current = 0;
  }, []);

  const isActionLocked = useCallback((timestampMs = Date.now(), overlapGraceMs = 0) => (
    isActionLockBlocking(actionLockUntilRef.current, timestampMs, overlapGraceMs)
  ), []);

  const completeBlazePrimaryReload = useCallback(() => {
    blazePrimaryAmmoRef.current = primaryMagazineSize;
    blazePrimaryReloadingRef.current = false;
    blazePrimaryReloadStartRef.current = 0;

    const store = useGameStore.getState();
    store.setBlazePrimaryAmmo(primaryMagazineSize);
    store.setBlazePrimaryReload(false, 0, 0);
  }, [primaryMagazineSize]);

  const beginBlazePrimaryReload = useCallback((now = Date.now()): boolean => {
    const store = useGameStore.getState();
    const currentAmmo = Math.min(store.blazePrimaryAmmo, blazePrimaryAmmoRef.current);

    if (store.blazePrimaryReloading || blazePrimaryReloadingRef.current) return false;
    if (currentAmmo >= primaryMagazineSize) return false;

    blazePrimaryAmmoRef.current = Math.max(0, currentAmmo);
    blazePrimaryReloadingRef.current = true;
    blazePrimaryReloadStartRef.current = now;

    store.setBlazePrimaryAmmo(blazePrimaryAmmoRef.current);
    store.setBlazePrimaryReload(true, now, now + BLAZE_PRIMARY_RELOAD_MS);
    playPredictedBlazePrimaryReload(now);
    return true;
  }, [primaryMagazineSize]);

  const updateBlazePrimaryReload = useCallback((now = Date.now()) => {
    const store = useGameStore.getState();
    blazePrimaryAmmoRef.current = store.blazePrimaryAmmo;
    blazePrimaryReloadingRef.current = store.blazePrimaryReloading;
    blazePrimaryReloadStartRef.current = store.blazePrimaryReloadStart;

    if (!blazePrimaryReloadingRef.current) {
      if (blazePrimaryAmmoRef.current <= 0) {
        beginBlazePrimaryReload(now);
      }
      return;
    }

    const reloadEnd = store.blazePrimaryReloadEnd;
    if (reloadEnd > 0 && now < reloadEnd) return;

    completeBlazePrimaryReload();
  }, [beginBlazePrimaryReload, completeBlazePrimaryReload]);

  const reloadBlazePrimary = useCallback((now = Date.now()): boolean => {
    updateBlazePrimaryReload(now);
    return beginBlazePrimaryReload(now);
  }, [beginBlazePrimaryReload, updateBlazePrimaryReload]);

  const resetBlazePrimaryMagazine = useCallback(() => {
    lastPrimaryTimeRef.current = 0;
    blazePrimaryAmmoRef.current = primaryMagazineSize;
    blazePrimaryReloadingRef.current = false;
    blazePrimaryReloadStartRef.current = 0;
    useGameStore.getState().resetBlazePrimaryMagazine(primaryMagazineSize);
  }, [primaryMagazineSize]);

  // Handle Blaze's selected secondary fire. Meteor Strike uses hold/release
  // targeting; Phosphor Flare lobs immediately on the initial press.
  const handleSecondaryFire = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const store = useGameStore.getState();
    const bombTargeting = store.bombTargeting;
    const now = Date.now();
    const timestampMs = ctx.viewmodelNowMs ?? now;
    const isHoldingSecondary = ctx.inputState.secondaryFire;
    const wasHoldingSecondary = secondaryFirePressedRef.current;

    if (blazeSecondarySkill === 'phosphor_flare') {
      if (bombTargeting) {
        store.setBombTargeting(false, false);
        bombTargetRef.current = null;
        bombValidRef.current = false;
        setBlazeBombTargetHeld(false, timestampMs);
      }
      if (isHoldingSecondary && !wasHoldingSecondary) {
        executePhosphorFlare(ctx, sounds);
      }
      secondaryFirePressedRef.current = isHoldingSecondary;
      return;
    }

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
  }, [blazeSecondarySkill]);

  const firePrimary = useCallback((ctx: AbilityContext) => {
    if (!ctx.inputState.primaryFire) return;
    const store = useGameStore.getState();
    if (store.bombTargeting) return;

    const now = Date.now();
    updateBlazePrimaryReload(now);
    if (blazePrimaryReloadingRef.current) return;
    if (blazePrimaryAmmoRef.current <= 0) {
      beginBlazePrimaryReload(now);
      return;
    }

    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastPrimaryTimeRef.current < BLAZE_ROCKET_FIRE_INTERVAL / tempoMultiplier) return;

    lastPrimaryTimeRef.current = now;
    primaryShotIdRef.current += 1;
    const abilityId = getBlazePrimaryAbilityId(blazePrimarySkill);
    const holdBlend = 1;
    const staffTipPose = resolveBlazeStaffTipPose(ctx, abilityId, now, holdBlend);
    const startPosition = staffTipPose
      ? vectorToPlainPosition(staffTipPose.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, BLAZE_ROCKET_STAFF_SOCKET);
    const direction = resolveAbilityAimDirection(
      ctx,
      startPosition,
      blazePrimarySkill === 'scrapshot' ? BLAZE_SCRAPSHOT_RANGE : undefined
    );
    const visualId = `predicted_${abilityId}_${ctx.localPlayer.id}_${primaryShotIdRef.current}`;

    blazePrimaryAmmoRef.current = Math.max(0, blazePrimaryAmmoRef.current - 1);
    store.setBlazePrimaryAmmo(blazePrimaryAmmoRef.current);
    if (blazePrimaryAmmoRef.current <= 0) {
      beginBlazePrimaryReload(now);
    }

    if (blazePrimarySkill === 'scrapshot') {
      const pelletDirections = getBlazeScrapshotPelletDirections(direction);
      const practiceResult = applyTutorialOfflineTrainingScrapshot({
        origin: startPosition,
        direction,
        sourceId: ctx.localPlayer.id,
        sourceTeam: getOwnerTeam(ctx.localPlayer.team),
      });
      const predictedImpacts: ScrapshotEffectImpactInput[] = pelletDirections.map((pelletDirection) => {
        const terrainHit = scrapshotTerrainHitRef.current;
        const didHitTerrain = isPhysicsReady() && raycastDirectionInto(
          terrainHit,
          ctx.position.x,
          ctx.position.y + EYE_HEIGHT,
          ctx.position.z,
          pelletDirection.x,
          pelletDirection.y,
          pelletDirection.z,
          BLAZE_SCRAPSHOT_RANGE,
          { priority: 'visual', feature: 'ability:blazeScrapshot' },
        );
        return {
          position: didHitTerrain
            ? { ...terrainHit.point }
            : {
              x: startPosition.x + pelletDirection.x * BLAZE_SCRAPSHOT_RANGE,
              y: startPosition.y + pelletDirection.y * BLAZE_SCRAPSHOT_RANGE,
              z: startPosition.z + pelletDirection.z * BLAZE_SCRAPSHOT_RANGE,
            },
          kind: didHitTerrain ? 'terrain' as const : 'miss' as const,
        };
      });
      practiceResult.playerImpacts.forEach((impact) => {
        predictedImpacts[impact.pelletIndex] = {
          position: impact.position,
          kind: 'player',
        };
      });
      addScrapshotEffects(startPosition, predictedImpacts, 'prediction');
    } else {
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
        ownerTeam: getOwnerTeam(ctx.localPlayer.team),
      });
    }
    if (store.isTutorialMode) {
      store.recordPrimaryFire(now);
    }
    markPredictedLocalAbilityVisual(abilityId, ctx.localPlayer.id, visualId, { now });
  }, [beginBlazePrimaryReload, blazePrimarySkill, updateBlazePrimaryReload]);

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
        ownerTeam: getOwnerTeam(store.localPlayer.team),
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

  const executePhosphorFlare = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const now = Date.now();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    const cooldownMs = BLAZE_PHOSPHOR_FLARE_COOLDOWN_MS / tempoMultiplier;
    if (now - lastBombTimeRef.current < cooldownMs) return;

    lastBombTimeRef.current = now;
    triggerBlazeStaffShockwave(now);
    lockActions(BLAZE_STAFF_SHOCKWAVE_DURATION_MS + BLAZE_STAFF_RETURN_TO_IDLE_MS, now);
    markPredictedLocalAbilitySound('blaze_phosphor_flare', now);
    sounds.playBlazeBombRelease();

    const store = useGameStore.getState();
    store.setClientCooldown('blaze_phosphor_flare', now + cooldownMs);
    if (!store.isPracticeMode || store.localPlayer?.heroId !== 'blaze') return;

    const staffTipPose = resolveBlazeStaffTipPose(ctx, 'blaze_phosphor_flare', now, 1);
    const startPosition = staffTipPose
      ? vectorToPlainPosition(staffTipPose.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, BLAZE_ROCKET_STAFF_SOCKET);
    const direction = resolveAbilityAimDirection(ctx, startPosition, BLAZE_PHOSPHOR_FLARE_MAX_RANGE);
    const terrainHit = phosphorTerrainHitRef.current;
    const didHitTerrain = isPhysicsReady() && raycastDirectionInto(
      terrainHit,
      ctx.position.x,
      ctx.position.y + EYE_HEIGHT,
      ctx.position.z,
      direction.x,
      direction.y,
      direction.z,
      BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
      { priority: 'visual', feature: 'ability:blazePhosphorFlare' }
    );
    const candidate = didHitTerrain
      ? terrainHit.point
      : {
        x: startPosition.x + direction.x * BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
        y: startPosition.y + direction.y * BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
        z: startPosition.z + direction.z * BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
      };
    const horizontalDistance = Math.hypot(
      candidate.x - ctx.position.x,
      candidate.z - ctx.position.z
    );
    const minRangeScale = horizontalDistance > 0.0001
      ? Math.max(1, BLAZE_PHOSPHOR_FLARE_MIN_RANGE / horizontalDistance)
      : 0;
    const targetX = minRangeScale > 0
      ? ctx.position.x + (candidate.x - ctx.position.x) * minRangeScale
      : ctx.position.x + Math.sin(ctx.yaw) * BLAZE_PHOSPHOR_FLARE_MIN_RANGE;
    const targetZ = minRangeScale > 0
      ? ctx.position.z + (candidate.z - ctx.position.z) * minRangeScale
      : ctx.position.z - Math.cos(ctx.yaw) * BLAZE_PHOSPHOR_FLARE_MIN_RANGE;
    const groundHit = checkGroundWithNormal(
      targetX,
      candidate.y + 24,
      targetZ,
      64,
      { priority: 'visual', feature: 'ability:blazePhosphorFlareGround' }
    );
    const targetPosition = {
      x: targetX,
      y: groundHit?.groundY ?? candidate.y,
      z: targetZ,
    };
    const flightDurationMs = getBlazePhosphorFlareFlightDurationMs(startPosition, targetPosition);
    const impactTime = now + flightDurationMs;
    store.addPhosphorFlare({
      id: `practice_blaze_phosphor_flare_${store.localPlayer.id}_${now}`,
      startPosition,
      targetPosition,
      impactPosition: targetPosition,
      interceptedByChronosAegis: false,
      impactProgress: 1,
      startTime: now,
      impactTime,
      poolEndsAt: impactTime + BLAZE_PHOSPHOR_FLARE_DURATION_MS,
      radius: BLAZE_PHOSPHOR_FLARE_RADIUS,
      ownerId: store.localPlayer.id,
      ownerTeam: getOwnerTeam(store.localPlayer.team),
    });
    window.setTimeout(() => sounds.playBlazeBombExplode(), flightDurationMs);
  }, [lockActions]);

  // Handle flamethrower (E ability - hold)
  const handleFlamethrower = useCallback((
    ctx: AbilityContext,
    sounds: PlayerSounds,
    isTryingToFire: boolean,
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

    const canFire = isTryingToFire && flamethrowerFuelRef.current > 0;

    if (canUsePracticeFuel) {
      const fuelDelta = (canFire ? -BLAZE_FLAMETHROWER_FUEL_DRAIN : BLAZE_FLAMETHROWER_FUEL_REGEN) *
        fuelStepSeconds *
        tempoMultiplier;
      fuel = clampFlamethrowerFuel(flamethrowerFuelRef.current + fuelDelta);
      lastAuthoritativeFlamethrowerFuelRef.current = fuel;
    } else if (authorityOwner) {
      const projectedFuel = projectBlazeFlamethrowerFuel({
        currentFuel: flamethrowerFuelRef.current,
        authoritativeFuel,
        lastAuthoritativeFuel: lastAuthoritativeFlamethrowerFuelRef.current,
        isTryingToFire: canFire,
        deltaSeconds: fuelStepSeconds,
        tempoMultiplier,
      });
      fuel = projectedFuel.fuel;
      lastAuthoritativeFlamethrowerFuelRef.current = projectedFuel.lastAuthoritativeFuel;
    }
    const isHoldingFlamethrower = canFire && fuel > 0;
    const serverActive = Boolean(
      localPlayer?.heroId === 'blaze' &&
      localPlayer.state === 'alive' &&
      (localPlayer.movement?.isJetpacking || (canUsePracticeFuel && isHoldingFlamethrower)) &&
      fuel > 0
    );
    const visualActive = isHoldingFlamethrower || serverActive;
    const shouldPlayLocalFlamethrowerSound = isHoldingFlamethrower;

    flamethrowerFuelRef.current = fuel;
    if (
      Math.abs(store.flamethrowerFuel - fuel) >= FUEL_UPDATE_THRESHOLD ||
      (fuel === 0 && store.flamethrowerFuel !== 0) ||
      (fuel === BLAZE_FLAMETHROWER_MAX_FUEL && store.flamethrowerFuel !== BLAZE_FLAMETHROWER_MAX_FUEL)
    ) {
      setFlamethrowerFuel(fuel);
    }
    setBlazeFlamethrowerHeld(visualActive, timestampMs);

    if (shouldPlayLocalFlamethrowerSound && !flamethrowerActiveRef.current) {
      flamethrowerActiveRef.current = true;
      store.recordSkillCast(timestampMs);
      sounds.startFlamethrowerSound();
    } else if (!shouldPlayLocalFlamethrowerSound && flamethrowerActiveRef.current) {
      flamethrowerActiveRef.current = false;
      sounds.stopFlamethrowerSound();
    }

    if (visualActive) {
      setFlamethrowerActive(true);

      const holdBlend = getBlazeFlamethrowerHeldBlend(timestampMs);
      const staffTipPose = resolveBlazeStaffTipPose(ctx, 'blaze_flamethrower', now, holdBlend);
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

  const executeAfterburner = useCallback((ctx: AbilityContext) => {
    const now = Date.now();
    const startPosition = vectorToPlainPosition(ctx.position);
    const visualId = `predicted_blaze_afterburner_${ctx.localPlayer.id}_${now}`;
    startLocalBlazeAfterburnerDash(ctx.localPlayer.id, ctx.yaw, now);
    triggerAfterburnerTrail({
      id: visualId,
      playerId: ctx.localPlayer.id,
      startPosition,
      dashDurationMs: BLAZE_AFTERBURNER_DASH_DURATION_MS,
      trailDurationMs: BLAZE_AFTERBURNER_TRAIL_DURATION_MS,
    });
    markPredictedLocalAbilityVisual('blaze_afterburner', ctx.localPlayer.id, visualId, { now });
    lockActions(BLAZE_STAFF_RETURN_TO_IDLE_MS, now);
  }, [lockActions]);

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

  // Handle bomb target updates
  const handleBombTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    bombTargetRef.current = position;
    bombValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.bombTargeting && store.bombTargetValid !== isValid) {
      store.setBombTargeting(true, isValid);
    }
  }, []);

  const handlePhoenixDiveTargetUpdate = useCallback((position: THREE.Vector3 | null, isValid: boolean) => {
    phoenixDiveTargetRef.current = position;
    phoenixDiveValidRef.current = isValid;

    const store = useGameStore.getState();
    if (store.phoenixDiveTargeting && store.phoenixDiveTargetValid !== isValid) {
      store.setPhoenixDiveTargeting(true, isValid);
    }
  }, []);

  return {
    lastPrimaryTimeRef,
    primaryShotIdRef,
    blazePrimaryAmmoRef,
    blazePrimaryReloadingRef,
    blazePrimaryReloadStartRef,
    lastBombTimeRef,
    bombTargetRef,
    bombValidRef,
    phoenixDiveTargetRef,
    phoenixDiveValidRef,
    flamethrowerFuelRef,
    flamethrowerActiveRef,
    secondaryFirePressedRef,
    pendingRocketJumpRef,
    actionLockUntilRef,
    lockActions,
    clearActionLock,
    isActionLocked,
    updateBlazePrimaryReload,
    reloadBlazePrimary,
    resetBlazePrimaryMagazine,
    handleSecondaryFire,
    firePrimary,
    executeBombDrop,
    handleFlamethrower,
    executeRocketJump,
    executeAfterburner,
    updateRocketJump,
    resetRocketJump,
    handleBombTargetUpdate,
    handlePhoenixDiveTargetUpdate,
  };
}
