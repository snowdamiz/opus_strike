import type { PublicRankSnapshot, Team } from '@voxel-strike/shared';
import { buildRoomRankSnapshot, type RoomRankState } from './roomRankSnapshot';

export interface LobbyRosterPlayer extends RoomRankState {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  team: string;
  isObserver: boolean;
  heroId: string;
  isBot: boolean;
  botDifficulty: string;
  botProfileId: string;
  paymentStatus: string;
  paymentWalletAddress: string;
  depositSignature: string;
  refundSignature: string;
}

export interface LobbyPlayerSnapshot {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  team: string;
  isObserver: boolean;
  heroId: string;
  isBot: boolean;
  botDifficulty: string;
  botProfileId: string;
  rank: PublicRankSnapshot;
  paymentStatus: string;
  paymentWalletAddress: string;
  depositSignature: string;
  refundSignature: string;
}

export interface LobbyRosterCounts {
  human: number;
  lobbyHuman: number;
  bot: number;
  observer: number;
  combatParticipant: number;
  team: Record<Team, number>;
  paidHuman: number;
  paidHumanByTeam: Record<Team, number>;
}

function isTeamValue(team: string): team is Team {
  return team === 'red' || team === 'blue';
}

function isPaidHuman(player: LobbyRosterPlayer): boolean {
  return !player.isBot
    && !player.isObserver
    && (player.paymentStatus === 'credited' || player.paymentStatus === 'settled');
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
      team: player.team,
      isObserver: player.isObserver,
      heroId: player.heroId,
      isBot: player.isBot,
      botDifficulty: player.botDifficulty,
      botProfileId: player.botProfileId,
      rank: buildRoomRankSnapshot(player),
      paymentStatus: player.paymentStatus,
      paymentWalletAddress: player.paymentWalletAddress,
      depositSignature: player.depositSignature,
      refundSignature: player.refundSignature,
    });
  }
  return snapshots;
}

export function countLobbyTeamMembers(
  players: Iterable<LobbyRosterPlayer>,
  team: string
): number {
  if (!isTeamValue(team)) return 0;

  let count = 0;
  for (const player of players) {
    if (!player.isObserver && player.team === team) count++;
  }
  return count;
}

export function countLobbyTeamMembersExcluding(
  players: Iterable<readonly [string, LobbyRosterPlayer]>,
  team: string,
  excludedPlayerId: string
): number {
  if (!isTeamValue(team)) return 0;

  let count = 0;
  for (const [playerId, player] of players) {
    if (playerId !== excludedPlayerId && !player.isObserver && player.team === team) {
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
    team: { red: 0, blue: 0 },
    paidHuman: 0,
    paidHumanByTeam: { red: 0, blue: 0 },
  };

  for (const [, player] of players) {
    if (player.isBot) {
      counts.bot++;
    } else {
      counts.lobbyHuman++;
    }

    if (player.isObserver) {
      counts.observer++;
    } else {
      counts.combatParticipant++;
      if (!player.isBot) counts.human++;
      if (isTeamValue(player.team)) counts.team[player.team]++;
    }

    if (isPaidHuman(player)) {
      counts.paidHuman++;
      if (isTeamValue(player.team)) counts.paidHumanByTeam[player.team]++;
    }
  }

  return counts;
}
