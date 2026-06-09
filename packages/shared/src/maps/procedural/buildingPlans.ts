import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../../constants/physics.js';
import { isInsideBoundaryPolygon } from './boundaries.js';
import { PROCEDURAL_MAP_SCALE, PROCEDURAL_VOXEL_SIZE } from './ctfLayout.js';
import { mulberry32 } from './rng.js';
import type { BoundaryPoint, VoxelBlockId, VoxelMapTheme, VoxelSize } from './types.js';

export type BuildingIntentId =
  | 'bunker'
  | 'tower_cluster'
  | 'courtyard_fort'
  | 'bridge_outpost'
  | 'market_ruin'
  | 'arena_shell';

export type BuildingVolumeRole =
  | 'core'
  | 'room'
  | 'wing'
  | 'courtyard'
  | 'tower'
  | 'bridge'
  | 'balcony'
  | 'shell'
  | 'hall'
  | 'support';

export type BuildingFootprintZone =
  | 'core'
  | 'room'
  | 'wing'
  | 'courtyard'
  | 'bridge'
  | 'tower'
  | 'balcony'
  | 'shell'
  | 'hall'
  | 'support'
  | 'exterior_edge';

export type BuildingConnectionKind = 'door' | 'hallway' | 'bridge' | 'ramp' | 'courtyard_edge';
export type BuildingOpeningPurpose = 'entrance' | 'courtyard_access' | 'through_route' | 'balcony_access';

export interface BuildingGridPoint {
  x: number;
  z: number;
}

export interface BuildingGridRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface BuildingDirection {
  dx: -1 | 0 | 1;
  dz: -1 | 0 | 1;
  name: 'east' | 'west' | 'north' | 'south';
}

export interface BuildingMaterialProfile {
  floor: VoxelBlockId;
  wall: VoxelBlockId;
  roof: VoxelBlockId;
  accent: VoxelBlockId;
  glass: VoxelBlockId;
  support: VoxelBlockId;
}

export interface BuildingVolume {
  id: string;
  bounds: BuildingGridRect;
  floorRow: number;
  heightRows: number;
  role: BuildingVolumeRole;
  material: BuildingMaterialProfile;
  tags: string[];
}

export interface BuildingOpening {
  id: string;
  localPosition: BuildingGridPoint;
  direction: BuildingDirection;
  widthCells: number;
  heightRows: number;
  purpose: BuildingOpeningPurpose;
  targetVolumeId?: string;
}

export interface BuildingConnection {
  id: string;
  fromVolumeId: string;
  toVolumeId: string;
  kind: BuildingConnectionKind;
  bounds: BuildingGridRect;
  floorRow: number;
  widthCells: number;
}

export interface BuildingFootprintCell {
  x: number;
  z: number;
  zone: BuildingFootprintZone;
  volumeId?: string;
  floorRow: number;
  heightRows: number;
  tags: string[];
}

export interface BuildingPlanMetrics {
  footprintCellCount: number;
  courtyardCellCount: number;
  entranceCount: number;
  interiorFloorCells: number;
  exteriorEdgeCells: number;
  maxHeightRows: number;
  maxFloorRow: number;
  traversableConnectionCount: number;
  estimatedSolidBlocks: number;
  estimatedColliderCells: number;
  minBoundaryDistance: number;
  minProtectedZoneDistance: number;
  spawnFacingEntranceCount: number;
  routeIntersectionCount: number;
  minEntranceWidthCells: number;
  minEntranceHeightRows: number;
  variedRoofCellCount: number;
}

export interface BuildingValidationResult {
  passed: boolean;
  reasons: string[];
  metrics: BuildingPlanMetrics;
}

export interface BuildingWorldBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface BuildingPlan {
  seed: number;
  center: { x: number; z: number };
  gridCenter: BuildingGridPoint;
  bounds: BuildingGridRect;
  worldBounds: BuildingWorldBounds;
  themeId: VoxelMapTheme['id'];
  intent: BuildingIntentId;
  floorRow: number;
  radius: number;
  material: BuildingMaterialProfile;
  volumes: BuildingVolume[];
  openings: BuildingOpening[];
  connections: BuildingConnection[];
  footprint: BuildingFootprintCell[];
  tags: string[];
  metrics: BuildingPlanMetrics;
  signature: string;
}

export interface BuildingIntentDefinition {
  id: BuildingIntentId;
  weight: number;
  roomCount: { min: number; max: number };
  maxHeightScale: { min: number; max: number };
  minEntrances: number;
  targetEntrances: { min: number; max: number };
  erosionChance: number;
  symmetryBias: number;
  elevatedDeckChance: number;
  solidBudgetScale: number;
}

export interface BuildingPlanRequest {
  seed: number;
  center: { x: number; z: number };
  radiusX: number;
  radiusZ: number;
  maxHeightRows: number;
  floorRow: number;
  theme: VoxelMapTheme;
  accentBlock: VoxelBlockId;
  origin: { x: number; z: number };
  size: VoxelSize;
  boundary: BoundaryPoint[];
  spawnPoints: { red: { x: number; z: number }[]; blue: { x: number; z: number }[] };
  flagZones: { red: { x: number; z: number }; blue: { x: number; z: number } };
  intent?: BuildingIntentId;
  approachDistance?: number;
  minEntranceClearanceRows?: number;
  maxEstimatedSolidBlocks?: number;
  maxEstimatedColliderCells?: number;
}

export interface BuildingPlanResult {
  candidate: BuildingPlan;
  validation: BuildingValidationResult;
}

interface BuildingPlanContext {
  request: Required<Pick<BuildingPlanRequest, 'approachDistance' | 'minEntranceClearanceRows' | 'maxEstimatedSolidBlocks' | 'maxEstimatedColliderCells'>> &
    Omit<BuildingPlanRequest, 'approachDistance' | 'minEntranceClearanceRows' | 'maxEstimatedSolidBlocks' | 'maxEstimatedColliderCells'>;
  definition: BuildingIntentDefinition;
  random: () => number;
  radiusCellsX: number;
  radiusCellsZ: number;
  gridCenter: BuildingGridPoint;
  material: BuildingMaterialProfile;
  volumeSerial: number;
  connectionSerial: number;
  courtyardRects: BuildingGridRect[];
  volumes: BuildingVolume[];
  connections: BuildingConnection[];
  tags: Set<string>;
}

const MIN_ROOM_SIZE_CELLS = 5;
const DEFAULT_MAX_ESTIMATED_SOLID_BLOCKS = 36_000;
const DEFAULT_MAX_ESTIMATED_COLLIDER_CELLS = 9_500;
const PLAYER_CLEARANCE_ROWS = Math.max(1, Math.ceil((PLAYER_HEIGHT + 1.0) / PROCEDURAL_VOXEL_SIZE.y));
const MIN_ENTRANCE_WIDTH_CELLS = Math.max(6, Math.ceil((PLAYER_RADIUS * 2 + 0.45) / PROCEDURAL_VOXEL_SIZE.x));
const PROTECTED_FLAG_CLEARANCE = 8 * PROCEDURAL_MAP_SCALE;
const PROTECTED_SPAWN_CLEARANCE = 7 * PROCEDURAL_MAP_SCALE;
const ROUTE_CLEARANCE = 2.15 * PROCEDURAL_MAP_SCALE;

export const BUILDING_DIRECTIONS: BuildingDirection[] = [
  { dx: 1, dz: 0, name: 'east' },
  { dx: -1, dz: 0, name: 'west' },
  { dx: 0, dz: 1, name: 'north' },
  { dx: 0, dz: -1, name: 'south' },
];

export const BUILDING_INTENT_DEFINITIONS: Record<BuildingIntentId, BuildingIntentDefinition> = {
  bunker: {
    id: 'bunker',
    weight: 1.25,
    roomCount: { min: 3, max: 6 },
    maxHeightScale: { min: 0.42, max: 0.62 },
    minEntrances: 2,
    targetEntrances: { min: 2, max: 4 },
    erosionChance: 0.01,
    symmetryBias: 0.72,
    elevatedDeckChance: 0,
    solidBudgetScale: 0.78,
  },
  tower_cluster: {
    id: 'tower_cluster',
    weight: 0.6,
    roomCount: { min: 2, max: 4 },
    maxHeightScale: { min: 0.78, max: 1.18 },
    minEntrances: 2,
    targetEntrances: { min: 2, max: 3 },
    erosionChance: 0.01,
    symmetryBias: 0.5,
    elevatedDeckChance: 0.04,
    solidBudgetScale: 1.05,
  },
  courtyard_fort: {
    id: 'courtyard_fort',
    weight: 1.15,
    roomCount: { min: 3, max: 5 },
    maxHeightScale: { min: 0.56, max: 0.88 },
    minEntrances: 2,
    targetEntrances: { min: 2, max: 4 },
    erosionChance: 0.01,
    symmetryBias: 0.86,
    elevatedDeckChance: 0.06,
    solidBudgetScale: 1.0,
  },
  bridge_outpost: {
    id: 'bridge_outpost',
    weight: 0.16,
    roomCount: { min: 2, max: 3 },
    maxHeightScale: { min: 0.54, max: 0.82 },
    minEntrances: 2,
    targetEntrances: { min: 2, max: 2 },
    erosionChance: 0,
    symmetryBias: 0.68,
    elevatedDeckChance: 1,
    solidBudgetScale: 0.86,
  },
  market_ruin: {
    id: 'market_ruin',
    weight: 0.32,
    roomCount: { min: 2, max: 4 },
    maxHeightScale: { min: 0.36, max: 0.74 },
    minEntrances: 2,
    targetEntrances: { min: 2, max: 4 },
    erosionChance: 0.03,
    symmetryBias: 0.16,
    elevatedDeckChance: 0.04,
    solidBudgetScale: 0.68,
  },
  arena_shell: {
    id: 'arena_shell',
    weight: 0.34,
    roomCount: { min: 3, max: 5 },
    maxHeightScale: { min: 0.52, max: 0.78 },
    minEntrances: 2,
    targetEntrances: { min: 2, max: 4 },
    erosionChance: 0.01,
    symmetryBias: 0.74,
    elevatedDeckChance: 0,
    solidBudgetScale: 0.9,
  },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(valueA: number, valueB: number, amount: number): number {
  return valueA + (valueB - valueA) * amount;
}

function randomInt(random: () => number, min: number, max: number): number {
  return Math.floor(lerp(min, max + 1, random()));
}

function chooseWeighted<T extends string>(random: () => number, entries: Record<T, { weight: number }>): T {
  const keys = Object.keys(entries) as T[];
  const totalWeight = keys.reduce((sum, key) => sum + entries[key].weight, 0);
  let roll = random() * totalWeight;

  for (const key of keys) {
    roll -= entries[key].weight;
    if (roll <= 0) return key;
  }

  return keys[keys.length - 1];
}

function shuffledDirections(random: () => number): BuildingDirection[] {
  const directions = [...BUILDING_DIRECTIONS];

  for (let index = directions.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [directions[index], directions[swapIndex]] = [directions[swapIndex], directions[index]];
  }

  return directions;
}

function worldToGrid(value: number, origin: number): number {
  return Math.floor((value - origin) / PROCEDURAL_VOXEL_SIZE.x);
}

function gridToWorldCenter(value: number, origin: number): number {
  return origin + (value + 0.5) * PROCEDURAL_VOXEL_SIZE.x;
}

function rectWidth(rect: BuildingGridRect): number {
  return rect.x1 - rect.x0 + 1;
}

function rectDepth(rect: BuildingGridRect): number {
  return rect.z1 - rect.z0 + 1;
}

function rectArea(rect: BuildingGridRect): number {
  return Math.max(0, rectWidth(rect)) * Math.max(0, rectDepth(rect));
}

function rectCenter(rect: BuildingGridRect): BuildingGridPoint {
  return {
    x: Math.round((rect.x0 + rect.x1) / 2),
    z: Math.round((rect.z0 + rect.z1) / 2),
  };
}

function normalizeRect(rect: BuildingGridRect): BuildingGridRect {
  return {
    x0: Math.min(rect.x0, rect.x1),
    x1: Math.max(rect.x0, rect.x1),
    z0: Math.min(rect.z0, rect.z1),
    z1: Math.max(rect.z0, rect.z1),
  };
}

function createRect(centerX: number, centerZ: number, width: number, depth: number): BuildingGridRect {
  const halfLowX = Math.floor((width - 1) / 2);
  const halfHighX = Math.ceil((width - 1) / 2);
  const halfLowZ = Math.floor((depth - 1) / 2);
  const halfHighZ = Math.ceil((depth - 1) / 2);

  return {
    x0: centerX - halfLowX,
    x1: centerX + halfHighX,
    z0: centerZ - halfLowZ,
    z1: centerZ + halfHighZ,
  };
}

function clampRectToRadius(rect: BuildingGridRect, radiusCellsX: number, radiusCellsZ: number): BuildingGridRect {
  return {
    x0: clamp(rect.x0, -radiusCellsX, radiusCellsX),
    x1: clamp(rect.x1, -radiusCellsX, radiusCellsX),
    z0: clamp(rect.z0, -radiusCellsZ, radiusCellsZ),
    z1: clamp(rect.z1, -radiusCellsZ, radiusCellsZ),
  };
}

function expandRect(rect: BuildingGridRect, amount: number): BuildingGridRect {
  return {
    x0: rect.x0 - amount,
    x1: rect.x1 + amount,
    z0: rect.z0 - amount,
    z1: rect.z1 + amount,
  };
}

function rectsOverlap(a: BuildingGridRect, b: BuildingGridRect): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0;
}

function rectContains(rect: BuildingGridRect, x: number, z: number): boolean {
  return x >= rect.x0 && x <= rect.x1 && z >= rect.z0 && z <= rect.z1;
}

function distanceSq(xA: number, zA: number, xB: number, zB: number): number {
  const dx = xA - xB;
  const dz = zA - zB;
  return dx * dx + dz * dz;
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

function getAveragePoint(points: { x: number; z: number }[]): { x: number; z: number } {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
}

function toWorldPoint(plan: Pick<BuildingPlan, 'gridCenter'>, request: BuildingPlanRequest, local: BuildingGridPoint): { x: number; z: number } {
  return {
    x: gridToWorldCenter(plan.gridCenter.x + local.x, request.origin.x),
    z: gridToWorldCenter(plan.gridCenter.z + local.z, request.origin.z),
  };
}

function getWorldBounds(gridCenter: BuildingGridPoint, bounds: BuildingGridRect, request: BuildingPlanRequest): BuildingWorldBounds {
  return {
    minX: gridToWorldCenter(gridCenter.x + bounds.x0, request.origin.x) - PROCEDURAL_VOXEL_SIZE.x * 0.5,
    maxX: gridToWorldCenter(gridCenter.x + bounds.x1, request.origin.x) + PROCEDURAL_VOXEL_SIZE.x * 0.5,
    minZ: gridToWorldCenter(gridCenter.z + bounds.z0, request.origin.z) - PROCEDURAL_VOXEL_SIZE.z * 0.5,
    maxZ: gridToWorldCenter(gridCenter.z + bounds.z1, request.origin.z) + PROCEDURAL_VOXEL_SIZE.z * 0.5,
  };
}

function createMaterialProfile(theme: VoxelMapTheme, accentBlock: VoxelBlockId, random: () => number): BuildingMaterialProfile {
  if (theme.id === 'volcanic') {
    return {
      floor: random() > 0.42 ? 'obsidian' : 'metal',
      wall: 'obsidian',
      roof: random() > 0.56 ? 'metal' : 'obsidian',
      accent: accentBlock,
      glass: 'glass',
      support: 'obsidian',
    };
  }

  if (theme.id === 'sakura') {
    return {
      floor: random() > 0.48 ? 'wood' : 'stone',
      wall: random() > 0.36 ? 'wood' : 'stone',
      roof: random() > 0.5 ? 'wood' : 'stone',
      accent: accentBlock,
      glass: 'glass',
      support: random() > 0.5 ? 'wood' : 'stone',
    };
  }

  const themeStone: VoxelBlockId =
    theme.id === 'desert'
      ? 'stone'
      : theme.id === 'verdant'
        ? 'stone'
        : theme.id === 'crystal'
          ? random() > 0.42 ? 'metal' : 'stone'
          : 'metal';

  return {
    floor: random() > 0.58 ? 'metal' : 'stone',
    wall: themeStone,
    roof: theme.id === 'crystal' && random() > 0.72 ? 'glass' : random() > 0.5 ? 'metal' : 'stone',
    accent: accentBlock,
    glass: 'glass',
    support: 'stone',
  };
}

function createContext(request: BuildingPlanRequest): BuildingPlanContext {
  const random = mulberry32(request.seed);
  const intent = request.intent ?? chooseWeighted(random, BUILDING_INTENT_DEFINITIONS);
  const definition = BUILDING_INTENT_DEFINITIONS[intent];

  return {
    request: {
      ...request,
      intent,
      approachDistance: request.approachDistance ?? 4.5 * PROCEDURAL_MAP_SCALE,
      minEntranceClearanceRows: request.minEntranceClearanceRows ?? PLAYER_CLEARANCE_ROWS,
      maxEstimatedSolidBlocks: request.maxEstimatedSolidBlocks ?? DEFAULT_MAX_ESTIMATED_SOLID_BLOCKS,
      maxEstimatedColliderCells: request.maxEstimatedColliderCells ?? DEFAULT_MAX_ESTIMATED_COLLIDER_CELLS,
    },
    definition,
    random,
    radiusCellsX: Math.max(8, Math.round(request.radiusX / PROCEDURAL_VOXEL_SIZE.x)),
    radiusCellsZ: Math.max(8, Math.round(request.radiusZ / PROCEDURAL_VOXEL_SIZE.z)),
    gridCenter: {
      x: worldToGrid(request.center.x, request.origin.x),
      z: worldToGrid(request.center.z, request.origin.z),
    },
    material: createMaterialProfile(request.theme, request.accentBlock, random),
    volumeSerial: 0,
    connectionSerial: 0,
    courtyardRects: [],
    volumes: [],
    connections: [],
    tags: new Set<string>([intent]),
  };
}

function addVolume(
  context: BuildingPlanContext,
  bounds: BuildingGridRect,
  role: BuildingVolumeRole,
  heightRows: number,
  tags: string[] = [],
  floorRow = context.request.floorRow
): BuildingVolume {
  const clippedBounds = clampRectToRadius(normalizeRect(bounds), context.radiusCellsX, context.radiusCellsZ);
  const id = `${role}-${context.volumeSerial++}`;
  const volume: BuildingVolume = {
    id,
    bounds: clippedBounds,
    floorRow,
    heightRows: clamp(heightRows, 2, context.request.size.y - floorRow - 3),
    role,
    material: context.material,
    tags,
  };

  context.volumes.push(volume);
  for (const tag of tags) context.tags.add(tag);
  return volume;
}

function addCourtyard(context: BuildingPlanContext, bounds: BuildingGridRect): void {
  context.courtyardRects.push(clampRectToRadius(normalizeRect(bounds), context.radiusCellsX, context.radiusCellsZ));
  context.tags.add('courtyard');
}

function addConnection(
  context: BuildingPlanContext,
  fromVolume: BuildingVolume,
  toVolume: BuildingVolume,
  kind: BuildingConnectionKind,
  widthCells: number,
  floorRow = Math.max(fromVolume.floorRow, toVolume.floorRow)
): BuildingConnection {
  const fromCenter = rectCenter(fromVolume.bounds);
  const toCenter = rectCenter(toVolume.bounds);
  const horizontalFirst = Math.abs(fromCenter.x - toCenter.x) >= Math.abs(fromCenter.z - toCenter.z);
  const hallBounds = horizontalFirst
    ? {
        x0: Math.min(fromCenter.x, toCenter.x),
        x1: Math.max(fromCenter.x, toCenter.x),
        z0: Math.round((fromCenter.z + toCenter.z) / 2) - Math.floor(widthCells / 2),
        z1: Math.round((fromCenter.z + toCenter.z) / 2) + Math.floor(widthCells / 2),
      }
    : {
        x0: Math.round((fromCenter.x + toCenter.x) / 2) - Math.floor(widthCells / 2),
        x1: Math.round((fromCenter.x + toCenter.x) / 2) + Math.floor(widthCells / 2),
        z0: Math.min(fromCenter.z, toCenter.z),
        z1: Math.max(fromCenter.z, toCenter.z),
      };
  const connection: BuildingConnection = {
    id: `${kind}-${context.connectionSerial++}`,
    fromVolumeId: fromVolume.id,
    toVolumeId: toVolume.id,
    kind,
    bounds: clampRectToRadius(normalizeRect(hallBounds), context.radiusCellsX, context.radiusCellsZ),
    floorRow,
    widthCells,
  };

  context.connections.push(connection);

  if (kind === 'hallway' || kind === 'ramp') {
    addVolume(
      context,
      connection.bounds,
      'hall',
      Math.max(context.request.minEntranceClearanceRows + 2, Math.min(fromVolume.heightRows, toVolume.heightRows)),
      ['connection'],
      floorRow
    );
  }

  return connection;
}

function createAttachedRoomRect(
  anchor: BuildingGridRect,
  direction: BuildingDirection,
  width: number,
  depth: number,
  overlap: number
): BuildingGridRect {
  if (direction.dx !== 0) {
    const centerZ = clamp(
      rectCenter(anchor).z,
      anchor.z0 + Math.floor(depth / 2),
      anchor.z1 - Math.floor(depth / 2)
    );
    const x0 = direction.dx > 0 ? anchor.x1 - overlap + 1 : anchor.x0 - width + overlap;
    return createRect(x0 + Math.floor(width / 2), centerZ, width, depth);
  }

  const centerX = clamp(
    rectCenter(anchor).x,
    anchor.x0 + Math.floor(width / 2),
    anchor.x1 - Math.floor(width / 2)
  );
  const z0 = direction.dz > 0 ? anchor.z1 - overlap + 1 : anchor.z0 - depth + overlap;
  return createRect(centerX, z0 + Math.floor(depth / 2), width, depth);
}

function addAccretedRooms(
  context: BuildingPlanContext,
  anchor: BuildingVolume,
  targetCount: number,
  options: {
    role: BuildingVolumeRole;
    minSize: number;
    maxSize: number;
    minHeightRows: number;
    maxHeightRows: number;
    tags?: string[];
    allowOverlap?: boolean;
  }
): BuildingVolume[] {
  const created: BuildingVolume[] = [];
  const roomTags = options.tags ?? [];

  for (let roomIndex = 0; roomIndex < targetCount; roomIndex++) {
    let placed: BuildingVolume | null = null;
    const shuffled = shuffledDirections(context.random);

    for (let attempt = 0; attempt < 18 && !placed; attempt++) {
      const direction = shuffled[attempt % shuffled.length];
      const source = context.volumes[Math.floor(context.random() * context.volumes.length)] ?? anchor;
      const width = randomInt(context.random, options.minSize, options.maxSize);
      const depth = randomInt(context.random, options.minSize, options.maxSize);
      const overlap = randomInt(context.random, 1, Math.max(2, Math.floor(Math.min(width, depth) * 0.36)));
      const bounds = clampRectToRadius(
        createAttachedRoomRect(source.bounds, direction, width, depth, overlap),
        context.radiusCellsX,
        context.radiusCellsZ
      );

      if (rectWidth(bounds) < MIN_ROOM_SIZE_CELLS || rectDepth(bounds) < MIN_ROOM_SIZE_CELLS) continue;

      const collides = context.volumes.some((volume) => volume.id !== source.id && rectsOverlap(expandRect(bounds, -1), volume.bounds));
      if (collides && !options.allowOverlap) continue;

      const heightRows = randomInt(context.random, options.minHeightRows, options.maxHeightRows);
      placed = addVolume(context, bounds, options.role, heightRows, roomTags);
      addConnection(context, source, placed, 'hallway', randomInt(context.random, 3, 5));
      created.push(placed);
    }
  }

  return created;
}

function getIntentHeight(context: BuildingPlanContext): number {
  const { maxHeightScale } = context.definition;
  return Math.max(
    context.request.minEntranceClearanceRows + 2,
    Math.round(context.request.maxHeightRows * lerp(maxHeightScale.min, maxHeightScale.max, context.random()))
  );
}

function generateBunker(context: BuildingPlanContext): void {
  const baseHeight = getIntentHeight(context);
  const coreWidth = clamp(randomInt(context.random, Math.floor(context.radiusCellsX * 0.82), Math.floor(context.radiusCellsX * 1.22)), 8, context.radiusCellsX * 2);
  const coreDepth = clamp(randomInt(context.random, Math.floor(context.radiusCellsZ * 0.72), Math.floor(context.radiusCellsZ * 1.14)), 8, context.radiusCellsZ * 2);
  const core = addVolume(context, createRect(0, 0, coreWidth, coreDepth), 'core', baseHeight, ['armored', 'low']);
  const wingCount = randomInt(context.random, context.definition.roomCount.min - 1, context.definition.roomCount.max - 1);

  addAccretedRooms(context, core, wingCount, {
    role: 'wing',
    minSize: 6,
    maxSize: Math.max(8, Math.floor(Math.min(context.radiusCellsX, context.radiusCellsZ) * 0.82)),
    minHeightRows: Math.max(context.request.minEntranceClearanceRows + 1, Math.floor(baseHeight * 0.72)),
    maxHeightRows: Math.max(context.request.minEntranceClearanceRows + 2, baseHeight),
    tags: ['armored'],
    allowOverlap: context.random() < context.definition.symmetryBias,
  });
}

function generateTowerCluster(context: BuildingPlanContext): void {
  const maxHeight = getIntentHeight(context);
  const coreSize = clamp(randomInt(context.random, 7, Math.floor(Math.min(context.radiusCellsX, context.radiusCellsZ) * 0.72)), 7, 14);
  const core = addVolume(context, createRect(0, 0, coreSize, coreSize), 'tower', maxHeight, ['vertical_focal']);
  const supportCount = randomInt(context.random, context.definition.roomCount.min - 1, context.definition.roomCount.max - 1);
  const directions = shuffledDirections(context.random);

  for (let index = 0; index < supportCount; index++) {
    const direction = directions[index % directions.length];
    const width = randomInt(context.random, 6, Math.max(7, Math.floor(context.radiusCellsX * 0.55)));
    const depth = randomInt(context.random, 6, Math.max(7, Math.floor(context.radiusCellsZ * 0.55)));
    const distanceX = direction.dx * randomInt(context.random, Math.floor(context.radiusCellsX * 0.36), Math.floor(context.radiusCellsX * 0.72));
    const distanceZ = direction.dz * randomInt(context.random, Math.floor(context.radiusCellsZ * 0.36), Math.floor(context.radiusCellsZ * 0.72));
    const bounds = createRect(distanceX, distanceZ, width, depth);
    const role: BuildingVolumeRole = context.random() > 0.55 ? 'tower' : 'room';
    const volume = addVolume(
      context,
      bounds,
      role,
      role === 'tower' ? Math.floor(maxHeight * lerp(0.64, 0.9, context.random())) : Math.floor(maxHeight * lerp(0.42, 0.62, context.random())),
      role === 'tower' ? ['support_tower'] : []
    );
    addConnection(context, core, volume, 'hallway', randomInt(context.random, 3, 5));
  }
}

function generateCourtyardFort(context: BuildingPlanContext): void {
  const maxHeight = getIntentHeight(context);
  const outerHalfX = Math.max(8, Math.floor(context.radiusCellsX * lerp(0.7, 0.92, context.random())));
  const outerHalfZ = Math.max(8, Math.floor(context.radiusCellsZ * lerp(0.7, 0.92, context.random())));
  const courtHalfX = clamp(Math.floor(outerHalfX * lerp(0.26, 0.42, context.random())), 4, outerHalfX - 4);
  const courtHalfZ = clamp(Math.floor(outerHalfZ * lerp(0.26, 0.42, context.random())), 4, outerHalfZ - 4);
  const wallWidth = randomInt(context.random, 5, 8);
  const north = addVolume(context, { x0: -outerHalfX, x1: outerHalfX, z0: courtHalfZ + 1, z1: courtHalfZ + wallWidth }, 'shell', maxHeight, ['courtyard_wall']);
  const south = addVolume(context, { x0: -outerHalfX, x1: outerHalfX, z0: -courtHalfZ - wallWidth, z1: -courtHalfZ - 1 }, 'shell', maxHeight, ['courtyard_wall']);
  const east = addVolume(context, { x0: courtHalfX + 1, x1: courtHalfX + wallWidth, z0: -outerHalfZ, z1: outerHalfZ }, 'wing', Math.floor(maxHeight * 0.86), ['courtyard_wall']);
  const west = addVolume(context, { x0: -courtHalfX - wallWidth, x1: -courtHalfX - 1, z0: -outerHalfZ, z1: outerHalfZ }, 'wing', Math.floor(maxHeight * 0.86), ['courtyard_wall']);
  addCourtyard(context, { x0: -courtHalfX, x1: courtHalfX, z0: -courtHalfZ, z1: courtHalfZ });
  addConnection(context, north, east, 'courtyard_edge', 4);
  addConnection(context, south, west, 'courtyard_edge', 4);

  if (context.random() < 0.78) {
    const cornerHeight = Math.min(context.request.size.y - context.request.floorRow - 4, Math.floor(maxHeight * lerp(1.08, 1.34, context.random())));
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        if (context.random() < 0.35) continue;
        addVolume(
          context,
          createRect(sx * Math.floor(outerHalfX * 0.78), sz * Math.floor(outerHalfZ * 0.78), randomInt(context.random, 6, 9), randomInt(context.random, 6, 9)),
          'tower',
          cornerHeight,
          ['corner_tower']
        );
      }
    }
  }
}

function generateBridgeOutpost(context: BuildingPlanContext): void {
  const maxHeight = getIntentHeight(context);
  const alongX = context.random() > 0.5;
  const deckOffsetRows = clamp(
    randomInt(context.random, Math.floor(4.5 * PROCEDURAL_MAP_SCALE), Math.floor(6.5 * PROCEDURAL_MAP_SCALE)),
    4,
    Math.max(6, context.request.size.y - context.request.floorRow - maxHeight - 6)
  );
  const deckFloor = clamp(context.request.floorRow + deckOffsetRows, context.request.floorRow + 4, context.request.size.y - maxHeight - 4);
  const halfSpan = Math.max(8, Math.floor((alongX ? context.radiusCellsX : context.radiusCellsZ) * lerp(0.5, 0.72, context.random())));
  const deckWidth = randomInt(context.random, 4, 5);
  const podSize = randomInt(context.random, 6, 9);
  const bridgeBounds = alongX
    ? { x0: -halfSpan, x1: halfSpan, z0: -Math.floor(deckWidth / 2), z1: Math.floor(deckWidth / 2) }
    : { x0: -Math.floor(deckWidth / 2), x1: Math.floor(deckWidth / 2), z0: -halfSpan, z1: halfSpan };
  const bridge = addVolume(context, bridgeBounds, 'bridge', Math.max(context.request.minEntranceClearanceRows + 2, Math.floor(maxHeight * 0.45)), ['elevated', alongX ? 'axis_x' : 'axis_z'], deckFloor);

  for (const sign of [-1, 1]) {
    const centerX = alongX ? sign * Math.floor(halfSpan * 0.72) : 0;
    const centerZ = alongX ? 0 : sign * Math.floor(halfSpan * 0.72);
    const pod = addVolume(
      context,
      createRect(centerX, centerZ, podSize + randomInt(context.random, 0, 4), podSize + randomInt(context.random, 0, 4)),
      'room',
      Math.floor(maxHeight * lerp(0.74, 0.98, context.random())),
      ['elevated_pod'],
      deckFloor
    );
    addConnection(context, bridge, pod, 'bridge', deckWidth, deckFloor);

    const support = addVolume(
      context,
      createRect(centerX, centerZ, randomInt(context.random, 3, 5), randomInt(context.random, 3, 5)),
      'support',
      deckFloor - context.request.floorRow,
      ['support_column'],
      context.request.floorRow
    );
    addConnection(context, support, pod, 'ramp', 3, context.request.floorRow);
  }
}

function generateMarketRuin(context: BuildingPlanContext): void {
  const maxHeight = getIntentHeight(context);
  const coreWidth = clamp(randomInt(context.random, 9, Math.floor(context.radiusCellsX * 1.1)), 9, context.radiusCellsX * 2);
  const coreDepth = clamp(randomInt(context.random, 8, Math.floor(context.radiusCellsZ * 1.0)), 8, context.radiusCellsZ * 2);
  const core = addVolume(
    context,
    createRect(0, 0, coreWidth, coreDepth),
    'core',
    Math.floor(maxHeight * lerp(0.72, 0.92, context.random())),
    ['weathered', 'market_hall']
  );
  const sideRooms = randomInt(context.random, context.definition.roomCount.min, context.definition.roomCount.max);
  const directions = shuffledDirections(context.random);

  for (let index = 0; index < sideRooms; index++) {
    const direction = directions[index % directions.length];
    const width = randomInt(context.random, 6, Math.max(7, Math.floor(context.radiusCellsX * 0.58)));
    const depth = randomInt(context.random, 6, Math.max(7, Math.floor(context.radiusCellsZ * 0.58)));
    const bounds = clampRectToRadius(
      createAttachedRoomRect(core.bounds, direction, width, depth, Math.max(2, Math.floor(Math.min(width, depth) * 0.28))),
      context.radiusCellsX,
      context.radiusCellsZ
    );

    if (rectWidth(bounds) < MIN_ROOM_SIZE_CELLS || rectDepth(bounds) < MIN_ROOM_SIZE_CELLS) continue;
    if (context.volumes.some((volume) => volume.id !== core.id && rectsOverlap(expandRect(bounds, -1), volume.bounds))) continue;

    const room = addVolume(
      context,
      bounds,
      'room',
      Math.floor(maxHeight * lerp(0.56, 0.78, context.random())),
      ['weathered', 'market_room']
    );
    addConnection(context, core, room, 'hallway', randomInt(context.random, 3, 5));
  }

  if (context.random() > 0.35) {
    const courtWidth = randomInt(context.random, 5, Math.max(6, Math.floor(coreWidth * 0.46)));
    const courtDepth = randomInt(context.random, 5, Math.max(6, Math.floor(coreDepth * 0.46)));
    addCourtyard(
      context,
      createRect(
        randomInt(context.random, -2, 2),
        randomInt(context.random, -2, 2),
        courtWidth,
        courtDepth
      )
    );
  }
}

function generateArenaShell(context: BuildingPlanContext): void {
  const maxHeight = getIntentHeight(context);
  const outerHalfX = Math.max(8, Math.floor(context.radiusCellsX * lerp(0.62, 0.82, context.random())));
  const outerHalfZ = Math.max(8, Math.floor(context.radiusCellsZ * lerp(0.62, 0.82, context.random())));
  const innerHalfX = clamp(Math.floor(outerHalfX * lerp(0.42, 0.58, context.random())), 5, outerHalfX - 5);
  const innerHalfZ = clamp(Math.floor(outerHalfZ * lerp(0.42, 0.58, context.random())), 5, outerHalfZ - 5);
  const shellWidth = randomInt(context.random, 3, 5);
  const deckFloor = context.random() < context.definition.elevatedDeckChance
    ? clamp(context.request.floorRow + randomInt(context.random, 3, 6), context.request.floorRow, context.request.size.y - maxHeight - 4)
    : context.request.floorRow;
  const north = addVolume(context, { x0: -outerHalfX, x1: outerHalfX, z0: innerHalfZ, z1: innerHalfZ + shellWidth }, 'shell', maxHeight, ['arena_shell'], deckFloor);
  const south = addVolume(context, { x0: -outerHalfX, x1: outerHalfX, z0: -innerHalfZ - shellWidth, z1: -innerHalfZ }, 'shell', maxHeight, ['arena_shell'], deckFloor);
  const east = addVolume(context, { x0: innerHalfX, x1: innerHalfX + shellWidth, z0: -outerHalfZ, z1: outerHalfZ }, 'balcony', Math.floor(maxHeight * 0.78), ['balcony'], deckFloor);
  const west = addVolume(context, { x0: -innerHalfX - shellWidth, x1: -innerHalfX, z0: -outerHalfZ, z1: outerHalfZ }, 'balcony', Math.floor(maxHeight * 0.78), ['balcony'], deckFloor);
  addCourtyard(context, { x0: -innerHalfX + 1, x1: innerHalfX - 1, z0: -innerHalfZ + 1, z1: innerHalfZ - 1 });
  addConnection(context, north, east, 'courtyard_edge', 5, deckFloor);
  addConnection(context, south, west, 'courtyard_edge', 5, deckFloor);
}

function generateVolumes(context: BuildingPlanContext): void {
  switch (context.definition.id) {
    case 'bunker':
      generateBunker(context);
      break;
    case 'tower_cluster':
      generateTowerCluster(context);
      break;
    case 'courtyard_fort':
      generateCourtyardFort(context);
      break;
    case 'bridge_outpost':
      generateBridgeOutpost(context);
      break;
    case 'market_ruin':
      generateMarketRuin(context);
      break;
    case 'arena_shell':
      generateArenaShell(context);
      break;
  }
}

function getVolumePriority(role: BuildingVolumeRole): number {
  switch (role) {
    case 'tower':
      return 7;
    case 'core':
      return 6;
    case 'bridge':
      return 5;
    case 'shell':
    case 'balcony':
      return 4;
    case 'wing':
    case 'room':
      return 3;
    case 'hall':
      return 2;
    case 'support':
      return 1;
    case 'courtyard':
      return 0;
  }
}

function roleToZone(role: BuildingVolumeRole): BuildingFootprintZone {
  switch (role) {
    case 'core':
      return 'core';
    case 'wing':
      return 'wing';
    case 'tower':
      return 'tower';
    case 'bridge':
      return 'bridge';
    case 'balcony':
      return 'balcony';
    case 'shell':
      return 'shell';
    case 'hall':
      return 'hall';
    case 'support':
      return 'support';
    case 'courtyard':
      return 'courtyard';
    case 'room':
      return 'room';
  }
}

function keyForCell(x: number, z: number): string {
  return `${x},${z}`;
}

function hashCell(seed: number, x: number, z: number, salt: number): number {
  let h = seed >>> 0;
  h ^= Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(z + 0xc2b2ae35, 0x27d4eb2d);
  h ^= Math.imul(salt + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function getCellHeightVariation(context: BuildingPlanContext, volume: BuildingVolume, x: number, z: number): number {
  if (volume.role === 'bridge' || volume.role === 'support' || volume.role === 'hall') return 0;

  const edgeBias = Math.min(
    Math.abs(x - volume.bounds.x0),
    Math.abs(x - volume.bounds.x1),
    Math.abs(z - volume.bounds.z0),
    Math.abs(z - volume.bounds.z1)
  ) <= 1 ? 1 : 0;
  const noise = hashCell(context.request.seed, x, z, volume.id.length);
  const maxVariation =
    volume.role === 'tower' ? 3 :
    volume.role === 'core' ? 2 :
    volume.role === 'shell' || volume.role === 'balcony' ? 1 :
    1;
  const upward = noise > 0.72 ? Math.ceil((noise - 0.72) * maxVariation * 2.1) : 0;
  const damagedDrop = volume.tags.includes('damaged') && noise < 0.16 ? -Math.ceil((0.16 - noise) * 4) : 0;
  const edgeStep = edgeBias && noise > 0.68 ? 1 : 0;

  return clamp(upward + damagedDrop + edgeStep, -2, maxVariation);
}

function buildFootprint(context: BuildingPlanContext): BuildingFootprintCell[] {
  const cells = new Map<string, BuildingFootprintCell>();

  for (const volume of context.volumes) {
    for (let x = volume.bounds.x0; x <= volume.bounds.x1; x++) {
      for (let z = volume.bounds.z0; z <= volume.bounds.z1; z++) {
        const key = keyForCell(x, z);
        const existing = cells.get(key);
        if (existing) {
          const existingRole = context.volumes.find((candidate) => candidate.id === existing.volumeId)?.role ?? 'room';
          if (getVolumePriority(existingRole) > getVolumePriority(volume.role)) continue;
        }

        const heightVariation = getCellHeightVariation(context, volume, x, z);
        cells.set(key, {
          x,
          z,
          zone: roleToZone(volume.role),
          volumeId: volume.id,
          floorRow: volume.floorRow,
          heightRows: clamp(volume.heightRows + heightVariation, context.request.minEntranceClearanceRows + 2, context.request.size.y - volume.floorRow - 3),
          tags: heightVariation !== 0 ? [...volume.tags, 'varied_roof'] : [...volume.tags],
        });
      }
    }
  }

  for (const rect of context.courtyardRects) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      for (let z = rect.z0; z <= rect.z1; z++) {
        cells.set(keyForCell(x, z), {
          x,
          z,
          zone: 'courtyard',
          floorRow: context.request.floorRow,
          heightRows: context.request.minEntranceClearanceRows + 3,
          tags: ['courtyard'],
        });
      }
    }
  }

  const erosionChance = context.definition.erosionChance;
  if (erosionChance > 0) {
    for (const [key, cell] of cells) {
      if (cell.zone === 'courtyard' || cell.zone === 'bridge' || cell.zone === 'support' || cell.zone === 'hall') continue;
      const edgeNeighbors = BUILDING_DIRECTIONS.filter((direction) => !cells.has(keyForCell(cell.x + direction.dx, cell.z + direction.dz))).length;
      if (edgeNeighbors === 0) continue;
      if (context.random() < erosionChance * edgeNeighbors) {
        cells.set(key, {
          ...cell,
          tags: [...new Set([...cell.tags, 'weathered_edge'])],
        });
      }
    }
  }

  return [...cells.values()].sort((a, b) => a.z - b.z || a.x - b.x);
}

function calculateBounds(footprint: BuildingFootprintCell[]): BuildingGridRect {
  return {
    x0: Math.min(...footprint.map((cell) => cell.x)),
    x1: Math.max(...footprint.map((cell) => cell.x)),
    z0: Math.min(...footprint.map((cell) => cell.z)),
    z1: Math.max(...footprint.map((cell) => cell.z)),
  };
}

function hasSolidCell(cells: Map<string, BuildingFootprintCell>, x: number, z: number): boolean {
  const cell = cells.get(keyForCell(x, z));
  return Boolean(cell && cell.zone !== 'courtyard');
}

function isExteriorEdge(cell: BuildingFootprintCell, cells: Map<string, BuildingFootprintCell>): boolean {
  if (cell.zone === 'courtyard') return false;
  return BUILDING_DIRECTIONS.some((direction) => !hasSolidCell(cells, cell.x + direction.dx, cell.z + direction.dz));
}

function getOpeningWorldPoint(plan: BuildingPlan, request: BuildingPlanRequest, opening: BuildingOpening): { x: number; z: number } {
  return toWorldPoint(plan, request, opening.localPosition);
}

function entranceFacesProtectedZone(request: BuildingPlanRequest, openingWorldPoint: { x: number; z: number }, direction: BuildingDirection): boolean {
  const protectedPoints = [
    ...request.spawnPoints.red,
    ...request.spawnPoints.blue,
    request.flagZones.red,
    request.flagZones.blue,
  ];

  for (const point of protectedPoints) {
    const dx = point.x - openingWorldPoint.x;
    const dz = point.z - openingWorldPoint.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    if (distance > 22 * PROCEDURAL_MAP_SCALE) continue;
    const dot = (dx * direction.dx + dz * direction.dz) / Math.max(0.001, distance);
    if (dot > 0.78) return true;
  }

  return false;
}

function chooseEntranceCandidates(
  plan: BuildingPlan,
  request: BuildingPlanRequest,
  footprintCells: Map<string, BuildingFootprintCell>,
  random: () => number
): BuildingOpening[] {
  const edgeCells = plan.footprint.filter((cell) => isExteriorEdge(cell, footprintCells));
  const candidates: Array<{ opening: BuildingOpening; score: number }> = [];
  const targetRange = BUILDING_INTENT_DEFINITIONS[plan.intent].targetEntrances;
  const targetEntrances = randomInt(random, targetRange.min, targetRange.max);

  for (const direction of BUILDING_DIRECTIONS) {
    const sideCells = edgeCells.filter((cell) => !hasSolidCell(footprintCells, cell.x + direction.dx, cell.z + direction.dz));
    if (sideCells.length === 0) continue;

    sideCells.sort((a, b) => {
      const aAxis = direction.dx !== 0 ? a.z : a.x;
      const bAxis = direction.dx !== 0 ? b.z : b.x;
      return Math.abs(aAxis) - Math.abs(bAxis);
    });

    const selected = sideCells[Math.floor(clamp(random() * Math.min(sideCells.length, 5), 0, sideCells.length - 1))];
    const widthCells = clamp(randomInt(random, MIN_ENTRANCE_WIDTH_CELLS, MIN_ENTRANCE_WIDTH_CELLS + 3), MIN_ENTRANCE_WIDTH_CELLS, direction.dx !== 0 ? rectDepth(plan.bounds) : rectWidth(plan.bounds));
    const opening: BuildingOpening = {
      id: `entrance-${direction.name}`,
      localPosition: { x: selected.x, z: selected.z },
      direction,
      widthCells,
      heightRows: Math.max(request.minEntranceClearanceRows ?? PLAYER_CLEARANCE_ROWS, PLAYER_CLEARANCE_ROWS),
      purpose: 'entrance',
      targetVolumeId: selected.volumeId,
    };
    const worldPoint = getOpeningWorldPoint(plan, request, opening);
    const approachPoint = {
      x: worldPoint.x + direction.dx * (request.approachDistance ?? 4.5 * PROCEDURAL_MAP_SCALE),
      z: worldPoint.z + direction.dz * (request.approachDistance ?? 4.5 * PROCEDURAL_MAP_SCALE),
    };
    const boundaryScore = distanceToBoundary(approachPoint.x, approachPoint.z, request.boundary);
    const centerBias = 1 / (1 + Math.abs(worldPoint.x) * 0.05 + Math.abs(worldPoint.z) * 0.025);
    const protectedPenalty = entranceFacesProtectedZone(request, worldPoint, direction) ? 100 : 0;
    const outsidePenalty = isInsideBoundaryPolygon(approachPoint.x, approachPoint.z, request.boundary) ? 0 : 50;
    const score = boundaryScore + centerBias * 8 + random() * 2 - protectedPenalty - outsidePenalty;
    candidates.push({ opening, score });
  }

  candidates.sort((a, b) => b.score - a.score);

  const openings: BuildingOpening[] = [];
  for (const candidate of candidates) {
    const oppositeAlreadyChosen = openings.some(
      (opening) => opening.direction.dx === -candidate.opening.direction.dx && opening.direction.dz === -candidate.opening.direction.dz
    );
    const sameAxisAlreadyChosen = openings.some(
      (opening) =>
        (opening.direction.dx !== 0 && candidate.opening.direction.dx !== 0) ||
        (opening.direction.dz !== 0 && candidate.opening.direction.dz !== 0)
    );

    if (openings.length === 0 || oppositeAlreadyChosen || !sameAxisAlreadyChosen || openings.length < BUILDING_INTENT_DEFINITIONS[plan.intent].minEntrances) {
      openings.push(candidate.opening);
    }

    if (openings.length >= targetEntrances) break;
  }

  return openings;
}

function buildPlan(context: BuildingPlanContext): BuildingPlan {
  generateVolumes(context);

  if (context.volumes.length === 0) {
    addVolume(context, createRect(0, 0, 7, 7), 'core', Math.max(context.request.minEntranceClearanceRows + 2, getIntentHeight(context)), ['fallback']);
  }

  let footprint = buildFootprint(context);
  if (footprint.length === 0) {
    const fallback = addVolume(context, createRect(0, 0, 7, 7), 'core', Math.max(context.request.minEntranceClearanceRows + 2, getIntentHeight(context)), ['fallback']);
    context.connections = context.connections.filter((connection) => connection.fromVolumeId !== fallback.id && connection.toVolumeId !== fallback.id);
    footprint = buildFootprint(context);
  }

  const bounds = calculateBounds(footprint);
  const plan: BuildingPlan = {
    seed: context.request.seed >>> 0,
    center: context.request.center,
    gridCenter: context.gridCenter,
    bounds,
    worldBounds: getWorldBounds(context.gridCenter, bounds, context.request),
    themeId: context.request.theme.id,
    intent: context.definition.id,
    floorRow: context.request.floorRow,
    radius: Math.max(context.request.radiusX, context.request.radiusZ),
    material: context.material,
    volumes: context.volumes,
    openings: [],
    connections: context.connections,
    footprint,
    tags: [...context.tags],
    metrics: createEmptyMetrics(),
    signature: '',
  };
  const footprintCells = new Map(footprint.map((cell) => [keyForCell(cell.x, cell.z), cell]));
  plan.openings = chooseEntranceCandidates(plan, context.request, footprintCells, context.random);
  plan.metrics = measureBuildingPlan(plan, context.request);
  plan.signature = createBuildingPlanSignature(plan);

  return plan;
}

function createEmptyMetrics(): BuildingPlanMetrics {
  return {
    footprintCellCount: 0,
    courtyardCellCount: 0,
    entranceCount: 0,
    interiorFloorCells: 0,
    exteriorEdgeCells: 0,
    maxHeightRows: 0,
    maxFloorRow: 0,
    traversableConnectionCount: 0,
    estimatedSolidBlocks: 0,
    estimatedColliderCells: 0,
    minBoundaryDistance: Number.POSITIVE_INFINITY,
    minProtectedZoneDistance: Number.POSITIVE_INFINITY,
    spawnFacingEntranceCount: 0,
    routeIntersectionCount: 0,
    minEntranceWidthCells: Number.POSITIVE_INFINITY,
    minEntranceHeightRows: Number.POSITIVE_INFINITY,
    variedRoofCellCount: 0,
  };
}

function getProtectedZoneDistance(request: BuildingPlanRequest, worldX: number, worldZ: number): number {
  let minDistance = Number.POSITIVE_INFINITY;

  for (const flag of [request.flagZones.red, request.flagZones.blue]) {
    minDistance = Math.min(minDistance, Math.sqrt(distanceSq(worldX, worldZ, flag.x, flag.z)) - PROTECTED_FLAG_CLEARANCE);
  }

  for (const spawn of [...request.spawnPoints.red, ...request.spawnPoints.blue]) {
    minDistance = Math.min(minDistance, Math.sqrt(distanceSq(worldX, worldZ, spawn.x, spawn.z)) - PROTECTED_SPAWN_CLEARANCE);
  }

  return minDistance;
}

function getGameplayRouteSegments(request: BuildingPlanRequest): Array<{ start: { x: number; z: number }; end: { x: number; z: number } }> {
  const redSpawnCenter = getAveragePoint(request.spawnPoints.red);
  const blueSpawnCenter = getAveragePoint(request.spawnPoints.blue);
  const midfield = { x: 0, z: 0 };

  return [
    { start: redSpawnCenter, end: request.flagZones.red },
    { start: blueSpawnCenter, end: request.flagZones.blue },
    { start: request.flagZones.red, end: midfield },
    { start: request.flagZones.blue, end: midfield },
  ];
}

function measureBuildingPlan(plan: BuildingPlan, request: BuildingPlanRequest): BuildingPlanMetrics {
  const metrics = createEmptyMetrics();
  const footprintCells = new Map(plan.footprint.map((cell) => [keyForCell(cell.x, cell.z), cell]));
  const routeSegments = getGameplayRouteSegments(request);

  metrics.footprintCellCount = plan.footprint.filter((cell) => cell.zone !== 'courtyard').length;
  metrics.courtyardCellCount = plan.footprint.filter((cell) => cell.zone === 'courtyard').length;
  metrics.entranceCount = plan.openings.length;
  metrics.minEntranceWidthCells = plan.openings.reduce((minWidth, opening) => Math.min(minWidth, opening.widthCells), Number.POSITIVE_INFINITY);
  metrics.minEntranceHeightRows = plan.openings.reduce((minHeight, opening) => Math.min(minHeight, opening.heightRows), Number.POSITIVE_INFINITY);
  metrics.traversableConnectionCount = plan.connections.filter(
    (connection) => connection.kind === 'hallway' || connection.kind === 'bridge' || connection.kind === 'ramp' || connection.kind === 'courtyard_edge'
  ).length;

  for (const cell of plan.footprint) {
    const world = toWorldPoint(plan, request, cell);
    const boundaryDistance = distanceToBoundary(world.x, world.z, request.boundary);
    const protectedDistance = getProtectedZoneDistance(request, world.x, world.z);

    metrics.minBoundaryDistance = Math.min(metrics.minBoundaryDistance, boundaryDistance);
    metrics.minProtectedZoneDistance = Math.min(metrics.minProtectedZoneDistance, protectedDistance);
    metrics.maxHeightRows = Math.max(metrics.maxHeightRows, cell.heightRows);
    metrics.maxFloorRow = Math.max(metrics.maxFloorRow, cell.floorRow);
    if (cell.tags.includes('varied_roof')) metrics.variedRoofCellCount++;

    if (cell.zone !== 'courtyard') {
      if (isExteriorEdge(cell, footprintCells)) {
        metrics.exteriorEdgeCells++;
        metrics.estimatedSolidBlocks += Math.max(2, Math.ceil(cell.heightRows * 0.82));
      } else {
        metrics.interiorFloorCells++;
        metrics.estimatedSolidBlocks += 2;
      }
    } else {
      metrics.interiorFloorCells++;
      metrics.estimatedSolidBlocks += 1;
    }

    for (const segment of routeSegments) {
      if (distanceToSegment(world.x, world.z, segment.start.x, segment.start.z, segment.end.x, segment.end.z) < ROUTE_CLEARANCE) {
        metrics.routeIntersectionCount++;
        break;
      }
    }
  }

  for (const opening of plan.openings) {
    if (entranceFacesProtectedZone(request, getOpeningWorldPoint(plan, request, opening), opening.direction)) {
      metrics.spawnFacingEntranceCount++;
    }
  }

  metrics.estimatedColliderCells = metrics.exteriorEdgeCells + metrics.footprintCellCount + Math.ceil(metrics.maxHeightRows * Math.sqrt(metrics.footprintCellCount));

  return metrics;
}

export function validateBuildingPlan(plan: BuildingPlan, request: BuildingPlanRequest): BuildingValidationResult {
  const normalizedRequest = {
    ...request,
    approachDistance: request.approachDistance ?? 4.5 * PROCEDURAL_MAP_SCALE,
    minEntranceClearanceRows: request.minEntranceClearanceRows ?? PLAYER_CLEARANCE_ROWS,
    maxEstimatedSolidBlocks: request.maxEstimatedSolidBlocks ?? DEFAULT_MAX_ESTIMATED_SOLID_BLOCKS,
    maxEstimatedColliderCells: request.maxEstimatedColliderCells ?? DEFAULT_MAX_ESTIMATED_COLLIDER_CELLS,
  };
  const metrics = measureBuildingPlan(plan, normalizedRequest);
  const reasons: string[] = [];
  const definition = BUILDING_INTENT_DEFINITIONS[plan.intent];
  const globalBounds = {
    x0: plan.gridCenter.x + plan.bounds.x0,
    x1: plan.gridCenter.x + plan.bounds.x1,
    z0: plan.gridCenter.z + plan.bounds.z0,
    z1: plan.gridCenter.z + plan.bounds.z1,
  };
  const mediumOrLarge = metrics.footprintCellCount >= 90 || plan.volumes.length >= 3;

  if (metrics.footprintCellCount <= 0) reasons.push('empty_footprint');
  if (globalBounds.x0 < 1 || globalBounds.x1 >= normalizedRequest.size.x - 1 || globalBounds.z0 < 1 || globalBounds.z1 >= normalizedRequest.size.z - 1) {
    reasons.push('outside_map_grid');
  }

  if (metrics.minBoundaryDistance < Math.max(PROCEDURAL_VOXEL_SIZE.x * 4, normalizedRequest.approachDistance * 0.35)) {
    reasons.push('insufficient_boundary_clearance');
  }

  if (metrics.minProtectedZoneDistance < 0) reasons.push('protected_gameplay_area_overlap');
  if (metrics.routeIntersectionCount > Math.max(48, metrics.footprintCellCount * 0.42)) reasons.push('protected_route_overlap');
  if (mediumOrLarge && metrics.entranceCount < Math.max(2, definition.minEntrances)) reasons.push('insufficient_entrances');
  if (plan.openings.some((opening) => opening.heightRows < normalizedRequest.minEntranceClearanceRows || opening.widthCells < MIN_ENTRANCE_WIDTH_CELLS)) reasons.push('entrance_headroom_too_low');
  if (metrics.spawnFacingEntranceCount >= Math.max(2, metrics.entranceCount)) reasons.push('spawn_facing_entrance');
  if (metrics.maxFloorRow + metrics.maxHeightRows + normalizedRequest.minEntranceClearanceRows >= normalizedRequest.size.y - 2) reasons.push('height_exceeds_map_bounds');
  if (metrics.estimatedSolidBlocks > normalizedRequest.maxEstimatedSolidBlocks * definition.solidBudgetScale) reasons.push('solid_block_budget_exceeded');
  if (metrics.estimatedColliderCells > normalizedRequest.maxEstimatedColliderCells) reasons.push('collider_budget_exceeded');
  if ((plan.intent === 'courtyard_fort' || plan.intent === 'arena_shell') && metrics.courtyardCellCount < 16) reasons.push('courtyard_not_traversable');
  if (mediumOrLarge && metrics.traversableConnectionCount < 2) reasons.push('insufficient_traversable_connections');

  for (const opening of plan.openings) {
    const world = getOpeningWorldPoint(plan, normalizedRequest, opening);
    const approachPoint = {
      x: world.x + opening.direction.dx * normalizedRequest.approachDistance,
      z: world.z + opening.direction.dz * normalizedRequest.approachDistance,
    };

    if (!isInsideBoundaryPolygon(approachPoint.x, approachPoint.z, normalizedRequest.boundary)) {
      reasons.push('entrance_approach_outside_boundary');
      break;
    }
  }

  return {
    passed: reasons.length === 0,
    reasons: [...new Set(reasons)],
    metrics,
  };
}

export function createBuildingPlan(request: BuildingPlanRequest): BuildingPlanResult {
  const context = createContext(request);
  const candidate = buildPlan(context);
  const validation = validateBuildingPlan(candidate, context.request);

  candidate.metrics = validation.metrics;
  candidate.signature = createBuildingPlanSignature(candidate);

  return {
    candidate,
    validation,
  };
}

export function selectBuildingIntent(seed: number): BuildingIntentId {
  return chooseWeighted(mulberry32(seed), BUILDING_INTENT_DEFINITIONS);
}

export function createBuildingPlanSignature(plan: BuildingPlan): string {
  const width = rectWidth(plan.bounds);
  const depth = rectDepth(plan.bounds);
  const heightBand = Math.ceil(plan.metrics.maxHeightRows / 4);
  const areaBand = Math.ceil(plan.metrics.footprintCellCount / 32);
  const roleCounts = plan.volumes.reduce<Record<string, number>>((counts, volume) => {
    counts[volume.role] = (counts[volume.role] ?? 0) + 1;
    return counts;
  }, {});
  const roles = Object.entries(roleCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([role, count]) => `${role}:${count}`)
    .join('|');

  return `${plan.intent};${width}x${depth};h${heightBand};a${areaBand};e${plan.metrics.entranceCount};${roles}`;
}
