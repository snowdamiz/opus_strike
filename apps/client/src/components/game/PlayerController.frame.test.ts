import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  ABILITY_DEFINITIONS,
  createEmptyInputState,
  HERO_DEFINITIONS,
  MOVEMENT_MAX_PACKET_COMMANDS,
  MOVEMENT_SUBSTEP_SECONDS,
  movementButtonsToInputState,
  type HeroId,
  type InputState,
  type MovementCommand,
  type MovementCommandPacket,
  type Player,
  type PlayerMovementState,
} from '@voxel-strike/shared';
import type { MovementSimulationState } from '@voxel-strike/physics';
import {
  createMovementCommandPacket,
  enqueueSelfMovementAuthority,
  movementStateFromPlayer,
  resetLocalMovementPrediction,
} from '../../movement/localPrediction';
import { createPracticeAbilityStates } from '../../contexts/practiceAbilities';
import { useGameStore } from '../../store/gameStore';
import { removePlayerVisualState, visualStore } from '../../store/visualStore';
import {
  deriveServerCombatInput,
  getContinuingHeroHoldInput,
  getExclusiveHeroInput,
  movementClassForTrace,
  runInputPhase,
  runAuthorityPhase,
  runPredictionAndCommandPhase,
  shouldForceImmediateCombatCommand,
  withCastActionFields,
  type CommandScheduleReason,
  type LocalPlayerFrameContext,
  type ServerCombatInput,
} from './PlayerController';
import {
  createLocalVisualInterpolationState,
  recordLocalVisualFixedStep,
  sampleLocalVisualInterpolatedPosition,
  smoothTerrainVisualY,
} from './localVisualInterpolation';
import {
  HERO_ACTION_OVERLAP_GRACE_MS,
  isActionLockBlocking,
} from '../../hooks/player/actionLock';

function ref<T>(current: T): { current: T } {
  return { current };
}

function makeMovement(overrides: Partial<PlayerMovementState> = {}): PlayerMovementState {
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
    jetpackFuel: 0,
    isGliding: false,
    ...overrides,
  };
}

function makePlayer(heroId: HeroId): Player {
  return {
    id: 'local-player',
    name: 'local-player',
    team: 'red',
    heroId,
    state: 'alive',
    isReady: true,
    isBot: false,
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    health: 100,
    maxHealth: 100,
    ultimateCharge: 100,
    movement: makeMovement(),
    abilities: {},
    hasFlag: false,
    respawnTime: null,
    spawnProtectionUntil: null,
    stats: {
      kills: 0,
      deaths: 0,
      assists: 0,
      flagCaptures: 0,
      flagReturns: 0,
    },
  };
}

function input(overrides: Partial<InputState> = {}): InputState {
  return {
    ...createEmptyInputState(),
    ...overrides,
  };
}

function combatInput(overrides: Partial<ServerCombatInput> = {}): ServerCombatInput {
  return {
    primaryFire: false,
    secondaryFire: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    ...overrides,
  };
}

function resetPredictionFor(player: Player): MovementSimulationState {
  const predictedState = movementStateFromPlayer(player);
  resetLocalMovementPrediction(predictedState, 0, player.id);
  return predictedState;
}

function makeAbilityContext(player: Player, heroId: HeroId, inputState: InputState) {
  return {
    position: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
    velocity: new THREE.Vector3(player.velocity.x, player.velocity.y, player.velocity.z),
    yaw: player.lookYaw,
    pitch: player.lookPitch,
    heroId,
    localPlayer: {
      id: player.id,
      team: player.team,
      position: player.position,
      ultimateCharge: player.ultimateCharge,
    },
    inputState,
    dt: MOVEMENT_SUBSTEP_SECONDS,
    isGrounded: player.movement.isGrounded,
  };
}

function makeInputPhaseContext(options: {
  actionLocked?: boolean;
  actionLockUntil?: number;
  previousHold?: { primaryFire: boolean; secondaryFire: boolean; ability1: boolean };
  chronosQueued?: boolean;
  abilityPressed?: { ability1: boolean; ability2: boolean; ultimate: boolean };
} = {}): LocalPlayerFrameContext {
  return {
    isControlPressed: false,
    abilitySystem: {
      abilityPressedRef: ref(options.abilityPressed ?? { ability1: false, ability2: false, ultimate: false }),
    },
    phantomAbilities: {
      voidRayChargeStartRef: ref(0),
      phantomPrimaryReloadingRef: ref(false),
      phantomPrimaryAmmoRef: ref(3),
      updatePhantomPrimaryReload: () => undefined,
      reloadPhantomPrimary: () => false,
    },
    refs: {
      lastExclusiveHoldInputRef: ref(options.previousHold ?? {
        primaryFire: false,
        secondaryFire: false,
        ability1: false,
      }),
      chronosLifelineQueuedRef: ref(Boolean(options.chronosQueued)),
      chronosLifelineBlockPrimaryRef: ref(false),
      chronosLifelineBlockSecondaryRef: ref(false),
      chronosLifelineCommitHeldRef: ref(false),
      reloadPressedRef: ref(false),
      pendingReloadInputRef: ref(false),
      movementCommandAccumulatorRef: ref(0),
      lastServerCombatInputRef: ref(combatInput({
        primaryFire: options.previousHold?.primaryFire ?? false,
        secondaryFire: options.previousHold?.secondaryFire ?? false,
        ability1: options.previousHold?.ability1 ?? false,
      })),
    },
    lockHeroActions: () => undefined,
    isHeroActionLocked: (_heroId: HeroId, timestampMs = Date.now(), overlapGraceMs = 0) => (
      options.actionLockUntil === undefined
        ? Boolean(options.actionLocked)
        : isActionLockBlocking(options.actionLockUntil, timestampMs, overlapGraceMs)
    ),
    flushMovementCommands: () => undefined,
  } as unknown as LocalPlayerFrameContext;
}

function makeCommandPhaseContext(options: {
  accumulator?: number;
  pendingCommands?: MovementCommand[];
  previousServerCombatInput?: Partial<ServerCombatInput>;
} = {}): LocalPlayerFrameContext & {
  __sentPackets: MovementCommandPacket[];
  __flushCalls: Array<{ nowMs: number; force: boolean; sentCommandCount: number }>;
  __groundJumpSoundCalls: number;
} {
  const pendingMovementCommandsRef = ref<MovementCommand[]>([...(options.pendingCommands ?? [])]);
  const sentPackets: MovementCommandPacket[] = [];
  const flushCalls: Array<{ nowMs: number; force: boolean; sentCommandCount: number }> = [];
  let groundJumpSoundCalls = 0;

  const ctx = {
    isControlPressed: false,
    cameraControl: {
      refs: {
        yaw: ref(0),
        pitch: ref(0),
      },
    },
    phantomAbilities: {
      phantomPrimaryReloadingRef: ref(false),
      phantomPrimaryAmmoRef: ref(3),
    },
    refs: {
      tickRef: ref(0),
      movementCommandAccumulatorRef: ref(options.accumulator ?? 0),
      pendingMovementCommandsRef,
      localVisualInterpolationRef: ref(createLocalVisualInterpolationState()),
      latestAbilityCastHintsRef: ref([]),
      lastCrouchHeldRef: ref(false),
      pendingCrouchPressedRef: ref(false),
      pendingReloadInputRef: ref(false),
      lastServerCombatInputRef: ref(combatInput(options.previousServerCombatInput)),
    },
    flushMovementCommands: (nowMs: number, force = false) => {
      const commands = pendingMovementCommandsRef.current.slice(0, MOVEMENT_MAX_PACKET_COMMANDS);
      if ((!force && commands.length < MOVEMENT_MAX_PACKET_COMMANDS) || commands.length === 0) {
        flushCalls.push({ nowMs, force, sentCommandCount: 0 });
        return;
      }

      pendingMovementCommandsRef.current.splice(0, commands.length);
      sentPackets.push(createMovementCommandPacket(commands));
      flushCalls.push({ nowMs, force, sentCommandCount: commands.length });
    },
    movementSounds: {
      playGroundJump: () => {
        groundJumpSoundCalls++;
      },
    },
    __sentPackets: sentPackets,
    __flushCalls: flushCalls,
    get __groundJumpSoundCalls() {
      return groundJumpSoundCalls;
    },
  };

  return ctx as unknown as LocalPlayerFrameContext & {
    __sentPackets: MovementCommandPacket[];
    __flushCalls: Array<{ nowMs: number; force: boolean; sentCommandCount: number }>;
    __groundJumpSoundCalls: number;
  };
}

function makeAuthorityPhaseContext(options: {
  lookYaw: number;
  lookPitch: number;
}): LocalPlayerFrameContext & {
  __updates: Partial<Player>[];
  __resetMovementCommandBufferCalls: number;
} {
  const updates: Partial<Player>[] = [];
  let resetMovementCommandBufferCalls = 0;
  const ctx = {
    cameraControl: {
      refs: {
        yaw: ref(options.lookYaw),
        pitch: ref(options.lookPitch),
      },
    },
    updateLocalPlayer: (update: Partial<Player>) => {
      updates.push(update);
    },
    resetMovementCommandBuffer: () => {
      resetMovementCommandBufferCalls++;
    },
    __updates: updates,
    get __resetMovementCommandBufferCalls() {
      return resetMovementCommandBufferCalls;
    },
  };

  return ctx as unknown as LocalPlayerFrameContext & {
    __updates: Partial<Player>[];
    __resetMovementCommandBufferCalls: number;
  };
}

function runCommandPhase(inputOverrides: {
  player: Player;
  frameInput: InputState;
  serverCombatInput: ServerCombatInput;
  requestedCommandScheduleReasons?: CommandScheduleReason[];
  ctx?: ReturnType<typeof makeCommandPhaseContext>;
  dt?: number;
  now?: number;
}) {
  const ctx = inputOverrides.ctx ?? makeCommandPhaseContext();
  const predictedState = resetPredictionFor(inputOverrides.player);
  const heroId = inputOverrides.player.heroId;
  if (heroId === null) {
    throw new Error('runCommandPhase test helper requires a hero');
  }
  const result = runPredictionAndCommandPhase({
    ctx,
    localPlayer: inputOverrides.player,
    heroId,
    frameInput: inputOverrides.frameInput,
    serverCombatInput: inputOverrides.serverCombatInput,
    requestedCommandScheduleReasons: inputOverrides.requestedCommandScheduleReasons ?? [],
    abilityCtx: makeAbilityContext(inputOverrides.player, heroId, inputOverrides.frameInput),
    predictedState,
    now: inputOverrides.now ?? 1000,
    dt: inputOverrides.dt ?? 0,
    rawDelta: inputOverrides.dt ?? 0,
  });

  return { ctx, result };
}

useGameStore.setState({
  bombTargeting: false,
});

for (const heroId of ['phantom', 'hookshot', 'blaze', 'chronos'] as const satisfies readonly HeroId[]) {
  const practiceAbilities = createPracticeAbilityStates(heroId);
  const expectedAbilityIds = [
    HERO_DEFINITIONS[heroId].ability1.abilityId,
    HERO_DEFINITIONS[heroId].ability2.abilityId,
    HERO_DEFINITIONS[heroId].ultimate.abilityId,
  ];

  assert.deepEqual(Object.keys(practiceAbilities).sort(), [...expectedAbilityIds].sort());
  for (const abilityId of expectedAbilityIds) {
    assert.equal(practiceAbilities[abilityId].charges, ABILITY_DEFINITIONS[abilityId]?.charges ?? 1);
    assert.equal(practiceAbilities[abilityId].cooldownRemaining, 0);
    assert.equal(practiceAbilities[abilityId].cooldownUntil, 0);
    assert.equal(practiceAbilities[abilityId].isActive, false);
  }
}

const baseInput = input({ primaryFire: true, secondaryFire: true, ability1: true });
const primaryOnly = getExclusiveHeroInput('phantom', baseInput, false, false);
assert.equal(primaryOnly.primaryFire, true);
assert.equal(primaryOnly.secondaryFire, false);
assert.equal(primaryOnly.ability1, false);

const continuedSecondary = getContinuingHeroHoldInput(
  'phantom',
  input({ secondaryFire: true, primaryFire: true }),
  { primaryFire: false, secondaryFire: true, ability1: false }
);
assert.deepEqual(continuedSecondary, { secondaryFire: true });

const sameInput = input();
assert.equal(withCastActionFields(sameInput), sameInput);
assert.equal(withCastActionFields(input({ primaryFire: true })).primaryFire, false);

useGameStore.setState({ bombTargeting: true });
const blazeBombInput = runInputPhase(
  makeInputPhaseContext(),
  makePlayer('blaze'),
  'blaze',
  input({ primaryFire: true, secondaryFire: true }),
  input({ primaryFire: true, secondaryFire: true }),
  1000
);
assert.equal(blazeBombInput.frameInput.primaryFire, false);
assert.equal(blazeBombInput.frameInput.secondaryFire, true);
assert.equal(blazeBombInput.primaryFireForServer, false);

useGameStore.setState({ bombTargeting: false });
const lockedPhantomInput = runInputPhase(
  makeInputPhaseContext({ actionLocked: true }),
  makePlayer('phantom'),
  'phantom',
  input({ primaryFire: true, secondaryFire: true, ultimate: true }),
  input({ primaryFire: true, secondaryFire: true, ultimate: true }),
  1000
);
assert.equal(lockedPhantomInput.frameInput.primaryFire, false);
assert.equal(lockedPhantomInput.frameInput.secondaryFire, false);
assert.equal(lockedPhantomInput.frameInput.ultimate, false);

const lockBeyondGraceInput = runInputPhase(
  makeInputPhaseContext({ actionLockUntil: 1000 + HERO_ACTION_OVERLAP_GRACE_MS + 1 }),
  makePlayer('phantom'),
  'phantom',
  input({ ability2: true }),
  input({ ability2: true }),
  1000
);
assert.equal(lockBeyondGraceInput.frameInput.ability2, false);

const lockGraceInput = runInputPhase(
  makeInputPhaseContext({ actionLockUntil: 1000 + HERO_ACTION_OVERLAP_GRACE_MS }),
  makePlayer('phantom'),
  'phantom',
  input({ ability2: true }),
  input({ ability2: true }),
  1000
);
assert.equal(lockGraceInput.frameInput.ability2, true);

const lockGraceBlinkInput = runInputPhase(
  makeInputPhaseContext({ actionLockUntil: 1000 + HERO_ACTION_OVERLAP_GRACE_MS }),
  makePlayer('phantom'),
  'phantom',
  input({ ability1: true }),
  input({ ability1: true }),
  1000
);
assert.deepEqual(lockGraceBlinkInput.serverCombatInput, combatInput({ ability1: true }));
assert.deepEqual(lockGraceBlinkInput.requestedCommandScheduleReasons, ['movement_barrier']);

const phantomPrimaryCtx = makeInputPhaseContext();
const phantomPrimaryInput = runInputPhase(
  phantomPrimaryCtx,
  makePlayer('phantom'),
  'phantom',
  input({ primaryFire: true }),
  input({ primaryFire: true }),
  1000
);
assert.equal(phantomPrimaryInput.primaryFireForServer, true);
assert.deepEqual(phantomPrimaryInput.serverCombatInput, combatInput({ primaryFire: true }));
assert.deepEqual(phantomPrimaryInput.requestedCommandScheduleReasons, []);
assert.equal(phantomPrimaryCtx.refs.movementCommandAccumulatorRef.current, 0);
const phantomHeldInput = runInputPhase(
  phantomPrimaryCtx,
  makePlayer('phantom'),
  'phantom',
  input({ primaryFire: true }),
  input({ primaryFire: true }),
  1016
);
assert.equal(phantomHeldInput.primaryFireForServer, true);
assert.deepEqual(phantomHeldInput.requestedCommandScheduleReasons, []);
assert.equal(phantomPrimaryCtx.refs.movementCommandAccumulatorRef.current, 0);
const phantomPrimaryRelease = runInputPhase(
  phantomPrimaryCtx,
  makePlayer('phantom'),
  'phantom',
  input(),
  input(),
  1032
);
assert.equal(phantomPrimaryRelease.serverCombatInput.primaryFire, false);
assert.deepEqual(phantomPrimaryRelease.requestedCommandScheduleReasons, []);
assert.equal(phantomPrimaryCtx.refs.movementCommandAccumulatorRef.current, 0);

const blazeSecondaryReleaseCtx = makeInputPhaseContext({
  previousHold: { primaryFire: false, secondaryFire: true, ability1: false },
});
const blazeSecondaryRelease = runInputPhase(
  blazeSecondaryReleaseCtx,
  makePlayer('blaze'),
  'blaze',
  input(),
  input(),
  1000
);
assert.equal(blazeSecondaryRelease.frameInput.secondaryFire, false);
assert.deepEqual(blazeSecondaryRelease.serverCombatInput, combatInput());
assert.deepEqual(blazeSecondaryRelease.requestedCommandScheduleReasons, []);
assert.equal(blazeSecondaryReleaseCtx.refs.movementCommandAccumulatorRef.current, 0);

const hookshotAbility2Ctx = makeInputPhaseContext();
const hookshotAbility2 = runInputPhase(
  hookshotAbility2Ctx,
  makePlayer('hookshot'),
  'hookshot',
  input({ ability2: true }),
  input({ ability2: true }),
  1000
);
assert.equal(hookshotAbility2.ability2ForServer, true);
assert.deepEqual(hookshotAbility2.serverCombatInput, combatInput({ ability2: true }));
assert.deepEqual(hookshotAbility2.requestedCommandScheduleReasons, []);

const phantomBlinkInput = runInputPhase(
  makeInputPhaseContext(),
  makePlayer('phantom'),
  'phantom',
  input({ ability1: true }),
  input({ ability1: true }),
  1000
);
assert.deepEqual(phantomBlinkInput.serverCombatInput, combatInput({ ability1: true }));
assert.deepEqual(phantomBlinkInput.requestedCommandScheduleReasons, ['movement_barrier']);

assert.deepEqual(
  deriveServerCombatInput({
    frameInput: input({ secondaryFire: true, ability2: true, ultimate: true }),
    primaryFireForServer: true,
    ability2ForServer: false,
  }),
  combatInput({ primaryFire: true, secondaryFire: true, ability2: false, ultimate: true })
);

assert.equal(
  shouldForceImmediateCombatCommand(
    {
      primaryFire: false,
      secondaryFire: false,
      ability1: false,
      ability2: false,
      ultimate: false,
    },
    {
      primaryFire: false,
      secondaryFire: false,
      ability1: false,
      ability2: false,
      ultimate: false,
    }
  ),
  false
);

const phantomPressCommand = runCommandPhase({
  player: makePlayer('phantom'),
  frameInput: input({ primaryFire: true }),
  serverCombatInput: combatInput({ primaryFire: true }),
});
assert.deepEqual(phantomPressCommand.result.commandScheduleReasons, ['combat_edge']);
assert.equal(phantomPressCommand.result.substepsThisFrame, 1);
assert.equal(phantomPressCommand.ctx.__sentPackets.length, 1);
assert.equal(
  movementButtonsToInputState(phantomPressCommand.ctx.__sentPackets[0].commands[0].buttons).primaryFire,
  true
);

const phantomHeldCommand = runCommandPhase({
  player: makePlayer('phantom'),
  frameInput: input({ primaryFire: true }),
  serverCombatInput: combatInput({ primaryFire: true }),
  ctx: makeCommandPhaseContext({
    previousServerCombatInput: { primaryFire: true },
  }),
});
assert.deepEqual(phantomHeldCommand.result.commandScheduleReasons, []);
assert.equal(phantomHeldCommand.result.substepsThisFrame, 0);
assert.equal(phantomHeldCommand.ctx.__sentPackets.length, 0);

const blazeReleaseCommand = runCommandPhase({
  player: makePlayer('blaze'),
  frameInput: input(),
  serverCombatInput: combatInput(),
  ctx: makeCommandPhaseContext({
    previousServerCombatInput: { secondaryFire: true },
  }),
});
assert.deepEqual(blazeReleaseCommand.result.commandScheduleReasons, ['combat_edge']);
assert.equal(blazeReleaseCommand.ctx.__sentPackets.length, 1);
assert.equal(
  movementButtonsToInputState(blazeReleaseCommand.ctx.__sentPackets[0].commands[0].buttons).secondaryFire,
  false
);

const slideStartCommand = runCommandPhase({
  player: makePlayer('phantom'),
  frameInput: input({ crouch: true, sprint: true, moveForward: true }),
  serverCombatInput: combatInput(),
});
assert.deepEqual(slideStartCommand.result.commandScheduleReasons, ['crouch_edge']);
assert.equal(slideStartCommand.result.substepsThisFrame, 1);
assert.equal(slideStartCommand.ctx.__sentPackets.length, 1);
assert.equal(
  movementButtonsToInputState(slideStartCommand.ctx.__sentPackets[0].commands[0].buttons).crouchPressed,
  true
);

const groundedJumpCommand = runCommandPhase({
  player: makePlayer('phantom'),
  frameInput: input({ jump: true }),
  serverCombatInput: combatInput(),
  dt: MOVEMENT_SUBSTEP_SECONDS,
});
assert.equal(groundedJumpCommand.result.substepsThisFrame, 1);
assert.equal(groundedJumpCommand.ctx.__groundJumpSoundCalls, 1);

const midairPlayer = makePlayer('phantom');
midairPlayer.position.y = 4;
midairPlayer.movement = makeMovement({ isGrounded: false });
const airborneJumpCommand = runCommandPhase({
  player: midairPlayer,
  frameInput: input({ jump: true }),
  serverCombatInput: combatInput(),
  dt: MOVEMENT_SUBSTEP_SECONDS,
});
assert.equal(airborneJumpCommand.result.substepsThisFrame, 1);
assert.equal(airborneJumpCommand.ctx.__groundJumpSoundCalls, 0);

const pendingBarrierCommand: MovementCommand = {
  seq: 41,
  buttons: 0,
  lookYaw: 0,
  lookPitch: 0,
  clientTimeMs: 900,
  movementEpoch: 0,
  collisionRevision: 0,
};
const movementBarrierCommand = runCommandPhase({
  player: makePlayer('phantom'),
  frameInput: input({ ability1: true }),
  serverCombatInput: combatInput({ ability1: true }),
  requestedCommandScheduleReasons: ['movement_barrier'],
  ctx: makeCommandPhaseContext({
    pendingCommands: [pendingBarrierCommand],
  }),
});
assert.deepEqual(movementBarrierCommand.result.commandScheduleReasons, ['movement_barrier', 'combat_edge']);
assert.equal(movementBarrierCommand.result.substepsThisFrame, 1);
assert.equal(movementBarrierCommand.ctx.__sentPackets.length, 2);
assert.equal(movementBarrierCommand.ctx.__sentPackets[0].commands[0], pendingBarrierCommand);
assert.equal(
  movementButtonsToInputState(movementBarrierCommand.ctx.__sentPackets[1].commands[0].buttons).ability1,
  true
);
assert.deepEqual(
  movementBarrierCommand.ctx.__flushCalls.map(({ force, sentCommandCount }) => ({ force, sentCommandCount })),
  [
    { force: true, sentCommandCount: 1 },
    { force: true, sentCommandCount: 1 },
  ]
);

const authorityPlayer = makePlayer('phantom');
authorityPlayer.lookYaw = 0.4;
authorityPlayer.lookPitch = -0.15;
resetLocalMovementPrediction(movementStateFromPlayer(authorityPlayer), 0, authorityPlayer.id);
removePlayerVisualState(authorityPlayer.id);
enqueueSelfMovementAuthority({
  serverTick: 100,
  serverTime: 2000,
  ackSeq: 0,
  movementEpoch: 0,
  position: { x: 8, y: 1, z: -4 },
  velocity: { x: 0, y: 0, z: 0 },
  lookYaw: -2.75,
  lookPitch: 0.72,
  movement: makeMovement(),
  correctionReason: 'epoch_mismatch',
});
const authorityCtx = makeAuthorityPhaseContext({
  lookYaw: 1.35,
  lookPitch: -0.42,
});
const authorityResult = runAuthorityPhase(authorityCtx, authorityPlayer, 2000);
assert.equal(authorityResult.authorityApplied, 1);
assert.equal(authorityCtx.__resetMovementCommandBufferCalls, 1);
assert.equal(authorityCtx.__updates.length, 1);
assert.deepEqual(authorityCtx.__updates[0].position, { x: 8, y: 1, z: -4 });
assert.equal(authorityCtx.__updates[0].lookYaw, 1.35);
assert.equal(authorityCtx.__updates[0].lookPitch, -0.42);
assert.equal(authorityResult.localPlayer.lookYaw, 1.35);
assert.equal(authorityResult.localPlayer.lookPitch, -0.42);
assert.equal(visualStore.getState().playerRotations.get(authorityPlayer.id), 1.35);

const chronosCommit = runInputPhase(
  makeInputPhaseContext({ chronosQueued: true }),
  makePlayer('chronos'),
  'chronos',
  input({ primaryFire: true }),
  input({ primaryFire: true }),
  1000
);
assert.equal(chronosCommit.chronosLifelineCommitMode, 'allies');
assert.equal(chronosCommit.chronosLifelineCommitPressed, true);
assert.equal(chronosCommit.frameInput.primaryFire, true);
assert.equal(chronosCommit.frameInput.ability1, true);

const interpolation = createLocalVisualInterpolationState();
recordLocalVisualFixedStep(interpolation, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
const sampled = sampleLocalVisualInterpolatedPosition(
  interpolation,
  { x: 1, y: 0, z: 0 },
  0,
  { x: 0, y: 0, z: 0 }
);
assert.deepEqual(sampled, { x: 0, y: 0, z: 0 });
recordLocalVisualFixedStep(interpolation, { x: 10, y: 0, z: 0 }, { x: 11, y: 0, z: 0 });
assert.deepEqual(interpolation.previous, { x: 10, y: 0, z: 0 });

assert.equal(smoothTerrainVisualY(1, 1.0001, 1 / 60, true), 1.0001);
assert.equal(smoothTerrainVisualY(1, 5, 1 / 60, true), 5);

assert.equal(
  movementClassForTrace({
    heroId: 'hookshot',
    movement: makeMovement({ isGrappling: true }),
    inputState: input(),
    flagCarrier: false,
  }),
  'grapple'
);
assert.equal(
  movementClassForTrace({
    heroId: 'phantom',
    movement: makeMovement(),
    inputState: input({ ability1: true }),
    flagCarrier: false,
  }),
  'blink'
);

console.log('player controller frame tests passed');
