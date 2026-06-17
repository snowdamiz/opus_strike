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
  team: string;
  isObserver: boolean;
  heroId: string;
  isBot: boolean;
  botDifficulty: string;
  botProfileId: string;
  rank: ReturnType<typeof buildRoomRankSnapshot>;
  paymentStatus: string;
  paymentWalletAddress?: string;
  depositSignature?: string;
  refundSignature?: string;
}

export interface LobbyStatePayload {
  lobbyId: string;
  name: string;
  matchMode: string;
  gameplayMode: string;
  hostId: string;
  status: string;
  players: LobbyPlayerSnapshot[];
  maxPlayers: number;
  maxParticipants: number;
  observersEnabled: boolean;
  maxObservers: number;
  observerCount: number;
  humanCount: number;
  botCount: number;
  wager: Record<string, unknown>;
  requiredPlayers: number | undefined;
  [key: string]: unknown;
}

export interface BuildLobbyStatePayloadInput {
  lobbyId: string;
  name: string;
  matchMode: string;
  gameplayMode: string;
  hostId: string;
  status: string;
  players: Iterable<readonly [string, LobbyRosterPlayer]>;
  maxPlayers: number;
  maxParticipants: number;
  observersEnabled: boolean;
  maxObservers: number;
  wager: Record<string, unknown>;
  requiredPlayers: number | undefined;
  matchmakingStatus?: Record<string, unknown>;
}

export function buildLobbyPlayerJoinedPayload(
  playerId: string,
  player: LobbyRosterPlayer,
  options: { includePaymentDetails?: boolean } = {}
): LobbyPlayerJoinedPayload {
  const includePaymentDetails = options.includePaymentDetails ?? true;
  const payload: LobbyPlayerJoinedPayload = {
    playerId,
    playerName: player.name,
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
  };

  if (includePaymentDetails) {
    payload.paymentWalletAddress = player.paymentWalletAddress;
    payload.depositSignature = player.depositSignature;
    payload.refundSignature = player.refundSignature;
  }

  return payload;
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
    hostId: input.hostId,
    status: input.status,
    players: buildLobbyPlayerSnapshots(playerEntries),
    maxPlayers: input.maxPlayers,
    maxParticipants: input.maxParticipants,
    observersEnabled: input.observersEnabled,
    maxObservers: input.maxObservers,
    observerCount: rosterCounts.observer,
    humanCount: rosterCounts.human,
    botCount: rosterCounts.bot,
    wager: input.wager,
    requiredPlayers: input.requiredPlayers,
    ...input.matchmakingStatus,
  };
}
