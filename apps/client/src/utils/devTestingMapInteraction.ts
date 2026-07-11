import {
  DEV_TESTING_MAP_PROFILE_ID,
  HERO_DEFINITIONS,
  createDefaultPlayerMovementState,
  getDevTestingHeroLineup,
  getDefaultHeroSkinId,
  getHeroStats,
  type HeroId,
  type BlazeUltimateSkill,
  type MapProfileId,
  type Player,
  type VoxelMapManifest,
  type Vec3,
} from '@voxel-strike/shared';
import { createPracticeAbilityStates } from './practiceAbilityStates';

export const DEV_TESTING_HERO_INTERACTION_RADIUS = 2.4;

export interface DevTestingHeroInteraction {
  heroId: HeroId;
  label: string;
}

export function isDevTestingMapProfileId(mapProfileId: MapProfileId | string | null | undefined): boolean {
  return mapProfileId === DEV_TESTING_MAP_PROFILE_ID;
}

function horizontalDistanceSq(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function getDevTestingHeroInteraction(
  manifest: VoxelMapManifest,
  position: Vec3,
  currentHeroId: HeroId | null | undefined
): DevTestingHeroInteraction | null {
  const maxDistanceSq = DEV_TESTING_HERO_INTERACTION_RADIUS * DEV_TESTING_HERO_INTERACTION_RADIUS;
  let best: DevTestingHeroInteraction | null = null;
  let bestDistanceSq = maxDistanceSq;

  for (const entry of getDevTestingHeroLineup(manifest)) {
    if (entry.heroId === currentHeroId) continue;

    const distanceSq = horizontalDistanceSq(position, entry.position);
    if (distanceSq <= bestDistanceSq) {
      bestDistanceSq = distanceSq;
      best = {
        heroId: entry.heroId,
        label: HERO_DEFINITIONS[entry.heroId].name,
      };
    }
  }

  return best;
}

export function createDevTestingHeroSwitchUpdates(
  localPlayer: Player,
  heroId: HeroId,
  blazeUltimateSkill?: BlazeUltimateSkill,
): Partial<Player> {
  const heroStats = getHeroStats(heroId);

  return {
    heroId,
    skinId: getDefaultHeroSkinId(heroId),
    state: 'alive',
    health: heroStats.maxHealth,
    maxHealth: heroStats.maxHealth,
    downedHealth: null,
    downedMaxHealth: null,
    downedStartedAt: null,
    downedRemainingMs: null,
    downedExpiresAt: null,
    reviveStartedAt: null,
    reviveCompletesAt: null,
    reviveByPlayerId: null,
    ultimateCharge: 100,
    onFireUntil: null,
    powerupBoostUntil: null,
    movement: createDefaultPlayerMovementState({
      isGrounded: localPlayer.movement.isGrounded,
      jetpackFuel: 100,
    }),
    abilities: createPracticeAbilityStates(heroId, blazeUltimateSkill),
    hasFlag: false,
    spawnProtectionUntil: Date.now() + 250,
  };
}
