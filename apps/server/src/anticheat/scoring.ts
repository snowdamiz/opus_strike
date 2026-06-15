import type {
  AntiCheatCasePriority,
  AntiCheatIntegrityGate,
  AntiCheatMatchIntegrityStatus,
  AntiCheatScoreChange,
  AntiCheatSignal,
} from './types';
import type { AntiCheatRuntimeConfig } from './types';

export interface PlayerRiskState {
  userId: string | null;
  playerSessionId: string | null;
  score: number;
  maxScore: number;
  lastScoredAt: number;
  lastSignalAt: number;
}

export interface MatchRiskState {
  status: AntiCheatMatchIntegrityStatus;
  reason: string | null;
  score: number;
  affectedUserIds: Set<string>;
  affectedTeams: Set<string>;
  caseId: string | null;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function severityBase(severity: string): number {
  if (severity === 'critical') return 45;
  if (severity === 'high') return 24;
  if (severity === 'medium') return 10;
  return 2;
}

export function calculateSignalScoreDelta(signal: AntiCheatSignal): number {
  let delta = severityBase(signal.severity) * signal.confidence;
  const reason = signal.reason ?? '';

  if (signal.category === 'auth' && (signal.eventType.includes('replay') || reason.includes('replay'))) delta += 35;
  if (signal.category === 'auth' && signal.eventType.includes('direct_join')) delta += 30;
  if (signal.category === 'movement' && reason === 'invalid_transform') delta += 18;
  if (signal.category === 'movement' && reason === 'speed_limit') delta += 12;
  if (signal.category === 'movement' && reason === 'blocked_path') delta += 22;
  if (signal.category === 'movement' && reason === 'bounds') delta += 20;
  if (signal.category === 'movement' && reason === 'queue_overflow') delta += 8;
  if (signal.category === 'objective' && signal.eventType.includes('carrier_mismatch')) delta += 26;
  if (signal.category === 'objective' && signal.eventType.includes('capture')) delta += signal.severity === 'high' ? 20 : 0;
  if (signal.category === 'combat' && signal.eventType.includes('ignored_projectile')) delta += 8;
  if (signal.category === 'combat' && signal.eventType.includes('non_visible_target_hit')) {
    delta += reason.includes('visibility_hidden') ? 12 : 6;
  }
  if (signal.category === 'ability' && reason?.includes('disabled')) delta += 16;
  if (signal.category === 'network' && signal.eventType.includes('rate_limit')) delta += 3;
  if (signal.category === 'client_hint') delta = Math.min(delta, 5);

  return Math.round(Math.max(0, delta));
}

export function decayRiskScore(
  score: number,
  lastScoredAt: number,
  now: number,
  matchMode: string | null
): number {
  if (score <= 0 || now <= lastScoredAt) return clampScore(score);
  const hours = (now - lastScoredAt) / 3_600_000;
  const pointsPerHour = matchMode === 'ranked' || matchMode === 'custom_wager' ? 4 : 9;
  return clampScore(score - hours * pointsPerHour);
}

function statusFromScore(score: number, signal: AntiCheatSignal): AntiCheatMatchIntegrityStatus {
  if (signal.severity === 'critical') return 'compromised';
  if (
    signal.category === 'objective' &&
    (signal.eventType.includes('carrier_mismatch') || signal.eventType.includes('capture_after'))
  ) {
    return 'compromised';
  }
  if (score >= 75) return 'compromised';
  if (score >= 50) return 'suspicious';
  return 'clean';
}

function priorityFromScore(score: number, signal: AntiCheatSignal): AntiCheatCasePriority | null {
  if (signal.severity === 'critical' || score >= 90) return 'urgent';
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  if (score >= 25) return 'low';
  return null;
}

export function applySignalToRisk(
  signal: AntiCheatSignal,
  risk: PlayerRiskState | null,
  config: AntiCheatRuntimeConfig,
  now = signal.observedAt.getTime()
): { nextRisk: PlayerRiskState | null; change: AntiCheatScoreChange } {
  const scoreDelta = calculateSignalScoreDelta(signal);
  const previous = risk
    ? decayRiskScore(risk.score, risk.lastScoredAt, now, signal.matchMode)
    : 0;
  const scoreAfter = clampScore(previous + scoreDelta);
  const priority = priorityFromScore(scoreAfter, signal);
  const affectsRankedOrWager = signal.matchMode === 'ranked' || signal.matchMode === 'custom_wager';

  const change: AntiCheatScoreChange = {
    userId: signal.userId,
    playerSessionId: signal.playerSessionId,
    scoreBefore: Math.round(previous),
    scoreAfter: Math.round(scoreAfter),
    scoreDelta,
    integrityStatus: statusFromScore(scoreAfter, signal),
    casePriority: priority,
    shouldCreateCase: Boolean(priority && (scoreAfter >= config.adminReviewScoreThreshold || signal.severity === 'critical')),
    affectsRankedOrWager,
  };

  if (!signal.userId && !signal.playerSessionId) {
    return { nextRisk: null, change };
  }

  return {
    nextRisk: {
      userId: signal.userId,
      playerSessionId: signal.playerSessionId,
      score: scoreAfter,
      maxScore: Math.max(risk?.maxScore ?? 0, scoreAfter),
      lastScoredAt: now,
      lastSignalAt: now,
    },
    change,
  };
}

export function createCleanMatchRisk(): MatchRiskState {
  return {
    status: 'clean',
    reason: null,
    score: 0,
    affectedUserIds: new Set(),
    affectedTeams: new Set(),
    caseId: null,
  };
}

export function updateMatchRisk(
  matchRisk: MatchRiskState,
  signal: AntiCheatSignal,
  change: AntiCheatScoreChange
): void {
  matchRisk.score = Math.max(matchRisk.score, change.scoreAfter);
  if (signal.userId) matchRisk.affectedUserIds.add(signal.userId);
  if (signal.team) matchRisk.affectedTeams.add(signal.team);
  if (change.integrityStatus === 'compromised') {
    matchRisk.status = 'compromised';
    matchRisk.reason = signal.reason ?? signal.eventType;
    return;
  }
  if (change.integrityStatus === 'suspicious' && matchRisk.status === 'clean') {
    matchRisk.status = 'suspicious';
    matchRisk.reason = signal.reason ?? signal.eventType;
  }
}

export function buildIntegrityGate(
  matchRisk: MatchRiskState,
  config: AntiCheatRuntimeConfig,
  options: { matchMode: string; rankedEligible: boolean; wagered: boolean }
): AntiCheatIntegrityGate {
  const reviewRequired = (
    matchRisk.status === 'compromised' ||
    matchRisk.status === 'no_contest' ||
    (matchRisk.status === 'suspicious' && matchRisk.score >= Math.min(config.rankedScoreThreshold, config.wagerScoreThreshold))
  );
  const rankedRisk = options.rankedEligible && matchRisk.score >= config.rankedScoreThreshold;
  const wagerRisk = options.wagered && matchRisk.score >= config.payoutHoldScoreThreshold;
  const rankedHoldRequired = reviewRequired && rankedRisk && config.mode === 'ranked_review';
  const payoutHoldRequired = reviewRequired && wagerRisk && config.mode === 'ranked_review' && config.payoutHoldsEnabled;

  return {
    status: matchRisk.status,
    reviewRequired,
    rankedHoldRequired,
    payoutHoldRequired,
    observedOnly: config.mode === 'observe',
    reason: matchRisk.reason,
    affectedUserIds: Array.from(matchRisk.affectedUserIds),
    affectedTeams: Array.from(matchRisk.affectedTeams),
    score: Math.round(matchRisk.score),
    caseId: matchRisk.caseId,
  };
}
