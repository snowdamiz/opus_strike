import {
  BLAZE_AFTERBURNER_DASH_DURATION_MS,
  BLAZE_AFTERBURNER_DASH_SPEED,
} from '../constants/physics.js';
import { BLAZE_AFTERBURNER_TRAIL_SAMPLE_SPACING } from '../constants/heroes.js';
import type { Vec3 } from '../types/vector.js';

// The dash normally emits 21 points. The small allowance covers the initial
// point and tick-boundary interpolation without permitting an unbounded trail.
export const BLAZE_AFTERBURNER_MAX_TRAIL_POINTS = Math.ceil(
  BLAZE_AFTERBURNER_DASH_SPEED
    * (BLAZE_AFTERBURNER_DASH_DURATION_MS / 1000)
    / BLAZE_AFTERBURNER_TRAIL_SAMPLE_SPACING
) + 4;

export function getBlazeAfterburnerDirection(lookYaw: number): Vec3 {
  return {
    x: -Math.sin(lookYaw),
    y: 0,
    z: -Math.cos(lookYaw),
  };
}

export function calculateBlazeAfterburnerVelocity(
  currentVelocity: Vec3,
  lookYaw: number
): Vec3 {
  const direction = getBlazeAfterburnerDirection(lookYaw);
  return {
    x: direction.x * BLAZE_AFTERBURNER_DASH_SPEED,
    y: currentVelocity.y,
    z: direction.z * BLAZE_AFTERBURNER_DASH_SPEED,
  };
}

export function getSquaredDistanceToBlazeAfterburnerTrail(
  point: Vec3,
  start: Vec3,
  end: Vec3
): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentZ = end.z - start.z;
  const segmentLengthSq = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
  if (segmentLengthSq <= 0.000001) {
    const pointX = point.x - start.x;
    const pointY = point.y - start.y;
    const pointZ = point.z - start.z;
    return pointX * pointX + pointY * pointY + pointZ * pointZ;
  }

  const progress = Math.max(0, Math.min(1, (
    (point.x - start.x) * segmentX +
    (point.y - start.y) * segmentY +
    (point.z - start.z) * segmentZ
  ) / segmentLengthSq));
  const closestX = start.x + segmentX * progress;
  const closestY = start.y + segmentY * progress;
  const closestZ = start.z + segmentZ * progress;
  const closestDeltaX = point.x - closestX;
  const closestDeltaY = point.y - closestY;
  const closestDeltaZ = point.z - closestZ;
  return closestDeltaX * closestDeltaX
    + closestDeltaY * closestDeltaY
    + closestDeltaZ * closestDeltaZ;
}
