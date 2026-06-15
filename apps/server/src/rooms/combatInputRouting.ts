import type { HeroId, PlayerInput } from '@voxel-strike/shared';

const HEROES_WITH_GENERIC_SECONDARY_ATTACK = new Set<HeroId>(['hookshot']);

export function shouldResolveGenericSecondaryAttack(
  heroId: string | null | undefined,
  input: Pick<PlayerInput, 'secondaryFire'>,
  previousSecondaryFire: boolean,
  suppressSecondaryAttack: boolean
): boolean {
  return (
    !suppressSecondaryAttack &&
    input.secondaryFire &&
    !previousSecondaryFire &&
    HEROES_WITH_GENERIC_SECONDARY_ATTACK.has(heroId as HeroId)
  );
}
