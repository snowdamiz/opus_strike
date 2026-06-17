import assert from 'node:assert/strict';
import {
  buildClientJoinHintRecords,
  normalizeClientBuildId,
  normalizeClientMovementProtocolVersion,
} from '../rooms/clientJoinHintsRuntime';

{
  assert.equal(normalizeClientBuildId('  build-a  '), 'build-a');
  assert.equal(normalizeClientBuildId(''), null);
  assert.equal(normalizeClientBuildId('x'.repeat(100)), 'x'.repeat(80));
  assert.equal(normalizeClientBuildId(42), null);
}

{
  assert.equal(normalizeClientMovementProtocolVersion(7.9), 7);
  assert.equal(normalizeClientMovementProtocolVersion(Number.NaN), null);
  assert.equal(normalizeClientMovementProtocolVersion('7'), null);
}

{
  assert.deepEqual(buildClientJoinHintRecords({
    userId: 'user-a',
    playerSessionId: 'session-a',
    expectedBuildId: 'build-a',
    clientBuildId: 'build-a',
    movementProtocolVersion: 3,
    expectedMovementProtocolVersion: 3,
  }), []);
}

{
  assert.deepEqual(buildClientJoinHintRecords({
    userId: 'user-a',
    playerSessionId: 'session-a',
    expectedBuildId: 'build-a',
    clientBuildId: '',
    movementProtocolVersion: undefined,
    expectedMovementProtocolVersion: 3,
  }), [
    {
      eventType: 'client_hint.build_missing',
      category: 'client_hint',
      source: 'game_room_join',
      userId: 'user-a',
      playerSessionId: 'session-a',
      severity: 'low',
      confidence: 0.4,
      reason: 'build_missing',
      details: { expectedBuildId: 'build-a' },
      retentionClass: 'short',
    },
    {
      eventType: 'client_hint.movement_protocol_mismatch',
      category: 'client_hint',
      source: 'game_room_join',
      userId: 'user-a',
      playerSessionId: 'session-a',
      severity: 'low',
      confidence: 0.5,
      reason: 'movement_protocol_missing',
      details: {
        movementProtocolVersion: null,
        expectedMovementProtocolVersion: 3,
      },
      retentionClass: 'short',
    },
  ]);
}

{
  assert.deepEqual(buildClientJoinHintRecords({
    userId: 'user-a',
    playerSessionId: 'session-a',
    expectedBuildId: 'build-a',
    clientBuildId: 'build-b',
    movementProtocolVersion: 2,
    expectedMovementProtocolVersion: 3,
  }), [
    {
      eventType: 'client_hint.build_mismatch',
      category: 'client_hint',
      source: 'game_room_join',
      userId: 'user-a',
      playerSessionId: 'session-a',
      severity: 'low',
      confidence: 0.5,
      reason: 'build_mismatch',
      details: { clientBuildId: 'build-b', expectedBuildId: 'build-a' },
      retentionClass: 'short',
    },
    {
      eventType: 'client_hint.movement_protocol_mismatch',
      category: 'client_hint',
      source: 'game_room_join',
      userId: 'user-a',
      playerSessionId: 'session-a',
      severity: 'low',
      confidence: 0.5,
      reason: 'movement_protocol_mismatch',
      details: {
        movementProtocolVersion: 2,
        expectedMovementProtocolVersion: 3,
      },
      retentionClass: 'short',
    },
  ]);
}

{
  assert.deepEqual(buildClientJoinHintRecords({
    userId: 'user-a',
    playerSessionId: 'session-a',
    expectedBuildId: null,
    clientBuildId: 'any-build',
    movementProtocolVersion: 3,
    expectedMovementProtocolVersion: 3,
  }), []);
}

console.log('client join hints runtime tests passed');
