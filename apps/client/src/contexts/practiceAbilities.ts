import {
  ABILITY_DEFINITIONS,
  HERO_DEFINITIONS,
  type AbilityState,
  type HeroId,
} from '@voxel-strike/shared';

export function createPracticeAbilityStates(heroId: HeroId): Record<string, AbilityState> {
  const heroDef = HERO_DEFINITIONS[heroId];
  const states: Record<string, AbilityState> = {};

  for (const slot of [heroDef.ability1, heroDef.ability2, heroDef.ultimate]) {
    const abilityDef = ABILITY_DEFINITIONS[slot.abilityId];
    if (!abilityDef) continue;

    states[slot.abilityId] = {
      abilityId: slot.abilityId,
      cooldownRemaining: 0,
      cooldownUntil: 0,
      charges: abilityDef.charges ?? 1,
      isActive: false,
      activatedAt: 0,
    };
  }

  return states;
}
