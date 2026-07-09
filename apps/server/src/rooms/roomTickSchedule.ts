export interface BoundedRoomTickScheduleInput {
  nowMs: number;
  scheduledTickAtMs: number;
  tickIntervalMs: number;
  maxRetainedTicks: number;
}

export interface BoundedRoomTickSchedule {
  scheduledTickAtMs: number;
  nextTickAtMs: number;
  droppedTickCount: number;
  hasCatchupTick: boolean;
}

/**
 * Retain a bounded amount of fixed-step debt after an event-loop stall.
 *
 * Resetting the schedule from `now` permanently loses simulation time. Keeping
 * all debt can create a spiral of death. This plan keeps only the newest fixed
 * steps and lets the room catch up through zero-delay timer turns so other
 * rooms and I/O still get opportunities to run.
 */
export function getBoundedRoomTickSchedule(
  input: BoundedRoomTickScheduleInput
): BoundedRoomTickSchedule {
  const tickIntervalMs = Math.max(1, input.tickIntervalMs);
  const maxRetainedTicks = Math.max(1, Math.floor(input.maxRetainedTicks));
  const requestedTickAtMs = input.scheduledTickAtMs > 0
    ? input.scheduledTickAtMs
    : input.nowMs;
  const earliestRetainedTickAtMs = input.nowMs - (maxRetainedTicks - 1) * tickIntervalMs;
  const scheduledTickAtMs = Math.max(requestedTickAtMs, earliestRetainedTickAtMs);
  const droppedTickCount = Math.max(
    0,
    Math.round((scheduledTickAtMs - requestedTickAtMs) / tickIntervalMs)
  );
  const nextTickAtMs = scheduledTickAtMs + tickIntervalMs;

  return {
    scheduledTickAtMs,
    nextTickAtMs,
    droppedTickCount,
    hasCatchupTick: nextTickAtMs <= input.nowMs,
  };
}
