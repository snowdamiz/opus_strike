import assert from 'node:assert/strict';
import {
  CHRONOS_AEGIS_SHIELD_HALF_WIDTH,
  getChronosAegisCenter,
  getSegmentHitAgainstChronosAegis,
} from '../dist/index.js';

const chronosPose = {
  playerId: 'chronos',
  position: { x: 0, y: 0, z: 0 },
  lookYaw: 0,
};

const frontHit = getSegmentHitAgainstChronosAegis(
  { x: 0, y: 1, z: -6 },
  { x: 0, y: 0, z: 1 },
  8,
  chronosPose
);
assert.ok(frontHit, 'front-facing skill segment should hit Chronos Aegis');
assert.equal(frontHit.playerId, 'chronos');

const backMiss = getSegmentHitAgainstChronosAegis(
  { x: 0, y: 1, z: 2 },
  { x: 0, y: 0, z: -1 },
  8,
  chronosPose
);
assert.equal(backMiss, null, 'skills from behind Chronos should not collide with the forward Aegis');

const radiusExpandedHit = getSegmentHitAgainstChronosAegis(
  { x: CHRONOS_AEGIS_SHIELD_HALF_WIDTH + 0.1, y: 1, z: -6 },
  { x: 0, y: 0, z: 1 },
  8,
  chronosPose,
  { projectileRadius: 0.2 }
);
assert.ok(radiusExpandedHit, 'projectile radius should expand Aegis skill collision bounds');

const skyPose = {
  playerId: 'chronos',
  position: { x: 0, y: 0, z: 0 },
  lookYaw: 0,
  lookPitch: Math.PI / 2 - 0.05,
};
const skyShieldCenter = getChronosAegisCenter(skyPose);
const skyHit = getSegmentHitAgainstChronosAegis(
  { x: skyShieldCenter.x, y: skyShieldCenter.y + 6, z: skyShieldCenter.z },
  { x: 0, y: -1, z: 0 },
  9,
  skyPose,
  { projectileRadius: 0.65 }
);
assert.ok(skyHit, 'pitching Aegis upward should block a descending meteor-like skill segment');

console.log('chronos aegis collision tests passed');
