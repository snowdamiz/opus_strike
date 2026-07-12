import {
  PHANTOM_NIGHTREIGN_BLINK_REDUCTION_SECONDS,
  PHANTOM_NIGHTREIGN_DURATION_SECONDS,
  PHANTOM_NIGHTREIGN_KILL_EXTENSION_SECONDS,
  PHANTOM_NIGHTREIGN_LIFESTEAL_RATIO,
} from '../constants/heroes.js';

export interface PhantomNightreignAbilityState {
  isActive: boolean;
  activatedAt?: number;
}

export interface PhantomNightreignBlinkState {
  cooldownRemaining: number;
}

export interface PhantomNightreignCombatant {
  health: number;
  maxHealth: number;
}

export interface ApplyPhantomNightreignHitInput {
  source: PhantomNightreignCombatant;
  nightreign: PhantomNightreignAbilityState | null | undefined;
  blink: PhantomNightreignBlinkState | null | undefined;
  appliedDamage: number;
  killed: boolean;
  now: number;
}

export interface PhantomNightreignHitResult {
  applied: boolean;
  healed: number;
  blinkCooldownReducedBy: number;
  durationExtendedByMs: number;
}

export function isPhantomNightreignActive(
  state: PhantomNightreignAbilityState | null | undefined,
  now: number,
): boolean {
  if (!state?.isActive) return false;
  if (!Number.isFinite(state.activatedAt)) return false;
  return now - (state.activatedAt ?? 0) < PHANTOM_NIGHTREIGN_DURATION_SECONDS * 1000;
}

export function applyPhantomNightreignHit(
  input: ApplyPhantomNightreignHitInput,
): PhantomNightreignHitResult {
  if (input.appliedDamage <= 0 || !isPhantomNightreignActive(input.nightreign, input.now)) {
    return {
      applied: false,
      healed: 0,
      blinkCooldownReducedBy: 0,
      durationExtendedByMs: 0,
    };
  }

  const missingHealth = Math.max(0, input.source.maxHealth - input.source.health);
  const healed = Math.min(
    missingHealth,
    Math.max(1, Math.round(input.appliedDamage * PHANTOM_NIGHTREIGN_LIFESTEAL_RATIO)),
  );
  input.source.health += healed;

  const previousBlinkCooldown = Math.max(0, input.blink?.cooldownRemaining ?? 0);
  if (input.blink) {
    input.blink.cooldownRemaining = Math.max(
      0,
      previousBlinkCooldown - PHANTOM_NIGHTREIGN_BLINK_REDUCTION_SECONDS,
    );
  }

  const durationExtendedByMs = input.killed
    ? PHANTOM_NIGHTREIGN_KILL_EXTENSION_SECONDS * 1000
    : 0;
  if (durationExtendedByMs > 0 && input.nightreign) {
    input.nightreign.activatedAt = (input.nightreign.activatedAt ?? input.now) + durationExtendedByMs;
  }

  return {
    applied: true,
    healed,
    blinkCooldownReducedBy: previousBlinkCooldown - (input.blink?.cooldownRemaining ?? 0),
    durationExtendedByMs,
  };
}
