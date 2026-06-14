import assert from 'node:assert/strict';
import {
  getSecurityEventLogLevel,
  isExpectedMovementAuthorityBarrier,
} from '../rooms/securityEventLogging';

function barrier(reason: string) {
  return { type: 'movement_authority_barrier', reason };
}

for (const reason of ['spawn', 'respawn', 'teleport', 'knockback']) {
  assert.equal(isExpectedMovementAuthorityBarrier(barrier(reason)), true);
  assert.equal(getSecurityEventLogLevel(barrier(reason)), 'debug');
}

for (const reason of ['queue_overflow', 'epoch_mismatch', 'invalid_transform', 'blocked_path', 'bounds']) {
  assert.equal(isExpectedMovementAuthorityBarrier(barrier(reason)), false);
  assert.equal(getSecurityEventLogLevel(barrier(reason)), 'warn');
}

assert.equal(getSecurityEventLogLevel({ type: 'movement_correction', reason: 'speed_limit' }), 'warn');
assert.equal(getSecurityEventLogLevel({ type: 'movement_command_drop', reason: 'queue_overflow' }), 'warn');
assert.equal(getSecurityEventLogLevel({ type: 'rate_limit_drop', reason: 'movement' }), 'warn');
assert.equal(getSecurityEventLogLevel({ type: 'malformed_message', reason: 'movement_command' }), 'warn');
assert.equal(getSecurityEventLogLevel({ type: 'objective_carrier_mismatch', reason: 'red' }), 'warn');
assert.equal(getSecurityEventLogLevel({ type: 'objective_suppression', reason: 'spawn' }), 'silent');
assert.equal(getSecurityEventLogLevel({ type: 'objective_drop', reason: 'blue' }), 'silent');

console.log('security event logging tests passed');
