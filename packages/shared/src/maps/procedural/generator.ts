import { getBlockNumericId, isSolidBlock } from './blocks.js';
import { PLAYER_HEIGHT } from '../../constants/physics.js';
import { getClosestBoundaryPoint, isInsideBoundaryPolygon } from './boundaries.js';
import { generateVoxelColliders } from './colliders.js';
import { createProceduralCTFLayout, PROCEDURAL_VOXEL_SIZE } from './ctfLayout.js';
import { fractalNoise2 } from './noise.js';
import { mulberry32 } from './rng.js';
import { getVoxelMapTheme } from './themes.js';
import {
  DEFAULT_PROCEDURAL_MAP_SEED,
  type BoundaryPoint,
  type VoxelBlockId,
  type VoxelChunk,
  type VoxelMapManifest,
  type VoxelMapTheme,
  type VoxelSize,
} from './types.js';

type BlockSetter = (x: number, y: number, z: number, blockId: VoxelBlockId) => void;

interface FeatureAnchor {
  x: number;
  z: number;
  radius: number;
}

interface GridDirection {
  dx: -1 | 0 | 1;
  dz: -1 | 0 | 1;
}

const SPAWN_CLEARANCE = 0;
const SPAWN_PAD_RADIUS = 1.35;
const SPAWN_BLEND_RADIUS = 3.35;
const SPAWN_CLEAR_RADIUS = 2.2;
const SPAWN_SIGHTLINE_EYE_OFFSET = PLAYER_HEIGHT / 2 + 0.75;
const SIGHTLINE_BARRIER_BASE_HEIGHT = 9;
const SIGHTLINE_BARRIER_EXTRA_HEIGHT = 7;
const TERRAIN_SMOOTHING_PASSES = 2;
const MAX_NAVIGATION_STEP_ROWS = 2;
const FEATURE_ENTRANCE_HEADROOM = 0.65;
const FEATURE_ENTRANCE_CLEARANCE_ROWS = Math.max(
  1,
  Math.round((PLAYER_HEIGHT + FEATURE_ENTRANCE_HEADROOM) / PROCEDURAL_VOXEL_SIZE.y)
);
const STRUCTURE_ENTRANCE_HALF_WIDTH_CELLS = 3;
const CAVE_ENTRANCE_HALF_WIDTH_CELLS = 3;
const FEATURE_APPROACH_WORLD_LENGTH = 4.5;

function chunkIndex(x: number, y: number, z: number, size: VoxelSize): number {
  return x + size.x * (z + size.z * y);
}

function worldToGrid(value: number, origin: number): number {
  return Math.floor((value - origin) / PROCEDURAL_VOXEL_SIZE.x);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(valueA: number, valueB: number, amount: number): number {
  return valueA + (valueB - valueA) * amount;
}

function gridToWorldCenter(value: number, origin: number): number {
  return origin + (value + 0.5) * PROCEDURAL_VOXEL_SIZE.x;
}

function worldHeightToGridRows(worldHeight: number): number {
  return Math.max(1, Math.round(worldHeight / PROCEDURAL_VOXEL_SIZE.y));
}

function worldDistanceToGridCells(worldDistance: number): number {
  return Math.max(1, Math.round(worldDistance / PROCEDURAL_VOXEL_SIZE.x));
}

function gridRowsToWorldY(rows: number, originY = 0): number {
  return originY + rows * PROCEDURAL_VOXEL_SIZE.y;
}

function worldYToGridRow(worldY: number, originY = 0): number {
  return Math.floor((worldY - originY) / PROCEDURAL_VOXEL_SIZE.y);
}

function gridIndexFromWorld(worldX: number, worldZ: number, origin: { x: number; z: number }, size: VoxelSize): number {
  const x = clamp(worldToGrid(worldX, origin.x), 0, size.x - 1);
  const z = clamp(worldToGrid(worldZ, origin.z), 0, size.z - 1);
  return x + z * size.x;
}

function getHeightAt(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldZ: number
): number {
  return heightMap[gridIndexFromWorld(worldX, worldZ, origin, size)];
}

function distanceSq(xA: number, zA: number, xB: number, zB: number): number {
  const dx = xA - xB;
  const dz = zA - zB;
  return dx * dx + dz * dz;
}

function distanceToBoundary(worldX: number, worldZ: number, boundary: BoundaryPoint[]): number {
  const { point } = getClosestBoundaryPoint(worldX, worldZ, boundary);
  return Math.sqrt(distanceSq(worldX, worldZ, point.x, point.z));
}

function getBoundaryRange(boundary: BoundaryPoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(...boundary.map((point) => point.x)),
    maxX: Math.max(...boundary.map((point) => point.x)),
    minZ: Math.min(...boundary.map((point) => point.z)),
    maxZ: Math.max(...boundary.map((point) => point.z)),
  };
}

function isNearProtectedGameplayArea(
  layout: ReturnType<typeof createProceduralCTFLayout>,
  worldX: number,
  worldZ: number,
  radius: number
): boolean {
  for (const flag of [layout.flagZones.red, layout.flagZones.blue]) {
    if (distanceSq(worldX, worldZ, flag.x, flag.z) < (radius + 8) ** 2) return true;
  }

  for (const spawn of [...layout.spawnPoints.red, ...layout.spawnPoints.blue]) {
    if (distanceSq(worldX, worldZ, spawn.x, spawn.z) < (radius + 7) ** 2) return true;
  }

  return false;
}

function getWorldRectBounds(
  origin: { x: number; z: number },
  size: VoxelSize,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): { gx0: number; gx1: number; gz0: number; gz1: number } {
  return {
    gx0: clamp(worldToGrid(minX, origin.x), 0, size.x - 1),
    gx1: clamp(worldToGrid(maxX, origin.x), 0, size.x - 1),
    gz0: clamp(worldToGrid(minZ, origin.z), 0, size.z - 1),
    gz1: clamp(worldToGrid(maxZ, origin.z), 0, size.z - 1),
  };
}

function getMaxHeightInRect(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number
): number {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(origin, size, minX, maxX, minZ, maxZ);
  let maxHeight = 0;

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      maxHeight = Math.max(maxHeight, heightMap[x + z * size.x]);
    }
  }

  return maxHeight;
}

function applyEllipticalHeightDelta(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  deltaRows: number,
  minRows: number,
  maxRows: number,
  featureSeed: number
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    centerX - radiusX,
    centerX + radiusX,
    centerZ - radiusZ,
    centerZ + radiusZ
  );

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const nx = (worldX - centerX) / radiusX;
      const nz = (worldZ - centerZ) / radiusZ;
      const radial = nx * nx + nz * nz;
      if (radial > 1) continue;

      const ridgeNoise = fractalNoise2(featureSeed, worldX * 0.1, worldZ * 0.1, 3);
      const chippedEdge = fractalNoise2(featureSeed ^ 0x6d2b79f5, worldX * 0.35, worldZ * 0.35, 2);
      const falloff = Math.pow(1 - radial, 1.35);
      const edgeBreakup = lerp(0.72, 1.18, ridgeNoise) - (radial > 0.72 ? chippedEdge * 0.22 : 0);
      const delta = Math.round(deltaRows * falloff * edgeBreakup);
      if (delta === 0) continue;

      const index = x + z * size.x;
      heightMap[index] = clamp(heightMap[index] + delta, minRows, maxRows);
    }
  }
}

function applySinuousValley(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  length: number,
  halfWidth: number,
  depthRows: number,
  minRows: number,
  featureSeed: number
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    centerX - halfWidth * 2.2,
    centerX + halfWidth * 2.2,
    centerZ - length / 2,
    centerZ + length / 2
  );

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const along = Math.abs(worldZ - centerZ) / (length / 2);
      if (along > 1) continue;

      const sway =
        Math.sin((worldZ + featureSeed * 0.0007) * 0.22) * 1.9 +
        (fractalNoise2(featureSeed ^ 0x85ebca6b, worldZ * 0.04, centerX * 0.04, 3) - 0.5) * 3.2;
      const valleyX = centerX + sway;
      const distance = Math.abs(worldX - valleyX);
      if (distance > halfWidth) continue;

      const widthFalloff = Math.pow(1 - distance / halfWidth, 1.7);
      const endFalloff = Math.pow(1 - along, 0.42);
      const ledgeNoise = fractalNoise2(featureSeed ^ 0x1b873593, worldX * 0.2, worldZ * 0.2, 2);
      const delta = Math.round(depthRows * widthFalloff * endFalloff * lerp(0.82, 1.24, ledgeNoise));
      if (delta <= 0) continue;

      const index = x + z * size.x;
      heightMap[index] = Math.max(minRows, heightMap[index] - delta);
    }
  }
}

function applyTerrainLandforms(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  random: () => number,
  seed: number,
  minRows: number,
  maxRows: number
): void {
  const boundaryRange = getBoundaryRange(layout.boundary);
  const halfPlayableX = Math.min(29, Math.max(14, (boundaryRange.maxX - boundaryRange.minX) * 0.5 - 5));
  const halfPlayableZ = Math.min(23, Math.max(11, (boundaryRange.maxZ - boundaryRange.minZ) * 0.5 - 5));
  const hillCount = 5 + Math.floor(random() * 5);
  const valleyCount = 3 + Math.floor(random() * 4);
  const ravineCount = 1 + Math.floor(random() * 3);

  for (let i = 0; i < hillCount; i++) {
    const centerX = lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = lerp(6.5, 15.5, random());
    const radiusZ = lerp(5.8, 14.5, random());
    const deltaRows = worldHeightToGridRows(lerp(0.8, 2.8, random()));
    const featureSeed = seed ^ Math.floor(random() * 0xffffffff);

    applyEllipticalHeightDelta(heightMap, origin, size, centerX, centerZ, radiusX, radiusZ, deltaRows, minRows, maxRows, featureSeed);
  }

  for (let i = 0; i < valleyCount; i++) {
    const centerX = lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = lerp(7, 16.5, random());
    const radiusZ = lerp(6.5, 15, random());
    const deltaRows = -worldHeightToGridRows(lerp(0.7, 2.4, random()));
    const featureSeed = seed ^ Math.floor(random() * 0xffffffff);

    applyEllipticalHeightDelta(heightMap, origin, size, centerX, centerZ, radiusX, radiusZ, deltaRows, minRows, maxRows, featureSeed);
  }

  for (let i = 0; i < ravineCount; i++) {
    applySinuousValley(
      heightMap,
      origin,
      size,
      lerp(-halfPlayableX, halfPlayableX, random()),
      lerp(-halfPlayableZ * 0.45, halfPlayableZ * 0.45, random()),
      lerp(halfPlayableZ * 0.55, halfPlayableZ * 1.15, random()),
      lerp(4.8, 8.8, random()),
      worldHeightToGridRows(lerp(0.8, 2.4, random())),
      minRows,
      seed ^ Math.floor(random() * 0xffffffff)
    );
  }
}

function smoothHeightMap(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  minRows: number,
  maxRows: number,
  passes: number
): void {
  const scratch = new Uint8Array(heightMap.length);

  for (let pass = 0; pass < passes; pass++) {
    scratch.set(heightMap);

    for (let x = 1; x < size.x - 1; x++) {
      for (let z = 1; z < size.z - 1; z++) {
        const worldX = gridToWorldCenter(x, origin.x);
        const worldZ = gridToWorldCenter(z, origin.z);
        if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) continue;
        if (distanceToBoundary(worldX, worldZ, layout.boundary) < 3) continue;

        const index = x + z * size.x;
        let total = heightMap[index] * 4;
        let weight = 4;

        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue;
            const neighborX = x + dx;
            const neighborZ = z + dz;
            const neighborWorldX = gridToWorldCenter(neighborX, origin.x);
            const neighborWorldZ = gridToWorldCenter(neighborZ, origin.z);
            if (!isInsideBoundaryPolygon(neighborWorldX, neighborWorldZ, layout.boundary)) continue;

            const neighborWeight = Math.abs(dx) + Math.abs(dz) === 1 ? 2 : 1;
            total += heightMap[neighborX + neighborZ * size.x] * neighborWeight;
            weight += neighborWeight;
          }
        }

        scratch[index] = clamp(Math.round(total / weight), minRows, maxRows);
      }
    }

    heightMap.set(scratch);
  }
}

function limitHeightDeltas(heightMap: Uint8Array, size: VoxelSize, maxStepRows: number, passes: number): void {
  for (let pass = 0; pass < passes; pass++) {
    for (let x = 1; x < size.x - 1; x++) {
      for (let z = 1; z < size.z - 1; z++) {
        const index = x + z * size.x;
        const neighbors = [
          heightMap[index - 1],
          heightMap[index + 1],
          heightMap[index - size.x],
          heightMap[index + size.x],
        ];
        const minNeighbor = Math.min(...neighbors);
        const maxNeighbor = Math.max(...neighbors);

        heightMap[index] = clamp(heightMap[index], minNeighbor - maxStepRows, maxNeighbor + maxStepRows);
      }
    }

    for (let x = size.x - 2; x >= 1; x--) {
      for (let z = size.z - 2; z >= 1; z--) {
        const index = x + z * size.x;
        const neighbors = [
          heightMap[index - 1],
          heightMap[index + 1],
          heightMap[index - size.x],
          heightMap[index + size.x],
        ];
        const minNeighbor = Math.min(...neighbors);
        const maxNeighbor = Math.max(...neighbors);

        heightMap[index] = clamp(heightMap[index], minNeighbor - maxStepRows, maxNeighbor + maxStepRows);
      }
    }
  }
}

function getAveragePoint(points: { x: number; z: number }[]): { x: number; z: number } {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function distanceToSegment(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number
): { distance: number; t: number } {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq <= 0.0001) {
    return {
      distance: Math.sqrt(distanceSq(pointX, pointZ, startX, startZ)),
      t: 0,
    };
  }

  const t = clamp(((pointX - startX) * dx + (pointZ - startZ) * dz) / lengthSq, 0, 1);
  const closestX = startX + dx * t;
  const closestZ = startZ + dz * t;

  return {
    distance: Math.sqrt(distanceSq(pointX, pointZ, closestX, closestZ)),
    t,
  };
}

function blendHeightCorridor(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  start: { x: number; z: number },
  end: { x: number; z: number },
  width: number,
  strength: number
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    Math.min(start.x, end.x) - width,
    Math.max(start.x, end.x) + width,
    Math.min(start.z, end.z) - width,
    Math.max(start.z, end.z) + width
  );
  const startHeight = getHeightAt(heightMap, origin, size, start.x, start.z);
  const endHeight = getHeightAt(heightMap, origin, size, end.x, end.z);
  const centerWidth = width * 0.42;
  const falloffWidth = Math.max(PROCEDURAL_VOXEL_SIZE.x, width - centerWidth);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const { distance, t } = distanceToSegment(worldX, worldZ, start.x, start.z, end.x, end.z);
      if (distance > width) continue;

      const index = x + z * size.x;
      const centerBlend = distance <= centerWidth ? 1 : 1 - (distance - centerWidth) / falloffWidth;
      const targetHeight = lerp(startHeight, endHeight, t);
      heightMap[index] = clamp(
        Math.round(lerp(heightMap[index], targetHeight, clamp(centerBlend * strength, 0, 1))),
        1,
        size.y - 1
      );
    }
  }
}

function shapeGameplayRouteTerrain(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>
): void {
  const redSpawnCenter = getAveragePoint(layout.spawnPoints.red);
  const blueSpawnCenter = getAveragePoint(layout.spawnPoints.blue);
  const midfield = { x: 0, z: 0 };

  blendHeightCorridor(heightMap, origin, size, redSpawnCenter, layout.flagZones.red, 4.5, 0.9);
  blendHeightCorridor(heightMap, origin, size, blueSpawnCenter, layout.flagZones.blue, 4.5, 0.9);
  blendHeightCorridor(heightMap, origin, size, layout.flagZones.red, midfield, 5.6, 0.82);
  blendHeightCorridor(heightMap, origin, size, layout.flagZones.blue, midfield, 5.6, 0.82);

  for (const laneX of [-18, 18]) {
    blendHeightCorridor(
      heightMap,
      origin,
      size,
      { x: laneX, z: redSpawnCenter.z },
      { x: laneX, z: blueSpawnCenter.z },
      4.2,
      0.68
    );
  }
}

function fillColumnToHeight(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  x: number,
  z: number,
  topY: number,
  blockId: VoxelBlockId
): void {
  const currentHeight = heightMap[x + z * size.x];

  for (let y = currentHeight; y <= topY; y++) {
    setBlock(x, y, z, blockId);
  }
}

function stampWalkableColumn(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  size: VoxelSize,
  x: number,
  z: number,
  topY: number,
  floorBlock: VoxelBlockId,
  clearanceRows = FEATURE_ENTRANCE_CLEARANCE_ROWS
): void {
  if (x < 1 || x >= size.x - 1 || z < 1 || z >= size.z - 1) return;

  const safeTopY = clamp(topY, 1, size.y - clearanceRows - 2);
  const terrainHeight = heightMap[x + z * size.x];
  const fillStart = Math.min(terrainHeight, safeTopY);

  for (let y = fillStart; y <= safeTopY; y++) {
    setBlock(x, y, z, y === safeTopY ? floorBlock : 'stone');
  }

  for (let y = safeTopY + 1; y <= safeTopY + clearanceRows; y++) {
    setBlock(x, y, z, 'air');
  }
}

function stampWalkableEntrancePath(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  direction: GridDirection,
  insideDistance: number,
  approachDistance: number,
  halfWidthCells: number,
  floorY: number,
  floorBlock: VoxelBlockId,
  clearanceRows = FEATURE_ENTRANCE_CLEARANCE_ROWS
): void {
  const sideX = -direction.dz;
  const sideZ = direction.dx;
  const totalDistance = insideDistance + approachDistance;
  const steps = Math.max(1, Math.ceil(totalDistance / PROCEDURAL_VOXEL_SIZE.x));

  for (let step = 0; step <= steps; step++) {
    const distance = step * PROCEDURAL_VOXEL_SIZE.x;
    const outsideT = clamp((distance - insideDistance) / Math.max(PROCEDURAL_VOXEL_SIZE.x, approachDistance), 0, 1);

    for (let side = -halfWidthCells; side <= halfWidthCells; side++) {
      const worldX =
        centerX +
        direction.dx * distance +
        sideX * side * PROCEDURAL_VOXEL_SIZE.x;
      const worldZ =
        centerZ +
        direction.dz * distance +
        sideZ * side * PROCEDURAL_VOXEL_SIZE.z;
      const x = clamp(worldToGrid(worldX, origin.x), 1, size.x - 2);
      const z = clamp(worldToGrid(worldZ, origin.z), 1, size.z - 2);
      const baseTopY = Math.max(1, heightMap[x + z * size.x] - 1);
      const topY = Math.round(lerp(floorY, baseTopY, outsideT));

      stampWalkableColumn(setBlock, heightMap, size, x, z, topY, floorBlock, clearanceRows);
    }
  }
}

function getFeatureEntranceDirections(radiusX: number, radiusZ: number, featureSeed: number): GridDirection[] {
  const primary: GridDirection[] =
    radiusX >= radiusZ
      ? [{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }]
      : [{ dx: 0, dz: 1 }, { dx: 0, dz: -1 }];
  const secondary: GridDirection[] =
    radiusX >= radiusZ
      ? [{ dx: 0, dz: featureSeed % 2 === 0 ? 1 : -1 }]
      : [{ dx: featureSeed % 2 === 0 ? 1 : -1, dz: 0 }];

  return [...primary, ...secondary];
}

function stampStructureEntrances(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  floorY: number,
  featureSeed: number
): void {
  for (const direction of getFeatureEntranceDirections(radiusX, radiusZ, featureSeed)) {
    const insideDistance =
      Math.abs(direction.dx) * radiusX +
      Math.abs(direction.dz) * radiusZ +
      PROCEDURAL_VOXEL_SIZE.x * 1.5;

    stampWalkableEntrancePath(
      setBlock,
      heightMap,
      origin,
      size,
      centerX,
      centerZ,
      direction,
      insideDistance,
      FEATURE_APPROACH_WORLD_LENGTH,
      STRUCTURE_ENTRANCE_HALF_WIDTH_CELLS,
      floorY,
      'metal'
    );
  }
}

function stampCaveEntrances(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  floorY: number,
  featureSeed: number
): void {
  const radiusX = width / 2;
  const radiusZ = depth / 2;

  for (const direction of getFeatureEntranceDirections(radiusX, radiusZ, featureSeed)) {
    const insideDistance =
      Math.abs(direction.dx) * radiusX +
      Math.abs(direction.dz) * radiusZ +
      PROCEDURAL_VOXEL_SIZE.x * 2;

    stampWalkableEntrancePath(
      setBlock,
      heightMap,
      origin,
      size,
      centerX,
      centerZ,
      direction,
      insideDistance,
      FEATURE_APPROACH_WORLD_LENGTH,
      CAVE_ENTRANCE_HALF_WIDTH_CELLS,
      floorY,
      'stone',
      FEATURE_ENTRANCE_CLEARANCE_ROWS + 1
    );
  }
}

function stampBoulder(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  height: number
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    centerX - radiusX,
    centerX + radiusX,
    centerZ - radiusZ,
    centerZ + radiusZ
  );

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const nx = (worldX - centerX) / radiusX;
      const nz = (worldZ - centerZ) / radiusZ;
      const distance = nx * nx + nz * nz;
      if (distance > 1) continue;

      const localHeight = Math.max(1, Math.ceil(height * (1 - distance * 0.65)));
      const surfaceY = heightMap[x + z * size.x];
      for (let y = surfaceY; y < surfaceY + localHeight; y++) {
        setBlock(x, y, z, 'stone');
      }
    }
  }
}

function stampTree(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldZ: number,
  trunkHeight: number,
  featureSeed: number
): void {
  const x = clamp(worldToGrid(worldX, origin.x), 1, size.x - 2);
  const z = clamp(worldToGrid(worldZ, origin.z), 1, size.z - 2);
  const baseY = heightMap[x + z * size.x];
  const style = featureSeed % 4;
  const crownRadiusX = worldDistanceToGridCells(style === 1 ? 3 : style === 2 ? 1 : 2);
  const crownRadiusZ = worldDistanceToGridCells(style === 2 ? 3 : style === 1 ? 1 : 2);
  const crownHeight = worldHeightToGridRows(style === 3 ? 3 : 2);
  const crownDroop = worldHeightToGridRows(2);

  for (let y = baseY; y < baseY + trunkHeight; y++) {
    setBlock(x, y, z, 'wood');
  }

  const crownY = baseY + trunkHeight;
  for (let dy = -crownDroop; dy <= crownHeight; dy++) {
    for (let dx = -crownRadiusX; dx <= crownRadiusX; dx++) {
      for (let dz = -crownRadiusZ; dz <= crownRadiusZ; dz++) {
        const leafNoise = fractalNoise2(featureSeed, (x + dx) * 0.9, (z + dz + dy * 3) * 0.9, 2);
        const nx = dx / Math.max(1, crownRadiusX);
        const nz = dz / Math.max(1, crownRadiusZ);
        const ny = dy / Math.max(1, crownHeight);
        const blob = nx * nx + nz * nz + ny * ny * 0.55;
        const keep = style === 3 ? blob < 1.2 + leafNoise * 0.35 : blob < 1.05 + leafNoise * 0.28;
        if (!keep) continue;

        const leafY = crownY + dy;
        if (leafY <= baseY + 1) continue;
        setBlock(x + dx, leafY, z + dz, 'leaves');
      }
    }
  }
}

function stampCactus(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldZ: number,
  height: number,
  featureSeed: number
): void {
  const x = clamp(worldToGrid(worldX, origin.x), 2, size.x - 3);
  const z = clamp(worldToGrid(worldZ, origin.z), 2, size.z - 3);
  const baseY = heightMap[x + z * size.x];

  for (let y = baseY; y < baseY + height; y++) {
    setBlock(x, y, z, 'cactus');
  }

  const armY = baseY + Math.max(2, Math.floor(height * 0.55));
  const armDir = featureSeed % 2 === 0 ? 1 : -1;
  const secondArmDir = featureSeed % 3 === 0 ? -armDir : 0;

  for (const dir of [armDir, secondArmDir]) {
    if (dir === 0) continue;
    setBlock(x + dir, armY, z, 'cactus');
    setBlock(x + dir, armY + 1, z, 'cactus');
    if (height > 4) setBlock(x + dir * 2, armY + 1, z, 'cactus');
  }
}

function stampCrystalCluster(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldZ: number,
  height: number,
  featureSeed: number
): void {
  const x = clamp(worldToGrid(worldX, origin.x), 2, size.x - 3);
  const z = clamp(worldToGrid(worldZ, origin.z), 2, size.z - 3);
  const offsets = [
    { x: 0, z: 0, h: height },
    { x: 1, z: 0, h: Math.max(2, height - 1) },
    { x: -1, z: featureSeed % 2, h: Math.max(1, height - 2) },
  ];

  for (const offset of offsets) {
    const px = x + offset.x;
    const pz = z + offset.z;
    const baseY = heightMap[px + pz * size.x];
    for (let y = baseY; y < baseY + offset.h; y++) {
      setBlock(px, y, pz, y === baseY ? 'stone' : 'glass');
    }
  }
}

function stampBasaltSpire(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldZ: number,
  height: number
): void {
  const x = clamp(worldToGrid(worldX, origin.x), 2, size.x - 3);
  const z = clamp(worldToGrid(worldZ, origin.z), 2, size.z - 3);
  const baseY = heightMap[x + z * size.x];

  for (let y = baseY; y < baseY + height; y++) {
    setBlock(x, y, z, y % 3 === 0 ? 'metal' : 'stone');
    if (y < baseY + height - 1 && y % 2 === 0) {
      setBlock(x + 1, y, z, 'stone');
    }
  }
}

function stampThemedNaturalFeature(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  theme: VoxelMapTheme,
  worldX: number,
  worldZ: number,
  height: number,
  featureSeed: number
): void {
  if (theme.id === 'desert') {
    stampCactus(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(3), height + worldHeightToGridRows(1)), featureSeed);
  } else if (theme.id === 'frost' || theme.id === 'crystal') {
    stampCrystalCluster(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(2), height), featureSeed);
  } else if (theme.id === 'basalt') {
    stampBasaltSpire(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(2), height));
  } else {
    stampTree(setBlock, heightMap, origin, size, worldX, worldZ, height, featureSeed);
  }
}

function stampProceduralStructure(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  maxHeight: number,
  accentBlock: VoxelBlockId,
  featureSeed: number
): void {
  const minX = centerX - radiusX;
  const maxX = centerX + radiusX;
  const minZ = centerZ - radiusZ;
  const maxZ = centerZ + radiusZ;
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(origin, size, minX, maxX, minZ, maxZ);
  const floorY = getMaxHeightInRect(heightMap, origin, size, minX, maxX, minZ, maxZ);
  const footprintWidth = gx1 - gx0 + 1;
  const footprintDepth = gz1 - gz0 + 1;
  const mask = new Uint8Array(footprintWidth * footprintDepth);
  const heights = new Uint8Array(footprintWidth * footprintDepth);
  const minCellHeight = Math.min(maxHeight, worldHeightToGridRows(3));
  const windowHeight = worldHeightToGridRows(3);

  const localIndex = (x: number, z: number): number => x + z * footprintWidth;

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const lx = x - gx0;
      const lz = z - gz0;
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const nx = (worldX - centerX) / radiusX;
      const nz = (worldZ - centerZ) / radiusZ;
      const radial = nx * nx + nz * nz;
      const edgeNoise = fractalNoise2(featureSeed, worldX * 0.22, worldZ * 0.22, 3);
      const annexNoise = fractalNoise2(featureSeed ^ 0x71a7c15, worldX * 0.37, worldZ * 0.37, 2);
      const threshold = 0.82 + (edgeNoise - 0.5) * 0.55;
      const annex = Math.abs(nx) < 0.34 + annexNoise * 0.24 || Math.abs(nz) < 0.28 + edgeNoise * 0.2;

      if (radial < threshold || (annex && radial < 1.18)) {
        const heightNoise = fractalNoise2(featureSeed ^ 0x3c6ef35f, worldX * 0.31, worldZ * 0.31, 3);
        mask[localIndex(lx, lz)] = 1;
        heights[localIndex(lx, lz)] = clamp(
          minCellHeight + Math.floor(heightNoise * Math.max(1, maxHeight - minCellHeight + 1)),
          minCellHeight,
          maxHeight
        );
      }
    }
  }

  if (!mask.some(Boolean)) {
    const centerLocalX = clamp(Math.floor(footprintWidth / 2), 0, footprintWidth - 1);
    const centerLocalZ = clamp(Math.floor(footprintDepth / 2), 0, footprintDepth - 1);
    mask[localIndex(centerLocalX, centerLocalZ)] = 1;
    heights[localIndex(centerLocalX, centerLocalZ)] = maxHeight;
  }

  const hasFootprint = (x: number, z: number): boolean => {
    if (x < 0 || x >= footprintWidth || z < 0 || z >= footprintDepth) return false;
    return mask[localIndex(x, z)] === 1;
  };

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const lx = x - gx0;
      const lz = z - gz0;
      if (!hasFootprint(lx, lz)) continue;

      fillColumnToHeight(setBlock, heightMap, origin, size, x, z, floorY, 'stone');
      setBlock(x, floorY, z, 'metal');

      const cellHeight = heights[localIndex(lx, lz)];
      const isWall =
        !hasFootprint(lx + 1, lz) ||
        !hasFootprint(lx - 1, lz) ||
        !hasFootprint(lx, lz + 1) ||
        !hasFootprint(lx, lz - 1);
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const trimNoise = fractalNoise2(featureSeed ^ 0x9e3779b9, worldX * 0.68, worldZ * 0.68, 2);
      const openingNoise = fractalNoise2(featureSeed ^ 0x85ebca6b, worldX * 1.13, worldZ * 1.13, 2);

      for (let y = floorY + 1; y <= floorY + cellHeight; y++) {
        const isRoof = y === floorY + cellHeight;
        const hasWindow = isWall && openingNoise > 0.64 && y === floorY + windowHeight;
        const wallBlock =
          trimNoise > 0.74 && y > floorY + 1 ? accentBlock : trimNoise > 0.42 ? 'metal' : 'stone';

        if (isRoof) {
          const roofNoise = fractalNoise2(featureSeed ^ 0xc2b2ae35, worldX * 0.53, worldZ * 0.53, 2);
          setBlock(x, y, z, roofNoise > 0.72 ? 'glass' : 'metal');
        } else if (isWall) {
          setBlock(x, y, z, hasWindow ? 'glass' : wallBlock);
        } else {
          setBlock(x, y, z, 'air');
        }
      }
    }
  }

  stampStructureEntrances(setBlock, heightMap, origin, size, centerX, centerZ, radiusX, radiusZ, floorY, featureSeed);
}

function stampTerracedPlatform(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  maxHeight: number,
  accentBlock: VoxelBlockId,
  featureSeed: number
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    centerX - radiusX,
    centerX + radiusX,
    centerZ - radiusZ,
    centerZ + radiusZ
  );
  const floorY = getMaxHeightInRect(heightMap, origin, size, centerX - radiusX, centerX + radiusX, centerZ - radiusZ, centerZ + radiusZ);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const nx = (worldX - centerX) / radiusX;
      const nz = (worldZ - centerZ) / radiusZ;
      const radial = nx * nx + nz * nz;
      const chipNoise = fractalNoise2(featureSeed ^ 0x632be59b, worldX * 0.42, worldZ * 0.42, 2);
      if (radial > 1.08 + (chipNoise - 0.5) * 0.22) continue;

      const terrace =
        radial < 0.18 ? maxHeight :
        radial < 0.42 ? Math.max(worldHeightToGridRows(3), Math.floor(maxHeight * 0.7)) :
        radial < 0.72 ? worldHeightToGridRows(3) :
        worldHeightToGridRows(2);
      fillColumnToHeight(setBlock, heightMap, origin, size, x, z, floorY + terrace, radial < 0.72 ? 'metal' : 'stone');

      const topY = floorY + terrace;
      const trim = chipNoise > 0.72 ? accentBlock : radial < 0.24 ? 'glass' : 'metal';
      setBlock(x, topY, z, trim);

      const rim = radial > 0.78 && radial < 0.98;
      const gap = fractalNoise2(featureSeed ^ 0x9f1d36f, worldX * 0.9, worldZ * 0.9, 2) > 0.72;
      if (rim && !gap) {
        setBlock(x, topY + 1, z, chipNoise > 0.62 ? accentBlock : 'stone');
      }
    }
  }
}

function stampPylonCluster(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  maxHeight: number,
  accentBlock: VoxelBlockId,
  featureSeed: number
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    centerX - radiusX,
    centerX + radiusX,
    centerZ - radiusZ,
    centerZ + radiusZ
  );
  const floorY = getMaxHeightInRect(heightMap, origin, size, centerX - radiusX, centerX + radiusX, centerZ - radiusZ, centerZ + radiusZ);
  const pylonCount = 3 + (featureSeed % 3);
  const angleOffset = fractalNoise2(featureSeed ^ 0x51ed270b, centerX * 0.15, centerZ * 0.15, 2) * Math.PI * 2;

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const nx = (worldX - centerX) / radiusX;
      const nz = (worldZ - centerZ) / radiusZ;
      const radial = nx * nx + nz * nz;
      if (radial > 0.52) continue;

      fillColumnToHeight(setBlock, heightMap, origin, size, x, z, floorY, 'stone');
      setBlock(x, floorY, z, radial < 0.18 ? 'glass' : 'metal');
    }
  }

  for (let i = 0; i < pylonCount; i++) {
    const angle = angleOffset + (i / pylonCount) * Math.PI * 2;
    const pylonX = centerX + Math.cos(angle) * radiusX * 0.58;
    const pylonZ = centerZ + Math.sin(angle) * radiusZ * 0.58;
    const gx = clamp(worldToGrid(pylonX, origin.x), 2, size.x - 3);
    const gz = clamp(worldToGrid(pylonZ, origin.z), 2, size.z - 3);
    const columnHeight = Math.max(worldHeightToGridRows(4), maxHeight + (i % 2 === 0 ? worldHeightToGridRows(1) : 0));

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx * dx + dz * dz > 2) continue;
        fillColumnToHeight(setBlock, heightMap, origin, size, gx + dx, gz + dz, floorY, 'stone');

        for (let y = floorY + 1; y <= floorY + columnHeight; y++) {
          const band = y % worldHeightToGridRows(2) === 0;
          setBlock(gx + dx, y, gz + dz, band ? accentBlock : 'metal');
        }
      }
    }

    const capY = floorY + columnHeight + 1;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        setBlock(gx + dx, capY, gz + dz, i % 2 === 0 ? 'glass' : accentBlock);
      }
    }
  }
}

function stampBrokenWall(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  maxHeight: number,
  accentBlock: VoxelBlockId,
  featureSeed: number
): void {
  const length = Math.max(radiusX, radiusZ) * 2.25;
  const angle = (featureSeed % 4) * (Math.PI / 4) + fractalNoise2(featureSeed, centerX * 0.1, centerZ * 0.1, 2) * 0.45;
  const dirX = Math.cos(angle);
  const dirZ = Math.sin(angle);
  const sideX = -dirZ;
  const sideZ = dirX;
  const floorY = getMaxHeightInRect(heightMap, origin, size, centerX - radiusX, centerX + radiusX, centerZ - radiusZ, centerZ + radiusZ);
  const steps = Math.max(6, Math.round(length / PROCEDURAL_VOXEL_SIZE.x));

  for (let step = -steps; step <= steps; step++) {
    const t = (step / steps) * length * 0.5;
    const gapNoise = fractalNoise2(featureSeed ^ 0x68bc21eb, step * 0.11, centerZ * 0.11, 2);
    if (gapNoise > 0.78) continue;

    const wallHeight = Math.max(
      worldHeightToGridRows(2),
      Math.floor(maxHeight * (0.45 + fractalNoise2(featureSeed ^ 0x1b873593, step * 0.2, centerX * 0.13, 2) * 0.75))
    );

    for (let width = -1; width <= 1; width++) {
      const worldX = centerX + dirX * t + sideX * width * PROCEDURAL_VOXEL_SIZE.x;
      const worldZ = centerZ + dirZ * t + sideZ * width * PROCEDURAL_VOXEL_SIZE.z;
      const gx = clamp(worldToGrid(worldX, origin.x), 1, size.x - 2);
      const gz = clamp(worldToGrid(worldZ, origin.z), 1, size.z - 2);
      fillColumnToHeight(setBlock, heightMap, origin, size, gx, gz, floorY, 'stone');

      for (let y = floorY + 1; y <= floorY + wallHeight; y++) {
        const chippedTop = y === floorY + wallHeight && gapNoise > 0.58;
        setBlock(gx, y, gz, chippedTop ? accentBlock : y % 3 === 0 ? 'metal' : 'stone');
      }
    }
  }

  const markerX = clamp(worldToGrid(centerX, origin.x), 2, size.x - 3);
  const markerZ = clamp(worldToGrid(centerZ, origin.z), 2, size.z - 3);
  for (let y = floorY + 1; y <= floorY + maxHeight + worldHeightToGridRows(1); y++) {
    setBlock(markerX, y, markerZ, y % 2 === 0 ? accentBlock : 'glass');
  }
}

function stampProceduralCave(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  width: number,
  depth: number,
  height: number,
  featureSeed: number
): void {
  const minX = centerX - width / 2;
  const maxX = centerX + width / 2;
  const minZ = centerZ - depth / 2;
  const maxZ = centerZ + depth / 2;
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(origin, size, minX, maxX, minZ, maxZ);
  const floorY = getMaxHeightInRect(heightMap, origin, size, minX, maxX, minZ, maxZ);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const nx = (worldX - centerX) / (width / 2);
      const nz = (worldZ - centerZ) / (depth / 2);
      const edgeNoise = fractalNoise2(featureSeed, worldX * 0.25, worldZ * 0.25, 3);
      const shell = nx * nx + nz * nz < 1.08 + (edgeNoise - 0.5) * 0.42;
      if (!shell) continue;

      fillColumnToHeight(setBlock, heightMap, origin, size, x, z, floorY, 'stone');

      for (let y = floorY + 1; y <= floorY + height; y++) {
        const vertical = (y - floorY) / height;
        const tunnelNoise = fractalNoise2(featureSeed ^ 0x27d4eb2d, worldX * 0.36, worldZ * 0.36, 3);
        const hollow =
          nx * nx * 1.15 + nz * nz * 0.85 + (vertical - 0.42) * (vertical - 0.42) * 1.9 <
          0.46 + tunnelNoise * 0.18;
        const chipped = edgeNoise > 0.78 && y < floorY + height - 1;

        if (hollow || chipped) {
          setBlock(x, y, z, 'air');
        } else {
          const veinNoise = fractalNoise2(featureSeed ^ 0x165667b1, worldX * 0.88, (worldZ + y) * 0.88, 2);
          setBlock(x, y, z, veinNoise > 0.83 ? 'metal' : 'stone');
        }
      }
    }
  }

  stampCaveEntrances(setBlock, heightMap, origin, size, centerX, centerZ, width, depth, floorY, featureSeed);
}

function stampTunnelPassage(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  length: number,
  width: number,
  tunnelHeight: number,
  direction: 'x' | 'z',
  featureSeed: number
): void {
  const halfLength = length / 2;
  const halfWidth = width / 2;
  const minX = direction === 'x' ? centerX - halfLength : centerX - halfWidth * 1.4;
  const maxX = direction === 'x' ? centerX + halfLength : centerX + halfWidth * 1.4;
  const minZ = direction === 'z' ? centerZ - halfLength : centerZ - halfWidth * 1.4;
  const maxZ = direction === 'z' ? centerZ + halfLength : centerZ + halfWidth * 1.4;
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(origin, size, minX, maxX, minZ, maxZ);
  const floorY = getMaxHeightInRect(heightMap, origin, size, minX, maxX, minZ, maxZ);
  const roofRows = tunnelHeight + worldHeightToGridRows(2.4);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const along = direction === 'x' ? worldX - centerX : worldZ - centerZ;
      const across = direction === 'x' ? worldZ - centerZ : worldX - centerX;
      const alongNorm = Math.abs(along) / halfLength;
      const acrossNorm = Math.abs(across) / (halfWidth * 1.4);
      if (alongNorm > 1 || acrossNorm > 1) continue;

      const edgeNoise = fractalNoise2(featureSeed, worldX * 0.34, worldZ * 0.34, 2);
      const moundFalloff = Math.max(0, 1 - acrossNorm * acrossNorm * 0.72) * Math.max(0.35, 1 - alongNorm * 0.18);
      const topY = clamp(floorY + Math.round(roofRows * moundFalloff * lerp(0.82, 1.18, edgeNoise)), floorY + tunnelHeight + 1, size.y - 2);

      fillColumnToHeight(setBlock, heightMap, origin, size, x, z, topY, 'stone');

      const tunnelCurve =
        Math.sin((along + featureSeed * 0.0003) * 0.28) * PROCEDURAL_VOXEL_SIZE.x * 2 +
        (fractalNoise2(featureSeed ^ 0x165667b1, along * 0.08, centerZ * 0.08, 2) - 0.5) * PROCEDURAL_VOXEL_SIZE.x * 3;
      const tunnelAcross = across - tunnelCurve;
      const tunnelAcrossNorm = tunnelAcross / Math.max(PROCEDURAL_VOXEL_SIZE.x, halfWidth * 0.58);

      for (let y = floorY + 1; y <= floorY + tunnelHeight; y++) {
        const vertical = (y - (floorY + tunnelHeight * 0.45)) / Math.max(1, tunnelHeight * 0.56);
        const hollow = tunnelAcrossNorm * tunnelAcrossNorm + vertical * vertical < 1;
        if (hollow) {
          setBlock(x, y, z, 'air');
        }
      }

      const floorBand = Math.abs(tunnelAcross) < halfWidth * 0.42 && alongNorm < 0.94;
      if (floorBand) {
        setBlock(x, floorY, z, edgeNoise > 0.72 ? 'metal' : 'stone');
      }
    }
  }
}

function stampMidfieldSightlineBreaker(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  featureSeed: number,
  heightBoostRows = 0
): void {
  const averageSpawn = (spawns: { x: number; z: number }[]) => ({
    x: spawns.reduce((sum, spawn) => sum + spawn.x, 0) / spawns.length,
    z: spawns.reduce((sum, spawn) => sum + spawn.z, 0) / spawns.length,
  });
  const redCenter = averageSpawn(layout.spawnPoints.red);
  const blueCenter = averageSpawn(layout.spawnPoints.blue);
  const random = mulberry32(featureSeed);
  const connectionX = redCenter.x - blueCenter.x;
  const connectionZ = redCenter.z - blueCenter.z;
  const connectionLength = Math.hypot(connectionX, connectionZ) || 1;
  const dirX = connectionX / connectionLength;
  const dirZ = connectionZ / connectionLength;
  const normalX = -dirZ;
  const normalZ = dirX;
  const t = lerp(0.38, 0.62, random());
  const normalOffset = lerp(-5.5, 5.5, random());
  const centerX = lerp(blueCenter.x, redCenter.x, t) + normalX * normalOffset;
  const centerZ = lerp(blueCenter.z, redCenter.z, t) + normalZ * normalOffset;
  const halfLength = lerp(9, 18, random());
  const halfThickness = lerp(1.8, 4.2, random());
  const boundsX = Math.abs(normalX) * halfLength + Math.abs(dirX) * halfThickness + 3;
  const boundsZ = Math.abs(normalZ) * halfLength + Math.abs(dirZ) * halfThickness + 3;
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(origin, size, centerX - boundsX, centerX + boundsX, centerZ - boundsZ, centerZ + boundsZ);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const localX = (worldX - centerX) * normalX + (worldZ - centerZ) * normalZ;
      const localZ = (worldX - centerX) * dirX + (worldZ - centerZ) * dirZ;
      const bend =
        Math.sin((localX + featureSeed * 0.0009) * 0.22) * 1.35 +
        (fractalNoise2(featureSeed ^ 0x41c64e6d, localX * 0.08, localZ * 0.08, 3) - 0.5) * 2.4;
      const across = Math.abs(localX) / halfLength;
      const through = Math.abs(localZ - bend) / halfThickness;
      const ridgeNoise = fractalNoise2(featureSeed, worldX * 0.16, worldZ * 0.16, 3);
      if (across > 1 || through > 1 + ridgeNoise * 0.22) continue;

      const footprint = across * across * 0.42 + through * through;
      if (footprint > 1.08 + ridgeNoise * 0.18) continue;

      const falloff = Math.pow(1 - clamp(footprint, 0, 1), 0.55);
      const spike = Math.max(0, 1 - Math.abs(Math.round((localX + random() * 4) / 7) * 7 - localX) / 1.8);
      const heightRows =
        worldHeightToGridRows(3.5) +
        heightBoostRows +
        Math.floor((SIGHTLINE_BARRIER_BASE_HEIGHT + ridgeNoise * SIGHTLINE_BARRIER_EXTRA_HEIGHT) * falloff) +
        Math.floor(spike * worldHeightToGridRows(2.2));
      const floorY = heightMap[x + z * size.x];
      const topY = clamp(floorY + heightRows, floorY + worldHeightToGridRows(4), size.y - 2);

      for (let y = floorY; y <= topY; y++) {
        const nearTop = y >= topY - 1;
        const oreVein = ridgeNoise > 0.76 && (y + x + z) % worldHeightToGridRows(4) === 0;
        setBlock(x, y, z, nearTop ? (topY > worldHeightToGridRows(11) ? 'stone' : 'grass') : oreVein ? 'metal' : 'stone');
      }
    }
  }
}

interface VoxelRayPoint {
  x: number;
  y: number;
  z: number;
}

function getSpawnSightlinePoint(
  spawn: { x: number; z: number },
  heightMap: Uint8Array,
  origin: { x: number; y: number; z: number },
  size: VoxelSize
): VoxelRayPoint {
  const surfaceRows = heightMap[gridIndexFromWorld(spawn.x, spawn.z, origin, size)];
  return {
    x: spawn.x,
    y: gridRowsToWorldY(surfaceRows, origin.y) + SPAWN_SIGHTLINE_EYE_OFFSET,
    z: spawn.z,
  };
}

function isWorldPointSolid(
  blocks: Uint8Array,
  origin: { x: number; y: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldY: number,
  worldZ: number
): boolean {
  const x = worldToGrid(worldX, origin.x);
  const y = worldYToGridRow(worldY, origin.y);
  const z = worldToGrid(worldZ, origin.z);

  if (x < 0 || x >= size.x || y < 0 || y >= size.y || z < 0 || z >= size.z) {
    return false;
  }

  return isSolidBlock(blocks[chunkIndex(x, y, z, size)]);
}

function hasVoxelLineOfSight(
  blocks: Uint8Array,
  origin: { x: number; y: number; z: number },
  size: VoxelSize,
  start: VoxelRayPoint,
  end: VoxelRayPoint
): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const maxAxisDistance = Math.max(
    Math.abs(dx) / PROCEDURAL_VOXEL_SIZE.x,
    Math.abs(dy) / PROCEDURAL_VOXEL_SIZE.y,
    Math.abs(dz) / PROCEDURAL_VOXEL_SIZE.z
  );
  const steps = Math.max(1, Math.ceil(maxAxisDistance * 1.75));

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (t < 0.025 || t > 0.975) continue;

    if (
      isWorldPointSolid(
        blocks,
        origin,
        size,
        start.x + dx * t,
        start.y + dy * t,
        start.z + dz * t
      )
    ) {
      return false;
    }
  }

  return true;
}

function stampDirectSightlineBaffle(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; y: number; z: number },
  size: VoxelSize,
  start: VoxelRayPoint,
  end: VoxelRayPoint,
  featureSeed: number,
  pass: number
): void {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz) || 1;
  const dirX = dx / length;
  const dirZ = dz / length;
  const normalX = -dirZ;
  const normalZ = dirX;
  const t = clamp(0.5 + (fractalNoise2(featureSeed, start.x * 0.07, end.z * 0.07, 2) - 0.5) * 0.08, 0.42, 0.58);
  const center = {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t),
    z: lerp(start.z, end.z, t),
  };
  const widthCells = worldDistanceToGridCells(5 + pass * 1.5);
  const thicknessCells = worldDistanceToGridCells(2.2 + pass * 0.75);
  const centerEyeRow = clamp(worldYToGridRow(center.y, origin.y), 1, size.y - 2);

  for (let across = -widthCells; across <= widthCells; across++) {
    for (let thickness = -thicknessCells; thickness <= thicknessCells; thickness++) {
      const worldX = center.x + normalX * across * PROCEDURAL_VOXEL_SIZE.x + dirX * thickness * PROCEDURAL_VOXEL_SIZE.x;
      const worldZ = center.z + normalZ * across * PROCEDURAL_VOXEL_SIZE.z + dirZ * thickness * PROCEDURAL_VOXEL_SIZE.z;
      const x = clamp(worldToGrid(worldX, origin.x), 1, size.x - 2);
      const z = clamp(worldToGrid(worldZ, origin.z), 1, size.z - 2);
      const acrossNorm = across / Math.max(1, widthCells);
      const thicknessNorm = thickness / Math.max(1, thicknessCells);
      const footprint = acrossNorm * acrossNorm * 0.72 + thicknessNorm * thicknessNorm;
      const noise = fractalNoise2(featureSeed ^ 0x632be59b, worldX * 0.42, worldZ * 0.42, 2);
      if (footprint > 1.05 + noise * 0.24) continue;

      const surfaceY = heightMap[x + z * size.x];
      const falloff = Math.pow(1 - clamp(footprint, 0, 1), 0.42);
      const topY = clamp(
        Math.max(
          surfaceY + worldHeightToGridRows(3.5 + pass * 0.7 + falloff * 3.4 + noise * 1.6),
          centerEyeRow + worldHeightToGridRows(2.25)
        ),
        1,
        size.y - 2
      );
      const bottomY = clamp(Math.min(surfaceY, centerEyeRow - worldHeightToGridRows(2.6)), 1, topY);

      for (let y = bottomY; y <= topY; y++) {
        const cap = y >= topY - 1;
        const vein = noise > 0.8 && (x + y + z + pass) % worldHeightToGridRows(4) === 0;
        setBlock(x, y, z, cap ? (topY < worldHeightToGridRows(12) ? 'grass' : 'stone') : vein ? 'metal' : 'stone');
      }
    }
  }
}

function enforceSpawnSightlineOcclusion(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  heightMap: Uint8Array,
  origin: { x: number; y: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  seed: number
): void {
  const blockVisiblePairs = (pass: number): boolean => {
    let blockedAnyPair = false;

    for (const redSpawn of layout.spawnPoints.red) {
      const redEye = getSpawnSightlinePoint(redSpawn, heightMap, origin, size);

      for (const blueSpawn of layout.spawnPoints.blue) {
        const blueEye = getSpawnSightlinePoint(blueSpawn, heightMap, origin, size);
        if (!hasVoxelLineOfSight(blocks, origin, size, redEye, blueEye)) continue;

        stampDirectSightlineBaffle(
          setBlock,
          heightMap,
          origin,
          size,
          redEye,
          blueEye,
          seed ^ Math.floor((redSpawn.x + 32) * 97) ^ Math.floor((blueSpawn.x + 32) * 193) ^ pass,
          pass
        );
        blockedAnyPair = true;
      }
    }

    return blockedAnyPair;
  };

  for (let pass = 0; pass < 7; pass++) {
    const blockedAnyPair = blockVisiblePairs(pass);

    if (!blockedAnyPair) {
      return;
    }
  }

  stampMidfieldSightlineBreaker(
    setBlock,
    heightMap,
    origin,
    size,
    layout,
    seed ^ 0xa11ce5ee,
    worldHeightToGridRows(5)
  );

  for (let pass = 7; pass < 10; pass++) {
    if (!blockVisiblePairs(pass)) {
      return;
    }
  }
}

function carveProceduralCaves(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; y: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  seed: number
): void {
  const random = mulberry32(seed ^ 0x0ddc0ffe);
  const caveThreshold = 0.8 + random() * 0.05;

  for (let x = 1; x < size.x - 1; x++) {
    for (let z = 1; z < size.z - 1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) continue;
      if (isNearProtectedGameplayArea(layout, worldX, worldZ, 5.5)) continue;

      const surfaceY = heightMap[x + z * size.x] - 1;
      for (let y = 3; y < surfaceY - worldHeightToGridRows(4); y++) {
        const depthFromSurface = surfaceY - y;
        const broadCave = fractalNoise2(seed ^ 0xc0a57, worldX * 0.07 + y * 0.09, worldZ * 0.07 - y * 0.05, 4);
        const tubeNoise = fractalNoise2(seed ^ 0x57a1ac7, worldX * 0.16 - y * 0.04, worldZ * 0.16 + y * 0.08, 3);

        if (depthFromSurface > worldHeightToGridRows(5) && broadCave > caveThreshold && tubeNoise > 0.58) {
          setBlock(x, y, z, 'air');
          if (y > 3 && broadCave > 0.86) {
            setBlock(x, y - 1, z, tubeNoise > 0.76 ? 'metal' : 'stone');
          }
        }
      }
    }
  }

  const tunnelCount = 2 + Math.floor(random() * 4);
  for (let tunnel = 0; tunnel < tunnelCount; tunnel++) {
    let x = clamp(Math.floor(lerp(8, size.x - 8, random())), 2, size.x - 3);
    let z = clamp(Math.floor(lerp(8, size.z - 8, random())), 2, size.z - 3);
    let angle = random() * Math.PI * 2;
    const length = 20 + Math.floor(random() * 36);
    const radius = 1;
    let y = clamp(heightMap[x + z * size.x] - worldHeightToGridRows(5 + random() * 4), 4, size.y - 5);

    for (let step = 0; step < length; step++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary) || isNearProtectedGameplayArea(layout, worldX, worldZ, 5)) {
        angle += (random() - 0.5) * 1.2;
      } else {
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dz = -radius; dz <= radius; dz++) {
              const distance = dx * dx + dy * dy * 1.25 + dz * dz;
              if (distance > (radius + 0.45) ** 2) continue;
              setBlock(x + dx, y + dy, z + dz, 'air');
            }
          }
        }
      }

      angle += (random() - 0.5) * 0.48;
      x = clamp(x + Math.round(Math.cos(angle)), 2, size.x - 3);
      z = clamp(z + Math.round(Math.sin(angle)), 2, size.z - 3);
      y = clamp(y + Math.round((random() - 0.5) * 0.8), 4, Math.max(4, heightMap[x + z * size.x] - worldHeightToGridRows(4)));
    }
  }
}

function canPlaceFeature(
  layout: ReturnType<typeof createProceduralCTFLayout>,
  accepted: FeatureAnchor[],
  worldX: number,
  worldZ: number,
  radius: number
): boolean {
  const boundaryRange = getBoundaryRange(layout.boundary);
  if (
    worldX < boundaryRange.minX + 2 ||
    worldX > boundaryRange.maxX - 2 ||
    worldZ < boundaryRange.minZ + 2 ||
    worldZ > boundaryRange.maxZ - 2
  ) {
    return false;
  }
  if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) return false;
  if (distanceToBoundary(worldX, worldZ, layout.boundary) < radius + FEATURE_APPROACH_WORLD_LENGTH + 1.8) return false;
  if (isNearProtectedGameplayArea(layout, worldX, worldZ, radius)) return false;

  for (const feature of accepted) {
    if (distanceSq(worldX, worldZ, feature.x, feature.z) < (radius + feature.radius + 3) ** 2) {
      return false;
    }
  }

  return true;
}

function stampGuaranteedLandmarks(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  theme: VoxelMapTheme,
  seed: number,
  accepted: FeatureAnchor[]
): void {
  const random = mulberry32(seed ^ 0xdecafbad);
  const boundaryRange = getBoundaryRange(layout.boundary);
  const halfPlayableX = Math.min(30, Math.max(12, (boundaryRange.maxX - boundaryRange.minX) * 0.5 - 4));
  const halfPlayableZ = Math.min(25, Math.max(10, (boundaryRange.maxZ - boundaryRange.minZ) * 0.5 - 4));
  const targetLandmarks = 5 + Math.floor(random() * 6);
  let landmarksPlaced = 0;

  for (let attempts = 0; attempts < 180 && landmarksPlaced < targetLandmarks; attempts++) {
    const centerBias = random() < 0.38;
    const centerX = centerBias ? lerp(-12, 12, random()) : lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = lerp(3.8, 8.6, random());
    const radiusZ = lerp(3.6, 8.2, random());
    const radius = Math.max(radiusX, radiusZ) + 1.5;
    const featureSeed = seed ^ Math.floor(random() * 0xffffffff);
    const accentBlock: VoxelBlockId = random() > 0.5 ? 'neon_red' : 'neon_blue';

    if (!canPlaceFeature(layout, accepted, centerX, centerZ, radius)) continue;

    const styleRoll = random();
    if (styleRoll < 0.22) {
      stampProceduralStructure(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        radiusX,
        radiusZ,
        worldHeightToGridRows(lerp(4.2, 7.2, random())),
        accentBlock,
        featureSeed
      );
    } else if (styleRoll < 0.4) {
      stampTerracedPlatform(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        radiusX,
        radiusZ,
        worldHeightToGridRows(lerp(3.2, 5.8, random())),
        accentBlock,
        featureSeed
      );
    } else if (styleRoll < 0.55) {
      stampPylonCluster(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        radiusX,
        radiusZ,
        worldHeightToGridRows(lerp(3.6, 6.4, random())),
        accentBlock,
        featureSeed
      );
    } else if (styleRoll < 0.7) {
      stampBrokenWall(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        radiusX,
        radiusZ,
        worldHeightToGridRows(lerp(3.2, 6.2, random())),
        accentBlock,
        featureSeed
      );
    } else if (styleRoll < 0.86) {
      stampTunnelPassage(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        lerp(10, 22, random()),
        lerp(4.6, 7.4, random()),
        worldHeightToGridRows(lerp(2.8, 4.2, random())),
        random() > 0.5 ? 'x' : 'z',
        featureSeed
      );
    } else {
      stampProceduralCave(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        lerp(8, 15, random()),
        lerp(6, 13, random()),
        worldHeightToGridRows(lerp(3.2, 6, random())),
        featureSeed
      );
    }

    accepted.push({ x: centerX, z: centerZ, radius });
    landmarksPlaced++;
  }

  if (landmarksPlaced < 3) {
    stampMidfieldSightlineBreaker(setBlock, heightMap, origin, size, layout, seed ^ 0x91e10da5);
    accepted.push({ x: lerp(-8, 8, random()), z: lerp(-5, 5, random()), radius: 8 });
  }
}

function stampProceduralFeatures(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  random: () => number,
  theme: VoxelMapTheme,
  seed: number
): void {
  const accepted: FeatureAnchor[] = [];
  const boundaryRange = getBoundaryRange(layout.boundary);
  const halfPlayableX = Math.min(30, Math.max(12, (boundaryRange.maxX - boundaryRange.minX) * 0.5 - 4));
  const halfPlayableZ = Math.min(25, Math.max(10, (boundaryRange.maxZ - boundaryRange.minZ) * 0.5 - 4));
  stampGuaranteedLandmarks(setBlock, heightMap, origin, size, layout, theme, seed, accepted);

  const caveCount = 2 + Math.floor(random() * 3);

  for (let i = 0; i < caveCount; i++) {
    const centerX = lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const width = Math.floor(lerp(7, 14, random()));
    const depth = Math.floor(lerp(5, 11, random()));
    const height = worldHeightToGridRows(lerp(2.5, 5.8, random()));
    const radius = Math.max(width, depth) / 2;
    const featureSeed = Math.floor(random() * 0xffffffff);

    if (!canPlaceFeature(layout, accepted, centerX, centerZ, radius)) continue;

    stampProceduralCave(setBlock, heightMap, origin, size, centerX, centerZ, width, depth, height, featureSeed);
    accepted.push({ x: centerX, z: centerZ, radius });
  }

  const structureCount = 6 + Math.floor(random() * 4);
  let structuresPlaced = 0;

  for (let attempts = 0; attempts < 120 && structuresPlaced < structureCount; attempts++) {
    const nearCenter = random() < 0.24;
    const baseX = nearCenter ? lerp(-12, 12, random()) : (random() < 0.5 ? -1 : 1) * lerp(7, halfPlayableX, random());
    const baseZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = lerp(2.8, 6.8, random());
    const radiusZ = lerp(2.8, 6.8, random());
    const height = worldHeightToGridRows(3 + Math.floor(random() * 4));
    const radius = Math.max(radiusX, radiusZ);
    const featureSeed = Math.floor(random() * 0xffffffff);
    const accentBlock = random() > 0.5 ? 'neon_red' : 'neon_blue';
    const structureStyle = Math.floor(random() * 4);

    if (!canPlaceFeature(layout, accepted, baseX, baseZ, radius)) {
      continue;
    }

    if (structureStyle === 0) {
      stampProceduralStructure(
        setBlock,
        heightMap,
        origin,
        size,
        baseX,
        baseZ,
        radiusX,
        radiusZ,
        height,
        accentBlock,
        featureSeed
      );
    } else if (structureStyle === 1) {
      stampTerracedPlatform(setBlock, heightMap, origin, size, baseX, baseZ, radiusX, radiusZ, height, accentBlock, featureSeed);
    } else if (structureStyle === 2) {
      stampPylonCluster(setBlock, heightMap, origin, size, baseX, baseZ, radiusX, radiusZ, height, accentBlock, featureSeed);
    } else {
      stampBrokenWall(setBlock, heightMap, origin, size, baseX, baseZ, radiusX, radiusZ, height, accentBlock, featureSeed);
    }

    accepted.push({ x: baseX, z: baseZ, radius });
    structuresPlaced++;
  }

  const groveCount = 7 + Math.floor(random() * 8);
  let grovesPlaced = 0;

  for (let attempts = 0; attempts < 130 && grovesPlaced < groveCount; attempts++) {
    const baseX = lerp(-halfPlayableX, halfPlayableX, random());
    const baseZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radius = lerp(2.8, 5.8, random());
    const trunkHeight = worldHeightToGridRows(3 + Math.floor(random() * 2));
    const featureSeed = Math.floor(random() * 0xffffffff);

    if (!canPlaceFeature(layout, accepted, baseX, baseZ, radius)) {
      continue;
    }

    stampThemedNaturalFeature(setBlock, heightMap, origin, size, theme, baseX, baseZ, trunkHeight, featureSeed);
    accepted.push({ x: baseX, z: baseZ, radius });
    grovesPlaced++;
  }

  const coverCount = 22 + Math.floor(random() * 18);
  let coverPlaced = 0;

  for (let attempts = 0; attempts < 170 && coverPlaced < coverCount; attempts++) {
    const baseX = lerp(-halfPlayableX, halfPlayableX, random());
    const baseZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = lerp(1.1, 3.4, random());
    const radiusZ = lerp(1.1, 3.4, random());
    const radius = Math.max(radiusX, radiusZ) + 2;

    if (!canPlaceFeature(layout, accepted, baseX, baseZ, radius)) {
      continue;
    }

    const preferStone = Math.abs(baseZ) < 13 || random() < 0.38;
    const boulderHeight = worldHeightToGridRows(2 + Math.floor(random() * 3));
    const trunkHeight = worldHeightToGridRows(3 + Math.floor(random() * 2));
    const featureSeed = Math.floor(random() * 0xffffffff);

    if (preferStone) {
      stampBoulder(setBlock, heightMap, origin, size, baseX, baseZ, radiusX, radiusZ, boulderHeight);
    } else {
      stampThemedNaturalFeature(setBlock, heightMap, origin, size, theme, baseX, baseZ, trunkHeight, featureSeed);
    }

    accepted.push({ x: baseX, z: baseZ, radius });
    coverPlaced++;
  }
}

function flattenRect(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  height: number
): void {
  const gx0 = clamp(worldToGrid(minX, origin.x), 0, size.x - 1);
  const gx1 = clamp(worldToGrid(maxX, origin.x), 0, size.x - 1);
  const gz0 = clamp(worldToGrid(minZ, origin.z), 0, size.z - 1);
  const gz1 = clamp(worldToGrid(maxZ, origin.z), 0, size.z - 1);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      heightMap[x + z * size.x] = height;
    }
  }
}

function paintSurfaceRect(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  blockId: VoxelBlockId
): void {
  const gx0 = clamp(worldToGrid(minX, origin.x), 0, size.x - 1);
  const gx1 = clamp(worldToGrid(maxX, origin.x), 0, size.x - 1);
  const gz0 = clamp(worldToGrid(minZ, origin.z), 0, size.z - 1);
  const gz1 = clamp(worldToGrid(maxZ, origin.z), 0, size.z - 1);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const surfaceY = heightMap[x + z * size.x] - 1;
      setBlock(x, surfaceY, z, blockId);
    }
  }
}

function shapeSpawnPointTerrain(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  spawn: { x: number; z: number }
): void {
  const spawnX = clamp(worldToGrid(spawn.x, origin.x), 0, size.x - 1);
  const spawnZ = clamp(worldToGrid(spawn.z, origin.z), 0, size.z - 1);
  const targetHeight = heightMap[spawnX + spawnZ * size.x];
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    spawn.x - SPAWN_BLEND_RADIUS,
    spawn.x + SPAWN_BLEND_RADIUS,
    spawn.z - SPAWN_BLEND_RADIUS,
    spawn.z + SPAWN_BLEND_RADIUS
  );

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const distance = Math.sqrt(distanceSq(worldX, worldZ, spawn.x, spawn.z));
      if (distance > SPAWN_BLEND_RADIUS) continue;

      const index = x + z * size.x;
      const currentHeight = heightMap[index];
      const blend =
        distance <= SPAWN_PAD_RADIUS
          ? 1
          : (SPAWN_BLEND_RADIUS - distance) / (SPAWN_BLEND_RADIUS - SPAWN_PAD_RADIUS);

      heightMap[index] = clamp(
        Math.round(lerp(currentHeight, targetHeight, blend)),
        1,
        size.y - 1
      );
    }
  }
}

function shapeSpawnTerrain(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  spawns: { x: number; z: number }[]
): void {
  for (const spawn of spawns) {
    shapeSpawnPointTerrain(heightMap, origin, size, spawn);
  }
}

function paintSpawnPoint(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  spawn: { x: number; z: number },
  blockId: VoxelBlockId
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    spawn.x - SPAWN_PAD_RADIUS,
    spawn.x + SPAWN_PAD_RADIUS,
    spawn.z - SPAWN_PAD_RADIUS,
    spawn.z + SPAWN_PAD_RADIUS
  );

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (distanceSq(worldX, worldZ, spawn.x, spawn.z) > SPAWN_PAD_RADIUS ** 2) continue;

      const surfaceY = heightMap[x + z * size.x] - 1;
      setBlock(x, surfaceY, z, blockId);
    }
  }
}

function paintSpawnPoints(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  spawns: { x: number; z: number }[],
  blockId: VoxelBlockId
): void {
  for (const spawn of spawns) {
    paintSpawnPoint(setBlock, heightMap, origin, size, spawn, blockId);
  }
}

function clearSpawnPoint(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  spawn: { x: number; z: number },
  blockId: VoxelBlockId
): void {
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    spawn.x - SPAWN_CLEAR_RADIUS,
    spawn.x + SPAWN_CLEAR_RADIUS,
    spawn.z - SPAWN_CLEAR_RADIUS,
    spawn.z + SPAWN_CLEAR_RADIUS
  );

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const distance = Math.sqrt(distanceSq(worldX, worldZ, spawn.x, spawn.z));
      if (distance > SPAWN_CLEAR_RADIUS) continue;

      const surfaceY = heightMap[x + z * size.x] - 1;
      if (distance <= SPAWN_PAD_RADIUS) {
        setBlock(x, surfaceY, z, blockId);
      }

      for (let y = surfaceY + 1; y <= surfaceY + worldHeightToGridRows(9); y++) {
        setBlock(x, y, z, 'air');
      }
    }
  }
}

function clearSpawnPoints(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  spawns: { x: number; z: number }[],
  blockId: VoxelBlockId
): void {
  for (const spawn of spawns) {
    clearSpawnPoint(setBlock, heightMap, origin, size, spawn, blockId);
  }
}

export function generateProceduralVoxelMap(seed = DEFAULT_PROCEDURAL_MAP_SEED): VoxelMapManifest {
  const normalizedSeed = seed >>> 0;
  const layout = createProceduralCTFLayout(normalizedSeed);
  const theme = getVoxelMapTheme(normalizedSeed);
  const random = mulberry32(normalizedSeed);
  const { origin, voxelSize, size, chunkSize } = layout;
  const blocks = new Uint8Array(size.x * size.y * size.z);
  const heightMap = new Uint8Array(size.x * size.z);
  let solidBlocks = 0;
  const terrainScale = 0.022 + random() * 0.026;
  const heightBias = Math.floor(random() * 2);
  const hillStrength = 2.4 + random() * 2.4;
  const ridgeStrength = 0.8 + random() * 1.2;
  const sideLaneCenter = lerp(14, 22, random());
  const sideLaneWidth = lerp(4, 7, random());
  const centerLaneWidth = lerp(5.5, 9, random());
  const ridgeBandWidth = lerp(9.5, 15.5, random());
  const plateauStrength = random() < 0.5 ? lerp(0.6, 1.8, random()) : 0;
  const basinStrength = random() < 0.5 ? lerp(0.5, 1.4, random()) : 0;
  const minTerrainRows = worldHeightToGridRows(4);
  const maxTerrainRows = size.y - worldHeightToGridRows(10);
  const dirtDepthRows = worldHeightToGridRows(4);
  const edgeWallRows = worldHeightToGridRows(2.5 + random() * 2.5);
  const rockySurfaceRows = worldHeightToGridRows(11);

  const setBlock: BlockSetter = (x, y, z, blockId) => {
    if (x < 0 || x >= size.x || y < 0 || y >= size.y || z < 0 || z >= size.z) return;

    const index = chunkIndex(x, y, z, size);
    const previous = blocks[index];
    const next = getBlockNumericId(blockId);

    if (previous === next) return;
    if (isSolidBlock(previous)) solidBlocks--;
    if (isSolidBlock(next)) solidBlocks++;
    blocks[index] = next;
  };

  for (let x = 0; x < size.x; x++) {
    for (let z = 0; z < size.z; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const absX = Math.abs(worldX);
      const absZ = Math.abs(worldZ);
      const insideBoundary = isInsideBoundaryPolygon(worldX, worldZ, layout.boundary);
      const boundaryDistance = distanceToBoundary(worldX, worldZ, layout.boundary);

      const baseNoise = fractalNoise2(normalizedSeed, worldX * terrainScale, worldZ * terrainScale, 4);
      const ridgeNoise = fractalNoise2(normalizedSeed ^ 0x41c64e6d, worldX * 0.055, worldZ * 0.055, 3);
      const detailNoise = fractalNoise2(normalizedSeed ^ 0x9e3779b9, worldX * 0.12, worldZ * 0.12, 2);
      const plateauNoise = fractalNoise2(normalizedSeed ^ 0x632be59b, worldX * 0.035, worldZ * 0.035, 3);
      const centerBand = Math.max(0, 1 - absZ / ridgeBandWidth);
      const centerWidth = Math.max(0, 1 - Math.max(0, absX - 5) / 24);
      const midLaneCut = Math.max(0, 1 - absX / centerLaneWidth) * 0.78;
      const sideLaneCut = Math.max(0, 1 - Math.abs(absX - sideLaneCenter) / sideLaneWidth) * 0.58;
      const middleRidge =
        Math.pow(centerBand, 1.6) * centerWidth * (1 - Math.max(midLaneCut, sideLaneCut)) * (1.5 + ridgeNoise * 1.8);
      const centerBasin = basinStrength * Math.max(0, 1 - absX / 30) * Math.max(0, 1 - absZ / 25);
      const plateauStep = plateauStrength > 0 && plateauNoise > 0.66 ? plateauStrength : 0;
      const boundaryLift = insideBoundary
        ? Math.max(0, 1 - boundaryDistance / 4.8) * (1.4 + ridgeNoise * 1.2)
        : 3.5 + Math.min(boundaryDistance, 5) * 0.65;
      const worldHeight = clamp(
        4 +
          heightBias +
          baseNoise * hillStrength +
          (ridgeNoise > 0.68 ? ridgeStrength : 0) +
          detailNoise * 1.5 +
          middleRidge +
          plateauStep -
          centerBasin +
          boundaryLift,
        4,
        maxTerrainRows * voxelSize.y
      );
      const height = clamp(
        worldHeightToGridRows(worldHeight),
        minTerrainRows,
        maxTerrainRows
      );

      heightMap[x + z * size.x] = height;
    }
  }

  applyTerrainLandforms(heightMap, origin, size, layout, random, normalizedSeed, minTerrainRows, maxTerrainRows);
  smoothHeightMap(heightMap, origin, size, layout, minTerrainRows, maxTerrainRows, TERRAIN_SMOOTHING_PASSES);
  limitHeightDeltas(heightMap, size, MAX_NAVIGATION_STEP_ROWS, 3);

  const redFlagHeight = heightMap[gridIndexFromWorld(layout.flagZones.red.x, layout.flagZones.red.z, origin, size)];
  const blueFlagHeight = heightMap[gridIndexFromWorld(layout.flagZones.blue.x, layout.flagZones.blue.z, origin, size)];

  flattenRect(
    heightMap,
    origin,
    size,
    layout.flagZones.red.x - 3,
    layout.flagZones.red.x + 3,
    layout.flagZones.red.z - 2,
    layout.flagZones.red.z + 2,
    redFlagHeight
  );
  flattenRect(
    heightMap,
    origin,
    size,
    layout.flagZones.blue.x - 3,
    layout.flagZones.blue.x + 3,
    layout.flagZones.blue.z - 2,
    layout.flagZones.blue.z + 2,
    blueFlagHeight
  );
  shapeSpawnTerrain(heightMap, origin, size, layout.spawnPoints.red);
  shapeSpawnTerrain(heightMap, origin, size, layout.spawnPoints.blue);
  shapeGameplayRouteTerrain(heightMap, origin, size, layout);
  limitHeightDeltas(heightMap, size, MAX_NAVIGATION_STEP_ROWS, 2);
  shapeSpawnTerrain(heightMap, origin, size, layout.spawnPoints.red);
  shapeSpawnTerrain(heightMap, origin, size, layout.spawnPoints.blue);
  flattenRect(
    heightMap,
    origin,
    size,
    layout.flagZones.red.x - 3,
    layout.flagZones.red.x + 3,
    layout.flagZones.red.z - 2,
    layout.flagZones.red.z + 2,
    redFlagHeight
  );
  flattenRect(
    heightMap,
    origin,
    size,
    layout.flagZones.blue.x - 3,
    layout.flagZones.blue.x + 3,
    layout.flagZones.blue.z - 2,
    layout.flagZones.blue.z + 2,
    blueFlagHeight
  );

  for (let x = 0; x < size.x; x++) {
    for (let z = 0; z < size.z; z++) {
      const height = heightMap[x + z * size.x];
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const insideBoundary = isInsideBoundaryPolygon(worldX, worldZ, layout.boundary);
      const boundaryDistance = distanceToBoundary(worldX, worldZ, layout.boundary);
      const boundarySurface = !insideBoundary || boundaryDistance < 2.2;
      const rockPatch = fractalNoise2(normalizedSeed ^ 0xa11ce, worldX * 0.09, worldZ * 0.09, 3) > 0.76;

      for (let y = 0; y < height; y++) {
        let blockId: VoxelBlockId = 'stone';

        if (y === 0) {
          blockId = 'barrier';
        } else if (y === height - 1) {
          blockId = boundarySurface || rockPatch || height > rockySurfaceRows ? 'stone' : 'grass';
        } else if (y >= height - dirtDepthRows) {
          blockId = 'dirt';
        }

        setBlock(x, y, z, blockId);
      }

      if (boundarySurface) {
        const wallRows = edgeWallRows + (!insideBoundary ? worldHeightToGridRows(2) : 0);
        for (let y = height; y < Math.min(size.y, height + wallRows); y++) {
          setBlock(x, y, z, 'stone');
        }
      }
    }
  }

  carveProceduralCaves(setBlock, heightMap, origin, size, layout, normalizedSeed);

  paintSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.red, 'spawn_pad_red');
  paintSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.blue, 'spawn_pad_blue');
  paintSurfaceRect(
    setBlock,
    heightMap,
    origin,
    size,
    layout.flagZones.red.x - 3,
    layout.flagZones.red.x + 3,
    layout.flagZones.red.z - 2,
    layout.flagZones.red.z + 2,
    'flag_pad'
  );
  paintSurfaceRect(
    setBlock,
    heightMap,
    origin,
    size,
    layout.flagZones.blue.x - 3,
    layout.flagZones.blue.x + 3,
    layout.flagZones.blue.z - 2,
    layout.flagZones.blue.z + 2,
    'flag_pad'
  );

  stampProceduralFeatures(setBlock, heightMap, origin, size, layout, random, theme, normalizedSeed);
  clearSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.red, 'spawn_pad_red');
  clearSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.blue, 'spawn_pad_blue');
  enforceSpawnSightlineOcclusion(setBlock, blocks, heightMap, origin, size, layout, normalizedSeed);

  const chunks: VoxelChunk[] = [];
  for (let cy = 0; cy < Math.ceil(size.y / chunkSize.y); cy++) {
    for (let cz = 0; cz < Math.ceil(size.z / chunkSize.z); cz++) {
      for (let cx = 0; cx < Math.ceil(size.x / chunkSize.x); cx++) {
        const actualSize = {
          x: Math.min(chunkSize.x, size.x - cx * chunkSize.x),
          y: Math.min(chunkSize.y, size.y - cy * chunkSize.y),
          z: Math.min(chunkSize.z, size.z - cz * chunkSize.z),
        };
        const chunkBlocks = new Uint8Array(actualSize.x * actualSize.y * actualSize.z);

        for (let y = 0; y < actualSize.y; y++) {
          for (let z = 0; z < actualSize.z; z++) {
            for (let x = 0; x < actualSize.x; x++) {
              const globalX = cx * chunkSize.x + x;
              const globalY = cy * chunkSize.y + y;
              const globalZ = cz * chunkSize.z + z;
              chunkBlocks[chunkIndex(x, y, z, actualSize)] = blocks[chunkIndex(globalX, globalY, globalZ, size)];
            }
          }
        }

        chunks.push({
          coord: { x: cx, y: cy, z: cz },
          size: actualSize,
          blocks: chunkBlocks,
        });
      }
    }
  }

  const partialManifest = {
    id: `procedural-ctf-${normalizedSeed}`,
    seed: normalizedSeed,
    theme,
    origin,
    voxelSize,
    size,
    chunkSize,
    spawnPoints: {
      red: layout.spawnPoints.red.map((spawn) => ({
        ...spawn,
        y: gridRowsToWorldY(heightMap[gridIndexFromWorld(spawn.x, spawn.z, origin, size)], origin.y) + PLAYER_HEIGHT / 2 + SPAWN_CLEARANCE,
      })),
      blue: layout.spawnPoints.blue.map((spawn) => ({
        ...spawn,
        y: gridRowsToWorldY(heightMap[gridIndexFromWorld(spawn.x, spawn.z, origin, size)], origin.y) + PLAYER_HEIGHT / 2 + SPAWN_CLEARANCE,
      })),
    },
    flagZones: {
      red: {
        ...layout.flagZones.red,
        y: gridRowsToWorldY(heightMap[gridIndexFromWorld(layout.flagZones.red.x, layout.flagZones.red.z, origin, size)], origin.y) + voxelSize.y,
      },
      blue: {
        ...layout.flagZones.blue,
        y: gridRowsToWorldY(heightMap[gridIndexFromWorld(layout.flagZones.blue.x, layout.flagZones.blue.z, origin, size)], origin.y) + voxelSize.y,
      },
    },
    boundary: layout.boundary,
    chunks,
  };
  const colliders = generateVoxelColliders(partialManifest);

  return {
    ...partialManifest,
    colliders,
    stats: {
      chunkCount: chunks.length,
      solidBlocks,
      colliderCount: colliders.length,
    },
  };
}

let defaultManifest: VoxelMapManifest | null = null;

export function getDefaultProceduralVoxelMap(): VoxelMapManifest {
  if (!defaultManifest) {
    defaultManifest = generateProceduralVoxelMap(DEFAULT_PROCEDURAL_MAP_SEED);
  }

  return defaultManifest;
}
