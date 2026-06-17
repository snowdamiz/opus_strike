import {
  ALL_HERO_IDS,
  pickAvailableTeamHero,
  isTeamHeroAvailable as isSharedTeamHeroAvailable,
  type HeroId,
  type Team,
} from '@voxel-strike/shared';

export interface RoomHeroLockParticipant {
  id: string;
  team?: string | null;
  heroId?: string | null;
  isObserver?: boolean | null;
}

function isRoomHeroTeam(team: string | null | undefined): team is Team {
  return team === 'red' || team === 'blue';
}

export function getRoomHeroLockParticipants(
  players: Iterable<RoomHeroLockParticipant>,
  npcIds: ReadonlySet<string>
): RoomHeroLockParticipant[] {
  const participants: RoomHeroLockParticipant[] = [];
  for (const player of players) {
    if (!npcIds.has(player.id)) {
      participants.push(player);
    }
  }
  return participants;
}

export function isPlayerTeamHeroAvailable(input: {
  players: Iterable<RoomHeroLockParticipant>;
  team?: string | null;
  heroId: HeroId;
  playerId?: string | null;
}): boolean {
  if (!isRoomHeroTeam(input.team)) return true;
  return isSharedTeamHeroAvailable(input.players, input.team, input.heroId, input.playerId);
}

export function selectAvailableRoomHero(input: {
  players: Iterable<RoomHeroLockParticipant>;
  team?: string | null;
  playerId?: string | null;
  random?: () => number;
}): HeroId {
  const random = input.random ?? Math.random;
  if (isRoomHeroTeam(input.team)) {
    return pickAvailableTeamHero(input.players, input.team, input.playerId, random) ?? 'phantom';
  }
  return ALL_HERO_IDS[Math.floor(random() * ALL_HERO_IDS.length)] ?? 'phantom';
}
