import { useCallback, useRef } from 'react';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_SPEED,
  CHRONOS_PRIMARY_MAGAZINE_SIZE,
  CHRONOS_PRIMARY_RELOAD_MS,
  CHRONOS_VERDANT_PULSE_AIM_DISTANCE,
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  CHRONOS_VERDANT_PULSE_FIRE_READY_MS,
  CHRONOS_VERDANT_PULSE_SPEED,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { predictLocalChronosAscendantParadox } from '../../../movement/localPrediction';
import {
  CHRONOS_PRIMARY_ORB_SOCKET,
  calculatePlayerSocketPosition,
} from '../constants';
import { resolveAbilityAimDirection } from '../abilityAim';
import { getLocalChronosTimebreakTempoMultiplier } from '../chronosTimebreakTempo';
import {
  triggerChronosAscendantParadoxPose,
  triggerChronosLifelineConduitPose,
  triggerChronosPrimaryShotGlow,
  triggerChronosTimebreakPose,
  type ChronosPrimaryOrbPoseSampleContext,
} from '../../../viewmodel/chronosPose';
import {
  resolveAbilitySocketOrigin,
  type ResolvedAbilitySocketOrigin,
} from '../../../model-system/abilitySocketResolver';
import { offsetChronosOrbVisualPlainPosition } from '../../../model-system/chronosOrbVisualOrigin';
import {
  CHRONOS_VERDANT_PULSE_SHOT_PITCH,
  CHRONOS_VERDANT_PULSE_SHOT_VOLUME,
  playSharedSound,
} from '../../useAudio';
import type { AbilityContext } from '../types';
import { markPredictedLocalAbilitySound } from '../useLocalAbilityAudioPrediction';
import { markPredictedLocalAbilityVisual } from '../useLocalAbilityVisualPrediction';

const CHRONOS_PRIMARY_RELOAD_SOUND_FADE_OUT_MS = 240;

function playPredictedChronosPrimaryReload(now: number): void {
  markPredictedLocalAbilitySound('chronos_reload', now, CHRONOS_PRIMARY_RELOAD_MS + 250);
  const fadeOutMs = Math.min(CHRONOS_PRIMARY_RELOAD_SOUND_FADE_OUT_MS, CHRONOS_PRIMARY_RELOAD_MS);
  void playSharedSound('chronosReload', {
    durationMs: CHRONOS_PRIMARY_RELOAD_MS,
    fadeOutMs,
  });
}

export interface UseChronosAbilitiesReturn {
  lastPulseTimeRef: React.MutableRefObject<number>;
  pulseIdRef: React.MutableRefObject<number>;
  timebreakIdRef: React.MutableRefObject<number>;
  chronosPrimaryAmmoRef: React.MutableRefObject<number>;
  chronosPrimaryReloadingRef: React.MutableRefObject<boolean>;
  chronosPrimaryReloadStartRef: React.MutableRefObject<number>;
  updateChronosPrimaryReload: (now?: number) => void;
  reloadChronosPrimary: (now?: number) => boolean;
  resetChronosPrimaryMagazine: () => void;
  executeLifelineConduit: (ctx: AbilityContext) => boolean;
  executeTimebreak: (
    ctx: AbilityContext,
    startClientCooldown: (abilityId: string) => void
  ) => boolean;
  executeAscendantParadox: (
    ctx: AbilityContext,
    setAbilityActive: (
      abilityId: string,
      active: boolean,
      options?: { startTime?: number; startCooldownOnEnd?: boolean }
    ) => void
  ) => boolean;
  fireVerdantPulse: (ctx: AbilityContext) => void;
}

/**
 * Chronos casts are server-authoritative. PlayerController still calls this hook
 * to preserve the input flow, but world effects, healing, cooldowns, and pulses
 * are created from server messages in gameMessageHandlers.
 */
export function useChronosAbilities(): UseChronosAbilitiesReturn {
  const lastPulseTimeRef = useRef(0);
  const pulseIdRef = useRef(0);
  const timebreakIdRef = useRef(0);
  const getOwnerTeam = (ctx: AbilityContext): Team => ctx.localPlayer.team || 'red';
  const primaryHoldStartedAtRef = useRef(0);
  const chronosPrimaryAmmoRef = useRef(CHRONOS_PRIMARY_MAGAZINE_SIZE);
  const chronosPrimaryReloadingRef = useRef(false);
  const chronosPrimaryReloadStartRef = useRef(0);

  const completeChronosPrimaryReload = useCallback(() => {
    chronosPrimaryAmmoRef.current = CHRONOS_PRIMARY_MAGAZINE_SIZE;
    chronosPrimaryReloadingRef.current = false;
    chronosPrimaryReloadStartRef.current = 0;

    const store = useGameStore.getState();
    store.setChronosPrimaryAmmo(CHRONOS_PRIMARY_MAGAZINE_SIZE);
    store.setChronosPrimaryReload(false, 0, 0);
  }, []);

  const beginChronosPrimaryReload = useCallback((now = Date.now()): boolean => {
    const store = useGameStore.getState();
    const currentAmmo = Math.min(store.chronosPrimaryAmmo, chronosPrimaryAmmoRef.current);

    if (store.chronosPrimaryReloading || chronosPrimaryReloadingRef.current) return false;
    if (currentAmmo >= CHRONOS_PRIMARY_MAGAZINE_SIZE) return false;

    chronosPrimaryAmmoRef.current = Math.max(0, currentAmmo);
    chronosPrimaryReloadingRef.current = true;
    chronosPrimaryReloadStartRef.current = now;

    store.setChronosPrimaryAmmo(chronosPrimaryAmmoRef.current);
    store.setChronosPrimaryReload(true, now, now + CHRONOS_PRIMARY_RELOAD_MS);
    playPredictedChronosPrimaryReload(now);
    return true;
  }, []);

  const updateChronosPrimaryReload = useCallback((now = Date.now()) => {
    const store = useGameStore.getState();
    chronosPrimaryAmmoRef.current = store.chronosPrimaryAmmo;
    chronosPrimaryReloadingRef.current = store.chronosPrimaryReloading;
    chronosPrimaryReloadStartRef.current = store.chronosPrimaryReloadStart;

    if (!chronosPrimaryReloadingRef.current) {
      if (chronosPrimaryAmmoRef.current <= 0) {
        beginChronosPrimaryReload(now);
      }
      return;
    }

    const reloadEnd = store.chronosPrimaryReloadEnd;
    if (reloadEnd > 0 && now < reloadEnd) return;

    completeChronosPrimaryReload();
  }, [beginChronosPrimaryReload, completeChronosPrimaryReload]);

  const reloadChronosPrimary = useCallback((now = Date.now()): boolean => {
    updateChronosPrimaryReload(now);
    return beginChronosPrimaryReload(now);
  }, [beginChronosPrimaryReload, updateChronosPrimaryReload]);

  const resetChronosPrimaryMagazine = useCallback(() => {
    lastPulseTimeRef.current = 0;
    primaryHoldStartedAtRef.current = 0;
    chronosPrimaryAmmoRef.current = CHRONOS_PRIMARY_MAGAZINE_SIZE;
    chronosPrimaryReloadingRef.current = false;
    chronosPrimaryReloadStartRef.current = 0;
    useGameStore.getState().resetChronosPrimaryMagazine();
  }, []);

  function sampleChronosPrimarySpawn(ctx: AbilityContext, now: number): ResolvedAbilitySocketOrigin | null {
    if (!ctx.camera) return null;
    return resolveAbilitySocketOrigin({
      ownerScope: 'localViewmodel',
      abilityId: 'chronos_verdant_pulse',
      sampledContext: {
        camera: ctx.camera,
        elapsedSeconds: ctx.viewmodelElapsedSeconds ?? 0,
        timestampMs: ctx.viewmodelNowMs ?? now,
      } satisfies ChronosPrimaryOrbPoseSampleContext,
      preferSampled: true,
      warnOnSampleDrift: true,
    });
  }

  const executeLifelineConduit = useCallback((ctx: AbilityContext): boolean => {
    const now = Date.now();
    triggerChronosLifelineConduitPose(now);
    markPredictedLocalAbilityVisual('chronos_lifeline_conduit', ctx.localPlayer.id, `predicted_chronos_lifeline_${ctx.localPlayer.id}_${now}`, {
      now,
    });
    return true;
  }, []);

  const executeTimebreak = useCallback((
    ctx: AbilityContext,
    _startClientCooldown: (abilityId: string) => void
  ): boolean => {
    const now = Date.now();
    timebreakIdRef.current += 1;
    triggerChronosTimebreakPose(now);
    markPredictedLocalAbilityVisual('chronos_timebreak', ctx.localPlayer.id, `predicted_chronos_timebreak_${ctx.localPlayer.id}_${timebreakIdRef.current}`, {
      now,
    });
    return true;
  }, []);

  const executeAscendantParadox = useCallback((
    ctx: AbilityContext,
    setAbilityActive: (
      abilityId: string,
      active: boolean,
      options?: { startTime?: number; startCooldownOnEnd?: boolean }
    ) => void
  ): boolean => {
    const store = useGameStore.getState();
    const localPlayer = store.localPlayer;
    if (!localPlayer || localPlayer.heroId !== 'chronos' || (localPlayer.ultimateCharge ?? 0) < 100) return false;

    const now = Date.now();
    const abilityId = 'chronos_ascendant_paradox';
    const predictedState = predictLocalChronosAscendantParadox(localPlayer, ctx.yaw);
    const existingAbility = localPlayer.abilities?.[abilityId];
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    const cooldownSeconds = abilityDef?.cooldown ?? existingAbility?.cooldownRemaining ?? 0;

    triggerChronosAscendantParadoxPose(now);
    markPredictedLocalAbilityVisual(abilityId, localPlayer.id, `predicted_chronos_ascendant_${localPlayer.id}_${now}`, {
      now,
    });
    setAbilityActive(abilityId, true, { startTime: now });
    store.setUltimateEffect(true, abilityId, now + CHRONOS_ASCENDANT_PARADOX_DURATION_MS);
    store.updateLocalPlayer({
      ultimateCharge: 0,
      position: predictedState.position,
      velocity: predictedState.velocity,
      movement: predictedState.movement,
      abilities: {
        ...localPlayer.abilities,
        [abilityId]: {
          abilityId,
          cooldownRemaining: cooldownSeconds,
          cooldownUntil: cooldownSeconds > 0 ? now + cooldownSeconds * 1000 : 0,
          charges: existingAbility?.charges ?? abilityDef?.charges ?? 1,
          isActive: true,
          activatedAt: now,
        },
      },
    });
    return true;
  }, []);

  function isAscendantParadoxActive(now: number): boolean {
    const localPlayer = useGameStore.getState().localPlayer;
    if (localPlayer?.heroId !== 'chronos') return false;
    const ability = localPlayer.abilities?.['chronos_ascendant_paradox'];
    if (!ability?.isActive) return false;
    const activatedAt = ability.activatedAt ?? now;
    return now - activatedAt < CHRONOS_ASCENDANT_PARADOX_DURATION_MS;
  }

  const fireVerdantPulse = useCallback((ctx: AbilityContext): void => {
    const now = Date.now();
    if (ctx.inputState.ability1 || !ctx.inputState.primaryFire) {
      primaryHoldStartedAtRef.current = 0;
      return;
    }

    updateChronosPrimaryReload(now);
    if (chronosPrimaryReloadingRef.current) return;
    if (chronosPrimaryAmmoRef.current <= 0) {
      beginChronosPrimaryReload(now);
      return;
    }

    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    const supercharged = isAscendantParadoxActive(now);
    const cooldownMs = supercharged
      ? CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS
      : CHRONOS_VERDANT_PULSE_COOLDOWN_MS;
    const pulseSpeed = supercharged
      ? CHRONOS_ASCENDANT_PARADOX_PULSE_SPEED
      : CHRONOS_VERDANT_PULSE_SPEED;
    if (primaryHoldStartedAtRef.current <= 0) {
      primaryHoldStartedAtRef.current = now;
    }
    if (now - primaryHoldStartedAtRef.current < CHRONOS_VERDANT_PULSE_FIRE_READY_MS / tempoMultiplier) return;
    if (now - lastPulseTimeRef.current < cooldownMs / tempoMultiplier) return;

    lastPulseTimeRef.current = now;
    pulseIdRef.current += 1;
    const sampledSpawn = sampleChronosPrimarySpawn(ctx, now);
    const socketPosition = sampledSpawn
      ? {
        x: sampledSpawn.position.x,
        y: sampledSpawn.position.y,
        z: sampledSpawn.position.z,
      }
      : calculatePlayerSocketPosition(ctx.position, ctx.yaw, CHRONOS_PRIMARY_ORB_SOCKET);
    const direction = resolveAbilityAimDirection(ctx, socketPosition, CHRONOS_VERDANT_PULSE_AIM_DISTANCE);
    const startPosition = offsetChronosOrbVisualPlainPosition(
      socketPosition,
      direction,
      'chronos_verdant_pulse'
    );
    const visualId = `predicted_chronos_pulse_${ctx.localPlayer.id}_${pulseIdRef.current}`;

    chronosPrimaryAmmoRef.current = Math.max(0, chronosPrimaryAmmoRef.current - 1);
    const store = useGameStore.getState();
    store.setChronosPrimaryAmmo(chronosPrimaryAmmoRef.current);
    if (chronosPrimaryAmmoRef.current <= 0) {
      beginChronosPrimaryReload(now);
    }

    triggerChronosPrimaryShotGlow(now);
    store.addChronosPulse({
      id: visualId,
      position: startPosition,
      velocity: {
        x: direction.x * pulseSpeed,
        y: direction.y * pulseSpeed,
        z: direction.z * pulseSpeed,
      },
      startTime: now,
      ownerId: ctx.localPlayer.id,
      ownerTeam: getOwnerTeam(ctx),
      supercharged,
      radius: supercharged ? CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS : undefined,
    });
    markPredictedLocalAbilityVisual('chronos_verdant_pulse', ctx.localPlayer.id, visualId, { now });
    markPredictedLocalAbilitySound('chronos_verdant_pulse', now);
    void playSharedSound('phantomBasic', {
      pitch: CHRONOS_VERDANT_PULSE_SHOT_PITCH,
      volume: CHRONOS_VERDANT_PULSE_SHOT_VOLUME,
    });
  }, [beginChronosPrimaryReload, updateChronosPrimaryReload]);

  return {
    lastPulseTimeRef,
    pulseIdRef,
    timebreakIdRef,
    chronosPrimaryAmmoRef,
    chronosPrimaryReloadingRef,
    chronosPrimaryReloadStartRef,
    updateChronosPrimaryReload,
    reloadChronosPrimary,
    resetChronosPrimaryMagazine,
    executeLifelineConduit,
    executeTimebreak,
    executeAscendantParadox,
    fireVerdantPulse,
  };
}
