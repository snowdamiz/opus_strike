import type { AntiCheatSignalInput } from '../anticheat';
import type { CreatePlayerReportInput } from '../reports/playerReportService';
import { normalizePlayerReportReason } from '../reports/playerReportReason';
import { isRecord, sanitizeShortText } from './protocolValidation';

export type PlayerReportResult = { ok: true; reportId: string } | { ok: false; error: string };
export type PlayerReportResultPayload = { requestId: string | null } & PlayerReportResult;
export type AcceptedPlayerReportPayload = Extract<ParsedPlayerReportPayload, { ok: true }>;
export type PlayerReportEvidenceInput = Omit<
  AntiCheatSignalInput,
  'roomId' | 'matchId' | 'lobbyId' | 'matchMode' | 'serverTick' | 'serverTime'
>;

export interface PlayerReportParticipantSnapshot {
  id: string;
  name: string;
  team: string | null;
  heroId: string | null;
  isBot: boolean;
  isNpc: boolean;
  userId: string | null;
  stats: {
    kills: number;
    deaths: number;
    assists: number;
    flagCaptures: number;
    flagReturns: number;
  };
  position: {
    x: number;
    y: number;
    z: number;
  };
}

export type AuthenticatedPlayerReportParticipant = PlayerReportParticipantSnapshot & { userId: string };

export interface PlayerReportRoomSnapshot {
  roomId: string;
  matchId: string | null;
  lobbyId: string | null;
  matchMode: CreatePlayerReportInput['matchMode'];
  mapSeed: number | null;
  serverTick: number;
}

export type PlayerReportContextValidation =
  | {
      ok: true;
      reporter: AuthenticatedPlayerReportParticipant;
      target: AuthenticatedPlayerReportParticipant;
    }
  | {
      ok: false;
      error: string;
    };

export type ParsedPlayerReportPayload =
  | {
      ok: true;
      requestId: string | null;
      targetPlayerId: string;
      reason: string;
      details: string | null;
    }
  | {
      ok: false;
      requestId: string | null;
      error: string;
    };

function hasAuthenticatedUserId(
  participant: PlayerReportParticipantSnapshot
): participant is AuthenticatedPlayerReportParticipant {
  return typeof participant.userId === 'string' && participant.userId.length > 0;
}

export function readPlayerReportRequestId(payload: unknown): string | null {
  return isRecord(payload) ? sanitizeShortText(payload.requestId, 96) : null;
}

export function buildPlayerReportResultPayload(
  requestId: string | null,
  result: PlayerReportResult
): PlayerReportResultPayload {
  return {
    requestId,
    ...result,
  };
}

export function parsePlayerReportPayload(payload: unknown, reporterPlayerId: string): ParsedPlayerReportPayload {
  const requestId = readPlayerReportRequestId(payload);

  if (!isRecord(payload)) {
    return { ok: false, requestId, error: 'Invalid report payload' };
  }

  const targetPlayerId = sanitizeShortText(payload.targetPlayerId, 96);
  if (!targetPlayerId) {
    return { ok: false, requestId, error: 'Target player is required' };
  }
  if (targetPlayerId === reporterPlayerId) {
    return { ok: false, requestId, error: 'You cannot report yourself' };
  }

  return {
    ok: true,
    requestId,
    targetPlayerId,
    reason: normalizePlayerReportReason(payload.reason),
    details: sanitizeShortText(payload.details, 1000),
  };
}

export function validatePlayerReportContext(input: {
  reporter: PlayerReportParticipantSnapshot | null;
  target: PlayerReportParticipantSnapshot | null;
}): PlayerReportContextValidation {
  if (!input.reporter) {
    return { ok: false, error: 'Reporter is not in this match' };
  }
  if (!input.target) {
    return { ok: false, error: 'Target player is no longer in this match' };
  }
  if (input.target.isBot || input.target.isNpc) {
    return { ok: false, error: 'Bots cannot be reported' };
  }
  if (!hasAuthenticatedUserId(input.reporter) || !hasAuthenticatedUserId(input.target)) {
    return { ok: false, error: 'Reports require authenticated player accounts' };
  }

  return {
    ok: true,
    reporter: input.reporter,
    target: input.target,
  };
}

export function buildPlayerReportEvidenceInput(input: {
  parsed: AcceptedPlayerReportPayload;
  reporter: AuthenticatedPlayerReportParticipant;
  target: AuthenticatedPlayerReportParticipant;
}): PlayerReportEvidenceInput {
  return {
    eventType: 'player_report.cheating',
    category: 'player_report',
    source: 'game_room_player_report',
    userId: input.target.userId,
    playerSessionId: input.target.id,
    team: input.target.team,
    heroId: input.target.heroId,
    severity: 'medium',
    confidence: 0.55,
    reason: input.parsed.reason,
    details: {
      reporterUserId: input.reporter.userId,
      reporterPlayerSessionId: input.reporter.id,
      reporterName: input.reporter.name,
      targetName: input.target.name,
      targetTeam: input.target.team,
      details: input.parsed.details,
    },
    retentionClass: 'extended',
  };
}

export function buildCreatePlayerReportInput(input: {
  parsed: AcceptedPlayerReportPayload;
  reporter: AuthenticatedPlayerReportParticipant;
  target: AuthenticatedPlayerReportParticipant;
  room: PlayerReportRoomSnapshot;
  evidenceEventId: string | null;
}): CreatePlayerReportInput {
  return {
    reason: input.parsed.reason,
    details: input.parsed.details,
    reporterUserId: input.reporter.userId,
    reporterPlayerSessionId: input.reporter.id,
    reporterName: input.reporter.name,
    targetUserId: input.target.userId,
    targetPlayerSessionId: input.target.id,
    targetName: input.target.name,
    targetTeam: input.target.team,
    roomId: input.room.roomId,
    matchId: input.room.matchId,
    lobbyId: input.room.lobbyId,
    matchMode: input.room.matchMode,
    mapSeed: input.room.mapSeed,
    serverTick: input.room.serverTick,
    evidenceEventId: input.evidenceEventId,
    metadata: {
      targetHeroId: input.target.heroId,
      reporterTeam: input.reporter.team,
      targetStats: input.target.stats,
      reporterPosition: input.reporter.position,
      targetPosition: input.target.position,
    },
  };
}
