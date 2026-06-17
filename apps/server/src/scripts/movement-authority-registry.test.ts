import assert from 'node:assert/strict';
import type { MovementCommand } from '@voxel-strike/shared';
import { MovementAuthorityRegistry } from '../rooms/movementAuthorityRegistry';

function command(seq: number, movementEpoch = 0): MovementCommand {
  return {
    seq,
    buttons: 0,
    lookYaw: 0,
    lookPitch: 0,
    clientTimeMs: seq * 10,
    movementEpoch,
    collisionRevision: 0,
  };
}

{
  const registry = new MovementAuthorityRegistry({
    maxServerQueue: 3,
    maxPacketCommands: 2,
    now: () => 1_234,
  });

  const authority = registry.get('player-a');

  assert.equal(registry.get('player-a'), authority);
  assert.equal(authority.pendingCommands.length, 0);
  assert.equal(authority.lastProcessedSeq, 0);
  assert.equal(authority.movementEpoch, 0);
  assert.equal(authority.correctionReason, null);
  assert.equal(authority.commandWindowStartedAt, 1_234);
  assert.equal(authority.commandsInWindow, 0);
  assert.equal(authority.lastAuthoritySentAt, 0);
  assert.equal(authority.lastSafe, null);
  assert.equal(authority.objectiveSuppressedUntil, 0);
  assert.ok(authority.shadow);
  assert.deepEqual(authority.metrics, {
    commandsReceived: 0,
    commandsProcessed: 0,
    commandsProcessedLastTick: 0,
    queueLength: 0,
    queueLengthBeforeTick: 0,
    queueLengthAfterTick: 0,
    underflowTicks: 0,
    catchupTicks: 0,
    catchupSubstepsSkipped: 0,
    catchupSubstepsSkippedLastTick: 0,
    roomCatchupBudgetExhaustedTicks: 0,
    duplicateCommands: 0,
    droppedCommands: 0,
    lateCommands: 0,
    malformedCommands: 0,
    hardCorrections: 0,
    mediumCorrections: 0,
    invalidTransforms: 0,
    speedViolations: 0,
    blockedPathCorrections: 0,
    boundsCorrections: 0,
    objectiveSuppressions: 0,
    abilityRejects: 0,
    rateLimitDrops: 0,
    staleCollisionRevisionDrops: 0,
    lastAckSeq: 0,
    authoritySends: 0,
    lastAckIntervalMs: 0,
  });

  registry.pushPendingCommand(authority, command(2));
  registry.pushPendingCommand(authority, command(1));

  assert.deepEqual(authority.pendingCommands.toArray().map((item) => item.seq), [1, 2]);
  assert.equal(registry.getNextMovementCommand(authority)?.seq, 1);
  assert.equal(authority.lastProcessedSeq, 1);
  assert.equal(registry.getNextMovementCommand(authority)?.seq, 2);
  assert.equal(authority.lastProcessedSeq, 2);
  assert.equal(registry.getNextMovementCommand(authority), null);
  assert.equal(authority.lastProcessedSeq, 2);

  registry.replacePendingCommands(authority, [command(5), command(3), command(4)]);
  assert.deepEqual(authority.pendingCommands.toArray().map((item) => item.seq), [3, 4, 5]);

  registry.removeOldestPendingCommands(authority, 0);
  registry.removeOldestPendingCommands(authority, -1);
  assert.deepEqual(authority.pendingCommands.toArray().map((item) => item.seq), [3, 4, 5]);

  registry.removeOldestPendingCommands(authority, 2);
  assert.deepEqual(authority.pendingCommands.toArray().map((item) => item.seq), [5]);

  assert.equal(registry.delete('player-a'), true);
  assert.equal(registry.delete('player-a'), false);

  const recreated = registry.get('player-a');
  assert.notEqual(recreated, authority);
  assert.equal(recreated.commandWindowStartedAt, 1_234);
}

console.log('movement authority registry tests passed');
