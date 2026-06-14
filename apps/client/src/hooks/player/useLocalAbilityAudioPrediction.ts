import { useCallback, useEffect, useRef } from 'react';
import {
  ABILITY_DEFINITIONS,
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  PHANTOM_PRIMARY_FIRE_READY_MS,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_VOID_RAY_COOLDOWN_MS,
  VOID_RAY_CHARGE_TIME,
  createEmptyInputState,
  type HeroId,
  type InputState,
} from '@voxel-strike/shared';
import { playSharedBlazeAirstrikeSound, playSharedSound } from '../useAudio';
import { resetPredictedLocalAbilityVisuals } from './useLocalAbilityVisualPrediction';
import {
  BLAZE_ROCKET_FIRE_INTERVAL,
  DRAG_HOOK_COOLDOWN,
  HOOKSHOT_FIRE_INTERVAL,
  PHANTOM_FIRE_INTERVAL,
} from './constants';
import { getLocalChronosTimebreakTempoMultiplier } from './chronosTimebreakTempo';

const LOCAL_AUDIO_PREDICTION_TTL_MS = 1500;
const HOOKSHOT_SHOT_CLIP_MS = 250;
const CHRONOS_TIMEBREAK_CHARGE_FADE_OUT_MS = 110;

const predictedLocalAbilitySounds = new Map<string, {
  predictedAt: number;
  suppressUntil: number;
}>();

export function markPredictedLocalAbilitySound(
  abilityId: string,
  now = Date.now(),
  ttlMs = LOCAL_AUDIO_PREDICTION_TTL_MS
): void {
  predictedLocalAbilitySounds.set(abilityId, {
    predictedAt: now,
    suppressUntil: now + Math.max(0, ttlMs),
  });
}

export function shouldSuppressPredictedLocalAbilitySound(abilityId: string, now = Date.now()): boolean {
  const prediction = predictedLocalAbilitySounds.get(abilityId);
  if (prediction === undefined) return false;

  if (now > prediction.suppressUntil) {
    predictedLocalAbilitySounds.delete(abilityId);
    return false;
  }

  return true;
}

export interface LocalAbilityAudioPredictionFrame {
  now: number;
  heroId: HeroId;
  inputState: InputState;
  ultimateCharge: number;
  bombTargeting: boolean;
  grappleTrapTargeting: boolean;
  phantomPrimaryAmmo: number;
  phantomPrimaryReloading: boolean;
  canUseAbility: (abilityId: string, isUltimate: boolean, isTargetingActive?: boolean) => boolean;
  getAbilityCharges?: (abilityId: string) => number | undefined;
  canUseHookshotGrapple?: () => boolean;
  hasChronosLifelineTarget?: () => boolean;
}

function playHookshotCastSounds(abilityId: string, castSound: 'hookshotPrimary' | 'hookshotSecondary' | 'hookshotGrapple' | 'hookshotTrap', volume = 1): void {
  markPredictedLocalAbilitySound(abilityId);
  void playSharedSound('hookshotShot', {
    durationMs: HOOKSHOT_SHOT_CLIP_MS,
    fadeOutMs: 24,
  });
  void playSharedSound(castSound, { volume });
}

function getPredictedAbilityCooldownMs(abilityId: string, tempoMultiplier: number): number {
  const abilityDef = ABILITY_DEFINITIONS[abilityId];
  if (!abilityDef) return 0;

  const cooldownSeconds = abilityDef.charges && abilityDef.charges > 1
    ? abilityDef.chargeRegenTime ?? abilityDef.cooldown ?? 0
    : abilityDef.cooldown ?? 0;
  if (!Number.isFinite(cooldownSeconds) || cooldownSeconds <= 0) return 0;

  return (cooldownSeconds * 1000) / Math.max(tempoMultiplier, 0.001);
}

export function useLocalAbilityAudioPrediction() {
  const previousInputRef = useRef<InputState>(createEmptyInputState());
  const currentHeroRef = useRef<HeroId | null>(null);
  const primaryHoldStartedAtRef = useRef(0);
  const lastPrimarySoundAtRef = useRef(0);
  const lastSecondarySoundAtRef = useRef(0);
  const lastPhantomVoidRayAtRef = useRef(0);
  const confirmedPhantomAmmoRef = useRef(PHANTOM_PRIMARY_MAGAZINE_SIZE);
  const predictedPhantomAmmoRef = useRef(PHANTOM_PRIMARY_MAGAZINE_SIZE);
  const phantomVoidRayChargeStartedAtRef = useRef(0);
  const phantomVoidRayReleasePlayedRef = useRef(false);
  const phantomVoidRayChargeAbortRef = useRef<AbortController | null>(null);
  const chronosAegisAbortRef = useRef<AbortController | null>(null);
  const predictedAbilityCooldownUntilRef = useRef<Record<string, number>>({});
  const predictedAbilityChargesRef = useRef<Record<string, number>>({});
  const predictedUltimateSpentRef = useRef<Record<string, boolean>>({});

  const stopPredictedPhantomVoidRayCharge = useCallback(() => {
    phantomVoidRayChargeAbortRef.current?.abort();
    phantomVoidRayChargeAbortRef.current = null;
    phantomVoidRayChargeStartedAtRef.current = 0;
    phantomVoidRayReleasePlayedRef.current = false;
  }, []);

  const stopPredictedChronosAegis = useCallback(() => {
    chronosAegisAbortRef.current?.abort();
    chronosAegisAbortRef.current = null;
  }, []);

  const resetPredictedAbilitySounds = useCallback(() => {
    previousInputRef.current = createEmptyInputState();
    currentHeroRef.current = null;
    primaryHoldStartedAtRef.current = 0;
    lastPrimarySoundAtRef.current = 0;
    lastSecondarySoundAtRef.current = 0;
    predictedAbilityCooldownUntilRef.current = {};
    predictedAbilityChargesRef.current = {};
    predictedUltimateSpentRef.current = {};
    predictedLocalAbilitySounds.clear();
    resetPredictedLocalAbilityVisuals();
    stopPredictedPhantomVoidRayCharge();
    stopPredictedChronosAegis();
  }, [stopPredictedChronosAegis, stopPredictedPhantomVoidRayCharge]);

  useEffect(() => resetPredictedAbilitySounds, [resetPredictedAbilitySounds]);

  const syncPredictedPhantomAmmo = useCallback((confirmedAmmo: number) => {
    if (confirmedPhantomAmmoRef.current === confirmedAmmo) return;
    confirmedPhantomAmmoRef.current = confirmedAmmo;
    predictedPhantomAmmoRef.current = confirmedAmmo;
  }, []);

  const canPlayPrimary = useCallback((now: number, intervalMs: number): boolean => {
    if (now - lastPrimarySoundAtRef.current < intervalMs) return false;
    lastPrimarySoundAtRef.current = now;
    return true;
  }, []);

  const canPlaySecondary = useCallback((now: number, intervalMs: number): boolean => {
    if (now - lastSecondarySoundAtRef.current < intervalMs) return false;
    lastSecondarySoundAtRef.current = now;
    return true;
  }, []);

  const startPredictedPhantomVoidRayCharge = useCallback((now: number, durationMs: number) => {
    stopPredictedPhantomVoidRayCharge();

    const controller = new AbortController();
    phantomVoidRayChargeAbortRef.current = controller;
    phantomVoidRayChargeStartedAtRef.current = now;
    phantomVoidRayReleasePlayedRef.current = false;
    markPredictedLocalAbilitySound('phantom_void_ray_charge', now);
    void playSharedSound('phantomVoidRayCharge', {
      durationMs,
      signal: controller.signal,
    });
  }, [stopPredictedPhantomVoidRayCharge]);

  const startPredictedChronosAegis = useCallback((now: number) => {
    stopPredictedChronosAegis();

    const controller = new AbortController();
    chronosAegisAbortRef.current = controller;
    markPredictedLocalAbilitySound('chronos_aegis', now);
    void playSharedSound('chronosAegis', {
      signal: controller.signal,
    });
  }, [stopPredictedChronosAegis]);

  const playPredictedChronosTimebreak = useCallback((now: number) => {
    markPredictedLocalAbilitySound('chronos_timebreak', now);
    void playSharedSound('chronosTimebreakCharge', {
      durationMs: CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
      fadeOutMs: CHRONOS_TIMEBREAK_CHARGE_FADE_OUT_MS,
    });
  }, []);

  const reservePredictedAbilitySound = useCallback((
    abilityId: string,
    options: {
      now: number;
      tempoMultiplier: number;
      isUltimate?: boolean;
      ultimateCharge?: number;
      confirmedCharges?: number;
    }
  ): boolean => {
    const { now, tempoMultiplier, isUltimate = false, ultimateCharge = 0, confirmedCharges } = options;

    if (isUltimate) {
      if (ultimateCharge < 100) {
        delete predictedUltimateSpentRef.current[abilityId];
        return false;
      }
      if (predictedUltimateSpentRef.current[abilityId]) return false;
      predictedUltimateSpentRef.current[abilityId] = true;
      return true;
    }

    const cooldownUntil = predictedAbilityCooldownUntilRef.current[abilityId] ?? 0;
    if (cooldownUntil > now) return false;
    if (cooldownUntil > 0) {
      delete predictedAbilityCooldownUntilRef.current[abilityId];
    }

    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    const maxCharges = abilityDef?.charges ?? 1;
    if (maxCharges > 1) {
      let charges = predictedAbilityChargesRef.current[abilityId];
      if (charges === undefined) {
        charges = confirmedCharges === undefined
          ? maxCharges
          : Math.max(0, Math.min(maxCharges, confirmedCharges));
      } else if (confirmedCharges !== undefined && confirmedCharges < charges) {
        charges = Math.max(0, confirmedCharges);
      } else if (charges <= 0) {
        charges = confirmedCharges === undefined
          ? maxCharges
          : Math.max(0, Math.min(maxCharges, confirmedCharges));
      }
      if (charges <= 0) return false;

      charges -= 1;
      predictedAbilityChargesRef.current[abilityId] = charges;
      if (charges <= 0) {
        const cooldownMs = getPredictedAbilityCooldownMs(abilityId, tempoMultiplier);
        if (cooldownMs > 0) {
          predictedAbilityCooldownUntilRef.current[abilityId] = now + cooldownMs;
        }
      }
      return true;
    }

    const cooldownMs = getPredictedAbilityCooldownMs(abilityId, tempoMultiplier);
    if (cooldownMs > 0) {
      predictedAbilityCooldownUntilRef.current[abilityId] = now + cooldownMs;
    }
    return true;
  }, []);

  const updatePredictedAbilitySounds = useCallback((frame: LocalAbilityAudioPredictionFrame) => {
    const {
      now,
      heroId,
      inputState,
      ultimateCharge,
      bombTargeting,
      grappleTrapTargeting,
      phantomPrimaryAmmo,
      phantomPrimaryReloading,
      canUseAbility,
      getAbilityCharges,
      canUseHookshotGrapple,
      hasChronosLifelineTarget,
    } = frame;
    const previousInput = previousInputRef.current;
    const chronosLifelineCommitPressed = heroId === 'chronos' &&
      inputState.ability1 &&
      !previousInput.ability1 &&
      (inputState.primaryFire || inputState.secondaryFire);

    if (currentHeroRef.current !== heroId) {
      currentHeroRef.current = heroId;
      primaryHoldStartedAtRef.current = 0;
      lastPrimarySoundAtRef.current = 0;
      lastSecondarySoundAtRef.current = 0;
      predictedAbilityCooldownUntilRef.current = {};
      predictedAbilityChargesRef.current = {};
      predictedUltimateSpentRef.current = {};
      stopPredictedPhantomVoidRayCharge();
      stopPredictedChronosAegis();
      syncPredictedPhantomAmmo(phantomPrimaryAmmo);
    } else {
      syncPredictedPhantomAmmo(phantomPrimaryAmmo);
    }

    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
    const phantomReloadBlocksNonBlinkCasts = heroId === 'phantom' && phantomPrimaryReloading;
    if (phantomReloadBlocksNonBlinkCasts) {
      stopPredictedPhantomVoidRayCharge();
    }

    if (ultimateCharge < 100) {
      predictedUltimateSpentRef.current = {};
    }
    const canReservePredictedSkillSound = (
      abilityId: string,
      isUltimate = false,
      isTargetingActive = false
    ): boolean => (
      canUseAbility(abilityId, isUltimate, isTargetingActive) &&
      reservePredictedAbilitySound(abilityId, {
        now,
        tempoMultiplier,
        isUltimate,
        ultimateCharge,
        confirmedCharges: getAbilityCharges?.(abilityId),
      })
    );

    const primaryPressed = inputState.primaryFire;
    if (primaryPressed && !previousInput.primaryFire) {
      primaryHoldStartedAtRef.current = now;
    } else if (!primaryPressed) {
      primaryHoldStartedAtRef.current = 0;
      if (heroId === 'phantom') {
        predictedPhantomAmmoRef.current = phantomPrimaryAmmo;
      }
    }

    switch (heroId) {
      case 'phantom': {
        const primaryReady = primaryHoldStartedAtRef.current > 0 &&
          now - primaryHoldStartedAtRef.current >= PHANTOM_PRIMARY_FIRE_READY_MS / tempoMultiplier;
        if (
          primaryPressed &&
          primaryReady &&
          !phantomPrimaryReloading &&
          predictedPhantomAmmoRef.current > 0 &&
          canPlayPrimary(now, PHANTOM_FIRE_INTERVAL / tempoMultiplier)
        ) {
          predictedPhantomAmmoRef.current--;
          markPredictedLocalAbilitySound('phantom_dire_ball', now);
          void playSharedSound('phantomBasic');
        }
        break;
      }
      case 'blaze':
        if (
          primaryPressed &&
          !bombTargeting &&
          canPlayPrimary(now, BLAZE_ROCKET_FIRE_INTERVAL / tempoMultiplier)
        ) {
          markPredictedLocalAbilitySound('blaze_rocket', now);
          void playSharedSound('blazeRocket', { pitch: 0.85 + Math.random() * 0.3 });
        }
        break;
      case 'hookshot':
        if (
          primaryPressed &&
          !grappleTrapTargeting &&
          canPlayPrimary(now, HOOKSHOT_FIRE_INTERVAL / tempoMultiplier)
        ) {
          playHookshotCastSounds('hookshot_basic_attack', 'hookshotPrimary');
        }
        break;
      case 'chronos': {
        break;
      }
    }

    if (inputState.secondaryFire && !previousInput.secondaryFire) {
      if (
        heroId === 'phantom' &&
        !phantomReloadBlocksNonBlinkCasts &&
        now - lastPhantomVoidRayAtRef.current >= PHANTOM_VOID_RAY_COOLDOWN_MS / tempoMultiplier
      ) {
        startPredictedPhantomVoidRayCharge(now, VOID_RAY_CHARGE_TIME / tempoMultiplier);
      } else if (
        heroId === 'hookshot' &&
        !grappleTrapTargeting &&
        canPlaySecondary(now, DRAG_HOOK_COOLDOWN / tempoMultiplier)
      ) {
        playHookshotCastSounds('hookshot_heavy_attack', 'hookshotSecondary', 1.05);
      } else if (heroId === 'chronos' && !inputState.ability1) {
        startPredictedChronosAegis(now);
      }
    }

    if (
      heroId === 'phantom' &&
      !phantomReloadBlocksNonBlinkCasts &&
      inputState.secondaryFire &&
      phantomVoidRayChargeStartedAtRef.current > 0
    ) {
      const chargeElapsed = now - phantomVoidRayChargeStartedAtRef.current;
      if (!phantomVoidRayReleasePlayedRef.current && chargeElapsed >= VOID_RAY_CHARGE_TIME / tempoMultiplier) {
        phantomVoidRayReleasePlayedRef.current = true;
        lastPhantomVoidRayAtRef.current = now;
        markPredictedLocalAbilitySound('phantom_void_ray', now);
        void playSharedSound('phantomVoidRay');
      }
    }

    if (!inputState.secondaryFire && previousInput.secondaryFire && heroId === 'phantom') {
      if (!phantomVoidRayReleasePlayedRef.current) {
        stopPredictedPhantomVoidRayCharge();
      } else {
        phantomVoidRayChargeStartedAtRef.current = 0;
        phantomVoidRayReleasePlayedRef.current = false;
        phantomVoidRayChargeAbortRef.current = null;
      }
    }

    if (!inputState.secondaryFire && previousInput.secondaryFire && heroId === 'chronos') {
      stopPredictedChronosAegis();
    }

    if (inputState.ability1 && !previousInput.ability1) {
      if (heroId === 'phantom' && canReservePredictedSkillSound('phantom_blink')) {
        markPredictedLocalAbilitySound('phantom_blink', now);
        void playSharedSound('phantomBlink', { durationMs: 900, volume: 1.1 });
      } else if (
        heroId === 'hookshot' &&
        !grappleTrapTargeting &&
        (canUseHookshotGrapple?.() ?? false) &&
        canReservePredictedSkillSound('hookshot_grapple')
      ) {
        playHookshotCastSounds('hookshot_grapple', 'hookshotGrapple');
      } else if (
        heroId === 'chronos' &&
        chronosLifelineCommitPressed &&
        (inputState.secondaryFire || (hasChronosLifelineTarget?.() ?? false)) &&
        canReservePredictedSkillSound('chronos_lifeline_conduit')
      ) {
        markPredictedLocalAbilitySound('chronos_lifeline_conduit', now);
        void playSharedSound('chronosLifeline');
      }
    }

    if (inputState.ability2 && !previousInput.ability2) {
      if (heroId === 'blaze' && canReservePredictedSkillSound('blaze_rocketjump')) {
        markPredictedLocalAbilitySound('blaze_rocketjump', now);
        void playSharedSound('blazeRocketJump');
      } else if (heroId === 'chronos' && canReservePredictedSkillSound('chronos_timebreak')) {
        playPredictedChronosTimebreak(now);
      }
    }

    if (inputState.ultimate && !previousInput.ultimate) {
      if (heroId === 'phantom' && canReservePredictedSkillSound('phantom_veil', true)) {
        markPredictedLocalAbilitySound('phantom_veil', now);
        void playSharedSound('phantomVeil');
      } else if (heroId === 'blaze' && canReservePredictedSkillSound('blaze_airstrike', true)) {
        markPredictedLocalAbilitySound('blaze_airstrike', now);
        void playSharedBlazeAirstrikeSound();
      } else if (heroId === 'hookshot' && canReservePredictedSkillSound('hookshot_grapple_trap', true, grappleTrapTargeting)) {
        playHookshotCastSounds('hookshot_grapple_trap', 'hookshotTrap', 1.15);
      }
    }

    previousInputRef.current = inputState;
  }, [
    canPlayPrimary,
    canPlaySecondary,
    playPredictedChronosTimebreak,
    reservePredictedAbilitySound,
    startPredictedChronosAegis,
    startPredictedPhantomVoidRayCharge,
    stopPredictedChronosAegis,
    stopPredictedPhantomVoidRayCharge,
    syncPredictedPhantomAmmo,
  ]);

  return {
    resetPredictedAbilitySounds,
    updatePredictedAbilitySounds,
  };
}
