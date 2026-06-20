import assert from 'node:assert/strict';
import {
  SecurityEventLogSampler,
  buildRoomSecurityEvent,
  buildSecurityAuthorityEvent,
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

{
  const event = buildRoomSecurityEvent({
    type: 'movement_command_drop',
    playerId: 'player-a',
    userId: 'user-a',
    movementEpoch: 3,
    movementSequence: 44,
    reason: 'queue_overflow',
    position: { x: 1, y: 2, z: 3 },
    detail: { queueLength: 9 },
  }, {
    roomId: 'room-a',
    tick: 123,
    serverTime: 456,
  });

  assert.deepEqual(event, {
    type: 'movement_command_drop',
    playerId: 'player-a',
    userId: 'user-a',
    roomId: 'room-a',
    tick: 123,
    movementEpoch: 3,
    movementSequence: 44,
    reason: 'queue_overflow',
    position: { x: 1, y: 2, z: 3 },
    serverTime: 456,
    detail: { queueLength: 9 },
  });
  assert.deepEqual(buildSecurityAuthorityEvent(event, { team: 'red', heroId: 'phantom' }), {
    ...event,
    team: 'red',
    heroId: 'phantom',
  });
  assert.deepEqual(buildSecurityAuthorityEvent(event, {}), {
    ...event,
    team: null,
    heroId: null,
  });
}

{
  const sampler = new SecurityEventLogSampler({
    securityEventIntervalMs: 1_000,
    movementCorrectionIntervalMs: 100,
    maxKeys: 2,
  });
  const event = {
    type: 'movement_command_drop',
    playerId: 'player-a',
    reason: 'queue_overflow',
  };

  assert.deepEqual(sampler.sample(event, 1_000), event);
  assert.equal(sampler.sample(event, 1_500), null);
  assert.deepEqual(sampler.sample(event, 2_001), {
    ...event,
    suppressedSinceLastLog: 1,
  });
}

{
  const sampler = new SecurityEventLogSampler({
    securityEventIntervalMs: 1_000,
    movementCorrectionIntervalMs: 100,
    maxKeys: 2,
  });
  const event = {
    type: 'movement_correction',
    playerId: 'player-a',
    reason: 'speed_limit',
  };

  assert.deepEqual(sampler.sample(event, 1_000), event);
  assert.equal(sampler.sample(event, 1_050), null);
  assert.deepEqual(sampler.sample(event, 1_101), {
    ...event,
    suppressedSinceLastLog: 1,
  });
}

{
  const sampler = new SecurityEventLogSampler({
    securityEventIntervalMs: 1_000,
    movementCorrectionIntervalMs: 100,
    maxKeys: 2,
  });

  assert.ok(sampler.sample({ type: 'a', playerId: 'one' }, 1_000));
  assert.ok(sampler.sample({ type: 'b', playerId: 'two' }, 1_000));
  assert.ok(sampler.sample({ type: 'c', playerId: 'three' }, 1_000));
  assert.ok(sampler.sample({ type: 'a', playerId: 'one' }, 1_001));
}

console.log('security event logging tests passed');
