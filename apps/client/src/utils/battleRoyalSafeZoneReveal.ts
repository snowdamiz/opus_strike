import type { SafeZoneSnapshot } from '@voxel-strike/shared';

export function isSafeZoneTargetRevealed(
  safeZone: SafeZoneSnapshot,
  now = Date.now()
): boolean {
  return !Number.isFinite(safeZone.nextZoneRevealsAt) || now >= safeZone.nextZoneRevealsAt;
}
