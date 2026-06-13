import * as THREE from 'three';
import type { ResolvedAbilitySocketOrigin } from './abilitySocketResolver';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export const CHRONOS_ORB_VISUAL_FORWARD_OFFSET = 0.38;

const CHRONOS_ORB_VISUAL_OFFSET_ABILITIES = new Set([
  'chronos_verdant_pulse',
  'chronos_lifeline_conduit',
]);

export function shouldOffsetChronosOrbVisualOrigin(abilityId: string | null | undefined): abilityId is string {
  return Boolean(abilityId && CHRONOS_ORB_VISUAL_OFFSET_ABILITIES.has(abilityId));
}

export function chronosOrbForwardFromYaw(yaw: number): Vec3Like {
  return {
    x: -Math.sin(yaw),
    y: 0,
    z: -Math.cos(yaw),
  };
}

export function offsetChronosOrbVisualVector<T extends THREE.Vector3>(
  target: T,
  direction: Vec3Like | null | undefined,
  abilityId: string | null | undefined,
  offset = CHRONOS_ORB_VISUAL_FORWARD_OFFSET
): T {
  if (!shouldOffsetChronosOrbVisualOrigin(abilityId) || !direction) return target;

  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length <= 0.0001) return target;

  const distance = offset / length;
  target.x += direction.x * distance;
  target.y += direction.y * distance;
  target.z += direction.z * distance;
  return target;
}

export function offsetChronosOrbVisualPlainPosition(
  position: Vec3Like,
  direction: Vec3Like | null | undefined,
  abilityId: string | null | undefined,
  offset = CHRONOS_ORB_VISUAL_FORWARD_OFFSET
): Vec3Like {
  const adjusted = new THREE.Vector3(position.x, position.y, position.z);
  offsetChronosOrbVisualVector(adjusted, direction, abilityId, offset);
  return {
    x: adjusted.x,
    y: adjusted.y,
    z: adjusted.z,
  };
}

export function offsetResolvedChronosOrbVisualOrigin(
  origin: ResolvedAbilitySocketOrigin | null,
  direction: Vec3Like | null | undefined,
  abilityId = origin?.abilityId
): ResolvedAbilitySocketOrigin | null {
  if (!origin || !shouldOffsetChronosOrbVisualOrigin(abilityId)) return origin;

  return {
    ...origin,
    position: offsetChronosOrbVisualVector(origin.position.clone(), direction, abilityId),
  };
}
