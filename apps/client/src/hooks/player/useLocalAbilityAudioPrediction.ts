import { useCallback, useEffect, useRef } from 'react';
import {
  CHRONOS_TIMEBREAK_RELEASE_DELAY_MS,
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  CHRONOS_VERDANT_PULSE_FIRE_READY_MS,
  PHANTOM_PRIMARY_FIRE_READY_MS,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_VOID_RAY_COOLDOWN_MS,
  VOID_RAY_CHARGE_TIME,
  createEmptyInputState,
  type HeroId,
  type InputState,
} from '@voxel-strike/shared';
import { playSharedSound } from '../useAudio';
import {
  BLAZE_ROCKET_FIRE_INTERVAL,
  DRAG_HOOK_COOLDOWN,
  HOOKSHOT_FIRE_INTERVAL,
  PHANTOM_FIRE_INTERVAL,
} from './constants';
import { getLocalChronosTimebreakTempoMultiplier } from './chronosTimebreakTempo';

const LOCAL_AUDIO_PREDICTION_TTL_MS = 1500;
const HOOKSHOT_SHOT_CLIP_MS = 250;

const predictedLocalAbilitySounds = new Map<string, number>();

export function markPredictedLocalAbilitySound(abilityId: string, now = Date.now()): void {
  predictedLocalAbilitySounds.set(abilityId, now);
}

export function shouldSuppressPredictedLocalAbilitySound(abilityId: string, now = Date.now()): boolean {
  const predictedAt = predictedLocalAbilitySounds.get(abilityId);
  if (predictedAt === undefined) return false;

  if (now - predictedAt > LOCAL_AUDIO_PREDICTION_TTL_MS) {
    predictedLocalAbilitySounds.delete(abilityId);
    return false;
  }

  return true;
}

export interface LocalAbilityAudioPredictionFrame {
  now: number;
  heroId: HeroId;
  inputState: InputState;
  shadowStepTargeting: boolean;
  bombTargeting: boolean;
  grappleTrapTargeting: boolean;
  phantomPrimaryAmmo: number;
  phantomPrimaryReloading: boolean;
  canUseAbility: (abilityId: string, isUltimate: boolean, isTargetingActive?: boolean) => boolean;
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
  const chronosTimebreakReleaseTimeoutRef = useRef<number | null>(null);

  const stopPredictedPhantomVoidRayCharge = useCallback(() => {
    phantomVoidRayChargeAbortRef.current?.abort();
    phantomVoidRayChargeAbortRef.current = null;
    phantomVoidRayChargeStartedAtRef.current = 0;
    phantomVoidRayReleasePlayedRef.current = false;
  }, []);

  const clearPredictedChronosTimebreakRelease = useCallback(() => {
    if (chronosTimebreakReleaseTimeoutRef.current === null) return;
    window.clearTimeout(chronosTimebreakReleaseTimeoutRef.current);
    chronosTimebreakReleaseTimeoutRef.current = null;
  }, []);

  const resetPredictedAbilitySounds = useCallback(() => {
    previousInputRef.current = createEmptyInputState();
    currentHeroRef.current = null;
    primaryHoldStartedAtRef.current = 0;
    lastPrimarySoundAtRef.current = 0;
    lastSecondarySoundAtRef.current = 0;
    stopPredictedPhantomVoidRayCharge();
    clearPredictedChronosTimebreakRelease();
  }, [clearPredictedChronosTimebreakRelease, stopPredictedPhantomVoidRayCharge]);

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

  const playPredictedChronosTimebreak = useCallback((now: number) => {
    clearPredictedChronosTimebreakRelease();
    markPredictedLocalAbilitySound('chronos_timebreak', now);
    void playSharedSound('chronosTimebreak', {
      durationMs: Math.max(180, CHRONOS_TIMEBREAK_RELEASE_DELAY_MS),
      fadeOutMs: Math.min(140, CHRONOS_TIMEBREAK_RELEASE_DELAY_MS),
      volume: 0.72,
    });
    chronosTimebreakReleaseTimeoutRef.current = window.setTimeout(() => {
      chronosTimebreakReleaseTimeoutRef.current = null;
      void playSharedSound('chronosTimebreak', { volume: 1.05 });
    }, CHRONOS_TIMEBREAK_RELEASE_DELAY_MS);
  }, [clearPredictedChronosTimebreakRelease]);

  const updatePredictedAbilitySounds = useCallback((frame: LocalAbilityAudioPredictionFrame) => {
    const {
      now,
      heroId,
      inputState,
      shadowStepTargeting,
      bombTargeting,
      grappleTrapTargeting,
      phantomPrimaryAmmo,
      phantomPrimaryReloading,
      canUseAbility,
      canUseHookshotGrapple,
      hasChronosLifelineTarget,
    } = frame;
    const previousInput = previousInputRef.current;

    if (currentHeroRef.current !== heroId) {
      currentHeroRef.current = heroId;
      primaryHoldStartedAtRef.current = 0;
      lastPrimarySoundAtRef.current = 0;
      lastSecondarySoundAtRef.current = 0;
      stopPredictedPhantomVoidRayCharge();
      syncPredictedPhantomAmmo(phantomPrimaryAmmo);
    } else {
      syncPredictedPhantomAmmo(phantomPrimaryAmmo);
    }

    const tempoMultiplier = getLocalChronosTimebreakTempoMultiplier(now);
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
          !shadowStepTargeting &&
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
        const primaryReady = primaryHoldStartedAtRef.current > 0 &&
          now - primaryHoldStartedAtRef.current >= CHRONOS_VERDANT_PULSE_FIRE_READY_MS / tempoMultiplier;
        if (
          primaryPressed &&
          primaryReady &&
          canPlayPrimary(now, CHRONOS_VERDANT_PULSE_COOLDOWN_MS / tempoMultiplier)
        ) {
          markPredictedLocalAbilitySound('chronos_verdant_pulse', now);
          void playSharedSound('chronosPulse');
        }
        break;
      }
    }

    if (inputState.secondaryFire && !previousInput.secondaryFire) {
      if (heroId === 'phantom' && now - lastPhantomVoidRayAtRef.current >= PHANTOM_VOID_RAY_COOLDOWN_MS / tempoMultiplier) {
        startPredictedPhantomVoidRayCharge(now, VOID_RAY_CHARGE_TIME / tempoMultiplier);
      } else if (
        heroId === 'hookshot' &&
        !grappleTrapTargeting &&
        canPlaySecondary(now, DRAG_HOOK_COOLDOWN / tempoMultiplier)
      ) {
        playHookshotCastSounds('hookshot_heavy_attack', 'hookshotSecondary', 1.05);
      } else if (heroId === 'chronos') {
        markPredictedLocalAbilitySound('chronos_aegis', now);
        void playSharedSound('chronosAegis');
      }
    }

    if (heroId === 'phantom' && inputState.secondaryFire && phantomVoidRayChargeStartedAtRef.current > 0) {
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

    if (inputState.ability1 && !previousInput.ability1) {
      if (heroId === 'phantom' && !shadowStepTargeting && canUseAbility('phantom_blink', false, shadowStepTargeting)) {
        markPredictedLocalAbilitySound('phantom_blink', now);
        void playSharedSound('phantomBlink', { durationMs: 900, volume: 1.1 });
      } else if (
        heroId === 'hookshot' &&
        !grappleTrapTargeting &&
        canUseAbility('hookshot_grapple', false, shadowStepTargeting) &&
        (canUseHookshotGrapple?.() ?? false)
      ) {
        playHookshotCastSounds('hookshot_grapple', 'hookshotGrapple');
      } else if (
        heroId === 'chronos' &&
        canUseAbility('chronos_lifeline_conduit', false, shadowStepTargeting) &&
        (hasChronosLifelineTarget?.() ?? false)
      ) {
        markPredictedLocalAbilitySound('chronos_lifeline_conduit', now);
        void playSharedSound('chronosAegis', { volume: 0.65 });
      }
    }

    if (inputState.ability2 && !previousInput.ability2) {
      if (heroId === 'blaze' && canUseAbility('blaze_rocketjump', false, shadowStepTargeting)) {
        markPredictedLocalAbilitySound('blaze_rocketjump', now);
        void playSharedSound('blazeRocketJump');
      } else if (heroId === 'chronos' && canUseAbility('chronos_timebreak', false, shadowStepTargeting)) {
        playPredictedChronosTimebreak(now);
      }
    }

    if (inputState.ultimate && !previousInput.ultimate) {
      if (heroId === 'phantom' && !shadowStepTargeting && canUseAbility('phantom_veil', true, shadowStepTargeting)) {
        markPredictedLocalAbilitySound('phantom_veil', now);
        void playSharedSound('phantomVeil');
      } else if (heroId === 'blaze' && canUseAbility('blaze_airstrike', true, shadowStepTargeting)) {
        markPredictedLocalAbilitySound('blaze_airstrike', now);
        void playSharedSound('blazeAirstrike');
      } else if (heroId === 'hookshot' && canUseAbility('hookshot_grapple_trap', true, grappleTrapTargeting)) {
        playHookshotCastSounds('hookshot_grapple_trap', 'hookshotTrap', 1.15);
      }
    }

    previousInputRef.current = inputState;
  }, [
    canPlayPrimary,
    canPlaySecondary,
    playPredictedChronosTimebreak,
    startPredictedPhantomVoidRayCharge,
    stopPredictedPhantomVoidRayCharge,
    syncPredictedPhantomAmmo,
  ]);

  return {
    resetPredictedAbilitySounds,
    updatePredictedAbilitySounds,
  };
}
