import {
  BLAZE_AFTERBURNER_DASH_SPEED,
} from '../constants/physics.js';
import type { Vec3 } from '../types/vector.js';

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

export function getDistanceToBlazeAfterburnerTrail(
  point: Vec3,
  start: Vec3,
  end: Vec3
): number {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const segmentZ = end.z - start.z;
  const segmentLengthSq = segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ;
  if (segmentLengthSq <= 0.000001) {
    return Math.hypot(point.x - start.x, point.y - start.y, point.z - start.z);
  }

  const progress = Math.max(0, Math.min(1, (
    (point.x - start.x) * segmentX +
    (point.y - start.y) * segmentY +
    (point.z - start.z) * segmentZ
  ) / segmentLengthSq));
  const closestX = start.x + segmentX * progress;
  const closestY = start.y + segmentY * progress;
  const closestZ = start.z + segmentZ * progress;
  return Math.hypot(point.x - closestX, point.y - closestY, point.z - closestZ);
}
