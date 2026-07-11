import assert from 'node:assert/strict';
import {
  PHANTOM_RIFT_BOLT_LIFETIME_MS,
  PHANTOM_RIFT_BOLT_MAX_DISTANCE,
  PHANTOM_RIFT_BOLT_SPEED,
  getPhantomRiftBoltPosition,
} from '@voxel-strike/shared';
import { PhantomRiftBoltTracker } from '../rooms/phantomRiftBolt';

const tracker = new PhantomRiftBoltTracker();
const launched = tracker.launch({
  castId: 'rift-1',
  ownerId: 'phantom',
  ownerTeam: 'red',
  startPosition: { x: 1, y: 2, z: 3 },
  direction: { x: 0, y: 0, z: -1 },
  launchedAt: 1_000,
});

assert.equal(launched.expiresAt, 1_000 + PHANTOM_RIFT_BOLT_LIFETIME_MS);
assert.deepEqual(getPhantomRiftBoltPosition(launched, 1_500), {
  x: 1,
  y: 2,
  z: 3 - PHANTOM_RIFT_BOLT_SPEED / 2,
});

const firstResult = tracker.advance(1_500);
const firstAdvance = firstResult.advances[0];
assert.ok(firstAdvance);
assert.equal(firstAdvance.distance, PHANTOM_RIFT_BOLT_SPEED / 2);
const reusedStartPosition = firstAdvance.startPosition;
const reusedEndPosition = firstAdvance.endPosition;
const secondResult = tracker.advance(1_600);
assert.equal(secondResult, firstResult);
assert.equal(secondResult.advances[0], firstAdvance);
assert.equal(secondResult.advances[0]?.startPosition, reusedStartPosition);
assert.equal(secondResult.advances[0]?.endPosition, reusedEndPosition);
assert.deepEqual(secondResult.advances[0]?.startPosition, {
  x: 1,
  y: 2,
  z: 3 - PHANTOM_RIFT_BOLT_SPEED / 2,
});

tracker.stop('phantom', { x: 1, y: 2, z: -2 });
const stoppedResult = tracker.advance(2_000);
assert.equal(stoppedResult, firstResult);
assert.deepEqual(stoppedResult.advances, []);
assert.deepEqual(tracker.get('phantom')?.position, { x: 1, y: 2, z: -2 });
assert.equal(tracker.consume('phantom')?.castId, 'rift-1');
assert.equal(tracker.get('phantom'), null);

tracker.launch({
  castId: 'rift-2',
  ownerId: 'phantom',
  ownerTeam: 'red',
  startPosition: { x: 0, y: 0, z: 0 },
  direction: { x: 1, y: 0, z: 0 },
  launchedAt: 5_000,
});
const maxRangeAdvance = tracker.advance(5_000 + PHANTOM_RIFT_BOLT_LIFETIME_MS - 1).advances[0];
assert.ok(maxRangeAdvance);
assert.equal(maxRangeAdvance.endPosition.x, PHANTOM_RIFT_BOLT_MAX_DISTANCE);
assert.equal(maxRangeAdvance.state.stopped, true);
assert.equal(tracker.advance(5_000 + PHANTOM_RIFT_BOLT_LIFETIME_MS).expired.length, 1);
const emptyResult = tracker.advance(5_000 + PHANTOM_RIFT_BOLT_LIFETIME_MS + 1);
assert.deepEqual(emptyResult.advances, []);
assert.deepEqual(emptyResult.expired, []);

console.log('phantom rift bolt tests passed');
