import type { MatchMode } from '@voxel-strike/shared';
import { getAntiCheatConfig } from './config';
import { normalizeAntiCheatSignal } from './signal';
import {
  applySignalToRisk,
  buildIntegrityGate,
  createCleanMatchRisk,
  updateMatchRisk,
  type MatchRiskState,
  type PlayerRiskState,
} from './scoring';
import type {
  AntiCheatCasePriority,
  AntiCheatIntegrityGate,
  AntiCheatRoomAuthorityEvent,
  AntiCheatSignal,
  AntiCheatSignalInput,
  AntiCheatSeverity,
  AntiCheatScoreChange,
} from './types';
import type { AntiCheatEvidenceStore } from './service';

interface AntiCheatRoomRuntimeOptions {
  roomId: string;
  lobbyId: string | null;
  matchMode: MatchMode;
  getMatchId: () => string | null;
  getServerTick: () => number;
  getServerTime: () => number;
  evidenceStore: AntiCheatEvidenceStore;
}

const MAX_ROOM_SIGNALS = 512;
const AGGREGATE_FLUSH_INTERVAL_MS = 2000;
const NOISY_EVENT_TYPES = new Set([
  'network.rate_limit_drop',
  'network.malformed_message',
  'movement.movement_command_reject',
  'movement.movement_command_drop',
  'movement.authority_barrier',
  'combat.non_visible_target_hit',
]);

interface AggregateBucket {
  firstSignal: AntiCheatSignal;
  lastSignal: AntiCheatSignal;
  count: number;
  cumulativeScoreDelta: number;
  scoreBefore: number;
  scoreAfter: number;
  integrityStatus: AntiCheatScoreChange['integrityStatus'];
  casePriority: AntiCheatCasePriority | null;
  shouldCreateCase: boolean;
  affectsRanked: boolean;
  maxSeverity: AntiCheatSeverity;
  maxConfidence: number;
  reasons: Set<string>;
  firstMovementSequence: number | null;
  lastMovementSequence: number | null;
}

export class AntiCheatRoomRuntime {
  private readonly playerRisk = new Map<string, PlayerRiskState>();
  private matchRisk: MatchRiskState = createCleanMatchRisk();
  private readonly recentSignals: AntiCheatSignal[] = [];
  private readonly aggregateBuckets = new Map<string, AggregateBucket>();
  private lastAggregateFlushAt = 0;

  constructor(private readonly options: AntiCheatRoomRuntimeOptions) {
    this.lastAggregateFlushAt = options.getServerTime();
  }

  getRecentSignals(): AntiCheatSignal[] {
    return [...this.recentSignals];
  }

  resetMatch(): void {
    this.flushAggregates();
    this.matchRisk = createCleanMatchRisk();
    this.recentSignals.length = 0;
  }

  setCaseId(caseId: string | null): void {
    if (caseId) this.matchRisk.caseId = caseId;
  }

  record(input: Omit<AntiCheatSignalInput, 'roomId' | 'matchId' | 'lobbyId' | 'matchMode' | 'serverTick' | 'serverTime'>): AntiCheatSignal | null {
    const config = getAntiCheatConfig();
    if (!config.enabled) return null;

    if (input.category === 'client_hint' && !config.clientHintsEnabled) return null;

    const signal = normalizeAntiCheatSignal({
      ...input,
      roomId: this.options.roomId,
      matchId: this.options.getMatchId(),
      lobbyId: this.options.lobbyId,
      matchMode: this.options.matchMode,
      serverTick: this.options.getServerTick(),
      serverTime: this.options.getServerTime(),
    });
    this.recentSignals.push(signal);
    if (this.recentSignals.length > MAX_ROOM_SIGNALS) {
      this.recentSignals.splice(0, this.recentSignals.length - MAX_ROOM_SIGNALS);
    }

    const riskKey = signal.userId ?? signal.playerSessionId ?? '';
    const currentRisk = riskKey ? this.playerRisk.get(riskKey) ?? null : null;
    const { nextRisk, change } = applySignalToRisk(signal, currentRisk, config);
    if (riskKey && nextRisk) this.playerRisk.set(riskKey, nextRisk);
    updateMatchRisk(this.matchRisk, signal, change);

    if (this.shouldAggregateSignal(signal)) {
      this.addAggregateSignal(signal, change);
      this.flushAggregatesIfDue(signal.serverTime);
    } else {
      this.persistSignal(signal, change);
    }

    return signal;
  }

  recordAuthorityEvent(event: AntiCheatRoomAuthorityEvent & {
    team?: string | null;
    heroId?: string | null;
  }): AntiCheatSignal | null {
    const mapped = mapAuthorityEvent(event);
    return this.record({
      ...mapped,
      source: 'game_room',
      userId: event.userId,
      playerSessionId: event.playerId,
      team: event.team ?? null,
      heroId: event.heroId ?? null,
      movementEpoch: event.movementEpoch,
      movementSequence: event.movementSequence,
      reason: event.reason,
      details: {
        ...event.detail,
        position: event.position,
        authorityEventType: event.type,
      },
    });
  }

  buildIntegrityGate(options: { rankedEligible: boolean }): AntiCheatIntegrityGate {
    this.flushAggregates();
    return buildIntegrityGate(this.matchRisk, getAntiCheatConfig(), {
      matchMode: this.options.matchMode,
      rankedEligible: options.rankedEligible,
    });
  }

  flushAggregates(): void {
    if (this.aggregateBuckets.size === 0) return;

    for (const bucket of this.aggregateBuckets.values()) {
      const summarySignal = normalizeAntiCheatSignal({
        eventType: bucket.lastSignal.eventType,
        category: bucket.lastSignal.category,
        source: bucket.lastSignal.source,
        roomId: bucket.lastSignal.roomId,
        matchId: bucket.lastSignal.matchId,
        lobbyId: bucket.lastSignal.lobbyId,
        matchMode: bucket.lastSignal.matchMode,
        userId: bucket.lastSignal.userId,
        playerSessionId: bucket.lastSignal.playerSessionId,
        team: bucket.lastSignal.team,
        heroId: bucket.lastSignal.heroId,
        serverTick: bucket.lastSignal.serverTick,
        serverTime: bucket.lastSignal.serverTime,
        movementEpoch: bucket.lastSignal.movementEpoch,
        movementSequence: bucket.lastMovementSequence,
        severity: bucket.maxSeverity,
        confidence: bucket.maxConfidence,
        reason: bucket.lastSignal.reason,
        retentionClass: bucket.lastSignal.retentionClass,
        details: {
          ...bucket.lastSignal.details,
          aggregate: {
            count: bucket.count,
            firstEventId: bucket.firstSignal.eventId,
            lastEventId: bucket.lastSignal.eventId,
            firstObservedAt: bucket.firstSignal.observedAt.toISOString(),
            lastObservedAt: bucket.lastSignal.observedAt.toISOString(),
            firstMovementSequence: bucket.firstMovementSequence,
            lastMovementSequence: bucket.lastMovementSequence,
            maxSeverity: bucket.maxSeverity,
            reasons: Array.from(bucket.reasons).slice(0, 12),
          },
        },
      });
      this.persistSignal(summarySignal, {
        userId: bucket.lastSignal.userId,
        playerSessionId: bucket.lastSignal.playerSessionId,
        scoreBefore: bucket.scoreBefore,
        scoreAfter: bucket.scoreAfter,
        scoreDelta: bucket.cumulativeScoreDelta,
        integrityStatus: bucket.integrityStatus,
        casePriority: bucket.casePriority,
        shouldCreateCase: bucket.shouldCreateCase,
        affectsRanked: bucket.affectsRanked,
      });
    }

    this.aggregateBuckets.clear();
    this.lastAggregateFlushAt = this.options.getServerTime();
  }

  private persistSignal(signal: AntiCheatSignal, change: AntiCheatScoreChange): void {
    void this.options.evidenceStore.recordSignal(signal, change)
      .then((result) => {
        if (result.caseId) this.setCaseId(result.caseId);
      });
  }

  private shouldAggregateSignal(signal: AntiCheatSignal): boolean {
    return (
      NOISY_EVENT_TYPES.has(signal.eventType) &&
      (signal.severity === 'low' || signal.severity === 'medium')
    );
  }

  private aggregateKey(signal: AntiCheatSignal): string {
    return [
      signal.userId ?? signal.playerSessionId ?? 'unknown',
      signal.eventType,
      signal.reason ?? '',
      signal.movementEpoch ?? '',
    ].join('|');
  }

  private addAggregateSignal(signal: AntiCheatSignal, change: AntiCheatScoreChange): void {
    const key = this.aggregateKey(signal);
    let bucket = this.aggregateBuckets.get(key);
    if (!bucket) {
      bucket = {
        firstSignal: signal,
        lastSignal: signal,
        count: 0,
        cumulativeScoreDelta: 0,
        scoreBefore: change.scoreBefore,
        scoreAfter: change.scoreAfter,
        integrityStatus: change.integrityStatus,
        casePriority: change.casePriority,
        shouldCreateCase: change.shouldCreateCase,
        affectsRanked: change.affectsRanked,
        maxSeverity: signal.severity,
        maxConfidence: signal.confidence,
        reasons: new Set(),
        firstMovementSequence: signal.movementSequence,
        lastMovementSequence: signal.movementSequence,
      };
      this.aggregateBuckets.set(key, bucket);
    }

    bucket.lastSignal = signal;
    bucket.count++;
    bucket.cumulativeScoreDelta += change.scoreDelta;
    bucket.scoreAfter = change.scoreAfter;
    bucket.integrityStatus = higherIntegrityStatus(bucket.integrityStatus, change.integrityStatus);
    bucket.casePriority = higherCasePriority(bucket.casePriority, change.casePriority);
    bucket.shouldCreateCase ||= change.shouldCreateCase;
    bucket.affectsRanked ||= change.affectsRanked;
    bucket.maxSeverity = higherSeverity(bucket.maxSeverity, signal.severity);
    bucket.maxConfidence = Math.max(bucket.maxConfidence, signal.confidence);
    if (signal.reason) bucket.reasons.add(signal.reason);
    if (bucket.firstMovementSequence === null) bucket.firstMovementSequence = signal.movementSequence;
    bucket.lastMovementSequence = signal.movementSequence;
  }

  private flushAggregatesIfDue(now: number): void {
    if (now - this.lastAggregateFlushAt < AGGREGATE_FLUSH_INTERVAL_MS) return;
    this.flushAggregates();
  }
}

function severityRank(severity: AntiCheatSeverity): number {
  if (severity === 'critical') return 4;
  if (severity === 'high') return 3;
  if (severity === 'medium') return 2;
  return 1;
}

function higherSeverity(a: AntiCheatSeverity, b: AntiCheatSeverity): AntiCheatSeverity {
  return severityRank(b) > severityRank(a) ? b : a;
}

function casePriorityRank(priority: AntiCheatCasePriority | null): number {
  if (priority === 'urgent') return 4;
  if (priority === 'high') return 3;
  if (priority === 'medium') return 2;
  if (priority === 'low') return 1;
  return 0;
}

function higherCasePriority(
  a: AntiCheatCasePriority | null,
  b: AntiCheatCasePriority | null
): AntiCheatCasePriority | null {
  return casePriorityRank(b) > casePriorityRank(a) ? b : a;
}

function integrityRank(status: AntiCheatScoreChange['integrityStatus']): number {
  if (status === 'no_contest') return 4;
  if (status === 'compromised') return 3;
  if (status === 'suspicious') return 2;
  return 1;
}

function higherIntegrityStatus(
  a: AntiCheatScoreChange['integrityStatus'],
  b: AntiCheatScoreChange['integrityStatus']
): AntiCheatScoreChange['integrityStatus'] {
  return integrityRank(b) > integrityRank(a) ? b : a;
}

function mapAuthorityEvent(event: AntiCheatRoomAuthorityEvent): Pick<AntiCheatSignalInput, 'eventType' | 'category' | 'severity' | 'confidence' | 'retentionClass'> {
  if (event.type === 'rate_limit_drop') {
    return { eventType: 'network.rate_limit_drop', category: 'network', severity: 'low', confidence: 0.85, retentionClass: 'short' };
  }
  if (event.type === 'malformed_message') {
    return { eventType: 'network.malformed_message', category: 'network', severity: 'medium', confidence: 0.9 };
  }
  if (event.type === 'movement_correction') {
    const high = event.reason === 'bounds' || event.reason === 'blocked_path' || event.reason === 'invalid_transform';
    return { eventType: 'movement.correction', category: 'movement', severity: high ? 'high' : 'medium', confidence: 0.95 };
  }
  if (event.type === 'movement_command_reject' || event.type === 'movement_command_drop') {
    return { eventType: `movement.${event.type}`, category: 'movement', severity: 'medium', confidence: 0.8 };
  }
  if (event.type === 'movement_authority_barrier') {
    return { eventType: 'movement.authority_barrier', category: 'movement', severity: 'low', confidence: 0.75, retentionClass: 'short' };
  }
  if (event.type === 'objective_suppression') {
    return { eventType: 'objective.suppression', category: 'objective', severity: 'medium', confidence: 0.95 };
  }
  if (event.type === 'objective_carrier_mismatch') {
    return { eventType: 'objective.carrier_mismatch', category: 'objective', severity: 'high', confidence: 0.98 };
  }
  if (event.type.startsWith('objective_')) {
    return { eventType: event.type.replace('_', '.'), category: 'objective', severity: 'low', confidence: 0.7, retentionClass: 'short' };
  }
  if (event.type === 'ability_reject') {
    return { eventType: 'ability.reject', category: 'ability', severity: event.reason?.includes('disabled') ? 'high' : 'medium', confidence: 0.9 };
  }
  if (event.type.startsWith('auth_') || event.type.includes('ticket')) {
    return { eventType: `auth.${event.type}`, category: 'auth', severity: 'high', confidence: 0.95 };
  }
  return { eventType: event.type, category: 'client_hint', severity: 'low', confidence: 0.5, retentionClass: 'short' };
}
