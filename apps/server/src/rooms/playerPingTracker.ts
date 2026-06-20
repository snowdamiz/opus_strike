import type {
  PlayerPingRequestMessage,
  PlayerPingsMessage,
} from '@voxel-strike/shared';
import {
  DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE,
  createNetworkQualityState,
  evaluatePlayerNetworkQuality,
  recordNetworkQualitySample,
  type NetworkQualityGateConfig,
  type NetworkQualitySample,
  type NetworkQualityState,
  type PlayerNetworkQualityEvaluation,
} from './networkQualityGate';

const DEFAULT_MAX_REPORTED_PLAYER_PING_MS = 999;

interface PendingPlayerPing {
  nonce: string;
  sentAt: number;
}

export interface PlayerPingParticipant {
  name: string;
  team: string;
  isBot: boolean;
}

export interface CompetitiveNetworkQualityGateResult {
  status: 'ready' | 'pending' | 'blocked';
  evaluation?: PlayerNetworkQualityEvaluation;
}

export interface PlayerPingResponseResult {
  accepted: boolean;
  pingMs?: number;
}

export class PlayerPingTracker {
  private readonly pendingPings = new Map<string, PendingPlayerPing>();
  private readonly playerPingMs = new Map<string, number>();
  private readonly playerNetworkQuality = new Map<string, NetworkQualityState>();
  private pingProbeSequence = 0;
  private lastPingProbeAt = 0;
  private dirty = true;

  constructor(
    private readonly qualityConfig: NetworkQualityGateConfig = DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE,
    private readonly maxReportedPingMs = DEFAULT_MAX_REPORTED_PLAYER_PING_MS
  ) {}

  markDirty(): void {
    this.dirty = true;
  }

  shouldBroadcast(force = false): boolean {
    if (!force && !this.dirty) return false;
    this.dirty = false;
    return true;
  }

  clearPlayer(playerId: string): void {
    this.pendingPings.delete(playerId);
    this.playerPingMs.delete(playerId);
    this.playerNetworkQuality.delete(playerId);
    this.markDirty();
  }

  createPingRequest(playerId: string, tick: number, now: number): PlayerPingRequestMessage {
    const nonce = `${tick}:${++this.pingProbeSequence}:${playerId}`;
    this.pendingPings.set(playerId, { nonce, sentAt: now });
    this.getNetworkQualityState(playerId, now);
    return { nonce };
  }

  recordPingResponse(playerId: string, nonce: string, now: number): PlayerPingResponseResult {
    const pending = this.pendingPings.get(playerId);
    if (!pending || pending.nonce !== nonce) {
      return { accepted: false };
    }

    this.pendingPings.delete(playerId);
    const pingMs = Math.min(
      this.maxReportedPingMs,
      Math.max(0, Math.round(now - pending.sentAt))
    );

    if (this.playerPingMs.get(playerId) !== pingMs) {
      this.playerPingMs.set(playerId, pingMs);
      this.markDirty();
    }

    this.recordNetworkQualitySample(playerId, { at: now, pingMs });
    return { accepted: true, pingMs };
  }

  shouldStartProbe(now: number, intervalMs: number): boolean {
    if (now - this.lastPingProbeAt < intervalMs) return false;
    this.lastPingProbeAt = now;
    return true;
  }

  recordTimedOutPings(now: number, timeoutMs: number): string[] {
    const timedOutPlayerIds: string[] = [];
    for (const [playerId, pending] of this.pendingPings) {
      if (now - pending.sentAt <= timeoutMs) continue;
      this.pendingPings.delete(playerId);
      this.recordNetworkQualitySample(playerId, {
        at: now,
        pingMs: null,
        timedOut: true,
      });
      timedOutPlayerIds.push(playerId);
    }
    return timedOutPlayerIds;
  }

  hasPendingPing(playerId: string): boolean {
    return this.pendingPings.has(playerId);
  }

  getPingMs(playerId: string): number | undefined {
    return this.playerPingMs.get(playerId);
  }

  getNetworkQualityState(playerId: string, now = Date.now()): NetworkQualityState {
    let state = this.playerNetworkQuality.get(playerId);
    if (!state) {
      state = createNetworkQualityState(now);
      this.playerNetworkQuality.set(playerId, state);
    }
    return state;
  }

  recordNetworkQualitySample(playerId: string, sample: NetworkQualitySample): void {
    const state = this.getNetworkQualityState(playerId, sample.at);
    recordNetworkQualitySample(state, sample, this.qualityConfig);
  }

  evaluateCompetitiveGate(
    players: Iterable<[string, PlayerPingParticipant]>,
    now: number,
    required: boolean
  ): CompetitiveNetworkQualityGateResult {
    if (!required) return { status: 'ready' };

    let pendingEvaluation: PlayerNetworkQualityEvaluation | undefined;
    for (const [playerId, player] of players) {
      if (player.isBot) continue;

      const evaluation = evaluatePlayerNetworkQuality({
        playerId,
        playerName: player.name,
        state: this.getNetworkQualityState(playerId, now),
        now,
        config: this.qualityConfig,
      });

      if (evaluation.status === 'blocked') {
        return { status: 'blocked', evaluation };
      }
      if (!pendingEvaluation && evaluation.status === 'pending') {
        pendingEvaluation = evaluation;
      }
    }

    return pendingEvaluation
      ? { status: 'pending', evaluation: pendingEvaluation }
      : { status: 'ready' };
  }

  buildPlayerPingsMessage(input: {
    serverTime: number;
    players: Iterable<[string, PlayerPingParticipant]>;
    recipient: { id: string; team: string } | null;
  }): PlayerPingsMessage {
    const { serverTime, players, recipient } = input;
    return {
      serverTime,
      players: Array.from(players, ([playerId, player]) => ({
        playerId,
        pingMs: player.isBot || (recipient && recipient.id !== playerId && recipient.team !== player.team)
          ? null
          : this.playerPingMs.get(playerId) ?? null,
      })),
    };
  }
}
