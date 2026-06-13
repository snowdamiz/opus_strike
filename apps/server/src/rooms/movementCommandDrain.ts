import { MOVEMENT_SERVER_CATCHUP_BUDGET, MOVEMENT_SUBSTEP_RATE, TICK_RATE } from '@voxel-strike/shared';

export const SERVER_MOVEMENT_SUBSTEPS_PER_TICK = Math.max(1, Math.round(MOVEMENT_SUBSTEP_RATE / TICK_RATE));
export const SERVER_MOVEMENT_TARGET_PENDING_COMMANDS = SERVER_MOVEMENT_SUBSTEPS_PER_TICK * 2;
export const SERVER_MOVEMENT_CATCHUP_MARGIN_COMMANDS = SERVER_MOVEMENT_SUBSTEPS_PER_TICK;

export interface MovementCommandDrainDecision {
  budget: number;
  underflow: boolean;
  catchup: boolean;
  targetPendingCommands: number;
}

export function getMovementCommandDrainDecision(queueLength: number): MovementCommandDrainDecision {
  const commandCount = Math.max(0, Math.trunc(queueLength));
  if (commandCount === 0) {
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
