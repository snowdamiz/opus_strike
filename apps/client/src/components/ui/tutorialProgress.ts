import {
  BHOP_MIN_CHAIN_SPEED,
  PLAYER_RADIUS,
  type PlayerMovementState,
} from '@voxel-strike/shared';

export const TUTORIAL_TASK_IDS = [
  'move_forward',
  'run',
  'crouch',
  'slide',
  'bunny_hop',
  'movement_checkpoint',
  'skill_use',
  'boost_pickup',
  'health_pickup',
  'target_practice',
  'flag_pickup',
  'flag_capture',
] as const;

export type TutorialTaskId = (typeof TUTORIAL_TASK_IDS)[number];
export type TutorialStageId = 'movement' | 'combat' | 'skills' | 'powerups' | 'objective';
export type TutorialTaskCompletion = Record<TutorialTaskId, boolean>;

export interface TutorialMovementHistory {
  wasGrounded: boolean;
  lastLandingAt: number;
  fastJumpCount: number;
}

export type TutorialMovementSnapshot = Pick<
  PlayerMovementState,
  'isCrouching' | 'isGrounded' | 'isSliding' | 'isSprinting' | 'slideTimeRemaining'
>;

interface TutorialMovementCompletionInput {
  completedTasks: TutorialTaskCompletion;
  history: TutorialMovementHistory;
  movement: TutorialMovementSnapshot;
  nowMs: number;
  playerZ: number;
  speed: number;
  verticalVelocity: number;
}

export const MOVEMENT_CHECKPOINT_Z = 5.5;
const RED_SPAWN_EXIT_Z = -35.5;
const RUN_SPEED_THRESHOLD = 6;
const BUNNY_HOP_CHAIN_WINDOW_MS = 450;
const CROUCH_COVER_FAR_EDGE_Z = -25.1;
const SLIDE_COVER_FAR_EDGE_Z = -19.5;
const BUNNY_HOP_ZONE_START_Z = -16.5;

export const TUTORIAL_CROUCH_CLEAR_Z = CROUCH_COVER_FAR_EDGE_Z + PLAYER_RADIUS;
export const TUTORIAL_SLIDE_CLEAR_Z = SLIDE_COVER_FAR_EDGE_Z + PLAYER_RADIUS;
export const TUTORIAL_BUNNY_HOP_ZONE_START_Z = BUNNY_HOP_ZONE_START_Z;

export function createInitialTaskCompletion(): TutorialTaskCompletion {
  return Object.fromEntries(TUTORIAL_TASK_IDS.map((id) => [id, false])) as TutorialTaskCompletion;
}

export function createTutorialMovementHistory(): TutorialMovementHistory {
  return {
    wasGrounded: true,
    lastLandingAt: 0,
    fastJumpCount: 0,
  };
}

export function completeTasks(
  current: TutorialTaskCompletion,
  taskIds: readonly TutorialTaskId[]
): TutorialTaskCompletion {
  let changed = false;
  const next = { ...current };

  for (const taskId of taskIds) {
    if (!next[taskId]) {
      next[taskId] = true;
      changed = true;
    }
  }

  return changed ? next : current;
}

export function collectMovementTutorialCompletions({
  completedTasks,
  history,
  movement,
  nowMs,
  playerZ,
  speed,
  verticalVelocity,
}: TutorialMovementCompletionInput): TutorialTaskId[] {
  const completed: TutorialTaskId[] = [];

  if (playerZ >= RED_SPAWN_EXIT_Z) {
    completed.push('move_forward');
  }
  if (movement.isSprinting || speed >= RUN_SPEED_THRESHOLD) {
    completed.push('run');
  }
  if (movement.isCrouching && playerZ >= TUTORIAL_CROUCH_CLEAR_Z) {
    completed.push('crouch');
  }
  if ((movement.isSliding || movement.slideTimeRemaining > 0) && playerZ >= TUTORIAL_SLIDE_CLEAR_Z) {
    completed.push('slide');
  }

  const justLanded = !history.wasGrounded && movement.isGrounded;
  if (justLanded) {
    history.lastLandingAt = nowMs;
  }

  const justJumped = history.wasGrounded && !movement.isGrounded && verticalVelocity > 0.5;
  if (justJumped && speed >= Math.max(4, BHOP_MIN_CHAIN_SPEED - 0.75)) {
    const chainedFromLanding = history.lastLandingAt > 0 && nowMs - history.lastLandingAt <= BUNNY_HOP_CHAIN_WINDOW_MS;
    history.fastJumpCount = chainedFromLanding
      ? history.fastJumpCount + 1
      : Math.max(1, history.fastJumpCount);
  }

  const slideCompleted = completedTasks.slide || completed.includes('slide');
  const inBunnyHopZone = playerZ >= BUNNY_HOP_ZONE_START_Z && playerZ < MOVEMENT_CHECKPOINT_Z;
  if (
    inBunnyHopZone &&
    (
      history.fastJumpCount >= 2 ||
      (
        slideCompleted &&
        !movement.isGrounded &&
        speed >= BHOP_MIN_CHAIN_SPEED
      )
    )
  ) {
    completed.push('bunny_hop');
  }

  history.wasGrounded = movement.isGrounded;

  if (playerZ >= MOVEMENT_CHECKPOINT_Z) {
    completed.push('movement_checkpoint');
  }

  return completed;
}
