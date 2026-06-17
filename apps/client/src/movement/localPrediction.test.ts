import assert from 'node:assert/strict';
import {
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  createEmptyInputState,
  movementButtonsToInputState,
} from '@voxel-strike/shared';
import type { Player } from '@voxel-strike/shared';
import type { MovementSimulationState } from '@voxel-strike/physics';
import {
  applySelfMovementAuthority,
  createLocalMovementCommand,
  getLocalMovementCollisionRevision,
  predictLocalBlazeRocketJump,
  resetLocalMovementPrediction,
  setLocalMovementRootedUntil,
} from './localPrediction';

function state(): MovementSimulationState {
  return {
    position: { x: 4, y: 7, z: -2 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: {
      isGrounded: true,
      isSprinting: false,
      isCrouching: false,
      isSliding: false,
      slideTimeRemaining: 0,
      isWallRunning: false,
      wallRunSide: null,
      isGrappling: false,
      grapplePoint: null,
      isJetpacking: false,
      jetpackFuel: 1,
      isGliding: false,
    },
  };
}

resetLocalMovementPrediction(state(), 5, 'player-a', {
  lastAckSeq: 42,
  collisionRevision: 3,
});

const command = createLocalMovementCommand(createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 1000,
});

assert.equal(command.movementEpoch, 5);
assert.equal(command.seq, 43);
assert.equal(command.collisionRevision, 3);
assert.equal(getLocalMovementCollisionRevision(), 3);

setLocalMovementRootedUntil(2000, 1000);
const rootedInput = createEmptyInputState();
rootedInput.moveForward = true;
rootedInput.jump = true;
rootedInput.sprint = true;
rootedInput.primaryFire = true;

const rootedCommand = createLocalMovementCommand(rootedInput, {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 1200,
});
const rootedButtons = movementButtonsToInputState(rootedCommand.buttons);
assert.equal(rootedButtons.moveForward, false);
assert.equal(rootedButtons.jump, false);
assert.equal(rootedButtons.sprint, false);
assert.equal(rootedButtons.primaryFire, true);

const player = {
  id: 'player-a',
  team: 'red',
  heroId: 'hookshot',
  position: { x: 4, y: 7, z: -2 },
  velocity: { x: 0, y: 0, z: 0 },
  movement: state().movement,
  hasFlag: false,
  abilities: {},
} as Player;

applySelfMovementAuthority(player, {
  serverTick: 2,
  serverTime: 1500,
  ackSeq: rootedCommand.seq,
  movementEpoch: 5,
  position: { x: 4, y: 7, z: -2 },
  velocity: { x: 0, y: 0, z: 0 },
  lookYaw: 0,
  lookPitch: 0,
  movement: state().movement,
  collisionRevision: 3,
  rootedUntil: 2600,
}, 1500);

const authorityRootedInput = createEmptyInputState();
authorityRootedInput.moveRight = true;
const authorityRootedCommand = createLocalMovementCommand(authorityRootedInput, {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 1600,
});
assert.equal(movementButtonsToInputState(authorityRootedCommand.buttons).moveRight, false);

const releasedInput = createEmptyInputState();
releasedInput.moveLeft = true;
const releasedCommand = createLocalMovementCommand(releasedInput, {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 2700,
});
assert.equal(movementButtonsToInputState(releasedCommand.buttons).moveLeft, true);

const airborneBlazeState: MovementSimulationState = {
  position: { x: 1, y: 5, z: 2 },
  velocity: { x: 0.25, y: 8.5, z: -0.5 },
  movement: {
    ...state().movement,
    isGrounded: false,
  },
};
const blazePlayer = {
  ...player,
  id: 'blaze-player',
  heroId: 'blaze',
  position: airborneBlazeState.position,
  velocity: airborneBlazeState.velocity,
  movement: airborneBlazeState.movement,
} as Player;
resetLocalMovementPrediction(airborneBlazeState, 0, blazePlayer.id);
const rocketJumpFromAirborneState = predictLocalBlazeRocketJump(blazePlayer, 0);
assert.equal(
  rocketJumpFromAirborneState.velocity.y,
  airborneBlazeState.velocity.y + BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  'Blaze rocket jump should stack with existing upward airborne velocity'
);
assert.equal(
  rocketJumpFromAirborneState.velocity.z,
  airborneBlazeState.velocity.z - BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE
);
assert.equal(rocketJumpFromAirborneState.movement.isGrounded, false);

console.log('local prediction tests passed');
