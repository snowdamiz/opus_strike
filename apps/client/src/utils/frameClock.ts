export interface FrameClockSnapshot {
  nowMs: number;
  elapsedSeconds: number;
  deltaSeconds: number;
  clampedDeltaSeconds: number;
}

const MAX_DELTA_SECONDS = 1 / 20;

const frameClock: FrameClockSnapshot = {
  nowMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  elapsedSeconds: 0,
  deltaSeconds: 0,
  clampedDeltaSeconds: 0,
};

export function updateFrameClock(elapsedSeconds: number, deltaSeconds: number): FrameClockSnapshot {
  frameClock.nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  frameClock.elapsedSeconds = elapsedSeconds;
  frameClock.deltaSeconds = deltaSeconds;
  frameClock.clampedDeltaSeconds = Math.min(MAX_DELTA_SECONDS, Math.max(0, deltaSeconds));
  return frameClock;
}

export function getFrameClock(): FrameClockSnapshot {
  return frameClock;
}
