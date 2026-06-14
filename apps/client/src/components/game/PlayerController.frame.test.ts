import assert from 'node:assert/strict';
import {
  createEmptyInputState,
  MOVEMENT_SUBSTEP_SECONDS,
  type HeroId,
  type InputState,
  type Player,
  type PlayerMovementState,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  createLocalVisualInterpolationState,
  getContinuingHeroHoldInput,
  getExclusiveHeroInput,
  movementClassForTrace,
  recordLocalVisualFixedStep,
  runInputPhase,
  sampleLocalVisualInterpolatedPosition,
  shouldForceImmediateCombatCommand,
  smoothTerrainVisualY,
  withCastActionFields,
  type LocalPlayerFrameContext,
} from './PlayerController';

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

function makeInputPhaseContext(options: {
  actionLocked?: boolean;
  previousHold?: { primaryFire: boolean; secondaryFire: boolean; ability1: boolean };
  chronosQueued?: boolean;
  abilityPressed?: { ability1: boolean; ability2: boolean; ultimate: boolean };
} = {}): LocalPlayerFrameContext {
  const flushes: Array<{ nowMs: number; force?: boolean }> = [];
  return {
    isControlPressed: false,
    abilitySystem: {
      abilityPressedRef: ref(options.abilityPressed ?? { ability1: false, ability2: false, ultimate: false }),
    },
    phantomAbilities: {
      voidRayAwaitingReleaseRef: ref(false),
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
      forceNextMovementFlushRef: ref(false),
      movementCommandAccumulatorRef: ref(0),
      lastServerCombatInputRef: ref({
        primaryFire: options.previousHold?.primaryFire ?? false,
        secondaryFire: options.previousHold?.secondaryFire ?? false,
        ability1: options.previousHold?.ability1 ?? false,
        ability2: false,
        ultimate: false,
      }),
    },
    lockHeroActions: () => undefined,
    isHeroActionLocked: () => Boolean(options.actionLocked),
    flushMovementCommands: (nowMs: number, force?: boolean) => {
      flushes.push({ nowMs, force });
    },
    __flushes: flushes,
  } as unknown as LocalPlayerFrameContext;
}

useGameStore.setState({
  bombTargeting: false,
  grappleTrapTargeting: false,
});

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
assert.equal(phantomPrimaryCtx.refs.forceNextMovementFlushRef.current, true);
assert.equal(phantomPrimaryCtx.refs.movementCommandAccumulatorRef.current, MOVEMENT_SUBSTEP_SECONDS);
phantomPrimaryCtx.refs.forceNextMovementFlushRef.current = false;
phantomPrimaryCtx.refs.movementCommandAccumulatorRef.current = 0;
runInputPhase(
  phantomPrimaryCtx,
  makePlayer('phantom'),
  'phantom',
  input({ primaryFire: true }),
  input({ primaryFire: true }),
  1016
);
assert.equal(phantomPrimaryCtx.refs.forceNextMovementFlushRef.current, false);
assert.equal(phantomPrimaryCtx.refs.movementCommandAccumulatorRef.current, 0);
runInputPhase(
  phantomPrimaryCtx,
  makePlayer('phantom'),
  'phantom',
  input(),
  input(),
  1032
);
assert.equal(phantomPrimaryCtx.refs.forceNextMovementFlushRef.current, true);
assert.equal(phantomPrimaryCtx.refs.movementCommandAccumulatorRef.current, MOVEMENT_SUBSTEP_SECONDS);

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
assert.equal(blazeSecondaryReleaseCtx.refs.forceNextMovementFlushRef.current, true);
assert.equal(blazeSecondaryReleaseCtx.refs.movementCommandAccumulatorRef.current, MOVEMENT_SUBSTEP_SECONDS);

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
assert.equal(hookshotAbility2Ctx.refs.forceNextMovementFlushRef.current, true);

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
