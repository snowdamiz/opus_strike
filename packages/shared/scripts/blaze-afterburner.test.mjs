import assert from 'node:assert/strict';
import {
  BLAZE_AFTERBURNER_DASH_SPEED,
  BLAZE_AFTERBURNER_DASH_DURATION_MS,
  BLAZE_AFTERBURNER_MAX_TRAIL_POINTS,
  BLAZE_AFTERBURNER_TRAIL_RADIUS,
  calculateBlazeAfterburnerVelocity,
  getBlazeAfterburnerDirection,
  getSquaredDistanceToBlazeAfterburnerTrail,
} from '../dist/index.js';

assert.deepEqual(getBlazeAfterburnerDirection(0), { x: -0, y: 0, z: -1 });
const rightDashVelocity = calculateBlazeAfterburnerVelocity(
  { x: 3, y: -2, z: 4 },
  -Math.PI / 2,
);
assert.ok(Math.abs(rightDashVelocity.x - BLAZE_AFTERBURNER_DASH_SPEED) < 1e-9);
assert.equal(rightDashVelocity.y, -2);
assert.ok(Math.abs(rightDashVelocity.z) < 1e-9);
assert.ok(BLAZE_AFTERBURNER_DASH_SPEED * BLAZE_AFTERBURNER_DASH_DURATION_MS / 1000 >= 8.5);
assert.equal(BLAZE_AFTERBURNER_TRAIL_RADIUS, 1.35);
assert.ok(BLAZE_AFTERBURNER_MAX_TRAIL_POINTS >= 21);

const trailStart = { x: 0, y: 2, z: 0 };
const trailEnd = { x: 8, y: 2, z: 0 };
assert.equal(getSquaredDistanceToBlazeAfterburnerTrail({ x: 4, y: 3, z: 0 }, trailStart, trailEnd), 1);
assert.equal(getSquaredDistanceToBlazeAfterburnerTrail({ x: 10, y: 2, z: 0 }, trailStart, trailEnd), 4);

console.log('blaze afterburner tests passed');
