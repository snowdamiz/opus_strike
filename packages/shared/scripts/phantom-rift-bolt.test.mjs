import assert from 'node:assert/strict';
import {
  PHANTOM_RIFT_BOLT_MAX_DISTANCE,
  PHANTOM_RIFT_BOLT_SPEED,
  getPhantomRiftBoltPosition,
  getPhantomRiftBoltTravelDistance,
  writePhantomRiftBoltPosition,
} from '../dist/index.js';

const path = {
  startPosition: { x: 2, y: 4, z: 6 },
  direction: { x: 0, y: 0, z: -1 },
  launchedAt: 1_000,
};

assert.equal(getPhantomRiftBoltTravelDistance(1_000, 1_500), PHANTOM_RIFT_BOLT_SPEED / 2);
assert.equal(getPhantomRiftBoltTravelDistance(1_000, 0), 0);
assert.equal(getPhantomRiftBoltTravelDistance(1_000, 60_000), PHANTOM_RIFT_BOLT_MAX_DISTANCE);
assert.deepEqual(getPhantomRiftBoltPosition(path, 1_500), {
  x: 2,
  y: 4,
  z: 6 - PHANTOM_RIFT_BOLT_SPEED / 2,
});

const output = {};
assert.equal(writePhantomRiftBoltPosition(output, {
  ...path,
  impactPosition: { x: 8, y: 3, z: -2 },
}, 9_000), output);
assert.deepEqual(output, { x: 8, y: 3, z: -2 });

console.log('phantom rift bolt shared tests passed');
