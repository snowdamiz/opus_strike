import type { HeroId } from '../types/hero.js';
import { isKnownHeroId } from './teamHeroLocks.js';

export interface PartyHeroLockMember {
  userId: string;
  heroId?: string | null;
  isBot?: boolean | null;
}

export interface DuplicatePartyHeroOptions {
  includeBots?: boolean;
}

export function getHumanPartyHeroIds(
  members: Iterable<PartyHeroLockMember>,
  exceptUserId?: string | null
): Set<HeroId> {
  const picked = new Set<HeroId>();

  for (const member of members) {
    if (member.isBot || member.userId === exceptUserId) continue;
    if (isKnownHeroId(member.heroId)) {
      picked.add(member.heroId);
    }
  }

  return picked;
}

export function isHumanPartyHeroAvailable(
  members: Iterable<PartyHeroLockMember>,
  heroId: HeroId,
  exceptUserId?: string | null
): boolean {
  return !getHumanPartyHeroIds(members, exceptUserId).has(heroId);
}

export function getDuplicatePartyHeroIds(
  members: Iterable<PartyHeroLockMember>,
  options: DuplicatePartyHeroOptions = {}
): Set<HeroId> {
  const includeBots = options.includeBots ?? true;
  const picked = new Set<HeroId>();
  const duplicates = new Set<HeroId>();

  for (const member of members) {
    if (!includeBots && member.isBot) continue;
    if (!isKnownHeroId(member.heroId)) continue;
    if (picked.has(member.heroId)) {
      duplicates.add(member.heroId);
      continue;
    }
    picked.add(member.heroId);
  }

  return duplicates;
}

export function hasDuplicatePartyHeroes(
  members: Iterable<PartyHeroLockMember>,
  options?: DuplicatePartyHeroOptions
): boolean {
  return getDuplicatePartyHeroIds(members, options).size > 0;
}
