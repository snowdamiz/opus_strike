import assert from 'node:assert/strict';
import type { MovementCommand } from '@voxel-strike/shared';
import { MovementCommandQueue } from '../rooms/MovementCommandQueue';

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

console.log('movement command queue tests passed');
