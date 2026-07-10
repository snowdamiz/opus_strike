import {
  ABILITY_DEFINITIONS,
  BLAZE_ABILITY_SKILLS,
  HERO_DEFINITIONS,
  type AbilityState,
  type HeroId,
} from '@voxel-strike/shared';

export function createPracticeAbilityStates(heroId: HeroId): Record<string, AbilityState> {
  const heroDef = HERO_DEFINITIONS[heroId];
  const states: Record<string, AbilityState> = {};

  const abilityIds = heroId === 'blaze'
    ? [...BLAZE_ABILITY_SKILLS, heroDef.ultimate.abilityId]
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
