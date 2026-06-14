import { PLAYER_HEIGHT, PLAYER_RADIUS, STEP_HEIGHT } from '../../constants/physics.js';
import type { Vec3 } from '../../types/vector.js';
import { getBlockNumericId, isCollisionBlock, isSolidBlock } from './blocks.js';
import { isInsideBoundaryPolygon } from './boundaries.js';
import { generateVoxelColliders } from './colliders.js';
import {
  createMapConstruction,
  finalizeCompiledMapDiagnostics,
  type MapConstructionResult,
} from './construction.js';
import { createProceduralCTFLayout, PROCEDURAL_VOXEL_SIZE, type ProceduralCTFLayout } from './ctfLayout.js';
import { fractalNoise2 } from './noise.js';
import { mulberry32 } from './rng.js';
import { getVoxelMapTheme } from './themes.js';
import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  DEFAULT_PROCEDURAL_MAP_SEED,
  type BoundaryPoint,
  type MapBlueprint,
  type MapDesignBrief,
  type MapDiagnostics,
  type MapTeam,
  type ModuleInstance,
  type ModuleRoleTag,
  type TacticalSlot,
  type TacticalSlotRole,
  type TeamMap,
  type VoxelBlockId,
  type VoxelChunk,
  type VoxelMapManifest,
  type VoxelMapStats,
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
const RANDOM_OBJECT_ATTEMPTS = 180;
const DECORATIVE_OBJECT_MIN_COUNT = 8;
const DECORATIVE_OBJECT_VARIANCE = 4;
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

function createProceduralVoxelMapDiagnostics(seed: number, themeId: VoxelMapTheme['id']): ProceduralVoxelMapDiagnostics {
  return {
    seed,
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

function createDecorativePlacements(
  seed: number,
  layout: ProceduralCTFLayout,
  theme: VoxelMapTheme,
  heightMap: Uint16Array,
  placements: PlacedStructure[]
): PlacedStructure[] {
  const random = mulberry32(seed ^ 0xa17c9e3b);
  const bounds = boundaryBounds(layout.boundary);
  const targetCount = DECORATIVE_OBJECT_MIN_COUNT + Math.floor(random() * DECORATIVE_OBJECT_VARIANCE);
  const accepted: PlacedStructure[] = [];

  for (let attempt = 0; attempt < RANDOM_OBJECT_ATTEMPTS && accepted.length < targetCount; attempt++) {
    const isFillerPass = attempt > RANDOM_OBJECT_ATTEMPTS * 0.62;
    const x = lerp(bounds.minX + 3, bounds.maxX - 3, random());
    const z = lerp(bounds.minZ + 3, bounds.maxZ - 3, random());
    const radius = isFillerPass ? lerp(1.1, 2.4, random()) : lerp(1.35, 3.45, Math.pow(random(), 0.85));
    const point = { x, z };

    if (!isInsideBoundaryPolygon(x, z, layout.boundary)) continue;
    if (distanceToBoundary(x, z, layout.boundary) < radius + 1.8) continue;
    if (isProtectedObjectivePoint(point, layout, radius)) continue;
    const spacing = isFillerPass ? 0.7 : 1.15;
    if (placementOverlaps(point, radius, placements, spacing)) continue;
    if (placementOverlaps(point, radius, accepted, spacing)) continue;

    const kind = chooseDecorativeStructureKind(theme, random, accepted.length);
    const metadata = getDecorativeStructureMetadata(kind);
    const surfaceRow = sampleMedianHeight(heightMap, layout.origin, layout.size, layout.voxelSize, point, radius + 1);
    accepted.push({
      id: `dressing_${accepted.length + 1}_${kind}`,
      slotId: `dressing_${accepted.length + 1}`,
      kind,
      role: metadata.role,
      moduleId: metadata.moduleId,
      roleTags: metadata.roleTags,
      position: { x, y: gridRowsToWorldY(surfaceRow, layout.origin.y, layout.voxelSize.y), z },
      facing: normalize2D({ x: random() - 0.5, z: random() - 0.5 }),
      footprint: { shape: 'circle', radius },
      radius,
      padRadius: radius + 0.85,
      surfaceRow,
      variant: Math.floor(random() * 0xffffffff) >>> 0,
    });
  }

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
  const markStage = markStageFactory(diagnostics);
  const layout = createProceduralCTFLayout(normalizedSeed);
  const theme = getVoxelMapTheme(normalizedSeed, options.themeId);
  const construction = createMapConstruction(normalizedSeed, layout, theme);
  const palette = createBlockPalette(theme);
  markStage('layout');

  const heightMap = createHeightMap(normalizedSeed, layout);
  flattenGameplayPads(heightMap, layout);
  const placements = createPlacedStructures(normalizedSeed, construction, layout, theme, heightMap);
  flattenStructurePads(heightMap, layout, placements);
  limitHeightSteps(heightMap, layout, MAX_TERRAIN_STEP_ROWS, FINAL_TERRAIN_SMOOTHING_PASSES);
  flattenGameplayPads(heightMap, layout);
  flattenStructurePads(heightMap, layout, placements);
  updatePlacementSurfaceRows(heightMap, layout, placements);
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

  const spawnPoints = createSpawnPoints(layout, heightMap);
  const flagZones = createFlagZones(layout, heightMap);
  const blueprint = patchBlueprintForGeneratedMap({
    blueprint: construction.blueprint,
    construction,
    layout,
    heightMap,
    spawnPoints,
    flagZones,
    placements,
  });
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
    diagnostics.objectSummary = buildObjectSummary(placements);
    diagnostics.repairActions = {};
  }

  return {
    id: `procedural_ctf_${normalizedSeed.toString(16).padStart(8, '0')}`,
    version: CONSTRUCTED_MAP_MANIFEST_VERSION,
    seed: normalizedSeed,
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
  return generateProceduralVoxelMapInternal(seed, undefined, options);
}

export function generateProceduralVoxelMapWithDiagnostics(
  seed = DEFAULT_PROCEDURAL_MAP_SEED,
  options: ProceduralVoxelMapGenerationOptions = {}
): ProceduralVoxelMapGenerationResult {
  const normalizedSeed = seed >>> 0;
  const diagnostics = createProceduralVoxelMapDiagnostics(normalizedSeed, getVoxelMapTheme(normalizedSeed, options.themeId).id);
  const manifest = generateProceduralVoxelMapInternal(normalizedSeed, diagnostics, options);
  return { manifest, diagnostics };
}

let defaultManifest: VoxelMapManifest | null = null;

export function getDefaultProceduralVoxelMap(): VoxelMapManifest {
  if (!defaultManifest) {
    defaultManifest = generateProceduralVoxelMap(DEFAULT_PROCEDURAL_MAP_SEED);
  }
  return defaultManifest;
}
