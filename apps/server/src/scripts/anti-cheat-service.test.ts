import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySignalToRisk,
  buildIntegrityGate,
  createCleanMatchRisk,
  decayRiskScore,
  getAntiCheatConfig,
  normalizeAntiCheatSignal,
  resetAntiCheatConfigForTests,
  updateMatchRisk,
} from '../anticheat';

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetAntiCheatConfigForTests();
  try {
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetAntiCheatConfigForTests();
  }
}

withEnv({
  ANTICHEAT_ENABLED: 'true',
  ANTICHEAT_MODE: 'observe',
  ANTICHEAT_MAX_SIGNAL_DETAIL_BYTES: '512',
}, () => {
  const signal = normalizeAntiCheatSignal({
    eventType: 'movement.correction',
    category: 'movement',
    source: 'test',
    roomId: 'room-a',
    matchId: 'match-a',
    matchMode: 'ranked',
    userId: 'user-a',
    playerSessionId: 'session-a',
    severity: 'high',
    confidence: 0.97,
    reason: 'blocked_path',
    details: {
      walletAddress: '7YttLkHDoQmBv3xPLMZv8kLyxR9r9xPVzx9RDJ5a7Sj3',
      nested: {
        signature: 'abc123',
        safe: 'value',
      },
    },
  }, new Date('2026-06-11T12:00:00.000Z'));

  assert.equal(signal.details.walletAddress, '[redacted]');
  assert.equal((signal.details.nested as Record<string, unknown>).signature, '[redacted]');
  assert.equal((signal.details.nested as Record<string, unknown>).safe, 'value');
  assert.ok(signal.detailBytes <= 512);
  assert.equal(signal.userId, 'user-a');
});

withEnv({ ANTICHEAT_MODE: 'observe' }, () => {
  const config = getAntiCheatConfig();
  const movementSignal = normalizeAntiCheatSignal({
    eventType: 'movement.correction',
    category: 'movement',
    source: 'test',
    roomId: 'room-a',
    matchMode: 'ranked',
    userId: 'user-a',
    playerSessionId: 'session-a',
    severity: 'high',
    confidence: 1,
    reason: 'blocked_path',
  });

  const risk = applySignalToRisk(movementSignal, null, config);
  assert.ok(risk.change.scoreDelta >= 40);
  assert.ok(risk.change.scoreAfter >= risk.change.scoreDelta);

  const decayedCasual = decayRiskScore(60, 0, 2 * 60 * 60 * 1000, 'quick_play');
  const decayedRanked = decayRiskScore(60, 0, 2 * 60 * 60 * 1000, 'ranked');
  assert.ok(decayedCasual < decayedRanked, 'casual scores should decay faster than ranked evidence');
});

withEnv({
  ANTICHEAT_MODE: 'observe',
  ANTICHEAT_RANKED_SCORE_THRESHOLD: '50',
  ANTICHEAT_PAYOUT_HOLD_SCORE_THRESHOLD: '50',
  ANTICHEAT_PAYOUT_HOLDS_ENABLED: 'true',
}, () => {
  const config = getAntiCheatConfig();
  const signal = normalizeAntiCheatSignal({
    eventType: 'objective.carrier_mismatch',
    category: 'objective',
    source: 'test',
    roomId: 'room-a',
    matchId: 'match-a',
    matchMode: 'custom_wager',
    userId: 'user-a',
    team: 'red',
    severity: 'high',
    confidence: 1,
    reason: 'carrier_mismatch',
  });
  const matchRisk = createCleanMatchRisk();
  const { change } = applySignalToRisk(signal, null, config);
  updateMatchRisk(matchRisk, signal, change);
  const gate = buildIntegrityGate(matchRisk, config, { matchMode: 'custom_wager', rankedEligible: true, wagered: true });
  assert.equal(gate.reviewRequired, true);
  assert.equal(gate.observedOnly, true);
  assert.equal(gate.rankedHoldRequired, false);
  assert.equal(gate.payoutHoldRequired, false);
});

withEnv({
  ANTICHEAT_MODE: 'ranked_review',
  ANTICHEAT_RANKED_SCORE_THRESHOLD: '50',
  ANTICHEAT_PAYOUT_HOLD_SCORE_THRESHOLD: '50',
  ANTICHEAT_PAYOUT_HOLDS_ENABLED: 'true',
}, () => {
  const config = getAntiCheatConfig();
  const signal = normalizeAntiCheatSignal({
    eventType: 'objective.carrier_mismatch',
    category: 'objective',
    source: 'test',
    roomId: 'room-a',
    matchId: 'match-a',
    matchMode: 'ranked',
    userId: 'user-a',
    team: 'red',
    severity: 'critical',
    confidence: 1,
    reason: 'carrier_mismatch',
  });
  const matchRisk = createCleanMatchRisk();
  const { change } = applySignalToRisk(signal, null, config);
  updateMatchRisk(matchRisk, signal, change);
  const gate = buildIntegrityGate(matchRisk, config, { matchMode: 'ranked', rankedEligible: true, wagered: true });
  assert.equal(gate.reviewRequired, true);
  assert.equal(gate.observedOnly, false);
  assert.equal(gate.rankedHoldRequired, true);
  assert.equal(gate.payoutHoldRequired, true);
});

withEnv({
  ANTICHEAT_MOVEMENT_AUTHORITY_MODE: 'strict',
  ANTICHEAT_MOVEMENT_PARITY_GATE_REQUIRED: 'true',
  ANTICHEAT_MOVEMENT_PARITY_REPORT_PATH: undefined,
}, () => {
  assert.equal(getAntiCheatConfig().movementAuthorityMode, 'shadow');
  assert.equal(getAntiCheatConfig().movementParityGate.passed, false);
  assert.equal(getAntiCheatConfig().movementParityGate.reason, 'missing ANTICHEAT_MOVEMENT_PARITY_REPORT_PATH');
});

const parityReportPath = join(mkdtempSync(join(tmpdir(), 'voxel-anticheat-')), 'movement-parity-report.json');
writeFileSync(parityReportPath, JSON.stringify({
  version: 1,
  generatedAt: '2026-06-11T12:00:00.000Z',
  corpus: 'smoke',
  traceCount: 3,
  legalTraceCount: 2,
  maliciousTraceCount: 1,
  passed: true,
  maxPositionDrift: 0.01,
  maxVelocityDrift: 0.01,
  movementStateMismatches: 0,
  unexpectedCorrections: 0,
  failures: [],
  traces: [],
}), 'utf8');

withEnv({
  ANTICHEAT_MOVEMENT_AUTHORITY_MODE: 'strict',
  ANTICHEAT_MOVEMENT_PARITY_GATE_REQUIRED: 'true',
  ANTICHEAT_MOVEMENT_PARITY_REPORT_PATH: parityReportPath,
}, () => {
  assert.equal(getAntiCheatConfig().movementAuthorityMode, 'strict');
  assert.equal(getAntiCheatConfig().movementParityGate.passed, true);
  assert.equal(getAntiCheatConfig().movementParityGate.traceCount, 3);
});

console.log('anti-cheat service tests passed');
