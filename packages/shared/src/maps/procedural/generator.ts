import { PLAYER_HEIGHT } from '../../constants/physics.js';
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
  | 'boulder_patch'
  | 'crystal_spire'
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
const MAX_TERRAIN_STEP_ROWS = 2;
const BASE_TERRAIN_ROWS = Math.round(4.8 / PROCEDURAL_VOXEL_SIZE.y);
const MIN_TERRAIN_ROWS = Math.round(3.2 / PROCEDURAL_VOXEL_SIZE.y);
const MAX_TERRAIN_ROWS = Math.round(7.6 / PROCEDURAL_VOXEL_SIZE.y);
const OBJECTIVE_PAD_RADIUS = 3.9;
const OBJECTIVE_PAD_BLEND = 2.4;
const SPAWN_PAD_RADIUS = 1.65;
const FLAG_PAD_RADIUS = 2.6;
const BOUNDARY_WALL_THICKNESS = 2.2;
const BOUNDARY_WALL_ROWS = Math.round(15.5 / PROCEDURAL_VOXEL_SIZE.y);
const HEADROOM_ROWS = Math.ceil((PLAYER_HEIGHT + 0.45) / PROCEDURAL_VOXEL_SIZE.y);
const RANDOM_OBJECT_ATTEMPTS = 120;

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
  return {
    air: getBlockNumericId('air'),
    terrainTop: getBlockNumericId(terrain.top),
    terrainSide: getBlockNumericId(terrain.side),
    terrainDeep: getBlockNumericId(terrain.deep),
    stone: getBlockNumericId('stone'),
    floor: getBlockNumericId('metal'),
    wall: getBlockNumericId(theme.id === 'volcanic' || theme.id === 'basalt' ? 'obsidian' : 'stone'),
    trim: getBlockNumericId(theme.id === 'frost' ? 'ice' : 'glass'),
    glass: getBlockNumericId('glass'),
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
      const along = worldX * axis.x + worldZ * axis.z;
      const across = worldX * normal.x + worldZ * normal.z;
      const wave = Math.sin(along * 0.13 + (seed % 97)) * 1.5 + Math.cos(across * 0.16 + (seed % 131)) * 1.1;
      const boundaryFade = inside ? clamp(distanceToBoundary(worldX, worldZ, boundary) / 6.5, 0, 1) : 0;
      const row = Math.round(BASE_TERRAIN_ROWS + broad * 10 + local * 3 + wave * boundaryFade);
      heightMap[columnIndex(x, z, size)] = clamp(row, MIN_TERRAIN_ROWS, MAX_TERRAIN_ROWS);
    }
  }

  limitHeightSteps(heightMap, layout, MAX_TERRAIN_STEP_ROWS, 5);
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

function getSlotRadius(slot: TacticalSlot): number {
  return slot.footprint.radius ?? Math.max(slot.footprint.halfExtents?.x ?? 2.6, slot.footprint.halfExtents?.z ?? 2.6);
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
        kind: variant % 2 === 0 ? 'ruin_cover' : 'cover_cluster',
        moduleId: 'side_lane_ruin',
        roleTags: ['side_lane_cover_chain', 'hard_cover_cluster', 'route_cover', 'structure'],
      };
    case 'flank_landmark':
    case 'defender_perch':
      return {
        kind: variant % 2 === 0 ? 'landmark_tower' : 'supported_gate',
        moduleId: 'tower_perch',
        roleTags: ['defender_perch', 'flank_landmark', 'landmark', 'structure'],
      };
    case 'elevated_bridge':
    case 'traversal_ramp':
    case 'underpass':
    case 'tunnel_entrance':
      return {
        kind: 'supported_gate',
        moduleId: slot.role === 'underpass' || slot.role === 'tunnel_entrance' ? 'tunnel_segment' : 'bridge_platform',
        roleTags: [slot.role, 'traversal', 'structure'],
      };
    case 'soft_cover_cluster':
    default:
      return {
        kind: variant % 2 === 0 ? 'boulder_patch' : 'cover_cluster',
        moduleId: 'soft_natural_cover_patch',
        roleTags: ['soft_cover_cluster', 'natural', 'route_cover'],
      };
  }
}

function createPlacedStructureFromSlot(seed: number, slot: TacticalSlot, layout: ProceduralCTFLayout, heightMap: Uint16Array): PlacedStructure {
  const structure = roleToStructure(slot, seed);
  const radius = getSlotRadius(slot);
  const padRadius = Math.max(radius + 1.2, slot.role === 'base_shell' ? 6.2 : slot.role === 'spawn_shelter' ? 4.4 : 3.2);
  const surfaceRow = sampleMedianHeight(heightMap, layout.origin, layout.size, layout.voxelSize, slot.position, padRadius);

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
    footprint: slot.footprint,
    radius,
    padRadius,
    surfaceRow,
    variant: hashString(`${seed}:${slot.id}:${structure.kind}`),
  };
}

function placementOverlaps(
  point: { x: number; z: number },
  radius: number,
  placements: PlacedStructure[],
  extraSpacing = 1.3
): boolean {
  return placements.some((placement) => distance2D(point, placement.position) < radius + placement.radius + extraSpacing);
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

function createDecorativePlacements(seed: number, layout: ProceduralCTFLayout, heightMap: Uint16Array, placements: PlacedStructure[]): PlacedStructure[] {
  const random = mulberry32(seed ^ 0xa17c9e3b);
  const bounds = boundaryBounds(layout.boundary);
  const kinds: StructureKind[] = ['boulder_patch', 'crystal_spire', 'crate_stack', 'garden_marker', 'ruin_cover', 'cover_cluster'];
  const targetCount = 9 + Math.floor(random() * 5);
  const accepted: PlacedStructure[] = [];

  for (let attempt = 0; attempt < RANDOM_OBJECT_ATTEMPTS && accepted.length < targetCount; attempt++) {
    const x = lerp(bounds.minX + 3, bounds.maxX - 3, random());
    const z = lerp(bounds.minZ + 3, bounds.maxZ - 3, random());
    const radius = lerp(1.25, 2.9, random());
    const point = { x, z };

    if (!isInsideBoundaryPolygon(x, z, layout.boundary)) continue;
    if (distanceToBoundary(x, z, layout.boundary) < radius + 1.8) continue;
    if (isProtectedObjectivePoint(point, layout, radius)) continue;
    if (placementOverlaps(point, radius, [...placements, ...accepted], 1.4)) continue;

    const kind = kinds[Math.floor(random() * kinds.length) % kinds.length];
    const surfaceRow = sampleMedianHeight(heightMap, layout.origin, layout.size, layout.voxelSize, point, radius + 1);
    accepted.push({
      id: `dressing_${accepted.length + 1}_${kind}`,
      slotId: `dressing_${accepted.length + 1}`,
      kind,
      role: kind === 'ruin_cover' || kind === 'cover_cluster' ? 'soft_cover_cluster' : 'flank_landmark',
      moduleId: kind === 'ruin_cover' ? 'side_lane_ruin' : 'soft_natural_cover_patch',
      roleTags:
        kind === 'ruin_cover' || kind === 'cover_cluster'
          ? ['soft_cover_cluster', 'natural', 'route_cover']
          : ['flank_landmark', 'natural', 'landmark'],
      position: { x, y: gridRowsToWorldY(surfaceRow, layout.origin.y, layout.voxelSize.y), z },
      facing: normalize2D({ x: random() - 0.5, z: random() - 0.5 }),
      footprint: { shape: 'circle', radius },
      radius,
      padRadius: radius + 0.65,
      surfaceRow,
      variant: Math.floor(random() * 0xffffffff) >>> 0,
    });
  }

  return accepted;
}

function createPlacedStructures(seed: number, construction: MapConstructionResult, layout: ProceduralCTFLayout, heightMap: Uint16Array): PlacedStructure[] {
  const required = construction.blueprint.tacticalSlots.map((slot) =>
    createPlacedStructureFromSlot(seed, slot, layout, heightMap)
  );
  const decorative = createDecorativePlacements(seed, layout, heightMap, required);
  return [...required, ...decorative];
}

function flattenStructurePads(heightMap: Uint16Array, layout: ProceduralCTFLayout, placements: PlacedStructure[]): void {
  for (const placement of placements) {
    flattenDisc(
      heightMap,
      layout.origin,
      layout.size,
      layout.voxelSize,
      placement.position,
      placement.padRadius,
      placement.surfaceRow,
      Math.max(1.8, placement.padRadius * 0.35)
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

function stampBaseBunker(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const width = 9.8;
  const depth = 7.2;
  const wallHeight = 5 + (placement.variant % 3);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, -depth / 2 + 0.35, width, 0.7, row + 1, row + wallHeight, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.35, -0.3, 0.7, depth - 0.8, row + 1, row + wallHeight, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.35, -0.3, 0.7, depth - 0.8, row + 1, row + wallHeight, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 1.3, depth / 2 - 0.45, 1.6, 0.9, row + 1, row + 3, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 1.3, depth / 2 - 0.45, 1.6, 0.9, row + 1, row + 3, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0.8, 2.4, 0.8, row + 1, row + 2, placement.team === 'red' ? ctx.palette.red : ctx.palette.blue);
}

function stampSpawnShelter(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const width = 7.4;
  const depth = 5.2;
  const canopyRow = row + 11;
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, depth, row, row, placement.team === 'red' ? ctx.palette.spawnRed : ctx.palette.spawnBlue);
  for (const side of [-1, 1]) {
    for (const forward of [-1, 1]) {
      stampPillar(ctx, placement, side * (width / 2 - 0.6), forward * (depth / 2 - 0.6), 0.65, row + 1, canopyRow, ctx.palette.wall);
    }
  }
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width + 0.7, depth + 0.7, canopyRow, canopyRow + 1, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, -depth / 2 + 0.45, width - 1.4, 0.6, row + 1, row + 3, ctx.palette.wall);
}

function stampFlagPlinth(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const teamBlock = placement.team === 'red' ? ctx.palette.red : ctx.palette.blue;
  stampDisc(ctx, placement.position, FLAG_PAD_RADIUS, row, ctx.palette.flag);
  stampDisc(ctx, placement.position, 1.35, row + 1, teamBlock);
  for (const side of [-1, 1]) {
    stampPillar(ctx, placement, side * 2.1, -2.1, 0.45, row, row + 3, ctx.palette.trim);
    stampPillar(ctx, placement, side * 2.1, 2.1, 0.45, row, row + 3, ctx.palette.trim);
  }
}

function stampMidWall(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const width = 12.4;
  const height = 7 + (placement.variant % 4);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, 1.15, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width * 0.28, 0.85, 2.2, 1.0, row, row + 3, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, width * 0.28, -0.85, 2.2, 1.0, row, row + 3, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width + 0.5, 0.55, row + height + 1, row + height + 1, ctx.palette.trim);
}

function stampRuinCover(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const width = 5.8 + (placement.variant % 3) * 0.6;
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, 0.85, row, row + 5, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.45, 1.6, 0.9, 3.2, row, row + 3, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.65, -1.4, 1.2, 2.4, row, row + 2, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0.2, 2.7, width * 0.65, 0.7, row, row + 1, ctx.palette.trim);
}

function stampLandmarkTower(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const height = 9 + (placement.variant % 5);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, 3.2, 3.2, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, 4.2, 4.2, row, row + 1, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, 3.9, 3.9, row + height + 1, row + height + 1, ctx.palette.trim);
  stampPillar(ctx, placement, 0, 0, 1.2, row + height + 2, row + height + 4, placement.team === 'blue' ? ctx.palette.blue : ctx.palette.red);
}

function stampSupportedGate(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const width = 6.6;
  const height = 8 + (placement.variant % 3);
  stampOrientedBoxAtLocal(ctx, placement, -width / 2 + 0.65, 0, 1.3, 2.8, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, width / 2 - 0.65, 0, 1.3, 2.8, row, row + height, ctx.palette.wall);
  stampOrientedBoxAtLocal(ctx, placement, 0, 0, width, 1.4, row + height + 1, row + height + 2, ctx.palette.trim);
  stampOrientedBoxAtLocal(ctx, placement, 0, -1.55, width - 1.8, 0.75, row, row + 1, ctx.palette.floor);
  stampOrientedBoxAtLocal(ctx, placement, 0, 1.55, width - 1.8, 0.75, row, row + 1, ctx.palette.floor);
}

function stampCoverCluster(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const offsets = [
    { side: -1.6, forward: -0.6, width: 1.8, depth: 1.5, height: 3 },
    { side: 0.4, forward: 0.4, width: 2.3, depth: 1.6, height: 4 },
    { side: 1.9, forward: -1.1, width: 1.4, depth: 1.8, height: 2 },
  ];
  for (const offset of offsets) {
    stampOrientedBoxAtLocal(
      ctx,
      placement,
      offset.side,
      offset.forward,
      offset.width,
      offset.depth,
      row,
      row + offset.height + (placement.variant % 2),
      offset.height >= 4 ? ctx.palette.wall : ctx.palette.floor
    );
  }
}

function stampBoulderPatch(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const count = 4 + (placement.variant % 3);
  const random = mulberry32(placement.variant ^ 0x6b6f756c);
  for (let index = 0; index < count; index++) {
    const side = lerp(-2.0, 2.0, random());
    const forward = lerp(-1.8, 1.8, random());
    const width = lerp(0.9, 1.8, random());
    const height = 1 + Math.floor(random() * 4);
    stampOrientedBoxAtLocal(ctx, placement, side, forward, width, width * lerp(0.85, 1.35, random()), row, row + height, ctx.palette.stone);
  }
}

function stampCrystalSpire(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const height = 5 + (placement.variant % 6);
  stampPillar(ctx, placement, 0, 0, 1.2, row, row + height, ctx.palette.trim);
  stampPillar(ctx, placement, -1.3, 0.9, 0.8, row, row + Math.max(2, height - 3), ctx.palette.glass);
  stampPillar(ctx, placement, 1.1, -0.8, 0.7, row, row + Math.max(2, height - 2), ctx.palette.glass);
}

function stampCrateStack(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  const count = 3 + (placement.variant % 3);
  const random = mulberry32(placement.variant ^ 0x43524154);
  for (let index = 0; index < count; index++) {
    const side = lerp(-1.6, 1.6, random());
    const forward = lerp(-1.3, 1.3, random());
    const height = 1 + Math.floor(random() * 3);
    stampOrientedBoxAtLocal(ctx, placement, side, forward, 1.15, 1.15, row, row + height, index % 2 === 0 ? ctx.palette.wood : ctx.palette.floor);
  }
}

function stampGardenMarker(ctx: StructureStampContext, placement: PlacedStructure): void {
  const row = placement.surfaceRow;
  stampDisc(ctx, placement.position, 1.6, row, ctx.palette.terrainTop);
  stampPillar(ctx, placement, 0, 0, 0.7, row + 1, row + 5, ctx.palette.wood);
  stampPillar(ctx, placement, 0, 0, 2.1, row + 5, row + 6, ctx.palette.foliage);
  stampPillar(ctx, placement, -1.5, 0.7, 0.7, row, row + 3, ctx.palette.foliage);
  stampPillar(ctx, placement, 1.3, -0.8, 0.7, row, row + 3, ctx.palette.foliage);
}

function stampStructure(ctx: StructureStampContext, placement: PlacedStructure): void {
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
    case 'boulder_patch':
      stampBoulderPatch(ctx, placement);
      break;
    case 'crystal_spire':
      stampCrystalSpire(ctx, placement);
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
      const wallBand = distanceToBoundary(worldX, worldZ, boundary) <= BOUNDARY_WALL_THICKNESS;

      for (let y = 0; y < height; y++) {
        setBlock(ctx, x, y, z, getTerrainBlockForDepth(ctx.palette, height - 1 - y));
      }

      if (wallBand || !inside) {
        const rib = (Math.floor(worldX * 1.3) + Math.floor(worldZ * 1.3)) % 7 === 0;
        const wallBlock = rib ? ctx.palette.trim : ctx.palette.wall;
        for (let y = height; y <= Math.min(size.y - 1, BOUNDARY_WALL_ROWS); y++) {
          setBlock(ctx, x, y, z, wallBlock);
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
  const clearPoint = (point: Vec3, radius: number): void => {
    const center = getGridPointForWorld(point, ctx.origin, ctx.size, ctx.voxelSize);
    const surfaceRow = ctx.heightMap[columnIndex(center.x, center.z, ctx.size)];
    const minX = worldToGrid(point.x - radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
    const maxX = worldToGrid(point.x + radius, ctx.origin.x, ctx.voxelSize.x, ctx.size.x);
    const minZ = worldToGrid(point.z - radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);
    const maxZ = worldToGrid(point.z + radius, ctx.origin.z, ctx.voxelSize.z, ctx.size.z);

    for (let z = minZ; z <= maxZ; z++) {
      const worldZ = gridToWorldCenter(z, ctx.origin.z, ctx.voxelSize.z);
      for (let x = minX; x <= maxX; x++) {
        const worldX = gridToWorldCenter(x, ctx.origin.x, ctx.voxelSize.x);
        if ((worldX - point.x) ** 2 + (worldZ - point.z) ** 2 > radius * radius) continue;

        for (let y = surfaceRow + 1; y <= Math.min(ctx.size.y - 1, surfaceRow + HEADROOM_ROWS); y++) {
          setBlock(ctx, x, y, z, AIR);
        }
      }
    }
  };

  for (const point of [...layout.spawnPoints.red, ...layout.spawnPoints.blue]) clearPoint(point, 1.25);
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
  diagnostics?: ProceduralVoxelMapDiagnostics
): VoxelMapManifest {
  const normalizedSeed = seed >>> 0;
  const markStage = markStageFactory(diagnostics);
  const layout = createProceduralCTFLayout(normalizedSeed);
  const theme = getVoxelMapTheme(normalizedSeed);
  const construction = createMapConstruction(normalizedSeed, layout, theme);
  const palette = createBlockPalette(theme);
  markStage('layout');

  const heightMap = createHeightMap(normalizedSeed, layout);
  flattenGameplayPads(heightMap, layout);
  const placements = createPlacedStructures(normalizedSeed, construction, layout, heightMap);
  flattenStructurePads(heightMap, layout, placements);
  limitHeightSteps(heightMap, layout, MAX_TERRAIN_STEP_ROWS, 5);
  flattenGameplayPads(heightMap, layout);
  flattenStructurePads(heightMap, layout, placements);
  updatePlacementSurfaceRows(heightMap, layout, placements);
  markStage('terrain');

  const blocks = new Uint8Array(layout.size.x * layout.size.y * layout.size.z);
  const stampContext: StructureStampContext = {
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
  clearObjectiveHeadroom(stampContext, layout);
  paintObjectivePads(stampContext, layout);
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

export function generateProceduralVoxelMap(seed = DEFAULT_PROCEDURAL_MAP_SEED): VoxelMapManifest {
  return generateProceduralVoxelMapInternal(seed);
}

export function generateProceduralVoxelMapWithDiagnostics(seed = DEFAULT_PROCEDURAL_MAP_SEED): ProceduralVoxelMapGenerationResult {
  const normalizedSeed = seed >>> 0;
  const diagnostics = createProceduralVoxelMapDiagnostics(normalizedSeed, getVoxelMapTheme(normalizedSeed).id);
  const manifest = generateProceduralVoxelMapInternal(normalizedSeed, diagnostics);
  return { manifest, diagnostics };
}

let defaultManifest: VoxelMapManifest | null = null;

export function getDefaultProceduralVoxelMap(): VoxelMapManifest {
  if (!defaultManifest) {
    defaultManifest = generateProceduralVoxelMap(DEFAULT_PROCEDURAL_MAP_SEED);
  }
  return defaultManifest;
}
