import assert from 'node:assert/strict';
import { createEmptyInputState } from '@voxel-strike/shared';
import type { MovementSimulationState } from '@voxel-strike/physics';
import {
  createLocalMovementCommand,
  getLocalMovementCollisionRevision,
  resetLocalMovementPrediction,
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

console.log('local prediction tests passed');
