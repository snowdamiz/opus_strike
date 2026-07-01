import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  type BoundaryPoint,
  type VoxelMapManifest,
  type VoxelMapSizeId,
  type VoxelSize,
} from './types.js';
import { isInsideBoundaryPolygon } from './boundaries.js';
import { mulberry32 } from './rng.js';
import { DEFAULT_GAME_CONFIG } from '../../constants/game.js';

export interface ProceduralCTFLayout {
  mapSize: VoxelMapSizeId;
  mapScale: number;
  origin: { x: number; y: number; z: number };
  voxelSize: VoxelSize;
  size: VoxelSize;
  chunkSize: VoxelSize;
  spawnPoints: VoxelMapManifest['spawnPoints'];
  flagZones: VoxelMapManifest['flagZones'];
  boundary: BoundaryPoint[];
}

export const PROCEDURAL_MAP_SCALE = 0.9;
export const PROCEDURAL_MAP_FOOTPRINT_SCALE = 1.1;
export const PROCEDURAL_MAP_WORLD_SIZE: VoxelSize = {
  x: 70 * PROCEDURAL_MAP_FOOTPRINT_SCALE,
  y: 20,
  z: 64 * PROCEDURAL_MAP_SCALE * PROCEDURAL_MAP_FOOTPRINT_SCALE,
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

export interface VoxelMapSizeDefinition {
  id: VoxelMapSizeId;
  label: string;
  scale: number;
}

export const VOXEL_MAP_SIZE_IDS = ['small', 'medium', 'large'] as const satisfies readonly VoxelMapSizeId[];

export const VOXEL_MAP_SIZE_DEFINITIONS: Record<VoxelMapSizeId, VoxelMapSizeDefinition> = {
  small: { id: 'small', label: 'Small', scale: 0.85 },
  medium: { id: 'medium', label: 'Medium', scale: 1 },
  large: { id: 'large', label: 'Large', scale: 1.18 },
};

interface ProceduralMapFootprint {
  worldSize: VoxelSize;
  origin: { x: number; y: number; z: number };
  size: VoxelSize;
  mapScale: number;
}

export interface ProceduralCTFLayoutOptions {
  footprintScale?: number;
}

interface Point2 {
  x: number;
  z: number;
}

interface FlagPair {
  red: Point2;
  blue: Point2;
}

const FLAG_BOUNDARY_DISTANCE = scaleMap(9.7);
const SPAWN_BOUNDARY_DISTANCE = 5;
const SPAWN_POINT_COUNT = DEFAULT_GAME_CONFIG.teamSize;
const SPAWN_ARC_ANGLES = [-54, -18, 18, 54];
const SPAWN_BASE_RADIUS = scaleMap(4.9);
const SPAWN_MIN_RADIUS = scaleMap(3.6);
const FLAG_CANDIDATE_GRID_STEP = scaleMap(1.9);
const FLAG_PAIR_CANDIDATE_LIMIT = 96;

function lerp(valueA: number, valueB: number, amount: number): number {
  return valueA + (valueB - valueA) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function randomInt(random: () => number, min: number, max: number): number {
  return Math.floor(lerp(min, max + 1, random()));
}

function scaleMap(value: number): number {
  return value * PROCEDURAL_MAP_SCALE;
}

export function normalizeVoxelMapSizeId(mapSize?: VoxelMapSizeId | string | null): VoxelMapSizeId {
  return VOXEL_MAP_SIZE_IDS.includes(mapSize as VoxelMapSizeId)
    ? mapSize as VoxelMapSizeId
    : DEFAULT_VOXEL_MAP_SIZE_ID;
}

export function getVoxelMapSizeDefinition(mapSize?: VoxelMapSizeId | string | null): VoxelMapSizeDefinition {
  return VOXEL_MAP_SIZE_DEFINITIONS[normalizeVoxelMapSizeId(mapSize)];
}

function distanceSq(xA: number, zA: number, xB: number, zB: number): number {
  const dx = xA - xB;
  const dz = zA - zB;
  return dx * dx + dz * dz;
}

function normalize(vector: Point2, fallback: Point2 = { x: 0, z: 1 }): Point2 {
  const length = Math.hypot(vector.x, vector.z);

  if (length < 0.0001) return fallback;

  return {
    x: vector.x / length,
    z: vector.z / length,
  };
}

function dot(pointA: Point2, pointB: Point2): number {
  return pointA.x * pointB.x + pointA.z * pointB.z;
}

function distanceToSegment(
  pointX: number,
  pointZ: number,
  startX: number,
  startZ: number,
  endX: number,
  endZ: number
): number {
  const dx = endX - startX;
  const dz = endZ - startZ;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq <= 0.0001) {
    return Math.sqrt(distanceSq(pointX, pointZ, startX, startZ));
  }

  const t = clamp(((pointX - startX) * dx + (pointZ - startZ) * dz) / lengthSq, 0, 1);
  return Math.sqrt(distanceSq(pointX, pointZ, startX + dx * t, startZ + dz * t));
}

function distanceToBoundary(worldX: number, worldZ: number, boundary: BoundaryPoint[]): number {
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < boundary.length; index++) {
    const start = boundary[index];
    const end = boundary[(index + 1) % boundary.length];
    closestDistance = Math.min(closestDistance, distanceToSegment(worldX, worldZ, start.x, start.z, end.x, end.z));
  }

  return closestDistance;
}

function isBoundarySafePoint(x: number, z: number, boundary: BoundaryPoint[], minBoundaryDistance: number): boolean {
  return isInsideBoundaryPolygon(x, z, boundary) && distanceToBoundary(x, z, boundary) >= minBoundaryDistance;
}

function createProceduralMapFootprint(
  seed: number,
  mapSize: VoxelMapSizeId,
  options: ProceduralCTFLayoutOptions = {}
): ProceduralMapFootprint {
  const random = mulberry32(seed ^ 0x793f7d9);
  const footprintScale = clamp(options.footprintScale ?? 1, 0.5, 1.5);
  const mapScale = getVoxelMapSizeDefinition(mapSize).scale * footprintScale;
  const sizeScale = lerp(0.98, 1.06, random());
  const xScale = lerp(0.96, 1.05, random());
  const zScale = lerp(0.96, 1.05, random());
  const requestedWorldSize = {
    x: PROCEDURAL_MAP_WORLD_SIZE.x * mapScale * sizeScale * xScale,
    y: PROCEDURAL_MAP_WORLD_SIZE.y,
    z: PROCEDURAL_MAP_WORLD_SIZE.z * mapScale * sizeScale * zScale,
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
    mapScale,
  };
}

function createProceduralBoundary(seed: number, worldSize: VoxelSize): BoundaryPoint[] {
  const random = mulberry32(seed ^ 0x2f6e2b1);
  const halfX = worldSize.x / 2;
  const halfZ = worldSize.z / 2;
  const margin = scaleMap(lerp(2.4, 4.6, random()));
  const pointCount = randomInt(random, 13, 16);
  const angleStep = (Math.PI * 2) / pointCount;
  const angleOffset = random() * Math.PI * 2;
  const waveA = lerp(0.025, 0.07, random());
  const waveB = lerp(0.015, 0.045, random());
  const waveC = lerp(0, 0.025, random());
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseC = random() * Math.PI * 2;
  const lobeFrequencyA = randomInt(random, 2, 4);
  const lobeFrequencyB = randomInt(random, 4, 6);
  const lobeFrequencyC = randomInt(random, 6, 8);
  const points: BoundaryPoint[] = [];

  for (let index = 0; index < pointCount; index++) {
    const angle = angleOffset + index * angleStep + lerp(-angleStep * 0.16, angleStep * 0.16, random());
    const unitX = Math.cos(angle);
    const unitZ = Math.sin(angle);
    const maxRadius = Math.min(
      (halfX - margin) / Math.max(0.08, Math.abs(unitX)),
      (halfZ - margin) / Math.max(0.08, Math.abs(unitZ))
    );
    const wave =
      Math.sin(angle * lobeFrequencyA + phaseA) * waveA +
      Math.sin(angle * lobeFrequencyB + phaseB) * waveB +
      Math.sin(angle * lobeFrequencyC + phaseC) * waveC;
    const notch = random() < 0.06 ? lerp(0.92, 0.98, random()) : 1;
    const outcrop = random() < 0.06 ? lerp(1.01, 1.04, random()) : 1;
    const radialScale = clamp(lerp(0.9, 1, random()) + wave, 0.86, 1) * notch * outcrop;
    const radius = clamp(maxRadius * radialScale, scaleMap(11), maxRadius);

    points.push({
      x: unitX * radius,
      z: unitZ * radius,
    });
  }

  return points.sort((pointA, pointB) => Math.atan2(pointA.z, pointA.x) - Math.atan2(pointB.z, pointB.x));
}

function snapHalfStep(value: number): number {
  return Math.round(value * 2) / 2;
}

function createFlagCandidates(worldSize: VoxelSize, boundary: BoundaryPoint[], minBoundaryDistance: number): Point2[] {
  const halfX = worldSize.x / 2;
  const halfZ = worldSize.z / 2;
  const candidates: Point2[] = [];
  const seen = new Set<string>();

  for (let x = -halfX + minBoundaryDistance; x <= halfX - minBoundaryDistance; x += FLAG_CANDIDATE_GRID_STEP) {
    for (let z = -halfZ + minBoundaryDistance; z <= halfZ - minBoundaryDistance; z += FLAG_CANDIDATE_GRID_STEP) {
      const candidate = {
        x: snapHalfStep(x),
        z: snapHalfStep(z),
      };
      const key = `${candidate.x}:${candidate.z}`;

      if (seen.has(key)) continue;
      if (!isBoundarySafePoint(candidate.x, candidate.z, boundary, minBoundaryDistance)) continue;

      seen.add(key);
      candidates.push(candidate);
    }
  }

  return candidates;
}

function getSpawnArcCandidate(flag: Point2, outward: Point2, arcAngle: number, radius: number): Point2 {
  const tangent = { x: -outward.z, z: outward.x };
  const angle = (arcAngle * Math.PI) / 180;

  return {
    x: snapHalfStep(flag.x + outward.x * Math.cos(angle) * radius + tangent.x * Math.sin(angle) * radius),
    z: snapHalfStep(flag.z + outward.z * Math.cos(angle) * radius + tangent.z * Math.sin(angle) * radius),
  };
}

function collectSpawnArc(
  random: (() => number) | null,
  boundary: BoundaryPoint[],
  flag: Point2,
  outward: Point2
): Point2[] {
  const spawns: Point2[] = [];

  for (let index = 0; index < SPAWN_ARC_ANGLES.length; index++) {
    const arcAngle = SPAWN_ARC_ANGLES[index];

    for (let attempts = 0; attempts < 28; attempts++) {
      const jitterDegrees = random && attempts > 0 ? lerp(-5.5, 5.5, random()) : 0;
      const centerBias = Math.abs(arcAngle) < 1 ? 0.3 : 0.7;
      const radius =
        Math.max(SPAWN_MIN_RADIUS, SPAWN_BASE_RADIUS + scaleMap(centerBias) - scaleMap(attempts * 0.12));
      const candidate = getSpawnArcCandidate(flag, outward, arcAngle + jitterDegrees, radius);
      const flagOffset = {
        x: candidate.x - flag.x,
        z: candidate.z - flag.z,
      };

      if (dot(flagOffset, outward) < scaleMap(1.6)) continue;
      if (!isBoundarySafePoint(candidate.x, candidate.z, boundary, SPAWN_BOUNDARY_DISTANCE)) continue;
      if (!spawns.every((spawn) => (spawn.x - candidate.x) ** 2 + (spawn.z - candidate.z) ** 2 >= 2.0 ** 2)) continue;

      spawns.push(candidate);
      break;
    }
  }

  for (let offset = 0; spawns.length < SPAWN_POINT_COUNT && offset < 18; offset++) {
    const direction = offset % 2 === 0 ? 1 : -1;
    const radius = Math.max(SPAWN_MIN_RADIUS, SPAWN_BASE_RADIUS - scaleMap(offset * 0.15));
    const candidate = getSpawnArcCandidate(flag, outward, direction * (28 + offset * 4), radius);
    const flagOffset = {
      x: candidate.x - flag.x,
      z: candidate.z - flag.z,
    };

    if (dot(flagOffset, outward) < scaleMap(1.4)) continue;
    if (!isBoundarySafePoint(candidate.x, candidate.z, boundary, SPAWN_BOUNDARY_DISTANCE)) continue;
    if (!spawns.every((spawn) => (spawn.x - candidate.x) ** 2 + (spawn.z - candidate.z) ** 2 >= 2.1 ** 2)) continue;

    spawns.push(candidate);
  }

  return spawns;
}

function canFitSpawnArc(boundary: BoundaryPoint[], flag: Point2, outward: Point2): boolean {
  return collectSpawnArc(null, boundary, flag, outward).length === SPAWN_POINT_COUNT;
}

function rankFlagPairs(candidates: Point2[], random: () => number): Array<{ a: Point2; b: Point2; score: number }> {
  const rankedPairs: Array<{ a: Point2; b: Point2; score: number }> = [];

  for (let indexA = 0; indexA < candidates.length; indexA++) {
    for (let indexB = indexA + 1; indexB < candidates.length; indexB++) {
      const a = candidates[indexA];
      const b = candidates[indexB];
      const pairDistanceSq = distanceSq(a.x, a.z, b.x, b.z);
      const score = pairDistanceSq + random() * 0.0001;

      if (rankedPairs.length < FLAG_PAIR_CANDIDATE_LIMIT) {
        rankedPairs.push({ a, b, score });
        rankedPairs.sort((pairA, pairB) => pairB.score - pairA.score);
        continue;
      }

      if (score <= rankedPairs[rankedPairs.length - 1].score) continue;

      rankedPairs[rankedPairs.length - 1] = { a, b, score };
      rankedPairs.sort((pairA, pairB) => pairB.score - pairA.score);
    }
  }

  return rankedPairs;
}

function orientFlagPair(a: Point2, b: Point2): FlagPair {
  if (a.z > b.z || (a.z === b.z && a.x >= b.x)) {
    return { red: a, blue: b };
  }

  return { red: b, blue: a };
}

function createFallbackFlagPair(worldSize: VoxelSize, boundary: BoundaryPoint[]): FlagPair {
  const halfX = worldSize.x / 2;
  const fallbackPairs: Array<[Point2, Point2]> = [
    [
      { x: -halfX * 0.36, z: 0 },
      { x: halfX * 0.36, z: 0 },
    ],
    [
      { x: 0, z: (worldSize.z / 2) * 0.42 },
      { x: 0, z: -(worldSize.z / 2) * 0.42 },
    ],
  ];

  for (const [a, b] of fallbackPairs) {
    if (isBoundarySafePoint(a.x, a.z, boundary, FLAG_BOUNDARY_DISTANCE) && isBoundarySafePoint(b.x, b.z, boundary, FLAG_BOUNDARY_DISTANCE)) {
      return orientFlagPair(a, b);
    }
  }

  return {
    red: { x: 0, z: scaleMap(12) },
    blue: { x: 0, z: -scaleMap(12) },
  };
}

function createFlagPair(random: () => number, worldSize: VoxelSize, boundary: BoundaryPoint[]): FlagPair {
  const candidates = createFlagCandidates(worldSize, boundary, FLAG_BOUNDARY_DISTANCE);
  const rankedPairs = rankFlagPairs(candidates, random);

  for (const pair of rankedPairs) {
    const oriented = orientFlagPair(pair.a, pair.b);
    const redOutward = normalize({ x: oriented.red.x - oriented.blue.x, z: oriented.red.z - oriented.blue.z });
    const blueOutward = normalize({ x: oriented.blue.x - oriented.red.x, z: oriented.blue.z - oriented.red.z });

    if (canFitSpawnArc(boundary, oriented.red, redOutward) && canFitSpawnArc(boundary, oriented.blue, blueOutward)) {
      return oriented;
    }
  }

  return rankedPairs.length > 0 ? orientFlagPair(rankedPairs[0].a, rankedPairs[0].b) : createFallbackFlagPair(worldSize, boundary);
}

function createLayoutSpawnCluster(
  random: () => number,
  boundary: BoundaryPoint[],
  flag: Point2,
  outward: Point2
): { x: number; y: number; z: number }[] {
  return collectSpawnArc(random, boundary, flag, outward).map((spawn) => ({
    x: spawn.x,
    y: 6,
    z: spawn.z,
  }));
}

export function createProceduralCTFLayout(
  seed = 0,
  mapSize?: VoxelMapSizeId | null,
  options: ProceduralCTFLayoutOptions = {}
): ProceduralCTFLayout {
  const normalizedMapSize = normalizeVoxelMapSizeId(mapSize);
  const footprint = createProceduralMapFootprint(seed, normalizedMapSize, options);
  const boundary = createProceduralBoundary(seed, footprint.worldSize);
  const flagRandom = mulberry32(seed ^ 0x51f15eed);
  const spawnRandom = mulberry32(seed ^ 0xbadc0de);
  const flagPair = createFlagPair(flagRandom, footprint.worldSize, boundary);
  const redOutward = normalize({ x: flagPair.red.x - flagPair.blue.x, z: flagPair.red.z - flagPair.blue.z });
  const blueOutward = normalize({ x: flagPair.blue.x - flagPair.red.x, z: flagPair.blue.z - flagPair.red.z });
  const redFlag = { x: flagPair.red.x, y: 5, z: flagPair.red.z };
  const blueFlag = { x: flagPair.blue.x, y: 5, z: flagPair.blue.z };

  return {
    mapSize: normalizedMapSize,
    mapScale: footprint.mapScale,
    origin: footprint.origin,
    voxelSize: PROCEDURAL_VOXEL_SIZE,
    size: footprint.size,
    chunkSize: PROCEDURAL_CHUNK_SIZE,
    spawnPoints: {
      red: createLayoutSpawnCluster(spawnRandom, boundary, redFlag, redOutward),
      blue: createLayoutSpawnCluster(spawnRandom, boundary, blueFlag, blueOutward),
    },
    flagZones: {
      red: redFlag,
      blue: blueFlag,
    },
    boundary,
  };
}
