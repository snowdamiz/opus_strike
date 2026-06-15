import assert from 'node:assert/strict';
import {
  createEmptyInputState,
  movementButtonsToInputState,
} from '@voxel-strike/shared';
import type { Player } from '@voxel-strike/shared';
import type { MovementSimulationState } from '@voxel-strike/physics';
import {
  applySelfMovementAuthority,
  createLocalMovementCommand,
  getLocalMovementCollisionRevision,
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

console.log('local prediction tests passed');
