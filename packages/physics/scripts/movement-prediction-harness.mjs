import assert from 'node:assert/strict';
import {
  createHookshotSwingState,
  MovementPredictionController,
  simulateSharedMovement,
  stepHookshotSwing,
} from '../dist/index.js';
import {
  HERO_DEFINITIONS,
  MOVEMENT_BUTTON_ABILITY_1,
  MOVEMENT_BUTTON_CROUCH,
  MOVEMENT_BUTTON_CROUCH_PRESSED,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  MOVEMENT_BUTTON_RELOAD,
  MOVEMENT_BUTTON_SPRINT,
  MOVEMENT_BUTTON_UNSTUCK,
  MOVEMENT_PROTOCOL_VERSION,
  createEmptyInputState,
  inputStateToMovementButtons,
  movementButtonsForHeldCommand,
  movementButtonsToInputState,
} from '@voxel-strike/shared';

const EPSILON = 1e-6;

const terrain = {
  getGroundY: () => 0,
  clampPosition: (position) => ({
    x: Math.max(-50, Math.min(50, position.x)),
    y: Math.max(-20, Math.min(120, position.y)),
    z: Math.max(-50, Math.min(50, position.z)),
  }),
  getBlockAtWorld: () => 0,
};

function createMovementState() {
  return {
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
    jetpackFuel: 100,
    isGliding: false,
  };
}

function createSimulationState() {
  return {
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: createMovementState(),
  };
}

function context() {
  return {
    heroStats: HERO_DEFINITIONS.phantom.stats,
    terrain,
    flagCarrier: false,
    activeSpeedMultiplier: 1,
  };
}

function command(seq, buttons, yaw = 0, epoch = 0) {
  return {
    seq,
    buttons,
    lookYaw: yaw,
    lookPitch: 0,
    clientTimeMs: seq * 16.6667,
    movementEpoch: epoch,
    collisionRevision: 0,
  };
}

function assertVecNear(actual, expected, label) {
  assert.ok(Math.abs(actual.x - expected.x) <= EPSILON, `${label}.x expected ${expected.x}, got ${actual.x}`);
  assert.ok(Math.abs(actual.y - expected.y) <= EPSILON, `${label}.y expected ${expected.y}, got ${actual.y}`);
  assert.ok(Math.abs(actual.z - expected.z) <= EPSILON, `${label}.z expected ${expected.z}, got ${actual.z}`);
}

function runDeterministicReplay() {
  const buttons = MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT;
  const commands = Array.from({ length: 36 }, (_, index) => command(index + 1, buttons));
  const client = new MovementPredictionController();
  const server = new MovementPredictionController();
  client.initialize(createSimulationState(), 0, 0);
  server.initialize(createSimulationState(), 0, 0);

  for (const movementCommand of commands) {
    client.step(movementCommand, context());
    server.step(movementCommand, context());
  }

  assertVecNear(client.getState().position, server.getState().position, 'deterministic position');
  assertVecNear(client.getState().velocity, server.getState().velocity, 'deterministic velocity');
}

function runYawConvention() {
  const result = simulateSharedMovement({
    position: createSimulationState().position,
    velocity: createSimulationState().velocity,
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      moveForward: true,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      jump: false,
      crouch: false,
      sprint: false,
    },
    lookYaw: Math.PI / 2,
    deltaTime: 1 / 60,
    terrain,
  });

  assert.ok(result.velocity.x < 0, `forward at +90deg yaw should move negative X, got ${result.velocity.x}`);
  assert.ok(Math.abs(result.velocity.z) < Math.abs(result.velocity.x), `forward at +90deg yaw should mostly move on X, got Z ${result.velocity.z}`);
}

function runDuplicateAckNoop() {
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  controller.step(command(1, MOVEMENT_BUTTON_MOVE_FORWARD), context());
  const stateAtAck = controller.getState();
  const authority = {
    serverTick: 1,
    serverTime: 50,
    ackSeq: 1,
    movementEpoch: 0,
    position: stateAtAck.position,
    velocity: stateAtAck.velocity,
    lookYaw: 0,
    lookPitch: 0,
    movement: stateAtAck.movement,
    correctionReason: 'normal',
  };

  const first = controller.reconcile(authority, context(), 60);
  assert.equal(first.corrected, false);
  assert.equal(controller.getBufferedCommandCount(), 0);

  const duplicate = controller.reconcile({ ...authority, correctionReason: undefined }, context(), 110);
  assert.equal(duplicate.corrected, false);
  assert.equal(controller.getBufferedCommandCount(), 0);
}

function runSlideRequiresFreshCrouchPress() {
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  const heldSlideButtons = MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT | MOVEMENT_BUTTON_CROUCH;
  const firstSlideButtons = heldSlideButtons | MOVEMENT_BUTTON_CROUCH_PRESSED;

  controller.step(command(1, firstSlideButtons), context());
  assert.equal(controller.getState().movement.isSliding, true, 'fresh crouch press should start slide');

  for (let seq = 2; seq <= 120; seq++) {
    controller.step(command(seq, heldSlideButtons), context());
  }

  const heldState = controller.getState().movement;
  assert.equal(heldState.isSliding, false, 'holding crouch after slide cooldown must not start another slide');
  assert.equal(heldState.isCrouching, true, 'held crouch should still produce crouch posture after slide');

  const releasedButtons = MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT;
  for (let seq = 121; seq <= 124; seq++) {
    controller.step(command(seq, releasedButtons), context());
  }

  controller.step(command(125, firstSlideButtons), context());
  assert.equal(controller.getState().movement.isSliding, true, 'a second fresh crouch press should start a new slide');
}

function runHeldCommandStripsEdgeButtons() {
  const buttons =
    MOVEMENT_BUTTON_MOVE_FORWARD |
    MOVEMENT_BUTTON_SPRINT |
    MOVEMENT_BUTTON_CROUCH |
    MOVEMENT_BUTTON_CROUCH_PRESSED |
    MOVEMENT_BUTTON_RELOAD |
    MOVEMENT_BUTTON_ABILITY_1 |
    MOVEMENT_BUTTON_UNSTUCK;

  const heldButtons = movementButtonsForHeldCommand(buttons);
  const heldInput = movementButtonsToInputState(heldButtons);

  assert.equal(heldInput.moveForward, true);
  assert.equal(heldInput.sprint, true);
  assert.equal(heldInput.crouch, true);
  assert.equal(heldInput.crouchPressed, false);
  assert.equal(heldInput.reload, false);
  assert.equal(heldInput.ability1, false);
  assert.equal(heldInput.unstuck, false);
}

function runCorrectionReplay() {
  const input = createEmptyInputState();
  input.moveForward = true;
  const buttons = inputStateToMovementButtons(input);
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  const commands = Array.from({ length: 8 }, (_, index) => command(index + 1, buttons));
  for (const movementCommand of commands) {
    controller.step(movementCommand, context());
  }

  const predictedAtAck = new MovementPredictionController();
  predictedAtAck.initialize(createSimulationState(), 0, 0);
  for (const movementCommand of commands.slice(0, 4)) {
    predictedAtAck.step(movementCommand, context());
  }
  const ackState = predictedAtAck.getState();
  const authority = {
    serverTick: 100,
    serverTime: 1000,
    ackSeq: 4,
    movementEpoch: 0,
    position: { x: ackState.position.x + 0.2, y: ackState.position.y, z: ackState.position.z },
    velocity: ackState.velocity,
    lookYaw: 0,
    lookPitch: 0,
    movement: ackState.movement,
    correctionReason: 'normal',
  };
  const metrics = controller.reconcile(authority, context(), 1100);
  assert.equal(metrics.corrected, true);
  assert.equal(metrics.replayedCommands, 4);
  assert.equal(controller.getBufferedCommandCount(), 4);
  assert.equal(Number.isFinite(controller.getState().position.x), true);
}

function runOverwriteUpdatesLatestAckState() {
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  controller.step(command(1, MOVEMENT_BUTTON_MOVE_FORWARD), context());

  const overwritten = controller.getState();
  overwritten.position.x += 0.5;
  overwritten.velocity.x += 1;
  controller.overwriteState(overwritten, { updateLatestCommandRecord: true });

  const metrics = controller.reconcile({
    serverTick: 2,
    serverTime: 100,
    ackSeq: 1,
    movementEpoch: 0,
    position: overwritten.position,
    velocity: overwritten.velocity,
    lookYaw: 0,
    lookPitch: 0,
    movement: overwritten.movement,
  }, context(), 120);

  assert.equal(metrics.corrected, false);
  assert.equal(controller.getBufferedCommandCount(), 0);
}

function runOverwriteDefaultsToExternalCorrection() {
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  controller.step(command(1, MOVEMENT_BUTTON_MOVE_FORWARD), context());

  const overwritten = controller.getState();
  overwritten.position.x += 0.5;
  overwritten.velocity.x += 1;
  controller.overwriteState(overwritten);

  const metrics = controller.reconcile({
    serverTick: 2,
    serverTime: 100,
    ackSeq: 1,
    movementEpoch: 0,
    position: overwritten.position,
    velocity: overwritten.velocity,
    lookYaw: 0,
    lookPitch: 0,
    movement: overwritten.movement,
  }, context(), 120);

  assert.equal(metrics.corrected, true);
  assert.equal(controller.getBufferedCommandCount(), 0);
  assertVecNear(controller.getState().position, overwritten.position, 'external correction position');
}

function runEpochBarrier() {
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  controller.step(command(1, MOVEMENT_BUTTON_MOVE_FORWARD), context());
  controller.step(command(2, MOVEMENT_BUTTON_MOVE_FORWARD), context());

  const authority = {
    serverTick: 20,
    serverTime: 500,
    ackSeq: 2,
    movementEpoch: 1,
    position: { x: 5, y: 0.9, z: 5 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    movement: createMovementState(),
    correctionReason: 'teleport',
  };
  const metrics = controller.reconcile(authority, context(), 600);
  assert.equal(metrics.hardCorrection, true);
  assert.equal(controller.getMovementEpoch(), 1);
  assert.equal(controller.getBufferedCommandCount(), 0);
  assertVecNear(controller.getState().position, authority.position, 'barrier position');
}

function runVoxelWallBlocksMovement() {
  const wallTerrain = {
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.z <= -0.5 &&
      position.z >= -1.5 &&
      position.y >= 0 &&
      position.y <= 3 &&
      Math.abs(position.x) <= 2
        ? 1
        : 0
    ),
  };

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -30 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: createEmptyInputState(),
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: wallTerrain,
  });

  assert.ok(result.position.z > -0.5, `solid voxel wall should block movement, got z ${result.position.z}`);
  assert.ok(Math.abs(result.velocity.z) <= EPSILON, `blocked wall velocity should zero Z, got ${result.velocity.z}`);
}

function runVoxelStepUpKeepsMovementSmooth() {
  const stepTerrain = {
    getGroundY: (position) => position.z <= -0.5 ? 0.4 : 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.z <= -0.5 &&
      position.y >= 0 &&
      position.y < 0.4 &&
      Math.abs(position.x) <= 2
        ? 1
        : 0
    ),
  };

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -30 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      ...createEmptyInputState(),
      moveForward: true,
    },
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: stepTerrain,
  });

  assert.ok(result.position.z < -0.5, `low voxel step should allow horizontal movement, got z ${result.position.z}`);
  assert.ok(result.position.y > 0.9, `low voxel step should raise player smoothly, got y ${result.position.y}`);
  assert.equal(result.movement.isGrounded, true);
}

function runVoxelStepUpBeginsAtCapsuleEdge() {
  const stepTerrain = {
    getGroundY: (position) => position.z <= -0.5 ? 0.5 : 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.z <= -0.5 &&
      position.y >= 0 &&
      position.y < 0.5 &&
      Math.abs(position.x) <= 2
        ? 1
        : 0
    ),
  };

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -3 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      ...createEmptyInputState(),
      moveForward: true,
    },
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: stepTerrain,
  });

  assert.ok(result.position.z < -0.25, `capsule edge should glide onto low voxel step, got z ${result.position.z}`);
  assert.ok(result.position.y > 0.9, `capsule-edge step should raise player before center crosses edge, got y ${result.position.y}`);
  assert.ok(result.velocity.z < 0, `capsule-edge step should preserve forward movement, got z velocity ${result.velocity.z}`);
  assert.equal(result.movement.isGrounded, true);
}

function runLegacyHeightStepStillTraverses() {
  const stepTerrain = {
    getGroundY: (position) => position.z <= -0.5 ? 0.75 : 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.z <= -0.5 &&
      position.y >= 0 &&
      position.y < 0.75 &&
      Math.abs(position.x) <= 2
        ? 1
        : 0
    ),
  };

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -3 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      ...createEmptyInputState(),
      moveForward: true,
    },
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: stepTerrain,
  });

  assert.ok(result.position.z < -0.25, `legacy-height terrain step should preserve horizontal movement, got z ${result.position.z}`);
  assert.ok(result.position.y > 1.5, `legacy-height terrain step should raise player, got y ${result.position.y}`);
  assert.ok(result.velocity.z < 0, `legacy-height step should not zero forward velocity, got ${result.velocity.z}`);
  assert.equal(result.movement.isGrounded, true);
}

function runTallVoxelWallStillBlocksMovement() {
  const wallTerrain = {
    getGroundY: (position) => position.z <= -0.5 ? 1.1 : 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.z <= -0.5 &&
      position.y >= 0 &&
      position.y < 1.1 &&
      Math.abs(position.x) <= 2
        ? 1
        : 0
    ),
  };

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -3 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      ...createEmptyInputState(),
      moveForward: true,
    },
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: wallTerrain,
  });

  assert.ok(result.position.z > -0.05, `tall voxel wall should still block movement, got z ${result.position.z}`);
  assert.ok(Math.abs(result.velocity.z) <= EPSILON, `blocked tall wall velocity should zero Z, got ${result.velocity.z}`);
}

function runLowCeilingMaintainsCrouch() {
  const lowCeilingTerrain = {
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.y >= 1.15 &&
      position.y <= 1.8 &&
      Math.abs(position.x) <= 1 &&
      Math.abs(position.z) <= 1
        ? 1
        : 0
    ),
  };

  const state = createMovementState();
  state.isCrouching = true;
  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: state,
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: createEmptyInputState(),
    lookYaw: 0,
    deltaTime: 1 / 60,
    terrain: lowCeilingTerrain,
  });

  assert.equal(result.movement.isCrouching, true, 'low ceiling should keep player crouched after releasing crouch');
}

function runHookshotSwingStep() {
  const swing = createHookshotSwingState(
    { x: 0, y: 0.9, z: 0 },
    { x: 0, y: 8, z: -18 },
    true
  );
  const first = stepHookshotSwing({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    swing,
    input: {
      moveForward: false,
      moveBackward: false,
      moveLeft: true,
      moveRight: false,
      jump: false,
    },
    lookYaw: 0,
    lookPitch: 0,
    isGrounded: true,
    deltaTime: 1 / 60,
  });

  assert.equal(first.ended, false);
  assert.equal(first.swing.initialPullApplied, true);
  assert.notEqual(first.velocity.x, 0, 'strafe input should steer swing');
  assert.ok(first.velocity.y > 0, `initial grapple pull should lift player, got ${first.velocity.y}`);

  const released = stepHookshotSwing({
    position: first.position,
    velocity: first.velocity,
    swing: first.swing,
    input: {
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      jump: true,
    },
    lookYaw: 0,
    lookPitch: 0.4,
    isGrounded: false,
    deltaTime: 1 / 60,
  });

  assert.equal(released.ended, true);
  assert.equal(released.endReason, 'jump');
  assert.ok(released.velocity.y >= 8, `jump release should preserve upward boost, got ${released.velocity.y}`);
}

runDeterministicReplay();
runYawConvention();
runDuplicateAckNoop();
runSlideRequiresFreshCrouchPress();
runHeldCommandStripsEdgeButtons();
runCorrectionReplay();
runOverwriteUpdatesLatestAckState();
runOverwriteDefaultsToExternalCorrection();
runEpochBarrier();
runVoxelWallBlocksMovement();
runVoxelStepUpKeepsMovementSmooth();
runVoxelStepUpBeginsAtCapsuleEdge();
runLegacyHeightStepStillTraverses();
runTallVoxelWallStillBlocksMovement();
runLowCeilingMaintainsCrouch();
runHookshotSwingStep();

console.log(`movement prediction harness passed (protocol ${MOVEMENT_PROTOCOL_VERSION})`);
