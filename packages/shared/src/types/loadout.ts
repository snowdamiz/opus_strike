export const BLAZE_PRIMARY_SKILLS = ['fireball_rockets', 'scrapshot'] as const;

export type BlazePrimarySkill = (typeof BLAZE_PRIMARY_SKILLS)[number];

export const DEFAULT_BLAZE_PRIMARY_SKILL: BlazePrimarySkill = 'fireball_rockets';

export function isBlazePrimarySkill(value: unknown): value is BlazePrimarySkill {
  return typeof value === 'string' && BLAZE_PRIMARY_SKILLS.includes(value as BlazePrimarySkill);
}

export const BLAZE_SECONDARY_SKILLS = ['meteor_strike', 'phosphor_flare'] as const;

export type BlazeSecondarySkill = (typeof BLAZE_SECONDARY_SKILLS)[number];

export const DEFAULT_BLAZE_SECONDARY_SKILL: BlazeSecondarySkill = 'meteor_strike';

export function isBlazeSecondarySkill(value: unknown): value is BlazeSecondarySkill {
  return typeof value === 'string' && BLAZE_SECONDARY_SKILLS.includes(value as BlazeSecondarySkill);
}

export const BLAZE_ULTIMATE_SKILLS = ['infernal_gearstorm', 'phoenix_dive'] as const;

export type BlazeUltimateSkill = (typeof BLAZE_ULTIMATE_SKILLS)[number];

export const DEFAULT_BLAZE_ULTIMATE_SKILL: BlazeUltimateSkill = 'infernal_gearstorm';

export function isBlazeUltimateSkill(value: unknown): value is BlazeUltimateSkill {
  return typeof value === 'string' && BLAZE_ULTIMATE_SKILLS.includes(value as BlazeUltimateSkill);
}

export function getBlazeUltimateAbilityId(
  skill: BlazeUltimateSkill
): 'blaze_airstrike' | 'blaze_phoenix_dive' {
  return skill === 'phoenix_dive' ? 'blaze_phoenix_dive' : 'blaze_airstrike';
}

export const BLAZE_ABILITY_SKILLS = [
  'blaze_flamethrower',
  'blaze_rocketjump',
  'blaze_afterburner',
] as const;

export type BlazeAbilitySkill = (typeof BLAZE_ABILITY_SKILLS)[number];

export interface BlazeAbilityBindings {
  ability1: BlazeAbilitySkill;
  ability2: BlazeAbilitySkill;
}

export function isBlazeAbilitySkill(value: unknown): value is BlazeAbilitySkill {
  return typeof value === 'string' && BLAZE_ABILITY_SKILLS.includes(value as BlazeAbilitySkill);
}

export function isBlazeAbilityBindings(value: unknown): value is BlazeAbilityBindings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BlazeAbilityBindings>;
  return (
    isBlazeAbilitySkill(candidate.ability1) &&
    isBlazeAbilitySkill(candidate.ability2) &&
    candidate.ability1 !== candidate.ability2
  );
}

export function hasBlazeAfterburner(bindings: BlazeAbilityBindings): boolean {
  return bindings.ability1 === 'blaze_afterburner' || bindings.ability2 === 'blaze_afterburner';
}
