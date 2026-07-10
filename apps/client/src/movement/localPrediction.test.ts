import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_DROP_POD_MAX_VERTICAL_SPEED,
  BATTLE_ROYAL_DROP_POD_MIN_VERTICAL_SPEED,
  BATTLE_ROYAL_DROP_POD_VERTICAL_SPEED,
  BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER,
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  BLAZE_AFTERBURNER_DASH_SPEED,
  PITCH_LIMIT,
  createEmptyInputState,
  movementButtonsToInputState,
} from '@voxel-strike/shared';
import type { Player } from '@voxel-strike/shared';
import type { MovementSimulationState } from '@voxel-strike/physics';
import {
  acknowledgeSelfMovementAck,
  applySelfMovementAuthority,
  createLocalMovementCommand,
  drainSelfMovementAuthorities,
  enqueueSelfMovementAuthority,
  getLocalPredictionContext,
  getLocalMovementCollisionRevision,
  predictLocalBattleRoyalDrop,
  predictLocalBlazeAfterburner,
  predictLocalBlazeRocketJump,
  resetLocalMovementPrediction,
  setLocalMovementRootedUntil,
  stepLocalMovementPrediction,
  suppressDownedMovementInput,
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
  state: 'alive',
  position: { x: 4, y: 7, z: -2 },
  velocity: { x: 0, y: 0, z: 0 },
  movement: state().movement,
  hasFlag: false,
  abilities: {},
} as Player;

const downedInput = createEmptyInputState();
downedInput.moveForward = true;
downedInput.moveRight = true;
downedInput.jump = true;
downedInput.sprint = true;
downedInput.primaryFire = true;
downedInput.secondaryFire = true;
downedInput.reload = true;
downedInput.ability1 = true;
downedInput.ability2 = true;
downedInput.ultimate = true;
downedInput.interact = true;
const sanitizedDownedInput = suppressDownedMovementInput(downedInput);
assert.equal(sanitizedDownedInput.moveForward, true);
assert.equal(sanitizedDownedInput.moveRight, true);
assert.equal(sanitizedDownedInput.jump, false);
assert.equal(sanitizedDownedInput.sprint, false);
// Primary fire stays live while downed so LMB can raise the knockdown shield.
assert.equal(sanitizedDownedInput.primaryFire, true);
assert.equal(sanitizedDownedInput.secondaryFire, false);
assert.equal(sanitizedDownedInput.reload, false);
assert.equal(sanitizedDownedInput.ability1, false);
assert.equal(sanitizedDownedInput.ability2, false);
assert.equal(sanitizedDownedInput.ultimate, false);
assert.equal(sanitizedDownedInput.interact, false);
const frozenDownedInput = suppressDownedMovementInput(downedInput, { frozen: true });
assert.equal(frozenDownedInput.moveForward, false);
assert.equal(frozenDownedInput.moveRight, false);

const downedPredictionContext = getLocalPredictionContext({
  ...player,
  state: 'downed',
  heroId: 'chronos',
  powerupBoostUntil: 0,
  abilities: {
    chronos_ascendant_paradox: {
      abilityId: 'chronos_ascendant_paradox',
      cooldownRemaining: 0,
      charges: 1,
      isActive: true,
      activatedAt: 1000,
    },
  },
});
assert.equal(downedPredictionContext.activeSpeedMultiplier, BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER);
assert.equal(downedPredictionContext.chronosAscendantActive, false);

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
  serverTime: 2850,
  collisionRevision: 4,
});
const revisionOnlyApplications = drainSelfMovementAuthorities(player, 2850);
assert.equal(revisionOnlyApplications.length, 1);
assert.equal(revisionOnlyApplications[0].result.corrected, false);
assert.equal(getLocalMovementCollisionRevision(), 4);
const commandAfterRevisionSync = createLocalMovementCommand(createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 2860,
});
assert.equal(commandAfterRevisionSync.collisionRevision, 4);

resetLocalMovementPrediction(state(), 5, 'player-a', {
  lastAckSeq: 50,
  collisionRevision: 4,
});
const ackOnlyResult = acknowledgeSelfMovementAck({
  serverTick: 4,
  serverTime: 2870,
  ackSeq: 60,
  movementEpoch: 5,
  collisionRevision: 6,
});
assert.equal(ackOnlyResult.ackSeq, 60);
assert.equal(ackOnlyResult.corrected, false);
assert.equal(getLocalMovementCollisionRevision(), 6);
const commandAfterAckOnly = createLocalMovementCommand(createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 2875,
});
assert.equal(commandAfterAckOnly.seq, 61);
assert.equal(commandAfterAckOnly.collisionRevision, 6);

enqueueSelfMovementAuthority({
  ...duplicateAckAuthority,
  serverTime: 2900,
  position: { x: 4, y: 2.3, z: -2 },
  collisionRevision: 4,
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

resetLocalMovementPrediction(airborneBlazeState, 0, blazePlayer.id);
const afterburnerFromAirborneState = predictLocalBlazeAfterburner(blazePlayer, 0);
assert.equal(afterburnerFromAirborneState.position.x, airborneBlazeState.position.x);
assert.equal(afterburnerFromAirborneState.position.z, airborneBlazeState.position.z);
assert.equal(afterburnerFromAirborneState.velocity.y, airborneBlazeState.velocity.y);
assert.equal(afterburnerFromAirborneState.velocity.z, -BLAZE_AFTERBURNER_DASH_SPEED);
assert.equal(afterburnerFromAirborneState.movement.isGrounded, false);
assert.equal(afterburnerFromAirborneState.movement.isSliding, false);
const afterburnerStep = stepLocalMovementPrediction(blazePlayer, createLocalMovementCommand(createEmptyInputState(), {
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: Date.now(),
}));
assert.ok(afterburnerStep.position.z < airborneBlazeState.position.z);
assert.ok(afterburnerStep.position.z > airborneBlazeState.position.z - 1);

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
