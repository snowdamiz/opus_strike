import {
  clampToBoundaryPolygon,
  constrainToBoundaryPolygon,
  getClosestBoundaryPoint as getClosestPointOnBoundaryPolygon,
  getDefaultProceduralVoxelMap,
  isInsideBoundaryPolygon,
  type BoundaryPoint,
} from '@voxel-strike/shared';

export type { BoundaryPoint };

export const MAP_BOUNDARY_POLYGON: BoundaryPoint[] = [...getDefaultProceduralVoxelMap().boundary];

export function setMapBoundaryPolygon(polygon: BoundaryPoint[]): void {
  MAP_BOUNDARY_POLYGON.splice(0, MAP_BOUNDARY_POLYGON.length, ...polygon);
}

/**
 * Check if a point is inside the boundary polygon using ray casting algorithm
 * @param x - X coordinate to check
 * @param z - Z coordinate to check (using Z as the second axis since Y is up)
 * @returns true if point is inside the polygon
 */
export function isInsideBoundary(x: number, z: number): boolean {
  return isInsideBoundaryPolygon(x, z, MAP_BOUNDARY_POLYGON);
}

/**
 * Find the closest point on the boundary polygon to a given point
 * Also returns the edge normal for sliding along the boundary
 */
export function getClosestBoundaryPoint(x: number, z: number): { point: BoundaryPoint; normal: BoundaryPoint } {
  return getClosestPointOnBoundaryPolygon(x, z, MAP_BOUNDARY_POLYGON);
}

/**
 * Constrain movement to stay inside boundary
 * Instead of pushing player, this prevents crossing the boundary
 * @param prevX - Previous X position (known to be inside)
 * @param prevZ - Previous Z position (known to be inside)
 * @param newX - Desired new X position
 * @param newZ - Desired new Z position
 * @returns Constrained position that stays inside boundary
 */
export function constrainToBoundary(prevX: number, prevZ: number, newX: number, newZ: number): BoundaryPoint {
  return constrainToBoundaryPolygon(prevX, prevZ, newX, newZ, MAP_BOUNDARY_POLYGON);
}

/**
 * Simple clamp - just returns closest valid inside position
 * Used when we don't have a previous position
 */
export function clampToBoundary(x: number, z: number): BoundaryPoint {
  return clampToBoundaryPolygon(x, z, MAP_BOUNDARY_POLYGON);
}
