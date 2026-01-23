// Map boundary polygon - points traced around the playable area perimeter
// These points form a closed polygon for collision checking

export interface BoundaryPoint {
  x: number;
  z: number;
}

// Boundary polygon for Sci-Fi CTF map
// Simple rectangle matching map dimensions (200x100)
// Slightly inset (5 units) from walls to provide buffer for collision response
//
// Map dimensions: x: -100 to +100, z: -50 to +50
// Playable area: x: -95 to +95, z: -45 to +45
export const MAP_BOUNDARY_POLYGON: BoundaryPoint[] = [
  // Clockwise from southwest corner
  { x: -95, z: -45 }, // SW (inside west wall, inside south wall)
  { x: -95, z: 45 },  // NW
  { x: 95, z: 45 },   // NE
  { x: 95, z: -45 },  // SE
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

