import { getBlockId, getBlockNumericId, isCollisionBlock, isSolidBlock } from './blocks.js';
import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_HEIGHT } from '../../constants/physics.js';
import {
  BUILDING_DIRECTIONS,
  BUILDING_INTENT_DEFINITIONS,
  createBuildingPlan,
  type BuildingDirection,
  type BuildingFootprintCell,
  type BuildingIntentId,
  type BuildingOpening,
  type BuildingPlan,
  type BuildingPlanMetrics,
  type BuildingValidationResult,
  type BuildingVolume,
} from './buildingPlans.js';
import { getClosestBoundaryPoint, isInsideBoundaryPolygon } from './boundaries.js';
import { generateVoxelColliders } from './colliders.js';
import { createProceduralCTFLayout, PROCEDURAL_MAP_SCALE, PROCEDURAL_VOXEL_SIZE } from './ctfLayout.js';
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

interface TerrainPathPoint {
  x: number;
  z: number;
}

interface VolcanicCrater {
  x: number;
  z: number;
  radius: number;
  innerRadius: number;
  seed: number;
}

interface GridDirection {
  dx: -1 | 0 | 1;
  dz: -1 | 0 | 1;
}

interface TreeLeafCluster {
  centerX: number;
  centerY: number;
  centerZ: number;
  radiusX: number;
  radiusY: number;
  radiusZ: number;
  seed: number;
  minY: number;
}

const TREE_BRANCH_DIRECTIONS: GridDirection[] = [
  { dx: 1, dz: 0 },
  { dx: 1, dz: 1 },
  { dx: 0, dz: 1 },
  { dx: -1, dz: 1 },
  { dx: -1, dz: 0 },
  { dx: -1, dz: -1 },
  { dx: 0, dz: -1 },
  { dx: 1, dz: -1 },
];

export interface ProceduralBuildingDiagnosticEntry {
  seed: number;
  intent: BuildingIntentId;
  center: { x: number; z: number };
  radius: number;
  accepted: boolean;
  reasons: string[];
  signature: string;
  metrics: BuildingPlanMetrics;
}

export interface ProceduralBuildingGenerationDiagnostics {
  attempted: number;
  accepted: number;
  rejected: number;
  byIntent: Record<BuildingIntentId, { attempted: number; accepted: number; rejected: number }>;
  rejectionReasons: Record<string, number>;
  acceptedPlans: ProceduralBuildingDiagnosticEntry[];
  rejectedPlans: ProceduralBuildingDiagnosticEntry[];
}

export interface ProceduralVoxelMapDiagnostics {
  seed: number;
  themeId: VoxelMapTheme['id'];
  buildings: ProceduralBuildingGenerationDiagnostics;
}

export interface ProceduralVoxelMapGenerationResult {
  manifest: VoxelMapManifest;
  diagnostics: ProceduralVoxelMapDiagnostics;
}

const SPAWN_CLEARANCE = 0;
const SPAWN_PAD_RADIUS = 1.45;
const SPAWN_BLEND_RADIUS = 4.85;
const SPAWN_CLEAR_RADIUS = 3.6;
const FLAG_CLEAR_RADIUS = 4.3;
const SPAWN_SIGHTLINE_EYE_OFFSET = PLAYER_HEIGHT / 2 + 0.75;
const FEATURE_WORLD_SCALE = PROCEDURAL_MAP_SCALE;
const FEATURE_COUNT_SCALE = 0.56;
const SIGHTLINE_BARRIER_BASE_HEIGHT = 8;
const SIGHTLINE_BARRIER_EXTRA_HEIGHT = 6;
const TERRAIN_SMOOTHING_PASSES = 2;
const MAX_NAVIGATION_STEP_ROWS = 2;
const UNSAFE_GROOVE_MAX_WIDTH_CELLS = Math.max(
  1,
  Math.ceil((PLAYER_RADIUS * 2) / Math.min(PROCEDURAL_VOXEL_SIZE.x, PROCEDURAL_VOXEL_SIZE.z)) - 1
);
const UNSAFE_GROOVE_SEAL_PASSES = Math.max(8, UNSAFE_GROOVE_MAX_WIDTH_CELLS * 6);
const UNSAFE_BASIN_MAX_AREA_CELLS = Math.max(144, (UNSAFE_GROOVE_MAX_WIDTH_CELLS + 9) ** 2);
const UNSAFE_BASIN_MIN_HIGH_EDGE_RATIO = 0.55;
const BOUNDARY_SEAM_SEAL_THICKNESS = PLAYER_RADIUS + PROCEDURAL_VOXEL_SIZE.x * 3;
const BOUNDARY_SEAM_SAMPLE_RADIUS_CELLS = Math.max(2, Math.ceil((PLAYER_RADIUS * 2) / PROCEDURAL_VOXEL_SIZE.x));
const BOUNDARY_WALL_THICKNESS = 3.1 * FEATURE_WORLD_SCALE;
const BOUNDARY_SURFACE_THICKNESS = 3.8 * FEATURE_WORLD_SCALE;
const BOUNDARY_EDGE_ROCK_MIN_INFLUENCE = 0.18;
const BOUNDARY_OUTCROP_MIN_INFLUENCE = 0.28;
const FEATURE_ENTRANCE_HEADROOM = 1.1;
const FEATURE_ENTRANCE_CLEARANCE_ROWS = Math.max(
  1,
  Math.ceil((PLAYER_HEIGHT + FEATURE_ENTRANCE_HEADROOM) / PROCEDURAL_VOXEL_SIZE.y)
);
const BUILDING_WALKTHROUGH_CLEARANCE_ROWS = FEATURE_ENTRANCE_CLEARANCE_ROWS + 2;
const BUILDING_ENTRANCE_INWARD_CELLS = 6;
const BUILDING_RAMP_MAX_STEP_ROWS = Math.max(1, Math.floor(STEP_HEIGHT / PROCEDURAL_VOXEL_SIZE.y) - 1);
const STRUCTURE_ENTRANCE_HALF_WIDTH_CELLS = 3;
const CAVE_ENTRANCE_HALF_WIDTH_CELLS = 3;
const FEATURE_APPROACH_WORLD_LENGTH = 4.5 * FEATURE_WORLD_SCALE;
const BUILDING_APPROACH_WORLD_LENGTH = FEATURE_APPROACH_WORLD_LENGTH * 1.35;
const BUILDING_PLAN_RETRY_COUNT = 4;

function createBuildingDiagnostics(): ProceduralBuildingGenerationDiagnostics {
  const byIntent = Object.fromEntries(
    (Object.keys(BUILDING_INTENT_DEFINITIONS) as BuildingIntentId[]).map((intent) => [
      intent,
      { attempted: 0, accepted: 0, rejected: 0 },
    ])
  ) as Record<BuildingIntentId, { attempted: number; accepted: number; rejected: number }>;

  return {
    attempted: 0,
    accepted: 0,
    rejected: 0,
    byIntent,
    rejectionReasons: {},
    acceptedPlans: [],
    rejectedPlans: [],
  };
}

function createProceduralVoxelMapDiagnostics(seed: number, themeId: VoxelMapTheme['id']): ProceduralVoxelMapDiagnostics {
  return {
    seed,
    themeId,
    buildings: createBuildingDiagnostics(),
  };
}

function recordBuildingDiagnostic(
  diagnostics: ProceduralVoxelMapDiagnostics | undefined,
  plan: BuildingPlan,
  validation: BuildingValidationResult,
  accepted: boolean
): void {
  if (!diagnostics) return;

  const entry: ProceduralBuildingDiagnosticEntry = {
    seed: plan.seed,
    intent: plan.intent,
    center: plan.center,
    radius: plan.radius,
    accepted,
    reasons: validation.reasons,
    signature: plan.signature,
    metrics: validation.metrics,
  };

  diagnostics.buildings.attempted++;
  diagnostics.buildings.byIntent[plan.intent].attempted++;

  if (accepted) {
    diagnostics.buildings.accepted++;
    diagnostics.buildings.byIntent[plan.intent].accepted++;
    diagnostics.buildings.acceptedPlans.push(entry);
    return;
  }

  diagnostics.buildings.rejected++;
  diagnostics.buildings.byIntent[plan.intent].rejected++;
  if (diagnostics.buildings.rejectedPlans.length < 160) {
    diagnostics.buildings.rejectedPlans.push(entry);
  }

  for (const reason of validation.reasons.length > 0 ? validation.reasons : ['unknown']) {
    diagnostics.buildings.rejectionReasons[reason] = (diagnostics.buildings.rejectionReasons[reason] ?? 0) + 1;
  }
}

function chunkIndex(x: number, y: number, z: number, size: VoxelSize): number {
  return x + size.x * (z + size.z * y);
}

function isTreeBlock(blockId: number): boolean {
  const block = getBlockId(blockId);
  return block === 'wood' || block === 'leaves' || block === 'blossom_leaves' || block === 'bamboo';
}

function hasTreeBlockNearColumn(
  blocks: Uint8Array,
  size: VoxelSize,
  centerX: number,
  centerZ: number,
  minY: number,
  maxY: number,
  radius: number
): boolean {
  const x0 = clamp(centerX - radius, 0, size.x - 1);
  const x1 = clamp(centerX + radius, 0, size.x - 1);
  const z0 = clamp(centerZ - radius, 0, size.z - 1);
  const z1 = clamp(centerZ + radius, 0, size.z - 1);
  const y0 = clamp(minY, 0, size.y - 1);
  const y1 = clamp(maxY, 0, size.y - 1);

  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        if (isTreeBlock(blocks[chunkIndex(x, y, z, size)])) {
          return true;
        }
      }
    }
  }

  return false;
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

function scaleWorld(value: number): number {
  return value * FEATURE_WORLD_SCALE;
}

function scaleCount(baseCount: number, randomBonus: number, random: () => number, minCount = 1): number {
  return Math.max(minCount, Math.floor(baseCount * FEATURE_COUNT_SCALE) + Math.floor(random() * Math.max(1, Math.round(randomBonus * FEATURE_COUNT_SCALE))));
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

function getBoundaryInfluence(boundaryDistance: number, thickness = BOUNDARY_SURFACE_THICKNESS): number {
  return clamp(1 - boundaryDistance / thickness, 0, 1);
}

function getBoundaryHeightLift(seed: number, worldX: number, worldZ: number, boundaryDistance: number): number {
  const influence = getBoundaryInfluence(boundaryDistance, scaleWorld(5.6));
  if (influence <= 0) return 0;

  const broadNoise = fractalNoise2(seed ^ 0x74d2f3a1, worldX * 0.048, worldZ * 0.048, 4);
  const erosionNoise = fractalNoise2(seed ^ 0x2c1b3c6d, worldX * 0.17, worldZ * 0.17, 2);
  const raisedShelf = Math.pow(Math.max(0, broadNoise - 0.58) / 0.42, 1.35) * scaleWorld(1.9);
  const erodedCut = Math.pow(Math.max(0, 0.44 - erosionNoise) / 0.44, 1.15) * scaleWorld(0.85);

  return Math.pow(influence, 0.92) * (raisedShelf - erodedCut);
}

function hasBoundaryRockSurface(seed: number, worldX: number, worldZ: number, boundaryDistance: number): boolean {
  const influence = getBoundaryInfluence(boundaryDistance);
  if (influence < BOUNDARY_EDGE_ROCK_MIN_INFLUENCE) return false;

  const broadNoise = fractalNoise2(seed ^ 0xb4b82e39, worldX * 0.072, worldZ * 0.072, 4);
  const chipNoise = fractalNoise2(seed ^ 0x51f15e7d, worldX * 0.24, worldZ * 0.24, 2);
  const brokenEdge = broadNoise * 0.72 + chipNoise * 0.28;
  const threshold = lerp(0.72, 0.46, influence);

  return brokenEdge > threshold;
}

function getBoundaryOutcropRows(
  seed: number,
  worldX: number,
  worldZ: number,
  boundaryDistance: number,
  maxRows: number
): number {
  const influence = getBoundaryInfluence(boundaryDistance);
  if (influence < BOUNDARY_OUTCROP_MIN_INFLUENCE) return 0;

  const broadNoise = fractalNoise2(seed ^ 0x8f2d33ab, worldX * 0.052, worldZ * 0.052, 4);
  const splitNoise = fractalNoise2(seed ^ 0xd1b54a35, worldX * 0.19, worldZ * 0.19, 2);
  const outcropNoise = broadNoise * 0.78 + splitNoise * 0.22;
  const threshold = lerp(0.82, 0.61, influence);
  if (outcropNoise <= threshold) return 0;

  const amount = Math.pow((outcropNoise - threshold) / (1 - threshold), 0.84);
  return Math.max(1, Math.round(maxRows * Math.pow(influence, 0.75) * lerp(0.24, 0.88, amount)));
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
    if (distanceSq(worldX, worldZ, flag.x, flag.z) < (radius + scaleWorld(8)) ** 2) return true;
  }

  for (const spawn of [...layout.spawnPoints.red, ...layout.spawnPoints.blue]) {
    if (distanceSq(worldX, worldZ, spawn.x, spawn.z) < (radius + scaleWorld(7)) ** 2) return true;
  }

  return false;
}

function isNearFlagGameplayArea(
  layout: ReturnType<typeof createProceduralCTFLayout>,
  worldX: number,
  worldZ: number,
  radius: number
): boolean {
  for (const flag of [layout.flagZones.red, layout.flagZones.blue]) {
    if (distanceSq(worldX, worldZ, flag.x, flag.z) < (radius + scaleWorld(7.5)) ** 2) return true;
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

function createVolcanicCraters(
  layout: ReturnType<typeof createProceduralCTFLayout>,
  random: () => number,
  seed: number
): VolcanicCrater[] {
  const boundaryRange = getBoundaryRange(layout.boundary);
  const halfPlayableX = Math.min(scaleWorld(28), Math.max(scaleWorld(12), (boundaryRange.maxX - boundaryRange.minX) * 0.5 - scaleWorld(7)));
  const halfPlayableZ = Math.min(scaleWorld(22), Math.max(scaleWorld(10), (boundaryRange.maxZ - boundaryRange.minZ) * 0.5 - scaleWorld(7)));
  const craterCount = 1 + (random() > 0.72 ? 1 : 0);
  const craters: VolcanicCrater[] = [];

  for (let attempts = 0; attempts < 80 && craters.length < craterCount; attempts++) {
    const centerX = lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radius = scaleWorld(lerp(8.5, 15.5, random()));
    if (!isInsideBoundaryPolygon(centerX, centerZ, layout.boundary)) continue;
    if (distanceToBoundary(centerX, centerZ, layout.boundary) < radius + scaleWorld(4.5)) continue;
    if (isNearProtectedGameplayArea(layout, centerX, centerZ, radius + scaleWorld(2.5))) continue;

    let overlaps = false;
    for (const crater of craters) {
      if (distanceSq(centerX, centerZ, crater.x, crater.z) < (radius + crater.radius + scaleWorld(8)) ** 2) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) continue;

    craters.push({
      x: centerX,
      z: centerZ,
      radius,
      innerRadius: radius * lerp(0.18, 0.28, random()),
      seed: seed ^ Math.floor(random() * 0xffffffff),
    });
  }

  if (craters.length === 0) {
    craters.push({
      x: scaleWorld(lerp(-10, 10, random())),
      z: scaleWorld(lerp(-8, 8, random())),
      radius: scaleWorld(11),
      innerRadius: scaleWorld(2.5),
      seed: seed ^ 0xca1de2a,
    });
  }

  return craters;
}

function applyVolcanicLandforms(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  craters: VolcanicCrater[],
  minRows: number,
  maxRows: number
): void {
  for (const crater of craters) {
    const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
      origin,
      size,
      crater.x - crater.radius * 1.45,
      crater.x + crater.radius * 1.45,
      crater.z - crater.radius * 1.45,
      crater.z + crater.radius * 1.45
    );
    const coneRows = worldHeightToGridRows(scaleWorld(5.4 + (crater.seed & 3) * 0.7));
    const rimRows = worldHeightToGridRows(scaleWorld(2.4 + ((crater.seed >>> 3) & 3) * 0.35));
    const craterDepthRows = worldHeightToGridRows(scaleWorld(3.6 + ((crater.seed >>> 7) & 3) * 0.45));

    for (let x = gx0; x <= gx1; x++) {
      for (let z = gz0; z <= gz1; z++) {
        const worldX = gridToWorldCenter(x, origin.x);
        const worldZ = gridToWorldCenter(z, origin.z);
        const distance = Math.sqrt(distanceSq(worldX, worldZ, crater.x, crater.z));
        const radial = distance / crater.radius;
        if (radial > 1.45) continue;

        const ridgeNoise = fractalNoise2(crater.seed, worldX * 0.11, worldZ * 0.11, 3);
        const lavaChannelNoise = fractalNoise2(crater.seed ^ 0x51a6b00d, worldX * 0.18, worldZ * 0.18, 3);
        const apron = radial > 1 ? Math.max(0, 1.45 - radial) * worldHeightToGridRows(scaleWorld(1.2)) : 0;
        const cone = radial <= 1 ? Math.pow(1 - radial, 0.72) * coneRows * lerp(0.84, 1.16, ridgeNoise) : apron;
        const rim = Math.max(0, 1 - Math.abs(radial - 0.31) / 0.13) * rimRows * lerp(0.8, 1.22, ridgeNoise);
        const craterCut = radial < 0.32
          ? Math.pow(1 - radial / 0.32, 0.56) * craterDepthRows * lerp(0.86, 1.2, lavaChannelNoise)
          : 0;
        const channelCut = radial > 0.32 && radial < 1.18 && lavaChannelNoise > 0.78
          ? worldHeightToGridRows(scaleWorld(0.8)) * (lavaChannelNoise - 0.78) * 4.2
          : 0;
        const delta = Math.round(cone + rim - craterCut - channelCut);
        if (delta === 0) continue;

        const index = x + z * size.x;
        heightMap[index] = clamp(heightMap[index] + delta, minRows, maxRows);
      }
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
  const halfPlayableX = Math.min(scaleWorld(29), Math.max(scaleWorld(14), (boundaryRange.maxX - boundaryRange.minX) * 0.5 - scaleWorld(5)));
  const halfPlayableZ = Math.min(scaleWorld(23), Math.max(scaleWorld(11), (boundaryRange.maxZ - boundaryRange.minZ) * 0.5 - scaleWorld(5)));
  const hillCount = 4 + Math.floor(random() * 4);
  const valleyCount = 2 + Math.floor(random() * 3);
  const ravineCount = 1 + Math.floor(random() * 2);

  for (let i = 0; i < hillCount; i++) {
    const centerX = lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = scaleWorld(lerp(6.5, 15.5, random()));
    const radiusZ = scaleWorld(lerp(5.8, 14.5, random()));
    const deltaRows = worldHeightToGridRows(scaleWorld(lerp(0.8, 2.8, random())));
    const featureSeed = seed ^ Math.floor(random() * 0xffffffff);

    applyEllipticalHeightDelta(heightMap, origin, size, centerX, centerZ, radiusX, radiusZ, deltaRows, minRows, maxRows, featureSeed);
  }

  for (let i = 0; i < valleyCount; i++) {
    const centerX = lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = scaleWorld(lerp(7, 16.5, random()));
    const radiusZ = scaleWorld(lerp(6.5, 15, random()));
    const deltaRows = -worldHeightToGridRows(scaleWorld(lerp(0.7, 2.4, random())));
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
      scaleWorld(lerp(4.8, 8.8, random())),
      worldHeightToGridRows(scaleWorld(lerp(0.8, 2.4, random()))),
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
        if (distanceToBoundary(worldX, worldZ, layout.boundary) < scaleWorld(3)) continue;

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

function createOrganicRoutePath(
  start: TerrainPathPoint,
  end: TerrainPathPoint,
  featureSeed: number,
  maxOffset: number,
  pointCount = 5
): TerrainPathPoint[] {
  const random = mulberry32(featureSeed);
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < PROCEDURAL_VOXEL_SIZE.x) return [start, end];

  const normal = { x: -dz / length, z: dx / length };
  const tangent = { x: dx / length, z: dz / length };
  const phase = random() * Math.PI * 2;
  const waveFrequency = lerp(0.72, 1.45, random());
  const bias = lerp(-maxOffset * 0.38, maxOffset * 0.38, random());
  const points: TerrainPathPoint[] = [];

  for (let index = 0; index < pointCount; index++) {
    const t = pointCount === 1 ? 0 : index / (pointCount - 1);
    if (index === 0) {
      points.push(start);
      continue;
    }
    if (index === pointCount - 1) {
      points.push(end);
      continue;
    }

    const envelope = Math.sin(t * Math.PI);
    const noise = fractalNoise2(featureSeed ^ 0x5bd1e995, t * 3.8, featureSeed * 0.00017, 3) - 0.5;
    const lateralOffset =
      (Math.sin(t * Math.PI * 2 * waveFrequency + phase) * 0.56 + noise * 0.92) * maxOffset * envelope +
      bias * envelope;
    const alongOffset = lerp(-maxOffset * 0.16, maxOffset * 0.16, random()) * envelope;
    const baseX = lerp(start.x, end.x, t);
    const baseZ = lerp(start.z, end.z, t);

    points.push({
      x: baseX + normal.x * lateralOffset + tangent.x * alongOffset,
      z: baseZ + normal.z * lateralOffset + tangent.z * alongOffset,
    });
  }

  return points;
}

function getPathBounds(path: TerrainPathPoint[], padding: number): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return {
    minX: Math.min(...path.map((point) => point.x)) - padding,
    maxX: Math.max(...path.map((point) => point.x)) + padding,
    minZ: Math.min(...path.map((point) => point.z)) - padding,
    maxZ: Math.max(...path.map((point) => point.z)) + padding,
  };
}

function getClosestPathSample(
  pointX: number,
  pointZ: number,
  path: TerrainPathPoint[],
  segmentLengths: number[],
  totalLength: number
): { distance: number; pathT: number; segmentIndex: number; segmentT: number } {
  let closest = {
    distance: Number.POSITIVE_INFINITY,
    pathT: 0,
    segmentIndex: 0,
    segmentT: 0,
  };
  let traversed = 0;

  for (let index = 0; index < path.length - 1; index++) {
    const start = path[index];
    const end = path[index + 1];
    const sample = distanceToSegment(pointX, pointZ, start.x, start.z, end.x, end.z);
    const segmentLength = segmentLengths[index];
    const pathT = totalLength <= 0 ? 0 : clamp((traversed + sample.t * segmentLength) / totalLength, 0, 1);

    if (sample.distance < closest.distance) {
      closest = {
        distance: sample.distance,
        pathT,
        segmentIndex: index,
        segmentT: sample.t,
      };
    }

    traversed += segmentLength;
  }

  return closest;
}

function blendHeightPath(
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  path: TerrainPathPoint[],
  width: number,
  strength: number,
  featureSeed: number,
  boundary?: BoundaryPoint[]
): void {
  if (path.length < 2) return;

  const bounds = getPathBounds(path, width * 1.3);
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    bounds.minX,
    bounds.maxX,
    bounds.minZ,
    bounds.maxZ
  );
  const pathHeights = path.map((point) => getHeightAt(heightMap, origin, size, point.x, point.z));
  const segmentLengths = path.slice(0, -1).map((point, index) => {
    const next = path[index + 1];
    return Math.hypot(next.x - point.x, next.z - point.z);
  });
  const totalLength = segmentLengths.reduce((total, length) => total + length, 0);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (boundary && !isInsideBoundaryPolygon(worldX, worldZ, boundary)) continue;

      const widthNoise = fractalNoise2(featureSeed ^ 0x27d4eb2d, worldX * 0.15, worldZ * 0.15, 2);
      const localWidth = width * lerp(0.72, 1.24, widthNoise);
      const sample = getClosestPathSample(worldX, worldZ, path, segmentLengths, totalLength);
      if (sample.distance > localWidth) continue;

      const index = x + z * size.x;
      const centerWidth = localWidth * lerp(0.24, 0.44, widthNoise);
      const falloffWidth = Math.max(PROCEDURAL_VOXEL_SIZE.x, localWidth - centerWidth);
      const centerBlend = sample.distance <= centerWidth ? 1 : 1 - (sample.distance - centerWidth) / falloffWidth;
      const routeNoise = fractalNoise2(featureSeed ^ 0x165667b1, worldX * 0.31, worldZ * 0.31, 2);
      const featheredBlend = centerBlend * centerBlend * (3 - centerBlend * 2);
      const targetHeight = lerp(
        pathHeights[sample.segmentIndex],
        pathHeights[sample.segmentIndex + 1],
        sample.segmentT
      );
      heightMap[index] = clamp(
        Math.round(lerp(heightMap[index], targetHeight, clamp(featheredBlend * strength * lerp(0.68, 1.04, routeNoise), 0, 1))),
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
  layout: ReturnType<typeof createProceduralCTFLayout>,
  seed: number
): void {
  const redSpawnCenter = getAveragePoint(layout.spawnPoints.red);
  const blueSpawnCenter = getAveragePoint(layout.spawnPoints.blue);
  const midfield = { x: 0, z: 0 };

  blendHeightPath(
    heightMap,
    origin,
    size,
    createOrganicRoutePath(redSpawnCenter, layout.flagZones.red, seed ^ 0x835c0a2d, scaleWorld(1.5), 4),
    scaleWorld(4.5),
    0.82,
    seed ^ 0xf00d1111,
    layout.boundary
  );
  blendHeightPath(
    heightMap,
    origin,
    size,
    createOrganicRoutePath(blueSpawnCenter, layout.flagZones.blue, seed ^ 0x91e10da5, scaleWorld(1.5), 4),
    scaleWorld(4.5),
    0.82,
    seed ^ 0xf00d2222,
    layout.boundary
  );
  blendHeightPath(
    heightMap,
    origin,
    size,
    createOrganicRoutePath(layout.flagZones.red, midfield, seed ^ 0x45d9f3b, scaleWorld(2.1), 5),
    scaleWorld(5.2),
    0.72,
    seed ^ 0xf00d3333,
    layout.boundary
  );
  blendHeightPath(
    heightMap,
    origin,
    size,
    createOrganicRoutePath(layout.flagZones.blue, midfield, seed ^ 0x119de1f3, scaleWorld(2.1), 5),
    scaleWorld(5.2),
    0.72,
    seed ^ 0xf00d4444,
    layout.boundary
  );
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

  for (let y = safeTopY + 1; y <= Math.min(size.y - 1, safeTopY + clearanceRows + 1); y++) {
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
  const requestedTotalDistance = insideDistance + approachDistance;
  const requestedEndX = centerX + direction.dx * requestedTotalDistance;
  const requestedEndZ = centerZ + direction.dz * requestedTotalDistance;
  const requestedEndGridX = clamp(worldToGrid(requestedEndX, origin.x), 1, size.x - 2);
  const requestedEndGridZ = clamp(worldToGrid(requestedEndZ, origin.z), 1, size.z - 2);
  const requestedEndTopY = Math.max(1, heightMap[requestedEndGridX + requestedEndGridZ * size.x] - 1);
  const verticalDeltaRows = Math.abs(floorY - requestedEndTopY);
  const effectiveApproachDistance = Math.max(
    approachDistance,
    Math.min(approachDistance * 2.1, verticalDeltaRows * PROCEDURAL_VOXEL_SIZE.x * 1.35)
  );
  const totalDistance = insideDistance + effectiveApproachDistance;
  const steps = Math.max(1, Math.ceil(totalDistance / PROCEDURAL_VOXEL_SIZE.x));
  let previousTopY = floorY;

  for (let step = 0; step <= steps; step++) {
    const distance = step * PROCEDURAL_VOXEL_SIZE.x;
    const outsideT = clamp((distance - insideDistance) / Math.max(PROCEDURAL_VOXEL_SIZE.x, effectiveApproachDistance), 0, 1);
    const smoothT = outsideT * outsideT * (3 - outsideT * 2);
    const centerWorldX = centerX + direction.dx * distance;
    const centerWorldZ = centerZ + direction.dz * distance;
    const centerGridX = clamp(worldToGrid(centerWorldX, origin.x), 1, size.x - 2);
    const centerGridZ = clamp(worldToGrid(centerWorldZ, origin.z), 1, size.z - 2);
    const baseTopY = Math.max(1, heightMap[centerGridX + centerGridZ * size.x] - 1);
    const rawTopY = Math.round(lerp(floorY, baseTopY, smoothT));
    const rampTopY = step === 0
      ? floorY
      : clamp(rawTopY, previousTopY - BUILDING_RAMP_MAX_STEP_ROWS, previousTopY + BUILDING_RAMP_MAX_STEP_ROWS);
    previousTopY = rampTopY;

    for (let side = -halfWidthCells; side <= halfWidthCells; side++) {
      const worldX =
        centerWorldX +
        sideX * side * PROCEDURAL_VOXEL_SIZE.x;
      const worldZ =
        centerWorldZ +
        sideZ * side * PROCEDURAL_VOXEL_SIZE.z;
      const x = clamp(worldToGrid(worldX, origin.x), 1, size.x - 2);
      const z = clamp(worldToGrid(worldZ, origin.z), 1, size.z - 2);
      stampWalkableColumn(setBlock, heightMap, size, x, z, rampTopY, floorBlock, clearanceRows);
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
  height: number,
  blockId: VoxelBlockId = 'stone'
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
        setBlock(x, y, z, blockId);
      }
    }
  }
}

function stampTreeTrunk(
  setBlock: BlockSetter,
  x: number,
  baseY: number,
  z: number,
  trunkHeight: number
): void {
  const trunkTopY = baseY + trunkHeight;

  for (let y = baseY; y <= trunkTopY; y++) {
    setBlock(x, y, z, 'wood');
  }
}

function getStepToward(value: number): -1 | 0 | 1 {
  return value === 0 ? 0 : value > 0 ? 1 : -1;
}

function stampTreeBranchStub(setBlock: BlockSetter, trunkX: number, trunkZ: number, cluster: TreeLeafCluster): void {
  const dx = getStepToward(cluster.centerX - trunkX);
  const dz = getStepToward(cluster.centerZ - trunkZ);
  if (dx === 0 && dz === 0) return;

  const y = Math.max(cluster.minY, cluster.centerY - Math.max(1, cluster.radiusY));
  setBlock(trunkX + dx, y, trunkZ + dz, 'wood');
}

function stampLeafCluster(setBlock: BlockSetter, cluster: TreeLeafCluster, leafBlock: VoxelBlockId): void {
  for (let dy = -cluster.radiusY; dy <= cluster.radiusY; dy++) {
    const leafY = cluster.centerY + dy;
    if (leafY < cluster.minY) continue;

    for (let dx = -cluster.radiusX; dx <= cluster.radiusX; dx++) {
      for (let dz = -cluster.radiusZ; dz <= cluster.radiusZ; dz++) {
        const nx = dx / Math.max(1, cluster.radiusX);
        const ny = dy / Math.max(1, cluster.radiusY);
        const nz = dz / Math.max(1, cluster.radiusZ);
        const distance = nx * nx + nz * nz + ny * ny * 0.82;
        const leafNoise = fractalNoise2(
          cluster.seed,
          (cluster.centerX + dx) * 0.47,
          (cluster.centerZ + dz + leafY * 0.19) * 0.47,
          2
        );
        const core = distance < 0.62;
        const edge = distance < 1.02 + leafNoise * 0.22 && leafNoise > 0.24;
        const lowerTuft = dy < 0 && distance < 0.92 && leafNoise > 0.18;

        if (!core && !edge && !lowerTuft) continue;

        setBlock(cluster.centerX + dx, leafY, cluster.centerZ + dz, leafBlock);
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
  featureSeed: number,
  leafBlock: VoxelBlockId = 'leaves'
): void {
  const x = clamp(worldToGrid(worldX, origin.x), 1, size.x - 2);
  const z = clamp(worldToGrid(worldZ, origin.z), 1, size.z - 2);
  const baseY = heightMap[x + z * size.x];
  const style = featureSeed % 4;
  const random = mulberry32(featureSeed ^ 0xa511e9b3);
  const trunkTopY = baseY + trunkHeight;
  const minLeafY = baseY + Math.ceil((PLAYER_HEIGHT + 0.45) / PROCEDURAL_VOXEL_SIZE.y);
  const branchStartOffset = Math.max(
    2,
    Math.min(
      trunkHeight - 2,
      Math.max(Math.floor(trunkHeight * 0.52), minLeafY - baseY)
    )
  );
  const branchVerticalSpan = Math.max(1, trunkHeight - branchStartOffset - 1);
  const baseBranchLength = worldDistanceToGridCells(scaleWorld(style === 3 ? 1.35 : 1.15));
  const branchCount = 3 + (featureSeed % 2) + (style === 3 ? 1 : 0);
  const directionOffset = Math.floor(random() * TREE_BRANCH_DIRECTIONS.length);
  const clusters: TreeLeafCluster[] = [];

  for (let i = 0; i < branchCount; i++) {
    const verticalAmount = branchCount === 1 ? 0 : i / (branchCount - 1);
    const direction = TREE_BRANCH_DIRECTIONS[(directionOffset + i * 2 + Math.floor(i / 3)) % TREE_BRANCH_DIRECTIONS.length];
    const diagonal = direction.dx !== 0 && direction.dz !== 0;
    const styleStretch =
      style === 1 && direction.dx !== 0 ? 2 :
      style === 2 && direction.dz !== 0 ? 2 :
      style === 3 ? 1 :
      0;
    const branchLength = Math.max(
      3,
      baseBranchLength +
        styleStretch +
        Math.floor(random() * 3) -
        (diagonal ? 1 : 0) -
        Math.floor(verticalAmount * 1.5)
    );
    const lateralJitter = random() < 0.52 ? (random() < 0.5 ? -1 : 1) : 0;
    const startY = baseY + branchStartOffset + Math.floor(verticalAmount * branchVerticalSpan);
    const endX = x + direction.dx * branchLength + (direction.dz !== 0 ? lateralJitter : 0);
    const endZ = z + direction.dz * branchLength + (direction.dx !== 0 ? -lateralJitter : 0);
    const endY = startY + 1 + Math.floor(random() * 3) + Math.floor(verticalAmount * 2);
    const branchSeed = featureSeed ^ Math.imul(i + 1, 0x7feb352d);

    clusters.push({
      centerX: endX,
      centerY: endY + Math.floor(random() * 2),
      centerZ: endZ,
      radiusX: worldDistanceToGridCells(scaleWorld(0.58 + random() * 0.24 + (direction.dx !== 0 ? 0.08 : 0))),
      radiusY: worldHeightToGridRows(scaleWorld(0.5 + random() * 0.2)),
      radiusZ: worldDistanceToGridCells(scaleWorld(0.58 + random() * 0.24 + (direction.dz !== 0 ? 0.08 : 0))),
      seed: branchSeed,
      minY: minLeafY,
    });

    if (branchLength <= 4 || random() > 0.58) continue;

    const side = random() < 0.5 ? -1 : 1;
    const forkDirection: GridDirection = {
      dx: (direction.dz * side) as -1 | 0 | 1,
      dz: (-direction.dx * side) as -1 | 0 | 1,
    };
    const forkLength = Math.max(2, Math.floor(branchLength * 0.44));
    const forkStartX = Math.round(lerp(x, endX, 0.58));
    const forkStartY = Math.round(lerp(startY, endY, 0.58));
    const forkStartZ = Math.round(lerp(z, endZ, 0.58));
    const forkEndX = forkStartX + forkDirection.dx * forkLength;
    const forkEndZ = forkStartZ + forkDirection.dz * forkLength;
    const forkEndY = forkStartY + 1 + Math.floor(random() * 2);

    clusters.push({
      centerX: forkEndX,
      centerY: forkEndY,
      centerZ: forkEndZ,
      radiusX: worldDistanceToGridCells(scaleWorld(0.48 + random() * 0.16)),
      radiusY: worldHeightToGridRows(scaleWorld(0.44 + random() * 0.16)),
      radiusZ: worldDistanceToGridCells(scaleWorld(0.48 + random() * 0.16)),
      seed: branchSeed ^ 0x632be59b,
      minY: minLeafY,
    });
  }

  const leaderHeight = worldHeightToGridRows(scaleWorld(style === 3 ? 1.0 : 0.7));
  const topRadius = worldDistanceToGridCells(scaleWorld(style === 3 ? 0.95 : 0.78));
  clusters.push({
    centerX: x,
    centerY: trunkTopY + leaderHeight,
    centerZ: z,
    radiusX: topRadius,
    radiusY: worldHeightToGridRows(scaleWorld(style === 3 ? 0.82 : 0.62)),
    radiusZ: topRadius,
    seed: featureSeed ^ 0x9e3779b9,
    minY: minLeafY,
  });

  stampTreeTrunk(setBlock, x, baseY, z, trunkHeight);

  for (const cluster of clusters) {
    stampTreeBranchStub(setBlock, x, z, cluster);
  }

  for (const cluster of clusters) {
    stampLeafCluster(setBlock, cluster, leafBlock);
  }

  stampTreeTrunk(setBlock, x, baseY, z, trunkHeight);
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

function stampBambooClump(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldZ: number,
  height: number,
  featureSeed: number
): void {
  const centerX = clamp(worldToGrid(worldX, origin.x), 3, size.x - 4);
  const centerZ = clamp(worldToGrid(worldZ, origin.z), 3, size.z - 4);
  const random = mulberry32(featureSeed ^ 0xba4b00);
  const stalkCount = 4 + (featureSeed % 5);

  for (let i = 0; i < stalkCount; i++) {
    const angle = random() * Math.PI * 2;
    const distance = Math.floor(random() * 3);
    const x = clamp(centerX + Math.round(Math.cos(angle) * distance), 2, size.x - 3);
    const z = clamp(centerZ + Math.round(Math.sin(angle) * distance), 2, size.z - 3);
    const baseY = heightMap[x + z * size.x];
    const stalkHeight = Math.max(3, height + Math.floor(random() * 4) - 1);

    for (let y = baseY; y < baseY + stalkHeight; y++) {
      setBlock(x, y, z, 'bamboo');
    }

    if (random() > 0.34) {
      const leafY = baseY + stalkHeight - 1;
      setBlock(x + 1, leafY, z, 'leaves');
      setBlock(x - 1, leafY, z, 'leaves');
      setBlock(x, leafY, z + 1, 'leaves');
      setBlock(x, leafY, z - 1, 'leaves');
    }
  }
}

function stampLavaVent(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  worldX: number,
  worldZ: number,
  height: number,
  featureSeed: number
): void {
  const centerX = clamp(worldToGrid(worldX, origin.x), 3, size.x - 4);
  const centerZ = clamp(worldToGrid(worldZ, origin.z), 3, size.z - 4);
  const radius = 2 + (featureSeed % 2);
  const baseY = heightMap[centerX + centerZ * size.x];

  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const distance = Math.sqrt(dx * dx + dz * dz);
      if (distance > radius + 0.35) continue;

      const x = centerX + dx;
      const z = centerZ + dz;
      const localBaseY = heightMap[x + z * size.x];
      const rimHeight = Math.max(1, Math.round((radius + 0.5 - distance) * 0.8));
      const ventNoise = fractalNoise2(featureSeed, x * 0.66, z * 0.66, 2);

      for (let y = localBaseY; y <= Math.min(size.y - 2, baseY + Math.min(height, rimHeight + 2)); y++) {
        setBlock(x, y, z, distance <= 1 && y >= baseY ? 'lava' : ventNoise > 0.72 ? 'ash' : 'obsidian');
      }

      if (distance <= 1.2) {
        setBlock(x, Math.min(size.y - 2, baseY + 1), z, 'lava');
      }
    }
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
    stampCactus(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(scaleWorld(3)), height + worldHeightToGridRows(scaleWorld(1))), featureSeed);
  } else if (theme.id === 'volcanic') {
    if (featureSeed % 3 === 0) {
      stampLavaVent(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(scaleWorld(2)), height), featureSeed);
    } else {
      stampBasaltSpire(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(scaleWorld(2.4)), height));
    }
  } else if (theme.id === 'sakura') {
    stampTree(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(scaleWorld(3)), height), featureSeed, 'blossom_leaves');
    if (featureSeed % 3 === 0) {
      stampBambooClump(
        setBlock,
        heightMap,
        origin,
        size,
        worldX + scaleWorld(1.3),
        worldZ - scaleWorld(1.1),
        Math.max(worldHeightToGridRows(scaleWorld(4)), height + 1),
        featureSeed ^ 0xba4b00
      );
    }
  } else if (theme.id === 'frost' || theme.id === 'crystal') {
    stampCrystalCluster(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(scaleWorld(2)), height), featureSeed);
  } else if (theme.id === 'basalt') {
    stampBasaltSpire(setBlock, heightMap, origin, size, worldX, worldZ, Math.max(worldHeightToGridRows(scaleWorld(2)), height));
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

function stampTieredCitadel(
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
  const swapAxes = (featureSeed & 1) === 1;
  const wingOffset = (swapAxes ? radiusX : radiusZ) * 0.48;
  const coreHalfX = radiusX * (swapAxes ? 0.44 : 0.38);
  const coreHalfZ = radiusZ * (swapAxes ? 0.38 : 0.44);
  const wingHalfX = radiusX * (swapAxes ? 0.34 : 0.78);
  const wingHalfZ = radiusZ * (swapAxes ? 0.78 : 0.34);
  const courtHalfX = radiusX * 0.18;
  const courtHalfZ = radiusZ * 0.18;
  const gateAxis = featureSeed % 3 === 0 ? -1 : 1;
  const localVoxelX = swapAxes ? PROCEDURAL_VOXEL_SIZE.z : PROCEDURAL_VOXEL_SIZE.x;
  const localVoxelZ = swapAxes ? PROCEDURAL_VOXEL_SIZE.x : PROCEDURAL_VOXEL_SIZE.z;

  const getLocal = (worldX: number, worldZ: number): { x: number; z: number } => ({
    x: swapAxes ? worldZ - centerZ : worldX - centerX,
    z: swapAxes ? worldX - centerX : worldZ - centerZ,
  });

  const hasCitadelCell = (localX: number, localZ: number): boolean => {
    const inCore = Math.abs(localX) <= coreHalfX && Math.abs(localZ) <= coreHalfZ;
    const inCrossWing = Math.abs(localX) <= wingHalfX && Math.abs(localZ) <= wingHalfZ * 0.5;
    const inGateWing =
      Math.abs(localX) <= wingHalfX * 0.34 &&
      Math.abs(localZ - gateAxis * wingOffset) <= wingHalfZ * 0.82;
    const inBackWing =
      Math.abs(localX) <= wingHalfX * 0.48 &&
      Math.abs(localZ + gateAxis * wingOffset * 0.68) <= wingHalfZ * 0.54;

    return inCore || inCrossWing || inGateWing || inBackWing;
  };

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const local = getLocal(worldX, worldZ);
      if (!hasCitadelCell(local.x, local.z)) continue;

      fillColumnToHeight(setBlock, heightMap, origin, size, x, z, floorY, 'stone');

      const inCourtyard = Math.abs(local.x) <= courtHalfX && Math.abs(local.z) <= courtHalfZ;
      const inCore = Math.abs(local.x) <= coreHalfX && Math.abs(local.z) <= coreHalfZ;
      const inGateWing =
        Math.abs(local.x) <= wingHalfX * 0.34 &&
        Math.abs(local.z - gateAxis * wingOffset) <= wingHalfZ * 0.82;
      const chipNoise = fractalNoise2(featureSeed ^ 0x94d049bb, worldX * 0.58, worldZ * 0.58, 2);

      if (inCourtyard) {
        setBlock(x, floorY, z, chipNoise > 0.7 ? 'glass' : 'metal');
        for (let y = floorY + 1; y <= floorY + maxHeight + worldHeightToGridRows(2); y++) {
          setBlock(x, y, z, 'air');
        }
        continue;
      }

      const heightRows =
        (inCore ? maxHeight + worldHeightToGridRows(scaleWorld(1.4 + chipNoise)) : Math.max(worldHeightToGridRows(3), Math.floor(maxHeight * (inGateWing ? 0.62 : 0.48)))) +
        (chipNoise > 0.82 ? worldHeightToGridRows(1) : 0);
      const hasNeighborX = hasCitadelCell(local.x + localVoxelX, local.z) && hasCitadelCell(local.x - localVoxelX, local.z);
      const hasNeighborZ = hasCitadelCell(local.x, local.z + localVoxelZ) && hasCitadelCell(local.x, local.z - localVoxelZ);
      const isWall = !hasNeighborX || !hasNeighborZ;
      const cornerTrim =
        (Math.abs(local.x) > coreHalfX * 0.86 && Math.abs(local.z) > coreHalfZ * 0.86) ||
        chipNoise > 0.88;

      setBlock(x, floorY, z, inCore && chipNoise > 0.62 ? 'glass' : 'metal');

      for (let y = floorY + 1; y <= floorY + heightRows; y++) {
        const isRoof = y === floorY + heightRows;
        const yStep = Math.max(1, worldHeightToGridRows(scaleWorld(1.5)));
        const hasWindow = isWall && y > floorY + 2 && y < floorY + heightRows - 1 && (x + z + y + featureSeed) % (yStep + 2) === 0;

        if (isRoof) {
          setBlock(x, y, z, inCore && chipNoise > 0.55 ? 'glass' : cornerTrim ? accentBlock : 'metal');
        } else if (isWall) {
          setBlock(x, y, z, hasWindow ? 'glass' : cornerTrim ? accentBlock : y % yStep === 0 ? 'metal' : 'stone');
        } else {
          setBlock(x, y, z, 'air');
        }
      }
    }
  }

  stampStructureEntrances(setBlock, heightMap, origin, size, centerX, centerZ, radiusX, radiusZ, floorY, featureSeed);
}

function stampSkybridgeOutpost(
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
  const minX = centerX - radiusX * 1.2;
  const maxX = centerX + radiusX * 1.2;
  const minZ = centerZ - radiusZ * 1.2;
  const maxZ = centerZ + radiusZ * 1.2;
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(origin, size, minX, maxX, minZ, maxZ);
  const floorY = getMaxHeightInRect(heightMap, origin, size, minX, maxX, minZ, maxZ);
  const alongAxisX = (featureSeed & 1) === 0;
  const halfSpan = Math.max(radiusX, radiusZ) * 1.05;
  const halfWidth = Math.max(scaleWorld(1.15), Math.min(radiusX, radiusZ) * 0.28);
  const deckY = clamp(floorY + worldHeightToGridRows(scaleWorld(2.1 + (featureSeed % 3) * 0.35)), 2, size.y - maxHeight - 4);
  const podHalfAlong = Math.max(scaleWorld(1.3), halfSpan * 0.22);
  const podHalfAcross = Math.max(halfWidth * 1.95, scaleWorld(2.2));
  const podSpacing = halfSpan * 0.55;

  const getLocal = (worldX: number, worldZ: number): { along: number; across: number } => ({
    along: alongAxisX ? worldX - centerX : worldZ - centerZ,
    across: alongAxisX ? worldZ - centerZ : worldX - centerX,
  });
  const localToWorld = (along: number, across: number): { x: number; z: number } => ({
    x: alongAxisX ? centerX + along : centerX + across,
    z: alongAxisX ? centerZ + across : centerZ + along,
  });

  const stampSupportColumn = (worldX: number, worldZ: number, supportHeight: number): void => {
    const gx = clamp(worldToGrid(worldX, origin.x), 2, size.x - 3);
    const gz = clamp(worldToGrid(worldZ, origin.z), 2, size.z - 3);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx * dx + dz * dz > 2) continue;
        fillColumnToHeight(setBlock, heightMap, origin, size, gx + dx, gz + dz, supportHeight, 'stone');
        setBlock(gx + dx, supportHeight, gz + dz, featureSeed % 2 === 0 ? 'metal' : 'stone');
      }
    }
  };

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      const { along, across } = getLocal(worldX, worldZ);
      const chipNoise = fractalNoise2(featureSeed ^ 0x3d20adea, worldX * 0.64, worldZ * 0.64, 2);
      const bridgeWidth = halfWidth * lerp(0.86, 1.24, chipNoise);
      const onBridge = Math.abs(along) <= halfSpan && Math.abs(across) <= bridgeWidth;
      const inPod =
        (Math.abs(along - podSpacing) <= podHalfAlong || Math.abs(along + podSpacing) <= podHalfAlong) &&
        Math.abs(across) <= podHalfAcross;

      if (!onBridge && !inPod) continue;

      setBlock(x, deckY - 1, z, chipNoise > 0.76 ? accentBlock : 'stone');
      setBlock(x, deckY, z, chipNoise > 0.72 ? 'glass' : 'metal');
      for (let y = deckY + 1; y <= deckY + FEATURE_ENTRANCE_CLEARANCE_ROWS; y++) {
        setBlock(x, y, z, 'air');
      }

      if (onBridge && Math.abs(across) > bridgeWidth - PROCEDURAL_VOXEL_SIZE.x * 1.5 && chipNoise < 0.78) {
        setBlock(x, deckY + 1, z, chipNoise > 0.52 ? accentBlock : 'metal');
      }

      if (inPod) {
        const podCenter = along > 0 ? podSpacing : -podSpacing;
        const localAlong = along - podCenter;
        const isWall = Math.abs(localAlong) > podHalfAlong - PROCEDURAL_VOXEL_SIZE.x * 1.5 || Math.abs(across) > podHalfAcross - PROCEDURAL_VOXEL_SIZE.z * 1.5;
        const entranceCut = Math.abs(across) <= halfWidth * 0.85 && Math.abs(localAlong) > podHalfAlong - PROCEDURAL_VOXEL_SIZE.x * 2.8;
        const podHeight = Math.max(worldHeightToGridRows(3), Math.floor(maxHeight * (along > 0 ? 0.72 : 0.58)));

        for (let y = deckY + 1; y <= deckY + podHeight; y++) {
          const isRoof = y === deckY + podHeight;
          const window = isWall && !entranceCut && y === deckY + worldHeightToGridRows(2) && chipNoise > 0.46;

          if (isRoof) {
            setBlock(x, y, z, chipNoise > 0.62 ? 'glass' : 'metal');
          } else if (isWall && !entranceCut) {
            setBlock(x, y, z, window ? 'glass' : chipNoise > 0.72 ? accentBlock : 'stone');
          } else {
            setBlock(x, y, z, 'air');
          }
        }
      }
    }
  }

  for (const along of [-halfSpan * 0.72, -halfSpan * 0.18, halfSpan * 0.18, halfSpan * 0.72]) {
    for (const across of [-halfWidth * 0.75, halfWidth * 0.75]) {
      const support = localToWorld(along, across);
      stampSupportColumn(support.x, support.z, deckY - 1);
    }
  }

  const negativeEnd = localToWorld(-halfSpan, 0);
  const positiveEnd = localToWorld(halfSpan, 0);
  stampWalkableEntrancePath(
    setBlock,
    heightMap,
    origin,
    size,
    negativeEnd.x,
    negativeEnd.z,
    alongAxisX ? { dx: -1, dz: 0 } : { dx: 0, dz: -1 },
    scaleWorld(1.2),
    FEATURE_APPROACH_WORLD_LENGTH * 0.9,
    STRUCTURE_ENTRANCE_HALF_WIDTH_CELLS - 1,
    deckY,
    'metal'
  );
  stampWalkableEntrancePath(
    setBlock,
    heightMap,
    origin,
    size,
    positiveEnd.x,
    positiveEnd.z,
    alongAxisX ? { dx: 1, dz: 0 } : { dx: 0, dz: 1 },
    scaleWorld(1.2),
    FEATURE_APPROACH_WORLD_LENGTH * 0.9,
    STRUCTURE_ENTRANCE_HALF_WIDTH_CELLS - 1,
    deckY,
    'metal'
  );
}

function buildingCellKey(x: number, z: number): string {
  return `${x},${z}`;
}

function createBuildingCellMap(plan: BuildingPlan): Map<string, BuildingFootprintCell> {
  return new Map(plan.footprint.map((cell) => [buildingCellKey(cell.x, cell.z), cell]));
}

function getBuildingVolume(plan: BuildingPlan, cell: BuildingFootprintCell): BuildingVolume | undefined {
  if (!cell.volumeId) return undefined;
  return plan.volumes.find((volume) => volume.id === cell.volumeId);
}

function isSolidBuildingCell(cells: Map<string, BuildingFootprintCell>, x: number, z: number): boolean {
  const cell = cells.get(buildingCellKey(x, z));
  return Boolean(cell && cell.zone !== 'courtyard');
}

function getBuildingCell(cells: Map<string, BuildingFootprintCell>, x: number, z: number): BuildingFootprintCell | undefined {
  return cells.get(buildingCellKey(x, z));
}

function isBuildingExteriorEdge(cell: BuildingFootprintCell, cells: Map<string, BuildingFootprintCell>): boolean {
  if (cell.zone === 'courtyard') return false;
  return BUILDING_DIRECTIONS.some((direction) => !isSolidBuildingCell(cells, cell.x + direction.dx, cell.z + direction.dz));
}

function isAdjacentToCourtyard(cell: BuildingFootprintCell, cells: Map<string, BuildingFootprintCell>): boolean {
  return BUILDING_DIRECTIONS.some((direction) => getBuildingCell(cells, cell.x + direction.dx, cell.z + direction.dz)?.zone === 'courtyard');
}

function isOpeningCoveringCell(opening: BuildingOpening, cell: BuildingFootprintCell): boolean {
  const halfWidth = Math.floor(opening.widthCells / 2);
  const sideX = -opening.direction.dz;
  const sideZ = opening.direction.dx;
  const relativeX = cell.x - opening.localPosition.x;
  const relativeZ = cell.z - opening.localPosition.z;
  const sideOffset = relativeX * sideX + relativeZ * sideZ;
  const inwardOffset = -(relativeX * opening.direction.dx + relativeZ * opening.direction.dz);

  return Math.abs(sideOffset) <= halfWidth && inwardOffset >= 0 && inwardOffset <= BUILDING_ENTRANCE_INWARD_CELLS;
}

function getOpeningForCell(plan: BuildingPlan, cell: BuildingFootprintCell): BuildingOpening | undefined {
  return plan.openings.find((opening) => isOpeningCoveringCell(opening, cell));
}

function buildingRectContains(rect: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number): boolean {
  return x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
}

function isConnectionCell(plan: BuildingPlan, cell: BuildingFootprintCell): boolean {
  return plan.connections.some((connection) => buildingRectContains(connection.bounds, cell.x, cell.z));
}

function shouldCarveCourtyardAccess(plan: BuildingPlan, cell: BuildingFootprintCell, cells: Map<string, BuildingFootprintCell>): boolean {
  if (!isAdjacentToCourtyard(cell, cells)) return false;
  if (Math.abs(cell.x) <= 2 || Math.abs(cell.z) <= 2) return true;
  return ((cell.x * 17 + cell.z * 31 + plan.seed) & 15) < 2;
}

function buildingLocalToGrid(plan: BuildingPlan, localX: number, localZ: number): { x: number; z: number } {
  return {
    x: plan.gridCenter.x + localX,
    z: plan.gridCenter.z + localZ,
  };
}

function buildingLocalToWorld(plan: BuildingPlan, origin: { x: number; z: number }, localX: number, localZ: number): { x: number; z: number } {
  const grid = buildingLocalToGrid(plan, localX, localZ);
  return {
    x: gridToWorldCenter(grid.x, origin.x),
    z: gridToWorldCenter(grid.z, origin.z),
  };
}

function isBuildingWindow(plan: BuildingPlan, cell: BuildingFootprintCell, worldX: number, worldZ: number, row: number, heightRows: number): boolean {
  if (row <= 2 || row >= heightRows - 1) return false;
  if (cell.tags.includes('damaged') && row > heightRows * 0.6) return false;

  const cadence =
    cell.zone === 'tower' ? 5 :
    cell.zone === 'shell' || cell.zone === 'balcony' ? 6 :
    7;
  const band = row % cadence === Math.floor(cadence * 0.52);
  const noise = fractalNoise2(plan.seed ^ 0xb5297a4d, worldX * 0.72, (worldZ + row) * 0.72, 2);

  return band && noise > (cell.zone === 'tower' ? 0.58 : 0.68);
}

function getBuildingWallBlock(
  plan: BuildingPlan,
  cell: BuildingFootprintCell,
  worldX: number,
  worldZ: number,
  row: number,
  material = plan.material
): VoxelBlockId {
  const trimNoise = fractalNoise2(plan.seed ^ 0x68bc21eb, worldX * 0.58, (worldZ + row) * 0.58, 2);
  const roofBand = row > Math.max(2, cell.heightRows - 3);
  const cornerBand = Math.abs(cell.x - plan.bounds.x0) <= 1 ||
    Math.abs(cell.x - plan.bounds.x1) <= 1 ||
    Math.abs(cell.z - plan.bounds.z0) <= 1 ||
    Math.abs(cell.z - plan.bounds.z1) <= 1;

  if (cornerBand && trimNoise > 0.82) return material.accent;
  if (roofBand && trimNoise > 0.84) return material.roof;
  if (row % 11 === 0 && trimNoise > 0.74) return 'metal';
  return trimNoise > 0.94 ? material.accent : material.wall;
}

function stampBuildingVolumeSupports(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  plan: BuildingPlan
): void {
  for (const volume of plan.volumes) {
    if (volume.floorRow <= plan.floorRow + 2) continue;

    const width = volume.bounds.x1 - volume.bounds.x0 + 1;
    const depth = volume.bounds.z1 - volume.bounds.z0 + 1;
    const stepX = Math.max(5, Math.floor(width / 2));
    const stepZ = Math.max(5, Math.floor(depth / 2));
    const points: Array<{ x: number; z: number }> = [];

    for (let x = volume.bounds.x0; x <= volume.bounds.x1; x += stepX) {
      points.push({ x, z: volume.bounds.z0 }, { x, z: volume.bounds.z1 });
    }
    for (let z = volume.bounds.z0; z <= volume.bounds.z1; z += stepZ) {
      points.push({ x: volume.bounds.x0, z }, { x: volume.bounds.x1, z });
    }

    for (const point of points) {
      const grid = buildingLocalToGrid(plan, point.x, point.z);
      if (grid.x < 1 || grid.x >= size.x - 1 || grid.z < 1 || grid.z >= size.z - 1) continue;
      fillColumnToHeight(setBlock, heightMap, origin, size, grid.x, grid.z, volume.floorRow - 1, volume.material.support);
    }
  }
}

function stampBuildingPlanCell(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  plan: BuildingPlan,
  cell: BuildingFootprintCell,
  cells: Map<string, BuildingFootprintCell>
): void {
  const grid = buildingLocalToGrid(plan, cell.x, cell.z);
  if (grid.x < 1 || grid.x >= size.x - 1 || grid.z < 1 || grid.z >= size.z - 1) return;

  const volume = getBuildingVolume(plan, cell);
  const material = volume?.material ?? plan.material;
  const world = buildingLocalToWorld(plan, origin, cell.x, cell.z);
  const opening = getOpeningForCell(plan, cell);
  const exteriorEdge = isBuildingExteriorEdge(cell, cells);
  const courtyardAccess = shouldCarveCourtyardAccess(plan, cell, cells);
  const connectionCell = isConnectionCell(plan, cell);
  const wallCell = exteriorEdge || (isAdjacentToCourtyard(cell, cells) && !courtyardAccess);
  const elevated = cell.floorRow > plan.floorRow + 2;
  const damaged = cell.tags.includes('damaged') || cell.tags.includes('eroded_edge');

  if (cell.zone === 'courtyard') {
    fillColumnToHeight(setBlock, heightMap, origin, size, grid.x, grid.z, cell.floorRow, material.support);
    setBlock(grid.x, cell.floorRow, grid.z, material.floor);
    for (let y = cell.floorRow + 1; y <= Math.min(size.y - 1, cell.floorRow + BUILDING_WALKTHROUGH_CLEARANCE_ROWS + 3); y++) {
      setBlock(grid.x, y, grid.z, 'air');
    }
    return;
  }

  if (cell.zone === 'support') {
    fillColumnToHeight(setBlock, heightMap, origin, size, grid.x, grid.z, cell.floorRow + cell.heightRows, material.support);
    return;
  }

  if (!elevated) {
    fillColumnToHeight(setBlock, heightMap, origin, size, grid.x, grid.z, cell.floorRow, material.support);
  } else if (cell.zone === 'bridge') {
    const supportColumn = ((cell.x * 13 + cell.z * 17 + plan.seed) & (exteriorEdge ? 5 : 7)) === 0;
    if (supportColumn) {
      fillColumnToHeight(setBlock, heightMap, origin, size, grid.x, grid.z, cell.floorRow - 1, material.support);
    } else if (cell.floorRow > 0) {
      setBlock(grid.x, cell.floorRow - 1, grid.z, material.support);
    }
  } else if (cell.zone === 'balcony' && exteriorEdge && ((cell.x * 11 + cell.z * 7 + plan.seed) & 7) === 0) {
    fillColumnToHeight(setBlock, heightMap, origin, size, grid.x, grid.z, cell.floorRow - 1, material.support);
  } else if (cell.floorRow > 0) {
    setBlock(grid.x, cell.floorRow - 1, grid.z, material.support);
  }

  setBlock(grid.x, cell.floorRow, grid.z, cell.zone === 'bridge' && exteriorEdge ? material.accent : material.floor);

  const roofY = cell.floorRow + cell.heightRows;
  for (let y = cell.floorRow + 1; y <= roofY; y++) {
    const row = y - cell.floorRow;
    const roof = y === roofY;
    const damageNoise = fractalNoise2(plan.seed ^ 0x85ebca6b, world.x * 0.91, (world.z + y) * 0.91, 2);
    const brokenUpper = damaged && row > Math.max(3, cell.heightRows * 0.68) && damageNoise > (cell.tags.includes('eroded_edge') ? 0.86 : 0.92);

    if (opening && row <= Math.max(opening.heightRows, BUILDING_WALKTHROUGH_CLEARANCE_ROWS)) {
      setBlock(grid.x, y, grid.z, 'air');
    } else if (cell.zone === 'bridge') {
      const railing = exteriorEdge && row === 1 && !opening && damageNoise < 0.84;
      setBlock(grid.x, y, grid.z, railing ? material.accent : 'air');
    } else if (courtyardAccess && row <= BUILDING_WALKTHROUGH_CLEARANCE_ROWS + 1) {
      setBlock(grid.x, y, grid.z, 'air');
    } else if (connectionCell && row <= BUILDING_WALKTHROUGH_CLEARANCE_ROWS) {
      setBlock(grid.x, y, grid.z, 'air');
    } else if (roof) {
      if (brokenUpper || (damaged && damageNoise > 0.94)) {
        setBlock(grid.x, y, grid.z, 'air');
      } else {
        const glassRoof = (cell.zone === 'core' || cell.zone === 'tower' || plan.intent === 'arena_shell') && damageNoise > 0.58;
        setBlock(grid.x, y, grid.z, glassRoof ? material.glass : material.roof);
      }
    } else if (wallCell) {
      if (brokenUpper) {
        setBlock(grid.x, y, grid.z, 'air');
      } else {
        setBlock(
          grid.x,
          y,
          grid.z,
          isBuildingWindow(plan, cell, world.x, world.z, row, cell.heightRows)
            ? material.glass
            : getBuildingWallBlock(plan, cell, world.x, world.z, row, material)
        );
      }
    } else {
      setBlock(grid.x, y, grid.z, 'air');
    }
  }
}

function getOpenExteriorDirections(cell: BuildingFootprintCell, cells: Map<string, BuildingFootprintCell>): BuildingDirection[] {
  return BUILDING_DIRECTIONS.filter((direction) => !isSolidBuildingCell(cells, cell.x + direction.dx, cell.z + direction.dz));
}

function stampBuildingPlanDetails(
  setBlock: BlockSetter,
  origin: { x: number; z: number },
  size: VoxelSize,
  plan: BuildingPlan,
  cells: Map<string, BuildingFootprintCell>
): void {
  for (const cell of plan.footprint) {
    if (cell.zone === 'courtyard' || cell.zone === 'support') continue;

    const grid = buildingLocalToGrid(plan, cell.x, cell.z);
    if (grid.x < 1 || grid.x >= size.x - 1 || grid.z < 1 || grid.z >= size.z - 1) continue;

    const world = buildingLocalToWorld(plan, origin, cell.x, cell.z);
    const roofY = cell.floorRow + cell.heightRows;
    const detailNoise = fractalNoise2(plan.seed ^ 0x94d049bb, world.x * 0.86, world.z * 0.86, 2);
    const exteriorDirections = getOpenExteriorDirections(cell, cells);
    const exteriorEdge = exteriorDirections.length > 0;
    const opening = getOpeningForCell(plan, cell);

    if (roofY + 1 < size.y && cell.zone !== 'bridge') {
      if (exteriorEdge && !opening && detailNoise > (cell.zone === 'tower' ? 0.7 : 0.82)) {
        setBlock(grid.x, roofY + 1, grid.z, plan.material.roof);
      }
    }

    if (!exteriorEdge || opening || cell.heightRows <= BUILDING_WALKTHROUGH_CLEARANCE_ROWS + 4) continue;

    const facadeY = cell.floorRow + Math.min(cell.heightRows - 2, BUILDING_WALKTHROUGH_CLEARANCE_ROWS + 2 + Math.floor(detailNoise * 4));
    if (facadeY >= roofY || facadeY >= size.y) continue;

    for (const direction of exteriorDirections) {
      const directionNoise = fractalNoise2(
        plan.seed ^ 0x3c6ef35f,
        (world.x + direction.dx) * 1.1,
        (world.z + direction.dz + facadeY) * 1.1,
        2
      );

      if (directionNoise < (cell.zone === 'tower' || cell.zone === 'balcony' ? 0.93 : 0.97)) continue;

      setBlock(grid.x, facadeY, grid.z, plan.material.roof);
      if (facadeY + 1 < roofY && directionNoise > 0.985) {
        setBlock(grid.x, facadeY + 1, grid.z, plan.material.roof);
      }
    }
  }
}

function stampBuildingOpeningAndApproach(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  plan: BuildingPlan,
  opening: BuildingOpening,
  cells: Map<string, BuildingFootprintCell>
): void {
  const halfWidth = Math.floor(opening.widthCells / 2);
  const sideX = -opening.direction.dz;
  const sideZ = opening.direction.dx;
  const openingWorld = buildingLocalToWorld(plan, origin, opening.localPosition.x, opening.localPosition.z);
  const floorCell = getBuildingCell(cells, opening.localPosition.x, opening.localPosition.z);
  const floorY = floorCell?.floorRow ?? plan.floorRow;
  const clearanceRows = Math.max(opening.heightRows, BUILDING_WALKTHROUGH_CLEARANCE_ROWS);

  for (let side = -halfWidth - 1; side <= halfWidth + 1; side++) {
    for (let inward = 0; inward <= BUILDING_ENTRANCE_INWARD_CELLS; inward++) {
      const localX = opening.localPosition.x + sideX * side - opening.direction.dx * inward;
      const localZ = opening.localPosition.z + sideZ * side - opening.direction.dz * inward;
      const grid = buildingLocalToGrid(plan, localX, localZ);
      if (grid.x < 1 || grid.x >= size.x - 1 || grid.z < 1 || grid.z >= size.z - 1) continue;
      const cell = getBuildingCell(cells, localX, localZ);
      const topY = cell?.floorRow ?? floorY;

      stampWalkableColumn(setBlock, heightMap, size, grid.x, grid.z, topY, plan.material.floor, clearanceRows);
      for (let y = topY + 1; y <= Math.min(size.y - 1, topY + clearanceRows + 2); y++) {
        setBlock(grid.x, y, grid.z, 'air');
      }
    }
  }

  stampWalkableEntrancePath(
    setBlock,
    heightMap,
    origin,
    size,
    openingWorld.x,
    openingWorld.z,
    opening.direction,
    PROCEDURAL_VOXEL_SIZE.x * 3,
    BUILDING_APPROACH_WORLD_LENGTH,
    Math.max(2, halfWidth),
    floorY,
    plan.material.floor,
    clearanceRows
  );
}

function stampBuildingPlan(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  plan: BuildingPlan
): void {
  const cells = createBuildingCellMap(plan);
  stampBuildingVolumeSupports(setBlock, heightMap, origin, size, plan);

  for (const cell of plan.footprint) {
    stampBuildingPlanCell(setBlock, heightMap, origin, size, plan, cell, cells);
  }

  stampBuildingPlanDetails(setBlock, origin, size, plan, cells);

  for (const opening of plan.openings) {
    stampBuildingOpeningAndApproach(setBlock, heightMap, origin, size, plan, opening, cells);
  }
}

function tryStampPlannedBuilding(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  theme: VoxelMapTheme,
  centerX: number,
  centerZ: number,
  radiusX: number,
  radiusZ: number,
  maxHeightRows: number,
  accentBlock: VoxelBlockId,
  featureSeed: number,
  diagnostics?: ProceduralVoxelMapDiagnostics
): BuildingPlan | null {
  const minX = centerX - radiusX * 1.18;
  const maxX = centerX + radiusX * 1.18;
  const minZ = centerZ - radiusZ * 1.18;
  const maxZ = centerZ + radiusZ * 1.18;
  const floorY = getMaxHeightInRect(heightMap, origin, size, minX, maxX, minZ, maxZ);

  for (let retry = 0; retry < BUILDING_PLAN_RETRY_COUNT; retry++) {
    const planSeed = (featureSeed ^ Math.imul(retry + 1, 0x9e3779b1)) >>> 0;
    const result = createBuildingPlan({
      seed: planSeed,
      center: { x: centerX, z: centerZ },
      radiusX,
      radiusZ,
      maxHeightRows,
      floorRow: floorY,
      theme,
      accentBlock,
      origin,
      size,
      boundary: layout.boundary,
      spawnPoints: layout.spawnPoints,
      flagZones: layout.flagZones,
      approachDistance: BUILDING_APPROACH_WORLD_LENGTH,
      minEntranceClearanceRows: BUILDING_WALKTHROUGH_CLEARANCE_ROWS,
    });

    if (result.validation.passed) {
      stampBuildingPlan(setBlock, heightMap, origin, size, result.candidate);
      recordBuildingDiagnostic(diagnostics, result.candidate, result.validation, true);
      return result.candidate;
    }

    recordBuildingDiagnostic(diagnostics, result.candidate, result.validation, false);
  }

  return null;
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
  heightBoostRows = 0,
  blocks?: Uint8Array
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
  const normalOffset = scaleWorld(lerp(-5.5, 5.5, random()));
  const centerX = lerp(blueCenter.x, redCenter.x, t) + normalX * normalOffset;
  const centerZ = lerp(blueCenter.z, redCenter.z, t) + normalZ * normalOffset;
  const halfLength = scaleWorld(lerp(9, 18, random()));
  const halfThickness = scaleWorld(lerp(1.8, 4.2, random()));
  const boundsX = Math.abs(normalX) * halfLength + Math.abs(dirX) * halfThickness + scaleWorld(3);
  const boundsZ = Math.abs(normalZ) * halfLength + Math.abs(dirZ) * halfThickness + scaleWorld(3);
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(origin, size, centerX - boundsX, centerX + boundsX, centerZ - boundsZ, centerZ + boundsZ);

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (isNearFlagGameplayArea(layout, worldX, worldZ, scaleWorld(3.2))) continue;

      const localX = (worldX - centerX) * normalX + (worldZ - centerZ) * normalZ;
      const localZ = (worldX - centerX) * dirX + (worldZ - centerZ) * dirZ;
      const bend =
        Math.sin((localX + featureSeed * 0.0009) * 0.22) * scaleWorld(1.35) +
        (fractalNoise2(featureSeed ^ 0x41c64e6d, localX * 0.08, localZ * 0.08, 3) - 0.5) * scaleWorld(2.4);
      const across = Math.abs(localX) / halfLength;
      const through = Math.abs(localZ - bend) / halfThickness;
      const ridgeNoise = fractalNoise2(featureSeed, worldX * 0.16, worldZ * 0.16, 3);
      if (across > 1 || through > 1 + ridgeNoise * 0.22) continue;

      const footprint = across * across * 0.42 + through * through;
      if (footprint > 1.08 + ridgeNoise * 0.18) continue;

      const falloff = Math.pow(1 - clamp(footprint, 0, 1), 0.55);
      const spike = Math.max(0, 1 - Math.abs(Math.round((localX + random() * 4) / 7) * 7 - localX) / 1.8);
      const heightRows =
        worldHeightToGridRows(scaleWorld(3.5)) +
        heightBoostRows +
        Math.floor((SIGHTLINE_BARRIER_BASE_HEIGHT + ridgeNoise * SIGHTLINE_BARRIER_EXTRA_HEIGHT) * falloff) +
        Math.floor(spike * worldHeightToGridRows(scaleWorld(2.2)));
      const floorY = heightMap[x + z * size.x];
      const topY = clamp(floorY + heightRows, floorY + worldHeightToGridRows(4), size.y - 2);
      if (
        blocks &&
        hasTreeBlockNearColumn(
          blocks,
          size,
          x,
          z,
          floorY,
          topY + worldHeightToGridRows(scaleWorld(1.2)),
          worldDistanceToGridCells(scaleWorld(1.45))
        )
      ) {
        continue;
      }

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
  blocks: Uint8Array,
  heightMap: Uint8Array,
  origin: { x: number; y: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
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
  const widthCells = worldDistanceToGridCells(scaleWorld(5 + pass * 1.5));
  const thicknessCells = worldDistanceToGridCells(scaleWorld(2.2 + pass * 0.75));
  const centerEyeRow = clamp(worldYToGridRow(center.y, origin.y), 1, size.y - 2);

  for (let across = -widthCells; across <= widthCells; across++) {
    for (let thickness = -thicknessCells; thickness <= thicknessCells; thickness++) {
      const worldX = center.x + normalX * across * PROCEDURAL_VOXEL_SIZE.x + dirX * thickness * PROCEDURAL_VOXEL_SIZE.x;
      const worldZ = center.z + normalZ * across * PROCEDURAL_VOXEL_SIZE.z + dirZ * thickness * PROCEDURAL_VOXEL_SIZE.z;
      if (isNearFlagGameplayArea(layout, worldX, worldZ, scaleWorld(3.2))) continue;

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
          surfaceY + worldHeightToGridRows(scaleWorld(3.5 + pass * 0.7 + falloff * 3.4 + noise * 1.6)),
          centerEyeRow + worldHeightToGridRows(scaleWorld(2.25))
        ),
        1,
        size.y - 2
      );
      const bottomY = clamp(Math.min(surfaceY, centerEyeRow - worldHeightToGridRows(scaleWorld(2.6))), 1, topY);
      if (
        hasTreeBlockNearColumn(
          blocks,
          size,
          x,
          z,
          bottomY,
          topY + worldHeightToGridRows(scaleWorld(1.2)),
          worldDistanceToGridCells(scaleWorld(1.25))
        )
      ) {
        continue;
      }

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
          blocks,
          heightMap,
          origin,
          size,
          layout,
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
    worldHeightToGridRows(5),
    blocks
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
      if (isNearProtectedGameplayArea(layout, worldX, worldZ, scaleWorld(5.5))) continue;

      const surfaceY = heightMap[x + z * size.x] - 1;
      for (let y = 3; y < surfaceY - worldHeightToGridRows(scaleWorld(4)); y++) {
        const depthFromSurface = surfaceY - y;
        const broadCave = fractalNoise2(seed ^ 0xc0a57, worldX * 0.07 + y * 0.09, worldZ * 0.07 - y * 0.05, 4);
        const tubeNoise = fractalNoise2(seed ^ 0x57a1ac7, worldX * 0.16 - y * 0.04, worldZ * 0.16 + y * 0.08, 3);

        if (depthFromSurface > worldHeightToGridRows(scaleWorld(5)) && broadCave > caveThreshold && tubeNoise > 0.58) {
          setBlock(x, y, z, 'air');
          if (y > 3 && broadCave > 0.86) {
            setBlock(x, y - 1, z, tubeNoise > 0.76 ? 'metal' : 'stone');
          }
        }
      }
    }
  }

  const tunnelCount = scaleCount(2, 4, random, 1);
  for (let tunnel = 0; tunnel < tunnelCount; tunnel++) {
    let x = clamp(Math.floor(lerp(8, size.x - 8, random())), 2, size.x - 3);
    let z = clamp(Math.floor(lerp(8, size.z - 8, random())), 2, size.z - 3);
    let angle = random() * Math.PI * 2;
    const length = Math.max(8, Math.round((20 + Math.floor(random() * 36)) * FEATURE_WORLD_SCALE));
    const radius = 1;
    let y = clamp(heightMap[x + z * size.x] - worldHeightToGridRows(scaleWorld(5 + random() * 4)), 4, size.y - 5);

    for (let step = 0; step < length; step++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary) || isNearProtectedGameplayArea(layout, worldX, worldZ, scaleWorld(5))) {
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
      y = clamp(y + Math.round((random() - 0.5) * 0.8), 4, Math.max(4, heightMap[x + z * size.x] - worldHeightToGridRows(scaleWorld(4))));
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
    worldX < boundaryRange.minX + scaleWorld(2) ||
    worldX > boundaryRange.maxX - scaleWorld(2) ||
    worldZ < boundaryRange.minZ + scaleWorld(2) ||
    worldZ > boundaryRange.maxZ - scaleWorld(2)
  ) {
    return false;
  }
  if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) return false;
  if (distanceToBoundary(worldX, worldZ, layout.boundary) < radius + FEATURE_APPROACH_WORLD_LENGTH + scaleWorld(1.8)) return false;
  if (isNearProtectedGameplayArea(layout, worldX, worldZ, radius)) return false;

  for (const feature of accepted) {
    if (distanceSq(worldX, worldZ, feature.x, feature.z) < (radius + feature.radius + scaleWorld(3)) ** 2) {
      return false;
    }
  }

  return true;
}

function canPlacePlannedBuildingFeature(
  layout: ReturnType<typeof createProceduralCTFLayout>,
  accepted: FeatureAnchor[],
  worldX: number,
  worldZ: number,
  radius: number
): boolean {
  const boundaryRange = getBoundaryRange(layout.boundary);
  if (
    worldX < boundaryRange.minX + scaleWorld(1) ||
    worldX > boundaryRange.maxX - scaleWorld(1) ||
    worldZ < boundaryRange.minZ + scaleWorld(1) ||
    worldZ > boundaryRange.maxZ - scaleWorld(1)
  ) {
    return false;
  }
  if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) return false;
  if (distanceToBoundary(worldX, worldZ, layout.boundary) < Math.max(scaleWorld(1.2), radius * 0.38)) return false;
  if (isNearFlagGameplayArea(layout, worldX, worldZ, radius)) return false;
  if (isNearProtectedGameplayArea(layout, worldX, worldZ, Math.max(scaleWorld(1.2), radius * 0.36))) return false;

  for (const feature of accepted) {
    const relaxedSpacing = Math.max(scaleWorld(1.6), radius * 0.55 + feature.radius * 0.45);
    if (distanceSq(worldX, worldZ, feature.x, feature.z) < relaxedSpacing ** 2) {
      return false;
    }
  }

  return true;
}

function canPlaceFallbackBuildingFeature(
  layout: ReturnType<typeof createProceduralCTFLayout>,
  accepted: FeatureAnchor[],
  worldX: number,
  worldZ: number,
  radius: number
): boolean {
  const boundaryRange = getBoundaryRange(layout.boundary);
  if (
    worldX < boundaryRange.minX + scaleWorld(2) ||
    worldX > boundaryRange.maxX - scaleWorld(2) ||
    worldZ < boundaryRange.minZ + scaleWorld(2) ||
    worldZ > boundaryRange.maxZ - scaleWorld(2)
  ) {
    return false;
  }
  if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) return false;
  if (distanceToBoundary(worldX, worldZ, layout.boundary) < Math.max(scaleWorld(1.1), radius * 0.35)) return false;
  if (isNearFlagGameplayArea(layout, worldX, worldZ, radius)) return false;
  if (isNearProtectedGameplayArea(layout, worldX, worldZ, radius)) return false;

  for (const feature of accepted) {
    const relaxedSpacing = Math.max(scaleWorld(1.4), radius * 0.45 + feature.radius * 0.36);
    if (distanceSq(worldX, worldZ, feature.x, feature.z) < relaxedSpacing ** 2) {
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
  accepted: FeatureAnchor[],
  diagnostics?: ProceduralVoxelMapDiagnostics
): number {
  const random = mulberry32(seed ^ 0xdecafbad);
  const boundaryRange = getBoundaryRange(layout.boundary);
  const halfPlayableX = Math.min(scaleWorld(30), Math.max(scaleWorld(12), (boundaryRange.maxX - boundaryRange.minX) * 0.5 - scaleWorld(4)));
  const halfPlayableZ = Math.min(scaleWorld(25), Math.max(scaleWorld(10), (boundaryRange.maxZ - boundaryRange.minZ) * 0.5 - scaleWorld(4)));
  const targetLandmarks = 2 + Math.floor(random() * 2);
  let landmarksPlaced = 0;
  let plannedBuildingsPlaced = 0;

  for (let attempts = 0; attempts < 90 && landmarksPlaced < targetLandmarks; attempts++) {
    const centerBias = random() < 0.38;
    const centerX = centerBias ? scaleWorld(lerp(-12, 12, random())) : lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = scaleWorld(lerp(3.8, 8.6, random()));
    const radiusZ = scaleWorld(lerp(3.6, 8.2, random()));
    const radius = Math.max(radiusX, radiusZ) + scaleWorld(1.5);
    const featureSeed = seed ^ Math.floor(random() * 0xffffffff);
    const accentBlock: VoxelBlockId = random() > 0.5 ? 'neon_red' : 'neon_blue';

    const styleRoll = random();
    if (styleRoll < 0.52) {
      if (!canPlacePlannedBuildingFeature(layout, accepted, centerX, centerZ, radius)) continue;

      const plan = tryStampPlannedBuilding(
        setBlock,
        heightMap,
        origin,
        size,
        layout,
        theme,
        centerX,
        centerZ,
        radiusX,
        radiusZ,
        worldHeightToGridRows(scaleWorld(lerp(4.2, 8.0, random()))),
        accentBlock,
        featureSeed,
        diagnostics
      );
      if (!plan) continue;
      plannedBuildingsPlaced++;
    } else if (styleRoll < 0.82) {
      if (!canPlaceFeature(layout, accepted, centerX, centerZ, radius)) continue;

      stampTunnelPassage(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        scaleWorld(lerp(10, 22, random())),
        scaleWorld(lerp(4.6, 7.4, random())),
        worldHeightToGridRows(scaleWorld(lerp(2.8, 4.2, random()))),
        random() > 0.5 ? 'x' : 'z',
        featureSeed
      );
    } else {
      if (!canPlaceFeature(layout, accepted, centerX, centerZ, radius)) continue;

      stampProceduralCave(
        setBlock,
        heightMap,
        origin,
        size,
        centerX,
        centerZ,
        scaleWorld(lerp(8, 15, random())),
        scaleWorld(lerp(6, 13, random())),
        worldHeightToGridRows(scaleWorld(lerp(3.2, 6, random()))),
        featureSeed
      );
    }

    accepted.push({ x: centerX, z: centerZ, radius: radius + scaleWorld(2.4) });
    landmarksPlaced++;
  }

  if (landmarksPlaced < 3) {
    stampMidfieldSightlineBreaker(setBlock, heightMap, origin, size, layout, seed ^ 0x91e10da5);
    accepted.push({ x: scaleWorld(lerp(-8, 8, random())), z: scaleWorld(lerp(-5, 5, random())), radius: scaleWorld(8) });
  }

  return plannedBuildingsPlaced;
}

function stampFallbackPlannedBuilding(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  theme: VoxelMapTheme,
  accepted: FeatureAnchor[],
  halfPlayableX: number,
  halfPlayableZ: number,
  seed: number,
  diagnostics?: ProceduralVoxelMapDiagnostics
): boolean {
  const radiusX = scaleWorld(2.9);
  const radiusZ = scaleWorld(2.8);
  const radius = Math.max(radiusX, radiusZ);
  const candidates: Array<{ x: number; z: number }> = [];

  for (const xFactor of [-0.55, 0.55, -0.32, 0.32, 0]) {
    for (const zFactor of [-0.38, 0, 0.38]) {
      candidates.push({ x: halfPlayableX * xFactor, z: halfPlayableZ * zFactor });
    }
  }

  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[(index + (seed % candidates.length)) % candidates.length];
    if (!canPlaceFallbackBuildingFeature(layout, accepted, candidate.x, candidate.z, radius)) continue;

    const accentBlock: VoxelBlockId = (seed + index) % 2 === 0 ? 'neon_red' : 'neon_blue';
    const plan = tryStampPlannedBuilding(
      setBlock,
      heightMap,
      origin,
      size,
      layout,
      theme,
      candidate.x,
      candidate.z,
      radiusX,
      radiusZ,
      worldHeightToGridRows(scaleWorld(5.2 + (index % 3))),
      accentBlock,
      seed ^ Math.imul(index + 1, 0x632be59b),
      diagnostics
    );

    if (!plan) continue;
    accepted.push({ x: candidate.x, z: candidate.z, radius });
    return true;
  }

  return false;
}

function stampProceduralFeatures(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  random: () => number,
  theme: VoxelMapTheme,
  seed: number,
  diagnostics?: ProceduralVoxelMapDiagnostics
): void {
  const accepted: FeatureAnchor[] = [];
  const boundaryRange = getBoundaryRange(layout.boundary);
  const halfPlayableX = Math.min(scaleWorld(30), Math.max(scaleWorld(12), (boundaryRange.maxX - boundaryRange.minX) * 0.5 - scaleWorld(4)));
  const halfPlayableZ = Math.min(scaleWorld(25), Math.max(scaleWorld(10), (boundaryRange.maxZ - boundaryRange.minZ) * 0.5 - scaleWorld(4)));
  let plannedBuildingsPlaced = stampGuaranteedLandmarks(setBlock, heightMap, origin, size, layout, theme, seed, accepted, diagnostics);

  const caveCount = 1 + Math.floor(random() * 2);

  for (let i = 0; i < caveCount; i++) {
    const centerX = lerp(-halfPlayableX, halfPlayableX, random());
    const centerZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const width = scaleWorld(lerp(7, 14, random()));
    const depth = scaleWorld(lerp(5, 11, random()));
    const height = worldHeightToGridRows(scaleWorld(lerp(2.5, 5.8, random())));
    const radius = Math.max(width, depth) / 2;
    const featureSeed = Math.floor(random() * 0xffffffff);

    if (!canPlaceFeature(layout, accepted, centerX, centerZ, radius)) continue;

    stampProceduralCave(setBlock, heightMap, origin, size, centerX, centerZ, width, depth, height, featureSeed);
    accepted.push({ x: centerX, z: centerZ, radius: radius + scaleWorld(1.4) });
  }

  const structureCount = 1 + Math.floor(random() * 2);
  let structuresPlaced = 0;

  for (let attempts = 0; attempts < 70 && structuresPlaced < structureCount; attempts++) {
    const nearCenter = random() < 0.24;
    const baseX = nearCenter ? scaleWorld(lerp(-12, 12, random())) : (random() < 0.5 ? -1 : 1) * lerp(scaleWorld(7), halfPlayableX, random());
    const baseZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = scaleWorld(lerp(2.8, 6.8, random()));
    const radiusZ = scaleWorld(lerp(2.8, 6.8, random()));
    const height = worldHeightToGridRows(scaleWorld(3 + Math.floor(random() * 4)));
    const radius = Math.max(radiusX, radiusZ);
    const featureSeed = Math.floor(random() * 0xffffffff);
    const accentBlock = random() > 0.5 ? 'neon_red' : 'neon_blue';

    if (!canPlacePlannedBuildingFeature(layout, accepted, baseX, baseZ, radius)) {
      continue;
    }

    const plan = tryStampPlannedBuilding(
      setBlock,
      heightMap,
      origin,
      size,
      layout,
      theme,
      baseX,
      baseZ,
      radiusX,
      radiusZ,
      height + worldHeightToGridRows(scaleWorld(1.2)),
      accentBlock,
      featureSeed,
      diagnostics
    );

    if (!plan) continue;

    accepted.push({ x: baseX, z: baseZ, radius: radius + scaleWorld(2.2) });
    plannedBuildingsPlaced++;
    structuresPlaced++;
  }

  if (plannedBuildingsPlaced === 0 && stampFallbackPlannedBuilding(setBlock, heightMap, origin, size, layout, theme, accepted, halfPlayableX, halfPlayableZ, seed, diagnostics)) {
    plannedBuildingsPlaced++;
  }

  const groveCount = scaleCount(4, 5, random, 2);
  let grovesPlaced = 0;

  for (let attempts = 0; attempts < 90 && grovesPlaced < groveCount; attempts++) {
    const baseX = lerp(-halfPlayableX, halfPlayableX, random());
    const baseZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radius = scaleWorld(lerp(2.8, 5.8, random()));
    const placementRadius = theme.id === 'verdant' ? Math.max(radius, scaleWorld(6.2)) : radius;
    const trunkHeight = worldHeightToGridRows(scaleWorld(3 + Math.floor(random() * 2)));
    const featureSeed = Math.floor(random() * 0xffffffff);

    if (!canPlaceFeature(layout, accepted, baseX, baseZ, placementRadius)) {
      continue;
    }

    stampThemedNaturalFeature(setBlock, heightMap, origin, size, theme, baseX, baseZ, trunkHeight, featureSeed);
    accepted.push({ x: baseX, z: baseZ, radius: placementRadius + scaleWorld(1.8) });
    grovesPlaced++;
  }

  const coverCount = scaleCount(12, 10, random, 7);
  let coverPlaced = 0;

  for (let attempts = 0; attempts < 120 && coverPlaced < coverCount; attempts++) {
    const baseX = lerp(-halfPlayableX, halfPlayableX, random());
    const baseZ = lerp(-halfPlayableZ, halfPlayableZ, random());
    const radiusX = scaleWorld(lerp(1.1, 3.4, random()));
    const radiusZ = scaleWorld(lerp(1.1, 3.4, random()));
    const radius = Math.max(radiusX, radiusZ) + scaleWorld(2);
    const preferStone = Math.abs(baseZ) < scaleWorld(13) || random() < 0.38;
    const placementRadius =
      !preferStone && theme.id === 'verdant'
        ? Math.max(radius, scaleWorld(5.8))
        : radius;

    if (!canPlaceFeature(layout, accepted, baseX, baseZ, placementRadius)) {
      continue;
    }

    const boulderHeight = worldHeightToGridRows(scaleWorld(2 + Math.floor(random() * 3)));
    const trunkHeight = worldHeightToGridRows(scaleWorld(3 + Math.floor(random() * 2)));
    const featureSeed = Math.floor(random() * 0xffffffff);

    if (preferStone) {
      stampBoulder(setBlock, heightMap, origin, size, baseX, baseZ, radiusX, radiusZ, boulderHeight, getRockBlockForTheme(theme));
    } else {
      stampThemedNaturalFeature(setBlock, heightMap, origin, size, theme, baseX, baseZ, trunkHeight, featureSeed);
    }

    accepted.push({ x: baseX, z: baseZ, radius: placementRadius + scaleWorld(1.4) });
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

function clearFlagZone(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  flag: { x: number; z: number }
): void {
  const centerX = clamp(worldToGrid(flag.x, origin.x), 0, size.x - 1);
  const centerZ = clamp(worldToGrid(flag.z, origin.z), 0, size.z - 1);
  const targetSurfaceY = clamp(heightMap[centerX + centerZ * size.x] - 1, 1, size.y - 2);
  const targetHeight = targetSurfaceY + 1;
  const { gx0, gx1, gz0, gz1 } = getWorldRectBounds(
    origin,
    size,
    flag.x - FLAG_CLEAR_RADIUS,
    flag.x + FLAG_CLEAR_RADIUS,
    flag.z - FLAG_CLEAR_RADIUS,
    flag.z + FLAG_CLEAR_RADIUS
  );

  for (let x = gx0; x <= gx1; x++) {
    for (let z = gz0; z <= gz1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (distanceSq(worldX, worldZ, flag.x, flag.z) > FLAG_CLEAR_RADIUS ** 2) continue;

      const columnIndex = x + z * size.x;
      heightMap[columnIndex] = targetHeight;
      setBlock(x, 0, z, 'barrier');

      for (let y = 1; y <= targetSurfaceY; y++) {
        setBlock(x, y, z, 'stone');
      }

      for (let y = targetSurfaceY + 1; y < size.y; y++) {
        setBlock(x, y, z, 'air');
      }
    }
  }
}

function clearFlagZones(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  flags: { red: { x: number; z: number }; blue: { x: number; z: number } }
): void {
  clearFlagZone(setBlock, heightMap, origin, size, flags.red);
  clearFlagZone(setBlock, heightMap, origin, size, flags.blue);
}

function paintFlagPads(
  setBlock: BlockSetter,
  heightMap: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  flags: { red: { x: number; z: number }; blue: { x: number; z: number } }
): void {
  paintSurfaceRect(
    setBlock,
    heightMap,
    origin,
    size,
    flags.red.x - 3,
    flags.red.x + 3,
    flags.red.z - 2,
    flags.red.z + 2,
    'flag_pad'
  );
  paintSurfaceRect(
    setBlock,
    heightMap,
    origin,
    size,
    flags.blue.x - 3,
    flags.blue.x + 3,
    flags.blue.z - 2,
    flags.blue.z + 2,
    'flag_pad'
  );
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

function buildCollisionTopRows(blocks: Uint8Array, size: VoxelSize): Uint16Array {
  const topRows = new Uint16Array(size.x * size.z);

  for (let x = 0; x < size.x; x++) {
    for (let z = 0; z < size.z; z++) {
      for (let y = size.y - 1; y >= 0; y--) {
        if (isCollisionBlock(blocks[chunkIndex(x, y, z, size)])) {
          topRows[x + z * size.x] = y + 1;
          break;
        }
      }
    }
  }

  return topRows;
}

function getCollisionSurfaceBlock(
  blocks: Uint8Array,
  size: VoxelSize,
  x: number,
  z: number,
  preferredTopRow: number
): VoxelBlockId {
  for (let y = clamp(preferredTopRow - 1, 0, size.y - 1); y >= 0; y--) {
    const block = blocks[chunkIndex(x, y, z, size)];
    if (!isCollisionBlock(block)) continue;

    const blockId = getBlockId(block);
    return blockId === 'barrier' ? 'stone' : blockId;
  }

  return 'stone';
}

function chooseGrooveSurfaceBlock(
  blocks: Uint8Array,
  size: VoxelSize,
  sideA: { x: number; z: number },
  sideB: { x: number; z: number },
  targetTopRow: number
): VoxelBlockId {
  const blockA = getCollisionSurfaceBlock(blocks, size, sideA.x, sideA.z, targetTopRow);
  const blockB = getCollisionSurfaceBlock(blocks, size, sideB.x, sideB.z, targetTopRow);

  if (blockA === blockB) return blockA;
  if (blockA === 'grass' || blockB === 'grass') return 'grass';
  if (blockA === 'moss' || blockB === 'moss') return 'moss';
  if (blockA === 'dirt' || blockB === 'dirt') return 'dirt';
  if (blockA === 'sand' || blockB === 'sand') return 'sand';
  if (blockA === 'snow' || blockB === 'snow') return 'snow';
  if (blockA === 'ash' || blockB === 'ash') return 'ash';
  if (blockA === 'lava' || blockB === 'lava') return 'obsidian';
  if (blockA === 'obsidian' || blockB === 'obsidian') return 'obsidian';
  if (blockA === 'ice' || blockB === 'ice') return 'ice';
  if (blockA === 'stone' || blockB === 'stone') return 'stone';

  return blockA;
}

function getGrooveFillBlock(surfaceBlock: VoxelBlockId, y: number, surfaceY: number): VoxelBlockId {
  if (y === 0) return 'barrier';
  if (y === surfaceY) return surfaceBlock;
  if (surfaceBlock === 'grass') return 'dirt';
  if (
    surfaceBlock === 'spawn_pad' ||
    surfaceBlock === 'spawn_pad_red' ||
    surfaceBlock === 'spawn_pad_blue' ||
    surfaceBlock === 'flag_pad'
  ) {
    return 'stone';
  }

  if (surfaceBlock === 'dirt') return 'dirt';
  if (surfaceBlock === 'sand') return 'sand';
  if (surfaceBlock === 'snow') return y >= surfaceY - 1 ? 'snow' : 'ice';
  if (surfaceBlock === 'ash') return 'ash';
  if (surfaceBlock === 'moss') return y >= surfaceY - 1 ? 'moss' : 'dirt';
  if (surfaceBlock === 'lava') return 'obsidian';
  if (surfaceBlock === 'obsidian' || surfaceBlock === 'ice') return surfaceBlock;
  return 'stone';
}

function shouldSealGrooveColumn(
  origin: { x: number; z: number },
  layout: ReturnType<typeof createProceduralCTFLayout>,
  x: number,
  z: number
): boolean {
  const worldX = gridToWorldCenter(x, origin.x);
  const worldZ = gridToWorldCenter(z, origin.z);

  return (
    isInsideBoundaryPolygon(worldX, worldZ, layout.boundary) ||
    distanceToBoundary(worldX, worldZ, layout.boundary) < BOUNDARY_WALL_THICKNESS
  );
}

function isProtectedGameplayClearanceColumn(
  origin: { x: number; z: number },
  layout: ReturnType<typeof createProceduralCTFLayout>,
  x: number,
  z: number
): boolean {
  const worldX = gridToWorldCenter(x, origin.x);
  const worldZ = gridToWorldCenter(z, origin.z);

  for (const flag of [layout.flagZones.red, layout.flagZones.blue]) {
    if (distanceSq(worldX, worldZ, flag.x, flag.z) <= (FLAG_CLEAR_RADIUS + PROCEDURAL_VOXEL_SIZE.x * 2) ** 2) {
      return true;
    }
  }

  for (const spawn of [...layout.spawnPoints.red, ...layout.spawnPoints.blue]) {
    if (distanceSq(worldX, worldZ, spawn.x, spawn.z) <= (SPAWN_CLEAR_RADIUS + PROCEDURAL_VOXEL_SIZE.x * 2) ** 2) {
      return true;
    }
  }

  return false;
}

function sealGrooveRun(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  topRows: Uint16Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  cells: { x: number; z: number }[],
  sideA: { x: number; z: number },
  sideB: { x: number; z: number },
  targetTopRow: number
): boolean {
  const surfaceY = targetTopRow - 1;
  const surfaceBlock = chooseGrooveSurfaceBlock(blocks, size, sideA, sideB, targetTopRow);
  let sealed = false;

  for (const cell of cells) {
    if (!shouldSealGrooveColumn(origin, layout, cell.x, cell.z)) continue;

    const topIndex = cell.x + cell.z * size.x;
    const currentTopRow = topRows[topIndex];
    if (currentTopRow >= targetTopRow) continue;

    for (let y = currentTopRow; y < targetTopRow; y++) {
      setBlock(cell.x, y, cell.z, getGrooveFillBlock(surfaceBlock, y, surfaceY));
    }

    topRows[topIndex] = targetTopRow;
    sealed = true;
  }

  return sealed;
}

interface BasinComponent {
  cells: number[];
  highSideSamples: { x: number; z: number }[];
  highPerimeterEdges: number;
  maxTopRow: number;
  perimeterEdges: number;
  targetTopRow: number;
  touchesProtectedGameplay: boolean;
}

function sealTrappedBasinComponent(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  topRows: Uint16Array,
  size: VoxelSize,
  component: BasinComponent
): boolean {
  if (component.highSideSamples.length === 0) return false;
  if (component.targetTopRow - component.maxTopRow <= MAX_NAVIGATION_STEP_ROWS) return false;

  const sideA = component.highSideSamples[0];
  const sideB = component.highSideSamples[1] ?? sideA;
  const targetTopRow = clamp(component.targetTopRow, 1, size.y);
  const surfaceY = targetTopRow - 1;
  const surfaceBlock = chooseGrooveSurfaceBlock(blocks, size, sideA, sideB, targetTopRow);
  let sealed = false;

  for (const cellIndex of component.cells) {
    const x = cellIndex % size.x;
    const z = Math.floor(cellIndex / size.x);
    const currentTopRow = topRows[cellIndex];
    if (currentTopRow >= targetTopRow) continue;

    for (let y = currentTopRow; y < targetTopRow; y++) {
      setBlock(x, y, z, getGrooveFillBlock(surfaceBlock, y, surfaceY));
    }

    topRows[cellIndex] = targetTopRow;
    sealed = true;
  }

  return sealed;
}

function sealUnsafeTrappedBasins(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  topRows: Uint16Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>
): boolean {
  const visited = new Uint8Array(topRows.length);
  const directions: GridDirection[] = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ];
  let sealedAny = false;

  for (let startX = 1; startX < size.x - 1; startX++) {
    for (let startZ = 1; startZ < size.z - 1; startZ++) {
      const startIndex = startX + startZ * size.x;
      if (visited[startIndex] || topRows[startIndex] === 0) continue;
      if (!shouldSealGrooveColumn(origin, layout, startX, startZ)) continue;

      const component: BasinComponent = {
        cells: [],
        highSideSamples: [],
        highPerimeterEdges: 0,
        maxTopRow: 0,
        perimeterEdges: 0,
        targetTopRow: Number.POSITIVE_INFINITY,
        touchesProtectedGameplay: false,
      };
      const queue: number[] = [startIndex];
      visited[startIndex] = 1;

      for (let cursor = 0; cursor < queue.length; cursor++) {
        const cellIndex = queue[cursor];
        const x = cellIndex % size.x;
        const z = Math.floor(cellIndex / size.x);
        const currentTopRow = topRows[cellIndex];

        component.cells.push(cellIndex);
        component.maxTopRow = Math.max(component.maxTopRow, currentTopRow);
        if (isProtectedGameplayClearanceColumn(origin, layout, x, z)) {
          component.touchesProtectedGameplay = true;
        }

        for (const direction of directions) {
          const neighborX = x + direction.dx;
          const neighborZ = z + direction.dz;

          if (neighborX <= 0 || neighborX >= size.x - 1 || neighborZ <= 0 || neighborZ >= size.z - 1) {
            component.perimeterEdges++;
            continue;
          }

          const neighborIndex = neighborX + neighborZ * size.x;
          const neighborTopRow = topRows[neighborIndex];

          if (neighborTopRow === 0 || !shouldSealGrooveColumn(origin, layout, neighborX, neighborZ)) {
            component.perimeterEdges++;
            continue;
          }

          if (Math.abs(neighborTopRow - currentTopRow) <= MAX_NAVIGATION_STEP_ROWS) {
            if (!visited[neighborIndex]) {
              visited[neighborIndex] = 1;
              queue.push(neighborIndex);
            }
            continue;
          }

          component.perimeterEdges++;

          if (neighborTopRow - currentTopRow > MAX_NAVIGATION_STEP_ROWS) {
            component.highPerimeterEdges++;
            component.targetTopRow = Math.min(component.targetTopRow, neighborTopRow);

            if (component.highSideSamples.length < 2) {
              component.highSideSamples.push({ x: neighborX, z: neighborZ });
            }
          }
        }
      }

      if (component.cells.length > UNSAFE_BASIN_MAX_AREA_CELLS) continue;
      if (component.touchesProtectedGameplay) continue;
      if (!Number.isFinite(component.targetTopRow)) continue;
      if (component.highPerimeterEdges < 4 || component.perimeterEdges === 0) continue;
      if (component.highPerimeterEdges / component.perimeterEdges < UNSAFE_BASIN_MIN_HIGH_EDGE_RATIO) continue;

      if (sealTrappedBasinComponent(setBlock, blocks, topRows, size, component)) {
        sealedAny = true;
      }
    }
  }

  return sealedAny;
}

function sealBoundarySeamColumn(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  topRows: Uint16Array,
  size: VoxelSize,
  x: number,
  z: number,
  targetTopRow: number,
  sideSamples: { x: number; z: number }[]
): boolean {
  const cellIndex = x + z * size.x;
  const currentTopRow = topRows[cellIndex];
  const safeTargetTopRow = clamp(targetTopRow, 1, size.y);
  if (safeTargetTopRow - currentTopRow <= MAX_NAVIGATION_STEP_ROWS) return false;

  const sideA = sideSamples[0];
  if (!sideA) return false;
  const sideB = sideSamples[1] ?? sideA;

  const surfaceY = safeTargetTopRow - 1;
  const surfaceBlock = chooseGrooveSurfaceBlock(blocks, size, sideA, sideB, safeTargetTopRow);

  for (let y = currentTopRow; y < safeTargetTopRow; y++) {
    setBlock(x, y, z, getGrooveFillBlock(surfaceBlock, y, surfaceY));
  }

  topRows[cellIndex] = safeTargetTopRow;
  return true;
}

function sealUnsafeBoundarySeams(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  topRows: Uint16Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>
): boolean {
  let sealedAny = false;

  for (let x = 1; x < size.x - 1; x++) {
    for (let z = 1; z < size.z - 1; z++) {
      const worldX = gridToWorldCenter(x, origin.x);
      const worldZ = gridToWorldCenter(z, origin.z);
      if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) continue;
      const boundaryDistance = distanceToBoundary(worldX, worldZ, layout.boundary);
      if (boundaryDistance > BOUNDARY_SEAM_SEAL_THICKNESS) continue;
      if (isProtectedGameplayClearanceColumn(origin, layout, x, z)) continue;

      const cellIndex = x + z * size.x;
      const currentTopRow = topRows[cellIndex];
      const targetSamples: number[] = [];
      const sideSamples: { x: number; z: number }[] = [];

      for (let dx = -BOUNDARY_SEAM_SAMPLE_RADIUS_CELLS; dx <= BOUNDARY_SEAM_SAMPLE_RADIUS_CELLS; dx++) {
        for (let dz = -BOUNDARY_SEAM_SAMPLE_RADIUS_CELLS; dz <= BOUNDARY_SEAM_SAMPLE_RADIUS_CELLS; dz++) {
          if (dx === 0 && dz === 0) continue;
          if (dx * dx + dz * dz > BOUNDARY_SEAM_SAMPLE_RADIUS_CELLS ** 2) continue;

          const neighborX = x + dx;
          const neighborZ = z + dz;
          if (neighborX < 1 || neighborX >= size.x - 1 || neighborZ < 1 || neighborZ >= size.z - 1) continue;

          const neighborWorldX = gridToWorldCenter(neighborX, origin.x);
          const neighborWorldZ = gridToWorldCenter(neighborZ, origin.z);
          if (!isInsideBoundaryPolygon(neighborWorldX, neighborWorldZ, layout.boundary)) continue;
          if (distanceToBoundary(neighborWorldX, neighborWorldZ, layout.boundary) <= boundaryDistance + PROCEDURAL_VOXEL_SIZE.x * 0.5) continue;

          const neighborTopRow = topRows[neighborX + neighborZ * size.x];
          if (neighborTopRow - currentTopRow <= MAX_NAVIGATION_STEP_ROWS) continue;

          targetSamples.push(neighborTopRow);
          if (sideSamples.length < 2) {
            sideSamples.push({ x: neighborX, z: neighborZ });
          }
        }
      }

      if (targetSamples.length < 3) continue;

      targetSamples.sort((heightA, heightB) => heightA - heightB);
      const targetTopRow = targetSamples[Math.floor(targetSamples.length * 0.5)];

      if (sealBoundarySeamColumn(setBlock, blocks, topRows, size, x, z, targetTopRow, sideSamples)) {
        sealedAny = true;
      }
    }
  }

  return sealedAny;
}

function sealNarrowGrooveRunsForAxis(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  topRows: Uint16Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>,
  axis: 'x' | 'z'
): boolean {
  const movingLimit = axis === 'x' ? size.x : size.z;
  const fixedLimit = axis === 'x' ? size.z : size.x;
  let sealedAny = false;
  const toCell = (moving: number, fixed: number): { x: number; z: number } =>
    axis === 'x' ? { x: moving, z: fixed } : { x: fixed, z: moving };
  const getTopRow = (moving: number, fixed: number): number => {
    const cell = toCell(moving, fixed);
    return topRows[cell.x + cell.z * size.x];
  };
  const scanDirection = (direction: -1 | 1): void => {
    for (let fixed = 1; fixed < fixedLimit - 1; fixed++) {
      let moving = direction === 1 ? 1 : movingLimit - 2;

      while (moving > 0 && moving < movingLimit - 1) {
        const openingSideMoving = moving - direction;
        const openingSideTopRow = getTopRow(openingSideMoving, fixed);
        const currentTopRow = getTopRow(moving, fixed);

        if (openingSideTopRow === 0 || openingSideTopRow - currentTopRow <= MAX_NAVIGATION_STEP_ROWS) {
          moving += direction;
          continue;
        }

        const cells: { x: number; z: number }[] = [];
        let maxRunTopRow = 0;
        let cursor = moving;

        while (
          cursor > 0 &&
          cursor < movingLimit - 1 &&
          openingSideTopRow - getTopRow(cursor, fixed) > MAX_NAVIGATION_STEP_ROWS
        ) {
          const cell = toCell(cursor, fixed);
          cells.push(cell);
          maxRunTopRow = Math.max(maxRunTopRow, topRows[cell.x + cell.z * size.x]);
          cursor += direction;
        }

        const closingSideTopRow = getTopRow(cursor, fixed);
        const targetTopRow = Math.min(openingSideTopRow, closingSideTopRow);

        if (
          closingSideTopRow > 0 &&
          cells.length <= UNSAFE_GROOVE_MAX_WIDTH_CELLS &&
          targetTopRow - maxRunTopRow > MAX_NAVIGATION_STEP_ROWS &&
          sealGrooveRun(
            setBlock,
            blocks,
            topRows,
            origin,
            size,
            layout,
            cells,
            toCell(openingSideMoving, fixed),
            toCell(cursor, fixed),
            targetTopRow
          )
        ) {
          sealedAny = true;
        }

        moving = cursor;
      }
    }
  };

  scanDirection(1);
  scanDirection(-1);

  return sealedAny;
}

function sealUnsafeCornerPockets(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  topRows: Uint16Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>
): boolean {
  const directions: GridDirection[] = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
  ];
  const pockets: Array<{
    cell: { x: number; z: number };
    sides: [{ x: number; z: number }, { x: number; z: number }];
    targetTopRow: number;
  }> = [];

  for (let x = 1; x < size.x - 1; x++) {
    for (let z = 1; z < size.z - 1; z++) {
      const currentTopRow = topRows[x + z * size.x];
      if (currentTopRow === 0 || !shouldSealGrooveColumn(origin, layout, x, z)) continue;

      const blockingSides: Array<{ x: number; z: number; topRow: number }> = [];

      for (const direction of directions) {
        const neighborX = x + direction.dx;
        const neighborZ = z + direction.dz;
        const neighborTopRow = topRows[neighborX + neighborZ * size.x];

        if (neighborTopRow - currentTopRow > MAX_NAVIGATION_STEP_ROWS) {
          blockingSides.push({ x: neighborX, z: neighborZ, topRow: neighborTopRow });
        }
      }

      if (blockingSides.length < 3) continue;

      const targetTopRow = Math.min(...blockingSides.map((side) => side.topRow));
      if (targetTopRow - currentTopRow <= MAX_NAVIGATION_STEP_ROWS) continue;

      pockets.push({
        cell: { x, z },
        sides: [
          { x: blockingSides[0].x, z: blockingSides[0].z },
          { x: blockingSides[1].x, z: blockingSides[1].z },
        ],
        targetTopRow,
      });
    }
  }

  let sealedAny = false;

  for (const pocket of pockets) {
    if (
      sealGrooveRun(
        setBlock,
        blocks,
        topRows,
        origin,
        size,
        layout,
        [pocket.cell],
        pocket.sides[0],
        pocket.sides[1],
        pocket.targetTopRow
      )
    ) {
      sealedAny = true;
    }
  }

  return sealedAny;
}

function sealUnsafeNarrowGrooves(
  setBlock: BlockSetter,
  blocks: Uint8Array,
  origin: { x: number; z: number },
  size: VoxelSize,
  layout: ReturnType<typeof createProceduralCTFLayout>
): void {
  const topRows = buildCollisionTopRows(blocks, size);

  for (let pass = 0; pass < UNSAFE_GROOVE_SEAL_PASSES; pass++) {
    const sealedX = sealNarrowGrooveRunsForAxis(setBlock, blocks, topRows, origin, size, layout, 'x');
    const sealedZ = sealNarrowGrooveRunsForAxis(setBlock, blocks, topRows, origin, size, layout, 'z');
    const sealedPockets = sealUnsafeCornerPockets(setBlock, blocks, topRows, origin, size, layout);
    const sealedBasins = sealUnsafeTrappedBasins(setBlock, blocks, topRows, origin, size, layout);
    const sealedBoundarySeams = sealUnsafeBoundarySeams(setBlock, blocks, topRows, origin, size, layout);

    if (!sealedX && !sealedZ && !sealedPockets && !sealedBasins && !sealedBoundarySeams) return;
  }
}

function getVolcanicSurfaceBlock(
  craters: VolcanicCrater[],
  worldX: number,
  worldZ: number
): VoxelBlockId | null {
  for (const crater of craters) {
    const distance = Math.sqrt(distanceSq(worldX, worldZ, crater.x, crater.z));
    if (distance > crater.radius * 1.42) continue;

    const radial = distance / crater.radius;
    const heatNoise = fractalNoise2(crater.seed ^ 0x1a7a, worldX * 0.18, worldZ * 0.18, 3);
    const veinNoise = fractalNoise2(crater.seed ^ 0x0b51d1a, worldX * 0.33, worldZ * 0.33, 2);
    const channel = radial > 0.28 && radial < 1.08 && heatNoise > 0.82;

    if (distance < crater.innerRadius * lerp(0.74, 1.08, heatNoise) || channel) {
      return 'lava';
    }

    if (distance < crater.innerRadius * 1.65 || (radial < 0.92 && veinNoise > 0.74)) {
      return 'obsidian';
    }

    if (radial < 1.26) {
      return heatNoise > 0.72 ? 'obsidian' : 'ash';
    }
  }

  return null;
}

function getRockBlockForTheme(theme: VoxelMapTheme): VoxelBlockId {
  if (theme.id === 'volcanic') return 'obsidian';
  if (theme.id === 'frost') return 'ice';
  return 'stone';
}

function getLooseGroundBlockForTheme(theme: VoxelMapTheme): VoxelBlockId {
  if (theme.id === 'volcanic') return 'ash';
  if (theme.id === 'desert') return 'sand';
  if (theme.id === 'frost') return 'snow';
  return 'dirt';
}

function chooseTerrainSurfaceBlock(
  theme: VoxelMapTheme,
  volcanicCraters: VolcanicCrater[],
  worldX: number,
  worldZ: number,
  height: number,
  rockySurfaceRows: number,
  boundarySurface: boolean,
  rockPatch: boolean,
  seed: number
): VoxelBlockId {
  if (theme.id === 'volcanic') {
    const volcanicBlock = getVolcanicSurfaceBlock(volcanicCraters, worldX, worldZ);
    if (volcanicBlock) return volcanicBlock;
    return boundarySurface || rockPatch || height > rockySurfaceRows ? 'obsidian' : 'ash';
  }

  if (theme.id === 'desert') {
    return boundarySurface || rockPatch || height > rockySurfaceRows ? 'stone' : 'sand';
  }

  if (theme.id === 'frost') {
    const icePatch = fractalNoise2(seed ^ 0x1ce, worldX * 0.12, worldZ * 0.12, 2) > 0.78;
    return boundarySurface || rockPatch || height > rockySurfaceRows || icePatch ? 'ice' : 'snow';
  }

  if (theme.id === 'sakura') {
    const mossPatch = fractalNoise2(seed ^ 0x4055, worldX * 0.1, worldZ * 0.1, 3) > 0.54;
    if (boundarySurface || rockPatch || height > rockySurfaceRows) return mossPatch ? 'moss' : 'stone';
    return mossPatch ? 'moss' : 'grass';
  }

  if (theme.id === 'crystal') {
    const mossPatch = fractalNoise2(seed ^ 0xc275, worldX * 0.09, worldZ * 0.09, 2) > 0.68;
    if (mossPatch && !boundarySurface && !rockPatch) return 'moss';
  }

  return boundarySurface || rockPatch || height > rockySurfaceRows ? 'stone' : 'grass';
}

function chooseTerrainFillBlock(theme: VoxelMapTheme, y: number, height: number, dirtDepthRows: number): VoxelBlockId {
  if (y >= height - dirtDepthRows) {
    return getLooseGroundBlockForTheme(theme);
  }

  return getRockBlockForTheme(theme);
}

function generateProceduralVoxelMapInternal(
  seed = DEFAULT_PROCEDURAL_MAP_SEED,
  diagnostics?: ProceduralVoxelMapDiagnostics
): VoxelMapManifest {
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
  const hillStrength = scaleWorld(2.4 + random() * 2.4);
  const ridgeStrength = scaleWorld(0.8 + random() * 1.2);
  const ridgeAngle = random() * Math.PI * 2;
  const ridgeCos = Math.cos(ridgeAngle);
  const ridgeSin = Math.sin(ridgeAngle);
  const organicRidgeOffset = scaleWorld(lerp(-7, 7, random()));
  const organicRidgeHalfWidth = scaleWorld(lerp(6.5, 13.5, random()));
  const organicRidgeLength = scaleWorld(lerp(19, 34, random()));
  const organicRidgeCenter = scaleWorld(lerp(-7, 7, random()));
  const organicRidgeCurve = scaleWorld(lerp(2.5, 6.8, random()));
  const plateauStrength = random() < 0.5 ? scaleWorld(lerp(0.6, 1.8, random())) : 0;
  const basinStrength = random() < 0.5 ? scaleWorld(lerp(0.5, 1.4, random())) : 0;
  const basinCenterX = scaleWorld(lerp(-8, 8, random()));
  const basinCenterZ = scaleWorld(lerp(-7, 7, random()));
  const basinRadiusX = scaleWorld(lerp(19, 32, random()));
  const basinRadiusZ = scaleWorld(lerp(17, 29, random()));
  const minTerrainRows = worldHeightToGridRows(4);
  const maxTerrainRows = size.y - worldHeightToGridRows(10);
  const dirtDepthRows = worldHeightToGridRows(4);
  const edgeWallRows = worldHeightToGridRows(scaleWorld(2.5 + random() * 2.5));
  const rockySurfaceRows = worldHeightToGridRows(11);
  const volcanicCraters = theme.id === 'volcanic'
    ? createVolcanicCraters(layout, random, normalizedSeed)
    : [];

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
      const insideBoundary = isInsideBoundaryPolygon(worldX, worldZ, layout.boundary);
      const boundaryDistance = distanceToBoundary(worldX, worldZ, layout.boundary);

      const baseNoise = fractalNoise2(normalizedSeed, worldX * terrainScale, worldZ * terrainScale, 4);
      const ridgeNoise = fractalNoise2(normalizedSeed ^ 0x41c64e6d, worldX * 0.055, worldZ * 0.055, 3);
      const detailNoise = fractalNoise2(normalizedSeed ^ 0x9e3779b9, worldX * 0.12, worldZ * 0.12, 2);
      const plateauNoise = fractalNoise2(normalizedSeed ^ 0x632be59b, worldX * 0.035, worldZ * 0.035, 3);
      const ridgeAlong = worldX * ridgeCos + worldZ * ridgeSin;
      const ridgeAcross = -worldX * ridgeSin + worldZ * ridgeCos;
      const ridgeCurve =
        organicRidgeOffset +
        Math.sin((ridgeAlong + normalizedSeed * 0.00019) * 0.14) * organicRidgeCurve * 0.46 +
        (fractalNoise2(normalizedSeed ^ 0xaa7f3a19, ridgeAlong * 0.035, ridgeAcross * 0.035, 3) - 0.5) * organicRidgeCurve;
      const ridgeBand = Math.max(0, 1 - Math.abs(ridgeAcross - ridgeCurve) / organicRidgeHalfWidth);
      const ridgeLengthMask = Math.max(0, 1 - Math.abs(ridgeAlong - organicRidgeCenter) / organicRidgeLength);
      const ridgeBreakup = fractalNoise2(normalizedSeed ^ 0xbad5eed, worldX * 0.08, worldZ * 0.08, 3);
      const organicRidge =
        Math.pow(ridgeBand, 1.65) *
        Math.pow(ridgeLengthMask, 0.74) *
        lerp(0.42, 1.18, ridgeBreakup) *
        (1.1 + ridgeNoise * 1.2);
      const basinDx = (worldX - basinCenterX) / basinRadiusX;
      const basinDz = (worldZ - basinCenterZ) / basinRadiusZ;
      const basinFalloff = Math.max(0, 1 - basinDx * basinDx - basinDz * basinDz);
      const centerBasin = basinStrength * Math.pow(basinFalloff, 0.72);
      const plateauStep = plateauStrength > 0 && plateauNoise > 0.66 ? plateauStrength : 0;
      const boundaryLift = insideBoundary
        ? getBoundaryHeightLift(normalizedSeed, worldX, worldZ, boundaryDistance)
        : scaleWorld(3.5) + Math.min(boundaryDistance, scaleWorld(5)) * 0.65;
      const worldHeight = clamp(
        scaleWorld(4) +
          heightBias +
          baseNoise * hillStrength +
          (ridgeNoise > 0.68 ? ridgeStrength : 0) +
          detailNoise * scaleWorld(1.5) +
          organicRidge +
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
  if (volcanicCraters.length > 0) {
    applyVolcanicLandforms(heightMap, origin, size, volcanicCraters, minTerrainRows, maxTerrainRows);
  }
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
  shapeGameplayRouteTerrain(heightMap, origin, size, layout, normalizedSeed);
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
      const boundaryWallShell = !insideBoundary && boundaryDistance < BOUNDARY_WALL_THICKNESS;
      if (!insideBoundary && !boundaryWallShell) continue;

      if (boundaryWallShell) {
        const wallTopY = Math.min(size.y - 1, height + edgeWallRows + worldHeightToGridRows(scaleWorld(1.9)));
        for (let y = 0; y <= wallTopY; y++) {
          setBlock(x, y, z, y === 0 ? 'barrier' : getRockBlockForTheme(theme));
        }
        continue;
      }

      const boundaryRockSurface = hasBoundaryRockSurface(normalizedSeed, worldX, worldZ, boundaryDistance);
      const rockPatch = fractalNoise2(normalizedSeed ^ 0xa11ce, worldX * 0.09, worldZ * 0.09, 3) > 0.76;

      for (let y = 0; y < height; y++) {
        let blockId: VoxelBlockId = 'stone';

        if (y === 0) {
          blockId = 'barrier';
        } else if (y === height - 1) {
          blockId = chooseTerrainSurfaceBlock(
            theme,
            volcanicCraters,
            worldX,
            worldZ,
            height,
            rockySurfaceRows,
            boundaryRockSurface,
            rockPatch,
            normalizedSeed
          );
        } else if (y >= height - dirtDepthRows) {
          blockId = chooseTerrainFillBlock(theme, y, height, dirtDepthRows);
        }

        setBlock(x, y, z, blockId);
      }

      const boundaryOutcropRows = getBoundaryOutcropRows(normalizedSeed, worldX, worldZ, boundaryDistance, edgeWallRows);
      if (boundaryOutcropRows > 0) {
        for (let y = height; y < Math.min(size.y, height + boundaryOutcropRows); y++) {
          setBlock(x, y, z, getRockBlockForTheme(theme));
        }
      }
    }
  }

  carveProceduralCaves(setBlock, heightMap, origin, size, layout, normalizedSeed);

  paintSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.red, 'spawn_pad_red');
  paintSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.blue, 'spawn_pad_blue');
  paintFlagPads(setBlock, heightMap, origin, size, layout.flagZones);

  stampProceduralFeatures(setBlock, heightMap, origin, size, layout, random, theme, normalizedSeed, diagnostics);
  clearFlagZones(setBlock, heightMap, origin, size, layout.flagZones);
  paintFlagPads(setBlock, heightMap, origin, size, layout.flagZones);
  clearSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.red, 'spawn_pad_red');
  clearSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.blue, 'spawn_pad_blue');
  enforceSpawnSightlineOcclusion(setBlock, blocks, heightMap, origin, size, layout, normalizedSeed);
  clearFlagZones(setBlock, heightMap, origin, size, layout.flagZones);
  paintFlagPads(setBlock, heightMap, origin, size, layout.flagZones);
  clearSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.red, 'spawn_pad_red');
  clearSpawnPoints(setBlock, heightMap, origin, size, layout.spawnPoints.blue, 'spawn_pad_blue');
  sealUnsafeNarrowGrooves(setBlock, blocks, origin, size, layout);

  const chunks: VoxelChunk[] = [];
  const chunkSlotsX = Math.ceil(size.x / chunkSize.x);
  const chunkSlotsY = Math.ceil(size.y / chunkSize.y);
  const chunkSlotsZ = Math.ceil(size.z / chunkSize.z);
  const totalChunkSlots = chunkSlotsX * chunkSlotsY * chunkSlotsZ;

  for (let cy = 0; cy < chunkSlotsY; cy++) {
    for (let cz = 0; cz < chunkSlotsZ; cz++) {
      for (let cx = 0; cx < chunkSlotsX; cx++) {
        const actualSize = {
          x: Math.min(chunkSize.x, size.x - cx * chunkSize.x),
          y: Math.min(chunkSize.y, size.y - cy * chunkSize.y),
          z: Math.min(chunkSize.z, size.z - cz * chunkSize.z),
        };
        let chunkBlocks: Uint8Array | null = null;
        let chunkSolidBlocks = 0;

        for (let y = 0; y < actualSize.y; y++) {
          for (let z = 0; z < actualSize.z; z++) {
            for (let x = 0; x < actualSize.x; x++) {
              const globalX = cx * chunkSize.x + x;
              const globalY = cy * chunkSize.y + y;
              const globalZ = cz * chunkSize.z + z;
              const block = blocks[chunkIndex(globalX, globalY, globalZ, size)];
              if (block === 0) continue;

              if (!chunkBlocks) {
                chunkBlocks = new Uint8Array(actualSize.x * actualSize.y * actualSize.z);
              }

              chunkBlocks[chunkIndex(x, y, z, actualSize)] = block;
              if (isSolidBlock(block)) {
                chunkSolidBlocks++;
              }
            }
          }
        }

        if (!chunkBlocks || chunkSolidBlocks === 0) {
          continue;
        }

        chunks.push({
          coord: { x: cx, y: cy, z: cz },
          size: actualSize,
          blocks: chunkBlocks,
          solidBlockCount: chunkSolidBlocks,
        });
      }
    }
  }

  const topSolidRows = buildCollisionTopRows(blocks, size);

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
    heightfield: {
      origin,
      voxelSize,
      size: { x: size.x, z: size.z },
      topSolidRows,
    },
    chunks,
  };
  const colliders = generateVoxelColliders(partialManifest);

  return {
    ...partialManifest,
    colliders,
    stats: {
      chunkCount: chunks.length,
      totalChunkSlots,
      emptyChunkSlots: totalChunkSlots - chunks.length,
      renderableChunkCount: chunks.length,
      solidBlocks,
      colliderCount: colliders.length,
    },
  };
}

export function generateProceduralVoxelMap(seed = DEFAULT_PROCEDURAL_MAP_SEED): VoxelMapManifest {
  return generateProceduralVoxelMapInternal(seed);
}

export function generateProceduralVoxelMapWithDiagnostics(seed = DEFAULT_PROCEDURAL_MAP_SEED): ProceduralVoxelMapGenerationResult {
  const normalizedSeed = seed >>> 0;
  const diagnostics = createProceduralVoxelMapDiagnostics(normalizedSeed, getVoxelMapTheme(normalizedSeed).id);
  const manifest = generateProceduralVoxelMapInternal(normalizedSeed, diagnostics);

  diagnostics.themeId = manifest.theme.id;

  return {
    manifest,
    diagnostics,
  };
}

let defaultManifest: VoxelMapManifest | null = null;

export function getDefaultProceduralVoxelMap(): VoxelMapManifest {
  if (!defaultManifest) {
    defaultManifest = generateProceduralVoxelMap(DEFAULT_PROCEDURAL_MAP_SEED);
  }

  return defaultManifest;
}
