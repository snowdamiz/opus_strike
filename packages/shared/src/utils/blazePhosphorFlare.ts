import type { Vec3 } from '../types/vector.js';

const MIN_FLIGHT_DURATION_MS = 620;
const MAX_FLIGHT_DURATION_MS = 980;
const FLIGHT_DURATION_MS_PER_UNIT = 12;
const BASE_ARC_HEIGHT = 3.8;
const ARC_HEIGHT_PER_UNIT = 0.12;
const MAX_ARC_HEIGHT = 8.5;

export const BLAZE_PHOSPHOR_FLARE_PATH_SEGMENTS = 12;

export function getBlazePhosphorFlareFlightDurationMs(
  startPosition: Vec3,
  targetPosition: Vec3
): number {
  const horizontalDistance = Math.hypot(
    targetPosition.x - startPosition.x,
    targetPosition.z - startPosition.z
  );
  return Math.round(Math.max(
    MIN_FLIGHT_DURATION_MS,
    Math.min(MAX_FLIGHT_DURATION_MS, MIN_FLIGHT_DURATION_MS + horizontalDistance * FLIGHT_DURATION_MS_PER_UNIT)
  ));
}

export function getBlazePhosphorFlarePoint(
  startPosition: Vec3,
  targetPosition: Vec3,
  progress: number
): Vec3 {
  return writeBlazePhosphorFlarePoint({}, startPosition, targetPosition, progress);
}

export function writeBlazePhosphorFlarePoint<T extends Partial<Vec3>>(
  out: T,
  startPosition: Vec3,
  targetPosition: Vec3,
  progress: number
): T & Vec3 {
  const t = Math.max(0, Math.min(1, progress));
  if (t === 0 || t === 1) {
    const endpoint = t === 0 ? startPosition : targetPosition;
    out.x = endpoint.x;
    out.y = endpoint.y;
    out.z = endpoint.z;
    return out as T & Vec3;
  }
  const horizontalDistance = Math.hypot(
    targetPosition.x - startPosition.x,
    targetPosition.z - startPosition.z
  );
  const arcHeight = Math.min(MAX_ARC_HEIGHT, BASE_ARC_HEIGHT + horizontalDistance * ARC_HEIGHT_PER_UNIT);
  const linearY = startPosition.y + (targetPosition.y - startPosition.y) * t;

  out.x = startPosition.x + (targetPosition.x - startPosition.x) * t;
  out.y = linearY + Math.sin(Math.PI * t) * arcHeight;
  out.z = startPosition.z + (targetPosition.z - startPosition.z) * t;
  return out as T & Vec3;
}
