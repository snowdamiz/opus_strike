import assert from 'node:assert/strict';
import {
  getBlazePhosphorFlareFlightDurationMs,
  getBlazePhosphorFlarePoint,
  writeBlazePhosphorFlarePoint,
} from '../dist/index.js';

const start = { x: 0, y: 2, z: 0 };
const target = { x: 20, y: 0, z: -10 };

assert.deepEqual(getBlazePhosphorFlarePoint(start, target, 0), start);
assert.deepEqual(getBlazePhosphorFlarePoint(start, target, 1), target);

const midpoint = getBlazePhosphorFlarePoint(start, target, 0.5);
assert.equal(midpoint.x, 10);
assert.equal(midpoint.z, -5);
assert.ok(midpoint.y > start.y, 'the canister path should arc above its launch point');

const output = { x: 99, y: 99, z: 99 };
assert.equal(writeBlazePhosphorFlarePoint(output, start, target, 0.25), output);
assert.notDeepEqual(output, { x: 99, y: 99, z: 99 });

assert.equal(getBlazePhosphorFlareFlightDurationMs(start, start), 620);
assert.equal(
  getBlazePhosphorFlareFlightDurationMs(start, { x: 1_000, y: 0, z: 0 }),
  980,
);

console.log('blaze phosphor flare tests passed');
