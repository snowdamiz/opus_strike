import assert from 'node:assert/strict';
import { type PlayerInput } from '@voxel-strike/shared';
import {
  PlayerRootTracker,
  isRootBlockedAbility,
  stopRootedMovementState,
  suppressLocomotionInput,
} from '../rooms/playerRootState';

function createInput(): PlayerInput {
  return {
    tick: 1,
    moveForward: true,
    moveBackward: true,
    moveLeft: true,
    moveRight: true,
    jump: true,
    crouch: true,
    sprint: true,
    primaryFire: true,
    secondaryFire: true,
    reload: true,
    ability1: true,
    ability2: true,
    ultimate: true,
    interact: true,
    lookYaw: 1,
    lookPitch: 0.2,
    timestamp: 100,
  };
}

{
  const tracker = new PlayerRootTracker();

  assert.equal(tracker.isRooted('player-a', 100), false);
  assert.equal(tracker.extendRoot('player-a', 200), 200);
  assert.equal(tracker.extendRoot('player-a', 150), 200);
  assert.equal(tracker.getRootedUntil('player-a', 199), 200);
  assert.equal(tracker.isRooted('player-a', 199), true);
  assert.equal(tracker.isRooted('player-a', 200), false);
  assert.equal(tracker.getRootedUntil('player-a', 201), undefined);

  tracker.extendRoot('player-a', 300);
  tracker.extendRoot('player-b', 500);
  tracker.clearExpired(400);
  assert.equal(tracker.isRooted('player-a', 400), false);
  assert.equal(tracker.isRooted('player-b', 400), true);
  assert.equal(tracker.clear('player-b'), true);
  assert.equal(tracker.clear('player-b'), false);
}

{
  assert.equal(isRootBlockedAbility('hookshot_grapple'), true);
  assert.equal(isRootBlockedAbility('blaze_rocketjump'), true);
  assert.equal(isRootBlockedAbility('blaze_afterburner'), true);
  assert.equal(isRootBlockedAbility('phantom_void_ray'), false);
  assert.equal(isRootBlockedAbility(undefined), false);
}

{
  const input = createInput();
  const suppressed = suppressLocomotionInput(input);

  assert.notEqual(suppressed, input);
  assert.equal(suppressed.moveForward, false);
  assert.equal(suppressed.moveBackward, false);
  assert.equal(suppressed.moveLeft, false);
  assert.equal(suppressed.moveRight, false);
  assert.equal(suppressed.jump, false);
  assert.equal(suppressed.crouch, false);
  assert.equal(suppressed.sprint, false);
  assert.equal(suppressed.primaryFire, true);
  assert.equal(suppressed.secondaryFire, true);
  assert.equal(suppressed.lookYaw, input.lookYaw);
}

{
  const player = {
    velocity: { x: 3, y: 4, z: 5 },
    movement: {
      isSprinting: true,
      isSliding: true,
      slideTimeRemaining: 2,
      isWallRunning: true,
      wallRunSide: 'left',
      isGrappling: true,
      isJetpacking: true,
      isGliding: true,
    },
  };

  stopRootedMovementState(player);

  assert.deepEqual(player.velocity, { x: 0, y: 4, z: 0 });
  assert.equal(player.movement.isSprinting, false);
  assert.equal(player.movement.isSliding, false);
  assert.equal(player.movement.slideTimeRemaining, 0);
  assert.equal(player.movement.isWallRunning, false);
  assert.equal(player.movement.wallRunSide, '');
  assert.equal(player.movement.isGrappling, false);
  assert.equal(player.movement.isJetpacking, false);
  assert.equal(player.movement.isGliding, false);
}

console.log('player root state tests passed');
