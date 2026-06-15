import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  buildMovementParityGateReport,
  listMovementTraceFiles,
  readMovementTrace,
  replayMovementTrace,
} from '../anticheat/trace';

const TRACE_ROOT = join(__dirname, 'fixtures', 'anti-cheat-traces');

const smokeFiles = listMovementTraceFiles(TRACE_ROOT, 'smoke');
const fullFiles = listMovementTraceFiles(TRACE_ROOT, 'full');
const allFiles = listMovementTraceFiles(TRACE_ROOT, 'all');

assert.ok(smokeFiles.length >= 8, 'smoke corpus must include legal traces plus malicious regression traces');
assert.ok(fullFiles.length >= smokeFiles.length, 'full corpus must include at least the smoke-level coverage');
assert.ok(allFiles.length >= fullFiles.length, 'all corpus must include every trace group');

const traces = allFiles.map(readMovementTrace);
const movementClasses = new Set(traces.map((trace) => trace.movementClass));
for (const required of [
  'slide_jump_bhop_chain',
  'grapple_release_flag_carry',
  'rocket_jump_knockback',
  'blink_flag_route',
  'walk_sprint_crouch',
  'wallrun_glide_fall',
  'timebreak_tempo_shield',
  'flag_pickup_return_capture_route',
  'forged_teleport_transform',
  'forged_speed_spike',
  'blocked_wall_traversal',
  'stale_epoch_spam',
  'duplicate_command_spam',
  'objective_after_authority_barrier',
]) {
  assert.ok(movementClasses.has(required), `trace corpus missing movement class ${required}`);
}

for (const trace of traces) {
  const report = replayMovementTrace(trace);
  assert.equal(report.passed, true, `${trace.traceId}: ${report.failures.join('; ')}`);
  if (trace.kind === 'legal') {
    assert.equal(report.unexpectedCorrections, 0, `${trace.traceId}: legal trace had unexpected corrections`);
  } else {
    assert.equal(report.expectedReasonMatched, true, `${trace.traceId}: malicious expected reason was not matched`);
  }
}

const smokeReport = buildMovementParityGateReport({ corpus: 'smoke', traceRoot: TRACE_ROOT });
assert.equal(smokeReport.passed, true, smokeReport.failures.join('; '));
assert.ok(smokeReport.legalTraceCount >= 4, 'smoke gate must include high-risk legal movement traces');
assert.ok(smokeReport.maliciousTraceCount >= 6, 'smoke gate must include malicious movement traces');

console.log(`anti-cheat trace replay passed (${allFiles.length} traces)`);
