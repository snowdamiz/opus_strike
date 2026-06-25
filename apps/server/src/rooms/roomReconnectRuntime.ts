import { isTeamId, type HeroId, type PlayerRole, type Team } from '@voxel-strike/shared';
import { isHeroId } from './protocolValidation';

const RUNNING_GAME_RECONNECT_TTL_MS = 60_000;

export interface RunningGameReconnectState {
  lobbyId: string | null;
  matchCancelled: boolean;
  phase: string;
}

export interface RunningGameReconnectTicketRequest {
  userId: string;
  lobbyId: string;
  gameRoomId: string;
  issuedAt: number;
  ttlMs: number;
}

export interface ReconnectParticipantPlayerSnapshot {
  id: string;
  name?: string | null;
  role?: string | null;
  team: string;
  heroId?: unknown;
}

export interface ReconnectParticipantSyncPayload {
  sessionId: string;
  displayName?: string | null;
  role?: PlayerRole;
  assignedTeam?: Team;
  selectedHero?: HeroId;
}

export function canAcceptRunningGameReconnect(state: RunningGameReconnectState): boolean {
  return Boolean(state.lobbyId) && !state.matchCancelled && state.phase !== 'game_end';
}

export function buildRunningGameReconnectTicketRequest(input: RunningGameReconnectState & {
  reconnectToRunningGame?: boolean;
  userId: string;
  gameRoomId: string;
  now: number;
}): RunningGameReconnectTicketRequest | null {
  if (input.reconnectToRunningGame !== true || !canAcceptRunningGameReconnect(input) || !input.lobbyId) {
    return null;
  }

  return {
    userId: input.userId,
    lobbyId: input.lobbyId,
    gameRoomId: input.gameRoomId,
    issuedAt: input.now,
    ttlMs: RUNNING_GAME_RECONNECT_TTL_MS,
  };
}

export function buildReconnectParticipantSyncPayload(
  player: ReconnectParticipantPlayerSnapshot
): ReconnectParticipantSyncPayload {
  const assignedTeam = isTeamId(player.team) ? player.team : undefined;
  const selectedHero = isHeroId(player.heroId) ? player.heroId : undefined;

  return {
    sessionId: player.id,
    displayName: player.name,
    role: player.role === 'observer' ? 'observer' : 'combat',
    ...(assignedTeam ? { assignedTeam } : {}),
    ...(selectedHero ? { selectedHero } : {}),
  };
}
