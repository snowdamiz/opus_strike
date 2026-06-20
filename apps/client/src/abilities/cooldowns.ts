import type { AbilityDefinition } from '@voxel-strike/shared';

const PHANTOM_BLINK_ABILITY_ID = 'phantom_blink';
const PHANTOM_BLINK_COOLDOWN_SECONDS = 10;

export interface AbilityCooldownState {
  cooldownRemaining?: number;
  cooldownUntil?: number;
}

export function getAbilityMaxCharges(abilityDef: Pick<AbilityDefinition, 'charges'> | undefined): number {
  return abilityDef?.charges || 1;
}

export function getAbilityCooldownSeconds(
  abilityId: string,
  abilityDef: Pick<AbilityDefinition, 'cooldown'> | undefined,
  fallbackSeconds = 0
): number {
  if (abilityId === PHANTOM_BLINK_ABILITY_ID) return PHANTOM_BLINK_COOLDOWN_SECONDS;
  return abilityDef?.cooldown ?? fallbackSeconds;
}

export function getAbilityCooldownRemainingSeconds(
  abilityState: AbilityCooldownState | undefined,
  now: number
): number {
  if (!abilityState) return 0;
  if (abilityState.cooldownUntil && abilityState.cooldownUntil > now) {
    return Math.max(0, (abilityState.cooldownUntil - now) / 1000);
  }
  if (abilityState.cooldownUntil !== undefined) return 0;
  return Math.max(0, abilityState.cooldownRemaining ?? 0);
}

export function getHudAbilityCooldownSeconds({
  now,
  isUltimate,
  canTrackAbility,
  showActiveTimer,
  clientCooldownEnd,
  serverCooldownUntil,
  serverCooldownRemaining,
}: {
  now: number;
  isUltimate: boolean;
  canTrackAbility: boolean;
  showActiveTimer: boolean;
  clientCooldownEnd?: number;
  serverCooldownUntil?: number;
  serverCooldownRemaining?: number;
}): number {
  if (isUltimate || !canTrackAbility || showActiveTimer) return 0;

  if (clientCooldownEnd && clientCooldownEnd > now) {
    return Math.max(0, (clientCooldownEnd - now) / 1000);
  }

  return getAbilityCooldownRemainingSeconds({
    cooldownUntil: serverCooldownUntil,
    cooldownRemaining: serverCooldownRemaining,
  }, now);
}

export function getDisplayAbilityCharges({
  maxCharges,
  serverCharges,
  clientCharges,
  clientCooldownEnd,
  now,
}: {
  maxCharges: number;
  serverCharges: number;
  clientCharges?: number;
  clientCooldownEnd?: number;
  now: number;
}): number {
  const charges = clientCharges !== undefined ? clientCharges : serverCharges;
  if (maxCharges > 1 && clientCooldownEnd && now >= clientCooldownEnd && charges === 0) {
    return maxCharges;
  }
  return charges;
}

export function normalizeServerAbilityCooldown(
  ability: { cooldownUntil?: number; cooldownRemaining?: number },
  serverTime: number,
  now = Date.now()
): { cooldownRemaining: number; cooldownUntil: number } {
  const serverCooldownUntil = Number.isFinite(ability.cooldownUntil)
    ? ability.cooldownUntil ?? 0
    : Number.isFinite(ability.cooldownRemaining)
      ? serverTime + Math.max(0, ability.cooldownRemaining || 0) * 1000
      : 0;
  const cooldownRemainingMs = Math.max(0, serverCooldownUntil - serverTime);

  return {
    cooldownRemaining: cooldownRemainingMs / 1000,
    cooldownUntil: cooldownRemainingMs > 0 ? now + cooldownRemainingMs : 0,
  };
}
