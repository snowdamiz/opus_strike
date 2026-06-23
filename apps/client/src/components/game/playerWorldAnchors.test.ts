import assert from 'node:assert/strict';
import {
  createDefaultPlayerMovementState,
  PLAYER_CROUCH_HEIGHT,
  PLAYER_HEIGHT,
  PLAYER_SLIDE_HEIGHT,
} from '@voxel-strike/shared';
import {
  CROUCH_BODY_POSTURE_SCALE_Y,
  DOWNED_BODY_POSTURE_SCALE_Y,
  getPlayerBodyPostureScaleY,
  getVisiblePlayerHeight,
  SLIDE_BODY_POSTURE_SCALE_Y,
} from './playerWorldAnchors';

const standingMovement = createDefaultPlayerMovementState();
const crouchingMovement = createDefaultPlayerMovementState({ isCrouching: true });
const slidingMovement = createDefaultPlayerMovementState({ isCrouching: true, isSliding: true });

assert.equal(getVisiblePlayerHeight(null, crouchingMovement), PLAYER_CROUCH_HEIGHT);
assert.equal(getVisiblePlayerHeight(null, slidingMovement), PLAYER_SLIDE_HEIGHT);
assert.equal(getVisiblePlayerHeight(null, standingMovement, 'downed'), PLAYER_SLIDE_HEIGHT);

assert.equal(getPlayerBodyPostureScaleY(standingMovement), 1);
assert.equal(getPlayerBodyPostureScaleY(crouchingMovement), CROUCH_BODY_POSTURE_SCALE_Y);
assert.equal(getPlayerBodyPostureScaleY(slidingMovement), SLIDE_BODY_POSTURE_SCALE_Y);
assert.equal(getPlayerBodyPostureScaleY(standingMovement, 'downed'), DOWNED_BODY_POSTURE_SCALE_Y);

assert.ok(
  CROUCH_BODY_POSTURE_SCALE_Y > PLAYER_CROUCH_HEIGHT / PLAYER_HEIGHT,
  'crouch body scale should stay taller than the crouch collider height ratio'
);
assert.ok(
  SLIDE_BODY_POSTURE_SCALE_Y > PLAYER_SLIDE_HEIGHT / PLAYER_HEIGHT,
  'slide body scale should stay taller than the slide collider height ratio'
);
assert.ok(CROUCH_BODY_POSTURE_SCALE_Y < 1);
assert.ok(SLIDE_BODY_POSTURE_SCALE_Y < CROUCH_BODY_POSTURE_SCALE_Y);
assert.equal(DOWNED_BODY_POSTURE_SCALE_Y, 1);

console.log('player world anchor tests passed');
