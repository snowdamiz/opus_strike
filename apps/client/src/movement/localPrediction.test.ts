import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED,
  BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED,
  BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED,
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  PITCH_LIMIT,
  createEmptyInputState,
  movementButtonsToInputState,
} from '@voxel-strike/shared';
import type { Player } from '@voxel-strike/shared';
import type { MovementSimulationState } from '@voxel-strike/physics';
import {
  applySelfMovementAuthority,
  createLocalMovementCommand,
  drainSelfMovementAuthorities,
  enqueueSelfMovementAuthority,
  getLocalMovementCollisionRevision,
  predictLocalBattleRoyalDrop,
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

const hintedCommand = createLocalMovementCommand(createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 1100,
  abilityCastHints: [{
    abilityId: 'phantom_dire_ball',
    socketName: 'phantom.primary.right',
    origin: { x: 1.234, y: 2.345, z: -3.456 },
    aimPoint: { x: 10.123, y: 4.567, z: -20.891 },
    sampledAtMs: 1099.6,
  }],
});
assert.equal(hintedCommand.abilityCastHints?.length, 1);
assert.deepEqual(hintedCommand.abilityCastHints?.[0], {
  abilityId: 'phantom_dire_ball',
  socketName: 'phantom.primary.right',
  origin: { x: 1.23, y: 2.35, z: -3.46 },
  aimPoint: { x: 10.120000000000001, y: 4.57, z: -20.89 },
  sampledAtMs: 1100,
});

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

resetLocalMovementPrediction(state(), 5, 'player-a', {
  lastAckSeq: 50,
  collisionRevision: 3,
});
const duplicateAckAuthority = {
  serverTick: 3,
  serverTime: 2800,
  ackSeq: 50,
  movementEpoch: 5,
  position: { x: 4, y: 5.5, z: -2 },
  velocity: { x: 0, y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, z: 0 },
  lookYaw: 0,
  lookPitch: 0,
  movement: {
    ...state().movement,
    isGrounded: false,
    isJetpacking: true,
  },
  collisionRevision: 3,
};
enqueueSelfMovementAuthority(duplicateAckAuthority);
assert.equal(drainSelfMovementAuthorities(player, 2800).length, 0);
enqueueSelfMovementAuthority({
  ...duplicateAckAuthority,
  serverTime: 2900,
  position: { x: 4, y: 2.3, z: -2 },
});
const duplicateAckApplications = drainSelfMovementAuthorities(player, 2900, {
  includeDuplicateAckAuthorities: true,
});
assert.equal(duplicateAckApplications.length, 1);
assert.deepEqual(duplicateAckApplications[0].authority.position, { x: 4, y: 2.3, z: -2 });

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

const dropStartState: MovementSimulationState = {
  position: { x: 0, y: 20, z: 0 },
  velocity: { x: 0, y: -BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED, z: 0 },
  movement: {
    ...state().movement,
    isGrounded: false,
    isJetpacking: true,
  },
};
const dropPlayer = {
  ...player,
  id: 'drop-player',
  state: 'dropping',
  position: dropStartState.position,
  velocity: dropStartState.velocity,
  movement: dropStartState.movement,
} as Player;
resetLocalMovementPrediction(dropStartState, 0, dropPlayer.id);
const predictedDropState = predictLocalBattleRoyalDrop(dropPlayer, createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: 0,
  deltaTime: 0.08,
  nowMs: 3_000,
});
assert.equal(predictedDropState.position.y < dropStartState.position.y, true);
assert.equal(predictedDropState.position.z < dropStartState.position.z, true);
assert.equal(predictedDropState.movement.isJetpacking, true);

resetLocalMovementPrediction(dropStartState, 0, dropPlayer.id);
const glidingDropState = predictLocalBattleRoyalDrop(dropPlayer, createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: PITCH_LIMIT,
  deltaTime: 0.08,
  nowMs: 3_100,
});
resetLocalMovementPrediction(dropStartState, 0, dropPlayer.id);
const divingDropState = predictLocalBattleRoyalDrop(dropPlayer, createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: -PITCH_LIMIT,
  deltaTime: 0.08,
  nowMs: 3_200,
});
assert.equal(glidingDropState.velocity.y, -BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED);
assert.equal(divingDropState.velocity.y, -BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED);
assert.equal(glidingDropState.position.y > divingDropState.position.y, true);
assert.equal(glidingDropState.position.z < predictedDropState.position.z, true);
assert.equal(divingDropState.position.z > predictedDropState.position.z, true);
assert.equal(Math.abs(divingDropState.velocity.z) < Math.abs(predictedDropState.velocity.z) * 0.12, true);

console.log('local prediction tests passed');
