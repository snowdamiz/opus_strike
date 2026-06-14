import type { Vec3 } from '@voxel-strike/shared';
import {
  canCapsuleOccupy,
  sweepCapsulePathClear,
  type MovementCollisionWorld,
} from './CapsuleMotor.js';

export interface CapsuleTeleportDestinationOptions {
  minDistance?: number;
  distanceStep?: number;
  height?: number;
  radius?: number;
  clampPosition?: (position: Vec3) => Vec3;
}

function normalizeDirection(direction: Vec3): Vec3 | null {
  const length = Math.sqrt(
    direction.x * direction.x +
    direction.y * direction.y +
    direction.z * direction.z
  );

  if (!Number.isFinite(length) || length <= 0.0001) return null;

  return {
    x: direction.x / length,
    y: direction.y / length,
    z: direction.z / length,
  };
}

export function resolveCapsuleTeleportDestination(
  world: MovementCollisionWorld,
  start: Vec3,
  direction: Vec3,
  maxDistance: number,
  options: CapsuleTeleportDestinationOptions = {}
): Vec3 {
  const normalizedDirection = normalizeDirection(direction);
  if (!normalizedDirection || !Number.isFinite(maxDistance) || maxDistance <= 0) {
    return { ...start };
  }

  const minDistance = Math.max(0, options.minDistance ?? 2);
  const distanceStep = Math.max(0.05, options.distanceStep ?? 0.5);

  for (let testDistance = maxDistance; testDistance >= minDistance; testDistance -= distanceStep) {
    const rawCandidate = {
      x: start.x + normalizedDirection.x * testDistance,
      y: start.y + normalizedDirection.y * testDistance,
      z: start.z + normalizedDirection.z * testDistance,
    };
    const candidate = options.clampPosition?.(rawCandidate) ?? rawCandidate;

    if (!sweepCapsulePathClear(world, start, candidate, options.height, options.radius)) continue;
    if (!canCapsuleOccupy(world, candidate, options.height, options.radius)) continue;
    return candidate;
  }

  return { ...start };
}
