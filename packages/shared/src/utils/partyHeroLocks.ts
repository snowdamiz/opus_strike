import type { HeroId } from '../types/hero.js';
import { isKnownHeroId } from './teamHeroLocks.js';

export interface PartyHeroLockMember {
  userId: string;
  heroId?: string | null;
  isBot?: boolean | null;
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
