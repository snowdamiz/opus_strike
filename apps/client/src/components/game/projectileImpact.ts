import type { Vec3 } from '@voxel-strike/shared';

export interface ProjectileImpactHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
}

export function getAuthoritativeProjectileImpactHit(
  position: Vec3,
  direction: Vec3,
  impactPosition: Vec3 | null | undefined,
  collisionDistance: number,
  projectileRadius = 0
): ProjectileImpactHit | null {
  if (!impactPosition) return null;

  const toImpact = {
    x: impactPosition.x - position.x,
    y: impactPosition.y - position.y,
    z: impactPosition.z - position.z,
  };
  const forwardDistance =
    toImpact.x * direction.x +
    toImpact.y * direction.y +
    toImpact.z * direction.z;

  if (forwardDistance < -projectileRadius || forwardDistance > collisionDistance) {
    return null;
  }

  return {
    point: impactPosition,
    normal: {
      x: -direction.x,
      y: -direction.y,
      z: -direction.z,
    },
    distance: Math.max(0, forwardDistance),
  };
}
