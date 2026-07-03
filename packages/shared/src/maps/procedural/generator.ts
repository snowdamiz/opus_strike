import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_HEIGHT } from '../../constants/physics.js';
import {
  POWERUP_PICKUP_RADIUS,
  POWERUP_RESPAWN_SECONDS,
} from '../../constants/game.js';
import type { Vec3 } from '../../types/vector.js';
import { getBlockNumericId, isCollisionBlock, isSolidBlock } from './blocks.js';
import { isInsideBoundaryPolygon } from './boundaries.js';
import { generateVoxelColliders } from './colliders.js';
import {
  createMapConstruction,
  finalizeCompiledMapDiagnostics,
  type MapConstructionResult,
} from './construction.js';
import {
  createProceduralCTFLayout,
  normalizeVoxelMapSizeId,
  PROCEDURAL_VOXEL_SIZE,
  type ProceduralCTFLayout,
} from './ctfLayout.js';
import { fractalNoise2 } from './noise.js';
import { mulberry32 } from './rng.js';
import { getVoxelMapTheme } from './themes.js';
import {
  TUTORIAL_MAP_SEED,
  TUTORIAL_MAP_SIZE_ID,
  createTutorialVoxelMapManifest,
  isTutorialMapSeed,
} from './tutorial.js';
import {
  DEV_TESTING_MAP_FOOTPRINT_SCALE,
  DEV_TESTING_MAP_PROFILE_ID,
  DEV_TESTING_MAP_SIZE_ID,
  DEV_TESTING_HERO_LINEUP_SPACING,
  DEV_TESTING_TARGET_AREA_HALF_EXTENTS,
  createDevTestingFeaturePlan,
  isDevTestingMapSeed,
} from './devTesting.js';
import { generateBattleRoyalVoxelMap } from './battleRoyalGenerator.js';
import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  DEFAULT_PROCEDURAL_MAP_SEED,
  type BoundaryPoint,
  type MapBlueprint,
  type MapDesignBrief,
  type MapDiagnostics,
  type MapPowerupKind,
  type MapPowerupPickup,
  type MapPowerupStrategicRole,
  type MapProfileId,
  type MapTeam,
  type ModuleInstance,
  type ModuleRoleTag,
  type RouteGraphNode,
  type TacticalSlot,
  type TacticalSlotRole,
  type TeamMap,
  type VoxelBlockId,
  type VoxelChunk,
  type VoxelMapManifest,
  type VoxelMapStats,
  type VoxelMapSizeId,
  type VoxelMapTheme,
  type VoxelSize,
} from './types.js';

type BlockPalette = Record<
  | 'air'
  | 'terrainTop'
  | 'terrainSide'
  | 'terrainDeep'
  | 'stone'
  | 'floor'
  | 'wall'
  | 'trim'
  | 'glass'
  | 'wood'
  | 'foliage'
  | 'red'
  | 'blue'
  | 'spawnRed'
  | 'spawnBlue'
  | 'flag'
  | 'healthPad'
  | 'powerupPad'
  | 'barrier',
  number
>;

type StructureKind =
  | 'base_bunker'
  | 'spawn_shelter'
  | 'flag_plinth'
  | 'mid_wall'
  | 'ruin_cover'
  | 'landmark_tower'
  | 'supported_gate'
  | 'cover_cluster'
  | 'watch_post'
  | 'terrace_platform'
  | 'broken_arch'
  | 'monument_ring'
  | 'boulder_patch'
  | 'crystal_spire'
  | 'tree_cluster'
  | 'pine_cluster'
  | 'blossom_tree_cluster'
  | 'crystal_tree_cluster'
  | 'cactus_stand'
  | 'bamboo_thicket'
  | 'basalt_columns'
  | 'ice_outcrop'
  | 'desert_outpost'
  | 'shrine_gate'
  | 'gold_cache'
  | 'crate_stack'
  | 'garden_marker';

interface ProceduralVoxelMapDiagnosticsBlueprint
  extends Pick<
    MapBlueprint,
    | 'id'
    | 'familyId'
    | 'topologyId'
    | 'lanes'
    | 'routeGraph'
    | 'protectedZones'
    | 'tacticalSlots'
    | 'moduleInstances'
    | 'terrainConstraints'
  > {}

export interface ProceduralVoxelMapDiagnostics {
  seed: number;
  mapSize: VoxelMapSizeId;
  themeId: VoxelMapTheme['id'];
  designBrief?: MapDesignBrief;
  blueprint?: ProceduralVoxelMapDiagnosticsBlueprint;
  map?: MapDiagnostics;
  objectSummary?: Record<string, number>;
  repairActions: Record<string, number>;
  stageTimingsMs: Record<string, number>;
}

export interface ProceduralVoxelMapGenerationResult {
  manifest: VoxelMapManifest;
  diagnostics: ProceduralVoxelMapDiagnostics;
}

export interface ProceduralVoxelMapGenerationOptions {
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  profileId?: MapProfileId | string | null;
  footprintScale?: number | null;
}

function normalizeArenaMapProfileId(profileId?: MapProfileId | string | null): MapProfileId {
  return profileId === 'tdm_arena' ? 'tdm_arena' : 'ctf_arena';
}

function isDevTestingMapProfileId(profileId?: MapProfileId | string | null): boolean {
  return profileId === DEV_TESTING_MAP_PROFILE_ID;
}

function getEffectiveGenerationOptions(
  seed: number,
  options: ProceduralVoxelMapGenerationOptions
): ProceduralVoxelMapGenerationOptions {
  if (!isDevTestingMapSeed(seed) && !isDevTestingMapProfileId(options.profileId)) return options;

  return {
    ...options,
    mapSize: DEV_TESTING_MAP_SIZE_ID,
    profileId: DEV_TESTING_MAP_PROFILE_ID,
    footprintScale: DEV_TESTING_MAP_FOOTPRINT_SCALE,
  };
}

interface PlacedStructure {
  id: string;
  slotId: string;
  kind: StructureKind;
  role: TacticalSlotRole;
  moduleId: string;
  roleTags: ModuleRoleTag[];
  team?: MapTeam;
  position: Vec3;
  facing: { x: number; z: number };
  footprint: TacticalSlot['footprint'];
  radius: number;
  padRadius: number;
  surfaceRow: number;
  variant: number;
}

interface StructureStampContext {
  seed: number;
  themeId: VoxelMapTheme['id'];
  blocks: Uint8Array;
  size: VoxelSize;
  origin: Vec3;
  voxelSize: VoxelSize;
  heightMap: Uint16Array;
  palette: BlockPalette;
}

interface TerrainProfile {
  top: VoxelBlockId;
  side: VoxelBlockId;
  deep: VoxelBlockId;
  foliage: VoxelBlockId;
}

const AIR = getBlockNumericId('air');
const MAX_TERRAIN_STEP_ROWS = 3;
const INITIAL_TERRAIN_SMOOTHING_PASSES = 3;
const FINAL_TERRAIN_SMOOTHING_PASSES = 3;
const BASE_TERRAIN_ROWS = Math.round(5.2 / PROCEDURAL_VOXEL_SIZE.y);
const MIN_TERRAIN_ROWS = Math.round(2.8 / PROCEDURAL_VOXEL_SIZE.y);
const MAX_TERRAIN_ROWS = Math.round(9.6 / PROCEDURAL_VOXEL_SIZE.y);
const OBJECTIVE_PAD_RADIUS = 3.9;
const OBJECTIVE_PAD_BLEND = 2.4;
const SPAWN_PAD_RADIUS = 1.65;
const FLAG_PAD_RADIUS = 2.6;
const POWERUP_PAD_RADIUS = 1.85;
const POWERUP_PAD_BLEND = 1.1;
const SPAWN_HEADROOM_RADIUS = PLAYER_RADIUS + 1.25;
const SPAWN_EGRESS_RADIUS = PLAYER_RADIUS + 1.05;
const SPAWN_EGRESS_MAX_DISTANCE = 3.4;
const SPAWN_EGRESS_FLAG_BUFFER = 1.55;
const SPAWN_EGRESS_FLOATING_CLEANUP_MAX_BLOCKS = 96;
const BOUNDARY_WALL_THICKNESS = 2.2;
const BOUNDARY_WALL_MIN_THICKNESS = 1.65;
const BOUNDARY_WALL_MAX_THICKNESS = 3.25;
const BOUNDARY_WALL_THICKNESS_VARIANCE = 0.75;
const BOUNDARY_WALL_RELIEF_DEPTH = 0.55;
const BOUNDARY_WALL_ROWS = Math.round(15.5 / PROCEDURAL_VOXEL_SIZE.y);
const BOUNDARY_WALL_MIN_ROWS = BOUNDARY_WALL_ROWS - Math.round(0.9 / PROCEDURAL_VOXEL_SIZE.y);
const BOUNDARY_WALL_MAX_ROWS = BOUNDARY_WALL_ROWS + Math.round(1.1 / PROCEDURAL_VOXEL_SIZE.y);
const BOUNDARY_WALL_HEIGHT_VARIANCE_ROWS = Math.round(0.75 / PROCEDURAL_VOXEL_SIZE.y);
const BOUNDARY_INNER_GRADE_WIDTH = 2.8;
const BOUNDARY_INNER_GRADE_WIDTH_VARIANCE = 1.25;
const BOUNDARY_INNER_GRADE_MIN_WIDTH = 2.2;
const BOUNDARY_INNER_GRADE_MAX_WIDTH = 4.8;
const BOUNDARY_INNER_GRADE_MIN_RISE_ROWS = Math.ceil((STEP_HEIGHT + 0.3) / PROCEDURAL_VOXEL_SIZE.y);
const BOUNDARY_INNER_GRADE_TREAD_DEPTH = 0.48;
const BOUNDARY_INNER_GRADE_MIN_TREAD_DEPTH = 0.34;
const BOUNDARY_INNER_GRADE_MAX_TREAD_DEPTH = 0.82;
const BOUNDARY_INNER_GRADE_OFFSET_JITTER = 0.62;
const BOUNDARY_FLOATING_DETAIL_MAX_BLOCKS = 32;
const BOUNDARY_FLOATING_DETAIL_ANCHOR_DISTANCE =
  BOUNDARY_WALL_MAX_THICKNESS + BOUNDARY_INNER_GRADE_MAX_WIDTH + 1.25;
const HEADROOM_ROWS = Math.ceil((PLAYER_HEIGHT + 0.45) / PROCEDURAL_VOXEL_SIZE.y);
const RANDOM_OBJECT_ATTEMPTS = 260;
const DECORATIVE_OBJECT_MIN_COUNT = 14;
const DECORATIVE_OBJECT_VARIANCE = 5;
const DECORATIVE_OBJECT_AREA_PER_COUNT = 135;
const DECORATIVE_OBJECT_MAX_COUNT = 30;
const DECORATIVE_RANDOM_FILL_RATIO = 0.62;
const DECORATIVE_GAP_GRID_STEP = 5.4;
const DECORATIVE_GAP_JITTER = 1.2;
const DECORATIVE_GAP_EXTRA_COUNT = 6;
const DECORATIVE_LARGE_EMPTY_RADIUS = 8.5;
const STRUCTURAL_PAD_MINIMUMS: Partial<Record<TacticalSlotRole, number>> = {
  base_shell: 7.4,
  spawn_shelter: 5.25,
  flag_stand: 3.2,
  midfield_occluder: 6.4,
  side_lane_cover_chain: 4.4,
  hard_cover_cluster: 4.4,
  flank_landmark: 4.8,
  defender_perch: 4.5,
  elevated_bridge: 5.25,
  traversal_ramp: 4.8,
  underpass: 5,
  tunnel_entrance: 4.8,
  soft_cover_cluster: 3.7,
};
const STRUCTURAL_FOOTPRINT_SCALES: Partial<Record<TacticalSlotRole, number>> = {
  base_shell: 1.22,
  spawn_shelter: 1.2,
  flag_stand: 1.08,
  midfield_occluder: 1.18,
  side_lane_cover_chain: 1.18,
  hard_cover_cluster: 1.18,
  flank_landmark: 1.16,
  defender_perch: 1.2,
  elevated_bridge: 1.16,
  traversal_ramp: 1.14,
  underpass: 1.14,
  tunnel_entrance: 1.14,
  soft_cover_cluster: 1.12,
};

interface PowerupPlacementCandidate {
  position: Vec3;
  strategicRole: MapPowerupStrategicRole;
  powerupScore: number;
  healthScore: number;
  routeNodeId?: string;
  laneId?: string;
  teamBias?: MapTeam;
  tieBreak: number;
}

function createProceduralVoxelMapDiagnostics(
  seed: number,
  themeId: VoxelMapTheme['id'],
  mapSize: VoxelMapSizeId
): ProceduralVoxelMapDiagnostics {
  return {
    seed,
    mapSize,
    themeId,
    repairActions: {},
    stageTimingsMs: {},
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  const clamped = clamp(t, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function distanceSq2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt(distanceSq2D(a, b));
}

function distanceToSegmentSq2D(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number }
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;

  if (lengthSq <= 0.0001) return distanceSq2D(point, start);

  const t = clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq, 0, 1);
  const closest = {
    x: start.x + dx * t,
    z: start.z + dz * t,
  };
  return distanceSq2D(point, closest);
}

function normalize2D(vector: { x: number; z: number }, fallback: { x: number; z: number } = { x: 0, z: 1 }): {
  x: number;
  z: number;
} {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 0.0001) return fallback;
  return { x: vector.x / length, z: vector.z / length };
}

function perpendicular(direction: { x: number; z: number }): { x: number; z: number } {
  return { x: -direction.z, z: direction.x };
}

function averageVec3(points: Vec3[]): Vec3 {
  if (points.length === 0) return { x: 0, y: 0, z: 0 };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function blockIndex(x: number, y: number, z: number, size: VoxelSize): number {
  return x + size.x * (z + size.z * y);
}

function columnIndex(x: number, z: number, size: Pick<VoxelSize, 'x'>): number {
  return x + z * size.x;
}

function worldToGrid(value: number, origin: number, voxelSize: number, max: number): number {
  return clamp(Math.floor((value - origin) / voxelSize), 0, max - 1);
}

function gridToWorldCenter(index: number, origin: number, voxelSize: number): number {
  return origin + (index + 0.5) * voxelSize;
}

function gridRowsToWorldY(row: number, originY: number, voxelY: number): number {
  return originY + row * voxelY;
}

function getGridPointForWorld(position: { x: number; z: number }, origin: Vec3, size: VoxelSize, voxelSize: VoxelSize): {
  x: number;
  z: number;
} {
  return {
    x: worldToGrid(position.x, origin.x, voxelSize.x, size.x),
    z: worldToGrid(position.z, origin.z, voxelSize.z, size.z),
  };
}

function heightRowAtWorld(heightMap: Uint16Array, origin: Vec3, size: VoxelSize, voxelSize: VoxelSize, point: { x: number; z: number }): number {
  const grid = getGridPointForWorld(point, origin, size, voxelSize);
  return heightMap[columnIndex(grid.x, grid.z, size)];
}

function distanceToSegment(
  pointX: number,
  pointZ: number,
  start: BoundaryPoint,
  end: BoundaryPoint
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 0.0001) return Math.hypot(pointX - start.x, pointZ - start.z);
  const t = clamp(((pointX - start.x) * dx + (pointZ - start.z) * dz) / lengthSq, 0, 1);
  return Math.hypot(pointX - (start.x + dx * t), pointZ - (start.z + dz * t));
}

function distanceToBoundary(worldX: number, worldZ: number, boundary: BoundaryPoint[]): number {
  let closest = Infinity;
  for (let index = 0; index < boundary.length; index++) {
    closest = Math.min(closest, distanceToSegment(worldX, worldZ, boundary[index], boundary[(index + 1) % boundary.length]));
  }
  return closest;
}

function gridRandom2D(seed: number, worldX: number, worldZ: number, cellSize: number, salt: number): number {
  const gridX = Math.floor(worldX / cellSize);
  const gridZ = Math.floor(worldZ / cellSize);
  let hash = (seed ^ salt) >>> 0;
  hash ^= Math.imul(gridX, 0x8da6b343);
  hash ^= Math.imul(gridZ, 0xd8163841);
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x100000000;
}

function boundaryWallRelief(seed: number, worldX: number, worldZ: number): number {
  const broad = fractalNoise2(seed ^ 0x77616c6c, worldX * 0.105, worldZ * 0.105, 3, 2.05, 0.55) - 0.5;
  const local = fractalNoise2(seed ^ 0x72656c69, worldX * 0.24, worldZ * 0.24, 2, 2.0, 0.45) - 0.5;
  return broad * 0.82 + local * 0.32;
}

function hasBoundaryWallButtress(seed: number, worldX: number, worldZ: number): boolean {
  return fractalNoise2(seed ^ 0x62757474, worldX * 0.18, worldZ * 0.18, 2, 2.1, 0.5) > 0.78;
}

function getBoundaryWallThickness(seed: number, worldX: number, worldZ: number): number {
  const relief = boundaryWallRelief(seed, worldX, worldZ) * BOUNDARY_WALL_THICKNESS_VARIANCE;
  const buttressDepth = hasBoundaryWallButtress(seed, worldX, worldZ) ? BOUNDARY_WALL_RELIEF_DEPTH : 0;
  return clamp(
    BOUNDARY_WALL_THICKNESS + relief + buttressDepth,
    BOUNDARY_WALL_MIN_THICKNESS,
    BOUNDARY_WALL_MAX_THICKNESS
  );
}

function getBoundaryWallTopRow(seed: number, worldX: number, worldZ: number): number {
  const noise = fractalNoise2(seed ^ 0x746f7073, worldX * 0.075, worldZ * 0.075, 3, 2.0, 0.5);
  const reliefRows = hasBoundaryWallButtress(seed, worldX, worldZ) ? 1 : 0;
  const row = BOUNDARY_WALL_ROWS + Math.round((noise - 0.5) * 2 * BOUNDARY_WALL_HEIGHT_VARIANCE_ROWS) + reliefRows;
  return clamp(row, BOUNDARY_WALL_MIN_ROWS, BOUNDARY_WALL_MAX_ROWS);
}

function getBoundaryInnerGradeWidth(seed: number, worldX: number, worldZ: number): number {
  const broad = fractalNoise2(seed ^ 0x67726164, worldX * 0.085, worldZ * 0.085, 3, 2.0, 0.5) - 0.5;
  const local = fractalNoise2(seed ^ 0x73637265, worldX * 0.28, worldZ * 0.28, 2, 2.0, 0.5) - 0.5;
  const cut = gridRandom2D(seed, worldX, worldZ, 1.45, 0x63757473);
  const pocket = cut > 0.78 ? 1.2 : cut < 0.2 ? -0.35 : 0;
  return clamp(
    BOUNDARY_INNER_GRADE_WIDTH + broad * BOUNDARY_INNER_GRADE_WIDTH_VARIANCE + local * 0.8 + pocket,
    BOUNDARY_INNER_GRADE_MIN_WIDTH,
    BOUNDARY_INNER_GRADE_MAX_WIDTH
  );
}

function getBoundaryInnerGradeTreadDepth(seed: number, worldX: number, worldZ: number): number {
  const patch = gridRandom2D(seed, worldX, worldZ, 1.05, 0x74726564) - 0.5;
  const noise = fractalNoise2(seed ^ 0x73746570, worldX * 0.44, worldZ * 0.44, 2, 2.0, 0.5) - 0.5;
  return clamp(
    BOUNDARY_INNER_GRADE_TREAD_DEPTH + patch * 0.28 + noise * 0.12,
    BOUNDARY_INNER_GRADE_MIN_TREAD_DEPTH,
    BOUNDARY_INNER_GRADE_MAX_TREAD_DEPTH
  );
}

function getBoundaryInnerGradeOffsetJitter(seed: number, worldX: number, worldZ: number): number {
  const clump = gridRandom2D(seed, worldX, worldZ, 1.15, 0x6a697474) - 0.5;
  const chip = gridRandom2D(seed, worldX, worldZ, 0.72, 0x63686970) - 0.5;
  const noise = fractalNoise2(seed ^ 0x73636172, worldX * 0.42, worldZ * 0.42, 2, 2.0, 0.5) - 0.5;
  return clump * BOUNDARY_INNER_GRADE_OFFSET_JITTER + chip * 0.2 + noise * 0.24;
}

function getBoundaryInnerGradeTierDrop(seed: number, worldX: number, worldZ: number, gradeOffset: number, gradeWidth: number): number {
  const gouge = gridRandom2D(seed, worldX, worldZ, 0.95, 0x676f7567);
  const scar = fractalNoise2(seed ^ 0x74696572, worldX * 0.5, worldZ * 0.5, 2, 2.0, 0.5);
  let drop = 0;
  if (gouge > 0.88 && gradeOffset > gradeWidth * 0.42) drop++;
  if (scar > 0.84 && gradeOffset > gradeWidth * 0.58) drop++;
  return drop;
}

function getBoundaryInnerGradeTopRow(
  seed: number,
  worldX: number,
  worldZ: number,
  boundaryDistance: number,
  wallThickness: number,
  wallTopRow: number,
  terrainHeight: number
): number | null {
  const gradeWidth = getBoundaryInnerGradeWidth(seed, worldX, worldZ);
  const gradeOffset = boundaryDistance - wallThickness;
  if (gradeOffset < 0 || gradeOffset > gradeWidth) return null;

  const treadDepth = getBoundaryInnerGradeTreadDepth(seed, worldX, worldZ);
  const warpedOffset = clamp(
    gradeOffset + getBoundaryInnerGradeOffsetJitter(seed, worldX, worldZ),
    0,
    gradeWidth
  );
  const tread = Math.floor(warpedOffset / treadDepth);
  const extraDrop = getBoundaryInnerGradeTierDrop(seed, worldX, worldZ, gradeOffset, gradeWidth);
  const topRow = wallTopRow - (tread + 1 + extraDrop) * BOUNDARY_INNER_GRADE_MIN_RISE_ROWS;
  const minTopRow = terrainHeight + BOUNDARY_INNER_GRADE_MIN_RISE_ROWS;
  return topRow >= minTopRow ? topRow : null;
}

function boundaryBounds(boundary: BoundaryPoint[]): { minX: number; maxX: number; minZ: number; maxZ: number } {
  return boundary.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      maxX: Math.max(bounds.maxX, point.x),
      minZ: Math.min(bounds.minZ, point.z),
      maxZ: Math.max(bounds.maxZ, point.z),
    }),
    { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  );
}

function polygonArea(points: BoundaryPoint[]): number {
  let doubledArea = 0;

  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubledArea += current.x * next.z - next.x * current.z;
  }

  return Math.abs(doubledArea) / 2;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function getTerrainProfile(theme: VoxelMapTheme): TerrainProfile {
  switch (theme.id) {
    case 'golden':
      return { top: 'gold', side: 'gold_ore', deep: 'stone', foliage: 'crystal_growth' };
    case 'basalt':
      return { top: 'moss', side: 'stone', deep: 'obsidian', foliage: 'bamboo' };
    case 'desert':
      return { top: 'sand', side: 'dirt', deep: 'stone', foliage: 'cactus' };
    case 'frost':
      return { top: 'snow', side: 'ice', deep: 'stone', foliage: 'leaves' };
    case 'crystal':
      return { top: 'grass', side: 'moss', deep: 'stone', foliage: 'glass' };
    case 'volcanic':
      return { top: 'ash', side: 'obsidian', deep: 'stone', foliage: 'cactus' };
    case 'sakura':
      return { top: 'grass', side: 'dirt', deep: 'stone', foliage: 'blossom_leaves' };
    case 'independence':
      return { top: 'grass', side: 'dirt', deep: 'stone', foliage: 'leaves' };
    case 'verdant':
    default:
      return { top: 'grass', side: 'dirt', deep: 'stone', foliage: 'leaves' };
  }
}

function createBlockPalette(theme: VoxelMapTheme): BlockPalette {
  const terrain = getTerrainProfile(theme);
  const isGolden = theme.id === 'golden';
  return {
    air: getBlockNumericId('air'),
    terrainTop: getBlockNumericId(terrain.top),
    terrainSide: getBlockNumericId(terrain.side),
    terrainDeep: getBlockNumericId(terrain.deep),
    stone: getBlockNumericId('stone'),
    floor: getBlockNumericId(isGolden ? 'gold_panel' : 'metal'),
    wall: getBlockNumericId(isGolden ? 'gold_ore' : theme.id === 'volcanic' || theme.id === 'basalt' ? 'obsidian' : 'stone'),
    trim: getBlockNumericId(isGolden ? 'gold_panel' : theme.id === 'frost' ? 'ice' : 'glass'),
    glass: getBlockNumericId(isGolden ? 'gold_glass' : 'glass'),
    wood: getBlockNumericId('wood'),
    foliage: getBlockNumericId(terrain.foliage),
    red: getBlockNumericId('neon_red'),
    blue: getBlockNumericId('neon_blue'),
    spawnRed: getBlockNumericId('spawn_pad_red'),
    spawnBlue: getBlockNumericId('spawn_pad_blue'),
    flag: getBlockNumericId('flag_pad'),
    healthPad: getBlockNumericId('health_pad'),
    powerupPad: getBlockNumericId('powerup_pad'),
    barrier: getBlockNumericId('barrier'),
  };
}

function createHeightMap(seed: number, layout: ProceduralCTFLayout): Uint16Array {
  const { origin, size, voxelSize, boundary } = layout;
  const heightMap = new Uint16Array(size.x * size.z);
  const redFlag = layout.flagZones.red;
  const blueFlag = layout.flagZones.blue;
  const axis = normalize2D({ x: blueFlag.x - redFlag.x, z: blueFlag.z - redFlag.z });
  const normal = perpendicular(axis);

  for (let z = 0; z < size.z; z++) {
    const worldZ = gridToWorldCenter(z, origin.z, voxelSize.z);
    for (let x = 0; x < size.x; x++) {
      const worldX = gridToWorldCenter(x, origin.x, voxelSize.x);
      const inside = isInsideBoundaryPolygon(worldX, worldZ, boundary);
      const broad = fractalNoise2(seed ^ 0x4c6f7721, worldX * 0.045, worldZ * 0.045, 4, 2.05, 0.55) - 0.5;
      const local = fractalNoise2(seed ^ 0x18a7c23d, worldX * 0.12, worldZ * 0.12, 3, 2.1, 0.45) - 0.5;
      const terrace = fractalNoise2(seed ^ 0x6d657361, worldX * 0.028, worldZ * 0.028, 3, 2.0, 0.5) - 0.5;
      const ridgeNoise = fractalNoise2(seed ^ 0x72696467, worldX * 0.075, worldZ * 0.075, 3, 2.0, 0.5);
      const ridge = Math.pow(1 - Math.abs(ridgeNoise * 2 - 1), 1.65);
      const along = worldX * axis.x + worldZ * axis.z;
      const across = worldX * normal.x + worldZ * normal.z;
      const wave =
        Math.sin(along * 0.12 + (seed % 97)) * 1.9 +
        Math.cos(across * 0.15 + (seed % 131)) * 1.35 +
        Math.sin((along + across * 0.35) * 0.055 + (seed % 53)) * 1.8;
      const boundaryFade = inside ? clamp(distanceToBoundary(worldX, worldZ, boundary) / 6.5, 0, 1) : 0;
      const reliefFade = smoothstep(boundaryFade);
      const row = Math.round(BASE_TERRAIN_ROWS + broad * 14 + local * 4.5 + terrace * 7 + ridge * 5 * reliefFade + wave * reliefFade);
      heightMap[columnIndex(x, z, size)] = clamp(row, MIN_TERRAIN_ROWS, MAX_TERRAIN_ROWS);
    }
  }

  limitHeightSteps(heightMap, layout, MAX_TERRAIN_STEP_ROWS, INITIAL_TERRAIN_SMOOTHING_PASSES);
  return heightMap;
}

function sampleMedianHeight(
  heightMap: Uint16Array,
  origin: Vec3,
  size: VoxelSize,
  voxelSize: VoxelSize,
  center: { x: number; z: number },
  radius: number
): number {
  const rows: number[] = [];
  const minX = worldToGrid(center.x - radius, origin.x, voxelSize.x, size.x);
  const maxX = worldToGrid(center.x + radius, origin.x, voxelSize.x, size.x);
  const minZ = worldToGrid(center.z - radius, origin.z, voxelSize.z, size.z);
  const maxZ = worldToGrid(center.z + radius, origin.z, voxelSize.z, size.z);
  const radiusSq = radius * radius;

  for (let z = minZ; z <= maxZ; z++) {
    const worldZ = gridToWorldCenter(z, origin.z, voxelSize.z);
    for (let x = minX; x <= maxX; x++) {
      const worldX = gridToWorldCenter(x, origin.x, voxelSize.x);
      if ((worldX - center.x) ** 2 + (worldZ - center.z) ** 2 > radiusSq) continue;
      rows.push(heightMap[columnIndex(x, z, size)]);
    }
  }

  if (rows.length === 0) return BASE_TERRAIN_ROWS;
  rows.sort((a, b) => a - b);
  return rows[Math.floor(rows.length * 0.52)];
}

function flattenDisc(
  heightMap: Uint16Array,
  origin: Vec3,
  size: VoxelSize,
  voxelSize: VoxelSize,
  center: { x: number; z: number },
  radius: number,
  targetRow: number,
  blendRadius = OBJECTIVE_PAD_BLEND
): void {
  const minX = worldToGrid(center.x - radius - blendRadius, origin.x, voxelSize.x, size.x);
  const maxX = worldToGrid(center.x + radius + blendRadius, origin.x, voxelSize.x, size.x);
  const minZ = worldToGrid(center.z - radius - blendRadius, origin.z, voxelSize.z, size.z);
  const maxZ = worldToGrid(center.z + radius + blendRadius, origin.z, voxelSize.z, size.z);

  for (let z = minZ; z <= maxZ; z++) {
    const worldZ = gridToWorldCenter(z, origin.z, voxelSize.z);
    for (let x = minX; x <= maxX; x++) {
      const worldX = gridToWorldCenter(x, origin.x, voxelSize.x);
      const distance = Math.hypot(worldX - center.x, worldZ - center.z);
      if (distance > radius + blendRadius) continue;

      const index = columnIndex(x, z, size);
      if (distance <= radius) {
        heightMap[index] = targetRow;
        continue;
      }

      const amount = 1 - smoothstep((distance - radius) / Math.max(0.001, blendRadius));
      heightMap[index] = Math.round(lerp(heightMap[index], targetRow, amount));
    }
  }
}

function flattenGameplayPads(heightMap: Uint16Array, layout: ProceduralCTFLayout): void {
  const points = [
    layout.flagZones.red,
    layout.flagZones.blue,
    ...layout.spawnPoints.red,
    ...layout.spawnPoints.blue,
  ];

  for (const point of points) {
    const target = sampleMedianHeight(heightMap, layout.origin, layout.size, layout.voxelSize, point, OBJECTIVE_PAD_RADIUS);
    flattenDisc(heightMap, layout.origin, layout.size, layout.voxelSize, point, OBJECTIVE_PAD_RADIUS, target);
  }
}

function limitHeightSteps(heightMap: Uint16Array, layout: ProceduralCTFLayout, maxStepRows: number, passes: number): void {
  const { origin, size, voxelSize, boundary } = layout;
  const next = new Uint16Array(heightMap.length);

  for (let pass = 0; pass < passes; pass++) {
    next.set(heightMap);
    for (let z = 1; z < size.z - 1; z++) {
      const worldZ = gridToWorldCenter(z, origin.z, voxelSize.z);
      for (let x = 1; x < size.x - 1; x++) {
        const worldX = gridToWorldCenter(x, origin.x, voxelSize.x);
        if (!isInsideBoundaryPolygon(worldX, worldZ, boundary)) continue;

        const index = columnIndex(x, z, size);
        const current = heightMap[index];
        const lowestNeighbor = Math.min(
          heightMap[columnIndex(x - 1, z, size)],
          heightMap[columnIndex(x + 1, z, size)],
          heightMap[columnIndex(x, z - 1, size)],
          heightMap[columnIndex(x, z + 1, size)]
        );
        const highestNeighbor = Math.max(
          heightMap[columnIndex(x - 1, z, size)],
          heightMap[columnIndex(x + 1, z, size)],
          heightMap[columnIndex(x, z - 1, size)],
          heightMap[columnIndex(x, z + 1, size)]
        );

        next[index] = clamp(current, lowestNeighbor - maxStepRows, highestNeighbor + maxStepRows);
      }
    }
    heightMap.set(next);
  }
}

function getFootprintRadius(footprint: TacticalSlot['footprint']): number {
  return footprint.radius ?? Math.max(footprint.halfExtents?.x ?? 2.6, footprint.halfExtents?.z ?? 2.6);
}

function scaleFootprint(footprint: TacticalSlot['footprint'], scale: number): TacticalSlot['footprint'] {
  if (footprint.radius !== undefined) {
    return { ...footprint, radius: footprint.radius * scale };
  }

  if (footprint.halfExtents) {
    return {
      ...footprint,
      halfExtents: {
        x: footprint.halfExtents.x * scale,
        z: footprint.halfExtents.z * scale,
      },
    };
  }

  return footprint;
}

function getSlotRadius(slot: TacticalSlot): number {
  return getFootprintRadius(slot.footprint) * (STRUCTURAL_FOOTPRINT_SCALES[slot.role] ?? 1.12);
}

function getRolePadMinimum(role: TacticalSlotRole): number {
  return STRUCTURAL_PAD_MINIMUMS[role] ?? 3.4;
}

function roleToStructure(slot: TacticalSlot, seed: number): Pick<PlacedStructure, 'kind' | 'moduleId' | 'roleTags'> {
  const variant = hashString(`${seed}:${slot.id}:${slot.role}`) % 5;

  switch (slot.role) {
    case 'base_shell':
      return { kind: 'base_bunker', moduleId: 'base_courtyard', roleTags: ['base_shell', 'base', 'structure'] };
    case 'spawn_shelter':
      return { kind: 'spawn_shelter', moduleId: 'spawn_shelter', roleTags: ['spawn_shelter', 'base', 'structure'] };
    case 'flag_stand':
      return { kind: 'flag_plinth', moduleId: 'flag_pedestal', roleTags: ['flag_stand', 'base', 'structure'] };
    case 'midfield_occluder':
      return {
        kind: variant % 2 === 0 ? 'mid_wall' : 'supported_gate',
        moduleId: 'midfield_wall',
        roleTags: ['midfield_occluder', 'hard_cover_cluster', 'route_cover', 'structure'],
      };
    case 'side_lane_cover_chain':
    case 'hard_cover_cluster':
      return {
        kind: (['ruin_cover', 'cover_cluster', 'terrace_platform'] as const)[variant % 3],
        moduleId: 'side_lane_ruin',
        roleTags: ['side_lane_cover_chain', 'hard_cover_cluster', 'route_cover', 'structure'],
      };
    case 'flank_landmark':
    case 'defender_perch':
      return {
        kind: (['landmark_tower', 'watch_post', 'supported_gate'] as const)[variant % 3],
        moduleId: 'tower_perch',
        roleTags: ['defender_perch', 'flank_landmark', 'landmark', 'structure'],
      };
    case 'elevated_bridge':
    case 'traversal_ramp':
    case 'underpass':
    case 'tunnel_entrance':
      return {
        kind: variant % 3 === 0 ? 'broken_arch' : 'supported_gate',
        moduleId: slot.role === 'underpass' || slot.role === 'tunnel_entrance' ? 'tunnel_segment' : 'bridge_platform',
        roleTags: [slot.role, 'traversal', 'structure'],
      };
    case 'soft_cover_cluster':
    default:
      return {
        kind: (['boulder_patch', 'cover_cluster', 'broken_arch'] as const)[variant % 3],
        moduleId: 'soft_natural_cover_patch',
        roleTags: ['soft_cover_cluster', 'natural', 'route_cover'],
      };
  }
}

function createPlacedStructureFromSlot(seed: number, slot: TacticalSlot, layout: ProceduralCTFLayout, heightMap: Uint16Array): PlacedStructure {
  const structure = roleToStructure(slot, seed);
  const radius = getSlotRadius(slot);
  const padRadius = Math.max(radius + 1.35, getRolePadMinimum(slot.role));
  const surfaceRow = sampleMedianHeight(heightMap, layout.origin, layout.size, layout.voxelSize, slot.position, padRadius);
  const footprintScale = STRUCTURAL_FOOTPRINT_SCALES[slot.role] ?? 1.12;

  return {
    id: `${slot.id}_${structure.kind}`,
    slotId: slot.id,
    kind: structure.kind,
    role: slot.role,
    moduleId: structure.moduleId,
    roleTags: structure.roleTags,
    team: slot.team,
    position: { ...slot.position },
    facing: normalize2D(slot.facing),
    footprint: scaleFootprint(slot.footprint, footprintScale),
    radius,
    padRadius,
    surfaceRow,
    variant: hashString(`${seed}:${slot.id}:${structure.kind}`),
  };
}

function placementOverlaps(
  point: { x: number; z: number },
  radius: number,
  placements: readonly PlacedStructure[],
  extraSpacing = 1.3
): boolean {
  for (const placement of placements) {
    if (distance2D(point, placement.position) < radius + placement.radius + extraSpacing) {
      return true;
    }
  }

  return false;
}

function isProtectedObjectivePoint(point: { x: number; z: number }, layout: ProceduralCTFLayout, radius: number): boolean {
  for (const flag of [layout.flagZones.red, layout.flagZones.blue]) {
    if (distance2D(point, flag) < radius + 5.4) return true;
  }

  for (const spawn of [...layout.spawnPoints.red, ...layout.spawnPoints.blue]) {
    if (distance2D(point, spawn) < radius + 4.8) return true;
  }

  return false;
}

interface DecorativeStructurePalette {
  signature: StructureKind[];
  support: StructureKind[];
}

const SHARED_DECORATIVE_STRUCTURE_KINDS: StructureKind[] = [
  'boulder_patch',
  'crate_stack',
  'ruin_cover',
  'cover_cluster',
  'watch_post',
  'terrace_platform',
  'broken_arch',
  'monument_ring',
];

function getDecorativeStructurePalette(theme: VoxelMapTheme): DecorativeStructurePalette {
  switch (theme.id) {
    case 'basalt':
      return {
        signature: ['basalt_columns', 'bamboo_thicket'],
        support: ['boulder_patch', 'basalt_columns', 'bamboo_thicket', 'cover_cluster'],
      };
    case 'desert':
      return {
        signature: ['cactus_stand', 'desert_outpost'],
        support: ['cactus_stand', 'boulder_patch', 'crate_stack', 'cover_cluster'],
      };
    case 'frost':
      return {
        signature: ['pine_cluster', 'ice_outcrop'],
        support: ['pine_cluster', 'ice_outcrop', 'boulder_patch', 'cover_cluster'],
      };
    case 'crystal':
      return {
        signature: ['crystal_tree_cluster', 'crystal_spire', 'monument_ring', 'basalt_columns'],
        support: ['crystal_tree_cluster', 'crystal_spire', 'boulder_patch', 'basalt_columns'],
      };
    case 'volcanic':
      return {
        signature: ['basalt_columns', 'broken_arch', 'crystal_spire'],
        support: ['basalt_columns', 'boulder_patch', 'crystal_spire', 'ruin_cover'],
      };
    case 'sakura':
      return {
        signature: ['blossom_tree_cluster', 'shrine_gate', 'bamboo_thicket'],
        support: ['blossom_tree_cluster', 'garden_marker', 'bamboo_thicket', 'monument_ring'],
      };
    case 'golden':
      return {
        signature: ['gold_cache', 'monument_ring', 'crystal_spire', 'watch_post'],
        support: ['gold_cache', 'crate_stack', 'monument_ring', 'ruin_cover'],
      };
    case 'verdant':
    default:
      return {
        signature: ['tree_cluster', 'pine_cluster', 'garden_marker'],
        support: ['tree_cluster', 'pine_cluster', 'garden_marker', 'boulder_patch', 'crate_stack'],
      };
  }
}

function chooseDecorativeStructureKind(theme: VoxelMapTheme, random: () => number, acceptedCount: number): StructureKind {
  const palette = getDecorativeStructurePalette(theme);
  const signaturePick = acceptedCount % 4 === 0;
  if (signaturePick) {
    const signatureIndex = Math.floor(acceptedCount / 4) % palette.signature.length;
    return palette.signature[signatureIndex];
  }

  const candidates = random() < 0.16 ? SHARED_DECORATIVE_STRUCTURE_KINDS : palette.support;
  return candidates[Math.floor(random() * candidates.length) % candidates.length];
}

function chooseGapFillerDecorativeStructureKind(theme: VoxelMapTheme, random: () => number): StructureKind {
  const palette = getDecorativeStructurePalette(theme);
  const naturalCandidates = palette.support.filter(
    (kind) =>
      kind !== 'watch_post' &&
      kind !== 'terrace_platform' &&
      kind !== 'desert_outpost' &&
      kind !== 'shrine_gate' &&
      kind !== 'gold_cache'
  );
  const candidates = naturalCandidates.length > 0 ? naturalCandidates : palette.support;
  return candidates[Math.floor(random() * candidates.length) % candidates.length];
}

function getDecorativeStructureMetadata(kind: StructureKind): Pick<PlacedStructure, 'role' | 'moduleId' | 'roleTags'> {
  switch (kind) {
    case 'ruin_cover':
    case 'cover_cluster':
    case 'terrace_platform':
    case 'broken_arch':
    case 'desert_outpost':
      return {
        role: 'soft_cover_cluster',
        moduleId: 'side_lane_ruin',
        roleTags: ['soft_cover_cluster', 'route_cover', 'structure'],
      };
    case 'watch_post':
    case 'monument_ring':
    case 'shrine_gate':
    case 'gold_cache':
      return {
        role: 'flank_landmark',
        moduleId: 'tower_perch',
        roleTags: ['flank_landmark', 'landmark', 'structure'],
      };
    case 'boulder_patch':
    case 'crystal_spire':
    case 'tree_cluster':
    case 'pine_cluster':
    case 'blossom_tree_cluster':
    case 'crystal_tree_cluster':
    case 'cactus_stand':
    case 'bamboo_thicket':
    case 'basalt_columns':
    case 'ice_outcrop':
    case 'crate_stack':
    case 'garden_marker':
    default:
      return {
        role: 'flank_landmark',
        moduleId: 'soft_natural_cover_patch',
        roleTags: ['flank_landmark', 'natural', 'landmark'],
      };
  }
}

function getDecorativeTargetCount(layout: ProceduralCTFLayout, random: () => number): number {
  const areaTarget = Math.round(polygonArea(layout.boundary) / DECORATIVE_OBJECT_AREA_PER_COUNT);
  return clamp(
    areaTarget + Math.floor(random() * DECORATIVE_OBJECT_VARIANCE),
    DECORATIVE_OBJECT_MIN_COUNT,
    DECORATIVE_OBJECT_MAX_COUNT
  );
}

function canPlaceDecorativeStructure(
  point: { x: number; z: number },
  radius: number,
  layout: ProceduralCTFLayout,
  existing: readonly PlacedStructure[],
  accepted: readonly PlacedStructure[],
  spacing: number
): boolean {
  if (!isInsideBoundaryPolygon(point.x, point.z, layout.boundary)) return false;
  if (distanceToBoundary(point.x, point.z, layout.boundary) < radius + 1.8) return false;
  if (isProtectedObjectivePoint(point, layout, radius)) return false;
  if (placementOverlaps(point, radius, existing, spacing)) return false;
  if (placementOverlaps(point, radius, accepted, spacing)) return false;
  return true;
}

function distanceToNearestPlacementEdge(point: { x: number; z: number }, placements: readonly PlacedStructure[]): number {
  let closestDistance = Infinity;

  for (const placement of placements) {
    closestDistance = Math.min(closestDistance, distance2D(point, placement.position) - placement.radius);
  }

  return closestDistance;
}

function createDecorativePlacement(
  index: number,
  kind: StructureKind,
  point: { x: number; z: number },
  radius: number,
  random: () => number,
  layout: ProceduralCTFLayout,
  heightMap: Uint16Array
): PlacedStructure {
  const metadata = getDecorativeStructureMetadata(kind);
  const surfaceRow = sampleMedianHeight(heightMap, layout.origin, layout.size, layout.voxelSize, point, radius + 1);

  return {
    id: `dressing_${index + 1}_${kind}`,
    slotId: `dressing_${index + 1}`,
    kind,
    role: metadata.role,
    moduleId: metadata.moduleId,
    roleTags: metadata.roleTags,
    position: { x: point.x, y: gridRowsToWorldY(surfaceRow, layout.origin.y, layout.voxelSize.y), z: point.z },
    facing: normalize2D({ x: random() - 0.5, z: random() - 0.5 }),
    footprint: { shape: 'circle', radius },
    radius,
    padRadius: radius + 0.85,
    surfaceRow,
    variant: Math.floor(random() * 0xffffffff) >>> 0,
  };
}

function fillDecorativeGaps(
  seed: number,
  layout: ProceduralCTFLayout,
  theme: VoxelMapTheme,
  heightMap: Uint16Array,
  placements: readonly PlacedStructure[],
  accepted: PlacedStructure[],
  targetCount: number
): void {
  const random = mulberry32(seed ^ 0x6f70656e);
  const bounds = boundaryBounds(layout.boundary);
  const maxCount = Math.min(DECORATIVE_OBJECT_MAX_COUNT + DECORATIVE_GAP_EXTRA_COUNT, targetCount + DECORATIVE_GAP_EXTRA_COUNT);
  const candidates: Array<{ point: { x: number; z: number }; radius: number; openDistance: number; tieBreak: number }> = [];

  for (let z = bounds.minZ + 3; z <= bounds.maxZ - 3; z += DECORATIVE_GAP_GRID_STEP) {
    for (let x = bounds.minX + 3; x <= bounds.maxX - 3; x += DECORATIVE_GAP_GRID_STEP) {
      const point = {
        x: x + lerp(-DECORATIVE_GAP_JITTER, DECORATIVE_GAP_JITTER, random()),
        z: z + lerp(-DECORATIVE_GAP_JITTER, DECORATIVE_GAP_JITTER, random()),
      };
      const radius = lerp(1.05, 2.25, random());
      const existing = [...placements, ...accepted];

      if (!canPlaceDecorativeStructure(point, radius, layout, placements, accepted, 0.55)) continue;

      candidates.push({
        point,
        radius,
        openDistance: distanceToNearestPlacementEdge(point, existing),
        tieBreak: random(),
      });
    }
  }

  candidates.sort((candidateA, candidateB) => candidateB.openDistance - candidateA.openDistance || candidateA.tieBreak - candidateB.tieBreak);

  for (const candidate of candidates) {
    if (accepted.length >= maxCount) break;

    const openDistance = distanceToNearestPlacementEdge(candidate.point, [...placements, ...accepted]);
    if (accepted.length >= targetCount && openDistance < DECORATIVE_LARGE_EMPTY_RADIUS) continue;
    if (!canPlaceDecorativeStructure(candidate.point, candidate.radius, layout, placements, accepted, 0.55)) continue;

    const kind = chooseGapFillerDecorativeStructureKind(theme, random);
    accepted.push(createDecorativePlacement(accepted.length, kind, candidate.point, candidate.radius, random, layout, heightMap));
  }
}

function createDecorativePlacements(
  seed: number,
  layout: ProceduralCTFLayout,
  theme: VoxelMapTheme,
  heightMap: Uint16Array,
  placements: PlacedStructure[]
): PlacedStructure[] {
  const random = mulberry32(seed ^ 0xa17c9e3b);
  const bounds = boundaryBounds(layout.boundary);
  const targetCount = getDecorativeTargetCount(layout, random);
  const randomTargetCount = Math.max(DECORATIVE_OBJECT_MIN_COUNT, Math.ceil(targetCount * DECORATIVE_RANDOM_FILL_RATIO));
  const accepted: PlacedStructure[] = [];

  for (let attempt = 0; attempt < RANDOM_OBJECT_ATTEMPTS && accepted.length < randomTargetCount; attempt++) {
    const isFillerPass = attempt > RANDOM_OBJECT_ATTEMPTS * 0.62;
    const x = lerp(bounds.minX + 3, bounds.maxX - 3, random());
    const z = lerp(bounds.minZ + 3, bounds.maxZ - 3, random());
    const radius = isFillerPass ? lerp(1.1, 2.4, random()) : lerp(1.35, 3.45, Math.pow(random(), 0.85));
    const point = { x, z };
    const spacing = isFillerPass ? 0.7 : 1.15;
    if (!canPlaceDecorativeStructure(point, radius, layout, placements, accepted, spacing)) continue;

    const kind = chooseDecorativeStructureKind(theme, random, accepted.length);
    accepted.push(createDecorativePlacement(accepted.length, kind, point, radius, random, layout, heightMap));
  }

  fillDecorativeGaps(seed, layout, theme, heightMap, placements, accepted, targetCount);

  return accepted;
}

function createPlacedStructures(
  seed: number,
  construction: MapConstructionResult,
  layout: ProceduralCTFLayout,
  theme: VoxelMapTheme,
  heightMap: Uint16Array
): PlacedStructure[] {
  const required = construction.blueprint.tacticalSlots.map((slot) =>
    createPlacedStructureFromSlot(seed, slot, layout, heightMap)
  );
  const decorative = createDecorativePlacements(seed, layout, theme, heightMap, required);
  return [...required, ...decorative];
}

function flattenStructurePads(heightMap: Uint16Array, layout: ProceduralCTFLayout, placements: PlacedStructure[]): void {
  for (const placement of placements) {
    const isDecorative = placement.slotId.startsWith('dressing_');
    const blendRadius = Math.max(isDecorative ? 1.1 : 1.8, placement.padRadius * (isDecorative ? 0.22 : 0.35));
    flattenDisc(
      heightMap,
      layout.origin,
      layout.size,
      layout.voxelSize,
      placement.position,
      placement.padRadius,
      placement.surfaceRow,
      blendRadius
    );
  }
}

function updatePlacementSurfaceRows(heightMap: Uint16Array, layout: ProceduralCTFLayout, placements: PlacedStructure[]): void {
  for (const placement of placements) {
    placement.surfaceRow = heightRowAtWorld(heightMap, layout.origin, layout.size, layout.voxelSize, placement.position);
    placement.position.y = gridRowsToWorldY(placement.surfaceRow, layout.origin.y, layout.voxelSize.y);
  }
}

function setBlock(ctx: StructureStampContext, x: number, y: number, z: number, block: number): void {
  if (x < 0 || x >= ctx.size.x || y < 0 || y >= ctx.size.y || z < 0 || z >= ctx.size.z) return;
  ctx.blocks[blockIndex(x, y, z, ctx.size)] = block;
}

function isBoundaryAnchorCandidate(
  ctx: StructureStampContext,
  layout: ProceduralCTFLayout,
  x: number,
  z: number
): boolean {
  const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
  const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
  return distanceToBoundary(worldX, worldZ, layout.boundary) <= BOUNDARY_FLOATING_DETAIL_ANCHOR_DISTANCE;
}

function anchorFloatingComponent(ctx: StructureStampContext, cell: { x: number; y: number; z: number }): void {
  let groundY = -1;
  for (let y = cell.y - 1; y >= 0; y--) {
    if (!isCollisionBlock(ctx.blocks[blockIndex(cell.x, y, cell.z, ctx.size)])) continue;
    groundY = y;
    break;
  }

  for (let y = Math.max(0, groundY + 1); y < cell.y; y++) {
    setBlock(ctx, cell.x, y, cell.z, ctx.palette.wall);
  }
}

interface SolidComponentInfo {
  indices: number[];
  count: number;
  touchesGround: boolean;
  boundaryCandidate: boolean;
  anchorCell: { x: number; y: number; z: number };
}

function visitSolidComponents(
  ctx: StructureStampContext,
  layout: ProceduralCTFLayout,
  visit: (component: SolidComponentInfo) => void
): void {
  const visited = new Uint8Array(ctx.blocks.length);
  const queue: number[] = [];
  const directions = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const;

  for (let y = 0; y < ctx.size.y; y++) {
    for (let z = 0; z < ctx.size.z; z++) {
      for (let x = 0; x < ctx.size.x; x++) {
        const start = blockIndex(x, y, z, ctx.size);
        if (visited[start] || !isCollisionBlock(ctx.blocks[start])) continue;

        visited[start] = 1;
        queue.length = 0;
        queue.push(start);
        let count = 0;
        let touchesGround = y === 0;
        let boundaryCandidate = false;
        let anchorCell = { x, y, z };

        for (let cursor = 0; cursor < queue.length; cursor++) {
          const current = queue[cursor];
          const cx = current % ctx.size.x;
          const cy = Math.floor(current / (ctx.size.x * ctx.size.z));
          const cz = Math.floor((current - cy * ctx.size.x * ctx.size.z) / ctx.size.x);
          count++;

          if (cy === 0) touchesGround = true;
          if (cy < anchorCell.y) anchorCell = { x: cx, y: cy, z: cz };
          if (!boundaryCandidate) boundaryCandidate = isBoundaryAnchorCandidate(ctx, layout, cx, cz);

          for (const [dx, dy, dz] of directions) {
            const nx = cx + dx;
            const ny = cy + dy;
            const nz = cz + dz;
            if (nx < 0 || nx >= ctx.size.x || ny < 0 || ny >= ctx.size.y || nz < 0 || nz >= ctx.size.z) continue;

            const next = blockIndex(nx, ny, nz, ctx.size);
            if (visited[next] || !isCollisionBlock(ctx.blocks[next])) continue;
            visited[next] = 1;
            queue.push(next);
          }
        }

        visit({
          indices: [...queue],
          count,
          touchesGround,
          boundaryCandidate,
          anchorCell,
        });
      }
    }
  }
}

function anchorBoundaryFloatingDetails(ctx: StructureStampContext, layout: ProceduralCTFLayout): void {
  visitSolidComponents(ctx, layout, ({ touchesGround, boundaryCandidate, count, anchorCell }) => {
    if (!touchesGround && boundaryCandidate && count <= BOUNDARY_FLOATING_DETAIL_MAX_BLOCKS) {
      anchorFloatingComponent(ctx, anchorCell);
    }
  });
}

function removeSmallFloatingFragments(ctx: StructureStampContext, layout: ProceduralCTFLayout, maxBlocks: number): void {
  visitSolidComponents(ctx, layout, ({ touchesGround, count, indices }) => {
    if (touchesGround || count > maxBlocks) return;

    for (const current of indices) {
      const x = current % ctx.size.x;
      const y = Math.floor(current / (ctx.size.x * ctx.size.z));
      const z = Math.floor((current - y * ctx.size.x * ctx.size.z) / ctx.size.x);
      setBlock(ctx, x, y, z, AIR);
    }
  });
}

function fillBox(
  ctx: StructureStampContext,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  block: number
): void {
  const x0 = clamp(Math.floor(minX), 0, ctx.size.x - 1);
  const x1 = clamp(Math.ceil(maxX), 0, ctx.size.x - 1);
  const y0 = clamp(Math.floor(minY), 0, ctx.size.y - 1);
  const y1 = clamp(Math.ceil(maxY), 0, ctx.size.y - 1);
  const z0 = clamp(Math.floor(minZ), 0, ctx.size.z - 1);
  const z1 = clamp(Math.ceil(maxZ), 0, ctx.size.z - 1);

  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        setBlock(ctx, x, y, z, block);
      }
    }
  }
}

function localToWorld(
  placement: PlacedStructure,
  localSide: number,
  localForward: number
): { x: number; z: number } {
  const normal = perpendicular(placement.facing);
  return {
    x: placement.position.x + normal.x * localSide + placement.facing.x * localForward,
    z: placement.position.z + normal.z * localSide + placement.facing.z * localForward,
  };
}

function stampOrientedBoxAtLocal(
  ctx: StructureStampContext,
  placement: PlacedStructure,
  localSide: number,
  localForward: number,
  width: number,
  depth: number,
  minY: number,
  maxY: number,
  block: number
): void {
  const center = localToWorld(placement, localSide, localForward);
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const bound = Math.sqrt(halfWidth * halfWidth + halfDepth * halfDepth) + Math.max(ctx.voxelSize.x, ctx.voxelSize.z);
  const minX = worldToGrid(center.x - bound, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const maxX = worldToGrid(center.x + bound, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const minZ = worldToGrid(center.z - bound, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const maxZ = worldToGrid(center.z + bound, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const normal = perpendicular(placement.facing);

  for (let z = minZ; z <= maxZ; z++) {
    const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
    for (let x = minX; x <= maxX; x++) {
      const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
      const dx = worldX - center.x;
      const dz = worldZ - center.z;
      const side = dx * normal.x + dz * normal.z;
      const forward = dx * placement.facing.x + dz * placement.facing.z;
      if (Math.abs(side) > halfWidth || Math.abs(forward) > halfDepth) continue;

      for (let y = minY; y <= maxY; y++) {
        setBlock(ctx, x, y, z, block);
      }
    }
  }
}

function stampDisc(ctx: StructureStampContext, center: { x: number; z: number }, radius: number, y: number, block: number): void {
  const minX = worldToGrid(center.x - radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const maxX = worldToGrid(center.x + radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const minZ = worldToGrid(center.z - radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const maxZ = worldToGrid(center.z + radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const radiusSq = radius * radius;

  for (let z = minZ; z <= maxZ; z++) {
    const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
    for (let x = minX; x <= maxX; x++) {
      const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
      if ((worldX - center.x) ** 2 + (worldZ - center.z) ** 2 <= radiusSq) {
        setBlock(ctx, x, y, z, block);
      }
    }
  }
}

function stampDiscStack(
  ctx: StructureStampContext,
  center: { x: number; z: number },
  radius: number,
  minY: number,
  maxY: number,
  block: number
): void {
  const y0 = clamp(Math.floor(minY), 0, ctx.size.y - 1);
  const y1 = clamp(Math.ceil(maxY), 0, ctx.size.y - 1);
  for (let y = y0; y <= y1; y++) stampDisc(ctx, center, radius, y, block);
}

function stampDiscStackAtLocal(
  ctx: StructureStampContext,
  placement: PlacedStructure,
  localSide: number,
  localForward: number,
  radius: number,
  minY: number,
  maxY: number,
  block: number
): void {
  stampDiscStack(ctx, localToWorld(placement, localSide, localForward), radius, minY, maxY, block);
}

function stampPillar(
  ctx: StructureStampContext,
  placement: PlacedStructure,
  localSide: number,
  localForward: number,
  width: number,
  minY: number,
  maxY: number,
  block: number
): void {
  stampOrientedBoxAtLocal(ctx, placement, localSide, localForward, width, width, minY, maxY, block);
}

function variantUnit(placement: PlacedStructure, shift = 0): number {
  return ((placement.variant >>> shift) & 0xff) / 255;
}

function getStructureScale(placement: PlacedStructure, min = 1, max = 1.2): number {
  const decorativeScale = placement.slotId.startsWith('dressing_') ? clamp(placement.radius / 2.8, 0.85, 1.45) : 1;
  return lerp(min, max, variantUnit(placement, 8)) * decorativeScale;
}

function stampBaseBunker(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.12, 1.28);
  const width = 10.8 * scale;
  const depth = 8.2 * scale;
  const wallHeight = 10 + (placement.variant % 5);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, -depth / 2 + 0.45 * scale, width, 0.9 * scale, row + 1, row + wallHeight, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.45 * scale, -0.3, 0.9 * scale, depth - 0.8 * scale, row + 1, row + wallHeight, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.45 * scale, -0.3, 0.9 * scale, depth - 0.8 * scale, row + 1, row + wallHeight, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 1.55 * scale, depth / 2 - 0.55 * scale, 1.9 * scale, 1.0 * scale, row + 1, row + 5, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 1.55 * scale, depth / 2 - 0.55 * scale, 1.9 * scale, 1.0 * scale, row + 1, row + 5, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0.9 * scale, 2.8 * scale, 0.9 * scale, row + 1, row + 4, placement.team === 'red' ? ctx.palette.red : ctx.palette.blue);
  stampPillar(ctx, placement, -width * 0.18, -0.25 * scale, 0.8 * scale, row + 1, row + wallHeight + 1, ctx.palette.wall);
  stampPillar(ctx, placement, width * 0.18, -0.25 * scale, 0.8 * scale, row + 1, row + wallHeight + 1, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0, -0.35 * scale, width * 0.46, depth * 0.42, row + wallHeight + 1, row + wallHeight + 1, ctx.palette.trim);
}

function stampSpawnShelter(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.1, 1.24);
  const width = 8.5 * scale;
  const depth = 6.2 * scale;
  const canopyRow = row + 13 + (placement.variant % 4);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row, placement.team === 'red' ? ctx.palette.spawnRed : ctx.palette.spawnBlue);
  for (const side of [-1, 1]) {
    for (const forward of [-1, 1]) {
      stampPillar(ctx, placement, side * (width / 2 - 0.7 * scale), forward * (depth / 2 - 0.7 * scale), 0.8 * scale, row + 1, canopyRow, ctx.palette.wall);
    }
  }
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width + 0.9 * scale, depth + 0.9 * scale, canopyRow, canopyRow + 2, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, -depth / 2 + 0.55 * scale, width - 1.6 * scale, 0.75 * scale, row + 1, row + 5, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0, depth / 2 - 0.55 * scale, width * 0.38, 0.65 * scale, row + 1, row + 4, ctx.palette.wall);
}

function stampFlagPlinth(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const teamBlock = placement.team === 'red' ? ctx.palette.red : ctx.palette.blue;
  stampDisc(ctx, placement.position, FLAG_PAD_RADIUS, row, ctx.palette.flag);
  stampDisc(ctx, placement.position, 1.55, row + 1, teamBlock);
  for (const side of [-1, 1]) {
    stampPillar(ctx, placement, side * 2.25, -2.25, 0.55, row, row + 5, ctx.palette.trim);
    stampPillar(ctx, placement, side * 2.25, 2.25, 0.55, row, row + 5, ctx.palette.trim);
  }
}

function stampMidWall(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.08, 1.28);
  const width = 14.6 * scale;
  const height = 11 + (placement.variant % 7);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, 1.35 * scale, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width * 0.28, 1.0 * scale, 2.8 * scale, 1.2 * scale, row, row + 5, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, width * 0.28, -1.0 * scale, 2.8 * scale, 1.2 * scale, row, row + 5, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width + 0.75 * scale, 0.7 * scale, row + height + 1, row + height + 2, ctx.palette.trim);
}

function stampRuinCover(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 4);
  const scale = getStructureScale(placement, 1.05, 1.28);
  const width = (7.2 + (placement.variant % 3) * 0.8) * scale;
  const height = 7 + (placement.variant % 4);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, 1.0 * scale, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.65 * scale, 1.9 * scale, 1.15 * scale, 3.7 * scale, row, row + height - 2, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.8 * scale, -1.65 * scale, 1.45 * scale, 2.9 * scale, row, row + 4, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0.2 * scale, 3.05 * scale, width * 0.24, 0.9 * scale, baseRow, row, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0.2 * scale, 3.05 * scale, width * 0.68, 0.8 * scale, row + 1, row + 2, ctx.palette.trim);
}

function stampLandmarkTower(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.08, 1.25);
  const height = 16 + (placement.variant % 8);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, 3.9 * scale, 3.9 * scale, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, 5.2 * scale, 5.2 * scale, row, row + 2, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, 4.8 * scale, 4.8 * scale, row + height + 1, row + height + 2, ctx.palette.trim);
  stampPillar(ctx, placement, 0, 0, 1.35 * scale, row + height + 3, row + height + 7, placement.team === 'blue' ? ctx.palette.blue : ctx.palette.red);
}

function stampSupportedGate(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.08, 1.25);
  const width = 7.8 * scale;
  const height = 12 + (placement.variant % 6);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.8 * scale, 0, 1.55 * scale, 3.3 * scale, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.8 * scale, 0, 1.55 * scale, 3.3 * scale, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, 1.7 * scale, row + height + 1, row + height + 3, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, -1.85 * scale, width - 2.0 * scale, 0.9 * scale, row, row + 2, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, 1.85 * scale, width - 2.0 * scale, 0.9 * scale, row, row + 2, ctx.palette.floor);
}

function stampCoverCluster(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.05, 1.28);
  const offsets = [
    { side: -1.9, forward: -0.7, width: 2.2, depth: 1.8, height: 5 },
    { side: 0.45, forward: 0.55, width: 2.8, depth: 1.9, height: 6 },
    { side: 2.25, forward: -1.25, width: 1.7, depth: 2.1, height: 4 },
  ];
  for (const offset of offsets) {
    stampOrientedBoxAtLocal(
      ctx,
      placement,
      offset.side * scale,
      offset.forward * scale,
      offset.width * scale,
      offset.depth * scale,
      row,
      row + offset.height + (placement.variant % 3),
      offset.height >= 4 ? ctx.palette.wall : ctx.palette.floor
    );
  }
}

function stampWatchPost(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.05, 1.28);
  const width = 4.7 * scale;
  const depth = 4.2 * scale;
  const deckRow = row + 11 + (placement.variant % 5);

  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row + 1, ctx.palette.floor);
  for (const side of [-1, 1]) {
    for (const forward of [-1, 1]) {
      stampPillar(ctx, placement, side * (width / 2 - 0.55 * scale), forward * (depth / 2 - 0.55 * scale), 0.8 * scale, row + 1, deckRow, ctx.palette.wall);
    }
  }
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width + 0.8 * scale, depth + 0.8 * scale, deckRow, deckRow + 1, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width * 0.72, depth * 0.72, deckRow + 2, deckRow + 4, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width + 1.1 * scale, depth + 1.1 * scale, deckRow + 5, deckRow + 6, ctx.palette.trim);
}

function stampTerracePlatform(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.05, 1.3);
  const width = 7.8 * scale;
  const depth = 5.4 * scale;
  const raisedRow = row + 3 + (placement.variant % 3);

  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row + 1, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, -width * 0.22, 0, width * 0.48, depth * 0.78, row + 2, raisedRow, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width * 0.24, 0.2 * scale, width * 0.24, depth * 0.36, row + 2, raisedRow + 1, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width * 0.24, 0.2 * scale, width * 0.42, depth * 0.58, raisedRow + 1, raisedRow + 2, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, -depth / 2 + 0.45 * scale, width, 0.7 * scale, row + 2, row + 5, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.45 * scale, 0, 0.7 * scale, depth, row + 2, row + 4, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.45 * scale, depth * 0.18, 0.7 * scale, depth * 0.52, row + 2, row + 4, ctx.palette.wall);
}

function stampBrokenArch(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.05, 1.28);
  const width = 6.7 * scale;
  const height = 10 + (placement.variant % 6);

  stampPillar(ctx, placement, -width / 2 + 0.75 * scale, 0, 1.3 * scale, row, row + height, ctx.palette.wall);
  stampPillar(ctx, placement, width / 2 - 0.75 * scale, 0, 1.3 * scale, row, row + Math.max(5, height - 4), ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width * 0.14, 0, width * 0.72, 1.2 * scale, row + height + 1, row + height + 2, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, width * 0.3, -1.8 * scale, width * 0.34, 0.9 * scale, row, row + 3, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, -width * 0.34, 1.75 * scale, width * 0.28, 0.9 * scale, row, row + 4, ctx.palette.wall);
}

function stampMonumentRing(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.05, 1.3);
  const radius = 2.6 * scale;
  const pillarCount = 6;
  const height = 7 + (placement.variant % 5);

  stampDisc(ctx, placement.position, radius * 1.05, row, ctx.palette.floor);
  stampDisc(ctx, placement.position, radius * 0.34, row + 1, ctx.palette.trim);
  for (let index = 0; index < pillarCount; index++) {
    const angle = (index / pillarCount) * Math.PI * 2 + variantUnit(placement, 16) * 0.45;
    const side = Math.cos(angle) * radius;
    const forward = Math.sin(angle) * radius;
    stampPillar(ctx, placement, side, forward, 0.65 * scale, row + 1, row + height, index % 2 === 0 ? ctx.palette.wall : ctx.palette.trim);
  }
}

function stampBoulderPatch(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const count = 5 + (placement.variant % 4);
  const spread = Math.max(2.4, placement.radius * 0.85);
  const random = mulberry32(placement.variant ^ 0x6b6f756c);
  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.82, spread * 0.82, random());
    const width = lerp(1.05, 2.35, random());
    const height = 2 + Math.floor(random() * 5);
    stampOrientedBoxAtLocal(ctx, placement, side, forward, width, width * lerp(0.85, 1.35, random()), row, row + height, ctx.palette.stone);
  }
}

function stampCrystalSpire(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 3);
  const scale = getStructureScale(placement, 1.05, 1.35);
  const height = 8 + (placement.variant % 8);
  stampPillar(ctx, placement, 0, 0, 1.35 * scale, baseRow, row + height, ctx.palette.trim);
  stampPillar(ctx, placement, -1.55 * scale, 1.05 * scale, 0.9 * scale, baseRow, row + Math.max(4, height - 4), ctx.palette.glass);
  stampPillar(ctx, placement, 1.35 * scale, -1.0 * scale, 0.8 * scale, baseRow, row + Math.max(4, height - 2), ctx.palette.glass);
}

function stampBroadleafCrown(
  ctx: StructureStampContext,
  placement: PlacedStructure,
  localSide: number,
  localForward: number,
  baseRow: number,
  radius: number,
  foliageBlock: number,
  accentBlock: number,
  random: () => number
): void {
  const sideDrift = lerp(-0.28, 0.28, random());
  const forwardDrift = lerp(-0.24, 0.24, random());
  const crownSide = localSide + sideDrift;
  const crownForward = localForward + forwardDrift;

  stampDiscStackAtLocal(ctx, placement, crownSide, crownForward, radius * 0.82, baseRow, baseRow + 1, accentBlock);
  stampDiscStackAtLocal(ctx, placement, crownSide - radius * 0.14, crownForward + radius * 0.1, radius, baseRow + 2, baseRow + 3, foliageBlock);
  stampDiscStackAtLocal(ctx, placement, crownSide + radius * 0.18, crownForward - radius * 0.08, radius * 0.72, baseRow + 4, baseRow + 5, foliageBlock);
  stampDiscStackAtLocal(ctx, placement, crownSide, crownForward + radius * 0.16, radius * 0.48, baseRow + 6, baseRow + 6, accentBlock);
}

function stampTreeCluster(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 2);
  const scale = getStructureScale(placement, 0.9, 1.12);
  const count = 2 + (placement.variant % 3);
  const spread = Math.max(1.9, placement.radius * 0.72);
  const random = mulberry32(placement.variant ^ 0x74726565);

  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.75, spread * 0.75, random());
    const trunkWidth = lerp(0.42, 0.68, random()) * scale;
    const trunkHeight = 8 + Math.floor(random() * 5);
    const crownRadius = lerp(1.35, 2.1, random()) * scale;
    stampPillar(ctx, placement, side, forward, trunkWidth, baseRow, row + trunkHeight, ctx.palette.wood);
    if (random() > 0.42) {
      const branchSide = side + lerp(-0.8, 0.8, random()) * scale;
      stampOrientedBoxAtLocal(ctx, placement, (side + branchSide) / 2, forward, Math.abs(branchSide - side) + trunkWidth, trunkWidth * 0.72, row + trunkHeight - 2, row + trunkHeight - 1, ctx.palette.wood);
    }
    stampBroadleafCrown(ctx, placement, side, forward, row + trunkHeight - 2, crownRadius, ctx.palette.foliage, ctx.palette.foliage, random);
  }
}

function stampPineCluster(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 2);
  const scale = getStructureScale(placement, 0.9, 1.18);
  const count = 2 + (placement.variant % 3);
  const spread = Math.max(1.8, placement.radius * 0.68);
  const snow = getBlockNumericId('snow');
  const random = mulberry32(placement.variant ^ 0x70696e65);

  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.75, spread * 0.75, random());
    const trunkWidth = lerp(0.38, 0.58, random()) * scale;
    const trunkHeight = 9 + Math.floor(random() * 5);
    const crownRadius = lerp(1.35, 1.85, random()) * scale;
    const layerCount = 4 + Math.floor(random() * 2);
    stampPillar(ctx, placement, side, forward, trunkWidth, baseRow, row + trunkHeight + layerCount, ctx.palette.wood);

    for (let layer = 0; layer < layerCount; layer++) {
      const layerRow = row + trunkHeight - 4 + layer * 2;
      const layerRadius = Math.max(0.45 * scale, crownRadius - layer * 0.28 * scale);
      stampDiscStackAtLocal(ctx, placement, side, forward, layerRadius, layerRow, layerRow + 1, ctx.palette.foliage);
    }

    if (ctx.themeId === 'frost') {
      const capRow = row + trunkHeight - 4 + layerCount * 2;
      stampDiscStackAtLocal(ctx, placement, side, forward, crownRadius * 0.42, capRow, capRow, snow);
    }
  }
}

function stampBlossomTreeCluster(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 2);
  const scale = getStructureScale(placement, 0.95, 1.18);
  const count = 1 + (placement.variant % 3);
  const spread = Math.max(1.7, placement.radius * 0.64);
  const leafShadow = getBlockNumericId('leaves');
  const random = mulberry32(placement.variant ^ 0xb10550);

  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.7, spread * 0.7, random());
    const trunkWidth = lerp(0.44, 0.68, random()) * scale;
    const trunkHeight = 7 + Math.floor(random() * 5);
    const crownRadius = lerp(1.55, 2.25, random()) * scale;
    stampPillar(ctx, placement, side, forward, trunkWidth, baseRow, row + trunkHeight, ctx.palette.wood);
    stampOrientedBoxAtLocal(ctx, placement, side - 0.42 * scale, forward + 0.18 * scale, 1.4 * scale, trunkWidth * 0.72, row + trunkHeight - 2, row + trunkHeight - 1, ctx.palette.wood);
    stampDiscStackAtLocal(ctx, placement, side, forward, crownRadius * 0.72, row + trunkHeight - 2, row + trunkHeight - 1, leafShadow);
    stampBroadleafCrown(ctx, placement, side, forward, row + trunkHeight - 1, crownRadius, ctx.palette.foliage, ctx.palette.foliage, random);
  }
}

function stampCrystalTreeCluster(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 3);
  const scale = getStructureScale(placement, 0.92, 1.16);
  const count = 2 + (placement.variant % 2);
  const spread = Math.max(1.6, placement.radius * 0.62);
  const crystal = ctx.themeId === 'golden' ? getBlockNumericId('crystal_growth') : ctx.palette.glass;
  const random = mulberry32(placement.variant ^ 0xc2757a1);

  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.75, spread * 0.75, random());
    const trunkHeight = 6 + Math.floor(random() * 4);
    const trunkWidth = lerp(0.46, 0.7, random()) * scale;
    const crownRadius = lerp(0.95, 1.35, random()) * scale;
    stampPillar(ctx, placement, side, forward, trunkWidth, baseRow, row + trunkHeight, ctx.palette.stone);
    stampPillar(ctx, placement, side, forward, trunkWidth * 0.78, row + trunkHeight - 1, row + trunkHeight + 5, crystal);
    stampDiscStackAtLocal(ctx, placement, side, forward, crownRadius, row + trunkHeight + 1, row + trunkHeight + 2, ctx.palette.glass);
    stampDiscStackAtLocal(ctx, placement, side + 0.35 * scale, forward - 0.22 * scale, crownRadius * 0.62, row + trunkHeight + 3, row + trunkHeight + 4, crystal);
    stampPillar(ctx, placement, side - 0.85 * scale, forward + 0.48 * scale, trunkWidth * 0.62, row + trunkHeight - 1, row + trunkHeight + 2, ctx.palette.glass);
  }
}

function stampCactusArm(
  ctx: StructureStampContext,
  placement: PlacedStructure,
  localSide: number,
  localForward: number,
  width: number,
  armOffset: number,
  armY: number,
  armHeight: number,
  block: number
): void {
  stampOrientedBoxAtLocal(ctx, placement, localSide + armOffset / 2, localForward, Math.abs(armOffset) + width, width * 0.82, armY, armY, block);
  stampPillar(ctx, placement, localSide + armOffset, localForward, width * 0.82, armY, armY + armHeight, block);
}

function stampCactusStand(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 2);
  const cactus = getBlockNumericId('cactus');
  const count = 3 + (placement.variant % 3);
  const spread = Math.max(1.7, placement.radius * 0.68);
  const random = mulberry32(placement.variant ^ 0xcaC715);

  stampDisc(ctx, placement.position, Math.min(placement.radius * 0.75, 2.6), row, ctx.palette.terrainTop);
  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.75, spread * 0.75, random());
    const form = Math.floor(random() * 3);

    if (form === 0) {
      const height = 7 + Math.floor(random() * 7);
      const width = lerp(0.58, 0.88, random());
      stampPillar(ctx, placement, side, forward, width, baseRow, row + height, cactus);
      stampCactusArm(ctx, placement, side, forward, width, random() > 0.5 ? 0.9 : -0.9, row + Math.floor(height * 0.52), 2 + Math.floor(random() * 3), cactus);
      if (random() > 0.48) {
        stampCactusArm(ctx, placement, side, forward, width * 0.9, random() > 0.5 ? 1.1 : -1.1, row + Math.floor(height * 0.68), 1 + Math.floor(random() * 2), cactus);
      }
      continue;
    }

    if (form === 1) {
      const width = lerp(1.0, 1.4, random());
      const height = 3 + Math.floor(random() * 3);
      stampPillar(ctx, placement, side, forward, width, baseRow, row + height, cactus);
      stampDiscStackAtLocal(ctx, placement, side, forward, width * 0.55, row + height + 1, row + height + 1, cactus);
      continue;
    }

    const stems = 2 + Math.floor(random() * 3);
    for (let stem = 0; stem < stems; stem++) {
      const stemSide = side + lerp(-0.7, 0.7, random());
      const stemForward = forward + lerp(-0.55, 0.55, random());
      const height = 4 + Math.floor(random() * 5);
      const width = lerp(0.42, 0.62, random());
      stampPillar(ctx, placement, stemSide, stemForward, width, baseRow, row + height, cactus);
    }
  }
}

function stampBambooThicket(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 3);
  const bamboo = getBlockNumericId('bamboo');
  const count = 6 + (placement.variant % 5);
  const spread = Math.max(1.8, placement.radius * 0.78);
  const random = mulberry32(placement.variant ^ 0xbab00);

  stampDisc(ctx, placement.position, Math.min(placement.radius + 0.45, 3.2), row, ctx.palette.floor);
  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread, spread, random());
    const width = lerp(0.42, 0.62, random());
    const height = 7 + Math.floor(random() * 7);
    stampPillar(ctx, placement, side, forward, width, baseRow, row + height, bamboo);
  }
}

function stampBasaltColumns(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 3);
  const obsidian = getBlockNumericId('obsidian');
  const count = 4 + (placement.variant % 4);
  const spread = Math.max(1.9, placement.radius * 0.78);
  const random = mulberry32(placement.variant ^ 0xba5a17);

  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.8, spread * 0.8, random());
    const width = lerp(0.9, 1.65, random());
    const height = 5 + Math.floor(random() * 9);
    stampPillar(ctx, placement, side, forward, width, baseRow, row + height, index % 3 === 0 ? ctx.palette.stone : obsidian);
  }
}

function stampIceOutcrop(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const baseRow = Math.max(0, row - 3);
  const ice = getBlockNumericId('ice');
  const snow = getBlockNumericId('snow');
  const count = 4 + (placement.variant % 3);
  const spread = Math.max(1.8, placement.radius * 0.72);
  const random = mulberry32(placement.variant ^ 0x1ce1ce);

  stampDisc(ctx, placement.position, Math.min(placement.radius * 0.85, 2.8), row, snow);
  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.8, spread * 0.8, random());
    const width = lerp(0.75, 1.35, random());
    const height = 4 + Math.floor(random() * 8);
    stampPillar(ctx, placement, side, forward, width, baseRow, row + height, index % 2 === 0 ? ice : ctx.palette.glass);
  }
}

function stampDesertOutpost(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 0.92, 1.08);
  const width = 5.7 * scale;
  const depth = 4.4 * scale;
  const height = 7 + (placement.variant % 3);

  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row + 1, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, -depth / 2 + 0.4 * scale, width, 0.8 * scale, row + 2, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.4 * scale, 0, 0.8 * scale, depth, row + 2, row + height - 2, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.4 * scale, 0, 0.8 * scale, depth * 0.64, row + 2, row + height - 1, ctx.palette.wall);
  stampPillar(ctx, placement, -width * 0.18, 0.1 * scale, 0.65 * scale, row + 2, row + height + 1, ctx.palette.wood);
  stampPillar(ctx, placement, width * 0.18, 0.1 * scale, 0.65 * scale, row + 2, row + height + 1, ctx.palette.wood);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0.25 * scale, width * 0.62, depth * 0.5, row + height + 1, row + height + 1, ctx.palette.wood);
}

function stampShrineGate(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 0.95, 1.16);
  const width = 5.6 * scale;
  const height = 10 + (placement.variant % 4);

  stampPillar(ctx, placement, -width / 2 + 0.65 * scale, 0, 0.95 * scale, row, row + height, ctx.palette.wood);
  stampPillar(ctx, placement, width / 2 - 0.65 * scale, 0, 0.95 * scale, row, row + height, ctx.palette.wood);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, 0.9 * scale, row + height + 1, row + height + 2, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width + 1.1 * scale, 0.7 * scale, row + height + 3, row + height + 3, ctx.palette.wood);
  stampPillar(ctx, placement, -width * 0.35, -1.35 * scale, 0.75 * scale, row, row + 4, ctx.palette.foliage);
  stampPillar(ctx, placement, width * 0.35, 1.35 * scale, 0.75 * scale, row, row + 4, ctx.palette.foliage);
}

function stampGoldCache(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const goldOre = getBlockNumericId('gold_ore');
  const goldPanel = getBlockNumericId('gold_panel');
  const scale = getStructureScale(placement, 0.92, 1.12);
  const width = 4.8 * scale;
  const depth = 3.9 * scale;
  const height = 5 + (placement.variant % 3);

  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row + 1, goldPanel);
  stampOrientedBoxAtLocal(ctx, placement, -width * 0.24, 0, width * 0.34, depth * 0.72, row + 2, row + height, goldOre);
  stampOrientedBoxAtLocal(ctx, placement, width * 0.24, 0, width * 0.34, depth * 0.72, row + 2, row + height - 1, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width * 0.78, depth * 0.42, row + height + 1, row + height + 1, ctx.palette.glass);
}

function stampCrateStack(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const count = 5 + (placement.variant % 4);
  const spread = Math.max(1.8, placement.radius * 0.7);
  const random = mulberry32(placement.variant ^ 0x43524154);
  for (let index = 0; index < count; index++) {
    const side = lerp(-spread, spread, random());
    const forward = lerp(-spread * 0.8, spread * 0.8, random());
    const width = lerp(1.2, 1.65, random());
    const height = 2 + Math.floor(random() * 4);
    stampOrientedBoxAtLocal(ctx, placement, side, forward, width, width, row, row + height, index % 2 === 0 ? ctx.palette.wood : ctx.palette.floor);
  }
}

function stampGardenMarker(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const scale = getStructureScale(placement, 1.05, 1.3);
  stampDisc(ctx, placement.position, 1.95 * scale, row, ctx.palette.terrainTop);
  stampPillar(ctx, placement, 0, 0, 0.85 * scale, row + 1, row + 7, ctx.palette.wood);
  stampPillar(ctx, placement, 0, 0, 2.35 * scale, row + 7, row + 9, ctx.palette.foliage);
  stampPillar(ctx, placement, -1.8 * scale, 0.85 * scale, 0.85 * scale, row, row + 4, ctx.palette.foliage);
  stampPillar(ctx, placement, 1.55 * scale, -0.95 * scale, 0.85 * scale, row, row + 4, ctx.palette.foliage);
}

function stampStructureFoundation(ctx: StructureStampContext, placement: PlacedStructure): void {
  const foundationRadius = Math.max(1.8, Math.min(placement.padRadius * 0.72, placement.radius + 0.8));
  stampDisc(ctx, placement.position, foundationRadius, placement.surfaceRow, ctx.palette.floor);
}

function stampStructure(ctx: StructureStampContext, placement: PlacedStructure): void {
  stampStructureFoundation(ctx, placement);

  switch (placement.kind) {
    case 'base_bunker':
      stampBaseBunker(ctx, placement);
      break;
    case 'spawn_shelter':
      stampSpawnShelter(ctx, placement);
      break;
    case 'flag_plinth':
      stampFlagPlinth(ctx, placement);
      break;
    case 'mid_wall':
      stampMidWall(ctx, placement);
      break;
    case 'ruin_cover':
      stampRuinCover(ctx, placement);
      break;
    case 'landmark_tower':
      stampLandmarkTower(ctx, placement);
      break;
    case 'supported_gate':
      stampSupportedGate(ctx, placement);
      break;
    case 'cover_cluster':
      stampCoverCluster(ctx, placement);
      break;
    case 'watch_post':
      stampWatchPost(ctx, placement);
      break;
    case 'terrace_platform':
      stampTerracePlatform(ctx, placement);
      break;
    case 'broken_arch':
      stampBrokenArch(ctx, placement);
      break;
    case 'monument_ring':
      stampMonumentRing(ctx, placement);
      break;
    case 'boulder_patch':
      stampBoulderPatch(ctx, placement);
      break;
    case 'crystal_spire':
      stampCrystalSpire(ctx, placement);
      break;
    case 'tree_cluster':
      stampTreeCluster(ctx, placement);
      break;
    case 'pine_cluster':
      stampPineCluster(ctx, placement);
      break;
    case 'blossom_tree_cluster':
      stampBlossomTreeCluster(ctx, placement);
      break;
    case 'crystal_tree_cluster':
      stampCrystalTreeCluster(ctx, placement);
      break;
    case 'cactus_stand':
      stampCactusStand(ctx, placement);
      break;
    case 'bamboo_thicket':
      stampBambooThicket(ctx, placement);
      break;
    case 'basalt_columns':
      stampBasaltColumns(ctx, placement);
      break;
    case 'ice_outcrop':
      stampIceOutcrop(ctx, placement);
      break;
    case 'desert_outpost':
      stampDesertOutpost(ctx, placement);
      break;
    case 'shrine_gate':
      stampShrineGate(ctx, placement);
      break;
    case 'gold_cache':
      stampGoldCache(ctx, placement);
      break;
    case 'crate_stack':
      stampCrateStack(ctx, placement);
      break;
    case 'garden_marker':
      stampGardenMarker(ctx, placement);
      break;
  }
}

function getTerrainBlockForDepth(palette: BlockPalette, depthFromSurface: number): number {
  if (depthFromSurface === 0) return palette.terrainTop;
  if (depthFromSurface <= 3) return palette.terrainSide;
  return palette.terrainDeep;
}

function fillTerrain(ctx: StructureStampContext, layout: ProceduralCTFLayout): void {
  const { origin, size, voxelSize, boundary } = layout;

  for (let z = 0; z < size.z; z++) {
    const worldZ = gridToWorldCenter(z, origin.z, voxelSize.z);
    for (let x = 0; x < size.x; x++) {
      const worldX = gridToWorldCenter(x, origin.x, voxelSize.x);
      const height = ctx.heightMap[columnIndex(x, z, size)];
      const inside = isInsideBoundaryPolygon(worldX, worldZ, boundary);
      const boundaryDistance = distanceToBoundary(worldX, worldZ, boundary);
      const wallThickness = getBoundaryWallThickness(ctx.seed, worldX, worldZ);
      const wallBand = boundaryDistance <= wallThickness;
      const wallTopRow = getBoundaryWallTopRow(ctx.seed, worldX, worldZ);

      for (let y = 0; y < height; y++) {
        setBlock(ctx, x, y, z, getTerrainBlockForDepth(ctx.palette, height - 1 - y));
      }

      if (wallBand || !inside) {
        for (let y = height; y <= Math.min(size.y - 1, wallTopRow); y++) {
          setBlock(ctx, x, y, z, ctx.palette.wall);
        }
      } else {
        const gradeTopRow = getBoundaryInnerGradeTopRow(
          ctx.seed,
          worldX,
          worldZ,
          boundaryDistance,
          wallThickness,
          wallTopRow,
          height
        );
        if (gradeTopRow !== null) {
          for (let y = height; y <= Math.min(size.y - 1, gradeTopRow); y++) {
            setBlock(ctx, x, y, z, ctx.palette.wall);
          }
        }
      }
    }
  }
}

function paintObjectivePads(ctx: StructureStampContext, layout: ProceduralCTFLayout): void {
  const paintSpawn = (point: Vec3, block: number): void => {
    const row = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, point);
    stampDisc(ctx, point, SPAWN_PAD_RADIUS, row, block);
  };

  for (const point of layout.spawnPoints.red) paintSpawn(point, ctx.palette.spawnRed);
  for (const point of layout.spawnPoints.blue) paintSpawn(point, ctx.palette.spawnBlue);

  const redFlagRow = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, layout.flagZones.red);
  const blueFlagRow = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, layout.flagZones.blue);
  stampDisc(ctx, layout.flagZones.red, FLAG_PAD_RADIUS, redFlagRow, ctx.palette.flag);
  stampDisc(ctx, layout.flagZones.blue, FLAG_PAD_RADIUS, blueFlagRow, ctx.palette.flag);
}

function getDevTestingPlanForHeightMap(
  layout: ProceduralCTFLayout,
  heightMap: Uint16Array,
  spawnPoints: TeamMap<Vec3[]>,
  flagZones: TeamMap<Vec3>
) {
  return createDevTestingFeaturePlan({
    redSpawn: spawnPoints.red[0] ?? flagZones.red,
    redFlag: flagZones.red,
    blueFlag: flagZones.blue,
    samplePlayerCenterY: (point) => {
      const row = heightRowAtWorld(heightMap, layout.origin, layout.size, layout.voxelSize, point);
      return gridRowsToWorldY(row + 1, layout.origin.y, layout.voxelSize.y) + PLAYER_HEIGHT / 2 + 0.05;
    },
  });
}

function flattenDevTestingFeaturePads(
  heightMap: Uint16Array,
  layout: ProceduralCTFLayout,
  spawnPoints: TeamMap<Vec3[]>,
  flagZones: TeamMap<Vec3>
): void {
  const plan = getDevTestingPlanForHeightMap(layout, heightMap, spawnPoints, flagZones);
  const targetRow = sampleMedianHeight(
    heightMap,
    layout.origin,
    layout.size,
    layout.voxelSize,
    plan.targetBotArea.center,
    DEV_TESTING_TARGET_AREA_HALF_EXTENTS.x
  );

  flattenDisc(
    heightMap,
    layout.origin,
    layout.size,
    layout.voxelSize,
    plan.targetBotArea.center,
    DEV_TESTING_TARGET_AREA_HALF_EXTENTS.x,
    targetRow,
    1.6
  );

  for (const entry of plan.heroLineup) {
    const row = sampleMedianHeight(heightMap, layout.origin, layout.size, layout.voxelSize, entry.position, 1.2);
    flattenDisc(heightMap, layout.origin, layout.size, layout.voxelSize, entry.position, 1.15, row, 0.8);
  }
}

function devTestingFeatureOverlapsPlacement(
  plan: ReturnType<typeof getDevTestingPlanForHeightMap>,
  placement: PlacedStructure
): boolean {
  const targetRadius = Math.max(
    DEV_TESTING_TARGET_AREA_HALF_EXTENTS.x,
    DEV_TESTING_TARGET_AREA_HALF_EXTENTS.z
  ) + placement.padRadius + 2.5;
  if (distance2D(placement.position, plan.targetBotArea.center) <= targetRadius) return true;

  if (plan.heroLineup.length === 0) return false;

  const firstHero = plan.heroLineup[0].position;
  const lastHero = plan.heroLineup[plan.heroLineup.length - 1].position;
  const lineupClearance = placement.padRadius + 2.6;
  return distanceToSegmentSq2D(placement.position, firstHero, lastHero) <= lineupClearance * lineupClearance;
}

function filterDevTestingFeaturePlacements(
  placements: PlacedStructure[],
  layout: ProceduralCTFLayout,
  heightMap: Uint16Array,
  spawnPoints: TeamMap<Vec3[]>,
  flagZones: TeamMap<Vec3>
): PlacedStructure[] {
  const plan = getDevTestingPlanForHeightMap(layout, heightMap, spawnPoints, flagZones);
  return placements.filter((placement) => !devTestingFeatureOverlapsPlacement(plan, placement));
}

function stampOrientedRect(
  ctx: StructureStampContext,
  center: { x: number; z: number },
  facing: { x: number; z: number },
  width: number,
  depth: number,
  minY: number,
  maxY: number,
  block: number
): void {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const bound = Math.sqrt(halfWidth * halfWidth + halfDepth * halfDepth) + Math.max(ctx.voxelSize.x, ctx.voxelSize.z);
  const minX = worldToGrid(center.x - bound, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const maxX = worldToGrid(center.x + bound, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const minZ = worldToGrid(center.z - bound, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const maxZ = worldToGrid(center.z + bound, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const sideAxis = perpendicular(facing);

  for (let z = minZ; z <= maxZ; z++) {
    const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
    for (let x = minX; x <= maxX; x++) {
      const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
      const dx = worldX - center.x;
      const dz = worldZ - center.z;
      const side = dx * sideAxis.x + dz * sideAxis.z;
      const forward = dx * facing.x + dz * facing.z;
      if (Math.abs(side) > halfWidth || Math.abs(forward) > halfDepth) continue;

      for (let y = minY; y <= maxY; y++) {
        setBlock(ctx, x, y, z, block);
      }
    }
  }
}

function clearDiscHeadroom(
  ctx: StructureStampContext,
  center: { x: number; z: number },
  radius: number,
  surfaceRow: number,
  extraRows = HEADROOM_ROWS
): void {
  const minX = worldToGrid(center.x - radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const maxX = worldToGrid(center.x + radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
  const minZ = worldToGrid(center.z - radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const maxZ = worldToGrid(center.z + radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
  const radiusSq = radius * radius;

  for (let z = minZ; z <= maxZ; z++) {
    const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
    for (let x = minX; x <= maxX; x++) {
      const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
      if ((worldX - center.x) ** 2 + (worldZ - center.z) ** 2 > radiusSq) continue;

      for (let y = surfaceRow + 1; y <= Math.min(ctx.size.y - 1, surfaceRow + extraRows); y++) {
        setBlock(ctx, x, y, z, AIR);
      }
    }
  }
}

function paintDevTestingFeaturePads(
  ctx: StructureStampContext,
  layout: ProceduralCTFLayout,
  spawnPoints: TeamMap<Vec3[]>,
  flagZones: TeamMap<Vec3>
): void {
  const plan = getDevTestingPlanForHeightMap(layout, ctx.heightMap, spawnPoints, flagZones);
  const targetRow = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, plan.targetBotArea.center);
  const goldPanel = getBlockNumericId('gold_panel');

  clearDiscHeadroom(ctx, plan.targetBotArea.center, DEV_TESTING_TARGET_AREA_HALF_EXTENTS.x + 1.25, targetRow, ctx.size.y);
  stampDisc(ctx, plan.targetBotArea.center, DEV_TESTING_TARGET_AREA_HALF_EXTENTS.x, targetRow, ctx.palette.powerupPad);
  stampDisc(ctx, plan.targetBotArea.center, 1.7, targetRow, goldPanel);

  if (plan.heroLineup.length === 0) return;

  const lineupCenter = averageVec3(plan.heroLineup.map((entry) => entry.position));
  const wallRow = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, lineupCenter);
  const wallWidth = DEV_TESTING_HERO_LINEUP_SPACING * Math.max(1, plan.heroLineup.length - 1) + 1.4;

  clearDiscHeadroom(ctx, lineupCenter, wallWidth * 0.5 + 1.5, wallRow, ctx.size.y);

  for (const entry of plan.heroLineup) {
    const row = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, entry.position);
    clearDiscHeadroom(ctx, entry.position, 1.25, row, ctx.size.y);
    stampDisc(ctx, entry.position, 1.05, row, goldPanel);
  }

  const facing = normalize2D({
    x: -Math.sin(plan.heroLineup[0].yaw),
    z: -Math.cos(plan.heroLineup[0].yaw),
  });
  const wallCenter = {
    x: lineupCenter.x - facing.x * 0.82,
    z: lineupCenter.z - facing.z * 0.82,
  };

  stampOrientedRect(ctx, wallCenter, facing, wallWidth, 0.34, wallRow + 1, wallRow + 8, ctx.palette.wall);
  stampOrientedRect(ctx, wallCenter, facing, wallWidth, 0.38, wallRow + 9, wallRow + 9, ctx.palette.glass);
}

function clearObjectiveHeadroom(ctx: StructureStampContext, layout: ProceduralCTFLayout): void {
  const surfaceRowAtPoint = (point: Vec3): number => {
    const grid = getGridPointForWorld(point, ctx.origin, ctx.size, ctx.voxelSize);
    return ctx.heightMap[columnIndex(grid.x, grid.z, ctx.size)];
  };

  const clearCapsule = (start: Vec3, end: Vec3, radius: number): void => {
    const minX = worldToGrid(Math.min(start.x, end.x) - radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
    const maxX = worldToGrid(Math.max(start.x, end.x) + radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
    const minZ = worldToGrid(Math.min(start.z, end.z) - radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
    const maxZ = worldToGrid(Math.max(start.z, end.z) + radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
    const pathSurfaceRow = Math.min(surfaceRowAtPoint(start), surfaceRowAtPoint(end));
    const radiusSq = radius * radius;

    for (let z = minZ; z <= maxZ; z++) {
      const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
      for (let x = minX; x <= maxX; x++) {
        const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
        if (distanceToSegmentSq2D({ x: worldX, z: worldZ }, start, end) > radiusSq) continue;

        const surfaceRow = Math.min(ctx.heightMap[columnIndex(x, z, ctx.size)], pathSurfaceRow);
        for (let y = surfaceRow + 1; y <= Math.min(ctx.size.y - 1, surfaceRow + HEADROOM_ROWS); y++) {
          setBlock(ctx, x, y, z, AIR);
        }
      }
    }
  };

  const clearPoint = (point: Vec3, radius: number): void => clearCapsule(point, point, radius);
  const clearSpawnExits = (team: MapTeam): void => {
    const flag = layout.flagZones[team];
    const center = averageVec3(layout.spawnPoints[team]);
    clearPoint(center, SPAWN_HEADROOM_RADIUS);

    for (const spawn of layout.spawnPoints[team]) {
      clearPoint(spawn, SPAWN_HEADROOM_RADIUS);
      clearCapsule(spawn, center, SPAWN_EGRESS_RADIUS);

      const toFlag = normalize2D({ x: flag.x - spawn.x, z: flag.z - spawn.z });
      const distanceToFlag = distance2D(spawn, flag);
      const corridorDistance = Math.min(
        SPAWN_EGRESS_MAX_DISTANCE,
        Math.max(0, distanceToFlag - SPAWN_EGRESS_FLAG_BUFFER)
      );

      if (corridorDistance <= 0.25) continue;

      clearCapsule(
        spawn,
        {
          x: spawn.x + toFlag.x * corridorDistance,
          y: spawn.y,
          z: spawn.z + toFlag.z * corridorDistance,
        },
        SPAWN_EGRESS_RADIUS
      );
    }
  };

  clearSpawnExits('red');
  clearSpawnExits('blue');
  clearPoint(layout.flagZones.red, 1.75);
  clearPoint(layout.flagZones.blue, 1.75);
}

function buildCollisionLookup(): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let index = 0; index < lookup.length; index++) {
    lookup[index] = isCollisionBlock(index) ? 1 : 0;
  }
  return lookup;
}

function buildSolidLookup(): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let index = 0; index < lookup.length; index++) {
    lookup[index] = isSolidBlock(index) ? 1 : 0;
  }
  return lookup;
}

function buildHeightfield(input: {
  blocks: Uint8Array;
  origin: Vec3;
  voxelSize: VoxelSize;
  size: VoxelSize;
  collisionLookup: Uint8Array;
}): VoxelMapManifest['heightfield'] {
  const topSolidRows = new Uint16Array(input.size.x * input.size.z);

  for (let z = 0; z < input.size.z; z++) {
    for (let x = 0; x < input.size.x; x++) {
      for (let y = input.size.y - 1; y >= 0; y--) {
        const block = input.blocks[blockIndex(x, y, z, input.size)];
        if (!input.collisionLookup[block]) continue;
        topSolidRows[columnIndex(x, z, input.size)] = y + 1;
        break;
      }
    }
  }

  return {
    origin: input.origin,
    voxelSize: input.voxelSize,
    size: { x: input.size.x, z: input.size.z },
    topSolidRows,
  };
}

function buildChunks(input: {
  blocks: Uint8Array;
  size: VoxelSize;
  chunkSize: VoxelSize;
  solidLookup: Uint8Array;
}): VoxelChunk[] {
  const chunks: VoxelChunk[] = [];
  const chunksX = Math.ceil(input.size.x / input.chunkSize.x);
  const chunksY = Math.ceil(input.size.y / input.chunkSize.y);
  const chunksZ = Math.ceil(input.size.z / input.chunkSize.z);

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunkSize = {
          x: Math.min(input.chunkSize.x, input.size.x - cx * input.chunkSize.x),
          y: Math.min(input.chunkSize.y, input.size.y - cy * input.chunkSize.y),
          z: Math.min(input.chunkSize.z, input.size.z - cz * input.chunkSize.z),
        };
        const blocks = new Uint8Array(chunkSize.x * chunkSize.y * chunkSize.z);
        let solidBlockCount = 0;

        for (let y = 0; y < chunkSize.y; y++) {
          for (let z = 0; z < chunkSize.z; z++) {
            for (let x = 0; x < chunkSize.x; x++) {
              const globalX = cx * input.chunkSize.x + x;
              const globalY = cy * input.chunkSize.y + y;
              const globalZ = cz * input.chunkSize.z + z;
              const block = input.blocks[blockIndex(globalX, globalY, globalZ, input.size)];
              blocks[blockIndex(x, y, z, chunkSize)] = block;
              if (input.solidLookup[block]) solidBlockCount++;
            }
          }
        }

        if (solidBlockCount > 0) {
          chunks.push({
            coord: { x: cx, y: cy, z: cz },
            size: chunkSize,
            blocks,
            solidBlockCount,
          });
        }
      }
    }
  }

  return chunks;
}

function createColliderSignature(colliders: VoxelMapManifest['colliders']): string {
  let hash = 0x811c9dc5;
  for (const collider of colliders) {
    const parts = [
      Math.round(collider.center.x * 100),
      Math.round(collider.center.y * 100),
      Math.round(collider.center.z * 100),
      Math.round(collider.halfExtents.x * 100),
      Math.round(collider.halfExtents.y * 100),
      Math.round(collider.halfExtents.z * 100),
    ];
    for (const part of parts) {
      hash ^= part;
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function createStats(input: {
  chunks: VoxelChunk[];
  colliders: VoxelMapManifest['colliders'];
  size: VoxelSize;
  chunkSize: VoxelSize;
}): VoxelMapStats {
  const chunksX = Math.ceil(input.size.x / input.chunkSize.x);
  const chunksY = Math.ceil(input.size.y / input.chunkSize.y);
  const chunksZ = Math.ceil(input.size.z / input.chunkSize.z);
  const totalChunkSlots = chunksX * chunksY * chunksZ;
  const solidBlocks = input.chunks.reduce((sum, chunk) => sum + chunk.solidBlockCount, 0);
  const competitiveTriangles = solidBlocks * 6;

  return {
    chunkCount: input.chunks.length,
    totalChunkSlots,
    emptyChunkSlots: totalChunkSlots - input.chunks.length,
    renderableChunkCount: input.chunks.length,
    solidBlocks,
    colliderCount: input.colliders.length,
    colliderSignature: createColliderSignature(input.colliders),
    estimatedTrianglesByProfile: {
      potato: Math.round(competitiveTriangles * 0.45),
      competitive: competitiveTriangles,
      balanced: Math.round(competitiveTriangles * 1.15),
      cinematic: Math.round(competitiveTriangles * 1.35),
    },
  };
}

function createSpawnPoints(layout: ProceduralCTFLayout, heightMap: Uint16Array): TeamMap<Vec3[]> {
  const withSpawnY = (point: Vec3): Vec3 => {
    const surfaceRow = heightRowAtWorld(heightMap, layout.origin, layout.size, layout.voxelSize, point);
    return {
      x: point.x,
      y: gridRowsToWorldY(surfaceRow + 1, layout.origin.y, layout.voxelSize.y) + PLAYER_HEIGHT / 2 + 0.05,
      z: point.z,
    };
  };

  return {
    red: layout.spawnPoints.red.map(withSpawnY),
    blue: layout.spawnPoints.blue.map(withSpawnY),
  };
}

function createFlagZones(layout: ProceduralCTFLayout, heightMap: Uint16Array): TeamMap<Vec3> {
  const withFlagY = (point: Vec3): Vec3 => {
    const surfaceRow = heightRowAtWorld(heightMap, layout.origin, layout.size, layout.voxelSize, point);
    return {
      x: point.x,
      y: gridRowsToWorldY(surfaceRow + 1, layout.origin.y, layout.voxelSize.y) + 0.25,
      z: point.z,
    };
  };

  return {
    red: withFlagY(layout.flagZones.red),
    blue: withFlagY(layout.flagZones.blue),
  };
}

function getSurfacePosition(layout: ProceduralCTFLayout, heightMap: Uint16Array, point: Vec3, yOffset = 0.25): Vec3 {
  const row = heightRowAtWorld(heightMap, layout.origin, layout.size, layout.voxelSize, point);
  return {
    x: point.x,
    y: gridRowsToWorldY(row + 1, layout.origin.y, layout.voxelSize.y) + yOffset,
    z: point.z,
  };
}

function getPowerupCounts(mapSize: VoxelMapSizeId): Record<MapPowerupKind, number> {
  switch (mapSize) {
    case 'small':
      return { health_pack: 2, powerup: 2 };
    case 'large':
      return { health_pack: 4, powerup: 4 };
    case 'medium':
    default:
      return { health_pack: 4, powerup: 2 };
  }
}

function getPowerupScore(candidate: PowerupPlacementCandidate, kind: MapPowerupKind): number {
  return kind === 'health_pack' ? candidate.healthScore : candidate.powerupScore;
}

function getPowerupPlacementBasis(layout: ProceduralCTFLayout): {
  center: { x: number; z: number };
  axis: { x: number; z: number };
  normal: { x: number; z: number };
} {
  const center = {
    x: (layout.flagZones.red.x + layout.flagZones.blue.x) / 2,
    z: (layout.flagZones.red.z + layout.flagZones.blue.z) / 2,
  };
  const axis = normalize2D({
    x: layout.flagZones.blue.x - layout.flagZones.red.x,
    z: layout.flagZones.blue.z - layout.flagZones.red.z,
  });
  return {
    center,
    axis,
    normal: perpendicular(axis),
  };
}

function getPowerupSide(point: { x: number; z: number }, layout: ProceduralCTFLayout): MapTeam | null {
  const { center, axis } = getPowerupPlacementBasis(layout);
  const along = (point.x - center.x) * axis.x + (point.z - center.z) * axis.z;
  if (Math.abs(along) < 2.2) return null;
  return along < 0 ? 'red' : 'blue';
}

function mirrorPowerupPointToTeam(
  point: { x: number; z: number },
  layout: ProceduralCTFLayout,
  team: MapTeam
): { x: number; z: number } {
  const { center, axis, normal } = getPowerupPlacementBasis(layout);
  const relX = point.x - center.x;
  const relZ = point.z - center.z;
  const along = Math.abs(relX * axis.x + relZ * axis.z);
  const side = relX * normal.x + relZ * normal.z;
  const teamAlong = team === 'red' ? -along : along;
  return {
    x: center.x + axis.x * teamAlong + normal.x * side,
    z: center.z + axis.z * teamAlong + normal.z * side,
  };
}

function getPowerupPairMatchScore(
  source: PowerupPlacementCandidate,
  candidate: PowerupPlacementCandidate,
  kind: MapPowerupKind,
  layout: ProceduralCTFLayout
): number {
  const { center, axis, normal } = getPowerupPlacementBasis(layout);
  const sourceRel = { x: source.position.x - center.x, z: source.position.z - center.z };
  const candidateRel = { x: candidate.position.x - center.x, z: candidate.position.z - center.z };
  const sourceAlong = Math.abs(sourceRel.x * axis.x + sourceRel.z * axis.z);
  const candidateAlong = Math.abs(candidateRel.x * axis.x + candidateRel.z * axis.z);
  const sourceSide = sourceRel.x * normal.x + sourceRel.z * normal.z;
  const candidateSide = candidateRel.x * normal.x + candidateRel.z * normal.z;
  const shapePenalty = Math.abs(sourceAlong - candidateAlong) + Math.abs(sourceSide - candidateSide) * 0.65;
  return shapePenalty - getPowerupScore(candidate, kind) * 0.035;
}

function getSlotFootprintRadius(slot: TacticalSlot): number {
  if (typeof slot.footprint.radius === 'number') return slot.footprint.radius;
  if (slot.footprint.halfExtents) {
    return Math.hypot(slot.footprint.halfExtents.x, slot.footprint.halfExtents.z);
  }
  return slot.protectedClearance;
}

function getLaneKindScore(kind: MapPowerupKind, laneId: string | undefined, lanes: MapBlueprint['lanes']): number {
  if (!laneId) return 0;
  const lane = lanes.find((candidate) => candidate.id === laneId);
  switch (lane?.kind) {
    case 'flank':
      return kind === 'powerup' ? 4.5 : 3.5;
    case 'return':
      return kind === 'health_pack' ? 5 : 1.5;
    case 'primary':
      return kind === 'powerup' ? 3 : 1.5;
    case 'access':
      return 1.75;
    default:
      return 0;
  }
}

function scoreRouteNodeForPowerups(node: RouteGraphNode, lanes: MapBlueprint['lanes']): Pick<PowerupPlacementCandidate, 'powerupScore' | 'healthScore' | 'strategicRole'> {
  const laneScore = Math.max(0, ...node.laneIds.map((laneId) => getLaneKindScore('powerup', laneId, lanes)));
  const healthLaneScore = Math.max(0, ...node.laneIds.map((laneId) => getLaneKindScore('health_pack', laneId, lanes)));

  switch (node.kind) {
    case 'contest':
      return { strategicRole: 'midfield_contest', powerupScore: 15 + laneScore, healthScore: 5 + healthLaneScore };
    case 'midfield':
      return { strategicRole: 'midfield_contest', powerupScore: 12 + laneScore, healthScore: 6 + healthLaneScore };
    case 'flank':
      return { strategicRole: 'flank_reward', powerupScore: 10 + laneScore, healthScore: 9 + healthLaneScore };
    case 'landmark':
      return { strategicRole: 'flank_reward', powerupScore: 8 + laneScore, healthScore: 7 + healthLaneScore };
    case 'fallback':
      return { strategicRole: 'return_route', powerupScore: 4 + laneScore, healthScore: 12 + healthLaneScore };
    case 'flag':
    case 'base':
      return { strategicRole: 'defensive_reset', powerupScore: 2 + laneScore, healthScore: 9 + healthLaneScore };
    case 'spawn':
    default:
      return { strategicRole: 'route_bridge', powerupScore: 0, healthScore: 0 };
  }
}

function scoreTacticalSlotForPowerups(slot: TacticalSlot, lanes: MapBlueprint['lanes']): Pick<PowerupPlacementCandidate, 'powerupScore' | 'healthScore' | 'strategicRole'> {
  const powerupLaneScore = getLaneKindScore('powerup', slot.laneId, lanes);
  const healthLaneScore = getLaneKindScore('health_pack', slot.laneId, lanes);

  switch (slot.role) {
    case 'midfield_occluder':
    case 'elevated_bridge':
    case 'underpass':
      return { strategicRole: 'midfield_contest', powerupScore: 13 + powerupLaneScore, healthScore: 6 + healthLaneScore };
    case 'flank_landmark':
    case 'side_lane_cover_chain':
    case 'tunnel_entrance':
      return { strategicRole: 'flank_reward', powerupScore: 11 + powerupLaneScore, healthScore: 8 + healthLaneScore };
    case 'defender_perch':
    case 'hard_cover_cluster':
      return { strategicRole: 'defensive_reset', powerupScore: 5 + powerupLaneScore, healthScore: 11 + healthLaneScore };
    case 'soft_cover_cluster':
      return { strategicRole: 'return_route', powerupScore: 5 + powerupLaneScore, healthScore: 10 + healthLaneScore };
    case 'traversal_ramp':
      return { strategicRole: 'route_bridge', powerupScore: 8 + powerupLaneScore, healthScore: 5 + healthLaneScore };
    default:
      return { strategicRole: 'route_bridge', powerupScore: 1 + powerupLaneScore, healthScore: 1 + healthLaneScore };
  }
}

function offsetPowerupCandidate(
  point: Vec3,
  seed: number,
  index: number,
  radius: number,
  direction?: { x: number; z: number }
): Vec3 {
  const random = mulberry32(seed ^ Math.imul(index + 1, 0x45d9f3b));
  const facing = direction ? normalize2D(direction) : normalize2D({ x: random() - 0.5, z: random() - 0.5 });
  const side = perpendicular(facing);
  const sideOffset = lerp(-radius, radius, random());
  const forwardOffset = lerp(-radius * 0.55, radius * 0.55, random());
  return {
    x: point.x + side.x * sideOffset + facing.x * forwardOffset,
    y: point.y,
    z: point.z + side.z * sideOffset + facing.z * forwardOffset,
  };
}

function approximateZoneRadius(zone: { radius?: number; halfExtents?: { x: number; z: number }; clearanceRadius?: number }): number {
  const shapeRadius = zone.radius
    ?? (zone.halfExtents ? Math.hypot(zone.halfExtents.x, zone.halfExtents.z) : 0);
  return Math.max(shapeRadius, zone.clearanceRadius ?? 0);
}

function isPowerupPlacementSafe(
  point: Vec3,
  blueprint: MapBlueprint,
  layout: ProceduralCTFLayout,
  accepted: readonly MapPowerupPickup[],
  minSpacing = 7.25
): boolean {
  if (!isInsideBoundaryPolygon(point.x, point.z, layout.boundary)) return false;
  if (distanceToBoundary(point.x, point.z, layout.boundary) < 5.2) return false;

  for (const zone of blueprint.protectedZones) {
    if (zone.kind !== 'spawn' && zone.kind !== 'flag' && zone.kind !== 'base') continue;
    const avoidRadius = approximateZoneRadius(zone) + 3.25;
    if (distance2D(point, zone.center) < avoidRadius) return false;
  }

  for (const module of blueprint.moduleInstances) {
    if (distance2D(point, module.position) < POWERUP_PAD_RADIUS + 1.15) return false;
  }

  for (const existing of accepted) {
    if (distance2D(point, existing.position) < minSpacing) return false;
  }

  return true;
}

function buildPowerupPlacementCandidates(
  seed: number,
  blueprint: MapBlueprint
): PowerupPlacementCandidate[] {
  const candidates: PowerupPlacementCandidate[] = [];
  const random = mulberry32(seed ^ 0x706f7772);

  blueprint.routeGraph.nodes.forEach((node, index) => {
    const scores = scoreRouteNodeForPowerups(node, blueprint.lanes);
    if (scores.powerupScore <= 0 && scores.healthScore <= 0) return;
    candidates.push({
      position: offsetPowerupCandidate(node.position, seed ^ 0x6e6f6465, index, 1.7),
      strategicRole: scores.strategicRole,
      powerupScore: scores.powerupScore,
      healthScore: scores.healthScore,
      routeNodeId: node.id,
      laneId: node.laneIds[0],
      teamBias: node.team,
      tieBreak: random(),
    });
  });

  blueprint.routeGraph.edges.forEach((edge, index) => {
    const from = blueprint.routeGraph.nodes.find((node) => node.id === edge.from);
    const to = blueprint.routeGraph.nodes.find((node) => node.id === edge.to);
    if (!from || !to) return;
    const mid = {
      x: (from.position.x + to.position.x) / 2,
      y: (from.position.y + to.position.y) / 2,
      z: (from.position.z + to.position.z) / 2,
    };
    const direction = { x: to.position.x - from.position.x, z: to.position.z - from.position.z };
    const powerupLaneScore = getLaneKindScore('powerup', edge.laneId, blueprint.lanes);
    const healthLaneScore = getLaneKindScore('health_pack', edge.laneId, blueprint.lanes);
    candidates.push({
      position: offsetPowerupCandidate(mid, seed ^ 0x65646765, index, 1.25, direction),
      strategicRole: edge.tags.includes('flank') ? 'flank_reward' : 'route_bridge',
      powerupScore: 6 + powerupLaneScore,
      healthScore: 5 + healthLaneScore,
      laneId: edge.laneId,
      tieBreak: random(),
    });
  });

  blueprint.tacticalSlots.forEach((slot, index) => {
    const scores = scoreTacticalSlotForPowerups(slot, blueprint.lanes);
    if (scores.powerupScore <= 1 && scores.healthScore <= 1) return;
    const slotRadius = clamp(getSlotFootprintRadius(slot), 1.6, 5.5);
    const normal = perpendicular(slot.facing);
    const sideSign = index % 2 === 0 ? 1 : -1;
    const point = {
      x: slot.position.x + normal.x * sideSign * (slotRadius + 1.1) - slot.facing.x * 0.65,
      y: slot.position.y,
      z: slot.position.z + normal.z * sideSign * (slotRadius + 1.1) - slot.facing.z * 0.65,
    };
    candidates.push({
      position: point,
      strategicRole: scores.strategicRole,
      powerupScore: scores.powerupScore,
      healthScore: scores.healthScore,
      routeNodeId: slot.nodeId,
      laneId: slot.laneId,
      teamBias: slot.team,
      tieBreak: random(),
    });
  });

  return candidates;
}

function createMapPowerups(
  seed: number,
  blueprint: MapBlueprint,
  layout: ProceduralCTFLayout,
  heightMap: Uint16Array
): MapPowerupPickup[] {
  const counts = getPowerupCounts(layout.mapSize);
  const accepted: MapPowerupPickup[] = [];
  const candidates = buildPowerupPlacementCandidates(seed, blueprint);

  const createPickup = (
    kind: MapPowerupKind,
    team: MapTeam,
    pairIndex: number,
    candidate: PowerupPlacementCandidate,
    position: Vec3
  ): MapPowerupPickup => ({
    id: `${kind}_${team}_${pairIndex + 1}`,
    kind,
    position,
    radius: POWERUP_PICKUP_RADIUS,
    respawnSeconds: POWERUP_RESPAWN_SECONDS,
    strategicRole: candidate.strategicRole,
    routeNodeId: candidate.routeNodeId,
    laneId: candidate.laneId,
    teamBias: team,
  });

  const findCounterpartCandidate = (
    kind: MapPowerupKind,
    source: PowerupPlacementCandidate,
    targetTeam: MapTeam,
    sorted: PowerupPlacementCandidate[],
    acceptedWithSource: readonly MapPowerupPickup[],
    minSpacing: number
  ): { candidate: PowerupPlacementCandidate; position: Vec3 } | null => {
    let best: { candidate: PowerupPlacementCandidate; position: Vec3; score: number } | null = null;

    for (const candidate of sorted) {
      if (candidate === source || getPowerupSide(candidate.position, layout) !== targetTeam) continue;
      if (getPowerupScore(candidate, kind) <= 0) continue;

      const position = getSurfacePosition(layout, heightMap, candidate.position, 0.68);
      if (!isPowerupPlacementSafe(position, blueprint, layout, acceptedWithSource, minSpacing)) continue;

      const score = getPowerupPairMatchScore(source, candidate, kind, layout);
      if (!best || score < best.score) {
        best = { candidate, position, score };
      }
    }

    return best ? { candidate: best.candidate, position: best.position } : null;
  };

  const selectKind = (kind: MapPowerupKind, targetCount: number): void => {
    const targetPairCount = Math.floor(targetCount / 2);
    const sorted = [...candidates].sort((candidateA, candidateB) => (
      getPowerupScore(candidateB, kind) - getPowerupScore(candidateA, kind)
      || candidateB.powerupScore + candidateB.healthScore - (candidateA.powerupScore + candidateA.healthScore)
      || candidateA.tieBreak - candidateB.tieBreak
    ));

    for (const minSpacing of [7.25, 5.35, 4.25]) {
      for (const sourceTeam of ['red', 'blue'] as const) {
        const targetTeam: MapTeam = sourceTeam === 'red' ? 'blue' : 'red';

        for (const candidate of sorted) {
          const selectedPairCount = accepted.filter((pickup) => pickup.kind === kind).length / 2;
          if (selectedPairCount >= targetPairCount) break;
          if (getPowerupSide(candidate.position, layout) !== sourceTeam) continue;
          if (getPowerupScore(candidate, kind) <= 0) continue;

          const sourcePosition = getSurfacePosition(layout, heightMap, candidate.position, 0.68);
          if (!isPowerupPlacementSafe(sourcePosition, blueprint, layout, accepted, minSpacing)) continue;

          const pairIndex = Math.floor(accepted.filter((pickup) => pickup.kind === kind).length / 2);
          const sourcePickup = createPickup(kind, sourceTeam, pairIndex, candidate, sourcePosition);
          const acceptedWithSource = [...accepted, sourcePickup];
          const mirroredPoint = mirrorPowerupPointToTeam(candidate.position, layout, targetTeam);
          const mirroredPosition = getSurfacePosition(layout, heightMap, { ...mirroredPoint, y: candidate.position.y }, 0.68);

          if (isPowerupPlacementSafe(mirroredPosition, blueprint, layout, acceptedWithSource, minSpacing)) {
            accepted.push(
              sourcePickup,
              createPickup(kind, targetTeam, pairIndex, candidate, mirroredPosition)
            );
            continue;
          }

          const counterpart = findCounterpartCandidate(
            kind,
            candidate,
            targetTeam,
            sorted,
            acceptedWithSource,
            minSpacing
          );
          if (!counterpart) continue;

          accepted.push(
            sourcePickup,
            createPickup(kind, targetTeam, pairIndex, counterpart.candidate, counterpart.position)
          );
        }
      }
    }
  };

  selectKind('powerup', counts.powerup);
  selectKind('health_pack', counts.health_pack);

  return accepted;
}

function flattenPowerupPads(
  heightMap: Uint16Array,
  layout: ProceduralCTFLayout,
  powerups: readonly MapPowerupPickup[]
): void {
  for (const pickup of powerups) {
    const targetRow = sampleMedianHeight(
      heightMap,
      layout.origin,
      layout.size,
      layout.voxelSize,
      pickup.position,
      POWERUP_PAD_RADIUS
    );
    flattenDisc(
      heightMap,
      layout.origin,
      layout.size,
      layout.voxelSize,
      pickup.position,
      POWERUP_PAD_RADIUS,
      targetRow,
      POWERUP_PAD_BLEND
    );
  }
}

function updatePowerupSurfacePositions(
  layout: ProceduralCTFLayout,
  heightMap: Uint16Array,
  powerups: readonly MapPowerupPickup[]
): MapPowerupPickup[] {
  return powerups.map((pickup) => ({
    ...pickup,
    position: getSurfacePosition(layout, heightMap, pickup.position, 0.68),
  }));
}

function paintPowerupPads(ctx: StructureStampContext, powerups: readonly MapPowerupPickup[]): void {
  for (const pickup of powerups) {
    const row = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, pickup.position);
    const block = pickup.kind === 'health_pack' ? ctx.palette.healthPad : ctx.palette.powerupPad;
    stampDisc(ctx, pickup.position, POWERUP_PAD_RADIUS, row, block);
  }
}

function clearPowerupPadHeadroom(ctx: StructureStampContext, powerups: readonly MapPowerupPickup[]): void {
  const clearRadius = POWERUP_PAD_RADIUS + 0.2;

  for (const pickup of powerups) {
    const row = heightRowAtWorld(ctx.heightMap, ctx.origin, ctx.size, ctx.voxelSize, pickup.position);
    const minX = worldToGrid(pickup.position.x - clearRadius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
    const maxX = worldToGrid(pickup.position.x + clearRadius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
    const minZ = worldToGrid(pickup.position.z - clearRadius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
    const maxZ = worldToGrid(pickup.position.z + clearRadius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
    const clearRadiusSq = clearRadius * clearRadius;
    const maxY = ctx.size.y - 1;

    for (let z = minZ; z <= maxZ; z++) {
      const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
      for (let x = minX; x <= maxX; x++) {
        const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
        if ((worldX - pickup.position.x) ** 2 + (worldZ - pickup.position.z) ** 2 > clearRadiusSq) continue;

        for (let y = row + 1; y <= maxY; y++) {
          setBlock(ctx, x, y, z, AIR);
        }
      }
    }
  }
}

function createModuleInstance(layout: ProceduralCTFLayout, heightMap: Uint16Array, placement: PlacedStructure): ModuleInstance {
  return {
    id: placement.id,
    moduleId: placement.moduleId,
    slotId: placement.slotId,
    roleTags: placement.roleTags,
    position: getSurfacePosition(layout, heightMap, placement.position),
    facing: placement.facing,
    footprint: placement.footprint,
    connectors: [],
    estimatedSolidBlocks: Math.round(placement.radius * placement.radius * 36),
    estimatedColliders: Math.max(6, Math.round(placement.radius * 5)),
    validation: {
      status: 'accepted',
      reasons: [],
    },
  };
}

function patchBlueprintForGeneratedMap(input: {
  blueprint: MapBlueprint;
  construction: MapConstructionResult;
  layout: ProceduralCTFLayout;
  heightMap: Uint16Array;
  spawnPoints: TeamMap<Vec3[]>;
  flagZones: TeamMap<Vec3>;
  placements: PlacedStructure[];
}): MapBlueprint {
  const { blueprint, layout, heightMap, spawnPoints, flagZones, placements } = input;
  const spawnCenters = {
    red: averageVec3(spawnPoints.red),
    blue: averageVec3(spawnPoints.blue),
  };
  const moduleInstances = placements.map((placement) => createModuleInstance(layout, heightMap, placement));
  const moduleCountsByRole = placements.reduce<Record<string, number>>((counts, placement) => {
    counts[placement.role] = (counts[placement.role] ?? 0) + 1;
    return counts;
  }, {});

  const routeGraph = {
    ...blueprint.routeGraph,
    nodes: blueprint.routeGraph.nodes.map((node) => {
      if (node.id === 'red_flag') return { ...node, position: flagZones.red };
      if (node.id === 'blue_flag') return { ...node, position: flagZones.blue };
      if (node.id === 'red_spawn') return { ...node, position: spawnCenters.red };
      if (node.id === 'blue_spawn') return { ...node, position: spawnCenters.blue };
      return { ...node, position: getSurfacePosition(layout, heightMap, node.position) };
    }),
  };

  return {
    ...blueprint,
    flags: {
      red: { ...blueprint.flags.red, center: flagZones.red },
      blue: { ...blueprint.flags.blue, center: flagZones.blue },
    },
    spawns: {
      red: {
        ...blueprint.spawns.red,
        center: spawnCenters.red,
        points: spawnPoints.red,
        fallbackPoints: blueprint.spawns.red.fallbackPoints.map((point) => getSurfacePosition(layout, heightMap, point, PLAYER_HEIGHT / 2)),
      },
      blue: {
        ...blueprint.spawns.blue,
        center: spawnCenters.blue,
        points: spawnPoints.blue,
        fallbackPoints: blueprint.spawns.blue.fallbackPoints.map((point) => getSurfacePosition(layout, heightMap, point, PLAYER_HEIGHT / 2)),
      },
    },
    bases: {
      red: { ...blueprint.bases.red, center: getSurfacePosition(layout, heightMap, blueprint.bases.red.center) },
      blue: { ...blueprint.bases.blue, center: getSurfacePosition(layout, heightMap, blueprint.bases.blue.center) },
    },
    routeGraph,
    sightlineSamples: blueprint.sightlineSamples.map((sample) => ({
      ...sample,
      status: 'planned',
    })),
    tacticalSlots: blueprint.tacticalSlots.map((slot) => ({
      ...slot,
      position: getSurfacePosition(layout, heightMap, slot.position),
    })),
    moduleInstances,
    diagnostics: {
      ...blueprint.diagnostics,
      moduleCountsByRole,
      repairActions: {},
      warnings: blueprint.diagnostics.warnings,
    },
    preview: {
      ...blueprint.preview,
      thumbnailSilhouette: {
        ...blueprint.preview.thumbnailSilhouette,
        landmarks: placements.slice(0, 16).map((placement) => ({
          id: placement.id,
          role: placement.role,
          position: getSurfacePosition(layout, heightMap, placement.position),
          radius: placement.radius,
        })),
        objectives: {
          flags: flagZones,
          spawns: spawnCenters,
        },
      },
    },
  };
}

function buildObjectSummary(placements: PlacedStructure[]): Record<string, number> {
  return placements.reduce<Record<string, number>>((summary, placement) => {
    summary[placement.kind] = (summary[placement.kind] ?? 0) + 1;
    return summary;
  }, {});
}

function markStageFactory(diagnostics: ProceduralVoxelMapDiagnostics | undefined): (name: string) => void {
  let previous = Date.now();
  return (name: string): void => {
    if (!diagnostics) return;
    const now = Date.now();
    diagnostics.stageTimingsMs[name] = now - previous;
    previous = now;
  };
}

function generateProceduralVoxelMapInternal(
  seed = DEFAULT_PROCEDURAL_MAP_SEED,
  diagnostics?: ProceduralVoxelMapDiagnostics,
  options: ProceduralVoxelMapGenerationOptions = {}
): VoxelMapManifest {
  const normalizedSeed = seed >>> 0;
  const effectiveOptions = getEffectiveGenerationOptions(normalizedSeed, options);
  const isDevTesting = isDevTestingMapProfileId(effectiveOptions.profileId);
  const mapSize = normalizeVoxelMapSizeId(effectiveOptions.mapSize);
  const markStage = markStageFactory(diagnostics);
  const layout = createProceduralCTFLayout(normalizedSeed, mapSize, {
    footprintScale: effectiveOptions.footprintScale ?? undefined,
  });
  const theme = getVoxelMapTheme(normalizedSeed, effectiveOptions.themeId);
  const construction = createMapConstruction(normalizedSeed, layout, theme);
  const palette = createBlockPalette(theme);
  markStage('layout');

  const heightMap = createHeightMap(normalizedSeed, layout);
  flattenGameplayPads(heightMap, layout);
  let placements = createPlacedStructures(normalizedSeed, construction, layout, theme, heightMap);
  flattenStructurePads(heightMap, layout, placements);
  limitHeightSteps(heightMap, layout, MAX_TERRAIN_STEP_ROWS, FINAL_TERRAIN_SMOOTHING_PASSES);
  flattenGameplayPads(heightMap, layout);
  flattenStructurePads(heightMap, layout, placements);
  updatePlacementSurfaceRows(heightMap, layout, placements);
  const spawnPoints = createSpawnPoints(layout, heightMap);
  const flagZones = createFlagZones(layout, heightMap);
  if (isDevTesting) {
    placements = filterDevTestingFeaturePlacements(placements, layout, heightMap, spawnPoints, flagZones);
  }
  let blueprint = patchBlueprintForGeneratedMap({
    blueprint: construction.blueprint,
    construction,
    layout,
    heightMap,
    spawnPoints,
    flagZones,
    placements,
  });
  let powerups = createMapPowerups(normalizedSeed, blueprint, layout, heightMap);
  flattenPowerupPads(heightMap, layout, powerups);
  powerups = updatePowerupSurfacePositions(layout, heightMap, powerups);
  if (isDevTesting) {
    flattenDevTestingFeaturePads(heightMap, layout, spawnPoints, flagZones);
  }
  blueprint = patchBlueprintForGeneratedMap({
    blueprint: construction.blueprint,
    construction,
    layout,
    heightMap,
    spawnPoints,
    flagZones,
    placements,
  });
  markStage('terrain');

  const blocks = new Uint8Array(layout.size.x * layout.size.y * layout.size.z);
  const stampContext: StructureStampContext = {
    seed: normalizedSeed,
    themeId: theme.id,
    blocks,
    size: layout.size,
    origin: layout.origin,
    voxelSize: layout.voxelSize,
    heightMap,
    palette,
  };
  fillTerrain(stampContext, layout);
  paintObjectivePads(stampContext, layout);
  for (const placement of placements) stampStructure(stampContext, placement);
  anchorBoundaryFloatingDetails(stampContext, layout);
  clearObjectiveHeadroom(stampContext, layout);
  paintObjectivePads(stampContext, layout);
  clearPowerupPadHeadroom(stampContext, powerups);
  paintPowerupPads(stampContext, powerups);
  if (isDevTesting) {
    paintDevTestingFeaturePads(stampContext, layout, spawnPoints, flagZones);
  }
  removeSmallFloatingFragments(stampContext, layout, SPAWN_EGRESS_FLOATING_CLEANUP_MAX_BLOCKS);
  markStage('objects');

  const collisionLookup = buildCollisionLookup();
  const solidLookup = buildSolidLookup();
  const heightfield = buildHeightfield({
    blocks,
    origin: layout.origin,
    voxelSize: layout.voxelSize,
    size: layout.size,
    collisionLookup,
  });
  const chunks = buildChunks({ blocks, size: layout.size, chunkSize: layout.chunkSize, solidLookup });
  const colliders = generateVoxelColliders({
    origin: layout.origin,
    voxelSize: layout.voxelSize,
    size: layout.size,
    chunkSize: layout.chunkSize,
    chunks,
  });
  const stats = createStats({ chunks, colliders, size: layout.size, chunkSize: layout.chunkSize });
  markStage('compile');

  const compiledDiagnostics = finalizeCompiledMapDiagnostics(blueprint, {
    stats,
    stageTimingsMs: diagnostics?.stageTimingsMs,
    repairActions: {},
    spawnVisibilityPairs: 0,
  });
  markStage('manifest');

  if (diagnostics) {
    diagnostics.designBrief = construction.designBrief;
    diagnostics.blueprint = {
      id: blueprint.id,
      familyId: blueprint.familyId,
      topologyId: blueprint.topologyId,
      lanes: blueprint.lanes,
      routeGraph: blueprint.routeGraph,
      protectedZones: blueprint.protectedZones,
      tacticalSlots: blueprint.tacticalSlots,
      moduleInstances: blueprint.moduleInstances,
      terrainConstraints: blueprint.terrainConstraints,
    };
    diagnostics.map = compiledDiagnostics;
    diagnostics.objectSummary = {
      ...buildObjectSummary(placements),
      health_pack: powerups.filter((pickup) => pickup.kind === 'health_pack').length,
      powerup: powerups.filter((pickup) => pickup.kind === 'powerup').length,
      ...(isDevTesting ? { dev_testing_hero_lineup: 1, dev_testing_target_pad: 1 } : {}),
    };
    diagnostics.repairActions = {};
  }

  return {
    id: `procedural_ctf_${layout.mapSize}_${normalizedSeed.toString(16).padStart(8, '0')}`,
    version: CONSTRUCTED_MAP_MANIFEST_VERSION,
    seed: normalizedSeed,
    mapSize: layout.mapSize,
    profileId: isDevTesting ? DEV_TESTING_MAP_PROFILE_ID : normalizeArenaMapProfileId(effectiveOptions.profileId),
    familyId: construction.designBrief.familyId,
    topologyId: blueprint.topologyId,
    themeId: theme.id,
    theme,
    origin: layout.origin,
    voxelSize: layout.voxelSize,
    size: layout.size,
    chunkSize: layout.chunkSize,
    spawnPoints,
    flagZones,
    boundary: layout.boundary,
    heightfield,
    chunks,
    colliders,
    stats,
    gameplay: {
      mode: construction.designBrief.gameMode,
      boundary: layout.boundary,
      bases: blueprint.bases,
      flags: blueprint.flags,
      spawns: blueprint.spawns,
      protectedZones: blueprint.protectedZones,
      lanes: blueprint.lanes,
      routeGraph: blueprint.routeGraph,
      powerups,
      sightlineSamples: blueprint.sightlineSamples,
    },
    construction: {
      designBrief: construction.designBrief,
      blueprintId: blueprint.id,
      topologyId: blueprint.topologyId,
      tacticalSlots: blueprint.tacticalSlots,
      moduleDefinitions: construction.moduleDefinitions,
      moduleInstances: blueprint.moduleInstances,
      terrainConstraints: blueprint.terrainConstraints,
      diagnostics: compiledDiagnostics,
    },
    world: {
      origin: layout.origin,
      voxelSize: layout.voxelSize,
      size: layout.size,
      heightfield,
      chunks,
      colliders,
      stats,
    },
    preview: blueprint.preview,
  };
}

export function generateProceduralVoxelMap(
  seed = DEFAULT_PROCEDURAL_MAP_SEED,
  options: ProceduralVoxelMapGenerationOptions = {}
): VoxelMapManifest {
  if (isTutorialMapSeed(seed)) {
    return createTutorialVoxelMapManifest();
  }

  if (options.profileId === 'battle_royal_large') {
    return generateBattleRoyalVoxelMap(seed, { themeId: options.themeId, mapSize: options.mapSize });
  }

  return generateProceduralVoxelMapInternal(seed, undefined, getEffectiveGenerationOptions(seed >>> 0, options));
}

export function generateProceduralVoxelMapWithDiagnostics(
  seed = DEFAULT_PROCEDURAL_MAP_SEED,
  options: ProceduralVoxelMapGenerationOptions = {}
): ProceduralVoxelMapGenerationResult {
  if (isTutorialMapSeed(seed)) {
    return {
      manifest: createTutorialVoxelMapManifest(),
      diagnostics: {
        seed: TUTORIAL_MAP_SEED,
        mapSize: TUTORIAL_MAP_SIZE_ID,
        themeId: 'verdant',
        repairActions: {},
        stageTimingsMs: {},
        objectSummary: {
          tutorial: 1,
        },
      },
    };
  }

  const normalizedSeed = seed >>> 0;
  if (options.profileId === 'battle_royal_large') {
    const manifest = generateBattleRoyalVoxelMap(normalizedSeed, { themeId: options.themeId, mapSize: options.mapSize });
    return {
      manifest,
      diagnostics: {
        seed: normalizedSeed,
        mapSize: manifest.mapSize,
        themeId: manifest.themeId,
        designBrief: manifest.construction.designBrief,
        map: manifest.construction.diagnostics,
        repairActions: manifest.construction.diagnostics.repairActions,
        stageTimingsMs: manifest.construction.diagnostics.stageTimingsMs,
        objectSummary: {
          spawn_cluster: Object.keys(manifest.gameplay.spawns).length,
          health_pack: manifest.gameplay.powerups.filter((pickup) => pickup.kind === 'health_pack').length,
          powerup: manifest.gameplay.powerups.filter((pickup) => pickup.kind === 'powerup').length,
        },
      },
    };
  }

  const effectiveOptions = getEffectiveGenerationOptions(normalizedSeed, options);
  const mapSize = normalizeVoxelMapSizeId(effectiveOptions.mapSize);
  const diagnostics = createProceduralVoxelMapDiagnostics(
    normalizedSeed,
    getVoxelMapTheme(normalizedSeed, effectiveOptions.themeId).id,
    mapSize
  );
  const manifest = generateProceduralVoxelMapInternal(normalizedSeed, diagnostics, effectiveOptions);
  return { manifest, diagnostics };
}

let defaultManifest: VoxelMapManifest | null = null;

export function getDefaultProceduralVoxelMap(): VoxelMapManifest {
  if (!defaultManifest) {
    defaultManifest = generateProceduralVoxelMap(DEFAULT_PROCEDURAL_MAP_SEED);
  }
  return defaultManifest;
}
