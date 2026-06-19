import type { BoundaryPoint } from './types.js';

export function isInsideBoundaryPolygon(x: number, z: number, polygon: BoundaryPoint[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const zi = polygon[i].z;
    const xj = polygon[j].x;
    const zj = polygon[j].z;

    if (((zi > z) !== (zj > z)) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

export function getClosestBoundaryPoint(
  x: number,
  z: number,
  polygon: BoundaryPoint[]
): { point: BoundaryPoint; normal: BoundaryPoint } {
  let closestPoint: BoundaryPoint = polygon[0];
  let closestNormal: BoundaryPoint = { x: 0, z: 1 };
  let closestDist = Infinity;
  const centroid = polygon.reduce(
    (sum, point) => ({ x: sum.x + point.x / polygon.length, z: sum.z + point.z / polygon.length }),
    { x: 0, z: 0 }
  );

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const p1 = polygon[i];
    const p2 = polygon[j];
    const edgeX = p2.x - p1.x;
    const edgeZ = p2.z - p1.z;
    const edgeLenSq = edgeX * edgeX + edgeZ * edgeZ;

    if (edgeLenSq === 0) continue;

    const t = Math.max(0, Math.min(1, ((x - p1.x) * edgeX + (z - p1.z) * edgeZ) / edgeLenSq));
    const closestOnEdgeX = p1.x + t * edgeX;
    const closestOnEdgeZ = p1.z + t * edgeZ;
    const dist = Math.sqrt((x - closestOnEdgeX) ** 2 + (z - closestOnEdgeZ) ** 2);

    if (dist < closestDist) {
      const edgeLen = Math.sqrt(edgeLenSq);
      const normalX = -edgeZ / edgeLen;
      const normalZ = edgeX / edgeLen;
      const toCenterX = centroid.x - closestOnEdgeX;
      const toCenterZ = centroid.z - closestOnEdgeZ;
      const pointsInside = normalX * toCenterX + normalZ * toCenterZ > 0;
      closestDist = dist;
      closestPoint = { x: closestOnEdgeX, z: closestOnEdgeZ };
      closestNormal = pointsInside ? { x: normalX, z: normalZ } : { x: -normalX, z: -normalZ };
    }
  }

  return { point: closestPoint, normal: closestNormal };
}

export function constrainToBoundaryPolygon(
  prevX: number,
  prevZ: number,
  newX: number,
  newZ: number,
  polygon: BoundaryPoint[]
): BoundaryPoint {
  if (isInsideBoundaryPolygon(newX, newZ, polygon)) {
    return { x: newX, z: newZ };
  }

  const { point: closest, normal } = getClosestBoundaryPoint(newX, newZ, polygon);
  const moveX = newX - prevX;
  const moveZ = newZ - prevZ;
  const edgeDirX = -normal.z;
  const edgeDirZ = normal.x;
  const slideAmount = moveX * edgeDirX + moveZ * edgeDirZ;

  let slideX = closest.x + edgeDirX * slideAmount * 0.5;
  let slideZ = closest.z + edgeDirZ * slideAmount * 0.5;

  if (!isInsideBoundaryPolygon(slideX, slideZ, polygon)) {
    slideX = closest.x + normal.x * 0.1;
    slideZ = closest.z + normal.z * 0.1;

    if (!isInsideBoundaryPolygon(slideX, slideZ, polygon)) {
      return { x: prevX, z: prevZ };
    }
  }

  return { x: slideX, z: slideZ };
}

export function clampToBoundaryPolygon(x: number, z: number, polygon: BoundaryPoint[]): BoundaryPoint {
  if (isInsideBoundaryPolygon(x, z, polygon)) {
    return { x, z };
  }

  const { point: closest, normal } = getClosestBoundaryPoint(x, z, polygon);
  const nudged = {
    x: closest.x + normal.x * 0.2,
    z: closest.z + normal.z * 0.2,
  };
  if (isInsideBoundaryPolygon(nudged.x, nudged.z, polygon)) {
    return nudged;
  }

  const centroid = polygon.reduce(
    (sum, point) => ({ x: sum.x + point.x / polygon.length, z: sum.z + point.z / polygon.length }),
    { x: 0, z: 0 }
  );
  const inwardX = centroid.x - closest.x;
  const inwardZ = centroid.z - closest.z;
  const inwardLength = Math.hypot(inwardX, inwardZ) || 1;
  return {
    x: closest.x + (inwardX / inwardLength) * 0.35,
    z: closest.z + (inwardZ / inwardLength) * 0.35,
  };
}
