import {
  POWERUP_PICKUP_RADIUS,
  POWERUP_RESPAWN_SECONDS,
} from '../../constants/game.js';
import { PLAYER_HEIGHT } from '../../constants/physics.js';
import { BATTLE_ROYAL_TEAM_IDS } from '../../types/team.js';
import type { Vec3 } from '../../types/vector.js';
import { isInsideBoundaryPolygon } from './boundaries.js';
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
const WORLD_SIZE = 336;
const WORLD_HEIGHT = 64;
const CHUNK_SIZE: VoxelSize = { x: 16, y: 16, z: 16 };
const BASE_RADIUS = 154;
const SPAWN_CLUSTER_RADIUS = BASE_RADIUS * 0.84;
const SPAWN_CLUSTER_POINT_RADIUS = 2.75;
const SPAWN_FLATTEN_RADIUS = 11.5;
const POWERUP_FLATTEN_RADIUS = 3.2;
const POI_FLATTEN_RADIUS = 9.5;
const BASE_TERRAIN_ROWS = 13;
const MIN_TERRAIN_ROWS = 5;
const MAX_TERRAIN_ROWS = 56;
const HEALTH_PACK_COUNT = 42;
const STRATEGIC_POWERUP_COUNT = 24;
const BUILDING_POI_COUNT = 30;
const ROUTE_COVER_COUNT = 148;

type PoiRole = 'citadel' | 'watchtower' | 'bunker' | 'depot' | 'highrise' | 'hangar' | 'relay' | 'compound';
type CoverMaterial = 'terrain' | 'metal' | 'glass';
type TerrainFeatureKind = 'mountain' | 'valley' | 'ridge';

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
  rotation: number;
  variant: number;
}

interface CoverPiece {
  id: string;
  position: { x: number; z: number };
  halfExtents: { x: number; z: number };
  heightRows: number;
  material: CoverMaterial;
  rotation: number;
}

interface TerrainFeature {
  id: string;
  kind: TerrainFeatureKind;
  center: { x: number; z: number };
  radiusX: number;
  radiusZ: number;
  rotation: number;
  amplitudeRows: number;
  noiseSeed: number;
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
  terrainFeatures: TerrainFeature[];
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

function rotatePoint2D(
  point: { x: number; z: number },
  center: { x: number; z: number },
  rotation: number
): { x: number; z: number } {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const dx = point.x - center.x;
  const dz = point.z - center.z;
  return {
    x: dx * cos + dz * sin,
    z: -dx * sin + dz * cos,
  };
}

function sampleAnnulusPoint(
  random: () => number,
  minRadius: number,
  maxRadius: number
): { x: number; z: number } {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(lerp(minRadius * minRadius, maxRadius * maxRadius, random()));
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
  };
}

function featureFalloff(feature: TerrainFeature, worldX: number, worldZ: number): number {
  const local = rotatePoint2D({ x: worldX, z: worldZ }, feature.center, feature.rotation);
  const normalized = Math.hypot(local.x / feature.radiusX, local.z / feature.radiusZ);
  return normalized >= 1 ? 0 : smoothstep(1 - normalized);
}

function createBoundary(seed: number): BoundaryPoint[] {
  const random = mulberry32(seed ^ 0xb417e);
  const points: BoundaryPoint[] = [];
  const pointCount = 52;
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseC = random() * Math.PI * 2;

  for (let index = 0; index < pointCount; index++) {
    const angle = (index / pointCount) * Math.PI * 2;
    const wave =
      Math.sin(angle * 3 + phaseA) * 0.04 +
      Math.sin(angle * 7 + phaseB) * 0.03 +
      Math.sin(angle * 13 + phaseC) * 0.015 +
      lerp(-0.02, 0.02, random());
    const radius = BASE_RADIUS * clamp(0.96 + wave, 0.9, 1.04);
    points.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
    });
  }

  return points;
}

function terrainRows(
  seed: number,
  worldX: number,
  worldZ: number,
  flattenZones: readonly FlattenZone[],
  terrainFeatures: readonly TerrainFeature[]
): number {
  const radial = Math.hypot(worldX, worldZ) / BASE_RADIUS;
  const centerBasin = Math.max(0, 1 - radial) * 3.4;
  const outerDrop = radial > 0.88 ? -(radial - 0.88) * 18 : 0;
  const broad = (fractalNoise2(seed ^ 0x514f, worldX * 0.0065, worldZ * 0.0065, 5) - 0.5) * 19;
  const medium = (fractalNoise2(seed ^ 0x2d7, worldX * 0.019, worldZ * 0.019, 4) - 0.5) * 9;
  const detail = (fractalNoise2(seed ^ 0xf00d, worldX * 0.055, worldZ * 0.055, 2) - 0.5) * 2.8;
  let rows = BASE_TERRAIN_ROWS + centerBasin + broad + medium + detail + outerDrop;

  for (const feature of terrainFeatures) {
    const falloff = featureFalloff(feature, worldX, worldZ);
    if (falloff <= 0) continue;
    const roughness = lerp(
      0.82,
      1.18,
      fractalNoise2(feature.noiseSeed, worldX * 0.024, worldZ * 0.024, 3)
    );
    const influence = feature.amplitudeRows * falloff * roughness;
    rows += feature.kind === 'valley' ? -influence : influence;
  }

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

function createTerrainFeatures(seed: number, spawns: TeamMap<SpawnCluster>): TerrainFeature[] {
  const random = mulberry32(seed ^ 0x7e44a11);
  const protectedSpawnPositions = getSpawnProtectedPositions(spawns);
  const features: TerrainFeature[] = [];

  const addFeature = (
    kind: TerrainFeatureKind,
    index: number,
    radiusRange: { min: number; max: number },
    radiusX: { min: number; max: number },
    radiusZ: { min: number; max: number },
    amplitudeRows: { min: number; max: number },
    clearance: number,
    rotationBias?: number
  ): void => {
    for (let attempt = 0; attempt < 96; attempt++) {
      const center = sampleAnnulusPoint(random, radiusRange.min, radiusRange.max);
      if (!isClearOfPositions(center, protectedSpawnPositions, clearance)) continue;
      const radialAngle = Math.atan2(center.z, center.x);
      features.push({
        id: `${kind}_${index}`,
        kind,
        center,
        radiusX: lerp(radiusX.min, radiusX.max, random()),
        radiusZ: lerp(radiusZ.min, radiusZ.max, random()),
        rotation: rotationBias === undefined
          ? random() * Math.PI * 2
          : radialAngle + rotationBias + lerp(-0.36, 0.36, random()),
        amplitudeRows: lerp(amplitudeRows.min, amplitudeRows.max, random()),
        noiseSeed: hashSeed(seed ^ Math.imul(index + 1, kind === 'mountain' ? 0x45d9f3b : kind === 'valley' ? 0x119de1f3 : 0x27d4eb2d)),
      });
      return;
    }
  };

  for (let index = 0; index < 7; index++) {
    addFeature(
      'mountain',
      index,
      { min: BASE_RADIUS * 0.22, max: BASE_RADIUS * 0.88 },
      { min: 16, max: 34 },
      { min: 18, max: 42 },
      { min: 13, max: 28 },
      16
    );
  }

  for (let index = 0; index < 8; index++) {
    addFeature(
      'valley',
      index,
      { min: BASE_RADIUS * 0.12, max: BASE_RADIUS * 0.78 },
      { min: 48, max: 92 },
      { min: 9, max: 19 },
      { min: 8, max: 16 },
      10,
      Math.PI * 0.5
    );
  }

  for (let index = 0; index < 10; index++) {
    addFeature(
      'ridge',
      index,
      { min: BASE_RADIUS * 0.18, max: BASE_RADIUS * 0.86 },
      { min: 34, max: 76 },
      { min: 5, max: 12 },
      { min: 6, max: 14 },
      12,
      random() > 0.5 ? 0 : Math.PI * 0.5
    );
  }

  return features;
}

const POI_ROLE_SPECS: Record<
  Exclude<PoiRole, 'citadel'>,
  {
    radius: { min: number; max: number };
    heightRows: { min: number; max: number };
    flattenOffsetRows: { min: number; max: number };
    radial: { min: number; max: number };
    clearance: number;
  }
> = {
  highrise: {
    radius: { min: 6.5, max: 10 },
    heightRows: { min: 26, max: 42 },
    flattenOffsetRows: { min: 5, max: 9 },
    radial: { min: BASE_RADIUS * 0.08, max: BASE_RADIUS * 0.58 },
    clearance: 20,
  },
  compound: {
    radius: { min: 10, max: 15 },
    heightRows: { min: 12, max: 20 },
    flattenOffsetRows: { min: 3, max: 6 },
    radial: { min: BASE_RADIUS * 0.18, max: BASE_RADIUS * 0.76 },
    clearance: 22,
  },
  hangar: {
    radius: { min: 9, max: 14 },
    heightRows: { min: 8, max: 14 },
    flattenOffsetRows: { min: 1, max: 4 },
    radial: { min: BASE_RADIUS * 0.35, max: BASE_RADIUS * 0.88 },
    clearance: 20,
  },
  relay: {
    radius: { min: 5.5, max: 8.5 },
    heightRows: { min: 22, max: 34 },
    flattenOffsetRows: { min: 3, max: 7 },
    radial: { min: BASE_RADIUS * 0.24, max: BASE_RADIUS * 0.82 },
    clearance: 17,
  },
  watchtower: {
    radius: { min: 5.5, max: 8 },
    heightRows: { min: 18, max: 30 },
    flattenOffsetRows: { min: 2, max: 5 },
    radial: { min: BASE_RADIUS * 0.22, max: BASE_RADIUS * 0.86 },
    clearance: 16,
  },
  bunker: {
    radius: { min: 8, max: 12 },
    heightRows: { min: 8, max: 15 },
    flattenOffsetRows: { min: 1, max: 4 },
    radial: { min: BASE_RADIUS * 0.28, max: BASE_RADIUS * 0.9 },
    clearance: 18,
  },
  depot: {
    radius: { min: 6, max: 10 },
    heightRows: { min: 6, max: 12 },
    flattenOffsetRows: { min: 0, max: 3 },
    radial: { min: BASE_RADIUS * 0.42, max: BASE_RADIUS * 0.92 },
    clearance: 16,
  },
};

function createPois(seed: number, spawns: TeamMap<SpawnCluster>): { pois: BattleRoyalPoi[]; flattenZones: FlattenZone[] } {
  const random = mulberry32(seed ^ 0xc17ade1);
  const protectedPositions = getSpawnProtectedPositions(spawns);
  const center = sampleAnnulusPoint(random, 0, 8);
  const pois: BattleRoyalPoi[] = [{
    id: 'center_citadel',
    role: 'citadel',
    position: { x: center.x, y: 0, z: center.z },
    radius: 17,
    heightRows: 34,
    flattenRows: BASE_TERRAIN_ROWS + 6,
    rotation: random() * Math.PI * 2,
    variant: Math.floor(random() * 4),
  }];
  const flattenZones: FlattenZone[] = [{
    center,
    radius: 24,
    rows: BASE_TERRAIN_ROWS + 5,
    strength: 0.95,
  }];

  const rolePool: Array<Exclude<PoiRole, 'citadel'>> = [
    'highrise',
    'compound',
    'hangar',
    'relay',
    'watchtower',
    'bunker',
    'depot',
    'highrise',
    'compound',
    'watchtower',
    'bunker',
    'depot',
  ];

  for (let index = 0; index < BUILDING_POI_COUNT; index++) {
    const role = rolePool[Math.floor(random() * rolePool.length)] ?? 'depot';
    const spec = POI_ROLE_SPECS[role];
    let poi: BattleRoyalPoi | null = null;
    let fallbackPoi: BattleRoyalPoi | null = null;
    for (let attempt = 0; attempt < 160; attempt++) {
      const point = sampleAnnulusPoint(random, spec.radial.min, spec.radial.max);
      const radius = lerp(spec.radius.min, spec.radius.max, random());
      const candidate: BattleRoyalPoi = {
        id: `${role}_${index + 1}`,
        role,
        position: { x: point.x, y: 0, z: point.z },
        radius,
        heightRows: Math.round(lerp(spec.heightRows.min, spec.heightRows.max, random())),
        flattenRows: BASE_TERRAIN_ROWS + Math.round(lerp(spec.flattenOffsetRows.min, spec.flattenOffsetRows.max, random())),
        rotation: random() * Math.PI * 2,
        variant: Math.floor(random() * 5),
      };
      fallbackPoi = candidate;
      if (isClearOfPositions(candidate.position, protectedPositions, spec.clearance + candidate.radius)) {
        poi = candidate;
        break;
      }
    }
    if (poi === null) poi = fallbackPoi;
    if (poi === null) continue;
    pois.push(poi);
    protectedPositions.push(poi.position);
    flattenZones.push({
      center: poi.position,
      radius: poi.radius + POI_FLATTEN_RADIUS,
      rows: poi.flattenRows,
      strength: poi.role === 'highrise' || poi.role === 'compound' ? 0.9 : 0.82,
    });
  }

  return { pois, flattenZones };
}

function createPowerups(
  seed: number,
  spawns: TeamMap<SpawnCluster>,
  pois: readonly BattleRoyalPoi[]
): { powerups: MapPowerupPickup[]; flattenZones: FlattenZone[] } {
  const random = mulberry32(seed ^ 0x9f2d);
  const powerups: MapPowerupPickup[] = [];
  const flattenZones: FlattenZone[] = [];
  const protectedPositions = [
    ...getSpawnProtectedPositions(spawns),
    ...pois.map((poi) => poi.position),
  ];

  let id = 0;
  const placePickup = (
    kind: MapPowerupPickup['kind'],
    strategicRole: MapPowerupPickup['strategicRole'],
    minRadius: number,
    maxRadius: number
  ): void => {
    let position: Vec3 | null = null;
    for (let attempt = 0; attempt < 128; attempt++) {
      const point = sampleAnnulusPoint(random, minRadius, maxRadius);
      position = { x: point.x, y: 0, z: point.z };
      if (isClearOfPositions(point, protectedPositions, kind === 'health_pack' ? 8.5 : 10.5)) break;
    }
    if (position === null) return;
    protectedPositions.push(position);
    flattenZones.push({
      center: position,
      radius: POWERUP_FLATTEN_RADIUS,
      rows: BASE_TERRAIN_ROWS + (maxRadius < BASE_RADIUS * 0.3 ? 3 : 1),
      strength: 0.7,
    });
    powerups.push({
      id: `br_pickup_${++id}`,
      kind,
      position,
      radius: POWERUP_PICKUP_RADIUS,
      respawnSeconds: POWERUP_RESPAWN_SECONDS,
      strategicRole,
    });
  };

  for (let index = 0; index < 4; index++) {
    placePickup('powerup', 'midfield_contest', 4, BASE_RADIUS * 0.2);
  }
  for (let index = 4; index < STRATEGIC_POWERUP_COUNT; index++) {
    placePickup('powerup', 'route_bridge', BASE_RADIUS * 0.2, BASE_RADIUS * 0.78);
  }
  for (let index = 0; index < HEALTH_PACK_COUNT; index++) {
    placePickup('health_pack', random() > 0.55 ? 'flank_reward' : 'route_bridge', BASE_RADIUS * 0.18, BASE_RADIUS * 0.9);
  }

  return { powerups, flattenZones };
}

function createCoverPieces(seed: number, spawns: TeamMap<SpawnCluster>): CoverPiece[] {
  const random = mulberry32(seed ^ 0xc0a7e);
  const pieces: CoverPiece[] = [];
  const protectedSpawnPositions = getSpawnProtectedPositions(spawns);

  let id = 0;
  for (let index = 0; index < ROUTE_COVER_COUNT; index++) {
    const position = sampleAnnulusPoint(random, BASE_RADIUS * 0.12, BASE_RADIUS * 0.92);
    if (!isClearOfPositions(position, protectedSpawnPositions, 8.5)) continue;
    const materialRoll = random();
    pieces.push({
      id: `route_cover_${++id}`,
      position,
      halfExtents: { x: lerp(1.3, 4.2, random()), z: lerp(0.55, 1.85, random()) },
      heightRows: Math.floor(lerp(2, 7, random())),
      material: materialRoll > 0.76 ? 'metal' : materialRoll > 0.68 ? 'glass' : 'terrain',
      rotation: random() * Math.PI * 2,
    });
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
        rotation: Math.atan2(facing.z, facing.x),
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
  const terrainFeatures = createTerrainFeatures(seed, spawnLayout.spawns);
  const poiLayout = createPois(seed, spawnLayout.spawns);
  const pickupLayout = createPowerups(seed, spawnLayout.spawns, poiLayout.pois);
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
    terrainFeatures,
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
  return terrainRows(layout.seed, point.x, point.z, layout.flattenZones, layout.terrainFeatures);
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
      const insidePlayable = isInsideBoundaryPolygon(worldX, worldZ, layout.boundary);
      const boundaryBand = !insidePlayable && radial <= halfSize - 1;
      const rows = insidePlayable
        ? terrainRows(layout.seed, worldX, worldZ, layout.flattenZones, layout.terrainFeatures)
        : boundaryBand
          ? Math.round(44 + (fractalNoise2(layout.seed ^ 0x777, worldX * 0.032, worldZ * 0.032, 2) - 0.5) * 8)
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
  perimeterOnly = false,
  rotation = 0
): void {
  const boundsRadius = Math.hypot(halfExtents.x, halfExtents.z);
  const minX = Math.floor((center.x - boundsRadius - layout.origin.x) / VOXEL_SIZE.x);
  const maxX = Math.ceil((center.x + boundsRadius - layout.origin.x) / VOXEL_SIZE.x);
  const minZ = Math.floor((center.z - boundsRadius - layout.origin.z) / VOXEL_SIZE.z);
  const maxZ = Math.ceil((center.z + boundsRadius - layout.origin.z) / VOXEL_SIZE.z);
  const edgeWidth = Math.max(VOXEL_SIZE.x, VOXEL_SIZE.z) * 1.5;

  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
      const local = rotatePoint2D({ x: worldX, z: worldZ }, center, rotation);
      if (Math.abs(local.x) > halfExtents.x || Math.abs(local.z) > halfExtents.z) continue;
      const edge = Math.abs(local.x) > halfExtents.x - edgeWidth || Math.abs(local.z) > halfExtents.z - edgeWidth;
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

function offsetByRotation(center: { x: number; z: number }, rotation: number, local: { x: number; z: number }): { x: number; z: number } {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: center.x + local.x * cos - local.z * sin,
    z: center.z + local.x * sin + local.z * cos,
  };
}

function stampPoi(layout: BattleRoyalLayout, blocks: Uint8Array, poi: BattleRoyalPoi): void {
  const center = { x: poi.position.x, z: poi.position.z };
  const angle = poi.rotation;
  switch (poi.role) {
    case 'citadel':
      stampCylinder(layout, blocks, poi.position, poi.radius, 3, METAL, GLASS);
      stampCylinder(layout, blocks, poi.position, 5.2, poi.heightRows, METAL, GLASS);
      stampRectPrism(layout, blocks, center, { x: 17, z: 1.4 }, 5, METAL, false, angle);
      stampRectPrism(layout, blocks, center, { x: 1.4, z: 17 }, 5, METAL, false, angle);
      break;
    case 'watchtower':
      stampCylinder(layout, blocks, poi.position, Math.max(2.8, poi.radius * 0.5), poi.heightRows, METAL, GLASS);
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius }, 3, GLASS, true, angle);
      break;
    case 'bunker':
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.72 }, poi.heightRows, METAL, true, angle);
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.52, z: poi.radius * 0.4 }, 3, GLASS, false, angle);
      break;
    case 'depot':
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.58 }, poi.heightRows, METAL, true, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 2.2, z: -2.2 }), { x: 2.7, z: 2.7 }, 4, GLASS, false, angle);
      break;
    case 'highrise':
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.9, z: poi.radius * 0.9 }, 5, METAL, false, angle);
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.48, z: poi.radius * 0.55 }, poi.heightRows, METAL, false, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 0, z: poi.radius * 0.58 }), { x: poi.radius * 0.5, z: 0.7 }, poi.heightRows - 4, GLASS, false, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 0, z: -poi.radius * 0.58 }), { x: poi.radius * 0.5, z: 0.7 }, poi.heightRows - 6, GLASS, false, angle);
      break;
    case 'hangar':
      stampRectPrism(layout, blocks, center, { x: poi.radius * 1.25, z: poi.radius * 0.55 }, poi.heightRows, METAL, true, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: -poi.radius * 0.45, z: 0 }), { x: poi.radius * 0.35, z: poi.radius * 0.42 }, Math.max(4, poi.heightRows - 3), GLASS, false, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: poi.radius * 0.72, z: 0 }), { x: 1.2, z: poi.radius * 0.5 }, Math.max(3, poi.heightRows - 5), METAL, false, angle);
      break;
    case 'relay':
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.72 }, 4, METAL, false, angle);
      stampCylinder(layout, blocks, poi.position, Math.max(2, poi.radius * 0.34), poi.heightRows, METAL, GLASS);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 0, z: poi.radius * 0.52 }), { x: poi.radius * 0.85, z: 0.7 }, Math.max(4, poi.heightRows - 8), GLASS, false, angle);
      break;
    case 'compound':
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.95, z: poi.radius * 0.42 }, poi.heightRows, METAL, true, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: -poi.radius * 0.42, z: poi.radius * 0.58 }), { x: poi.radius * 0.42, z: poi.radius * 0.36 }, Math.max(5, poi.heightRows - 5), METAL, false, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: poi.radius * 0.46, z: -poi.radius * 0.56 }), { x: poi.radius * 0.36, z: poi.radius * 0.4 }, Math.max(5, poi.heightRows - 7), GLASS, false, angle + Math.PI * 0.5);
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
    stampRectPrism(layout, blocks, cover.position, cover.halfExtents, cover.heightRows, block, false, cover.rotation);
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
      spawnSeparation: clamp(minSpawnSeparation / 44, 0, 1) * 24,
      routeConnectivity: 24,
      verticality: 20,
      contentDensity: 15,
      budget: input.stats.solidBlocks < 8_500_000 ? 8 : 4,
    },
    stageTimingsMs: { total: input.generationMs },
    laneLengths: {
      radial_routes: SPAWN_CLUSTER_RADIUS,
      outer_routes: 42,
      poi_ring: 54,
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
    maxSightlineLength: 58,
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
    warnings: minSpawnSeparation < 42 ? ['spawn separation below target'] : [],
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
      position: { x: 0, y: 218, z: 214 },
      target: { x: 0, y: 8, z: 0 },
      fov: 48,
      near: 0.5,
      far: 560,
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
    labelTags: ['Battle Royal', '30 Players', 'Expansive'],
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
    name: `${layout.theme.name} Wilds`,
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
      laneLengths: { radial_routes: SPAWN_CLUSTER_RADIUS, outer_routes: 42, poi_ring: 54 },
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
      maxSolidBlocks: 8_750_000,
      maxColliders: 280_000,
      maxRenderableChunks: 7600,
      maxGenerationMs: 9000,
    },
    rngStreams: {
      boundary: hashSeed(normalizedSeed ^ 0xb417e),
      spawns: hashSeed(normalizedSeed ^ 0x51a7),
      pois: hashSeed(normalizedSeed ^ 0xc17ade1),
      pickups: hashSeed(normalizedSeed ^ 0x9f2d),
      cover: hashSeed(normalizedSeed ^ 0xc0a7e),
      terrainFeatures: hashSeed(normalizedSeed ^ 0x7e44a11),
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
      verticalityBand: { minY: 3, maxY: 31 },
    },
    {
      id: 'outer_routes',
      label: 'Outer Rotations',
      kind: 'flank',
      nodeIds: routeGraph.nodes.filter((node) => node.laneIds.includes('outer_routes')).map((node) => node.id),
      width: 9,
      expectedDistance: 42,
      expectedTravelTimeSeconds: 42 / 7.4,
      coverDensityTarget: 0.62,
      verticalityBand: { minY: 3, maxY: 28 },
    },
    {
      id: 'poi_ring',
      label: 'POI Ring',
      kind: 'access',
      nodeIds: routeGraph.nodes.filter((node) => node.laneIds.includes('poi_ring')).map((node) => node.id),
      width: 8,
      expectedDistance: 54,
      expectedTravelTimeSeconds: 54 / 7.2,
      coverDensityTarget: 0.55,
      verticalityBand: { minY: 4, maxY: 34 },
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
