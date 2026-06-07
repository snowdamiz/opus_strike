import type { BoundaryPoint, VoxelMapManifest, VoxelSize } from './types.js';
import { isInsideBoundaryPolygon } from './boundaries.js';
import { mulberry32 } from './rng.js';

export interface ProceduralCTFLayout {
  origin: { x: number; y: number; z: number };
  voxelSize: VoxelSize;
  size: VoxelSize;
  chunkSize: VoxelSize;
  spawnPoints: VoxelMapManifest['spawnPoints'];
  flagZones: VoxelMapManifest['flagZones'];
  boundary: BoundaryPoint[];
}

export const PROCEDURAL_MAP_SCALE = 0.9;
export const PROCEDURAL_MAP_WORLD_SIZE: VoxelSize = {
  x: 65,
  y: 20,
  z: 60 * PROCEDURAL_MAP_SCALE,
};
export const PROCEDURAL_VOXEL_SIZE: VoxelSize = { x: 0.25, y: 0.25, z: 0.25 };
export const PROCEDURAL_MAP_SIZE: VoxelSize = {
  x: Math.round(PROCEDURAL_MAP_WORLD_SIZE.x / PROCEDURAL_VOXEL_SIZE.x),
  y: Math.round(PROCEDURAL_MAP_WORLD_SIZE.y / PROCEDURAL_VOXEL_SIZE.y),
  z: Math.round(PROCEDURAL_MAP_WORLD_SIZE.z / PROCEDURAL_VOXEL_SIZE.z),
};
export const PROCEDURAL_CHUNK_SIZE: VoxelSize = { x: 16, y: 16, z: 16 };
export const PROCEDURAL_MAP_ORIGIN = {
  x: -PROCEDURAL_MAP_WORLD_SIZE.x / 2,
  y: 0,
  z: -PROCEDURAL_MAP_WORLD_SIZE.z / 2,
};

interface ProceduralMapFootprint {
  worldSize: VoxelSize;
  origin: { x: number; y: number; z: number };
  size: VoxelSize;
}

function lerp(valueA: number, valueB: number, amount: number): number {
  return valueA + (valueB - valueA) * amount;
}

function scaleMap(value: number): number {
  return value * PROCEDURAL_MAP_SCALE;
}

function createProceduralMapFootprint(seed: number): ProceduralMapFootprint {
  const random = mulberry32(seed ^ 0x793f7d9);
  const sizeScale = lerp(0.94, 1.08, random());
  const aspectShift = lerp(-0.13, 0.13, random());
  const requestedWorldSize = {
    x: PROCEDURAL_MAP_WORLD_SIZE.x * sizeScale * (1 + aspectShift),
    y: PROCEDURAL_MAP_WORLD_SIZE.y,
    z: PROCEDURAL_MAP_WORLD_SIZE.z * sizeScale * (1 - aspectShift * 0.85),
  };
  const size = {
    x: Math.round(requestedWorldSize.x / PROCEDURAL_VOXEL_SIZE.x),
    y: PROCEDURAL_MAP_SIZE.y,
    z: Math.round(requestedWorldSize.z / PROCEDURAL_VOXEL_SIZE.z),
  };
  const worldSize = {
    x: size.x * PROCEDURAL_VOXEL_SIZE.x,
    y: PROCEDURAL_MAP_WORLD_SIZE.y,
    z: size.z * PROCEDURAL_VOXEL_SIZE.z,
  };

  return {
    worldSize,
    origin: {
      x: -worldSize.x / 2,
      y: 0,
      z: -worldSize.z / 2,
    },
    size,
  };
}

function getFootprintScale(worldSize: VoxelSize): number {
  return Math.min(
    worldSize.x / PROCEDURAL_MAP_WORLD_SIZE.x,
    worldSize.z / PROCEDURAL_MAP_WORLD_SIZE.z
  );
}

function createProceduralBoundary(seed: number, worldSize: VoxelSize): BoundaryPoint[] {
  const random = mulberry32(seed ^ 0x2f6e2b1);
  const footprintScale = getFootprintScale(worldSize);
  const halfX = worldSize.x / 2;
  const halfZ = worldSize.z / 2;
  const west = -(halfX - scaleMap(lerp(0.7, 4.4, random())) * footprintScale);
  const east = halfX - scaleMap(lerp(0.7, 4.4, random())) * footprintScale;
  const south = -(halfZ - scaleMap(lerp(0.6, 3.4, random())) * footprintScale);
  const north = halfZ - scaleMap(lerp(0.6, 3.4, random())) * footprintScale;
  const swCutX = scaleMap(lerp(2.2, 8.8, random())) * footprintScale;
  const swCutZ = scaleMap(lerp(2.0, 6.9, random())) * footprintScale;
  const seCutX = scaleMap(lerp(2.2, 8.8, random())) * footprintScale;
  const seCutZ = scaleMap(lerp(2.0, 6.9, random())) * footprintScale;
  const neCutX = scaleMap(lerp(2.2, 8.8, random())) * footprintScale;
  const neCutZ = scaleMap(lerp(2.0, 6.9, random())) * footprintScale;
  const nwCutX = scaleMap(lerp(2.2, 8.8, random())) * footprintScale;
  const nwCutZ = scaleMap(lerp(2.0, 6.9, random())) * footprintScale;
  const eastLowerInset = scaleMap(lerp(0.2, 7.2, random())) * footprintScale;
  const eastMidInset = scaleMap(lerp(0.2, 8.8, random())) * footprintScale;
  const eastUpperInset = scaleMap(lerp(0.2, 7.2, random())) * footprintScale;
  const westLowerInset = scaleMap(lerp(0.2, 7.2, random())) * footprintScale;
  const westMidInset = scaleMap(lerp(0.2, 8.8, random())) * footprintScale;
  const westUpperInset = scaleMap(lerp(0.2, 7.2, random())) * footprintScale;
  const southLowerInset = scaleMap(lerp(0.1, 3.3, random())) * footprintScale;
  const southUpperInset = scaleMap(lerp(0.1, 3.3, random())) * footprintScale;
  const northLowerInset = scaleMap(lerp(0.1, 3.3, random())) * footprintScale;
  const northUpperInset = scaleMap(lerp(0.1, 3.3, random())) * footprintScale;
  const southT1 = lerp(0.27, 0.39, random());
  const southT2 = lerp(0.61, 0.73, random());
  const northT1 = lerp(0.27, 0.39, random());
  const northT2 = lerp(0.61, 0.73, random());

  return [
    { x: west + swCutX, z: south },
    { x: lerp(west + swCutX, east - seCutX, southT1), z: south + southLowerInset },
    { x: lerp(west + swCutX, east - seCutX, southT2), z: south + southUpperInset },
    { x: east - seCutX, z: south },
    { x: east, z: south + seCutZ },
    { x: east - eastLowerInset, z: lerp(south * 0.62, south * 0.22, random()) },
    { x: east - eastMidInset, z: scaleMap(lerp(-5.5, 5.5, random())) },
    { x: east - eastUpperInset, z: lerp(north * 0.22, north * 0.62, random()) },
    { x: east, z: north - neCutZ },
    { x: east - neCutX, z: north },
    { x: lerp(east - neCutX, west + nwCutX, northT1), z: north - northLowerInset },
    { x: lerp(east - neCutX, west + nwCutX, northT2), z: north - northUpperInset },
    { x: west + nwCutX, z: north },
    { x: west, z: north - nwCutZ },
    { x: west + westUpperInset, z: lerp(north * 0.22, north * 0.62, random()) },
    { x: west + westMidInset, z: scaleMap(lerp(-5.5, 5.5, random())) },
    { x: west + westLowerInset, z: lerp(south * 0.62, south * 0.22, random()) },
    { x: west, z: south + swCutZ },
  ];
}

function getBoundarySafePoint(x: number, z: number, boundary: BoundaryPoint[]): { x: number; z: number } | null {
  if (isInsideBoundaryPolygon(x, z, boundary)) {
    return { x, z };
  }

  for (let step = 1; step <= 12; step++) {
    const pullToCenter = 1 - step * 0.055;
    const candidate = {
      x: x * pullToCenter,
      z: z * pullToCenter,
    };

    if (isInsideBoundaryPolygon(candidate.x, candidate.z, boundary)) {
      return candidate;
    }
  }

  return isInsideBoundaryPolygon(0, 0, boundary) ? { x: 0, z: 0 } : null;
}

function createFlagZone(random: () => number, side: 1 | -1, worldSize: VoxelSize, boundary: BoundaryPoint[]): { x: number; y: number; z: number } {
  const halfX = worldSize.x / 2;
  const halfZ = worldSize.z / 2;
  const maxFlagX = Math.min(scaleMap(8), halfX * 0.22);
  const flag = getBoundarySafePoint(
    lerp(-maxFlagX, maxFlagX, random()),
    side * lerp(halfZ * 0.58, halfZ * 0.74, random()),
    boundary
  ) ?? { x: 0, z: side * halfZ * 0.58 };

  return {
    x: flag.x,
    y: 5,
    z: flag.z,
  };
}

function snapHalfStep(value: number): number {
  return Math.round(value * 2) / 2;
}

function createLayoutSpawnCluster(random: () => number, side: 1 | -1, worldSize: VoxelSize, boundary: BoundaryPoint[]): { x: number; y: number; z: number }[] {
  const halfX = worldSize.x / 2;
  const halfZ = worldSize.z / 2;
  const maxSpawnX = Math.min(scaleMap(25.5), halfX * 0.72);
  const minSpawnZ = halfZ * 0.74;
  const maxSpawnZ = halfZ * 0.86;
  const centerX = lerp(-maxSpawnX * 0.6, maxSpawnX * 0.6, random());
  const centerZ = side * lerp(minSpawnZ, maxSpawnZ, random());
  const spawns: { x: number; y: number; z: number }[] = [];

  for (let attempts = 0; attempts < 90 && spawns.length < 5; attempts++) {
    const angle = random() * Math.PI * 2;
    const radiusX = Math.sqrt(random()) * scaleMap(5.8);
    const radiusZ = Math.sqrt(random()) * scaleMap(1.9);
    const candidate = getBoundarySafePoint(
      Math.max(-maxSpawnX, Math.min(maxSpawnX, snapHalfStep(centerX + Math.cos(angle) * radiusX))),
      side * Math.max(minSpawnZ, Math.min(maxSpawnZ, Math.abs(snapHalfStep(centerZ + Math.sin(angle) * radiusZ)))),
      boundary
    );

    if (!candidate) continue;

    const clear = spawns.every((spawn) => (spawn.x - candidate.x) ** 2 + (spawn.z - candidate.z) ** 2 >= 2.1 ** 2);

    if (clear) {
      spawns.push({ x: candidate.x, y: 6, z: candidate.z });
    }
  }

  for (let offset = 0; spawns.length < 5 && offset < 16; offset++) {
    const direction = offset % 2 === 0 ? 1 : -1;
    const candidate = getBoundarySafePoint(
      Math.max(-maxSpawnX, Math.min(maxSpawnX, snapHalfStep(centerX + direction * scaleMap(2 + offset)))),
      side * Math.max(minSpawnZ, Math.min(maxSpawnZ, Math.abs(snapHalfStep(centerZ + scaleMap((offset % 3) - 1))))),
      boundary
    );

    if (!candidate) continue;
    if (!spawns.every((spawn) => (spawn.x - candidate.x) ** 2 + (spawn.z - candidate.z) ** 2 >= 2.1 ** 2)) continue;

    spawns.push({
      x: candidate.x,
      y: 6,
      z: candidate.z,
    });
  }

  return spawns;
}

export function createProceduralCTFLayout(seed = 0): ProceduralCTFLayout {
  const footprint = createProceduralMapFootprint(seed);
  const boundary = createProceduralBoundary(seed, footprint.worldSize);
  const flagRandom = mulberry32(seed ^ 0x51f15eed);
  const spawnRandom = mulberry32(seed ^ 0xbadc0de);

  return {
    origin: footprint.origin,
    voxelSize: PROCEDURAL_VOXEL_SIZE,
    size: footprint.size,
    chunkSize: PROCEDURAL_CHUNK_SIZE,
    spawnPoints: {
      red: createLayoutSpawnCluster(spawnRandom, 1, footprint.worldSize, boundary),
      blue: createLayoutSpawnCluster(spawnRandom, -1, footprint.worldSize, boundary),
    },
    flagZones: {
      red: createFlagZone(flagRandom, 1, footprint.worldSize, boundary),
      blue: createFlagZone(flagRandom, -1, footprint.worldSize, boundary),
    },
    boundary,
  };
}
