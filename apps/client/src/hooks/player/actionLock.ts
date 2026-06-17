export const HERO_ACTION_OVERLAP_GRACE_MS = 180;

export function isActionLockBlocking(
  lockUntilMs: number,
  timestampMs = Date.now(),
  overlapGraceMs = 0
): boolean {
  return lockUntilMs - timestampMs > Math.max(0, overlapGraceMs);
}
