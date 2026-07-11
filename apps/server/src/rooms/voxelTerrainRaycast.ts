import type { PlainVec3 } from './bot-ai';

const VOXEL_RAYCAST_TIE_EPSILON = 1e-10;
const VOXEL_RAYCAST_PROBE_EPSILON = 1e-7;

/**
 * Traverses each voxel crossed by a ray and returns the exact entry point of
 * the first colliding voxel. Work scales with crossed voxel boundaries rather
 * than an arbitrary fixed-step sample interval.
 */
export function raycastVoxelTerrain(
  start: PlainVec3,
  direction: PlainVec3,
  maxDistance: number,
  origin: PlainVec3,
  voxelSize: PlainVec3,
  isCollisionAtWorld: (point: PlainVec3) => boolean,
  point: PlainVec3 = { x: 0, y: 0, z: 0 },
): PlainVec3 | null {
  const directionLength = Math.sqrt(
    direction.x * direction.x + direction.y * direction.y + direction.z * direction.z
  );
  if (
    !Number.isFinite(directionLength)
    || directionLength <= 0.0001
    || !Number.isFinite(maxDistance)
    || maxDistance < 0
    || voxelSize.x <= 0
    || voxelSize.y <= 0
    || voxelSize.z <= 0
  ) {
    return null;
  }

  const dirX = direction.x / directionLength;
  const dirY = direction.y / directionLength;
  const dirZ = direction.z / directionLength;
  const gridX = Math.floor((start.x - origin.x) / voxelSize.x);
  const gridY = Math.floor((start.y - origin.y) / voxelSize.y);
  const gridZ = Math.floor((start.z - origin.z) / voxelSize.z);

  point.x = start.x;
  point.y = start.y;
  point.z = start.z;
  if (isCollisionAtWorld(point)) return { ...start };

  const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0;
  const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0;
  const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0;
  const deltaX = stepX === 0 ? Number.POSITIVE_INFINITY : voxelSize.x / Math.abs(dirX);
  const deltaY = stepY === 0 ? Number.POSITIVE_INFINITY : voxelSize.y / Math.abs(dirY);
  const deltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : voxelSize.z / Math.abs(dirZ);
  let boundaryDistanceX = stepX === 0
    ? Number.POSITIVE_INFINITY
    : (origin.x + (gridX + (stepX > 0 ? 1 : 0)) * voxelSize.x - start.x) / dirX;
  let boundaryDistanceY = stepY === 0
    ? Number.POSITIVE_INFINITY
    : (origin.y + (gridY + (stepY > 0 ? 1 : 0)) * voxelSize.y - start.y) / dirY;
  let boundaryDistanceZ = stepZ === 0
    ? Number.POSITIVE_INFINITY
    : (origin.z + (gridZ + (stepZ > 0 ? 1 : 0)) * voxelSize.z - start.z) / dirZ;

  while (true) {
    const entryDistance = Math.min(boundaryDistanceX, boundaryDistanceY, boundaryDistanceZ);
    if (!Number.isFinite(entryDistance) || entryDistance > maxDistance + VOXEL_RAYCAST_TIE_EPSILON) {
      return null;
    }

    // Advance every tied axis together so a ray passing exactly through an
    // edge or corner does not spuriously visit adjacent, untouched voxels.
    if (boundaryDistanceX <= entryDistance + VOXEL_RAYCAST_TIE_EPSILON) {
      boundaryDistanceX += deltaX;
    }
    if (boundaryDistanceY <= entryDistance + VOXEL_RAYCAST_TIE_EPSILON) {
      boundaryDistanceY += deltaY;
    }
    if (boundaryDistanceZ <= entryDistance + VOXEL_RAYCAST_TIE_EPSILON) {
      boundaryDistanceZ += deltaZ;
    }

    // Probe just inside the entered voxel. This matters for negative rays,
    // where an exact boundary coordinate belongs to the voxel being exited.
    const probeDistance = entryDistance + VOXEL_RAYCAST_PROBE_EPSILON;
    point.x = start.x + dirX * probeDistance;
    point.y = start.y + dirY * probeDistance;
    point.z = start.z + dirZ * probeDistance;
    if (!isCollisionAtWorld(point)) continue;

    return {
      x: start.x + dirX * entryDistance,
      y: start.y + dirY * entryDistance,
      z: start.z + dirZ * entryDistance,
    };
  }
}
