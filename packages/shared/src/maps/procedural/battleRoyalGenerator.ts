import {
  POWERUP_PICKUP_RADIUS,
  POWERUP_RESPAWN_SECONDS,
} from '../../constants/game.js';
import { BATTLE_ROYAL_TEAM_IDS } from '../../types/team.js';
import type { Vec3 } from '../../types/vector.js';
import { getBlockNumericId } from './blocks.js';
import { generateVoxelColliders } from './colliders.js';
import { fractalNoise2 } from './noise.js';
import { hashSeed, mulberry32 } from './rng.js';
import { getVoxelMapTheme } from './themes.js';
import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  type BaseZone,
  type BlueprintPreview,
  type BoundaryPoint,
  type FlagZone,
  type LaneDescriptor,
  type MapTopologyId,
  type MapBlueprint,
  type MapDesignBrief,
  type MapDiagnostics,
  type MapPowerupPickup,
  type ProtectedZone,
  type RouteGraph,
  type RouteGraphEdge,
  type RouteGraphNode,
  type SpawnCluster,
  type TeamMap,
  type VoxelChunk,
  type VoxelHeightfield,
  type VoxelMapManifest,
  type VoxelMapStats,
  type VoxelMapTheme,
  type VoxelSize,
} from './types.js';

const VOXEL_SIZE: VoxelSize = { x: 0.5, y: 0.5, z: 0.5 };
const WORLD_SIZE = 168;
const WORLD_HEIGHT = 30;
const CHUNK_SIZE: VoxelSize = { x: 16, y: 16, z: 16 };
const BASE_RADIUS = 76;
const SPAWN_CLUSTER_RADIUS = BASE_RADIUS * 0.72;
const SPAWN_CLUSTER_POINT_RADIUS = 2.25;
const SPAWN_FLATTEN_RADIUS = 6.5;
const POWERUP_FLATTEN_RADIUS = 2.4;
const BASE_TERRAIN_ROWS = 9;
const MIN_TERRAIN_ROWS = 5;
const MAX_TERRAIN_ROWS = 20;

interface FlattenZone {
  center: { x: number; z: number };
  radius: number;
  rows: number;
}

interface BattleRoyalLayout {
  seed: number;
  theme: VoxelMapTheme;
  origin: Vec3;
  size: VoxelSize;
  boundary: BoundaryPoint[];
  spawns: TeamMap<SpawnCluster>;
  spawnPoints: Record<string, Vec3[]>;
  flattenZones: FlattenZone[];
  powerups: MapPowerupPickup[];
}

const AIR = getBlockNumericId('air');
const BARRIER = getBlockNumericId('barrier');
const SPAWN_PAD = getBlockNumericId('spawn_pad');
const HEALTH_PAD = getBlockNumericId('health_pad');
const POWERUP_PAD = getBlockNumericId('powerup_pad');
const METAL = getBlockNumericId('metal');
const GLASS = getBlockNumericId('glass');

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function index(x: number, y: number, z: number, size: VoxelSize): number {
  return x + size.x * (z + size.z * y);
}

function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function normalize2D(vector: { x: number; z: number }): { x: number; z: number } {
  const length = Math.hypot(vector.x, vector.z);
  return length <= 0.001 ? { x: 0, z: 1 } : { x: vector.x / length, z: vector.z / length };
}

function createBoundary(seed: number): BoundaryPoint[] {
  const random = mulberry32(seed ^ 0xb417e);
  const points: BoundaryPoint[] = [];
  const pointCount = 28;
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;

  for (let index = 0; index < pointCount; index++) {
    const angle = (index / pointCount) * Math.PI * 2;
    const wave =
      Math.sin(angle * 3 + phaseA) * 0.045 +
      Math.sin(angle * 7 + phaseB) * 0.025 +
      lerp(-0.018, 0.018, random());
    const radius = BASE_RADIUS * clamp(0.94 + wave, 0.88, 1.02);
    points.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    });
  }

  return points;
}

function terrainRows(seed: number, worldX: number, worldZ: number, flattenZones: readonly FlattenZone[]): number {
  const radial = Math.hypot(worldX, worldZ) / BASE_RADIUS;
  const ridgeA = Math.sin(worldX * 0.06 + seed * 0.00001) * 1.2;
  const ridgeB = Math.cos(worldZ * 0.055 - seed * 0.00002) * 1.1;
  const broad = (fractalNoise2(seed ^ 0x514f, worldX * 0.012, worldZ * 0.012, 4) - 0.5) * 8;
  const detail = (fractalNoise2(seed ^ 0x2d7, worldX * 0.035, worldZ * 0.035, 3) - 0.5) * 3;
  let rows = BASE_TERRAIN_ROWS + ridgeA + ridgeB + broad + detail + Math.max(0, 1 - radial) * 3;

  for (const zone of flattenZones) {
    const distance = distance2D({ x: worldX, z: worldZ }, zone.center);
    if (distance >= zone.radius) continue;
    const blend = 1 - clamp(distance / zone.radius, 0, 1);
    rows = lerp(rows, zone.rows, blend * blend);
  }

  return Math.round(clamp(rows, MIN_TERRAIN_ROWS, MAX_TERRAIN_ROWS));
}

function createSpawnClusters(seed: number): {
  spawns: TeamMap<SpawnCluster>;
  spawnPoints: Record<string, Vec3[]>;
  flattenZones: FlattenZone[];
} {
  const random = mulberry32(seed ^ 0x51a7);
  const spawns: TeamMap<SpawnCluster> = {};
  const spawnPoints: Record<string, Vec3[]> = {};
  const flattenZones: FlattenZone[] = [];
  const angleOffset = random() * Math.PI * 2;

  BATTLE_ROYAL_TEAM_IDS.forEach((team, index) => {
    const angle = angleOffset + (index / BATTLE_ROYAL_TEAM_IDS.length) * Math.PI * 2;
    const center = {
      x: Math.cos(angle) * SPAWN_CLUSTER_RADIUS,
      y: 0,
      z: Math.sin(angle) * SPAWN_CLUSTER_RADIUS,
    };
    const facing = normalize2D({ x: -center.x, z: -center.z });
    const tangent = { x: -facing.z, z: facing.x };
    const points = [-1, 0, 1].map((slot): Vec3 => ({
      x: center.x + tangent.x * slot * SPAWN_CLUSTER_POINT_RADIUS,
      y: 0,
      z: center.z + tangent.z * slot * SPAWN_CLUSTER_POINT_RADIUS,
    }));

    flattenZones.push({
      center,
      radius: SPAWN_FLATTEN_RADIUS,
      rows: BASE_TERRAIN_ROWS,
    });

    spawnPoints[team] = points;
    spawns[team] = {
      id: `spawn_${team}`,
      team,
      shape: 'circle',
      center,
      radius: SPAWN_FLATTEN_RADIUS,
      points,
      fallbackPoints: points,
      protectedExitDirections: [{ x: facing.x, y: 0, z: facing.z }],
      facing,
    };
  });

  spawnPoints.red = [];
  spawnPoints.blue = [];
  return { spawns, spawnPoints, flattenZones };
}

function createPowerups(seed: number): { powerups: MapPowerupPickup[]; flattenZones: FlattenZone[] } {
  const random = mulberry32(seed ^ 0x9f2d);
  const powerups: MapPowerupPickup[] = [];
  const flattenZones: FlattenZone[] = [];
  const rings = [
    { radius: 0, count: 1, kind: 'powerup' as const },
    { radius: 28, count: 6, kind: 'powerup' as const },
    { radius: 48, count: 10, kind: 'health_pack' as const },
  ];

  let id = 0;
  for (const ring of rings) {
    const angleOffset = random() * Math.PI * 2;
    for (let index = 0; index < ring.count; index++) {
      const angle = angleOffset + (index / ring.count) * Math.PI * 2;
      const jitter = ring.radius === 0 ? 0 : lerp(-4, 4, random());
      const radius = ring.radius + jitter;
      const position = {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius,
      };
      flattenZones.push({ center: position, radius: POWERUP_FLATTEN_RADIUS, rows: BASE_TERRAIN_ROWS + 1 });
      powerups.push({
        id: `br_pickup_${++id}`,
        kind: ring.kind,
        position,
        radius: POWERUP_PICKUP_RADIUS,
        respawnSeconds: POWERUP_RESPAWN_SECONDS,
        strategicRole: ring.radius === 0 ? 'midfield_contest' : ring.kind === 'powerup' ? 'route_bridge' : 'flank_reward',
      });
    }
  }

  return { powerups, flattenZones };
}

function createBattleRoyalLayout(seed: number, themeId?: VoxelMapTheme['id'] | null): BattleRoyalLayout {
  const theme = getVoxelMapTheme(seed, themeId);
  const size = {
    x: Math.round(WORLD_SIZE / VOXEL_SIZE.x),
    y: Math.round(WORLD_HEIGHT / VOXEL_SIZE.y),
    z: Math.round(WORLD_SIZE / VOXEL_SIZE.z),
  };
  const origin = {
    x: -(size.x * VOXEL_SIZE.x) / 2,
    y: 0,
    z: -(size.z * VOXEL_SIZE.z) / 2,
  };
  const boundary = createBoundary(seed);
  const spawnLayout = createSpawnClusters(seed);
  const pickupLayout = createPowerups(seed);

  return {
    seed,
    theme,
    origin,
    size,
    boundary,
    spawns: spawnLayout.spawns,
    spawnPoints: spawnLayout.spawnPoints,
    flattenZones: [...spawnLayout.flattenZones, ...pickupLayout.flattenZones, { center: { x: 0, z: 0 }, radius: 14, rows: BASE_TERRAIN_ROWS + 2 }],
    powerups: pickupLayout.powerups,
  };
}

function createHeightfield(input: {
  blocks: Uint8Array;
  size: VoxelSize;
  origin: Vec3;
}): VoxelHeightfield {
  const topSolidRows = new Uint16Array(input.size.x * input.size.z);
  for (let z = 0; z < input.size.z; z++) {
    for (let x = 0; x < input.size.x; x++) {
      for (let y = input.size.y - 1; y >= 0; y--) {
        if (input.blocks[index(x, y, z, input.size)] !== AIR) {
          topSolidRows[x + z * input.size.x] = y + 1;
          break;
        }
      }
    }
  }

  return {
    origin: input.origin,
    voxelSize: VOXEL_SIZE,
    size: { x: input.size.x, z: input.size.z },
    topSolidRows,
  };
}

function getThemeTerrainBlocks(theme: VoxelMapTheme): { top: number; side: number; deep: number } {
  const byTheme: Record<VoxelMapTheme['id'], { top: number; side: number; deep: number }> = {
    verdant: { top: getBlockNumericId('grass'), side: getBlockNumericId('dirt'), deep: getBlockNumericId('stone') },
    basalt: { top: getBlockNumericId('ash'), side: getBlockNumericId('stone'), deep: getBlockNumericId('obsidian') },
    desert: { top: getBlockNumericId('sand'), side: getBlockNumericId('sand'), deep: getBlockNumericId('stone') },
    frost: { top: getBlockNumericId('snow'), side: getBlockNumericId('ice'), deep: getBlockNumericId('stone') },
    crystal: { top: getBlockNumericId('moss'), side: getBlockNumericId('stone'), deep: getBlockNumericId('crystal_growth') },
    volcanic: { top: getBlockNumericId('ash'), side: getBlockNumericId('obsidian'), deep: getBlockNumericId('stone') },
    sakura: { top: getBlockNumericId('grass'), side: getBlockNumericId('moss'), deep: getBlockNumericId('stone') },
    golden: { top: getBlockNumericId('gold_panel'), side: getBlockNumericId('gold_ore'), deep: getBlockNumericId('stone') },
  };
  return byTheme[theme.id];
}

function buildBlocks(layout: BattleRoyalLayout): {
  blocks: Uint8Array;
  heightfield: VoxelHeightfield;
  solidBlockCount: number;
} {
  const blocks = new Uint8Array(layout.size.x * layout.size.y * layout.size.z);
  const terrain = getThemeTerrainBlocks(layout.theme);
  const halfSize = WORLD_SIZE / 2;
  let solidBlockCount = 0;

  for (let z = 0; z < layout.size.z; z++) {
    const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
    for (let x = 0; x < layout.size.x; x++) {
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const radial = Math.hypot(worldX, worldZ);
      const insidePlayable = radial <= BASE_RADIUS;
      const boundaryBand = radial > BASE_RADIUS && radial <= halfSize - 1;
      const rows = insidePlayable
        ? terrainRows(layout.seed, worldX, worldZ, layout.flattenZones)
        : boundaryBand
          ? Math.round(23 + (fractalNoise2(layout.seed ^ 0x777, worldX * 0.05, worldZ * 0.05, 2) - 0.5) * 3)
          : 0;

      for (let y = 0; y < rows; y++) {
        const block = boundaryBand
          ? BARRIER
          : y === rows - 1
            ? terrain.top
            : y > rows - 4
              ? terrain.side
              : terrain.deep;
        blocks[index(x, y, z, layout.size)] = block;
        solidBlockCount++;
      }
    }
  }

  stampPads(layout, blocks);
  stampLandmarks(layout, blocks);

  const heightfield = createHeightfield({ blocks, size: layout.size, origin: layout.origin });
  solidBlockCount = blocks.reduce((count, block) => count + (block === AIR ? 0 : 1), 0);
  return { blocks, heightfield, solidBlockCount };
}

function worldToGrid(layout: BattleRoyalLayout, value: Vec3): { x: number; y: number; z: number } {
  return {
    x: Math.floor((value.x - layout.origin.x) / VOXEL_SIZE.x),
    y: Math.floor((value.y - layout.origin.y) / VOXEL_SIZE.y),
    z: Math.floor((value.z - layout.origin.z) / VOXEL_SIZE.z),
  };
}

function stampDisc(layout: BattleRoyalLayout, blocks: Uint8Array, center: Vec3, radius: number, block: number): void {
  const grid = worldToGrid(layout, center);
  const radiusCells = Math.ceil(radius / VOXEL_SIZE.x);
  for (let z = grid.z - radiusCells; z <= grid.z + radiusCells; z++) {
    if (z < 0 || z >= layout.size.z) continue;
    for (let x = grid.x - radiusCells; x <= grid.x + radiusCells; x++) {
      if (x < 0 || x >= layout.size.x) continue;
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
      if (Math.hypot(worldX - center.x, worldZ - center.z) > radius) continue;
      for (let y = layout.size.y - 1; y >= 0; y--) {
        const blockIndex = index(x, y, z, layout.size);
        if (blocks[blockIndex] === AIR) continue;
        blocks[blockIndex] = block;
        break;
      }
    }
  }
}

function stampPads(layout: BattleRoyalLayout, blocks: Uint8Array): void {
  for (const points of Object.values(layout.spawnPoints)) {
    for (const point of points) {
      stampDisc(layout, blocks, point, 1.35, SPAWN_PAD);
    }
  }

  for (const pickup of layout.powerups) {
    stampDisc(layout, blocks, pickup.position, 1.35, pickup.kind === 'health_pack' ? HEALTH_PAD : POWERUP_PAD);
  }
}

function setBlock(layout: BattleRoyalLayout, blocks: Uint8Array, x: number, y: number, z: number, block: number): void {
  if (x < 0 || y < 0 || z < 0 || x >= layout.size.x || y >= layout.size.y || z >= layout.size.z) return;
  blocks[index(x, y, z, layout.size)] = block;
}

function stampLandmarks(layout: BattleRoyalLayout, blocks: Uint8Array): void {
  const centers = [
    { x: 0, z: 0, radius: 5, height: 18 },
    { x: 22, z: -18, radius: 3, height: 12 },
    { x: -28, z: 16, radius: 3, height: 11 },
    { x: 8, z: 34, radius: 2, height: 10 },
  ];

  for (const landmark of centers) {
    const grid = worldToGrid(layout, { x: landmark.x, y: 0, z: landmark.z });
    for (let z = grid.z - landmark.radius; z <= grid.z + landmark.radius; z++) {
      for (let x = grid.x - landmark.radius; x <= grid.x + landmark.radius; x++) {
        const distance = Math.hypot(x - grid.x, z - grid.z);
        if (distance > landmark.radius) continue;
        for (let y = BASE_TERRAIN_ROWS; y < BASE_TERRAIN_ROWS + landmark.height - distance * 1.2; y++) {
          setBlock(layout, blocks, x, Math.floor(y), z, distance > landmark.radius - 0.8 ? GLASS : METAL);
        }
      }
    }
  }
}

function createChunks(layout: BattleRoyalLayout, blocks: Uint8Array): VoxelChunk[] {
  const chunks: VoxelChunk[] = [];
  const chunksX = Math.ceil(layout.size.x / CHUNK_SIZE.x);
  const chunksY = Math.ceil(layout.size.y / CHUNK_SIZE.y);
  const chunksZ = Math.ceil(layout.size.z / CHUNK_SIZE.z);

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const chunkSize = {
          x: Math.min(CHUNK_SIZE.x, layout.size.x - cx * CHUNK_SIZE.x),
          y: Math.min(CHUNK_SIZE.y, layout.size.y - cy * CHUNK_SIZE.y),
          z: Math.min(CHUNK_SIZE.z, layout.size.z - cz * CHUNK_SIZE.z),
        };
        const chunkBlocks = new Uint8Array(chunkSize.x * chunkSize.y * chunkSize.z);
        let solidBlockCount = 0;
        for (let y = 0; y < chunkSize.y; y++) {
          for (let z = 0; z < chunkSize.z; z++) {
            for (let x = 0; x < chunkSize.x; x++) {
              const globalX = cx * CHUNK_SIZE.x + x;
              const globalY = cy * CHUNK_SIZE.y + y;
              const globalZ = cz * CHUNK_SIZE.z + z;
              const block = blocks[index(globalX, globalY, globalZ, layout.size)];
              chunkBlocks[index(x, y, z, chunkSize)] = block;
              if (block !== AIR) solidBlockCount++;
            }
          }
        }
        if (solidBlockCount === 0) continue;
        chunks.push({
          coord: { x: cx, y: cy, z: cz },
          size: chunkSize,
          blocks: chunkBlocks,
          solidBlockCount,
        });
      }
    }
  }

  return chunks;
}

function createRouteGraph(layout: BattleRoyalLayout): RouteGraph {
  const nodes: RouteGraphNode[] = [{
    id: 'center',
    kind: 'landmark',
    position: { x: 0, y: BASE_TERRAIN_ROWS * VOXEL_SIZE.y, z: 0 },
    laneIds: ['radial_routes'],
    tags: ['high_value'],
  }];
  const edges: RouteGraphEdge[] = [];
  const primaryRouteNodeIds: TeamMap<string[]> = {};
  const fallbackAnchorNodeIds: TeamMap<string[]> = {};

  for (const [team, spawn] of Object.entries(layout.spawns)) {
    const nodeId = `${team}_spawn`;
    nodes.push({
      id: nodeId,
      kind: 'spawn',
      position: spawn.center,
      team,
      laneIds: ['radial_routes'],
      tags: ['outer_spawn'],
    });
    edges.push({
      id: `${nodeId}_to_center`,
      from: nodeId,
      to: 'center',
      laneId: 'radial_routes',
      distance: distance2D(spawn.center, { x: 0, z: 0 }),
      expectedTravelTimeSeconds: distance2D(spawn.center, { x: 0, z: 0 }) / 7.6,
      width: 9,
      traversal: 'ground',
      tags: ['primary_route'],
    });
    primaryRouteNodeIds[team] = [nodeId, 'center'];
    fallbackAnchorNodeIds[team] = [nodeId];
  }

  return { nodes, edges, primaryRouteNodeIds, fallbackAnchorNodeIds };
}

function createDiagnostics(input: {
  layout: BattleRoyalLayout;
  stats: VoxelMapStats;
  generationMs: number;
}): MapDiagnostics {
  const spawnCenters = Object.values(input.layout.spawns).map((spawn) => spawn.center);
  let minSpawnSeparation = Infinity;
  for (let a = 0; a < spawnCenters.length; a++) {
    for (let b = a + 1; b < spawnCenters.length; b++) {
      minSpawnSeparation = Math.min(minSpawnSeparation, distance2D(spawnCenters[a], spawnCenters[b]));
    }
  }

  return {
    familyId: 'battle_royal_large',
    topologyId: 'ring',
    themeId: input.layout.theme.id,
    candidateCount: 1,
    selectedCandidateId: `battle_royal_large_${input.layout.seed.toString(16)}`,
    rejectedCandidates: [],
    score: 86,
    scoreBreakdown: {
      spawnSeparation: clamp(minSpawnSeparation / 22, 0, 1) * 25,
      routeConnectivity: 25,
      centralPressure: 20,
      budget: input.stats.solidBlocks < 2_400_000 ? 16 : 8,
    },
    stageTimingsMs: { total: input.generationMs },
    laneLengths: { radial_routes: SPAWN_CLUSTER_RADIUS },
    laneWidths: { radial_routes: 9 },
    routeChoiceCount: BATTLE_ROYAL_TEAM_IDS.length,
    coverDensityByLane: { radial_routes: 0.34 },
    maxSightlineLength: 42,
    spawnVisibilityPairs: 0,
    flagApproachClearances: {},
    colliderCount: input.stats.colliderCount,
    chunkCount: input.stats.chunkCount,
    solidBlockCount: input.stats.solidBlocks,
    moduleCountsByRole: {
      central_landmark: 1,
      medium_landmark: 3,
      spawn_cluster: BATTLE_ROYAL_TEAM_IDS.length,
    },
    repairActions: {},
    warnings: minSpawnSeparation < 20 ? ['spawn separation below target'] : [],
  };
}

function createPreview(layout: BattleRoyalLayout): MapBlueprint['preview'] {
  const routes = BATTLE_ROYAL_TEAM_IDS.map((team) => ({
    id: `${team}_route`,
    kind: 'primary' as const,
    points: [layout.spawns[team].center, { x: 0, y: 0, z: 0 }],
    width: 9,
  }));
  const spawns: TeamMap<Vec3> = {};
  for (const [team, spawn] of Object.entries(layout.spawns)) {
    spawns[team] = spawn.center;
  }

  return {
    camera: {
      position: { x: 0, y: 105, z: 105 },
      target: { x: 0, y: 0, z: 0 },
      fov: 48,
      near: 0.5,
      far: 260,
    },
    thumbnailSilhouette: {
      bounds: { minX: -BASE_RADIUS, maxX: BASE_RADIUS, minZ: -BASE_RADIUS, maxZ: BASE_RADIUS },
      boundary: layout.boundary,
      routes,
      landmarks: [
        { id: 'center', role: 'flank_landmark', position: { x: 0, y: 0, z: 0 }, radius: 10 },
      ],
      objectives: {
        flags: {},
        spawns,
      },
    },
    labelTags: ['Battle Royal', '30 Players', 'Large'],
  };
}

export interface BattleRoyalMapPreview {
  seed: number;
  mapSize: 'large';
  familyId: 'battle_royal_large';
  topologyId: MapTopologyId;
  themeId: VoxelMapTheme['id'];
  themeName: string;
  name: string;
  preview: BlueprintPreview;
  diagnostics: Pick<MapDiagnostics, 'score' | 'scoreBreakdown' | 'laneLengths' | 'routeChoiceCount' | 'warnings'>;
}

export function createBattleRoyalMapPreview(
  seed = 0,
  options: { themeId?: VoxelMapTheme['id'] | null } = {}
): BattleRoyalMapPreview {
  const normalizedSeed = seed >>> 0;
  const layout = createBattleRoyalLayout(normalizedSeed, options.themeId);
  const preview = createPreview(layout);
  const spawnCount = Object.keys(layout.spawns).length;

  return {
    seed: normalizedSeed,
    mapSize: 'large',
    familyId: 'battle_royal_large',
    topologyId: 'ring',
    themeId: layout.theme.id,
    themeName: layout.theme.name,
    name: `${layout.theme.name} Last Ring`,
    preview,
    diagnostics: {
      score: 86,
      scoreBreakdown: {
        spawnSeparation: 25,
        routeConnectivity: 25,
        centralPressure: 20,
        budget: 16,
      },
      laneLengths: { radial_routes: SPAWN_CLUSTER_RADIUS },
      routeChoiceCount: spawnCount,
      warnings: [],
    },
  };
}

export function generateBattleRoyalVoxelMap(
  seed = 0,
  options: { themeId?: VoxelMapTheme['id'] | null } = {}
): VoxelMapManifest {
  const startedAt = Date.now();
  const normalizedSeed = seed >>> 0;
  const layout = createBattleRoyalLayout(normalizedSeed, options.themeId);
  const blockResult = buildBlocks(layout);
  const chunks = createChunks(layout, blockResult.blocks);
  const colliders = generateVoxelColliders({
    origin: layout.origin,
    voxelSize: VOXEL_SIZE,
    size: layout.size,
    chunkSize: CHUNK_SIZE,
    chunks,
  });
  const stats: VoxelMapStats = {
    chunkCount: chunks.length,
    totalChunkSlots: Math.ceil(layout.size.x / CHUNK_SIZE.x) * Math.ceil(layout.size.y / CHUNK_SIZE.y) * Math.ceil(layout.size.z / CHUNK_SIZE.z),
    emptyChunkSlots: 0,
    renderableChunkCount: chunks.length,
    solidBlocks: blockResult.solidBlockCount,
    colliderCount: colliders.length,
  };
  stats.emptyChunkSlots = Math.max(0, stats.totalChunkSlots - stats.chunkCount);
  const generationMs = Date.now() - startedAt;
  const diagnostics = createDiagnostics({ layout, stats, generationMs });
  const routeGraph = createRouteGraph(layout);
  const preview = createPreview(layout);
  const designBrief: MapDesignBrief = {
    seed: normalizedSeed,
    mapSize: 'large',
    gameMode: 'battle_royal',
    profileId: 'battle_royal_large',
    teamSize: 3,
    familyId: 'battle_royal_large',
    themeId: layout.theme.id,
    targetMatchLengthSeconds: 1200,
    desiredTopology: 'ring',
    desiredSymmetry: 'asymmetric_balanced',
    performanceBudget: {
      maxSolidBlocks: 2_600_000,
      maxColliders: 140_000,
      maxRenderableChunks: 3600,
      maxGenerationMs: 3500,
    },
    rngStreams: {
      boundary: hashSeed(normalizedSeed ^ 0xb417e),
      spawns: hashSeed(normalizedSeed ^ 0x51a7),
      pickups: hashSeed(normalizedSeed ^ 0x9f2d),
      terrain: hashSeed(normalizedSeed ^ 0x514f),
    },
  };
  const protectedZones: ProtectedZone[] = Object.values(layout.spawns).map((spawn) => ({
    ...spawn,
    kind: 'spawn',
    clearanceRadius: SPAWN_FLATTEN_RADIUS,
    blocksDressing: true,
    blocksModules: true,
  }));
  const lanes: LaneDescriptor[] = [{
    id: 'radial_routes',
    label: 'Radial Routes',
    kind: 'primary',
    nodeIds: routeGraph.nodes.map((node) => node.id),
    width: 9,
    expectedDistance: SPAWN_CLUSTER_RADIUS,
    expectedTravelTimeSeconds: SPAWN_CLUSTER_RADIUS / 7.6,
    coverDensityTarget: 0.34,
    verticalityBand: { minY: 2, maxY: 14 },
  }];
  const bases: TeamMap<BaseZone> = {};
  const flags: TeamMap<FlagZone> = {};
  for (const [team, spawn] of Object.entries(layout.spawns)) {
    bases[team] = {
      ...spawn,
      exits: spawn.points,
      defensivePositions: spawn.points,
    };
  }

  const manifest: VoxelMapManifest = {
    id: `battle_royal_large_${normalizedSeed.toString(16).padStart(8, '0')}`,
    version: CONSTRUCTED_MAP_MANIFEST_VERSION,
    seed: normalizedSeed,
    mapSize: 'large',
    profileId: 'battle_royal_large',
    familyId: 'battle_royal_large',
    topologyId: 'ring',
    themeId: layout.theme.id,
    theme: layout.theme,
    origin: layout.origin,
    voxelSize: VOXEL_SIZE,
    size: layout.size,
    chunkSize: CHUNK_SIZE,
    spawnPoints: layout.spawnPoints,
    flagZones: { red: { x: 0, y: 0, z: 0 }, blue: { x: 0, y: 0, z: 0 } },
    boundary: layout.boundary,
    heightfield: blockResult.heightfield,
    chunks,
    colliders,
    stats,
    gameplay: {
      mode: 'battle_royal',
      boundary: layout.boundary,
      bases,
      flags,
      spawns: layout.spawns,
      protectedZones,
      lanes,
      routeGraph,
      powerups: layout.powerups,
      sightlineSamples: [],
    },
    construction: {
      designBrief,
      blueprintId: `battle_royal_large_${normalizedSeed.toString(16)}`,
      topologyId: 'ring',
      tacticalSlots: [],
      moduleDefinitions: [],
      moduleInstances: [],
      terrainConstraints: [],
      diagnostics,
    },
    world: {
      origin: layout.origin,
      voxelSize: VOXEL_SIZE,
      size: layout.size,
      heightfield: blockResult.heightfield,
      chunks,
      colliders,
      stats,
    },
    preview,
  };

  return manifest;
}
