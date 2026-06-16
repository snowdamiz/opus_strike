import {
  MOVEMENT_MAX_SERVER_QUEUE,
  MOVEMENT_SERVER_CATCHUP_BUDGET,
  MOVEMENT_SUBSTEP_RATE,
  TICK_RATE,
} from '@voxel-strike/shared';

export const SERVER_MOVEMENT_SUBSTEPS_PER_TICK = Math.max(1, Math.round(MOVEMENT_SUBSTEP_RATE / TICK_RATE));
export const SERVER_MOVEMENT_TARGET_PENDING_COMMANDS = SERVER_MOVEMENT_SUBSTEPS_PER_TICK * 2;
export const SERVER_MOVEMENT_CATCHUP_MARGIN_COMMANDS = SERVER_MOVEMENT_SUBSTEPS_PER_TICK;
export const SERVER_MOVEMENT_BACKLOG_TRIM_TARGET_COMMANDS = Math.max(
  SERVER_MOVEMENT_TARGET_PENDING_COMMANDS,
  Math.floor(MOVEMENT_MAX_SERVER_QUEUE / 2)
);
export const SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS = Math.max(
  SERVER_MOVEMENT_BACKLOG_TRIM_TARGET_COMMANDS + SERVER_MOVEMENT_SUBSTEPS_PER_TICK,
  Math.floor(MOVEMENT_MAX_SERVER_QUEUE * 0.75)
);

export interface MovementCommandDrainDecision {
  budget: number;
  underflow: boolean;
  catchup: boolean;
  targetPendingCommands: number;
}

export function getMovementCommandDrainDecision(
  queueLength: number,
  options: { hasAuthorityBarrier?: boolean } = {}
): MovementCommandDrainDecision {
  const commandCount = Math.max(0, Math.trunc(queueLength));
  if (commandCount === 0) {
    return {
      budget: 0,
      underflow: true,
      catchup: false,
      targetPendingCommands: SERVER_MOVEMENT_TARGET_PENDING_COMMANDS,
    };
  }

  if (!options.hasAuthorityBarrier && commandCount < SERVER_MOVEMENT_TARGET_PENDING_COMMANDS) {
    return {
      budget: 0,
      underflow: true,
      catchup: false,
      targetPendingCommands: SERVER_MOVEMENT_TARGET_PENDING_COMMANDS,
    };
  }

  const backlog = Math.max(0, commandCount - SERVER_MOVEMENT_TARGET_PENDING_COMMANDS);
  const shouldCatchUp = backlog > SERVER_MOVEMENT_CATCHUP_MARGIN_COMMANDS;
  const catchupBudget = shouldCatchUp
    ? Math.min(
      MOVEMENT_SERVER_CATCHUP_BUDGET,
      Math.ceil((backlog - SERVER_MOVEMENT_CATCHUP_MARGIN_COMMANDS) / SERVER_MOVEMENT_SUBSTEPS_PER_TICK)
    )
    : 0;

  return {
    budget: Math.min(commandCount, SERVER_MOVEMENT_SUBSTEPS_PER_TICK + catchupBudget),
    underflow: false,
    catchup: shouldCatchUp,
    targetPendingCommands: SERVER_MOVEMENT_TARGET_PENDING_COMMANDS,
  };
}

export function getMovementBacklogTrimCount(queueLength: number): number {
  const commandCount = Math.max(0, Math.trunc(queueLength));
  if (commandCount <= SERVER_MOVEMENT_BACKLOG_BARRIER_COMMANDS) return 0;
  return commandCount - SERVER_MOVEMENT_BACKLOG_TRIM_TARGET_COMMANDS;
}
