import {
  buildLobbyPlayerSnapshots,
  countLobbyRoster,
  type LobbyPlayerSnapshot,
  type LobbyRosterPlayer,
} from './lobbyRoster';
import { buildRoomRankSnapshot } from './roomRankSnapshot';

export interface LobbyPlayerJoinedPayload {
  playerId: string;
  playerName: string;
  isHost: boolean;
  isReady: boolean;
  role: string;
  team: string;
  heroId: string;
  skinId: string;
  isBot: boolean;
  botDifficulty: string;
  botProfileId: string;
  rank: ReturnType<typeof buildRoomRankSnapshot>;
}

export interface LobbyStatePayload {
  lobbyId: string;
  name: string;
  matchMode: string;
  gameplayMode: string;
  matchPerspective: string;
  hostId: string;
  status: string;
  players: LobbyPlayerSnapshot[];
  maxPlayers: number;
  maxParticipants: number;
  humanCount: number;
  botCount: number;
  requiredPlayers: number | undefined;
  wager?: unknown;
  wagerPaymentStatuses?: unknown[];
  [key: string]: unknown;
}

export interface BuildLobbyStatePayloadInput {
  lobbyId: string;
  name: string;
  matchMode: string;
  gameplayMode: string;
  matchPerspective: string;
  hostId: string;
  status: string;
  players: Iterable<readonly [string, LobbyRosterPlayer]>;
  maxPlayers: number;
  maxParticipants: number;
  requiredPlayers: number | undefined;
  matchmakingStatus?: Record<string, unknown>;
  wager?: unknown;
  wagerPaymentStatuses?: unknown[];
}

export function buildLobbyPlayerJoinedPayload(
  playerId: string,
  player: LobbyRosterPlayer
): LobbyPlayerJoinedPayload {
  return {
    playerId,
    playerName: player.name,
    isHost: player.isHost,
    isReady: player.isReady,
    role: player.role === 'observer' ? 'observer' : 'combat',
    team: player.team,
    heroId: player.heroId,
    skinId: player.skinId || '',
    isBot: player.isBot,
    botDifficulty: player.botDifficulty,
    botProfileId: player.botProfileId,
    rank: buildRoomRankSnapshot(player),
  };
}

export function buildLobbyStatePayload(
  input: BuildLobbyStatePayloadInput
): LobbyStatePayload {
  const playerEntries = Array.from(input.players);
  const rosterCounts = countLobbyRoster(playerEntries);
  return {
    lobbyId: input.lobbyId,
    name: input.name,
    matchMode: input.matchMode,
    gameplayMode: input.gameplayMode,
    matchPerspective: input.matchPerspective,
    hostId: input.hostId,
    status: input.status,
    players: buildLobbyPlayerSnapshots(playerEntries),
    maxPlayers: input.maxPlayers,
    maxParticipants: input.maxParticipants,
    humanCount: rosterCounts.human,
    botCount: rosterCounts.bot,
    requiredPlayers: input.requiredPlayers,
    wager: input.wager,
    wagerPaymentStatuses: input.wagerPaymentStatuses ?? [],
    ...input.matchmakingStatus,
  };
}
