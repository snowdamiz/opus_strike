import type { BoundaryPoint, VoxelMapManifest, VoxelSize } from './types.js';
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

export const PROCEDURAL_MAP_WORLD_SIZE: VoxelSize = { x: 72, y: 20, z: 60 };
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

function lerp(valueA: number, valueB: number, amount: number): number {
  return valueA + (valueB - valueA) * amount;
}

function createProceduralBoundary(seed: number): BoundaryPoint[] {
  const random = mulberry32(seed ^ 0x2f6e2b1);
  const west = -lerp(31.5, 35.5, random());
  const east = lerp(31.5, 35.5, random());
  const south = -lerp(26.8, 29.2, random());
  const north = lerp(26.8, 29.2, random());
  const swCutX = lerp(2.4, 7.8, random());
  const swCutZ = lerp(2.2, 6.4, random());
  const seCutX = lerp(2.4, 7.8, random());
  const seCutZ = lerp(2.2, 6.4, random());
  const neCutX = lerp(2.4, 7.8, random());
  const neCutZ = lerp(2.2, 6.4, random());
  const nwCutX = lerp(2.4, 7.8, random());
  const nwCutZ = lerp(2.2, 6.4, random());
  const eastLowerInset = lerp(0.4, 5.8, random());
  const eastMidInset = lerp(0.2, 6.8, random());
  const eastUpperInset = lerp(0.4, 5.8, random());
  const westLowerInset = lerp(0.4, 5.8, random());
  const westMidInset = lerp(0.2, 6.8, random());
  const westUpperInset = lerp(0.4, 5.8, random());

  return [
    { x: west + swCutX, z: south },
    { x: east - seCutX, z: south },
    { x: east, z: south + seCutZ },
    { x: east - eastLowerInset, z: lerp(south * 0.62, south * 0.22, random()) },
    { x: east - eastMidInset, z: lerp(-5.5, 5.5, random()) },
    { x: east - eastUpperInset, z: lerp(north * 0.22, north * 0.62, random()) },
    { x: east, z: north - neCutZ },
    { x: east - neCutX, z: north },
    { x: west + nwCutX, z: north },
    { x: west, z: north - nwCutZ },
    { x: west + westUpperInset, z: lerp(north * 0.22, north * 0.62, random()) },
    { x: west + westMidInset, z: lerp(-5.5, 5.5, random()) },
    { x: west + westLowerInset, z: lerp(south * 0.62, south * 0.22, random()) },
    { x: west, z: south + swCutZ },
  ];
}

function createFlagZone(random: () => number, side: 1 | -1): { x: number; y: number; z: number } {
  return {
    x: lerp(-8, 8, random()),
    y: 5,
    z: side * lerp(17.5, 22.5, random()),
  };
}

function snapHalfStep(value: number): number {
  return Math.round(value * 2) / 2;
}

function createLayoutSpawnCluster(random: () => number, side: 1 | -1): { x: number; y: number; z: number }[] {
  const centerX = lerp(-15, 15, random());
  const centerZ = side * lerp(22.5, 25.5, random());
  const spawns: { x: number; y: number; z: number }[] = [];

  for (let attempts = 0; attempts < 90 && spawns.length < 5; attempts++) {
    const angle = random() * Math.PI * 2;
    const radiusX = Math.sqrt(random()) * 5.8;
    const radiusZ = Math.sqrt(random()) * 1.9;
    const x = Math.max(-25.5, Math.min(25.5, snapHalfStep(centerX + Math.cos(angle) * radiusX)));
    const z = side * Math.max(22.5, Math.min(25.5, Math.abs(snapHalfStep(centerZ + Math.sin(angle) * radiusZ))));
    const clear = spawns.every((spawn) => (spawn.x - x) ** 2 + (spawn.z - z) ** 2 >= 2.1 ** 2);

    if (clear) {
      spawns.push({ x, y: 6, z });
    }
  }

  for (let offset = 0; spawns.length < 5 && offset < 8; offset++) {
    const direction = offset % 2 === 0 ? 1 : -1;
    spawns.push({
      x: Math.max(-25.5, Math.min(25.5, snapHalfStep(centerX + direction * (2 + offset)))),
      y: 6,
      z: side * Math.max(22.5, Math.min(25.5, Math.abs(snapHalfStep(centerZ + (offset % 3) - 1)))),
    });
  }

  return spawns;
}

export function createProceduralCTFLayout(seed = 0): ProceduralCTFLayout {
  const flagRandom = mulberry32(seed ^ 0x51f15eed);
  const spawnRandom = mulberry32(seed ^ 0xbadc0de);

  return {
    origin: PROCEDURAL_MAP_ORIGIN,
    voxelSize: PROCEDURAL_VOXEL_SIZE,
    size: PROCEDURAL_MAP_SIZE,
    chunkSize: PROCEDURAL_CHUNK_SIZE,
    spawnPoints: {
      red: createLayoutSpawnCluster(spawnRandom, 1),
      blue: createLayoutSpawnCluster(spawnRandom, -1),
    },
    flagZones: {
      red: createFlagZone(flagRandom, 1),
      blue: createFlagZone(flagRandom, -1),
    },
    boundary: createProceduralBoundary(seed),
  };
}
