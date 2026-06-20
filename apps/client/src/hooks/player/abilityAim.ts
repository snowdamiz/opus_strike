import type { Vec3 } from '@voxel-strike/shared';
import { calculateLookDirection } from './constants';
import type { AbilityContext } from './types';

export const THIRD_PERSON_CROSSHAIR_AIM_DISTANCE = 120;

export interface PlainVec3 {
  x: number;
  y: number;
  z: number;
}

function normalize(vector: PlainVec3): Vec3 | null {
  const length = Math.sqrt(
    vector.x * vector.x +
    vector.y * vector.y +
    vector.z * vector.z
  );
  if (length <= 0.0001) return null;

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

export function getAbilityFallbackAimPoint(
  ctx: AbilityContext,
  distance = THIRD_PERSON_CROSSHAIR_AIM_DISTANCE
): Vec3 {
  const direction = calculateLookDirection(ctx.yaw, ctx.pitch);
  return {
    x: ctx.position.x + direction.x * distance,
    y: ctx.position.y + direction.y * distance,
    z: ctx.position.z + direction.z * distance,
  };
}

export function getAbilityAimPoint(
  ctx: AbilityContext,
  distance = THIRD_PERSON_CROSSHAIR_AIM_DISTANCE
): Vec3 {
  return ctx.aimPoint ?? getAbilityFallbackAimPoint(ctx, distance);
}

export function resolveAbilityAimDirection(
  ctx: AbilityContext,
  startPosition: PlainVec3,
  distance = THIRD_PERSON_CROSSHAIR_AIM_DISTANCE
): Vec3 {
  if (!ctx.aimPoint) {
    return calculateLookDirection(ctx.yaw, ctx.pitch);
  }

  const aimPoint = getAbilityAimPoint(ctx, distance);
  return normalize({
    x: aimPoint.x - startPosition.x,
    y: aimPoint.y - startPosition.y,
    z: aimPoint.z - startPosition.z,
  }) ?? calculateLookDirection(ctx.yaw, ctx.pitch);
}
