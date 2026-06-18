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
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
  PHANTOM_VOID_RAY_COOLDOWN_MS,
  VOID_RAY_CHARGE_TIME,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { playSharedSound } from '../../useAudio';
import type { AbilityContext, PlayerSounds } from '../types';
import {
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_FIRE_INTERVAL,
  PHANTOM_PROJECTILE_SPEED,
  PHANTOM_VOID_RAY_SOCKET,
  calculateLookDirection,
  calculatePlayerSocketPosition,
} from '../constants';
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
  ) => boolean;
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
  const phantomPrimaryHoldStartedAtRef = useRef(0);
  const localVoidRayLastReleaseAtRef = useRef(0);

  const getOwnerTeam = (ctx: AbilityContext): Team => ctx.localPlayer.team || 'red';

  function samplePhantomPrimarySpawn(
    ctx: AbilityContext,
    launchSide: -1 | 1,
    now: number
  ): ResolvedAbilitySocketOrigin | null {
    if (!ctx.camera) return null;
    return resolveAbilitySocketOrigin({
      ownerScope: 'localViewmodel',
      abilityId: 'phantom_dire_ball',
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

  function samplePhantomVoidRaySpawn(
    ctx: AbilityContext,
    now: number
  ): ResolvedAbilitySocketOrigin | null {
    if (!ctx.camera) return null;
    return resolveAbilitySocketOrigin({
      ownerScope: 'localViewmodel',
      abilityId: 'phantom_void_ray',
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
    phantomPrimaryAmmoRef.current = PHANTOM_PRIMARY_MAGAZINE_SIZE;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;
    phantomPrimaryHoldStartedAtRef.current = 0;

    const store = useGameStore.getState();
    store.setPhantomPrimaryAmmo(PHANTOM_PRIMARY_MAGAZINE_SIZE);
    store.setPhantomPrimaryReload(false, 0, 0);
  }, []);

  const beginPhantomPrimaryReload = useCallback((now = Date.now()): boolean => {
    const store = useGameStore.getState();
    const currentAmmo = Math.min(store.phantomPrimaryAmmo, phantomPrimaryAmmoRef.current);

    if (store.phantomPrimaryReloading || phantomPrimaryReloadingRef.current) return false;
    if (currentAmmo >= PHANTOM_PRIMARY_MAGAZINE_SIZE) return false;

    phantomPrimaryAmmoRef.current = Math.max(0, currentAmmo);
    phantomPrimaryReloadingRef.current = true;
    phantomPrimaryReloadStartRef.current = now;
    phantomPrimaryHoldStartedAtRef.current = 0;

    store.setPhantomPrimaryAmmo(phantomPrimaryAmmoRef.current);
    store.setPhantomPrimaryReload(true, now);
    playPredictedPhantomPrimaryReload(now);
    return true;
  }, []);

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
    phantomPrimaryAmmoRef.current = PHANTOM_PRIMARY_MAGAZINE_SIZE;
    phantomPrimaryReloadingRef.current = false;
    phantomPrimaryReloadStartRef.current = 0;
    voidRayChargingRef.current = false;
    voidRayChargeStartRef.current = 0;
    localVoidRayLastReleaseAtRef.current = 0;
    useGameStore.getState().resetPhantomPrimaryMagazine();
  }, []);

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
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const sampledSpawn = samplePhantomPrimarySpawn(ctx, launchSide, now);
    const spawnPosition = sampledSpawn
      ? vectorToPlainPosition(sampledSpawn.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, {
        ...PHANTOM_DIRE_BALL_SOCKET,
        sideOffset: PHANTOM_DIRE_BALL_SOCKET.sideOffset * launchSide,
      });
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
        x: direction.x * PHANTOM_PROJECTILE_SPEED,
        y: direction.y * PHANTOM_PROJECTILE_SPEED,
        z: direction.z * PHANTOM_PROJECTILE_SPEED,
      },
      startTime: now - PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS * 1000,
      ownerId: ctx.localPlayer.id,
      ownerTeam: getOwnerTeam(ctx),
      launchSide,
      launchYaw: ctx.yaw,
      viewmodelEventId: visualId,
    });
    markPredictedLocalAbilityVisual('phantom_dire_ball', ctx.localPlayer.id, visualId, {
      launchSide,
      now,
    });
  }, [beginPhantomPrimaryReload, updatePhantomPrimaryReload]);

  // Locally predict charge and release poses; server confirmation owns damage/cooldown.
  const handleVoidRay = useCallback((ctx: AbilityContext, _sounds: PlayerSounds) => {
    const now = Date.now();
    const store = useGameStore.getState();
    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    const chargeDurationMs = VOID_RAY_CHARGE_TIME / tempoMultiplier;
    const cooldownMs = PHANTOM_VOID_RAY_COOLDOWN_MS / tempoMultiplier;

    if (ctx.inputState.secondaryFire) {
      if (voidRayChargingRef.current || store.voidRayCharging) {
        voidRayChargingRef.current = true;
        voidRayChargeStartRef.current = voidRayChargeStartRef.current || store.voidRayChargeStart || now;
        return;
      }

      if (now - localVoidRayLastReleaseAtRef.current < cooldownMs) return;
      voidRayChargingRef.current = true;
      voidRayChargeStartRef.current = now;
      store.setVoidRayCharging(true, now);
      markPredictedLocalAbilityVisual('phantom_void_ray_charge', ctx.localPlayer.id, `predicted_phantom_void_ray_charge_${ctx.localPlayer.id}_${now}`, {
        now,
      });
      return;
    }

    const chargeStart = voidRayChargeStartRef.current || store.voidRayChargeStart || now;
    if (!voidRayChargingRef.current && !store.voidRayCharging) return;

    if (now - chargeStart < chargeDurationMs) {
      store.setVoidRayCharging(false, 0);
      voidRayChargingRef.current = false;
      voidRayChargeStartRef.current = 0;
      return;
    }

    voidRayChargingRef.current = false;
    voidRayChargeStartRef.current = 0;
    localVoidRayLastReleaseAtRef.current = now;
    store.setVoidRayCharging(false, 0);

    voidRayIdRef.current += 1;
    const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
    const sampledSpawn = samplePhantomVoidRaySpawn(ctx, now);
    const startPosition = sampledSpawn
      ? vectorToPlainPosition(sampledSpawn.position)
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, PHANTOM_VOID_RAY_SOCKET);
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
  }, []);

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

  // Phantom Veil is requested through input and confirmed by the server.
  const executePhantomVeil = useCallback((
    ctx: AbilityContext,
    _sounds: PlayerSounds,
    _updateLocalPlayer: (data: any) => void,
    _setAbilityActive: (id: string, active: boolean) => void
  ) => {
    const now = ctx.viewmodelNowMs ?? Date.now();
    const durationMs = (ABILITY_DEFINITIONS.phantom_veil?.duration ?? 0) * 1000;
    const effectEndTime = now + durationMs;
    triggerPhantomVeilCastPose(now);
    useGameStore.getState().setUltimateEffect(true, 'phantom_veil', effectEndTime);
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
    handleVoidRay,
    executeBlink,
    executePersonalShield,
    executePhantomVeil,
  };
}
