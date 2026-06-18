import {
  POWERUP_PICKUP_RADIUS,
  POWERUP_RESPAWN_SECONDS,
} from '../../constants/game.js';
import { PLAYER_HEIGHT } from '../../constants/physics.js';
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
  type MapDiagnostics,
  type MapDesignBrief,
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
const WORLD_SIZE = 176;
const WORLD_HEIGHT = 44;
const CHUNK_SIZE: VoxelSize = { x: 16, y: 16, z: 16 };
const BASE_RADIUS = 80;
const SPAWN_CLUSTER_RADIUS = BASE_RADIUS * 0.78;
const SPAWN_CLUSTER_POINT_RADIUS = 2.45;
const SPAWN_FLATTEN_RADIUS = 8.5;
const POWERUP_FLATTEN_RADIUS = 2.8;
const POI_FLATTEN_RADIUS = 7.5;
const BASE_TERRAIN_ROWS = 12;
const MIN_TERRAIN_ROWS = 6;
const MAX_TERRAIN_ROWS = 34;

type PoiRole = 'citadel' | 'watchtower' | 'bunker' | 'depot';
type CoverMaterial = 'terrain' | 'metal' | 'glass';

interface FlattenZone {
  center: { x: number; z: number };
  radius: number;
  rows: number;
  strength?: number;
}

interface BattleRoyalPoi {
  id: string;
  role: PoiRole;
  position: Vec3;
  radius: number;
  heightRows: number;
  flattenRows: number;
}

interface CoverPiece {
  id: string;
  position: { x: number; z: number };
  halfExtents: { x: number; z: number };
  heightRows: number;
  material: CoverMaterial;
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
  pois: BattleRoyalPoi[];
  coverPieces: CoverPiece[];
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

function smoothstep(value: number): number {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
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
  const pointCount = 36;
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;

  for (let index = 0; index < pointCount; index++) {
    const angle = (index / pointCount) * Math.PI * 2;
    const wave =
      Math.sin(angle * 3 + phaseA) * 0.035 +
      Math.sin(angle * 8 + phaseB) * 0.022 +
      lerp(-0.014, 0.014, random());
    const radius = BASE_RADIUS * clamp(0.95 + wave, 0.9, 1.03);
    points.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    });
  }

  return points;
}

function terrainRows(seed: number, worldX: number, worldZ: number, flattenZones: readonly FlattenZone[]): number {
  const radial = Math.hypot(worldX, worldZ) / BASE_RADIUS;
  const angle = Math.atan2(worldZ, worldX);
  const phaseA = (seed & 0xffff) * 0.00012;
  const phaseB = ((seed >>> 8) & 0xffff) * 0.00015;
  const highlands = Math.max(0, 1 - radial) * 5.6;
  const outerDrop = radial > 0.82 ? -(radial - 0.82) * 14 : 0;
  const terraces = Math.sin(radial * Math.PI * 7.5 + phaseA) * 2.5;
  const spokeRidges = Math.max(0, Math.sin(angle * 7 + phaseB)) * (3.8 - radial * 1.6);
  const broad = (fractalNoise2(seed ^ 0x514f, worldX * 0.01, worldZ * 0.01, 5) - 0.5) * 17;
  const medium = (fractalNoise2(seed ^ 0x2d7, worldX * 0.028, worldZ * 0.028, 4) - 0.5) * 7;
  const detail = (fractalNoise2(seed ^ 0xf00d, worldX * 0.072, worldZ * 0.072, 2) - 0.5) * 2.6;
  let rows = BASE_TERRAIN_ROWS + highlands + terraces + spokeRidges + broad + medium + detail + outerDrop;

  for (const zone of flattenZones) {
    const distance = distance2D({ x: worldX, z: worldZ }, zone.center);
    if (distance >= zone.radius) continue;
    const blend = smoothstep(1 - distance / zone.radius) * (zone.strength ?? 0.86);
    rows = lerp(rows, zone.rows, blend);
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
    const radiusJitter = lerp(-3.5, 2.5, random());
    const center = {
      x: Math.cos(angle) * (SPAWN_CLUSTER_RADIUS + radiusJitter),
      y: 0,
      z: Math.sin(angle) * (SPAWN_CLUSTER_RADIUS + radiusJitter),
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
      rows: BASE_TERRAIN_ROWS + 1,
      strength: 0.98,
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

function getSpawnProtectedPositions(spawns: TeamMap<SpawnCluster>): Array<{ x: number; z: number }> {
  return Object.values(spawns).flatMap((spawn) => [spawn.center, ...spawn.points]);
}

function isClearOfPositions(
  position: { x: number; z: number },
  protectedPositions: readonly { x: number; z: number }[],
  clearance: number
): boolean {
  return protectedPositions.every((protectedPosition) => distance2D(position, protectedPosition) >= clearance);
}

function createPois(seed: number, spawns: TeamMap<SpawnCluster>): { pois: BattleRoyalPoi[]; flattenZones: FlattenZone[] } {
  const random = mulberry32(seed ^ 0xc17ade1);
  const protectedSpawnPositions = getSpawnProtectedPositions(spawns);
  const pois: BattleRoyalPoi[] = [{
    id: 'center_citadel',
    role: 'citadel',
    position: { x: 0, y: 0, z: 0 },
    radius: 12,
    heightRows: 24,
    flattenRows: BASE_TERRAIN_ROWS + 6,
  }];
  const flattenZones: FlattenZone[] = [{
    center: { x: 0, z: 0 },
    radius: 17,
    rows: BASE_TERRAIN_ROWS + 5,
    strength: 0.95,
  }];

  const majorOffset = random() * Math.PI * 2;
  for (let index = 0; index < 6; index++) {
    const role: PoiRole = index % 2 === 0 ? 'watchtower' : 'bunker';
    let poi: BattleRoyalPoi | null = null;
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = majorOffset + (index / 6) * Math.PI * 2 + lerp(-0.16, 0.16, random()) + attempt * 0.17;
      const radius = lerp(28, 44, random());
      const candidate: BattleRoyalPoi = {
        id: `${role}_${index + 1}`,
        role,
        position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius },
        radius: role === 'watchtower' ? 6.5 : 8.5,
        heightRows: role === 'watchtower' ? 17 : 9,
        flattenRows: BASE_TERRAIN_ROWS + 2 + (index % 3),
      };
      if (isClearOfPositions(candidate.position, protectedSpawnPositions, candidate.radius + SPAWN_FLATTEN_RADIUS + 3)) {
        poi = candidate;
        break;
      }
    }
    if (poi === null) continue;
    pois.push(poi);
    flattenZones.push({
      center: poi.position,
      radius: poi.radius + POI_FLATTEN_RADIUS,
      rows: poi.flattenRows,
      strength: 0.88,
    });
  }

  const outerOffset = random() * Math.PI * 2;
  for (let index = 0; index < 8; index++) {
    let poi: BattleRoyalPoi | null = null;
    for (let attempt = 0; attempt < 64; attempt++) {
      const angle = outerOffset + (index / 8) * Math.PI * 2 + lerp(-0.22, 0.22, random()) + attempt * 0.19;
      const radius = lerp(36, 60, random());
      const candidate: BattleRoyalPoi = {
        id: `depot_${index + 1}`,
        role: 'depot',
        position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius },
        radius: 6,
        heightRows: 6,
        flattenRows: BASE_TERRAIN_ROWS + 1,
      };
      if (isClearOfPositions(candidate.position, protectedSpawnPositions, candidate.radius + SPAWN_FLATTEN_RADIUS + 3)) {
        poi = candidate;
        break;
      }
    }
    if (poi === null) continue;
    pois.push(poi);
    flattenZones.push({
      center: poi.position,
      radius: poi.radius + 5,
      rows: poi.flattenRows,
      strength: 0.82,
    });
  }

  return { pois, flattenZones };
}

function createPowerups(seed: number): { powerups: MapPowerupPickup[]; flattenZones: FlattenZone[] } {
  const random = mulberry32(seed ^ 0x9f2d);
  const powerups: MapPowerupPickup[] = [];
  const flattenZones: FlattenZone[] = [];
  const rings = [
    { radius: 0, count: 1, kind: 'powerup' as const },
    { radius: 20, count: 6, kind: 'powerup' as const },
    { radius: 36, count: 10, kind: 'powerup' as const },
    { radius: 50, count: 10, kind: 'health_pack' as const },
    { radius: 66, count: 12, kind: 'health_pack' as const },
  ];

  let id = 0;
  for (const ring of rings) {
    const angleOffset = random() * Math.PI * 2;
    for (let index = 0; index < ring.count; index++) {
      const angle = angleOffset + (index / ring.count) * Math.PI * 2 + lerp(-0.08, 0.08, random());
      const jitter = ring.radius === 0 ? 0 : lerp(-4.5, 4.5, random());
      const radius = ring.radius + jitter;
      const position = {
        x: Math.cos(angle) * radius,
        y: 0,
        z: Math.sin(angle) * radius,
      };
      flattenZones.push({
        center: position,
        radius: POWERUP_FLATTEN_RADIUS,
        rows: BASE_TERRAIN_ROWS + (ring.radius < 25 ? 3 : 1),
        strength: 0.7,
      });
      powerups.push({
        id: `br_pickup_${++id}`,
        kind: ring.kind,
        position,
        radius: POWERUP_PICKUP_RADIUS,
        respawnSeconds: POWERUP_RESPAWN_SECONDS,
        strategicRole: ring.radius === 0
          ? 'midfield_contest'
          : ring.kind === 'powerup'
            ? 'route_bridge'
            : 'flank_reward',
      });
    }
  }

  return { powerups, flattenZones };
}

function createCoverPieces(seed: number, spawns: TeamMap<SpawnCluster>): CoverPiece[] {
  const random = mulberry32(seed ^ 0xc0a7e);
  const pieces: CoverPiece[] = [];
  const protectedSpawnPositions = getSpawnProtectedPositions(spawns);
  const rings = [
    { radius: 24, count: 10 },
    { radius: 38, count: 14 },
    { radius: 54, count: 18 },
    { radius: 67, count: 16 },
  ];

  let id = 0;
  for (const ring of rings) {
    const angleOffset = random() * Math.PI * 2;
    for (let index = 0; index < ring.count; index++) {
      const angle = angleOffset + (index / ring.count) * Math.PI * 2 + lerp(-0.11, 0.11, random());
      const radius = ring.radius + lerp(-3.2, 3.2, random());
      const position = { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
      if (!isClearOfPositions(position, protectedSpawnPositions, 7.5)) {
        continue;
      }
      pieces.push({
        id: `route_cover_${++id}`,
        position,
        halfExtents: { x: lerp(1.2, 2.9, random()), z: lerp(0.55, 1.25, random()) },
        heightRows: Math.floor(lerp(2, 5, random())),
        material: random() > 0.64 ? 'metal' : 'terrain',
      });
    }
  }

  for (const [team, spawn] of Object.entries(spawns)) {
    const facing = spawn.facing;
    const tangent = { x: -facing.z, z: facing.x };
    for (const side of [-1, 1]) {
      pieces.push({
        id: `${team}_spawn_shelter_${side}`,
        position: {
          x: spawn.center.x + facing.x * 5.4 + tangent.x * side * 5.6,
          z: spawn.center.z + facing.z * 5.4 + tangent.z * side * 5.6,
        },
        halfExtents: { x: 2.3, z: 0.8 },
        heightRows: 4,
        material: 'metal',
      });
    }
  }

  return pieces;
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
  const poiLayout = createPois(seed, spawnLayout.spawns);
  const pickupLayout = createPowerups(seed);
  const flattenZones = [
    ...spawnLayout.flattenZones,
    ...poiLayout.flattenZones,
    ...pickupLayout.flattenZones,
  ];
  const layout: BattleRoyalLayout = {
    seed,
    theme,
    origin,
    size,
    boundary,
    spawns: spawnLayout.spawns,
    spawnPoints: spawnLayout.spawnPoints,
    flattenZones,
    powerups: pickupLayout.powerups,
    pois: poiLayout.pois,
    coverPieces: createCoverPieces(seed, spawnLayout.spawns),
  };

  return resolveSurfacePlacements(layout);
}

function gridRowsToWorldY(row: number, originY: number, voxelY: number): number {
  return originY + row * voxelY;
}

function getSurfaceRow(layout: BattleRoyalLayout, point: { x: number; z: number }): number {
  return terrainRows(layout.seed, point.x, point.z, layout.flattenZones);
}

function getSurfacePosition(layout: BattleRoyalLayout, point: Vec3, yOffset = 0.25): Vec3 {
  const row = getSurfaceRow(layout, point);
  return {
    x: point.x,
    y: gridRowsToWorldY(row + 1, layout.origin.y, VOXEL_SIZE.y) + yOffset,
    z: point.z,
  };
}

function resolveSurfacePlacements(layout: BattleRoyalLayout): BattleRoyalLayout {
  const spawnOffset = PLAYER_HEIGHT / 2 + 0.05;
  const spawnPoints: Record<string, Vec3[]> = {};
  for (const [team, points] of Object.entries(layout.spawnPoints)) {
    spawnPoints[team] = points.map((point) => getSurfacePosition(layout, point, spawnOffset));
  }

  const spawns: TeamMap<SpawnCluster> = {};
  for (const [team, spawn] of Object.entries(layout.spawns)) {
    const points = spawn.points.map((point) => getSurfacePosition(layout, point, spawnOffset));
    const center = getSurfacePosition(layout, spawn.center, spawnOffset);
    spawns[team] = {
      ...spawn,
      center,
      points,
      fallbackPoints: points,
    };
  }

  return {
    ...layout,
    spawnPoints,
    spawns,
    pois: layout.pois.map((poi) => ({
      ...poi,
      position: getSurfacePosition(layout, poi.position, 0.25),
    })),
    powerups: layout.powerups.map((pickup) => ({
      ...pickup,
      position: getSurfacePosition(layout, pickup.position, 0.25),
    })),
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
          ? Math.round(32 + (fractalNoise2(layout.seed ^ 0x777, worldX * 0.045, worldZ * 0.045, 2) - 0.5) * 5)
          : 0;

      for (let y = 0; y < rows; y++) {
        const block = boundaryBand
          ? BARRIER
          : y === rows - 1
            ? terrain.top
            : y > rows - 5
              ? terrain.side
              : terrain.deep;
        blocks[index(x, y, z, layout.size)] = block;
        solidBlockCount++;
      }
    }
  }

  stampPads(layout, blocks);
  stampBattleRoyalContent(layout, blocks, terrain);

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

function setBlock(layout: BattleRoyalLayout, blocks: Uint8Array, x: number, y: number, z: number, block: number): void {
  if (x < 0 || y < 0 || z < 0 || x >= layout.size.x || y >= layout.size.y || z >= layout.size.z) return;
  blocks[index(x, y, z, layout.size)] = block;
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
      stampDisc(layout, blocks, point, 1.45, SPAWN_PAD);
    }
  }

  for (const pickup of layout.powerups) {
    stampDisc(layout, blocks, pickup.position, 1.35, pickup.kind === 'health_pack' ? HEALTH_PAD : POWERUP_PAD);
  }
}

function stampColumn(layout: BattleRoyalLayout, blocks: Uint8Array, x: number, z: number, heightRows: number, block: number): void {
  const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
  const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
  const startY = getSurfaceRow(layout, { x: worldX, z: worldZ });
  const endY = Math.min(layout.size.y - 1, startY + heightRows);
  for (let y = startY; y <= endY; y++) {
    setBlock(layout, blocks, x, y, z, block);
  }
}

function stampRectPrism(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  center: { x: number; z: number },
  halfExtents: { x: number; z: number },
  heightRows: number,
  block: number,
  perimeterOnly = false
): void {
  const minX = Math.floor((center.x - halfExtents.x - layout.origin.x) / VOXEL_SIZE.x);
  const maxX = Math.ceil((center.x + halfExtents.x - layout.origin.x) / VOXEL_SIZE.x);
  const minZ = Math.floor((center.z - halfExtents.z - layout.origin.z) / VOXEL_SIZE.z);
  const maxZ = Math.ceil((center.z + halfExtents.z - layout.origin.z) / VOXEL_SIZE.z);

  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const edge = x === minX || x === maxX || z === minZ || z === maxZ;
      if (perimeterOnly && !edge) continue;
      stampColumn(layout, blocks, x, z, heightRows, block);
    }
  }
}

function stampCylinder(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  center: { x: number; z: number },
  radius: number,
  heightRows: number,
  fillBlock: number,
  shellBlock: number = fillBlock
): void {
  const grid = worldToGrid(layout, { x: center.x, y: 0, z: center.z });
  const radiusCells = Math.ceil(radius / VOXEL_SIZE.x);
  for (let z = grid.z - radiusCells; z <= grid.z + radiusCells; z++) {
    for (let x = grid.x - radiusCells; x <= grid.x + radiusCells; x++) {
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
      const distance = Math.hypot(worldX - center.x, worldZ - center.z);
      if (distance > radius) continue;
      const block = distance > radius - 1 ? shellBlock : fillBlock;
      stampColumn(layout, blocks, x, z, heightRows, block);
    }
  }
}

function stampPoi(layout: BattleRoyalLayout, blocks: Uint8Array, poi: BattleRoyalPoi): void {
  switch (poi.role) {
    case 'citadel':
      stampCylinder(layout, blocks, poi.position, poi.radius, 3, METAL, GLASS);
      stampCylinder(layout, blocks, poi.position, 4.2, poi.heightRows, METAL, GLASS);
      stampRectPrism(layout, blocks, { x: poi.position.x, z: poi.position.z }, { x: 13, z: 1.2 }, 4, METAL);
      stampRectPrism(layout, blocks, { x: poi.position.x, z: poi.position.z }, { x: 1.2, z: 13 }, 4, METAL);
      break;
    case 'watchtower':
      stampCylinder(layout, blocks, poi.position, 3.2, poi.heightRows, METAL, GLASS);
      stampRectPrism(layout, blocks, poi.position, { x: 5.5, z: 5.5 }, 2, GLASS, true);
      break;
    case 'bunker':
      stampRectPrism(layout, blocks, poi.position, { x: poi.radius, z: poi.radius * 0.72 }, poi.heightRows, METAL, true);
      stampRectPrism(layout, blocks, { x: poi.position.x, z: poi.position.z }, { x: poi.radius * 0.52, z: poi.radius * 0.4 }, 3, GLASS);
      break;
    case 'depot':
      stampRectPrism(layout, blocks, poi.position, { x: poi.radius, z: poi.radius * 0.58 }, poi.heightRows, METAL, true);
      stampRectPrism(layout, blocks, { x: poi.position.x + 2, z: poi.position.z - 2 }, { x: 2.6, z: 2.6 }, 4, GLASS);
      break;
  }
}

function stampBattleRoyalContent(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  terrain: { top: number; side: number; deep: number }
): void {
  for (const poi of layout.pois) {
    stampPoi(layout, blocks, poi);
  }

  for (const cover of layout.coverPieces) {
    const block = cover.material === 'metal'
      ? METAL
      : cover.material === 'glass'
        ? GLASS
        : terrain.side;
    stampRectPrism(layout, blocks, cover.position, cover.halfExtents, cover.heightRows, block);
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

function findNearestPoi(layout: BattleRoyalLayout, position: { x: number; z: number }): BattleRoyalPoi {
  let nearest = layout.pois[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const poi of layout.pois) {
    if (poi.role === 'citadel') continue;
    const distance = distance2D(position, poi.position);
    if (distance < nearestDistance) {
      nearest = poi;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function createRouteGraph(layout: BattleRoyalLayout): RouteGraph {
  const centerPoi = layout.pois.find((poi) => poi.role === 'citadel') ?? layout.pois[0];
  const nodes: RouteGraphNode[] = [{
    id: 'center',
    kind: 'landmark',
    position: centerPoi.position,
    laneIds: ['radial_routes', 'poi_ring'],
    tags: ['high_value', 'vertical'],
  }];
  const edges: RouteGraphEdge[] = [];
  const primaryRouteNodeIds: TeamMap<string[]> = {};
  const fallbackAnchorNodeIds: TeamMap<string[]> = {};
  const ringPois = layout.pois.filter((poi) => poi.role !== 'citadel');

  for (const poi of ringPois) {
    nodes.push({
      id: poi.id,
      kind: 'landmark',
      position: poi.position,
      laneIds: ['radial_routes', 'poi_ring'],
      tags: [poi.role],
    });
    edges.push({
      id: `${poi.id}_to_center`,
      from: poi.id,
      to: 'center',
      laneId: 'radial_routes',
      distance: distance2D(poi.position, centerPoi.position),
      expectedTravelTimeSeconds: distance2D(poi.position, centerPoi.position) / 7.6,
      width: poi.role === 'depot' ? 7 : 10,
      traversal: 'ground',
      tags: ['poi_route'],
    });
  }

  const orderedRingPois = [...ringPois].sort((a, b) => Math.atan2(a.position.z, a.position.x) - Math.atan2(b.position.z, b.position.x));
  for (let index = 0; index < orderedRingPois.length; index++) {
    const current = orderedRingPois[index];
    const next = orderedRingPois[(index + 1) % orderedRingPois.length];
    edges.push({
      id: `${current.id}_to_${next.id}`,
      from: current.id,
      to: next.id,
      laneId: 'poi_ring',
      distance: distance2D(current.position, next.position),
      expectedTravelTimeSeconds: distance2D(current.position, next.position) / 7.2,
      width: 8,
      traversal: 'ground',
      tags: ['rotation_route'],
    });
  }

  for (const [team, spawn] of Object.entries(layout.spawns)) {
    const nodeId = `${team}_spawn`;
    const nearestPoi = findNearestPoi(layout, spawn.center);
    nodes.push({
      id: nodeId,
      kind: 'spawn',
      position: spawn.center,
      team,
      laneIds: ['outer_routes', 'radial_routes'],
      tags: ['outer_spawn'],
    });
    edges.push({
      id: `${nodeId}_to_${nearestPoi.id}`,
      from: nodeId,
      to: nearestPoi.id,
      laneId: 'outer_routes',
      distance: distance2D(spawn.center, nearestPoi.position),
      expectedTravelTimeSeconds: distance2D(spawn.center, nearestPoi.position) / 7.4,
      width: 9,
      traversal: 'ground',
      tags: ['spawn_route'],
    });
    primaryRouteNodeIds[team] = [nodeId, nearestPoi.id, 'center'];
    fallbackAnchorNodeIds[team] = [nodeId, nearestPoi.id];
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
    score: 91,
    scoreBreakdown: {
      spawnSeparation: clamp(minSpawnSeparation / 25, 0, 1) * 24,
      routeConnectivity: 24,
      verticality: 20,
      contentDensity: 15,
      budget: input.stats.solidBlocks < 2_500_000 ? 8 : 4,
    },
    stageTimingsMs: { total: input.generationMs },
    laneLengths: {
      radial_routes: SPAWN_CLUSTER_RADIUS,
      outer_routes: 18,
      poi_ring: 28,
    },
    laneWidths: {
      radial_routes: 10,
      outer_routes: 9,
      poi_ring: 8,
    },
    routeChoiceCount: BATTLE_ROYAL_TEAM_IDS.length + input.layout.pois.length,
    coverDensityByLane: {
      radial_routes: 0.58,
      outer_routes: 0.62,
      poi_ring: 0.55,
    },
    maxSightlineLength: 36,
    spawnVisibilityPairs: 0,
    flagApproachClearances: {},
    colliderCount: input.stats.colliderCount,
    chunkCount: input.stats.chunkCount,
    solidBlockCount: input.stats.solidBlocks,
    moduleCountsByRole: {
      central_landmark: 1,
      medium_landmark: input.layout.pois.length - 1,
      cover_cluster: input.layout.coverPieces.length,
      spawn_cluster: BATTLE_ROYAL_TEAM_IDS.length,
    },
    repairActions: {},
    warnings: minSpawnSeparation < 24 ? ['spawn separation below target'] : [],
  };
}

function createPreview(layout: BattleRoyalLayout): MapBlueprint['preview'] {
  const centerPoi = layout.pois.find((poi) => poi.role === 'citadel') ?? layout.pois[0];
  const routes = BATTLE_ROYAL_TEAM_IDS.map((team) => {
    const spawn = layout.spawns[team];
    const nearestPoi = findNearestPoi(layout, spawn.center);
    return {
      id: `${team}_route`,
      kind: 'primary' as const,
      points: [spawn.center, nearestPoi.position, centerPoi.position],
      width: 9,
    };
  });
  const spawns: TeamMap<Vec3> = {};
  for (const [team, spawn] of Object.entries(layout.spawns)) {
    spawns[team] = spawn.center;
  }

  return {
    camera: {
      position: { x: 0, y: 118, z: 112 },
      target: { x: 0, y: 5, z: 0 },
      fov: 48,
      near: 0.5,
      far: 280,
    },
    thumbnailSilhouette: {
      bounds: { minX: -BASE_RADIUS, maxX: BASE_RADIUS, minZ: -BASE_RADIUS, maxZ: BASE_RADIUS },
      boundary: layout.boundary,
      routes,
      landmarks: layout.pois.map((poi) => ({
        id: poi.id,
        role: poi.role === 'citadel' ? 'midfield_occluder' : poi.role === 'watchtower' ? 'defender_perch' : 'flank_landmark',
        position: poi.position,
        radius: poi.radius,
      })),
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
      score: 91,
      scoreBreakdown: {
        spawnSeparation: 24,
        routeConnectivity: 24,
        verticality: 20,
        contentDensity: 15,
        budget: 8,
      },
      laneLengths: { radial_routes: SPAWN_CLUSTER_RADIUS, outer_routes: 18, poi_ring: 28 },
      routeChoiceCount: BATTLE_ROYAL_TEAM_IDS.length + layout.pois.length,
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
      maxSolidBlocks: 2_700_000,
      maxColliders: 150_000,
      maxRenderableChunks: 3600,
      maxGenerationMs: 4000,
    },
    rngStreams: {
      boundary: hashSeed(normalizedSeed ^ 0xb417e),
      spawns: hashSeed(normalizedSeed ^ 0x51a7),
      pois: hashSeed(normalizedSeed ^ 0xc17ade1),
      pickups: hashSeed(normalizedSeed ^ 0x9f2d),
      cover: hashSeed(normalizedSeed ^ 0xc0a7e),
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
  const lanes: LaneDescriptor[] = [
    {
      id: 'radial_routes',
      label: 'Radial Routes',
      kind: 'primary',
      nodeIds: routeGraph.nodes.filter((node) => node.laneIds.includes('radial_routes')).map((node) => node.id),
      width: 10,
      expectedDistance: SPAWN_CLUSTER_RADIUS,
      expectedTravelTimeSeconds: SPAWN_CLUSTER_RADIUS / 7.6,
      coverDensityTarget: 0.58,
      verticalityBand: { minY: 3, maxY: 18 },
    },
    {
      id: 'outer_routes',
      label: 'Outer Rotations',
      kind: 'flank',
      nodeIds: routeGraph.nodes.filter((node) => node.laneIds.includes('outer_routes')).map((node) => node.id),
      width: 9,
      expectedDistance: 22,
      expectedTravelTimeSeconds: 22 / 7.4,
      coverDensityTarget: 0.62,
      verticalityBand: { minY: 3, maxY: 16 },
    },
    {
      id: 'poi_ring',
      label: 'POI Ring',
      kind: 'access',
      nodeIds: routeGraph.nodes.filter((node) => node.laneIds.includes('poi_ring')).map((node) => node.id),
      width: 8,
      expectedDistance: 28,
      expectedTravelTimeSeconds: 28 / 7.2,
      coverDensityTarget: 0.55,
      verticalityBand: { minY: 4, maxY: 20 },
    },
  ];
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
