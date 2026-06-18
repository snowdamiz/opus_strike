import {
  MOVEMENT_MAX_SERVER_QUEUE,
  MOVEMENT_SERVER_CATCHUP_BUDGET,
  MOVEMENT_SUBSTEP_RATE,
  TICK_RATE,
} from '@voxel-strike/shared';

export const SERVER_MOVEMENT_SUBSTEPS_PER_TICK = Math.max(1, Math.round(MOVEMENT_SUBSTEP_RATE / TICK_RATE));
export const SERVER_MOVEMENT_TARGET_PENDING_COMMANDS = SERVER_MOVEMENT_SUBSTEPS_PER_TICK * 2;
export const SERVER_MOVEMENT_CATCHUP_MARGIN_COMMANDS = SERVER_MOVEMENT_SUBSTEPS_PER_TICK;
export const SERVER_OWNED_MOVEMENT_STEP_SECONDS = SERVER_MOVEMENT_SUBSTEPS_PER_TICK / MOVEMENT_SUBSTEP_RATE;
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

export interface RoomMovementCatchupBudgetRequest {
  playerId: string;
  requestedExtraSubsteps: number;
  backlogCommands: number;
  oldestCommandClientTimeMs: number;
  skippedCatchupSubsteps: number;
}

export interface RoomMovementCatchupBudgetGrant {
  playerId: string;
  grantedExtraSubsteps: number;
  skippedExtraSubsteps: number;
}

export interface RoomMovementCatchupBudgetAllocation {
  grants: RoomMovementCatchupBudgetGrant[];
  nextCursor: number;
  skippedSubsteps: number;
}

export function getMovementCommandDrainDecision(
  queueLength: number,
  options: { hasAuthorityBarrier?: boolean; hasGameplayInput?: boolean } = {}
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

  if (
    !options.hasAuthorityBarrier &&
    !options.hasGameplayInput &&
    commandCount < SERVER_MOVEMENT_TARGET_PENDING_COMMANDS
  ) {
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

export function allocateRoomMovementCatchupBudget(
  requests: readonly RoomMovementCatchupBudgetRequest[],
  extraSubstepBudget: number,
  cursor = 0
): RoomMovementCatchupBudgetAllocation {
  const grants = requests.map((request) => ({
    playerId: request.playerId,
    grantedExtraSubsteps: 0,
    skippedExtraSubsteps: Math.max(0, Math.trunc(request.requestedExtraSubsteps)),
  }));
  const contenders: Array<{
    request: RoomMovementCatchupBudgetRequest;
    grant: RoomMovementCatchupBudgetGrant;
    index: number;
  }> = [];
  requests.forEach((request, index) => {
    const grant = grants[index];
    if (!grant || request.requestedExtraSubsteps <= 0) return;
    contenders.push({ request, grant, index });
  });
  contenders.sort((a, b) => {
    const skippedDelta = b.request.skippedCatchupSubsteps - a.request.skippedCatchupSubsteps;
    if (skippedDelta !== 0) return skippedDelta;

    const backlogDelta = b.request.backlogCommands - a.request.backlogCommands;
    if (backlogDelta !== 0) return backlogDelta;

    const oldestDelta = a.request.oldestCommandClientTimeMs - b.request.oldestCommandClientTimeMs;
    if (oldestDelta !== 0) return oldestDelta;

    return a.request.playerId.localeCompare(b.request.playerId);
  });

  let remainingBudget = Math.max(0, Math.trunc(extraSubstepBudget));
  let roundStart = contenders.length > 0
    ? Math.max(0, Math.trunc(cursor)) % contenders.length
    : 0;

  while (remainingBudget > 0 && contenders.length > 0) {
    let grantedThisRound = false;

    for (let offset = 0; offset < contenders.length && remainingBudget > 0; offset++) {
      const contender = contenders[(roundStart + offset) % contenders.length];
      if (!contender) continue;
      if (contender.grant.grantedExtraSubsteps >= contender.request.requestedExtraSubsteps) continue;

      contender.grant.grantedExtraSubsteps++;
      contender.grant.skippedExtraSubsteps--;
      remainingBudget--;
      grantedThisRound = true;
    }

    if (!grantedThisRound) break;
  }

  let skippedSubsteps = 0;
  for (const grant of grants) {
    skippedSubsteps += grant.skippedExtraSubsteps;
  }

  return {
    grants,
    nextCursor: contenders.length > 0 ? (roundStart + 1) % contenders.length : 0,
    skippedSubsteps,
  };
}
