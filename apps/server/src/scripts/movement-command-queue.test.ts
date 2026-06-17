import assert from 'node:assert/strict';
import {
  MOVEMENT_COMMAND_STALE_GRACE_STEPS,
  MOVEMENT_MAX_COMMANDS_PER_SECOND,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_MAX_SERVER_QUEUE,
  MOVEMENT_PROTOCOL_VERSION,
  movementSeqDistance,
  type MovementCommand,
} from '@voxel-strike/shared';
import { MovementCommandQueue } from '../rooms/MovementCommandQueue';
import { MovementAuthorityRegistry } from '../rooms/movementAuthorityRegistry';
import {
  SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS,
  SERVER_MOVEMENT_BACKLOG_TRIM_TARGET_COMMANDS,
  SERVER_MOVEMENT_SUBSTEPS_PER_TICK,
  SERVER_MOVEMENT_TARGET_PENDING_COMMANDS,
  getMovementBacklogTrimCount,
  getMovementCommandDrainDecision,
} from '../rooms/movementCommandDrain';
import {
  getMovementQueueOverflowBarrierPolicy,
  ingestMovementCommandPacket,
  sanitizeIncomingMovementCommand,
} from '../rooms/movementCommandIngress';

function command(seq: number, overrides: Partial<MovementCommand> = {}): MovementCommand {
  return {
    seq,
    buttons: 0,
    lookYaw: 0,
    lookPitch: 0,
    clientTimeMs: seq,
    movementEpoch: 0,
    collisionRevision: 0,
    ...overrides,
  };
}

function packet(commands: unknown[], overrides: Partial<{ protocolVersion: number; firstSeq: number }> = {}) {
  return {
    protocolVersion: MOVEMENT_PROTOCOL_VERSION,
    firstSeq: commands.length > 0 && typeof commands[0] === 'object' && commands[0] !== null
      ? Number((commands[0] as { seq?: unknown }).seq ?? 0)
      : 0,
    commands,
    ...overrides,
  };
}

function authority() {
  return new MovementAuthorityRegistry({
    maxServerQueue: 16,
    maxPacketCommands: MOVEMENT_MAX_PACKET_COMMANDS,
    now: () => 0,
  }).get('player-a');
}

const queue = new MovementCommandQueue(4);
queue.push(command(1));
queue.push(command(3));
queue.push(command(2));
queue.push(command(2));
assert.equal(queue.length, 3);
assert.deepEqual(queue.toArray().map((item) => item.seq), [1, 2, 3]);
assert.equal(queue.hasSeq(2), true);

assert.equal(queue.pop()?.seq, 1);
assert.equal(queue.hasSeq(1), false);
queue.push(command(4));
queue.push(command(5));
assert.deepEqual(queue.toArray().map((item) => item.seq), [2, 3, 4, 5]);

const removed = queue.dropOldest(2);
assert.deepEqual(removed.map((item) => item.seq), [2, 3]);
assert.deepEqual(queue.toArray().map((item) => item.seq), [4, 5]);
assert.equal(queue.hasSeq(2), false);
assert.equal(queue.peekLast()?.seq, 5);

queue.replace([command(9), command(7), command(8)]);
assert.deepEqual(queue.toArray().map((item) => item.seq), [7, 8, 9]);
queue.clear();
assert.equal(queue.length, 0);
assert.equal(queue.pop(), null);

const wrap = new MovementCommandQueue(2);
wrap.push(command(0xffffffff));
wrap.push(command(0));
wrap.push(command(1));
assert.deepEqual(wrap.toArray().map((item) => item.seq), [0xffffffff, 0, 1]);

{
  const movementAuthority = authority();
  const result = sanitizeIncomingMovementCommand({
    authority: movementAuthority,
    command: command(1),
    currentCollisionRevision: 0,
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected valid movement command');
  assert.equal(result.command.seq, 1);
  assert.equal(movementAuthority.metrics.malformedCommands, 0);
}

{
  const movementAuthority = authority();
  const result = sanitizeIncomingMovementCommand({
    authority: movementAuthority,
    command: { seq: 'bad', buttons: null },
    currentCollisionRevision: 0,
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected malformed movement command rejection');
  assert.equal(result.rejection.reason, 'malformed_command');
  assert.equal(movementAuthority.metrics.malformedCommands, 1);
  assert.deepEqual(result.rejection.detail.commandShape, {
    seq: 'string',
    buttons: 'object',
    lookYaw: 'undefined',
    lookPitch: 'undefined',
    clientTimeMs: 'undefined',
    movementEpoch: 'undefined',
    collisionRevision: 'undefined',
    abilityCastHints: 'undefined',
  });
}

{
  const movementAuthority = authority();
  movementAuthority.movementEpoch = 1;
  movementAuthority.lastProcessedSeq = 1956;
  const result = sanitizeIncomingMovementCommand({
    authority: movementAuthority,
    command: command(1963, { movementEpoch: 0 }),
    currentCollisionRevision: 0,
  });

  assert.equal(result.ok, true);
  if (!result.ok) throw new Error('expected previous-epoch command promotion');
  assert.equal(result.command.movementEpoch, 1);
  assert.equal(movementAuthority.metrics.lateCommands, 0);
}

{
  const movementAuthority = authority();
  movementAuthority.movementEpoch = 2;
  const result = sanitizeIncomingMovementCommand({
    authority: movementAuthority,
    command: command(10, { movementEpoch: 0 }),
    currentCollisionRevision: 0,
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected epoch mismatch rejection');
  assert.equal(result.rejection.reason, 'epoch_mismatch');
  assert.equal(result.rejection.movementSequence, 10);
  assert.deepEqual(result.rejection.detail, {
    commandEpoch: 0,
    authorityEpoch: 2,
    lastProcessedSeq: 0,
  });
  assert.equal(movementAuthority.metrics.lateCommands, 1);
  assert.equal(movementAuthority.correctionReason, 'epoch_mismatch');
}

{
  const movementAuthority = authority();
  const result = sanitizeIncomingMovementCommand({
    authority: movementAuthority,
    command: command(2, { collisionRevision: 3 }),
    currentCollisionRevision: 4,
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected collision revision rejection');
  assert.equal(result.rejection.reason, 'collision_revision');
  assert.deepEqual(result.rejection.detail, {
    commandRevision: 3,
    currentRevision: 4,
  });
  assert.equal(movementAuthority.metrics.staleCollisionRevisionDrops, 1);
  assert.equal(movementAuthority.correctionReason, 'collision_revision');
}

{
  const movementAuthority = authority();
  movementAuthority.lastProcessedSeq = 5;
  const result = sanitizeIncomingMovementCommand({
    authority: movementAuthority,
    command: command(5),
    currentCollisionRevision: 0,
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected duplicate processed command rejection');
  assert.equal(result.rejection.reason, 'duplicate_command');
  assert.deepEqual(result.rejection.detail, { lastProcessedSeq: 5 });
  assert.equal(movementAuthority.metrics.duplicateCommands, 1);
}

{
  const movementAuthority = authority();
  movementAuthority.pendingCommands.push(command(3));
  const result = sanitizeIncomingMovementCommand({
    authority: movementAuthority,
    command: command(3),
    currentCollisionRevision: 0,
  });

  assert.equal(result.ok, false);
  if (result.ok) throw new Error('expected duplicate queued command rejection');
  assert.equal(result.rejection.reason, 'duplicate_queued_command');
  assert.deepEqual(result.rejection.detail, { queueLength: 1 });
  assert.equal(movementAuthority.metrics.duplicateCommands, 1);
}

{
  assert.deepEqual(getMovementQueueOverflowBarrierPolicy({
    queueLength: 2,
    maxServerQueue: 2,
  }), {
    overflow: 0,
    discardedCommandCount: 0,
    shouldMarkQueueOverflowBarrier: false,
    detail: null,
  });

  assert.deepEqual(getMovementQueueOverflowBarrierPolicy({
    queueLength: 3,
    maxServerQueue: 2,
  }), {
    overflow: 1,
    discardedCommandCount: 3,
    shouldMarkQueueOverflowBarrier: true,
    detail: {
      overflow: 1,
      discardedCommands: 3,
      maxQueue: 2,
      policy: 'clear_queue_on_barrier',
    },
  });
}

{
  const movementAuthority = authority();
  const result = ingestMovementCommandPacket({
    authority: movementAuthority,
    packet: packet([command(1), command(2)]),
    now: 1_000,
    currentCollisionRevision: 0,
  });

  assert.equal(result.acceptedCommandCount, 2);
  assert.equal(result.overflow, 0);
  assert.equal(result.discardedCommandCount, 0);
  assert.equal(result.shouldMarkQueueOverflowBarrier, false);
  assert.deepEqual(result.events, []);
  assert.deepEqual(movementAuthority.pendingCommands.toArray().map((item) => item.seq), [1, 2]);
  assert.equal(movementAuthority.metrics.commandsReceived, 2);
  assert.equal(movementAuthority.metrics.queueLength, 2);
}

{
  const movementAuthority = authority();
  const result = ingestMovementCommandPacket({
    authority: movementAuthority,
    packet: packet([], { protocolVersion: MOVEMENT_PROTOCOL_VERSION + 1 }),
    now: 1_000,
    currentCollisionRevision: 0,
  });

  assert.equal(result.acceptedCommandCount, 0);
  assert.deepEqual(result.events, [{
    type: 'malformed_message',
    movementEpoch: 0,
    reason: 'movementCommands',
    detail: {
      protocolVersion: MOVEMENT_PROTOCOL_VERSION + 1,
      commandCount: 0,
    },
  }]);
  assert.equal(movementAuthority.metrics.malformedCommands, 1);
}

{
  const movementAuthority = authority();
  movementAuthority.commandWindowStartedAt = 100;
  movementAuthority.commandsInWindow = MOVEMENT_MAX_COMMANDS_PER_SECOND;
  const result = ingestMovementCommandPacket({
    authority: movementAuthority,
    packet: packet([command(1)]),
    now: 500,
    currentCollisionRevision: 0,
  });

  assert.equal(result.acceptedCommandCount, 0);
  assert.deepEqual(result.events, [{
    type: 'movement_command_drop',
    movementEpoch: 0,
    reason: 'command_rate_limit',
    detail: {
      commandsInWindow: MOVEMENT_MAX_COMMANDS_PER_SECOND,
      limit: MOVEMENT_MAX_COMMANDS_PER_SECOND,
    },
  }]);
  assert.equal(movementAuthority.metrics.droppedCommands, 1);
  assert.equal(movementAuthority.pendingCommands.length, 0);
}

{
  const movementAuthority = authority();
  movementAuthority.commandWindowStartedAt = 100;
  movementAuthority.commandsInWindow = MOVEMENT_MAX_COMMANDS_PER_SECOND;
  const result = ingestMovementCommandPacket({
    authority: movementAuthority,
    packet: packet([command(1)]),
    now: 1_100,
    currentCollisionRevision: 0,
  });

  assert.equal(result.acceptedCommandCount, 1);
  assert.equal(movementAuthority.commandWindowStartedAt, 1_100);
  assert.equal(movementAuthority.commandsInWindow, 1);
  assert.deepEqual(movementAuthority.pendingCommands.toArray().map((item) => item.seq), [1]);
}

{
  const movementAuthority = authority();
  movementAuthority.movementEpoch = 2;
  const result = ingestMovementCommandPacket({
    authority: movementAuthority,
    packet: packet([command(10, { movementEpoch: 0 })]),
    now: 1_000,
    currentCollisionRevision: 0,
  });

  assert.equal(result.acceptedCommandCount, 0);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, 'movement_command_reject');
  assert.equal(result.events[0].reason, 'epoch_mismatch');
  assert.equal(result.events[0].movementSequence, 10);
  assert.equal(movementAuthority.metrics.lateCommands, 1);
  assert.equal(movementAuthority.correctionReason, 'epoch_mismatch');
}

{
  const movementAuthority = authority();
  movementAuthority.pendingCommands.push(command(1));
  movementAuthority.pendingCommands.push(command(2));
  const result = ingestMovementCommandPacket({
    authority: movementAuthority,
    packet: packet([command(3)]),
    now: 1_000,
    currentCollisionRevision: 0,
    maxServerQueue: 2,
  });

  assert.equal(result.acceptedCommandCount, 1);
  assert.equal(result.overflow, 1);
  assert.equal(result.discardedCommandCount, 3);
  assert.equal(result.shouldMarkQueueOverflowBarrier, true);
  assert.deepEqual(movementAuthority.pendingCommands.toArray().map((item) => item.seq), [1, 2, 3]);
  assert.deepEqual(result.events, [{
    type: 'movement_command_drop',
    movementEpoch: 0,
    reason: 'queue_overflow',
    detail: {
      overflow: 1,
      discardedCommands: 3,
      maxQueue: 2,
      policy: 'clear_queue_on_barrier',
    },
  }]);
  assert.equal(movementAuthority.metrics.droppedCommands, 3);
  assert.equal(movementAuthority.metrics.queueLength, 3);
}

const emptyDrain = getMovementCommandDrainDecision(0);
assert.equal(emptyDrain.budget, 0);
assert.equal(emptyDrain.underflow, true);

const warmupDrain = getMovementCommandDrainDecision(SERVER_MOVEMENT_TARGET_PENDING_COMMANDS - 1);
assert.equal(warmupDrain.budget, 0);
assert.equal(warmupDrain.underflow, true);

const steadyDrain = getMovementCommandDrainDecision(SERVER_MOVEMENT_TARGET_PENDING_COMMANDS);
assert.equal(steadyDrain.budget, SERVER_MOVEMENT_SUBSTEPS_PER_TICK);
assert.equal(steadyDrain.underflow, false);
assert.equal(steadyDrain.catchup, false);

const barrierDrain = getMovementCommandDrainDecision(1, { hasAuthorityBarrier: true });
assert.equal(barrierDrain.budget, 1);
assert.equal(barrierDrain.underflow, false);

assert.ok(
  MOVEMENT_COMMAND_STALE_GRACE_STEPS >= MOVEMENT_MAX_PACKET_COMMANDS,
  'previous-epoch grace should cover one full in-flight movement packet'
);
assert.ok(
  movementSeqDistance(1956, 1963) <= MOVEMENT_COMMAND_STALE_GRACE_STEPS,
  'teleport barrier grace should cover the observed localhost in-flight sequence gap'
);

const catchupDrain = getMovementCommandDrainDecision(
  SERVER_MOVEMENT_TARGET_PENDING_COMMANDS + SERVER_MOVEMENT_SUBSTEPS_PER_TICK * 3
);
assert.equal(catchupDrain.catchup, true);
assert.ok(catchupDrain.budget > SERVER_MOVEMENT_SUBSTEPS_PER_TICK);

assert.ok(
  SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS > MOVEMENT_MAX_SERVER_QUEUE / 2,
  'moderate production backlog should catch up before forcing an epoch barrier'
);
assert.ok(SERVER_MOVEMENT_BACKLOG_TRIM_TARGET_COMMANDS >= SERVER_MOVEMENT_TARGET_PENDING_COMMANDS);
assert.equal(getMovementBacklogTrimCount(SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS), 0);
assert.equal(
  getMovementBacklogTrimCount(SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS + 1),
  SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS + 1 - SERVER_MOVEMENT_BACKLOG_TRIM_TARGET_COMMANDS
);

function simulateDrainCadence(arrivalsPerTick: readonly number[]) {
  const cadenceQueue = new MovementCommandQueue(128);
  let seq = 1;
  const samples: Array<{
    before: number;
    after: number;
    processed: number;
    underflow: boolean;
    catchup: boolean;
  }> = [];

  for (const arrivals of arrivalsPerTick) {
    for (let index = 0; index < arrivals; index++) {
      cadenceQueue.push(command(seq++));
    }

    const before = cadenceQueue.length;
    const decision = getMovementCommandDrainDecision(before);
    let processed = 0;
    for (let step = 0; step < decision.budget; step++) {
      if (cadenceQueue.pop()) processed++;
    }

    samples.push({
      before,
      after: cadenceQueue.length,
      processed,
      underflow: decision.underflow,
      catchup: decision.catchup,
    });
  }

  return samples;
}

const steadyCadence = simulateDrainCadence(Array.from({ length: 90 }, () => SERVER_MOVEMENT_SUBSTEPS_PER_TICK));
assert.equal(steadyCadence[0].underflow, true, 'first localhost tick should warm the input buffer');
for (const sample of steadyCadence.slice(1)) {
  assert.equal(sample.before, SERVER_MOVEMENT_TARGET_PENDING_COMMANDS);
  assert.equal(sample.processed, SERVER_MOVEMENT_SUBSTEPS_PER_TICK);
  assert.equal(sample.after, SERVER_MOVEMENT_TARGET_PENDING_COMMANDS - SERVER_MOVEMENT_SUBSTEPS_PER_TICK);
  assert.equal(sample.underflow, false);
  assert.equal(sample.catchup, false);
}

const burstCadence = simulateDrainCadence([
  SERVER_MOVEMENT_TARGET_PENDING_COMMANDS + SERVER_MOVEMENT_SUBSTEPS_PER_TICK * 4,
  0,
  0,
]);
assert.equal(burstCadence[0].catchup, true);
assert.ok(
  burstCadence[0].processed < burstCadence[0].before,
  'catchup must drain backlog gradually instead of reflecting packet bursts'
);

console.log('movement command queue tests passed');
