import { ALL_HERO_IDS } from '../constants/heroes.js';
import type { HeroId } from '../types/hero.js';
import type { Team } from '../types/player.js';

export interface TeamHeroLockPlayer {
  id: string;
  team?: string | null;
  heroId?: string | null;
}

export function isKnownHeroId(heroId: string | null | undefined): heroId is HeroId {
  return typeof heroId === 'string' && (ALL_HERO_IDS as readonly string[]).includes(heroId);
}

export function getPickedTeamHeroIds(
  players: Iterable<TeamHeroLockPlayer>,
  team: Team,
  exceptPlayerId?: string | null
): Set<HeroId> {
  const picked = new Set<HeroId>();

  for (const player of players) {
    if (player.id === exceptPlayerId || player.team !== team) continue;
    if (isKnownHeroId(player.heroId)) {
      picked.add(player.heroId);
    }
  }

  return picked;
}

export function isTeamHeroAvailable(
  players: Iterable<TeamHeroLockPlayer>,
  team: Team,
  heroId: HeroId,
  exceptPlayerId?: string | null
): boolean {
  return !getPickedTeamHeroIds(players, team, exceptPlayerId).has(heroId);
}

export function getAvailableTeamHeroes(
  players: Iterable<TeamHeroLockPlayer>,
  team: Team,
  exceptPlayerId?: string | null
): HeroId[] {
  const picked = getPickedTeamHeroIds(players, team, exceptPlayerId);
  return ALL_HERO_IDS.filter((heroId) => !picked.has(heroId));
}

export function pickAvailableTeamHero(
  players: Iterable<TeamHeroLockPlayer>,
  team: Team,
  exceptPlayerId?: string | null,
  random = Math.random
): HeroId | null {
  const available = getAvailableTeamHeroes(players, team, exceptPlayerId);
  if (available.length === 0) return null;

  const rawIndex = Math.floor(random() * available.length);
  const index = Math.max(0, Math.min(available.length - 1, rawIndex));
  return available[index] ?? null;
}
