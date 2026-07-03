import type {
  MatchMode,
  PlayerPingRequestMessage,
  PlayerPingsMessage,
} from '@voxel-strike/shared';
import {
  isNetworkQualityGateRequiredForMatch,
  type PlayerNetworkQualityEvaluation,
} from './networkQualityGate';
import {
  PlayerPingTracker,
  type CompetitiveNetworkQualityGateResult,
  type PlayerPingParticipant,
  type PlayerPingResponseResult,
} from './playerPingTracker';

export const DEFAULT_PLAYER_PING_INTERVAL_MS = 3000;
export const DEFAULT_PLAYER_PING_TIMEOUT_MS = 10000;

export interface PlayerPingRuntimeClient {
  sessionId: string;
}

export interface PlayerPingParticipantLookup extends Iterable<[string, PlayerPingParticipant]> {
  get(playerId: string): PlayerPingParticipant | undefined;
}

export interface PlayerPingProbeRequest<TClient extends PlayerPingRuntimeClient> {
  client: TClient;
  message: PlayerPingRequestMessage;
}

export interface PlayerPingProbeResult<TClient extends PlayerPingRuntimeClient> {
  started: boolean;
  timedOutPlayerIds: string[];
  requests: PlayerPingProbeRequest<TClient>[];
}

export interface NetworkQualityCancelNoticeDetails {
  message: string;
  blockedPlayerId?: string;
  blockedPlayerName?: string;
  networkQuality?: Record<string, unknown>;
}

export interface EnsureCompetitiveNetworkQualityInput {
  players: Iterable<[string, PlayerPingParticipant]>;
  now: number;
  matchMode: MatchMode;
  cancelPending?: boolean;
}

export interface EnsureCompetitiveNetworkQualityResult {
  ready: boolean;
  gate: CompetitiveNetworkQualityGateResult;
  cancelNotice?: NetworkQualityCancelNoticeDetails;
}

export function buildNetworkQualityCancelNotice(
  evaluation: PlayerNetworkQualityEvaluation | undefined,
  fallbackReason: string
): NetworkQualityCancelNoticeDetails {
  const playerName = evaluation?.playerName || 'A player';
  return {
    message: `Match canceled because ${playerName}'s connection is not stable enough for ranked play.`,
    blockedPlayerId: evaluation?.playerId,
    blockedPlayerName: evaluation?.playerName,
    networkQuality: {
      reason: evaluation?.reason ?? fallbackReason,
      ...(evaluation?.metrics ?? {}),
    },
  };
}

export class PlayerPingRuntime {
  constructor(
    private readonly tracker = new PlayerPingTracker(),
    private readonly pingIntervalMs = DEFAULT_PLAYER_PING_INTERVAL_MS,
    private readonly pingTimeoutMs = DEFAULT_PLAYER_PING_TIMEOUT_MS
  ) {}

  markDirty(): void {
    this.tracker.markDirty();
  }

  shouldBroadcast(force = false): boolean {
    return this.tracker.shouldBroadcast(force);
  }

  clearPlayer(playerId: string): void {
    this.tracker.clearPlayer(playerId);
  }

  getPingMs(playerId: string): number | undefined {
    return this.tracker.getPingMs(playerId);
  }

  createPingRequest(playerId: string, tick: number, now: number): PlayerPingRequestMessage {
    return this.tracker.createPingRequest(playerId, tick, now);
  }

  recordPingResponse(playerId: string, nonce: string, now: number): PlayerPingResponseResult {
    return this.tracker.recordPingResponse(playerId, nonce, now);
  }

  startProbe<TClient extends PlayerPingRuntimeClient>(input: {
    clients: Iterable<TClient>;
    players: PlayerPingParticipantLookup;
    tick: number;
    now: number;
  }): PlayerPingProbeResult<TClient> {
    if (!this.tracker.shouldStartProbe(input.now, this.pingIntervalMs)) {
      return {
        started: false,
        timedOutPlayerIds: [],
        requests: [],
      };
    }

    const timedOutPlayerIds = this.tracker.recordTimedOutPings(input.now, this.pingTimeoutMs);
    const requests: PlayerPingProbeRequest<TClient>[] = [];

    for (const client of input.clients) {
      const player = input.players.get(client.sessionId);
      if (!player || player.isBot) continue;
      if (this.tracker.hasPendingPing(client.sessionId)) continue;
      requests.push({
        client,
        message: this.tracker.createPingRequest(client.sessionId, input.tick, input.now),
      });
    }

    return {
      started: true,
      timedOutPlayerIds,
      requests,
    };
  }

  isCompetitiveGateRequired(input: { matchMode: MatchMode }): boolean {
    return isNetworkQualityGateRequiredForMatch(input);
  }

  evaluateCompetitiveGate(input: {
    players: Iterable<[string, PlayerPingParticipant]>;
    now: number;
    matchMode: MatchMode;
  }): CompetitiveNetworkQualityGateResult {
    return this.tracker.evaluateCompetitiveGate(
      input.players,
      input.now,
      this.isCompetitiveGateRequired(input)
    );
  }

  resetCompetitiveGate(input: {
    players: Iterable<[string, PlayerPingParticipant]>;
    now: number;
    matchMode: MatchMode;
  }): void {
    if (!this.isCompetitiveGateRequired(input)) return;
    this.tracker.resetNetworkQualityForPlayers(input.players, input.now);
  }

  resetCompetitiveGateForPlayer(input: {
    playerId: string;
    now: number;
    matchMode: MatchMode;
  }): void {
    if (!this.isCompetitiveGateRequired(input)) return;
    this.tracker.resetNetworkQuality(input.playerId, input.now);
  }

  ensureCompetitiveGateForStart(
    input: EnsureCompetitiveNetworkQualityInput
  ): EnsureCompetitiveNetworkQualityResult {
    const gate = this.evaluateCompetitiveGate(input);
    if (gate.status === 'ready') {
      return { ready: true, gate };
    }

    if (gate.status === 'blocked' || input.cancelPending) {
      const evaluation = gate.evaluation;
      return {
        ready: false,
        gate,
        cancelNotice: buildNetworkQualityCancelNotice(
          evaluation,
          gate.status === 'pending' ? 'network_not_verified' : evaluation?.reason ?? 'network_quality'
        ),
      };
    }

    return { ready: false, gate };
  }

  buildMessage(input: {
    serverTime: number;
    players: Iterable<[string, PlayerPingParticipant]>;
    recipient: { id: string; team: string } | null;
  }): PlayerPingsMessage {
    return this.tracker.buildPlayerPingsMessage(input);
  }
}
