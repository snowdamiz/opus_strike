import assert from 'node:assert/strict';
import {
  MOVEMENT_COMMAND_STALE_GRACE_STEPS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_MAX_SERVER_QUEUE,
  movementSeqDistance,
  type MovementCommand,
} from '@voxel-strike/shared';
import { MovementCommandQueue } from '../rooms/MovementCommandQueue';
import {
  SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS,
  SERVER_MOVEMENT_BACKLOG_TRIM_TARGET_COMMANDS,
  SERVER_MOVEMENT_SUBSTEPS_PER_TICK,
  SERVER_MOVEMENT_TARGET_PENDING_COMMANDS,
  getMovementBacklogTrimCount,
  getMovementCommandDrainDecision,
} from '../rooms/movementCommandDrain';

function command(seq: number): MovementCommand {
  return {
    seq,
    buttons: 0,
    lookYaw: 0,
    lookPitch: 0,
    clientTimeMs: seq,
    movementEpoch: 0,
    collisionRevision: 0,
  };
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
