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
import {
  ABILITY_DEFINITIONS,
  PHANTOM_PRIMARY_FIRE_READY_MS,
  PHANTOM_PRIMARY_RELOAD_MS,
  PHANTOM_RIFT_BOLT_COOLDOWN_MS,
  PHANTOM_RIFT_BOLT_LIFETIME_MS,
  PHANTOM_VOID_RAY_COOLDOWN_MS,
  VOID_RAY_CHARGE_TIME,
  getPhantomPrimaryAbilityId,
  getPhantomPrimaryMagazineSize,
  getPhantomPrimaryProjectileSpeed,
  getPhantomRiftBoltPosition,
  type PhantomPrimarySkill,
  type PhantomSecondarySkill,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { playSharedSound } from '../../useAudio';
import type { AbilityContext, PlayerSounds } from '../types';
import {
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_FIRE_INTERVAL,
  PHANTOM_VOID_RAY_SOCKET,
  calculatePlayerSocketPosition,
} from '../constants';
import { resolveAbilityAimDirection } from '../abilityAim';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS,
  triggerPhantomVeilCastPose,
  type PhantomPrimaryPoseSampleContext,
  type PhantomVoidRayOrbPoseSampleContext,
} from '../../../viewmodel/phantomPrimaryPose';
import {
  resolveAbilitySocketOrigin,
  type ResolvedAbilitySocketOrigin,
} from '../../../model-system/abilitySocketResolver';
import { markPredictedLocalAbilityVisual } from '../useLocalAbilityVisualPrediction';
import { markPredictedLocalAbilitySound } from '../useLocalAbilityAudioPrediction';

function vectorToPlainPosition(vector: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function playPredictedPhantomPrimaryReload(now: number): void {
  markPredictedLocalAbilitySound('phantom_reload', now, PHANTOM_PRIMARY_RELOAD_MS + 250);
  const fadeOutMs = Math.min(450, PHANTOM_PRIMARY_RELOAD_MS);
  void playSharedSound('phantomReload', {
    durationMs: PHANTOM_PRIMARY_RELOAD_MS,
    fadeOutMs,
  });
}

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
  handleSecondaryFire: (ctx: AbilityContext, sounds: PlayerSounds) => { x: number; y: number; z: number } | null;
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
  executePhantomUltimate: (abilityId: string, ctx: AbilityContext) => boolean;
}

export function usePhantomAbilities(
  phantomPrimarySkill: PhantomPrimarySkill,
  phantomSecondarySkill: PhantomSecondarySkill,
): UsePhantomAbilitiesReturn {
  const primaryMagazineSize = getPhantomPrimaryMagazineSize(phantomPrimarySkill);
  const primaryAbilityId = getPhantomPrimaryAbilityId(phantomPrimarySkill);
  const primaryProjectileSpeed = getPhantomPrimaryProjectileSpeed(phantomPrimarySkill);
  // Fire state
  const lastFireTimeRef = useRef(0);
  const direBallIdRef = useRef(0);
  const phantomPrimaryAmmoRef = useRef(primaryMagazineSize);
  const phantomPrimaryReloadingRef = useRef(false);
  const phantomPrimaryReloadStartRef = useRef(0);

  // Void Ray state
  const voidRayChargingRef = useRef(false);
  const voidRayChargeStartRef = useRef(0);
  const voidRayIdRef = useRef(0);
  const phantomPrimaryHoldStartedAtRef = useRef(0);
  const localVoidRayLastReleaseAtRef = useRef(0);
  const riftBoltPressedRef = useRef(false);
  const riftBoltIdRef = useRef(0);
  const localRiftBoltLastCastAtRef = useRef(0);

  const getOwnerTeam = (ctx: AbilityContext): Team => ctx.localPlayer.team || 'red';

  function samplePhantomPrimarySpawn(
    ctx: AbilityContext,
    launchSide: -1 | 1,
    now: number
  ): ResolvedAbilitySocketOrigin | null {
    if (!ctx.camera) return null;
    return resolveAbilitySocketOrigin({
      ownerScope: 'localViewmodel',
      abilityId: primaryAbilityId,
      side: launchSide,
      sampledContext: {
        camera: ctx.camera,
        elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
        side: launchSide,
        actionTimeSeconds: PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
        timestampMs: ctx.viewmodelNowMs ?? now,
      } satisfies PhantomPrimaryPoseSampleContext,
      preferSampled: true,
      warnOnSampleDrift: true,
    });
  }

  function samplePhantomSecondarySpawn(
    ctx: AbilityContext,
    now: number,
    abilityId: 'phantom_void_ray' | 'phantom_rift_bolt' = 'phantom_void_ray',
  ): ResolvedAbilitySocketOrigin | null {
    if (!ctx.camera) return null;
    return resolveAbilitySocketOrigin({
      ownerScope: 'localViewmodel',
      abilityId,
      sampledContext: {
        camera: ctx.camera,
        elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
        timestampMs: ctx.viewmodelNowMs ?? now,
      } satisfies PhantomVoidRayOrbPoseSampleContext,
      preferSampled: true,
      warnOnSampleDrift: true,
    });
  }

  const completePhantomPrimaryReload = useCallback(() => {
    phantomPrimaryAmmoRef.current = primaryMagazineSize;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;
    phantomPrimaryHoldStartedAtRef.current = 0;

    const store = useGameStore.getState();
    store.setPhantomPrimaryAmmo(primaryMagazineSize);
    store.setPhantomPrimaryReload(false, 0, 0);
  }, [primaryMagazineSize]);

  const beginPhantomPrimaryReload = useCallback((now = Date.now()): boolean => {
    const store = useGameStore.getState();
    const currentAmmo = Math.min(store.phantomPrimaryAmmo, phantomPrimaryAmmoRef.current);

    if (store.phantomPrimaryReloading || phantomPrimaryReloadingRef.current) return false;
    if (currentAmmo >= primaryMagazineSize) return false;

    phantomPrimaryAmmoRef.current = Math.max(0, currentAmmo);
    phantomPrimaryReloadingRef.current = true;
    phantomPrimaryReloadStartRef.current = now;
    phantomPrimaryHoldStartedAtRef.current = 0;

    store.setPhantomPrimaryAmmo(phantomPrimaryAmmoRef.current);
    store.setPhantomPrimaryReload(true, now);
    playPredictedPhantomPrimaryReload(now);
    return true;
  }, [primaryMagazineSize]);

  const updatePhantomPrimaryReload = useCallback((now = Date.now()) => {
    const store = useGameStore.getState();
    phantomPrimaryAmmoRef.current = store.phantomPrimaryAmmo;
    phantomPrimaryReloadingRef.current = store.phantomPrimaryReloading;
    phantomPrimaryReloadStartRef.current = store.phantomPrimaryReloadStart;

    if (!phantomPrimaryReloadingRef.current) {
      if (phantomPrimaryAmmoRef.current <= 0) {
        beginPhantomPrimaryReload(now);
      }
      return;
    }
    const reloadEnd = store.phantomPrimaryReloadEnd;
    if (reloadEnd > 0 && now < reloadEnd) return;

    completePhantomPrimaryReload();
  }, [beginPhantomPrimaryReload, completePhantomPrimaryReload]);

  const reloadPhantomPrimary = useCallback((now = Date.now()): boolean => {
    updatePhantomPrimaryReload(now);
    return beginPhantomPrimaryReload(now);
  }, [beginPhantomPrimaryReload, updatePhantomPrimaryReload]);

  const resetPhantomPrimaryMagazine = useCallback(() => {
    lastFireTimeRef.current = 0;
    phantomPrimaryHoldStartedAtRef.current = 0;
    phantomPrimaryAmmoRef.current = primaryMagazineSize;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;
    voidRayChargingRef.current = false;
    voidRayChargeStartRef.current = 0;
    localVoidRayLastReleaseAtRef.current = 0;
    riftBoltPressedRef.current = false;
    localRiftBoltLastCastAtRef.current = 0;
    useGameStore.getState().removeRiftBoltsByOwner(useGameStore.getState().localPlayer?.id ?? '');
    useGameStore.getState().resetPhantomPrimaryMagazine(primaryMagazineSize);
  }, [primaryMagazineSize]);

  // Fire Dire Ball (primary fire)
  const fireDireBall = useCallback((ctx: AbilityContext, _sounds: PlayerSounds) => {
    const now = Date.now();
    if (!ctx.inputState.primaryFire) {
      phantomPrimaryHoldStartedAtRef.current = 0;
      return;
    }

    updatePhantomPrimaryReload(now);
    if (phantomPrimaryReloadingRef.current) return;
    if (phantomPrimaryAmmoRef.current <= 0) {
      beginPhantomPrimaryReload(now);
      return;
    }

    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    if (phantomPrimaryHoldStartedAtRef.current <= 0) {
      phantomPrimaryHoldStartedAtRef.current = now;
    }
    if (now - phantomPrimaryHoldStartedAtRef.current < PHANTOM_PRIMARY_FIRE_READY_MS / tempoMultiplier) return;
    if (now - lastFireTimeRef.current < PHANTOM_FIRE_INTERVAL / tempoMultiplier) return;

    lastFireTimeRef.current = now;
    direBallIdRef.current += 1;
    const launchSide = direBallIdRef.current % 2 === 1 ? 1 : -1;
    const sampledSpawn = samplePhantomPrimarySpawn(ctx, launchSide, now);
    const spawnPosition = sampledSpawn
      ? vectorToPlainPosition(sampledSpawn.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
        ...PHANTOM_DIRE_BALL_SOCKET,
        sideOffset: PHANTOM_DIRE_BALL_SOCKET.sideOffset * launchSide,
      });
    const direction = resolveAbilityAimDirection(ctx, spawnPosition);
    const visualId = `predicted_phantom_dire_ball_${ctx.localPlayer.id}_${direBallIdRef.current}`;

    phantomPrimaryAmmoRef.current = Math.max(0, phantomPrimaryAmmoRef.current - 1);
    useGameStore.getState().setPhantomPrimaryAmmo(phantomPrimaryAmmoRef.current);
    if (phantomPrimaryAmmoRef.current <= 0) {
      beginPhantomPrimaryReload(now);
    }
    useGameStore.getState().addDireBall({
      id: visualId,
      position: spawnPosition,
      velocity: {
        x: direction.x * primaryProjectileSpeed,
        y: direction.y * primaryProjectileSpeed,
        z: direction.z * primaryProjectileSpeed,
      },
      startTime: now - PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS * 1000,
      ownerId: ctx.localPlayer.id,
      ownerTeam: getOwnerTeam(ctx),
      launchSide,
      launchYaw: ctx.yaw,
      viewmodelEventId: visualId,
      abilityId: primaryAbilityId,
    });
    markPredictedLocalAbilityVisual(primaryAbilityId, ctx.localPlayer.id, visualId, {
      launchSide,
      now,
    });
  }, [beginPhantomPrimaryReload, primaryAbilityId, primaryProjectileSpeed, updatePhantomPrimaryReload]);

  // Locally predict charge and release poses; server confirmation owns damage/cooldown.
  const handleSecondaryFire = useCallback((ctx: AbilityContext, _sounds: PlayerSounds): { x: number; y: number; z: number } | null => {
    const now = Date.now();
    const store = useGameStore.getState();

    if (phantomSecondarySkill === 'rift_bolt') {
      if (!ctx.inputState.secondaryFire) {
        riftBoltPressedRef.current = false;
        return null;
      }
      if (riftBoltPressedRef.current) return null;
      riftBoltPressedRef.current = true;

      const activeBolt = store.riftBolts.find((bolt) => bolt.ownerId === ctx.localPlayer.id);
      if (activeBolt) {
        const target = getPhantomRiftBoltPosition({
          startPosition: activeBolt.startPosition,
          direction: activeBolt.direction,
          launchedAt: activeBolt.startTime,
          impactPosition: activeBolt.impactPosition,
        }, now);
        markPredictedLocalAbilitySound('phantom_rift_bolt_teleport', now);
        void playSharedSound('phantomBlink', { durationMs: 900, volume: 1.05, pitch: 1.18 });
        if (store.isPracticeMode) {
          store.removeRiftBolt(activeBolt.id);
          return target;
        }
        return null;
      }

      const cooldownUntil = store.clientCooldowns.phantom_rift_bolt ?? 0;
      if (
        cooldownUntil > now ||
        now - localRiftBoltLastCastAtRef.current < PHANTOM_RIFT_BOLT_COOLDOWN_MS
      ) {
        return null;
      }

      localRiftBoltLastCastAtRef.current = now;
      riftBoltIdRef.current += 1;
      const sampledSpawn = samplePhantomSecondarySpawn(ctx, now, 'phantom_rift_bolt');
      const startPosition = sampledSpawn
        ? vectorToPlainPosition(sampledSpawn.position)
        : calculatePlayerSocketPosition(ctx.position, ctx.yaw, PHANTOM_VOID_RAY_SOCKET);
      const direction = resolveAbilityAimDirection(ctx, startPosition);
      const visualId = `predicted_phantom_rift_bolt_${ctx.localPlayer.id}_${riftBoltIdRef.current}`;
      store.addRiftBolt({
        id: visualId,
        startPosition,
        direction,
        startTime: now,
        expiresAt: now + PHANTOM_RIFT_BOLT_LIFETIME_MS,
        ownerId: ctx.localPlayer.id,
        ownerTeam: getOwnerTeam(ctx),
      });
      if (store.isPracticeMode) {
        store.setClientCooldown('phantom_rift_bolt', now + PHANTOM_RIFT_BOLT_COOLDOWN_MS);
      }
      markPredictedLocalAbilityVisual('phantom_rift_bolt', ctx.localPlayer.id, visualId, { now });
      markPredictedLocalAbilitySound('phantom_rift_bolt', now);
      void playSharedSound('phantomVoidRay', { pitch: 1.28, volume: 0.72 });
      return null;
    }

    riftBoltPressedRef.current = false;
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    const chargeDurationMs = VOID_RAY_CHARGE_TIME / tempoMultiplier;
    const cooldownMs = PHANTOM_VOID_RAY_COOLDOWN_MS / tempoMultiplier;

    if (ctx.inputState.secondaryFire) {
      if (voidRayChargingRef.current || store.voidRayCharging) {
        voidRayChargingRef.current = true;
        voidRayChargeStartRef.current = voidRayChargeStartRef.current || store.voidRayChargeStart || now;
        return null;
      }

      if (now - localVoidRayLastReleaseAtRef.current < cooldownMs) return null;
      voidRayChargingRef.current = true;
      voidRayChargeStartRef.current = now;
      store.setVoidRayCharging(true, now);
      markPredictedLocalAbilityVisual('phantom_void_ray_charge', ctx.localPlayer.id, `predicted_phantom_void_ray_charge_${ctx.localPlayer.id}_${now}`, {
        now,
      });
      return null;
    }

    const chargeStart = voidRayChargeStartRef.current || store.voidRayChargeStart || now;
    if (!voidRayChargingRef.current && !store.voidRayCharging) return null;

    if (now - chargeStart < chargeDurationMs) {
      store.setVoidRayCharging(false, 0);
      voidRayChargingRef.current = false;
      voidRayChargeStartRef.current = 0;
      return null;
    }

    voidRayChargingRef.current = false;
    voidRayChargeStartRef.current = 0;
    localVoidRayLastReleaseAtRef.current = now;
    store.setVoidRayCharging(false, 0);

    voidRayIdRef.current += 1;
    const sampledSpawn = samplePhantomSecondarySpawn(ctx, now);
    const startPosition = sampledSpawn
      ? vectorToPlainPosition(sampledSpawn.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, PHANTOM_VOID_RAY_SOCKET);
    const direction = resolveAbilityAimDirection(ctx, startPosition);
    const visualId = `predicted_phantom_void_ray_${ctx.localPlayer.id}_${voidRayIdRef.current}`;
    store.addVoidRay({
      id: visualId,
      startPosition,
      direction,
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: getOwnerTeam(ctx),
    });
    if (store.isPracticeMode && store.localPlayer?.id === ctx.localPlayer.id) {
      store.setClientCooldown('phantom_void_ray', now + cooldownMs);
    }
    markPredictedLocalAbilityVisual('phantom_void_ray', ctx.localPlayer.id, visualId, { now });
    return null;
  }, [phantomSecondarySkill]);

  // Phantom Q is requested through input and confirmed by the server.
  const executePersonalShield = useCallback((
    _ctx: AbilityContext,
    _sounds: PlayerSounds,
    _setAbilityActive: (id: string, active: boolean) => void,
    _startClientCooldown: (id: string) => void,
    _updateLocalPlayer: (data: any) => void
  ): boolean => {
    return true;
  }, []);

  // Phantom Blink is requested through input and confirmed by the server.
  const executeBlink = useCallback((
    _ctx: AbilityContext,
    _sounds: PlayerSounds,
    _useAbilityCharge: (id: string) => boolean
  ): boolean => {
    return true;
  }, []);

  // Phantom ultimates are requested through input and confirmed by the server.
  const executePhantomUltimate = useCallback((
    abilityId: string,
    ctx: AbilityContext,
  ) => {
    if (abilityId !== 'phantom_veil' && abilityId !== 'phantom_nightreign') return false;
    const now = ctx.viewmodelNowMs ?? Date.now();
    const durationMs = (ABILITY_DEFINITIONS[abilityId]?.duration ?? 0) * 1000;
    const effectEndTime = now + durationMs;
    triggerPhantomVeilCastPose(now);
    useGameStore.getState().setUltimateEffect(true, abilityId, effectEndTime);
    return true;
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
    handleSecondaryFire,
    executeBlink,
    executePersonalShield,
    executePhantomUltimate,
  };
}
