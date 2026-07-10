import {
  ABILITY_DEFINITIONS,
  BLAZE_ABILITY_SKILLS,
  DEFAULT_BLAZE_ULTIMATE_SKILL,
  HERO_DEFINITIONS,
  getBlazeUltimateAbilityId,
  type AbilityState,
  type BlazeUltimateSkill,
  type HeroId,
} from '@voxel-strike/shared';

export function createPracticeAbilityStates(
  heroId: HeroId,
  blazeUltimateSkill: BlazeUltimateSkill = DEFAULT_BLAZE_ULTIMATE_SKILL,
): Record<string, AbilityState> {
  const heroDef = HERO_DEFINITIONS[heroId];
  const states: Record<string, AbilityState> = {};

  const abilityIds = heroId === 'blaze'
    ? [...BLAZE_ABILITY_SKILLS, getBlazeUltimateAbilityId(blazeUltimateSkill)]
    : [heroDef.ability1.abilityId, heroDef.ability2.abilityId, heroDef.ultimate.abilityId];

  for (const abilityId of abilityIds) {
    const abilityDef = ABILITY_DEFINITIONS[abilityId];
    if (!abilityDef) continue;

    states[abilityId] = {
      abilityId,
      cooldownRemaining: 0,
      cooldownUntil: 0,
      charges: abilityDef.charges ?? 1,
      isActive: false,
      activatedAt: 0,
    };
  }

  return states;
}
