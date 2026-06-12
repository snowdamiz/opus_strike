import assert from 'node:assert/strict';
import {
  createVoxelCollisionWorld,
  createHookshotSwingState,
  MovementPredictionController,
  simulateCapsuleMotor,
  simulateSharedMovement,
  sweepCapsulePathClear,
  stepHookshotSwing,
} from '../dist/index.js';
import {
  HERO_DEFINITIONS,
  CHRONOS_ASCENDANT_PARADOX_MAX_ELEVATION_GAIN,
  MOVEMENT_BUTTON_ABILITY_1,
  MOVEMENT_BUTTON_CROUCH,
  MOVEMENT_BUTTON_CROUCH_PRESSED,
  MOVEMENT_BUTTON_MOVE_FORWARD,
  MOVEMENT_BUTTON_RELOAD,
  MOVEMENT_BUTTON_SPRINT,
  MOVEMENT_BUTTON_UNSTUCK,
  MOVEMENT_PROTOCOL_VERSION,
  createProceduralTerrainLookup,
  createEmptyInputState,
  generateProceduralVoxelMap,
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

const fineVoxelGrid = {
  origin: { x: 0, y: 0, z: 0 },
  voxelSize: { x: 0.1, y: 0.1, z: 0.1 },
  collisionRevision: 0,
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

function speed2D(velocity) {
  return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
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

function runNoCorrectionAckRefreshesAuthorityOwnedResources() {
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  controller.step(command(1, MOVEMENT_BUTTON_MOVE_FORWARD), context());
  const stateAtAck = controller.getState();
  const authorityMovement = {
    ...stateAtAck.movement,
    isJetpacking: true,
    jetpackFuel: 42,
  };

  const metrics = controller.reconcile({
    serverTick: 1,
    serverTime: 50,
    ackSeq: 1,
    movementEpoch: 0,
    position: stateAtAck.position,
    velocity: stateAtAck.velocity,
    lookYaw: 0,
    lookPitch: 0,
    movement: authorityMovement,
  }, context(), 60);

  assert.equal(metrics.corrected, false, 'authority-owned resource updates should not create movement corrections');
  assert.equal(controller.getState().movement.isJetpacking, true, 'authority-owned active status should refresh prediction state');
  assert.equal(controller.getState().movement.jetpackFuel, 42, 'fuel-only authority updates should refresh prediction state');

  controller.step(command(2, MOVEMENT_BUTTON_MOVE_FORWARD), context());
  assert.equal(controller.getState().movement.isJetpacking, true, 'local prediction should preserve refreshed active status');
  assert.equal(controller.getState().movement.jetpackFuel, 42, 'local prediction should preserve refreshed Blaze fuel');
}

function runSprintModeMismatchDoesNotCorrect() {
  const controller = new MovementPredictionController();
  controller.initialize(createSimulationState(), 0, 0);
  controller.step(command(1, MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT), context());
  const stateAtAck = controller.getState();
  const authorityMovement = {
    ...stateAtAck.movement,
    isSprinting: !stateAtAck.movement.isSprinting,
  };

  const metrics = controller.reconcile({
    serverTick: 1,
    serverTime: 50,
    ackSeq: 1,
    movementEpoch: 0,
    position: stateAtAck.position,
    velocity: stateAtAck.velocity,
    lookYaw: 0,
    lookPitch: 0,
    movement: authorityMovement,
  }, context(), 60);

  assert.equal(metrics.corrected, false, 'sprint animation flag drift should not replay movement prediction');
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

function runChronosAscendantReleaseDampsStrafe() {
  let state = {
    position: { x: 0, y: 6, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    movement: {
      ...createMovementState(),
      isGrounded: false,
      isJetpacking: true,
      isGliding: true,
    },
  };

  const stepAscendant = (input) => simulateSharedMovement({
    position: state.position,
    velocity: state.velocity,
    movement: state.movement,
    heroStats: HERO_DEFINITIONS.chronos.stats,
    input,
    lookYaw: 0,
    deltaTime: 1 / 60,
    terrain,
    activeSpeedMultiplier: 1.38,
    chronosAscendantActive: true,
  });

  const strafeInput = {
    ...createEmptyInputState(),
    moveLeft: true,
  };
  for (let step = 0; step < 12; step++) {
    state = stepAscendant(strafeInput);
  }

  const strafeSpeed = speed2D(state.velocity);
  assert.ok(state.velocity.x < -0.5, `Ascendant strafe input should build left velocity, got ${state.velocity.x}`);

  const releasedInput = createEmptyInputState();
  for (let step = 0; step < 30; step++) {
    state = stepAscendant(releasedInput);
  }

  assert.ok(
    speed2D(state.velocity) < strafeSpeed * 0.12,
    `released Ascendant strafe should damp horizontal speed, got ${speed2D(state.velocity)} from ${strafeSpeed}`
  );
  assert.ok(
    Math.abs(state.velocity.x) < 0.2,
    `released Ascendant left strafe should settle near zero X velocity, got ${state.velocity.x}`
  );
}

function runChronosAscendantCapsElevation() {
  const startY = 6;
  let state = {
    position: { x: 0, y: startY, z: 0 },
    velocity: { x: 0, y: 18.5, z: 0 },
    movement: {
      ...createMovementState(),
      isGrounded: false,
      isJetpacking: true,
      isGliding: true,
      chronosAscendantStartY: startY,
    },
  };

  const input = {
    ...createEmptyInputState(),
    jump: true,
  };

  for (let step = 0; step < 180; step++) {
    state = simulateSharedMovement({
      position: state.position,
      velocity: state.velocity,
      movement: state.movement,
      heroStats: HERO_DEFINITIONS.chronos.stats,
      input,
      lookYaw: 0,
      deltaTime: 1 / 60,
      terrain,
      activeSpeedMultiplier: 1.38,
      chronosAscendantActive: true,
    });
  }

  const maxY = startY + CHRONOS_ASCENDANT_PARADOX_MAX_ELEVATION_GAIN;
  assert.ok(
    state.position.y <= maxY + 0.001,
    `Ascendant should cap elevation at ${maxY}, got ${state.position.y}`
  );
  assert.ok(state.velocity.y <= 0.001, `Ascendant upward velocity should stop at ceiling, got ${state.velocity.y}`);
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
    ...fineVoxelGrid,
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

function runProceduralSpawnGroundedMovement() {
  const manifest = generateProceduralVoxelMap(4277893733);
  const lookup = createProceduralTerrainLookup(manifest);
  const spawn = manifest.spawnPoints.red[0];
  const proceduralTerrain = {
    getGroundY: (position) => lookup.getGroundY(position),
    clampPosition: (position) => lookup.clampToPlayableMap(position),
    getBlockAtWorld: (position) => lookup.getBlockAtWorld(position),
    origin: lookup.origin,
    voxelSize: lookup.voxelSize,
    collisionRevision: 0,
  };
  const input = {
    ...createEmptyInputState(),
    moveForward: true,
    sprint: true,
  };
  let state = {
    position: { ...spawn },
    velocity: { x: 0, y: 0, z: 0 },
    movement: createMovementState(),
  };

  for (let step = 0; step < 10; step++) {
    state = simulateSharedMovement({
      position: state.position,
      velocity: state.velocity,
      movement: state.movement,
      heroStats: HERO_DEFINITIONS.phantom.stats,
      input,
      lookYaw: 0,
      deltaTime: 1 / 60,
      terrain: proceduralTerrain,
    });
  }

  assert.ok(state.position.z < spawn.z - 0.05, `procedural spawn should allow grounded forward movement, got z ${state.position.z}`);
  assert.equal(state.movement.isCrouching, false, 'standing spawn clearance should not force crouch');

  const crouchedState = simulateSharedMovement({
    position: { ...spawn },
    velocity: { x: 0, y: 0, z: 0 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      ...createEmptyInputState(),
      moveForward: true,
      crouch: true,
    },
    lookYaw: 0,
    deltaTime: 1 / 60,
    terrain: proceduralTerrain,
  });
  assert.equal(crouchedState.movement.isCrouching, true, 'procedural floor should allow explicit crouch input');
  assert.ok(crouchedState.position.z < spawn.z, `crouched procedural movement should still advance, got z ${crouchedState.position.z}`);
}

function createStairMomentumTerrain() {
  const stairTerrain = {
    ...fineVoxelGrid,
    origin: { x: -8, y: 0, z: -8 },
    getGroundY: (position) => Math.min(1.25, Math.max(0, Math.floor((position.x + 0.05) / 0.75) * 0.25)),
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld(position) {
      const groundY = stairTerrain.getGroundY(position);
      return position.y >= 0 && position.y < groundY && Math.abs(position.z) < 3 ? 1 : 0;
    },
  };
  return stairTerrain;
}

function runStairClimbReconcileHasNoMicroCorrections() {
  const terrain = createStairMomentumTerrain();
  const context = {
    heroStats: HERO_DEFINITIONS.phantom.stats,
    terrain,
    flagCarrier: false,
    activeSpeedMultiplier: 1,
  };
  const client = new MovementPredictionController();
  const server = new MovementPredictionController();
  client.initialize({ position: { x: 0, y: 0.9, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, movement: createMovementState() }, 0, 0);
  server.initialize({ position: { x: 0, y: 0.9, z: 0 }, velocity: { x: 0, y: 0, z: 0 }, movement: createMovementState() }, 0, 0);

  let corrections = 0;
  const buttons = MOVEMENT_BUTTON_MOVE_FORWARD | MOVEMENT_BUTTON_SPRINT;
  for (let seq = 1; seq <= 120; seq++) {
    const movementCommand = command(seq, buttons, -Math.PI / 2);
    client.step(movementCommand, context);
    server.step(movementCommand, context);
    const serverState = server.getState();
    const metrics = client.reconcile({
      serverTick: seq,
      serverTime: seq * 1000 / 60,
      ackSeq: seq,
      movementEpoch: 0,
      position: serverState.position,
      velocity: serverState.velocity,
      lookYaw: movementCommand.lookYaw,
      lookPitch: movementCommand.lookPitch,
      movement: serverState.movement,
    }, context, seq * 1000 / 60);
    if (metrics.corrected) corrections++;
  }

  assert.equal(corrections, 0, 'stair climb authority acks should not produce prediction corrections');
}

function runVoxelStepUpKeepsMovementSmooth() {
  const stepTerrain = {
    ...fineVoxelGrid,
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
    ...fineVoxelGrid,
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
    ...fineVoxelGrid,
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
    ...fineVoxelGrid,
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
    ...fineVoxelGrid,
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

function runCapsuleHoleRejection() {
  const narrowHoleTerrain = {
    ...fineVoxelGrid,
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.z <= -0.4 &&
      position.z >= -2.2 &&
      position.y >= 0 &&
      position.y < 2.4 &&
      Math.abs(position.x) >= 0.32 &&
      Math.abs(position.x) <= 2
        ? 1
        : 0
    ),
  };

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -16 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: createEmptyInputState(),
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: narrowHoleTerrain,
  });

  assert.ok(result.position.z > -0.38, `capsule should reject sub-diameter hole before center enters, got z ${result.position.z}`);
  assert.ok(Math.abs(result.velocity.z) < 0.5, `blocked narrow hole should remove forward velocity, got ${result.velocity.z}`);
}

function runDiagonalCornerSlide() {
  const wallTerrain = {
    ...fineVoxelGrid,
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.x >= 0.55 &&
      position.x <= 2 &&
      position.y >= 0 &&
      position.y < 3
        ? 1
        : 0
    ),
  };

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 10, y: 0, z: -8 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      ...createEmptyInputState(),
      moveForward: true,
      moveRight: true,
    },
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: wallTerrain,
  });

  assert.ok(result.position.x < 0.12, `glancing wall hit should keep capsule outside wall, got x ${result.position.x}`);
  assert.ok(result.position.z < -0.25, `glancing wall hit should slide along tangential Z, got z ${result.position.z}`);
  assert.ok(result.velocity.z < -3, `tangential velocity should be retained, got z velocity ${result.velocity.z}`);
}

function runHeldSlideGraduallyLosesSpeed() {
  let state = createSimulationState();
  const speeds = [];

  for (let step = 0; step < 24; step++) {
    state = simulateSharedMovement({
      position: state.position,
      velocity: state.velocity,
      movement: state.movement,
      heroStats: HERO_DEFINITIONS.phantom.stats,
      input: {
        ...createEmptyInputState(),
        moveForward: true,
        sprint: true,
        crouch: true,
        crouchPressed: step === 0,
      },
      lookYaw: 0,
      deltaTime: 1 / 60,
      terrain,
    });

    assert.equal(state.movement.isSliding, true, `slide should still be active at step ${step}`);
    speeds.push(speed2D(state.velocity));
  }

  for (let index = 1; index < speeds.length; index++) {
    assert.ok(
      speeds[index] <= speeds[index - 1] + EPSILON,
      `held slide speed should not be replenished by input at step ${index}: ${speeds[index - 1]} -> ${speeds[index]}`
    );
  }

  assert.ok(
    speeds[speeds.length - 1] < speeds[0] * 0.7,
    `held slide should gradually lose meaningful speed, got ${speeds[0]} -> ${speeds[speeds.length - 1]}`
  );
}

function runSlideJump() {
  const movement = createMovementState();
  movement.isSliding = true;
  movement.slideTimeRemaining = 0.3;
  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -9 },
    movement,
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: {
      ...createEmptyInputState(),
      jump: true,
    },
    lookYaw: 0,
    deltaTime: 1 / 60,
    terrain,
  });

  assert.equal(result.movement.isSliding, false, 'slide jump should exit slide');
  assert.equal(result.movement.isGrounded, false, 'slide jump should detach from ground');
  assert.ok(result.velocity.y > 7, `slide jump should apply jump impulse, got ${result.velocity.y}`);
  assert.ok(speed2D(result.velocity) > 6, `slide jump should retain horizontal speed, got ${speed2D(result.velocity)}`);
}

function runLandingContact() {
  const floorTerrain = {
    ...fineVoxelGrid,
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.y >= -0.2 &&
      position.y < 0 &&
      Math.abs(position.x) <= 4 &&
      Math.abs(position.z) <= 4
        ? 1
        : 0
    ),
  };
  const movement = createMovementState();
  movement.isGrounded = false;

  const result = simulateSharedMovement({
    position: { x: 0, y: 3, z: 0 },
    velocity: { x: 0, y: -35, z: 0 },
    movement,
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: createEmptyInputState(),
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: floorTerrain,
  });

  assert.equal(result.movement.isGrounded, true, 'falling capsule should land on voxel floor');
  assert.ok(Math.abs(result.velocity.y) <= EPSILON, `landing should clear downward velocity, got ${result.velocity.y}`);
  assert.ok(result.position.y >= 0.9, `landing should end above floor, got y ${result.position.y}`);
}

function runTemporaryWallRevisionCollision() {
  const wallTerrain = {
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    collisionRevision: 7,
    getCollisionAabbs: () => [{
      id: 'anchorwall_test',
      min: { x: -2, y: 0, z: -0.8 },
      max: { x: 2, y: 3, z: -0.55 },
    }],
  };
  const world = createVoxelCollisionWorld(wallTerrain);
  assert.equal(world.collisionRevision, 7, 'collision world should expose dynamic collider revision');

  const result = simulateSharedMovement({
    position: { x: 0, y: 0.9, z: 0 },
    velocity: { x: 0, y: 0, z: -14 },
    movement: createMovementState(),
    heroStats: HERO_DEFINITIONS.phantom.stats,
    input: createEmptyInputState(),
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: wallTerrain,
  });

  assert.ok(result.position.z > -0.2, `temporary wall should block capsule movement, got z ${result.position.z}`);
  assert.ok(Math.abs(result.velocity.z) < 0.5, `temporary wall should remove into-wall velocity, got ${result.velocity.z}`);
}

function runBlinkCapsuleClearance() {
  const wallTerrain = {
    ...fineVoxelGrid,
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.z <= -1 &&
      position.z >= -1.5 &&
      position.y >= 0 &&
      position.y < 3 &&
      Math.abs(position.x) <= 2
        ? 1
        : 0
    ),
  };
  const world = createVoxelCollisionWorld(wallTerrain);

  assert.equal(
    sweepCapsulePathClear(world, { x: 0, y: 0.9, z: 0 }, { x: 0, y: 0.9, z: -4 }),
    false,
    'blink clearance should reject a blocked path'
  );
  assert.equal(
    sweepCapsulePathClear(world, { x: 0, y: 0.9, z: 0 }, { x: 0, y: 0.9, z: 1.5 }),
    true,
    'blink clearance should allow a clear path'
  );
}

function runHookshotTerrainContact() {
  const wallTerrain = {
    ...fineVoxelGrid,
    getGroundY: () => 0,
    clampPosition: (position) => ({ ...position }),
    getBlockAtWorld: (position) => (
      position.x >= 0.55 &&
      position.x <= 2 &&
      position.y >= 0 &&
      position.y < 3
        ? 1
        : 0
    ),
  };
  const movement = createMovementState();
  movement.isGrounded = false;
  movement.isGrappling = true;

  const result = simulateSharedMovement({
    position: { x: 0, y: 1.4, z: 0 },
    velocity: { x: 12, y: 0, z: -6 },
    movement,
    heroStats: HERO_DEFINITIONS.hookshot.stats,
    input: createEmptyInputState(),
    lookYaw: 0,
    deltaTime: 0.1,
    terrain: wallTerrain,
  });

  assert.ok(result.position.x < 0.12, `hookshot contact should keep capsule outside wall, got x ${result.position.x}`);
  assert.ok(result.position.z < -0.35, `hookshot contact should slide along terrain, got z ${result.position.z}`);
  assert.ok(result.velocity.z < -4, `hookshot contact should preserve tangent velocity, got ${result.velocity.z}`);
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
runNoCorrectionAckRefreshesAuthorityOwnedResources();
runSprintModeMismatchDoesNotCorrect();
runSlideRequiresFreshCrouchPress();
runHeldCommandStripsEdgeButtons();
runChronosAscendantReleaseDampsStrafe();
runChronosAscendantCapsElevation();
runCorrectionReplay();
runOverwriteUpdatesLatestAckState();
runOverwriteDefaultsToExternalCorrection();
runEpochBarrier();
runVoxelWallBlocksMovement();
runProceduralSpawnGroundedMovement();
runStairClimbReconcileHasNoMicroCorrections();
runVoxelStepUpKeepsMovementSmooth();
runVoxelStepUpBeginsAtCapsuleEdge();
runLegacyHeightStepStillTraverses();
runTallVoxelWallStillBlocksMovement();
runLowCeilingMaintainsCrouch();
runCapsuleHoleRejection();
runDiagonalCornerSlide();
runHeldSlideGraduallyLosesSpeed();
runSlideJump();
runLandingContact();
runTemporaryWallRevisionCollision();
runBlinkCapsuleClearance();
runHookshotTerrainContact();
runHookshotSwingStep();

console.log(`movement prediction harness passed (protocol ${MOVEMENT_PROTOCOL_VERSION})`);
