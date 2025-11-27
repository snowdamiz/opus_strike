// Map boundary polygon - points traced around the playable area perimeter
// These points form a closed polygon for collision checking

export interface BoundaryPoint {
  x: number;
  z: number;
}

// Boundary polygon for Inferno_World_free map
// Points are ordered to trace around the perimeter
export const MAP_BOUNDARY_POLYGON: BoundaryPoint[] = [
  // Southwest corner and south edge
  { x: -46.6, z: -37.2 },
  { x: -48.4, z: -40.2 },
  { x: -46.4, z: -43.9 },
  { x: -43.9, z: -47.0 },
  { x: -42.2, z: -48.1 },
  { x: -42.8, z: -49.6 },
  { x: -45.8, z: -57.1 },
  { x: -37.4, z: -60.5 },
  { x: -31.0, z: -59.5 },
  { x: -26.5, z: -53.7 },
  { x: -28.7, z: -46.9 },
  { x: -34.1, z: -49.6 },
  { x: -29.1, z: -44.1 },
  { x: -24.4, z: -42.4 },
  { x: -22.2, z: -44.6 },
  { x: -19.7, z: -44.6 },
  { x: -20.4, z: -40.1 },
  { x: -21.9, z: -37.7 },
  { x: -21.0, z: -33.1 },
  { x: -17.4, z: -32.2 },
  { x: -13.8, z: -34.3 },
  { x: -12.2, z: -34.6 },
  { x: -10.4, z: -36.5 },
  { x: -10.4, z: -39.0 },
  { x: -5.3, z: -37.5 },
  { x: 2.3, z: -31.5 },
  { x: 9.7, z: -30.2 },
  { x: 10.2, z: -34.9 },
  { x: 12.2, z: -37.8 },
  { x: 14.1, z: -41.1 },
  { x: 17.0, z: -42.1 },
  { x: 18.6, z: -41.8 },
  { x: 21.8, z: -37.7 },
  { x: 26.6, z: -37.7 },
  { x: 27.4, z: -36.7 },
  { x: 27.5, z: -35.0 },
  { x: 29.3, z: -36.1 },
  { x: 32.7, z: -37.3 },
  { x: 35.1, z: -37.2 },
  { x: 39.5, z: -38.5 },
  { x: 41.4, z: -38.0 },
  { x: 42.6, z: -35.4 },
  { x: 45.7, z: -33.9 },
  { x: 46.0, z: -31.3 },
  { x: 45.4, z: -29.0 },
  { x: 43.5, z: -27.9 },
  { x: 42.1, z: -26.7 },
  { x: 37.5, z: -23.1 },
  { x: 35.0, z: -22.4 },
  { x: 33.5, z: -16.7 },
  { x: 33.5, z: -12.1 },
  { x: 33.0, z: -11.3 },
  { x: 31.9, z: -11.3 },
  { x: 30.9, z: -9.9 },
  { x: 31.6, z: -9.2 },
  { x: 35.7, z: -9.1 },
  { x: 37.8, z: -9.7 },
  { x: 39.9, z: -10.1 },
  { x: 41.3, z: -8.7 },
  { x: 41.5, z: -7.0 },
  { x: 40.8, z: -6.0 },
  { x: 41.6, z: -4.9 },
  { x: 44.2, z: -3.3 },
  { x: 44.7, z: -0.5 },
  { x: 45.5, z: -3.0 },
  { x: 48.0, z: -3.0 },
  { x: 48.7, z: -1.7 },
  { x: 49.0, z: 1.2 },
  { x: 45.5, z: 5.3 },
  { x: 42.8, z: 6.2 },
  { x: 42.7, z: 8.3 },
  { x: 42.2, z: 10.6 },
  { x: 41.5, z: 17.2 },
  // North edge (connecting east to west)
  { x: -36.3, z: 18.3 },
  // Northwest area
  { x: -44.0, z: 38.2 },
  { x: -36.5, z: 19.1 },
  { x: -30.5, z: 1.9 },
  { x: -33.3, z: -5.5 },
  { x: -29.4, z: -13.8 },
  { x: -31.4, z: -16.9 },
  { x: -34.0, z: -18.8 },
  { x: -34.8, z: -22.0 },
  { x: -34.2, z: -24.9 },
  { x: -45.1, z: -26.4 },
  { x: -45.2, z: -30.0 },
  { x: -45.5, z: -32.7 },
  { x: -46.8, z: -34.1 },
  // Closes back to first point
];

/**
 * Check if a point is inside the boundary polygon using ray casting algorithm
 * @param x - X coordinate to check
 * @param z - Z coordinate to check (using Z as the second axis since Y is up)
 * @returns true if point is inside the polygon
 */
export function isInsideBoundary(x: number, z: number): boolean {
  const polygon = MAP_BOUNDARY_POLYGON;
  let inside = false;
  
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;
    
    // Ray casting algorithm
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
      inside = !inside;
    }
  }
  
  return inside;
}

/**
 * Find the closest point on the boundary polygon to a given point
 * Also returns the edge normal for sliding along the boundary
 */
export function getClosestBoundaryPoint(x: number, z: number): { point: BoundaryPoint; normal: BoundaryPoint } {
  const polygon = MAP_BOUNDARY_POLYGON;
  let closestPoint: BoundaryPoint = polygon[0];
  let closestNormal: BoundaryPoint = { x: 0, z: 1 };
  let closestDist = Infinity;
  
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const p1 = polygon[i];
    const p2 = polygon[j];
    
    // Find closest point on edge p1-p2 to point (x, z)
    const edgeX = p2.x - p1.x;
    const edgeZ = p2.z - p1.z;
    const edgeLenSq = edgeX * edgeX + edgeZ * edgeZ;
    
    if (edgeLenSq === 0) continue;
    
    // Project point onto edge
    let t = ((x - p1.x) * edgeX + (z - p1.z) * edgeZ) / edgeLenSq;
    t = Math.max(0, Math.min(1, t));
    
    const closestOnEdgeX = p1.x + t * edgeX;
    const closestOnEdgeZ = p1.z + t * edgeZ;
    
    const dist = Math.sqrt((x - closestOnEdgeX) ** 2 + (z - closestOnEdgeZ) ** 2);
    
    if (dist < closestDist) {
      closestDist = dist;
      closestPoint = { x: closestOnEdgeX, z: closestOnEdgeZ };
      
      // Calculate inward-facing normal (perpendicular to edge, pointing into polygon)
      const edgeLen = Math.sqrt(edgeLenSq);
      // Normal perpendicular to edge (rotate 90 degrees)
      const nx = -edgeZ / edgeLen;
      const nz = edgeX / edgeLen;
      closestNormal = { x: nx, z: nz };
    }
  }
  
  return { point: closestPoint, normal: closestNormal };
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
  // If new position is inside, allow it
  if (isInsideBoundary(newX, newZ)) {
    return { x: newX, z: newZ };
  }
  
  // New position is outside - find where we hit the boundary
  const { point: closest, normal } = getClosestBoundaryPoint(newX, newZ);
  
  // Calculate movement vector
  const moveX = newX - prevX;
  const moveZ = newZ - prevZ;
  
  // Project movement onto the boundary edge (slide along it)
  // Edge direction is perpendicular to normal
  const edgeDirX = -normal.z;
  const edgeDirZ = normal.x;
  
  // Dot product of movement with edge direction
  const slideAmount = moveX * edgeDirX + moveZ * edgeDirZ;
  
  // Calculate slide position along the boundary
  let slideX = closest.x + edgeDirX * slideAmount * 0.5;
  let slideZ = closest.z + edgeDirZ * slideAmount * 0.5;
  
  // Verify slide position is inside, if not just use closest point
  if (!isInsideBoundary(slideX, slideZ)) {
    // Just stop at closest point on boundary (slightly inside)
    slideX = closest.x + normal.x * 0.1;
    slideZ = closest.z + normal.z * 0.1;
    
    // If still outside, just stay at previous position
    if (!isInsideBoundary(slideX, slideZ)) {
      return { x: prevX, z: prevZ };
    }
  }
  
  return { x: slideX, z: slideZ };
}

/**
 * Simple clamp - just returns closest valid inside position
 * Used when we don't have a previous position
 */
export function clampToBoundary(x: number, z: number): BoundaryPoint {
  if (isInsideBoundary(x, z)) {
    return { x, z };
  }
  
  const { point: closest, normal } = getClosestBoundaryPoint(x, z);
  
  // Move slightly inside along the normal
  return {
    x: closest.x + normal.x * 0.2,
    z: closest.z + normal.z * 0.2,
  };
}

