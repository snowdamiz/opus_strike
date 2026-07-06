import assert from 'node:assert/strict';
import {
  TUTORIAL_BUNNY_HOP_ZONE_START_Z,
  TUTORIAL_CROUCH_CLEAR_Z,
  TUTORIAL_SLIDE_CLEAR_Z,
  collectMovementTutorialCompletions,
  createInitialTaskCompletion,
  createTutorialMovementHistory,
  type TutorialMovementHistory,
  type TutorialMovementSnapshot,
} from './tutorialProgress';

function movement(overrides: Partial<TutorialMovementSnapshot> = {}): TutorialMovementSnapshot {
  return {
    isCrouching: false,
    isGrounded: true,
    isSliding: false,
    isSprinting: false,
    slideTimeRemaining: 0,
    ...overrides,
  };
}

function completions(input: {
  completedTasks?: ReturnType<typeof createInitialTaskCompletion>;
  history?: TutorialMovementHistory;
  movement?: ReturnType<typeof movement>;
  nowMs?: number;
  playerZ: number;
  speed?: number;
  verticalVelocity?: number;
}) {
  return collectMovementTutorialCompletions({
    completedTasks: input.completedTasks ?? createInitialTaskCompletion(),
    history: input.history ?? createTutorialMovementHistory(),
    movement: input.movement ?? movement(),
    nowMs: input.nowMs ?? 1_000,
    playerZ: input.playerZ,
    speed: input.speed ?? 0,
    verticalVelocity: input.verticalVelocity ?? 0,
  });
}

assert.equal(
  completions({
    movement: movement({ isCrouching: true }),
    playerZ: TUTORIAL_CROUCH_CLEAR_Z - 0.01,
  }).includes('crouch'),
  false,
  'crouch should wait until the player clears the low cover'
);

assert.equal(
  completions({
    movement: movement({ isCrouching: true }),
    playerZ: TUTORIAL_CROUCH_CLEAR_Z,
  }).includes('crouch'),
  true,
  'crouch should complete once the player clears the low cover'
);

{
  const history = createTutorialMovementHistory();
  completions({
    history,
    movement: movement({ isCrouching: true }),
    nowMs: 1_000,
    playerZ: TUTORIAL_CROUCH_CLEAR_Z - 0.2,
  });
  assert.equal(
    completions({
      history,
      movement: movement(),
      nowMs: 1_400,
      playerZ: TUTORIAL_CROUCH_CLEAR_Z,
    }).includes('crouch'),
    true,
    'standing up as the cover releases the forced crouch should still count'
  );
}

{
  const history = createTutorialMovementHistory();
  completions({
    history,
    movement: movement({ isCrouching: true }),
    nowMs: 1_000,
    playerZ: TUTORIAL_CROUCH_CLEAR_Z - 0.2,
  });
  assert.equal(
    completions({
      history,
      movement: movement(),
      nowMs: 3_000,
      playerZ: TUTORIAL_CROUCH_CLEAR_Z,
    }).includes('crouch'),
    false,
    'a crouch released long before clearing the cover should not count'
  );
}

assert.equal(
  completions({
    movement: movement({ isSliding: true }),
    playerZ: TUTORIAL_SLIDE_CLEAR_Z - 0.01,
  }).includes('slide'),
  false,
  'slide should wait until the player clears the slide cover'
);

assert.equal(
  completions({
    movement: movement({ slideTimeRemaining: 0.2 }),
    playerZ: TUTORIAL_SLIDE_CLEAR_Z,
  }).includes('slide'),
  true,
  'slide cooldown after clearing cover should still count as a successful slide'
);

const completedTasks = createInitialTaskCompletion();
completedTasks.slide = true;
assert.equal(
  completions({
    completedTasks,
    movement: movement({ isGrounded: false }),
    playerZ: TUTORIAL_BUNNY_HOP_ZONE_START_Z - 0.01,
    speed: 9,
    verticalVelocity: 8,
  }).includes('bunny_hop'),
  false,
  'bunny hop should not complete before the hop zone'
);

assert.equal(
  completions({
    completedTasks,
    movement: movement({ isGrounded: false }),
    playerZ: TUTORIAL_BUNNY_HOP_ZONE_START_Z,
    speed: 9,
    verticalVelocity: 8,
  }).includes('bunny_hop'),
  true,
  'bunny hop can complete in the hop zone once slide is already done'
);

console.log('tutorial progress tests passed');
