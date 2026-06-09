/**
 * Phantom Hero Abilities Hook
 * 
 * Handles Phantom-specific abilities:
 * - Dire Ball (primary fire)
 * - Void Ray (secondary fire - charged)
 * - Blink (E ability)
 * - Shadow Bubble (Q ability - personal shield)
 * - Phantom Veil (Ultimate)
 */

import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
  VOID_RAY_CHARGE_TIME,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import {
  checkWallCollision,
  isPhysicsReady,
  raycastDirection,
  validateTeleportDestination,
} from '../../usePhysics';
import { triggerTeleportEffect } from '../../../components/ui/TeleportEffects';
import { triggerBlinkEffect } from '../../../components/game/PhantomEffects';
import { recordSpawnMarker } from '../../../utils/perfMarks';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  getPhantomPrimaryHeldBlend,
  type PhantomPrimaryPoseSampleContext,
  type PhantomVoidRayOrbPoseSampleContext,
} from '../../../viewmodel/phantomPrimaryPose';
import {
  assertViewmodelLaunchMatchesPose,
  sampleViewmodelPose,
  type ViewmodelSocketPose,
} from '../../../viewmodel/viewmodelSocketRegistry';
import {
  EYE_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  PHANTOM_FIRE_INTERVAL,
  PHANTOM_PROJECTILE_SPEED,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_VOID_RAY_SOCKET,
  calculatePlayerSocketPosition,
  calculateLookDirection,
} from '../constants';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import type { AbilityContext, PlayerSounds } from '../types';

export interface UsePhantomAbilitiesReturn {
  // State refs
  lastFireTimeRef: React.MutableRefObject<number>;
  direBallIdRef: React.MutableRefObject<number>;
  phantomPrimaryAmmoRef: React.MutableRefObject<number>;
  phantomPrimaryReloadingRef: React.MutableRefObject<boolean>;
  phantomPrimaryReloadStartRef: React.MutableRefObject<number>;
  voidRayChargingRef: React.MutableRefObject<boolean>;
  voidRayChargeStartRef: React.MutableRefObject<number>;
  voidRayIdRef: React.MutableRefObject<number>;

  // Methods
  updatePhantomPrimaryReload: (now?: number) => void;
  reloadPhantomPrimary: (now?: number) => boolean;
  resetPhantomPrimaryMagazine: () => void;
  fireDireBall: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  handleVoidRay: (ctx: AbilityContext, sounds: PlayerSounds) => void;
  executeBlink: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    useAbilityCharge: (id: string) => boolean
  ) => boolean;
  executePersonalShield: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setAbilityActive: (id: string, active: boolean) => void,
    startClientCooldown: (id: string) => void,
    updateLocalPlayer: (data: any) => void
  ) => boolean;
  executePhantomVeil: (
    ctx: AbilityContext,
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void,
    setAbilityActive: (id: string, active: boolean) => void
  ) => void;
}

const PHANTOM_DIRE_BALL_AIM_DISTANCE = 120;
const PHANTOM_VOID_RAY_AIM_DISTANCE = 100;
const PHANTOM_PRIMARY_FIRE_READY_BLEND = 0.86;
const PHANTOM_PERSONAL_SHIELD_ABILITY_ID = 'phantom_personal_shield';

function calculatePhantomLaunch(
  ctx: AbilityContext,
  launchSide: -1 | 1,
  maxDistance: number,
  socket = PHANTOM_DIRE_BALL_SOCKET,
  spawnOverride?: { x: number; y: number; z: number }
) {
  const lookDirection = calculateLookDirection(ctx.yaw, ctx.pitch);
  const fallbackSpawnPos = calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
    ...socket,
    sideOffset: socket.sideOffset * launchSide,
  });
  const spawnPos = spawnOverride ?? fallbackSpawnPos;
  const aimOrigin = {
    x: ctx.position.x,
    y: ctx.position.y + EYE_HEIGHT,
    z: ctx.position.z,
  };
  const aimPoint = {
    x: aimOrigin.x + lookDirection.x * maxDistance,
    y: aimOrigin.y + lookDirection.y * maxDistance,
    z: aimOrigin.z + lookDirection.z * maxDistance,
  };

  if (isPhysicsReady()) {
    const hit = raycastDirection(
      aimOrigin.x, aimOrigin.y, aimOrigin.z,
      lookDirection.x, lookDirection.y, lookDirection.z,
      maxDistance
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

function vectorToPlainPosition(vector: THREE.Vector3): { x: number; y: number; z: number } {
  return {
    x: vector.x,
    y: vector.y,
    z: vector.z,
  };
}

function samplePhantomPrimaryPalmPose(
  ctx: AbilityContext,
  launchSide: -1 | 1,
  nowMs: number,
  holdBlend: number
): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  ctx.camera.updateMatrixWorld();

  return sampleViewmodelPose<PhantomPrimaryPoseSampleContext>(
    PHANTOM_PRIMARY_PALM_SOCKET_NAMES[launchSide],
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      side: launchSide,
      actionTimeSeconds: PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
      holdBlend,
      shotPulse: 1,
      timestampMs: ctx.viewmodelNowMs ?? nowMs,
    }
  );
}

function samplePhantomVoidRayOrbPose(
  ctx: AbilityContext,
  nowMs: number
): ViewmodelSocketPose | null {
  if (!ctx.camera) return null;

  ctx.camera.updateMatrixWorld();

  return sampleViewmodelPose<PhantomVoidRayOrbPoseSampleContext>(
    PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
    {
      camera: ctx.camera,
      elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
      timestampMs: ctx.viewmodelNowMs ?? nowMs,
    }
  );
}

export function usePhantomAbilities(): UsePhantomAbilitiesReturn {
  // Fire state
  const lastFireTimeRef = useRef(0);
  const direBallIdRef = useRef(0);
  const phantomPrimaryAmmoRef = useRef(PHANTOM_PRIMARY_MAGAZINE_SIZE);
  const phantomPrimaryReloadingRef = useRef(false);
  const phantomPrimaryReloadStartRef = useRef(0);

  // Void Ray state
  const voidRayChargingRef = useRef(false);
  const voidRayChargeStartRef = useRef(0);
  const voidRayIdRef = useRef(0);
  const voidRayAwaitingReleaseRef = useRef(false);

  const completePhantomPrimaryReload = useCallback(() => {
    phantomPrimaryAmmoRef.current = PHANTOM_PRIMARY_MAGAZINE_SIZE;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;

    const store = useGameStore.getState();
    store.setPhantomPrimaryAmmo(PHANTOM_PRIMARY_MAGAZINE_SIZE);
    store.setPhantomPrimaryReload(false, 0, 0);
  }, []);

  const startPhantomPrimaryReload = useCallback((now: number) => {
    if (phantomPrimaryReloadingRef.current) return;

    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    const reloadDurationMs = PHANTOM_PRIMARY_RELOAD_MS / tempoMultiplier;
    phantomPrimaryReloadingRef.current = true;
    phantomPrimaryReloadStartRef.current = now;
    useGameStore.getState().setPhantomPrimaryReload(true, now, now + reloadDurationMs);
  }, []);

  const updatePhantomPrimaryReload = useCallback((now = Date.now()) => {
    if (!phantomPrimaryReloadingRef.current) return;
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - phantomPrimaryReloadStartRef.current < PHANTOM_PRIMARY_RELOAD_MS / tempoMultiplier) return;

    completePhantomPrimaryReload();
  }, [completePhantomPrimaryReload]);

  const reloadPhantomPrimary = useCallback((now = Date.now()): boolean => {
    updatePhantomPrimaryReload(now);
    if (phantomPrimaryReloadingRef.current) return false;
    if (phantomPrimaryAmmoRef.current >= PHANTOM_PRIMARY_MAGAZINE_SIZE) return false;

    startPhantomPrimaryReload(now);
    return true;
  }, [startPhantomPrimaryReload, updatePhantomPrimaryReload]);

  const resetPhantomPrimaryMagazine = useCallback(() => {
    lastFireTimeRef.current = 0;
    phantomPrimaryAmmoRef.current = PHANTOM_PRIMARY_MAGAZINE_SIZE;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;
    useGameStore.getState().resetPhantomPrimaryMagazine();
  }, []);

  // Fire Dire Ball (primary fire)
  const fireDireBall = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const now = Date.now();
    updatePhantomPrimaryReload(now);
    if (phantomPrimaryReloadingRef.current) return;
    if (phantomPrimaryAmmoRef.current <= 0) {
      startPhantomPrimaryReload(now);
      return;
    }

    const poseTimestampMs = ctx.viewmodelNowMs ?? now;
    const holdBlend = getPhantomPrimaryHeldBlend(poseTimestampMs);
    if (holdBlend < PHANTOM_PRIMARY_FIRE_READY_BLEND) return;
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (now - lastFireTimeRef.current < PHANTOM_FIRE_INTERVAL / tempoMultiplier) return;

    lastFireTimeRef.current = now;
    recordSpawnMarker('phantom:direBall');
    const nextAmmo = Math.max(0, phantomPrimaryAmmoRef.current - 1);
    phantomPrimaryAmmoRef.current = nextAmmo;

    direBallIdRef.current++;
    const launchSide = direBallIdRef.current % 2 === 1 ? 1 : -1;
    const ballId = `dire_${ctx.localPlayer.id}_${direBallIdRef.current}`;
    const launchPose = samplePhantomPrimaryPalmPose(ctx, launchSide, now, holdBlend);
    const spawnOverride = launchPose ? vectorToPlainPosition(launchPose.position) : undefined;
    const { spawnPos, direction } = calculatePhantomLaunch(
      ctx,
      launchSide,
      PHANTOM_DIRE_BALL_AIM_DISTANCE,
      PHANTOM_DIRE_BALL_SOCKET,
      spawnOverride
    );
    assertViewmodelLaunchMatchesPose({
      eventId: ballId,
      launchPosition: spawnPos,
      pose: launchPose,
    });

    const store = useGameStore.getState();
    store.setPhantomPrimaryAmmo(nextAmmo);
    store.addDireBall({
      id: ballId,
      position: spawnPos,
      velocity: {
        x: direction.x * PHANTOM_PROJECTILE_SPEED,
        y: direction.y * PHANTOM_PROJECTILE_SPEED,
        z: direction.z * PHANTOM_PROJECTILE_SPEED,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      launchSide,
      launchYaw: ctx.yaw,
      viewmodelEventId: ballId,
    });

    sounds.playPhantomBasic();
    if (nextAmmo === 0) {
      startPhantomPrimaryReload(now);
    }
  }, [startPhantomPrimaryReload, updatePhantomPrimaryReload]);

  // Handle Void Ray charge and fire (secondary fire)
  const handleVoidRay = useCallback((ctx: AbilityContext, sounds: PlayerSounds) => {
    const now = Date.now();

    const finishVoidRayCharge = () => {
      voidRayChargingRef.current = false;
      voidRayChargeStartRef.current = 0;
      useGameStore.getState().setVoidRayCharging(false, 0);
      sounds.stopPhantomVoidRayCharge();
    };

    const fireVoidRay = () => {
      voidRayIdRef.current++;
      const rayId = `voidray_${ctx.localPlayer.id}_${voidRayIdRef.current}`;
      const launchPose = samplePhantomVoidRayOrbPose(ctx, now);
      const spawnOverride = launchPose ? vectorToPlainPosition(launchPose.position) : undefined;
      const { spawnPos, direction } = calculatePhantomLaunch(
        ctx,
        1,
        PHANTOM_VOID_RAY_AIM_DISTANCE,
        PHANTOM_VOID_RAY_SOCKET,
        spawnOverride
      );
      assertViewmodelLaunchMatchesPose({
        eventId: rayId,
        launchPosition: spawnPos,
        pose: launchPose,
      });

      useGameStore.getState().addVoidRay({
        id: rayId,
        startPosition: spawnPos,
        direction,
        startTime: now,
        ownerId: ctx.localPlayer.id,
        ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
      });

      finishVoidRayCharge();
      sounds.playPhantomVoidRay();
    };

    if (!ctx.inputState.secondaryFire) {
      if (voidRayChargingRef.current) {
        const chargeTime = now - voidRayChargeStartRef.current;
        const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
        if (chargeTime >= VOID_RAY_CHARGE_TIME / tempoMultiplier) {
          fireVoidRay();
        } else {
          finishVoidRayCharge();
        }
      }
      voidRayAwaitingReleaseRef.current = false;
      return;
    }

    if (voidRayAwaitingReleaseRef.current) return;

    if (!voidRayChargingRef.current) {
      const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
      voidRayChargingRef.current = true;
      voidRayChargeStartRef.current = now;
      useGameStore.getState().setVoidRayCharging(true, now);
      sounds.startPhantomVoidRayCharge(VOID_RAY_CHARGE_TIME / tempoMultiplier);
      return;
    }

    const chargeTime = now - voidRayChargeStartRef.current;
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (chargeTime >= VOID_RAY_CHARGE_TIME / tempoMultiplier) {
      fireVoidRay();
      voidRayAwaitingReleaseRef.current = true;
    }
  }, []);

  // Activate Shadow Bubble (Q): a short personal shield around Phantom.
  const executePersonalShield = useCallback((
    ctx: AbilityContext,
    sounds: PlayerSounds,
    setAbilityActive: (id: string, active: boolean) => void,
    startClientCooldown: (id: string) => void,
    updateLocalPlayer: (data: any) => void
  ): boolean => {
    const now = Date.now();
    const store = useGameStore.getState();
    const clientCooldowns = store.clientCooldowns || {};
    const cooldownEnd = clientCooldowns[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
    if (cooldownEnd && now < cooldownEnd) return false;

    const abilityDef = ABILITY_DEFINITIONS[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
    const durationMs = (abilityDef?.duration ?? 6) * 1000;
    const currentAbilities = store.localPlayer?.id === ctx.localPlayer.id
      ? store.localPlayer.abilities
      : {};
    setAbilityActive(PHANTOM_PERSONAL_SHIELD_ABILITY_ID, true);
    updateLocalPlayer({
      abilities: {
        ...currentAbilities,
        [PHANTOM_PERSONAL_SHIELD_ABILITY_ID]: {
          abilityId: PHANTOM_PERSONAL_SHIELD_ABILITY_ID,
          cooldownRemaining: abilityDef?.cooldown ?? 10,
          charges: 1,
          isActive: true,
          activatedAt: now,
        },
      },
    });

    recordSpawnMarker('phantom:personalShield');
    sounds.playPhantomVeil();
    startClientCooldown(PHANTOM_PERSONAL_SHIELD_ABILITY_ID);

    window.setTimeout(() => {
      const currentPlayer = useGameStore.getState().localPlayer;
      const currentAbility = currentPlayer?.abilities?.[PHANTOM_PERSONAL_SHIELD_ABILITY_ID];
      if (!currentPlayer || !currentAbility?.isActive || currentAbility.activatedAt !== now) return;

      setAbilityActive(PHANTOM_PERSONAL_SHIELD_ABILITY_ID, false);
      updateLocalPlayer({
        abilities: {
          ...currentPlayer.abilities,
          [PHANTOM_PERSONAL_SHIELD_ABILITY_ID]: {
            ...currentAbility,
            isActive: false,
          },
        },
      });
    }, durationMs);

    return true;
  }, []);

  // Execute Blink ability (E)
  const executeBlink = useCallback((
    ctx: AbilityContext,
    sounds: PlayerSounds,
    useAbilityCharge: (id: string) => boolean
  ): boolean => {
    const blinkDistance = 8;
    const dx = -Math.sin(ctx.yaw);
    const dz = -Math.cos(ctx.yaw);

    let targetX = ctx.position.x + dx * blinkDistance;
    let targetY = ctx.position.y;
    let targetZ = ctx.position.z + dz * blinkDistance;

    // Upward boost if looking up
    if (ctx.pitch < -0.3) {
      targetY += 2;
    }

    // Check for walls
    const checkHeights = [0.9, 1.5];
    let wallBlocking = false;
    const distToTarget = Math.sqrt(
      (targetX - ctx.position.x) ** 2 +
      (targetZ - ctx.position.z) ** 2
    );

    for (const h of checkHeights) {
      const wallCheck = checkWallCollision(
        ctx.position.x,
        ctx.position.y - PLAYER_HEIGHT / 2 + h,
        ctx.position.z,
        dx, dz, distToTarget
      );

      if (wallCheck.hit && wallCheck.distance < distToTarget - 1.0) {
        const normalY = Math.abs(wallCheck.normal.y);
        if (normalY < 0.5) {
          wallBlocking = true;
          break;
        }
      }
    }

    if (wallBlocking) {
      // Find safe distance
      let safeDistance = 3;
      for (let testDist = blinkDistance - 1; testDist >= 3; testDist -= 1) {
        let blocked = false;
        for (const h of checkHeights) {
          const wallCheck = checkWallCollision(
            ctx.position.x,
            ctx.position.y - PLAYER_HEIGHT / 2 + h,
            ctx.position.z,
            dx, dz, testDist
          );
          const normalY = Math.abs(wallCheck.normal.y);
          if (wallCheck.hit && wallCheck.distance < testDist - 0.5 && normalY < 0.5) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          safeDistance = testDist;
          break;
        }
      }
      targetX = ctx.position.x + dx * safeDistance;
      targetZ = ctx.position.z + dz * safeDistance;
    }

    // Validate destination
    const validation = validateTeleportDestination(targetX, targetY, targetZ, PLAYER_HEIGHT, PLAYER_RADIUS);

    if (!validation.valid) {
      // Try shorter distances
      let foundValid = false;
      for (let dist = blinkDistance - 1; dist >= 2; dist--) {
        const shorterX = ctx.position.x + dx * dist;
        const shorterZ = ctx.position.z + dz * dist;
        const shorterValidation = validateTeleportDestination(shorterX, targetY, shorterZ, PLAYER_HEIGHT, PLAYER_RADIUS);

        if (shorterValidation.valid) {
          targetX = shorterValidation.adjustedPosition?.x ?? shorterX;
          targetY = shorterValidation.adjustedPosition?.y ?? targetY;
          targetZ = shorterValidation.adjustedPosition?.z ?? shorterZ;
          foundValid = true;
          break;
        }
      }
      if (!foundValid) return false;
    } else if (validation.adjustedPosition) {
      targetX = validation.adjustedPosition.x;
      targetY = validation.adjustedPosition.y;
      targetZ = validation.adjustedPosition.z;
    }

    // Use charge
    if (!useAbilityCharge('phantom_blink')) return false;

    // Save start position for effect
    const startPos = { x: ctx.position.x, y: ctx.position.y, z: ctx.position.z };

    // Play sound and effects
    sounds.playPhantomBlink();
    triggerTeleportEffect('blink');
    triggerBlinkEffect(startPos, { x: targetX, y: targetY, z: targetZ });

    // Apply teleport
    ctx.position.x = targetX;
    ctx.position.y = targetY;
    ctx.position.z = targetZ;

    ctx.velocity.x = dx * 2;
    ctx.velocity.z = dz * 2;

    // Create void zone
    const voidZoneId = `local_void_${Date.now()}`;
    useGameStore.getState().addVoidZone({
      id: voidZoneId,
      position: { x: targetX, y: targetY - 0.9, z: targetZ },
      radius: 3,
      duration: 4,
      startTime: Date.now(),
      ownerId: ctx.localPlayer.id,
      ownerTeam: (ctx.localPlayer.team || 'red') as 'red' | 'blue',
    });

    return true;
  }, []);

  // Execute Phantom Veil (Ultimate)
  const executePhantomVeil = useCallback((
    _ctx: AbilityContext,
    sounds: PlayerSounds,
    updateLocalPlayer: (data: any) => void,
    setAbilityActive: (id: string, active: boolean) => void
  ) => {
    const duration = ABILITY_DEFINITIONS['phantom_veil']?.duration ?? 6;
    setAbilityActive('phantom_veil', true);
    updateLocalPlayer({ ultimateCharge: 0 });
    useGameStore.getState().setUltimateEffect(true, 'phantom_veil', Date.now() + duration * 1000);
    sounds.playPhantomVeil();
  }, []);

  return {
    lastFireTimeRef,
    direBallIdRef,
    phantomPrimaryAmmoRef,
    phantomPrimaryReloadingRef,
    phantomPrimaryReloadStartRef,
    voidRayChargingRef,
    voidRayChargeStartRef,
    voidRayIdRef,
    updatePhantomPrimaryReload,
    reloadPhantomPrimary,
    resetPhantomPrimaryMagazine,
    fireDireBall,
    handleVoidRay,
    executeBlink,
    executePersonalShield,
    executePhantomVeil,
  };
}
