import assert from 'node:assert/strict';
import type { PlayerMovementState } from '@voxel-strike/shared';
import {
  getRemoteMovementEffectMode,
  getRemoteMovementEffectStyle,
  getRemoteMovementEmissionRate,
  getRemoteMovementParticleCapacity,
} from './RemoteMovementEffects';

const groundedMovement: Pick<PlayerMovementState, 'isGrounded' | 'isSliding' | 'isSprinting'> = {
  isGrounded: true,
  isSliding: false,
  isSprinting: false,
};

assert.equal(getRemoteMovementEffectStyle('frost').label, 'snow kickup');
assert.equal(getRemoteMovementEffectStyle('desert').label, 'sand kickup');
assert.equal(getRemoteMovementEffectStyle('volcanic').label, 'ash cinders');
assert.equal(getRemoteMovementEffectStyle('sakura').shape, 'petal');

assert.equal(
  getRemoteMovementEffectMode({
    playerState: 'alive',
    movement: groundedMovement,
    horizontalSpeed: 0.1,
  }),
  'idle'
);
assert.equal(
  getRemoteMovementEffectMode({
    playerState: 'alive',
    movement: groundedMovement,
    horizontalSpeed: 2.1,
  }),
  'walk'
);
assert.equal(
  getRemoteMovementEffectMode({
    playerState: 'alive',
    movement: { ...groundedMovement, isSprinting: true },
    horizontalSpeed: 4.2,
  }),
  'run'
);
assert.equal(
  getRemoteMovementEffectMode({
    playerState: 'alive',
    movement: { ...groundedMovement, isSliding: true },
    horizontalSpeed: 5.8,
  }),
  'slide'
);
assert.equal(
  getRemoteMovementEffectMode({
    playerState: 'dead',
    movement: { ...groundedMovement, isSliding: true },
    horizontalSpeed: 8,
  }),
  'idle'
);

const walkRate = getRemoteMovementEmissionRate('walk', 3);
const runRate = getRemoteMovementEmissionRate('run', 6);
const slideRate = getRemoteMovementEmissionRate('slide', 8);
assert.ok(walkRate > 0);
assert.ok(runRate > walkRate);
assert.ok(slideRate > runRate);

assert.equal(getRemoteMovementParticleCapacity(0), 24);
assert.equal(getRemoteMovementParticleCapacity(96), 28);
assert.equal(getRemoteMovementParticleCapacity(520), 156);
assert.equal(getRemoteMovementParticleCapacity(1000), 160);

console.log('remote movement effect tests passed');
