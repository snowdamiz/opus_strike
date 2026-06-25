import {
  createTeamCountMap,
  getPlayerRole,
  isTeamId,
  type PlayerRole,
  type PublicRankSnapshot,
  type Team,
} from '@voxel-strike/shared';
import { buildRoomRankSnapshot, type RoomRankState } from './roomRankSnapshot';

export interface LobbyRosterPlayer extends RoomRankState {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  role?: string;
  team: string;
  heroId: string;
  skinId?: string;
  isBot: boolean;
  botDifficulty: string;
  botProfileId: string;
}

export interface LobbyPlayerSnapshot {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  role: PlayerRole;
  team: string;
  heroId: string;
  skinId?: string;
  isBot: boolean;
  botDifficulty: string;
  botProfileId: string;
  rank: PublicRankSnapshot;
}

export interface LobbyRosterCounts {
  human: number;
  lobbyHuman: number;
  bot: number;
  observer: number;
  combatParticipant: number;
  team: Record<Team, number>;
}

export function isLobbyObserver(player: Pick<LobbyRosterPlayer, 'role'>): boolean {
  return getPlayerRole(player) === 'observer';
}

export function buildLobbyPlayerSnapshots(
  players: Iterable<readonly [string, LobbyRosterPlayer]>
): LobbyPlayerSnapshot[] {
  const snapshots: LobbyPlayerSnapshot[] = [];
  for (const [id, player] of players) {
    snapshots.push({
      id,
      name: player.name,
      isHost: player.isHost,
      isReady: player.isReady,
      role: getPlayerRole(player),
      team: player.team,
      heroId: player.heroId,
      skinId: player.skinId || '',
      isBot: player.isBot,
      botDifficulty: player.botDifficulty,
      botProfileId: player.botProfileId,
      rank: buildRoomRankSnapshot(player),
    });
  }
  return snapshots;
}

export function countLobbyTeamMembers(
  players: Iterable<LobbyRosterPlayer>,
  team: string
): number {
  if (!isTeamId(team)) return 0;

  let count = 0;
  for (const player of players) {
    if (isLobbyObserver(player)) continue;
    if (player.team === team) count++;
  }
  return count;
}

export function countLobbyTeamMembersExcluding(
  players: Iterable<readonly [string, LobbyRosterPlayer]>,
  team: string,
  excludedPlayerId: string
): number {
  if (!isTeamId(team)) return 0;

  let count = 0;
  for (const [playerId, player] of players) {
    if (isLobbyObserver(player)) continue;
    if (playerId !== excludedPlayerId && player.team === team) {
      count++;
    }
  }
  return count;
}

export function countLobbyRoster(
  players: Iterable<readonly [string, LobbyRosterPlayer]>
): LobbyRosterCounts {
  const counts: LobbyRosterCounts = {
    human: 0,
    lobbyHuman: 0,
    bot: 0,
    observer: 0,
    combatParticipant: 0,
    team: createTeamCountMap(),
  };

  for (const [, player] of players) {
    if (player.isBot) {
      counts.bot++;
    } else {
      counts.lobbyHuman++;
    }

    if (isLobbyObserver(player)) {
      counts.observer++;
      continue;
    }

    counts.combatParticipant++;
    if (!player.isBot) counts.human++;
    if (isTeamId(player.team)) counts.team[player.team] = (counts.team[player.team] ?? 0) + 1;
  }

  return counts;
}
