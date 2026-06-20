import {
  POWERUP_PICKUP_RADIUS,
  POWERUP_RESPAWN_SECONDS,
} from '../../constants/game.js';
import { PLAYER_HEIGHT, PLAYER_RADIUS } from '../../constants/physics.js';
import { BATTLE_ROYAL_TEAM_IDS, type Team } from '../../types/team.js';
import type { Vec3 } from '../../types/vector.js';
import { getClosestBoundaryPoint, isInsideBoundaryPolygon } from './boundaries.js';
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
  type MapNamedLocation,
  type MapNamedLocationKind,
  type MapPerformanceBudget,
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
  type VoxelMapSizeId,
  type VoxelSize,
} from './types.js';

const VOXEL_SIZE: VoxelSize = { x: 0.5, y: 0.5, z: 0.5 };
const WORLD_SIZE = 376;
const WORLD_HEIGHT = 96;
const CHUNK_SIZE: VoxelSize = { x: 16, y: 16, z: 16 };
const BASE_RADIUS = 173;
const SPAWN_CLUSTER_POINT_RADIUS = 2.75;
const SPAWN_FLATTEN_RADIUS = 11.5;
const SPAWN_CAPSULE_CLEARANCE_RADIUS = PLAYER_RADIUS + 0.04;
const POWERUP_FLATTEN_RADIUS = 3.2;
const POI_FLATTEN_RADIUS = 9.5;
const BASE_TERRAIN_ROWS = 13;
const MIN_TERRAIN_ROWS = 10;
const MAX_TERRAIN_ROWS = 70;
const TERRAIN_SHELL_DEPTH_ROWS = 5;
const TERRAIN_SIDE_ROWS = 3;
const BOUNDARY_WALL_THICKNESS = 3.4;
const SPAWN_BOUNDARY_PADDING = SPAWN_CLUSTER_POINT_RADIUS + BOUNDARY_WALL_THICKNESS + 1.5;
const BOUNDARY_WALL_ROWS = 72;
const ROAD_FLATTEN_SAMPLE_SPACING = 14;
const SIGHTLINE_EYE_ROWS = 4.2;
const SIGHTLINE_SAMPLE_GRID_SPACING = 42;
const SIGHTLINE_SAMPLE_STEP_DISTANCE = 2.25;
const SIGHTLINE_MIN_REPORTED_DISTANCE = 45;
const SIGHTLINE_OCCLUSION_TARGET_DISTANCE = 155;
const SIGHTLINE_WARNING_MAX_DISTANCE = 180;
const SIGHTLINE_REPAIR_MAX_PASSES = 30;
const HEALTH_PACK_COUNT = 42;
const STRATEGIC_POWERUP_COUNT = 24;
const ROAD_LANE_PRIMARY = 'primary_roads';
const ROAD_LANE_OUTER = 'outer_routes';
const ROAD_LANE_LOOP = 'settlement_loop';
const ROAD_LANE_SETTLEMENT = 'settlement_paths';
const ROAD_LANE_WILD = 'wild_routes';

type PoiRole = 'citadel' | 'watchtower' | 'bunker' | 'depot' | 'highrise' | 'hangar' | 'relay' | 'compound';
type DistrictKind = 'city_core' | 'town' | 'industrial' | 'hamlet' | 'outpost' | 'open_field' | 'wildland';
type RoadNodeKind = 'spawn' | 'district' | 'junction';
type RoadSegmentKind = 'primary' | 'loop' | 'spur' | 'wild';
type CoverRole = 'settlement' | 'roadside' | 'natural' | 'spawn_shelter';
type CoverMaterial = 'terrain' | 'metal' | 'glass';
type TerrainFeatureKind = 'mountain' | 'ridge';

function createBattleRoyalSizeProfile(
  mapSize: VoxelMapSizeId,
  scale: number,
  overrides: Pick<
    BattleRoyalSizeProfile,
    | 'healthPackCount'
    | 'strategicPowerupCount'
    | 'sightlineOcclusionTargetDistance'
    | 'sightlineWarningMaxDistance'
    | 'performanceBudget'
    | 'labelTags'
  >
): BattleRoyalSizeProfile {
  const worldSize = Math.round((WORLD_SIZE * scale) / VOXEL_SIZE.x) * VOXEL_SIZE.x;
  const baseRadius = BASE_RADIUS * scale;

  return {
    mapSize,
    scale,
    worldSize,
    worldHeight: WORLD_HEIGHT,
    baseRadius,
    spawnClusterRadius: baseRadius * 0.86,
    sightlineSampleGridSpacing: SIGHTLINE_SAMPLE_GRID_SPACING * scale,
    ...overrides,
  };
}

interface BattleRoyalSizeProfile {
  mapSize: VoxelMapSizeId;
  scale: number;
  worldSize: number;
  worldHeight: number;
  baseRadius: number;
  spawnClusterRadius: number;
  healthPackCount: number;
  strategicPowerupCount: number;
  sightlineSampleGridSpacing: number;
  sightlineOcclusionTargetDistance: number;
  sightlineWarningMaxDistance: number;
  performanceBudget: MapPerformanceBudget;
  labelTags: string[];
}

const BATTLE_ROYAL_SIZE_PROFILES: Record<VoxelMapSizeId, BattleRoyalSizeProfile> = {
  small: createBattleRoyalSizeProfile('small', 0.72, {
    healthPackCount: 22,
    strategicPowerupCount: 12,
    sightlineOcclusionTargetDistance: 112,
    sightlineWarningMaxDistance: 132,
    labelTags: ['Battle Royal', '12-18 Players', 'Compact', 'Towns', 'Fast Routes'],
    performanceBudget: {
      maxSolidBlocks: 4_600_000,
      maxColliders: 150_000,
      maxRenderableChunks: 4_300,
      maxGenerationMs: 6_000,
    },
  }),
  medium: createBattleRoyalSizeProfile('medium', 0.86, {
    healthPackCount: 32,
    strategicPowerupCount: 18,
    sightlineOcclusionTargetDistance: 132,
    sightlineWarningMaxDistance: 155,
    labelTags: ['Battle Royal', '19-26 Players', 'Balanced', 'Towns', 'Open Routes'],
    performanceBudget: {
      maxSolidBlocks: 6_400_000,
      maxColliders: 215_000,
      maxRenderableChunks: 5_900,
      maxGenerationMs: 7_500,
    },
  }),
  large: createBattleRoyalSizeProfile('large', 1, {
    healthPackCount: HEALTH_PACK_COUNT,
    strategicPowerupCount: STRATEGIC_POWERUP_COUNT,
    sightlineOcclusionTargetDistance: SIGHTLINE_OCCLUSION_TARGET_DISTANCE,
    sightlineWarningMaxDistance: SIGHTLINE_WARNING_MAX_DISTANCE,
    labelTags: ['Battle Royal', '27-33 Players', 'Expansive', 'Towns', 'Open Routes'],
    performanceBudget: {
      maxSolidBlocks: 8_750_000,
      maxColliders: 280_000,
      maxRenderableChunks: 7600,
      maxGenerationMs: 9000,
    },
  }),
};

function normalizeBattleRoyalMapSize(mapSize?: VoxelMapSizeId | null): VoxelMapSizeId {
  return mapSize === 'small' || mapSize === 'medium' || mapSize === 'large' ? mapSize : 'large';
}

function getBattleRoyalSizeProfile(mapSize?: VoxelMapSizeId | null): BattleRoyalSizeProfile {
  return BATTLE_ROYAL_SIZE_PROFILES[normalizeBattleRoyalMapSize(mapSize)];
}

interface FlattenZone {
  center: { x: number; z: number };
  radius: number;
  rows: number;
  strength?: number;
  maxLowerRows?: number;
  maxRaiseRows?: number;
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
  districtId?: string;
}

interface CoverPiece {
  id: string;
  role: CoverRole;
  position: { x: number; z: number };
  halfExtents: { x: number; z: number };
  heightRows: number;
  material: CoverMaterial;
  rotation: number;
}

interface BattleRoyalDistrict {
  id: string;
  kind: DistrictKind;
  center: Vec3;
  radius: number;
  influenceRadius: number;
  flattenRows: number;
  rotation: number;
  roadNodeId: string;
}

interface RoadNode {
  id: string;
  kind: RoadNodeKind;
  position: Vec3;
  tags: string[];
  team?: Team;
  districtId?: string;
}

interface RoadSegment {
  id: string;
  kind: RoadSegmentKind;
  laneId: string;
  fromNodeId: string;
  toNodeId: string;
  points: Vec3[];
  width: number;
  tags: string[];
  traversal: RouteGraphEdge['traversal'];
}

interface PickupAnchor {
  position: Vec3;
  laneId?: string;
  routeNodeId?: string;
  radius: number;
  kind?: DistrictKind;
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

interface SightlineSamplePoint {
  id: string;
  x: number;
  z: number;
}

interface SightlineMetrics {
  maxSightlineLength: number;
  spawnVisibilityPairs: number;
}

interface SightlinePair {
  from: SightlineSamplePoint;
  to: SightlineSamplePoint;
  distance: number;
}

interface BattleRoyalLayout {
  seed: number;
  profile: BattleRoyalSizeProfile;
  theme: VoxelMapTheme;
  origin: Vec3;
  size: VoxelSize;
  boundary: BoundaryPoint[];
  spawns: TeamMap<SpawnCluster>;
  spawnPoints: Record<string, Vec3[]>;
  flattenZones: FlattenZone[];
  terrainFeatures: TerrainFeature[];
  districts: BattleRoyalDistrict[];
  roadNodes: RoadNode[];
  roadSegments: RoadSegment[];
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

function distanceToSegment2D(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number }
): number {
  const segmentX = end.x - start.x;
  const segmentZ = end.z - start.z;
  const lengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  if (lengthSquared <= 0.0001) return distance2D(point, start);
  const t = clamp(((point.x - start.x) * segmentX + (point.z - start.z) * segmentZ) / lengthSquared, 0, 1);
  return distance2D(point, {
    x: start.x + segmentX * t,
    z: start.z + segmentZ * t,
  });
}

function normalize2D(vector: { x: number; z: number }): { x: number; z: number } {
  const length = Math.hypot(vector.x, vector.z);
  return length <= 0.001 ? { x: 0, z: 1 } : { x: vector.x / length, z: vector.z / length };
}

function add2D(a: { x: number; z: number }, b: { x: number; z: number }, scale = 1): { x: number; z: number } {
  return {
    x: a.x + b.x * scale,
    z: a.z + b.z * scale,
  };
}

function lerpPoint2D(a: { x: number; z: number }, b: { x: number; z: number }, t: number): { x: number; z: number } {
  return {
    x: lerp(a.x, b.x, t),
    z: lerp(a.z, b.z, t),
  };
}

function clampPointToBoundary(point: { x: number; z: number }, boundary: BoundaryPoint[], padding = 3.5): { x: number; z: number } {
  if (boundary.length < 3 || isInsideBoundaryPolygon(point.x, point.z, boundary)) {
    return { x: point.x, z: point.z };
  }

  const { point: closest, normal } = getClosestBoundaryPoint(point.x, point.z, boundary);
  return {
    x: closest.x + normal.x * padding,
    z: closest.z + normal.z * padding,
  };
}

function insetPointFromBoundary(point: { x: number; z: number }, boundary: BoundaryPoint[], padding: number): { x: number; z: number } {
  if (boundary.length < 3) return { x: point.x, z: point.z };

  const { point: closest, normal } = getClosestBoundaryPoint(point.x, point.z, boundary);
  const distance = distance2D(point, closest);
  if (isInsideBoundaryPolygon(point.x, point.z, boundary) && distance >= padding) {
    return { x: point.x, z: point.z };
  }

  return {
    x: closest.x + normal.x * padding,
    z: closest.z + normal.z * padding,
  };
}

function isClearOfCircles(
  position: { x: number; z: number },
  reserved: readonly { x: number; z: number; radius: number }[],
  radius: number,
  scale = 0.72
): boolean {
  return reserved.every((circle) => distance2D(position, circle) >= radius + circle.radius * scale);
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

function unitFromSeed(seed: number): number {
  return (hashSeed(seed) >>> 0) / 0x1_0000_0000;
}

function sampleDistrictPoint(
  random: () => number,
  district: BattleRoyalDistrict,
  minRadiusRatio: number,
  maxRadiusRatio: number
): { x: number; z: number } {
  const local = sampleAnnulusPoint(
    random,
    district.radius * minRadiusRatio,
    district.radius * maxRadiusRatio
  );
  return offsetByRotation(district.center, district.rotation, local);
}

function countBy<T extends string>(values: readonly T[]): Record<T, number> {
  return values.reduce<Record<T, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {} as Record<T, number>);
}

function featureFalloff(feature: TerrainFeature, worldX: number, worldZ: number): number {
  const local = rotatePoint2D({ x: worldX, z: worldZ }, feature.center, feature.rotation);
  const normalized = Math.hypot(local.x / feature.radiusX, local.z / feature.radiusZ);
  return normalized >= 1 ? 0 : smoothstep(1 - normalized);
}

function createBoundary(seed: number, profile: BattleRoyalSizeProfile): BoundaryPoint[] {
  const random = mulberry32(seed ^ 0xb417e);
  const points: BoundaryPoint[] = [];
  const pointCount = 64;
  const phaseA = random() * Math.PI * 2;
  const phaseB = random() * Math.PI * 2;
  const phaseC = random() * Math.PI * 2;
  const phaseD = random() * Math.PI * 2;

  for (let index = 0; index < pointCount; index++) {
    const angle = (index / pointCount) * Math.PI * 2;
    const wave =
      Math.sin(angle * 3 + phaseA) * 0.085 +
      Math.sin(angle * 5 + phaseB) * 0.055 +
      Math.sin(angle * 9 + phaseC) * 0.034 +
      Math.sin(angle * 15 + phaseD) * 0.018 +
      lerp(-0.035, 0.035, random());
    const radius = profile.baseRadius * clamp(0.93 + wave, 0.78, 1.08);
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
  terrainFeatures: readonly TerrainFeature[],
  profile: BattleRoyalSizeProfile
): number {
  const radial = Math.hypot(worldX, worldZ) / profile.baseRadius;
  const centerRise = Math.max(0, 1 - radial) * 1.8;
  const outerShoulder = radial > 0.76 ? smoothstep((radial - 0.76) / 0.2) * 4.5 : 0;
  const broad = (fractalNoise2(seed ^ 0x514f, worldX * 0.0065, worldZ * 0.0065, 5) - 0.5) * 9;
  const medium = (fractalNoise2(seed ^ 0x2d7, worldX * 0.019, worldZ * 0.019, 4) - 0.5) * 4.2;
  const detail = (fractalNoise2(seed ^ 0xf00d, worldX * 0.055, worldZ * 0.055, 2) - 0.5) * 1.2;
  let rows = BASE_TERRAIN_ROWS + centerRise + outerShoulder + broad + medium + detail;

  for (const feature of terrainFeatures) {
    const falloff = featureFalloff(feature, worldX, worldZ);
    if (falloff <= 0) continue;
    const roughness = lerp(
      0.9,
      1.08,
      fractalNoise2(feature.noiseSeed, worldX * 0.018, worldZ * 0.018, 3)
    );
    const influence = feature.amplitudeRows * falloff * roughness;
    rows += feature.kind === 'ridge' ? influence * 1.02 : influence;
  }

  for (const zone of flattenZones) {
    const distance = distance2D({ x: worldX, z: worldZ }, zone.center);
    if (distance >= zone.radius) continue;
    const blend = smoothstep(1 - distance / zone.radius) * (zone.strength ?? 0.86);
    let targetRows = zone.rows;
    if (rows > targetRows && zone.maxLowerRows !== undefined) {
      targetRows = Math.max(targetRows, rows - zone.maxLowerRows);
    } else if (rows < targetRows && zone.maxRaiseRows !== undefined) {
      targetRows = Math.min(targetRows, rows + zone.maxRaiseRows);
    }
    rows = lerp(rows, targetRows, blend);
  }

  return Math.round(clamp(rows, MIN_TERRAIN_ROWS, MAX_TERRAIN_ROWS));
}

function createSpawnClusters(seed: number, boundary: BoundaryPoint[], profile: BattleRoyalSizeProfile): {
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
    const unclampedCenter = {
      x: Math.cos(angle) * (profile.spawnClusterRadius + radiusJitter),
      y: 0,
      z: Math.sin(angle) * (profile.spawnClusterRadius + radiusJitter),
    };
    const clampedCenter = insetPointFromBoundary(unclampedCenter, boundary, SPAWN_BOUNDARY_PADDING);
    const center = { x: clampedCenter.x, y: 0, z: clampedCenter.z };
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
      maxLowerRows: 14,
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

function createDistricts(
  seed: number,
  boundary: BoundaryPoint[],
  spawns: TeamMap<SpawnCluster>,
  profile: BattleRoyalSizeProfile
): BattleRoyalDistrict[] {
  const random = mulberry32(seed ^ 0xd157c7);
  const baseRadius = profile.baseRadius;
  const scale = profile.scale;
  const districts: BattleRoyalDistrict[] = [];
  const reserved = getSpawnProtectedPositions(spawns).map((position) => ({
    x: position.x,
    z: position.z,
    radius: 18 * profile.scale,
  }));
  const angleOffset = random() * Math.PI * 2;

  const addDistrict = (
    kind: DistrictKind,
    index: number,
    center: { x: number; z: number },
    radius: number,
    flattenOffsetRows: number,
    rotation = random() * Math.PI * 2
  ): BattleRoyalDistrict => {
    const id = `${kind}_${index}`;
    const clamped = clampPointToBoundary(center, boundary, Math.max(5, radius * 0.22));
    const district: BattleRoyalDistrict = {
      id,
      kind,
      center: { x: clamped.x, y: 0, z: clamped.z },
      radius,
      influenceRadius: radius * (kind === 'open_field' || kind === 'wildland' ? 1.55 : 1.3),
      flattenRows: BASE_TERRAIN_ROWS + flattenOffsetRows,
      rotation,
      roadNodeId: `${id}_node`,
    };
    districts.push(district);
    reserved.push({ x: district.center.x, z: district.center.z, radius: district.influenceRadius });
    return district;
  };

  const placeDistrict = (
    kind: DistrictKind,
    index: number,
    radial: { min: number; max: number },
    radiusRange: { min: number; max: number },
    flattenOffsetRows: number,
    angleHint?: number
  ): BattleRoyalDistrict => {
    let fallback: { center: { x: number; z: number }; radius: number; rotation: number } | null = null;
    for (let attempt = 0; attempt < 96; attempt++) {
      const angle = angleHint === undefined
        ? random() * Math.PI * 2
        : angleHint + lerp(-0.36, 0.36, random());
      const radius = lerp(radiusRange.min, radiusRange.max, random());
      const distance = lerp(radial.min, radial.max, random());
      const center = clampPointToBoundary(
        { x: Math.cos(angle) * distance, z: Math.sin(angle) * distance },
        boundary,
        Math.max(5, radius * 0.24)
      );
      const rotation = angle + Math.PI * 0.5 + lerp(-0.28, 0.28, random());
      fallback = { center, radius, rotation };
      if (isClearOfCircles(center, reserved, radius, kind === 'open_field' || kind === 'wildland' ? 0.42 : 0.62)) {
        return addDistrict(kind, index, center, radius, flattenOffsetRows, rotation);
      }
    }

    const fallbackDistrict = fallback ?? {
      center: sampleAnnulusPoint(random, radial.min, radial.max),
      radius: lerp(radiusRange.min, radiusRange.max, random()),
      rotation: random() * Math.PI * 2,
    };
    return addDistrict(kind, index, fallbackDistrict.center, fallbackDistrict.radius, flattenOffsetRows, fallbackDistrict.rotation);
  };

  addDistrict(
    'city_core',
    1,
    sampleAnnulusPoint(random, 0, 9 * scale),
    lerp(32, 38, random()) * scale,
    6,
    random() * Math.PI * 2
  );

  for (let index = 0; index < 3; index++) {
    placeDistrict(
      'town',
      index + 1,
      { min: baseRadius * 0.34, max: baseRadius * 0.6 },
      { min: 23 * scale, max: 30 * scale },
      3,
      angleOffset + (index / 3) * Math.PI * 2
    );
  }

  placeDistrict(
    'industrial',
    1,
    { min: baseRadius * 0.48, max: baseRadius * 0.72 },
    { min: 28 * scale, max: 35 * scale },
    2,
    angleOffset + Math.PI * 0.72
  );

  for (let index = 0; index < 2; index++) {
    placeDistrict(
      'hamlet',
      index + 1,
      { min: baseRadius * 0.28, max: baseRadius * 0.7 },
      { min: 15 * scale, max: 20 * scale },
      1,
      angleOffset + Math.PI * (0.45 + index)
    );
  }

  for (let index = 0; index < 3; index++) {
    placeDistrict(
      'outpost',
      index + 1,
      { min: baseRadius * 0.68, max: baseRadius * 0.9 },
      { min: 15 * scale, max: 21 * scale },
      1,
      angleOffset + Math.PI * (0.2 + index * 0.66)
    );
  }

  for (let index = 0; index < 4; index++) {
    placeDistrict(
      'open_field',
      index + 1,
      { min: baseRadius * 0.24, max: baseRadius * 0.82 },
      { min: 24 * scale, max: 36 * scale },
      random() > 0.5 ? 1 : 0
    );
  }

  for (let index = 0; index < 4; index++) {
    placeDistrict(
      'wildland',
      index + 1,
      { min: baseRadius * 0.42, max: baseRadius * 0.9 },
      { min: 22 * scale, max: 34 * scale },
      0
    );
  }

  return districts;
}

function createRoadCurvePoints(
  seed: number,
  boundary: BoundaryPoint[],
  from: { x: number; z: number },
  to: { x: number; z: number },
  salt: number
): Vec3[] {
  const distance = distance2D(from, to);
  if (distance <= 18) {
    return [
      { x: from.x, y: 0, z: from.z },
      { x: to.x, y: 0, z: to.z },
    ];
  }

  const direction = normalize2D({ x: to.x - from.x, z: to.z - from.z });
  const normal = { x: -direction.z, z: direction.x };
  const bendA = (unitFromSeed(seed ^ Math.imul(salt + 1, 0x45d9f3b)) - 0.5) * Math.min(34, distance * 0.22);
  const bendB = (unitFromSeed(seed ^ Math.imul(salt + 3, 0x119de1f3)) - 0.5) * Math.min(26, distance * 0.18);
  const pointA = clampPointToBoundary(add2D(lerpPoint2D(from, to, 0.34), normal, bendA), boundary, 3.5);
  const pointB = clampPointToBoundary(add2D(lerpPoint2D(from, to, 0.68), normal, bendB), boundary, 3.5);

  return [
    { x: from.x, y: 0, z: from.z },
    { x: pointA.x, y: 0, z: pointA.z },
    { x: pointB.x, y: 0, z: pointB.z },
    { x: to.x, y: 0, z: to.z },
  ];
}

function createRoadNetwork(input: {
  seed: number;
  boundary: BoundaryPoint[];
  spawns: TeamMap<SpawnCluster>;
  districts: readonly BattleRoyalDistrict[];
}): { roadNodes: RoadNode[]; roadSegments: RoadSegment[] } {
  const roadNodes: RoadNode[] = [];
  const roadSegments: RoadSegment[] = [];
  const segmentKeys = new Set<string>();
  const city = input.districts.find((district) => district.kind === 'city_core') ?? input.districts[0];
  const settlementDistricts = input.districts.filter((district) => (
    district.kind !== 'open_field' && district.kind !== 'wildland'
  ));
  const majorRingDistricts = settlementDistricts
    .filter((district) => district.kind !== 'city_core')
    .sort((a, b) => Math.atan2(a.center.z, a.center.x) - Math.atan2(b.center.z, b.center.x));

  for (const district of input.districts) {
    roadNodes.push({
      id: district.roadNodeId,
      kind: 'district',
      position: district.center,
      districtId: district.id,
      tags: [district.kind, 'district'],
    });
  }

  for (const [team, spawn] of Object.entries(input.spawns)) {
    roadNodes.push({
      id: `${team}_spawn_node`,
      kind: 'spawn',
      position: spawn.center,
      team: team as Team,
      tags: ['spawn', 'outer_spawn'],
    });
  }

  const addSegment = (
    fromNodeId: string,
    toNodeId: string,
    laneId: string,
    kind: RoadSegmentKind,
    width: number,
    tags: string[],
    traversal: RouteGraphEdge['traversal'] = 'ground'
  ): void => {
    if (fromNodeId === toNodeId) return;
    const key = [laneId, fromNodeId, toNodeId].sort().join(':');
    if (segmentKeys.has(key)) return;
    const from = roadNodes.find((node) => node.id === fromNodeId);
    const to = roadNodes.find((node) => node.id === toNodeId);
    if (!from || !to) return;
    segmentKeys.add(key);
    const index = roadSegments.length + 1;
    roadSegments.push({
      id: `road_${index}_${kind}`,
      kind,
      laneId,
      fromNodeId,
      toNodeId,
      points: createRoadCurvePoints(input.seed, input.boundary, from.position, to.position, index),
      width,
      tags,
      traversal,
    });
  };

  if (city) {
    for (const district of settlementDistricts) {
      if (district.id === city.id) continue;
      const laneId = district.kind === 'outpost' || district.kind === 'hamlet'
        ? ROAD_LANE_OUTER
        : ROAD_LANE_PRIMARY;
      addSegment(
        city.roadNodeId,
        district.roadNodeId,
        laneId,
        district.kind === 'outpost' || district.kind === 'hamlet' ? 'spur' : 'primary',
        district.kind === 'industrial' ? 10 : 8.5,
        ['district_connector', district.kind]
      );
    }
  }

  for (let index = 0; index < majorRingDistricts.length; index++) {
    const current = majorRingDistricts[index];
    const next = majorRingDistricts[(index + 1) % majorRingDistricts.length];
    addSegment(
      current.roadNodeId,
      next.roadNodeId,
      ROAD_LANE_LOOP,
      'loop',
      7.5,
      ['settlement_loop', current.kind, next.kind]
    );
  }

  for (const [team, spawn] of Object.entries(input.spawns)) {
    const nearestDistrict = majorRingDistricts.reduce<BattleRoyalDistrict | null>((nearest, district) => {
      if (!nearest) return district;
      return distance2D(spawn.center, district.center) < distance2D(spawn.center, nearest.center)
        ? district
        : nearest;
    }, null);
    if (!nearestDistrict) continue;
    addSegment(
      `${team}_spawn_node`,
      nearestDistrict.roadNodeId,
      ROAD_LANE_OUTER,
      'spur',
      8,
      ['spawn_route', nearestDistrict.kind]
    );
  }

  for (const district of input.districts.filter((candidate) => (
    candidate.kind === 'open_field' || candidate.kind === 'wildland'
  ))) {
    const nearestSettlement = settlementDistricts.reduce<BattleRoyalDistrict | null>((nearest, settlement) => {
      if (!nearest) return settlement;
      return distance2D(district.center, settlement.center) < distance2D(district.center, nearest.center)
        ? settlement
        : nearest;
    }, null);
    if (!nearestSettlement) continue;
    addSegment(
      district.roadNodeId,
      nearestSettlement.roadNodeId,
      district.kind === 'open_field' ? ROAD_LANE_SETTLEMENT : ROAD_LANE_WILD,
      district.kind === 'open_field' ? 'spur' : 'wild',
      district.kind === 'open_field' ? 6.8 : 5.6,
      ['natural_route', district.kind, nearestSettlement.kind]
    );
  }

  return { roadNodes, roadSegments };
}

function createDistrictFlattenZones(districts: readonly BattleRoyalDistrict[]): FlattenZone[] {
  return districts.map((district) => {
    const strengthByKind: Record<DistrictKind, number> = {
      city_core: 1,
      town: 0.98,
      industrial: 0.96,
      hamlet: 0.94,
      outpost: 0.96,
      open_field: 0.42,
      wildland: 0.22,
    };
    return {
      center: district.center,
      radius: district.influenceRadius,
      rows: district.flattenRows,
      strength: strengthByKind[district.kind],
      maxLowerRows: district.kind === 'open_field' || district.kind === 'wildland'
        ? 4
        : district.kind === 'city_core'
          ? 22
          : district.kind === 'industrial' || district.kind === 'town'
            ? 18
            : 14,
    };
  });
}

function createRoadFlattenZones(roadSegments: readonly RoadSegment[]): FlattenZone[] {
  const zones: FlattenZone[] = [];
  for (const segment of roadSegments) {
    for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex++) {
      const start = segment.points[pointIndex - 1];
      const end = segment.points[pointIndex];
      const distance = distance2D(start, end);
      const samples = Math.max(1, Math.ceil(distance / ROAD_FLATTEN_SAMPLE_SPACING));
      for (let sample = 0; sample <= samples; sample++) {
        const t = sample / samples;
        const point = lerpPoint2D(start, end, t);
        zones.push({
          center: point,
          radius: segment.width * 0.76 + 3,
          rows: BASE_TERRAIN_ROWS + (segment.kind === 'primary' ? 2 : segment.kind === 'loop' ? 1 : 0),
          strength: segment.kind === 'wild' ? 0.42 : segment.kind === 'primary' ? 0.78 : 0.64,
          maxLowerRows: segment.kind === 'primary' ? 14 : segment.kind === 'wild' ? 8 : 11,
        });
      }
    }
  }
  return zones;
}

function createTerrainFeatures(
  seed: number,
  boundary: BoundaryPoint[],
  spawns: TeamMap<SpawnCluster>,
  districts: readonly BattleRoyalDistrict[],
  profile: BattleRoyalSizeProfile
): TerrainFeature[] {
  const random = mulberry32(seed ^ 0x7e44a11);
  const baseRadius = profile.baseRadius;
  const scale = profile.scale;
  const protectedPositions = [
    ...getSpawnProtectedPositions(spawns).map((position) => ({ ...position, radius: 16 })),
    ...districts
      .filter((district) => district.kind !== 'wildland')
      .map((district) => ({ x: district.center.x, z: district.center.z, radius: district.radius * 0.68 })),
  ];
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
      if (!isClearOfCircles(center, protectedPositions, clearance, 0.55)) continue;
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
        noiseSeed: hashSeed(seed ^ Math.imul(index + 1, kind === 'mountain' ? 0x45d9f3b : 0x27d4eb2d)),
      });
      return;
    }
  };
  const addOcclusionRidge = (
    id: string,
    center: { x: number; z: number },
    radiusX: number,
    radiusZ: number,
    rotation: number,
    amplitudeRows: number,
    salt: number
  ): void => {
    const clamped = clampPointToBoundary(center, boundary, 8);
    features.push({
      id,
      kind: 'ridge',
      center: clamped,
      radiusX,
      radiusZ,
      rotation,
      amplitudeRows,
      noiseSeed: hashSeed(seed ^ salt),
    });
  };

  for (let index = 0; index < 6; index++) {
    addFeature(
      'mountain',
      index,
      { min: baseRadius * 0.28, max: baseRadius * 0.9 },
      { min: 32 * scale, max: 58 * scale },
      { min: 42 * scale, max: 78 * scale },
      { min: 9, max: 16 },
      18
    );
  }

  for (let index = 0; index < 6; index++) {
    addFeature(
      'ridge',
      index,
      { min: baseRadius * 0.18, max: baseRadius * 0.86 },
      { min: 58 * scale, max: 96 * scale },
      { min: 18 * scale, max: 30 * scale },
      { min: 7, max: 12 },
      14,
      random() > 0.5 ? 0 : Math.PI * 0.5
    );
  }

  const occlusionPhase = random() * Math.PI * 2;
  for (let index = 0; index < 6; index++) {
    const angle = occlusionPhase + (index / 6) * Math.PI * 2;
    const radialDistance = baseRadius * lerp(0.36, 0.54, random());
    addOcclusionRidge(
      `sector_screen_${index + 1}`,
      {
        x: Math.cos(angle) * radialDistance,
        z: Math.sin(angle) * radialDistance,
      },
      lerp(112 * scale, 156 * scale, random()),
      lerp(22 * scale, 34 * scale, random()),
      angle,
      lerp(30, 44, random()),
      Math.imul(index + 11, 0x5bd1e995)
    );
  }

  for (let index = 0; index < 6; index++) {
    const angle = occlusionPhase + Math.PI / 6 + (index / 6) * Math.PI * 2;
    const radialDistance = baseRadius * lerp(0.52, 0.76, random());
    addOcclusionRidge(
      `horizon_break_${index + 1}`,
      {
        x: Math.cos(angle) * radialDistance,
        z: Math.sin(angle) * radialDistance,
      },
      lerp(98 * scale, 132 * scale, random()),
      lerp(20 * scale, 32 * scale, random()),
      angle + Math.PI * 0.5,
      lerp(28, 40, random()),
      Math.imul(index + 29, 0x27d4eb2d)
    );
  }

  for (let index = 0; index < 8; index++) {
    const angle = occlusionPhase + Math.PI / 8 + (index / 8) * Math.PI * 2;
    addOcclusionRidge(
      `midfield_lip_${index + 1}`,
      {
        x: Math.cos(angle) * baseRadius * lerp(0.24, 0.36, random()),
        z: Math.sin(angle) * baseRadius * lerp(0.24, 0.36, random()),
      },
      lerp(68 * scale, 96 * scale, random()),
      lerp(18 * scale, 28 * scale, random()),
      angle + Math.PI * 0.5,
      lerp(21, 32, random()),
      Math.imul(index + 37, 0x85ebca6b)
    );
  }

  const districtPairs = districts
    .flatMap((district, index, allDistricts) => (
      allDistricts.slice(index + 1).map((other) => ({
        a: district,
        b: other,
        distance: distance2D(district.center, other.center),
      }))
    ))
    .filter((pair) => pair.distance >= baseRadius * 0.62)
    .sort((a, b) => b.distance - a.distance);
  for (let index = 0; index < Math.min(38, districtPairs.length); index++) {
    const { a, b, distance } = districtPairs[index];
    const openAreaPair = a.kind === 'wildland' || a.kind === 'open_field' ||
      b.kind === 'wildland' || b.kind === 'open_field';
    const midpoint = lerpPoint2D(a.center, b.center, openAreaPair ? lerp(0.36, 0.64, random()) : lerp(0.43, 0.57, random()));
    const direction = normalize2D({ x: b.center.x - a.center.x, z: b.center.z - a.center.z });
    const normal = { x: -direction.z, z: direction.x };
    const offsetMidpoint = add2D(midpoint, normal, openAreaPair ? lerp(-22, 22, random()) : lerp(-14, 14, random()));
    addOcclusionRidge(
      `district_screen_${index + 1}`,
      offsetMidpoint,
      clamp(distance * lerp(openAreaPair ? 0.2 : 0.18, openAreaPair ? 0.3 : 0.26, random()), 52 * scale, (openAreaPair ? 104 : 88) * scale),
      lerp((openAreaPair ? 22 : 18) * scale, (openAreaPair ? 36 : 30) * scale, random()),
      Math.atan2(normal.z, normal.x),
      lerp(openAreaPair ? 30 : 25, openAreaPair ? 44 : 38, random()),
      Math.imul(index + 73, 0xc2b2ae35)
    );
  }

  for (let index = 0; index < 4; index++) {
    const angle = occlusionPhase + Math.PI / 4 + (index / 4) * Math.PI * 2;
    addOcclusionRidge(
      `outer_bowl_${index + 1}`,
      {
        x: Math.cos(angle) * baseRadius * 0.82,
        z: Math.sin(angle) * baseRadius * 0.82,
      },
      lerp(76 * scale, 104 * scale, random()),
      lerp(20 * scale, 32 * scale, random()),
      angle + Math.PI * 0.5,
      lerp(26, 38, random()),
      Math.imul(index + 43, 0x165667b1)
    );
  }

  const orderedSpawns = Object.values(spawns)
    .sort((a, b) => Math.atan2(a.center.z, a.center.x) - Math.atan2(b.center.z, b.center.x));
  for (let index = 0; index < orderedSpawns.length; index++) {
    const current = orderedSpawns[index];
    const next = orderedSpawns[(index + 1) % orderedSpawns.length];
    if (!current || !next) continue;
    const midpoint = {
      x: (current.center.x + next.center.x) * 0.5,
      z: (current.center.z + next.center.z) * 0.5,
    };
    const radialAngle = Math.atan2(midpoint.z, midpoint.x);
    addOcclusionRidge(
      `spawn_separator_${index + 1}`,
      midpoint,
      lerp(48 * scale, 68 * scale, random()),
      lerp(16 * scale, 24 * scale, random()),
      radialAngle,
      lerp(15, 25, random()),
      Math.imul(index + 61, 0x9e3779b1)
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
    clearance: number;
  }
> = {
  highrise: {
    radius: { min: 6.5, max: 10 },
    heightRows: { min: 16, max: 24 },
    flattenOffsetRows: { min: 5, max: 9 },
    clearance: 20,
  },
  compound: {
    radius: { min: 10, max: 15 },
    heightRows: { min: 10, max: 16 },
    flattenOffsetRows: { min: 3, max: 6 },
    clearance: 22,
  },
  hangar: {
    radius: { min: 9, max: 14 },
    heightRows: { min: 8, max: 14 },
    flattenOffsetRows: { min: 1, max: 4 },
    clearance: 20,
  },
  relay: {
    radius: { min: 5.5, max: 8.5 },
    heightRows: { min: 10, max: 16 },
    flattenOffsetRows: { min: 3, max: 7 },
    clearance: 17,
  },
  watchtower: {
    radius: { min: 5.5, max: 8 },
    heightRows: { min: 8, max: 12 },
    flattenOffsetRows: { min: 2, max: 5 },
    clearance: 16,
  },
  bunker: {
    radius: { min: 8, max: 12 },
    heightRows: { min: 8, max: 15 },
    flattenOffsetRows: { min: 1, max: 4 },
    clearance: 18,
  },
  depot: {
    radius: { min: 6, max: 10 },
    heightRows: { min: 6, max: 12 },
    flattenOffsetRows: { min: 0, max: 3 },
    clearance: 16,
  },
};

const DISTRICT_POI_PLANS: Record<DistrictKind, Array<Exclude<PoiRole, 'citadel'>>> = {
  city_core: ['highrise', 'highrise', 'highrise', 'compound', 'compound', 'relay', 'compound', 'depot', 'watchtower', 'bunker'],
  town: ['compound', 'compound', 'depot', 'depot', 'watchtower', 'bunker'],
  industrial: ['hangar', 'hangar', 'depot', 'depot', 'relay', 'bunker', 'compound'],
  hamlet: ['depot', 'bunker', 'compound'],
  outpost: ['watchtower', 'watchtower', 'bunker', 'relay', 'depot'],
  open_field: ['watchtower', 'depot'],
  wildland: ['watchtower', 'bunker'],
};

const LOCATION_NAME_PARTS: Record<DistrictKind, { prefixes: string[]; suffixes: string[]; kind: MapNamedLocationKind; priority: number }> = {
  city_core: {
    prefixes: ['Apex', 'Crown', 'Summit', 'Atlas', 'Meridian', 'Citadel'],
    suffixes: ['City', 'Core', 'Crossing', 'Market', 'Heights', 'Plaza'],
    kind: 'city',
    priority: 0,
  },
  town: {
    prefixes: ['Stone', 'Sun', 'Ember', 'Moss', 'Drift', 'Copper', 'Signal'],
    suffixes: ['Town', 'Commons', 'Village', 'Terrace', 'Junction', 'Row'],
    kind: 'town',
    priority: 1,
  },
  industrial: {
    prefixes: ['Iron', 'Cinder', 'Foundry', 'Rust', 'Hammer', 'Rail'],
    suffixes: ['Works', 'Yard', 'Array', 'Depot', 'Plant', 'Basin'],
    kind: 'industrial',
    priority: 1,
  },
  hamlet: {
    prefixes: ['Low', 'Green', 'Hollow', 'Pine', 'Briar', 'Old'],
    suffixes: ['Hamlet', 'Houses', 'Haven', 'Steps', 'Fold', 'Rest'],
    kind: 'hamlet',
    priority: 2,
  },
  outpost: {
    prefixes: ['North', 'West', 'High', 'Outer', 'Beacon', 'Ridge'],
    suffixes: ['Watch', 'Post', 'Station', 'Hold', 'Gate', 'Lookout'],
    kind: 'outpost',
    priority: 2,
  },
  open_field: {
    prefixes: ['Broken', 'Clear', 'Wind', 'White', 'Quiet', 'Long'],
    suffixes: ['Flats', 'Field', 'Meadow', 'Shelf', 'Basin', 'Run'],
    kind: 'open_area',
    priority: 3,
  },
  wildland: {
    prefixes: ['Echo', 'Red', 'Black', 'Frost', 'Ash', 'Wild'],
    suffixes: ['Wilds', 'Pines', 'Grove', 'Ridge', 'Thicket', 'Reach'],
    kind: 'wildland',
    priority: 3,
  },
};

function createPois(
  seed: number,
  boundary: BoundaryPoint[],
  spawns: TeamMap<SpawnCluster>,
  districts: readonly BattleRoyalDistrict[]
): { pois: BattleRoyalPoi[]; flattenZones: FlattenZone[] } {
  const random = mulberry32(seed ^ 0xc17ade1);
  const protectedPositions = getSpawnProtectedPositions(spawns).map((position) => ({
    x: position.x,
    z: position.z,
    radius: 16,
  }));
  const cityDistrict = districts.find((district) => district.kind === 'city_core') ?? districts[0];
  const center = cityDistrict?.center ?? { x: 0, y: 0, z: 0 };
  const pois: BattleRoyalPoi[] = [{
    id: 'center_citadel',
    role: 'citadel',
    position: { x: center.x, y: 0, z: center.z },
    radius: 19,
    heightRows: 26,
    flattenRows: BASE_TERRAIN_ROWS + 6,
    rotation: cityDistrict?.rotation ?? random() * Math.PI * 2,
    variant: Math.floor(random() * 4),
    districtId: cityDistrict?.id,
  }];
  const flattenZones: FlattenZone[] = [{
    center,
    radius: 28,
    rows: BASE_TERRAIN_ROWS + 5,
    strength: 0.95,
    maxLowerRows: 18,
  }];
  protectedPositions.push({ x: center.x, z: center.z, radius: 24 });

  let id = 0;
  const placePoi = (district: BattleRoyalDistrict, role: Exclude<PoiRole, 'citadel'>, slotIndex: number): void => {
    const spec = POI_ROLE_SPECS[role];
    let selected: BattleRoyalPoi | null = null;
    let fallback: BattleRoyalPoi | null = null;
    for (let attempt = 0; attempt < 72; attempt++) {
      const angle = district.rotation + (slotIndex / Math.max(1, DISTRICT_POI_PLANS[district.kind].length)) * Math.PI * 2 +
        lerp(-0.42, 0.42, random()) + attempt * 0.19;
      const distance = lerp(district.radius * 0.24, district.radius * 0.78, random());
      const point = {
        x: district.center.x + Math.cos(angle) * distance,
        z: district.center.z + Math.sin(angle) * distance,
      };
      const clampedPoint = clampPointToBoundary(point, boundary, 3.5);
      const radius = lerp(spec.radius.min, spec.radius.max, random());
      let heightRows = Math.round(lerp(spec.heightRows.min, spec.heightRows.max, random()));
      if (district.kind === 'outpost') {
        if (role === 'watchtower') heightRows = Math.min(heightRows, 11);
        if (role === 'relay') heightRows = Math.min(heightRows, 14);
      }
      if (district.kind === 'hamlet') {
        if (role === 'watchtower') heightRows = Math.min(heightRows, 12);
        if (role === 'relay') heightRows = Math.min(heightRows, 14);
      }
      const candidate: BattleRoyalPoi = {
        id: `${district.id}_${role}_${++id}`,
        role,
        position: { x: clampedPoint.x, y: 0, z: clampedPoint.z },
        radius,
        heightRows,
        flattenRows: BASE_TERRAIN_ROWS + Math.round(lerp(spec.flattenOffsetRows.min, spec.flattenOffsetRows.max, random())),
        rotation: district.rotation + lerp(-0.28, 0.28, random()),
        variant: Math.floor(random() * 5),
        districtId: district.id,
      };
      fallback = candidate;
      if (isClearOfCircles(candidate.position, protectedPositions, candidate.radius + spec.clearance * 0.34, 0.58)) {
        selected = candidate;
        break;
      }
    }

    const poi = selected ?? fallback;
    if (!poi) return;
    pois.push(poi);
    protectedPositions.push({ x: poi.position.x, z: poi.position.z, radius: poi.radius + 3 });
    flattenZones.push({
      center: poi.position,
      radius: poi.radius + POI_FLATTEN_RADIUS,
      rows: poi.flattenRows,
      strength: poi.role === 'highrise' || poi.role === 'compound' ? 0.98 : 0.94,
      maxLowerRows: 16,
    });
  };

  for (const district of districts) {
    const plan = DISTRICT_POI_PLANS[district.kind];
    plan.forEach((role, index) => placePoi(district, role, index + 1));
  }

  return { pois, flattenZones };
}

function createPowerups(
  seed: number,
  boundary: BoundaryPoint[],
  spawns: TeamMap<SpawnCluster>,
  districts: readonly BattleRoyalDistrict[],
  roadSegments: readonly RoadSegment[],
  pois: readonly BattleRoyalPoi[],
  profile: BattleRoyalSizeProfile
): { powerups: MapPowerupPickup[]; flattenZones: FlattenZone[] } {
  const random = mulberry32(seed ^ 0x9f2d);
  const powerups: MapPowerupPickup[] = [];
  const flattenZones: FlattenZone[] = [];
  const protectedPositions = [
    ...getSpawnProtectedPositions(spawns).map((position) => ({ x: position.x, z: position.z, radius: 8.5 })),
    ...pois.map((poi) => ({ x: poi.position.x, z: poi.position.z, radius: poi.radius + 3 })),
  ];
  const roadAnchors: PickupAnchor[] = roadSegments.flatMap((segment) => {
    const anchors: PickupAnchor[] = [];
    for (let index = 1; index < segment.points.length; index++) {
      const start = segment.points[index - 1];
      const end = segment.points[index];
      if (distance2D(start, end) < 18) continue;
      const point = lerpPoint2D(start, end, 0.5);
      anchors.push({
        position: { x: point.x, y: 0, z: point.z },
        laneId: segment.laneId,
        radius: segment.width + 5,
      });
    }
    return anchors;
  });
  const settlementAnchors: PickupAnchor[] = districts
    .filter((district) => district.kind !== 'wildland')
    .map((district) => ({
      position: district.center,
      laneId: district.kind === 'city_core' ? ROAD_LANE_PRIMARY : ROAD_LANE_SETTLEMENT,
      routeNodeId: district.roadNodeId,
      kind: district.kind,
      radius: district.radius,
    }));
  const wildAnchors: PickupAnchor[] = districts
    .filter((district) => district.kind === 'wildland' || district.kind === 'open_field')
    .map((district) => ({
      position: district.center,
      laneId: district.kind === 'wildland' ? ROAD_LANE_WILD : ROAD_LANE_SETTLEMENT,
      routeNodeId: district.roadNodeId,
      kind: district.kind,
      radius: district.radius,
    }));

  let id = 0;
  const placePickup = (
    kind: MapPowerupPickup['kind'],
    strategicRole: MapPowerupPickup['strategicRole'],
    anchor: PickupAnchor,
    jitterRadius: { min: number; max: number }
  ): void => {
    let position: Vec3 | null = null;
    for (let attempt = 0; attempt < 96; attempt++) {
      const offset = sampleAnnulusPoint(random, jitterRadius.min, jitterRadius.max);
      const point = clampPointToBoundary(
        {
          x: anchor.position.x + offset.x,
          z: anchor.position.z + offset.z,
        },
        boundary,
        3
      );
      position = { x: point.x, y: 0, z: point.z };
      if (isClearOfCircles(point, protectedPositions, kind === 'health_pack' ? 6.6 : 8.4, 0.52)) break;
    }
    if (position === null) return;
    protectedPositions.push({ x: position.x, z: position.z, radius: kind === 'health_pack' ? 5.8 : 7.2 });
    flattenZones.push({
      center: position,
      radius: POWERUP_FLATTEN_RADIUS,
      rows: BASE_TERRAIN_ROWS + (strategicRole === 'midfield_contest' ? 3 : strategicRole === 'route_bridge' ? 1 : 0),
      strength: 0.7,
      maxLowerRows: 3,
    });
    powerups.push({
      id: `br_pickup_${++id}`,
      kind,
      position,
      radius: POWERUP_PICKUP_RADIUS,
      respawnSeconds: POWERUP_RESPAWN_SECONDS,
      strategicRole,
      laneId: anchor.laneId,
      routeNodeId: anchor.routeNodeId,
    });
  };

  const city = settlementAnchors.find((anchor) => anchor.kind === 'city_core') ?? settlementAnchors[0];
  for (let index = 0; index < 4 && city; index++) {
    const angle = (index / 4) * Math.PI * 2 + random() * 0.2;
      const anchor = {
        ...city,
        position: {
        x: city.position.x + Math.cos(angle) * 11,
        y: 0,
        z: city.position.z + Math.sin(angle) * 11,
      },
    };
    placePickup('powerup', 'midfield_contest', anchor, { min: 0, max: 4.2 });
  }

  let anchorIndex = 0;
  while (powerups.filter((pickup) => pickup.kind === 'powerup').length < profile.strategicPowerupCount) {
    const anchors = [
      ...settlementAnchors.filter((anchor) => anchor.kind !== 'city_core'),
      ...wildAnchors,
      ...roadAnchors,
    ];
    const anchor = anchors[anchorIndex % Math.max(1, anchors.length)] ?? city;
    if (!anchor) break;
    const role: MapPowerupPickup['strategicRole'] = anchor.laneId === ROAD_LANE_WILD
      ? 'flank_reward'
      : anchor.laneId === ROAD_LANE_SETTLEMENT
        ? 'route_bridge'
        : 'route_bridge';
    placePickup('powerup', role, anchor, { min: 4, max: Math.max(8, Math.min(18, anchor.radius ?? 12)) });
    anchorIndex++;
  }

  anchorIndex = 0;
  while (powerups.filter((pickup) => pickup.kind === 'health_pack').length < profile.healthPackCount) {
    const anchors = [
      ...pois.filter((poi) => poi.role !== 'citadel').map((poi) => ({
        position: poi.position,
        laneId: ROAD_LANE_SETTLEMENT,
        routeNodeId: poi.districtId ? `${poi.districtId}_node` : undefined,
        radius: poi.radius + 5,
      })),
      ...roadAnchors,
      ...wildAnchors,
      ...settlementAnchors,
    ];
    const anchor = anchors[anchorIndex % Math.max(1, anchors.length)] ?? city;
    if (!anchor) break;
    const role: MapPowerupPickup['strategicRole'] = anchor.laneId === ROAD_LANE_WILD
      ? 'flank_reward'
      : random() > 0.74
          ? 'defensive_reset'
          : 'route_bridge';
    placePickup('health_pack', role, anchor, { min: 3, max: Math.max(7, Math.min(15, anchor.radius ?? 10)) });
    anchorIndex++;
  }

  return { powerups, flattenZones };
}

function createLocationName(seed: number, district: BattleRoyalDistrict, index: number, usedNames: Set<string>): string {
  const parts = LOCATION_NAME_PARTS[district.kind];
  const nameSeed = hashSeed(seed ^ Math.imul(index + 1, 0x632be59b));
  const prefix = parts.prefixes[nameSeed % parts.prefixes.length];
  const suffix = parts.suffixes[(nameSeed >>> 8) % parts.suffixes.length];
  let name = `${prefix} ${suffix}`;
  if (usedNames.has(name)) {
    name = `${prefix} ${suffix} ${index + 1}`;
  }
  usedNames.add(name);
  return name;
}

function createNamedLocations(seed: number, layout: BattleRoyalLayout): MapNamedLocation[] {
  const usedNames = new Set<string>();
  return layout.districts
    .map((district, index): MapNamedLocation => {
      const parts = LOCATION_NAME_PARTS[district.kind];
      return {
        id: district.id,
        name: createLocationName(seed, district, index, usedNames),
        kind: parts.kind,
        position: district.center,
        radius: district.radius,
        priority: parts.priority,
        tags: [district.kind, 'district', district.roadNodeId],
      };
    })
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
}

function createCoverPieces(
  seed: number,
  boundary: BoundaryPoint[],
  spawns: TeamMap<SpawnCluster>,
  districts: readonly BattleRoyalDistrict[],
  roadSegments: readonly RoadSegment[],
  pois: readonly BattleRoyalPoi[]
): CoverPiece[] {
  const random = mulberry32(seed ^ 0xc0a7e);
  const pieces: CoverPiece[] = [];
  const protectedCircles = [
    ...getSpawnProtectedPositions(spawns).map((position) => ({ x: position.x, z: position.z, radius: 7.5 })),
    ...pois.map((poi) => ({ x: poi.position.x, z: poi.position.z, radius: poi.radius + 2.5 })),
  ];
  const addCover = (
    role: CoverRole,
    position: { x: number; z: number },
    halfExtents: { x: number; z: number },
    heightRows: number,
    material: CoverMaterial,
    rotation: number,
    clearance = 2.8
  ): boolean => {
    const point = clampPointToBoundary(position, boundary, 2.5);
    if (!isClearOfCircles(point, protectedCircles, clearance, 0.32)) return false;
    protectedCircles.push({
      x: point.x,
      z: point.z,
      radius: Math.max(halfExtents.x, halfExtents.z) + clearance,
    });
    pieces.push({
      id: `${role}_cover_${pieces.length + 1}`,
      role,
      position: point,
      halfExtents,
      heightRows,
      material,
      rotation,
    });
    return true;
  };

  for (const district of districts) {
    const coverCountByKind: Record<DistrictKind, number> = {
      city_core: 26,
      town: 16,
      industrial: 22,
      hamlet: 8,
      outpost: 11,
      open_field: 8,
      wildland: 12,
    };
    const coverCount = coverCountByKind[district.kind];
    for (let index = 0; index < coverCount; index++) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const role: CoverRole = district.kind === 'open_field' || district.kind === 'wildland'
          ? 'natural'
          : 'settlement';
        const point = sampleDistrictPoint(
          random,
          district,
          district.kind === 'city_core' ? 0.25 : 0.12,
          district.kind === 'wildland' ? 1.16 : 0.98
        );
        const materialRoll = random();
        const material: CoverMaterial = role === 'natural'
          ? 'terrain'
          : materialRoll > 0.78
            ? 'glass'
            : materialRoll > 0.46
              ? 'metal'
              : 'terrain';
        const scale = district.kind === 'industrial' ? 1.25 : district.kind === 'city_core' ? 1.05 : 1;
        const placed = addCover(
          role,
          point,
          {
            x: lerp(1.2, 3.8, random()) * scale,
            z: lerp(0.45, 1.45, random()) * (role === 'natural' ? 1.2 : 1),
          },
          Math.floor(lerp(role === 'natural' ? 2 : 3, district.kind === 'city_core' ? 8 : 6, random())),
          material,
          district.rotation + random() * Math.PI,
          role === 'natural' ? 2.4 : 1.6
        );
        if (placed) break;
      }
    }
  }

  for (const segment of roadSegments) {
    for (let pointIndex = 1; pointIndex < segment.points.length; pointIndex++) {
      const start = segment.points[pointIndex - 1];
      const end = segment.points[pointIndex];
      const length = distance2D(start, end);
      const samples = Math.max(1, Math.floor(length / 32));
      const direction = normalize2D({ x: end.x - start.x, z: end.z - start.z });
      const normal = { x: -direction.z, z: direction.x };
      for (let sample = 0; sample < samples; sample++) {
        if (random() < (segment.kind === 'primary' ? 0.22 : 0.34)) continue;
        const t = (sample + 0.5 + random() * 0.24) / samples;
        const center = lerpPoint2D(start, end, clamp(t, 0, 1));
        const side = random() > 0.5 ? 1 : -1;
        const offset = segment.width * lerp(0.72, 1.4, random()) * side;
        const materialRoll = random();
        addCover(
          'roadside',
          add2D(center, normal, offset),
          { x: lerp(1.4, 3.8, random()), z: lerp(0.6, 1.7, random()) },
          Math.floor(lerp(2, segment.kind === 'primary' ? 6 : 5, random())),
          materialRoll > 0.72 ? 'metal' : 'terrain',
          Math.atan2(direction.z, direction.x) + lerp(-0.4, 0.4, random()),
          2.4
        );
      }
    }
  }

  for (const spawn of Object.values(spawns)) {
    const facing = spawn.facing;
    const tangent = { x: -facing.z, z: facing.x };
    for (const side of [-1, 1]) {
      addCover(
        'spawn_shelter',
        {
          x: spawn.center.x + facing.x * 5.4 + tangent.x * side * 5.6,
          z: spawn.center.z + facing.z * 5.4 + tangent.z * side * 5.6,
        },
        { x: 2.3, z: 0.8 },
        4,
        'metal',
        Math.atan2(facing.z, facing.x),
        1
      );
    }
  }

  return pieces;
}

function createBattleRoyalLayout(
  seed: number,
  themeId?: VoxelMapTheme['id'] | null,
  mapSize?: VoxelMapSizeId | null
): BattleRoyalLayout {
  const theme = getVoxelMapTheme(seed, themeId);
  const profile = getBattleRoyalSizeProfile(mapSize);
  const size = {
    x: Math.round(profile.worldSize / VOXEL_SIZE.x),
    y: Math.round(profile.worldHeight / VOXEL_SIZE.y),
    z: Math.round(profile.worldSize / VOXEL_SIZE.z),
  };
  const origin = {
    x: -(size.x * VOXEL_SIZE.x) / 2,
    y: 0,
    z: -(size.z * VOXEL_SIZE.z) / 2,
  };
  const boundary = createBoundary(seed, profile);
  const spawnLayout = createSpawnClusters(seed, boundary, profile);
  const districts = createDistricts(seed, boundary, spawnLayout.spawns, profile);
  const roadLayout = createRoadNetwork({
    seed,
    boundary,
    spawns: spawnLayout.spawns,
    districts,
  });
  const terrainFeatures = createTerrainFeatures(seed, boundary, spawnLayout.spawns, districts, profile);
  const poiLayout = createPois(seed, boundary, spawnLayout.spawns, districts);
  const pickupLayout = createPowerups(
    seed,
    boundary,
    spawnLayout.spawns,
    districts,
    roadLayout.roadSegments,
    poiLayout.pois,
    profile
  );
  const flattenZones = [
    ...createDistrictFlattenZones(districts),
    ...createRoadFlattenZones(roadLayout.roadSegments),
    ...spawnLayout.flattenZones,
    ...poiLayout.flattenZones,
    ...pickupLayout.flattenZones,
  ];
  const layout: BattleRoyalLayout = {
    seed,
    profile,
    theme,
    origin,
    size,
    boundary,
    spawns: spawnLayout.spawns,
    spawnPoints: spawnLayout.spawnPoints,
    flattenZones,
    terrainFeatures,
    districts,
    roadNodes: roadLayout.roadNodes,
    roadSegments: roadLayout.roadSegments,
    powerups: pickupLayout.powerups,
    pois: poiLayout.pois,
    coverPieces: createCoverPieces(
      seed,
      boundary,
      spawnLayout.spawns,
      districts,
      roadLayout.roadSegments,
      poiLayout.pois
    ),
  };

  return resolveSurfacePlacements(layout);
}

function gridRowsToWorldY(row: number, originY: number, voxelY: number): number {
  return originY + row * voxelY;
}

function getSurfaceRow(layout: BattleRoyalLayout, point: { x: number; z: number }): number {
  return terrainRows(layout.seed, point.x, point.z, layout.flattenZones, layout.terrainFeatures, layout.profile);
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
  const spawnOffset = PLAYER_HEIGHT / 2 + 0.3;
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
    districts: layout.districts.map((district) => ({
      ...district,
      center: getSurfacePosition(layout, district.center, 0.18),
    })),
    roadNodes: layout.roadNodes.map((node) => ({
      ...node,
      position: getSurfacePosition(layout, node.position, 0.16),
    })),
    roadSegments: layout.roadSegments.map((segment) => ({
      ...segment,
      points: segment.points.map((point) => getSurfacePosition(layout, point, 0.16)),
    })),
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
  const halfSize = layout.profile.worldSize / 2;
  let solidBlockCount = 0;

  for (let z = 0; z < layout.size.z; z++) {
    const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
    for (let x = 0; x < layout.size.x; x++) {
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const radial = Math.hypot(worldX, worldZ);
      const insidePlayable = isInsideBoundaryPolygon(worldX, worldZ, layout.boundary);
      let boundaryWall = false;
      let rows = 0;

      if (insidePlayable) {
        rows = terrainRows(layout.seed, worldX, worldZ, layout.flattenZones, layout.terrainFeatures, layout.profile);
      } else if (radial <= halfSize - 1 && radial >= layout.profile.baseRadius * 0.78) {
        const closest = getClosestBoundaryPoint(worldX, worldZ, layout.boundary).point;
        boundaryWall = distance2D({ x: worldX, z: worldZ }, closest) <= BOUNDARY_WALL_THICKNESS;
        rows = boundaryWall
          ? Math.round(BOUNDARY_WALL_ROWS + (fractalNoise2(layout.seed ^ 0x777, worldX * 0.032, worldZ * 0.032, 2) - 0.5) * 5)
          : 0;
      }

      const startY = boundaryWall ? 0 : Math.max(0, rows - TERRAIN_SHELL_DEPTH_ROWS);
      for (let y = startY; y < rows; y++) {
        const block = boundaryWall
          ? BARRIER
          : y === rows - 1
            ? terrain.top
            : y >= rows - TERRAIN_SIDE_ROWS
              ? terrain.side
              : terrain.deep;
        blocks[index(x, y, z, layout.size)] = block;
        solidBlockCount++;
      }
    }
  }

  stampPads(layout, blocks);
  stampBattleRoyalContent(layout, blocks, terrain);
  stampStrategicLandmarkScreens(layout, blocks, terrain.side);

  let heightfield = createHeightfield({ blocks, size: layout.size, origin: layout.origin });
  const sightlineSamplePoints = createLayoutSightlineSamplePoints(layout);
  for (let pass = 0; pass < SIGHTLINE_REPAIR_MAX_PASSES; pass++) {
    const repairPair = findLongestVisibleSightline(
      heightfield,
      sightlineSamplePoints,
      layout.profile.sightlineOcclusionTargetDistance
    );
    if (!repairPair) break;
    stampSightlineMountainRidge(layout, blocks, repairPair, terrain.side, pass);
    heightfield = createHeightfield({ blocks, size: layout.size, origin: layout.origin });
  }

  clearSpawnCapsuleVolumes(layout, blocks);
  heightfield = createHeightfield({ blocks, size: layout.size, origin: layout.origin });

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

function closestIntervalDelta(value: number, min: number, max: number): number {
  if (value < min) return value - min;
  if (value > max) return value - max;
  return 0;
}

function clearSpawnCapsuleVolumes(layout: BattleRoyalLayout, blocks: Uint8Array): void {
  const clearanceRadiusSq = SPAWN_CAPSULE_CLEARANCE_RADIUS * SPAWN_CAPSULE_CLEARANCE_RADIUS;

  for (const points of Object.values(layout.spawnPoints)) {
    for (const point of points) {
      const feetY = point.y - PLAYER_HEIGHT / 2;
      const headY = feetY + PLAYER_HEIGHT;
      const minX = Math.floor((point.x - SPAWN_CAPSULE_CLEARANCE_RADIUS - layout.origin.x) / VOXEL_SIZE.x);
      const maxX = Math.ceil((point.x + SPAWN_CAPSULE_CLEARANCE_RADIUS - layout.origin.x) / VOXEL_SIZE.x);
      const minZ = Math.floor((point.z - SPAWN_CAPSULE_CLEARANCE_RADIUS - layout.origin.z) / VOXEL_SIZE.z);
      const maxZ = Math.ceil((point.z + SPAWN_CAPSULE_CLEARANCE_RADIUS - layout.origin.z) / VOXEL_SIZE.z);
      const minY = Math.floor((feetY - layout.origin.y) / VOXEL_SIZE.y);
      const maxY = Math.floor((headY - layout.origin.y) / VOXEL_SIZE.y);

      for (let z = minZ; z <= maxZ; z++) {
        if (z < 0 || z >= layout.size.z) continue;
        const cellMinZ = layout.origin.z + z * VOXEL_SIZE.z;
        const cellMaxZ = cellMinZ + VOXEL_SIZE.z;
        const deltaZ = closestIntervalDelta(point.z, cellMinZ, cellMaxZ);

        for (let x = minX; x <= maxX; x++) {
          if (x < 0 || x >= layout.size.x) continue;
          const cellMinX = layout.origin.x + x * VOXEL_SIZE.x;
          const cellMaxX = cellMinX + VOXEL_SIZE.x;
          const deltaX = closestIntervalDelta(point.x, cellMinX, cellMaxX);
          if (deltaX * deltaX + deltaZ * deltaZ > clearanceRadiusSq) continue;

          for (let y = minY; y <= maxY; y++) {
            if (y < 0 || y >= layout.size.y) continue;
            setBlock(layout, blocks, x, y, z, AIR);
          }
        }
      }
    }
  }
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

function stampNaturalMountainRidge(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  center: { x: number; z: number },
  halfLength: number,
  halfWidth: number,
  heightRows: number,
  block: number,
  rotation: number,
  noiseSeed: number
): void {
  const boundsRadius = Math.hypot(halfLength, halfWidth);
  const minX = Math.floor((center.x - boundsRadius - layout.origin.x) / VOXEL_SIZE.x);
  const maxX = Math.ceil((center.x + boundsRadius - layout.origin.x) / VOXEL_SIZE.x);
  const minZ = Math.floor((center.z - boundsRadius - layout.origin.z) / VOXEL_SIZE.z);
  const maxZ = Math.ceil((center.z + boundsRadius - layout.origin.z) / VOXEL_SIZE.z);

  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
      if (!isInsideBoundaryPolygon(worldX, worldZ, layout.boundary)) continue;
      if (isRepairProtectedTerrainCell(layout, worldX, worldZ)) continue;

      const local = rotatePoint2D({ x: worldX, z: worldZ }, center, rotation);
      const along = Math.abs(local.x) / halfLength;
      const across = Math.abs(local.z) / halfWidth;
      if (along >= 1 || across >= 1) continue;

      const lengthFade = smoothstep(1 - along);
      const widthFade = smoothstep(1 - across);
      const roughness = lerp(
        0.88,
        1.06,
        fractalNoise2(noiseSeed, worldX * 0.035, worldZ * 0.035, 3)
      );
      const localHeightRows = Math.round(heightRows * lengthFade * widthFade * roughness);
      if (localHeightRows < 3) continue;

      stampColumn(layout, blocks, x, z, localHeightRows, block);
    }
  }
}

function isSpawnProtectedTerrainCell(layout: BattleRoyalLayout, worldX: number, worldZ: number): boolean {
  for (const spawn of Object.values(layout.spawns)) {
    if (distance2D({ x: worldX, z: worldZ }, spawn.center) <= (spawn.radius ?? SPAWN_FLATTEN_RADIUS) + 3.5) return true;
    for (const point of spawn.points) {
      if (distance2D({ x: worldX, z: worldZ }, point) <= 4.5) return true;
    }
  }
  return false;
}

function isRepairProtectedTerrainCell(layout: BattleRoyalLayout, worldX: number, worldZ: number): boolean {
  const point = { x: worldX, z: worldZ };
  if (isSpawnProtectedTerrainCell(layout, worldX, worldZ)) return true;

  for (const district of layout.districts) {
    if (district.kind === 'open_field' || district.kind === 'wildland') continue;
    const protectedCoreRadius = district.kind === 'city_core'
      ? 12
      : district.kind === 'industrial' || district.kind === 'town'
        ? 9
        : 7;
    if (distance2D(point, district.center) <= protectedCoreRadius) return true;
  }

  for (const segment of layout.roadSegments) {
    const protectedWidth = segment.width * 1.25 + 10;
    for (let index = 1; index < segment.points.length; index++) {
      if (distanceToSegment2D(point, segment.points[index - 1], segment.points[index]) <= protectedWidth) return true;
    }
  }

  for (const poi of layout.pois) {
    if (distance2D(point, poi.position) <= poi.radius + 6) return true;
  }

  for (const pickup of layout.powerups) {
    if (distance2D(point, pickup.position) <= 6) return true;
  }

  return false;
}

function stampSightlineMountainRidge(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  pair: SightlinePair,
  block: number,
  passIndex: number
): void {
  const direction = normalize2D({ x: pair.to.x - pair.from.x, z: pair.to.z - pair.from.z });
  const normal = { x: -direction.z, z: direction.x };
  const salt = hashSeed(layout.seed ^ Math.imul(passIndex + 1, 0x6d2b79f5));
  const baseT = lerp(0.42, 0.58, unitFromSeed(salt));
  const offsetMagnitude = lerp(14, 28, unitFromSeed(salt ^ 0x9e3779b9));
  const offsetSign = unitFromSeed(salt ^ 0x85ebca6b) > 0.5 ? 1 : -1;
  const tCandidates = [
    baseT,
    baseT - 0.16,
    baseT + 0.16,
    baseT - 0.26,
    baseT + 0.26,
    baseT - 0.34,
    baseT + 0.34,
    baseT - 0.42,
    baseT + 0.42,
  ].map((value) => clamp(value, 0.14, 0.86));
  const offsetCandidates = [
    offsetSign * offsetMagnitude,
    -offsetSign * offsetMagnitude,
    offsetSign * offsetMagnitude * 0.45,
    -offsetSign * offsetMagnitude * 0.45,
    0,
  ];
  let clampedCenter: { x: number; z: number } | null = null;

  for (const candidateT of tCandidates) {
    for (const candidateOffset of offsetCandidates) {
      const candidate = add2D(lerpPoint2D(pair.from, pair.to, candidateT), normal, candidateOffset);
      const clamped = clampPointToBoundary(candidate, layout.boundary, 5);
      if (isRepairProtectedTerrainCell(layout, clamped.x, clamped.z)) continue;
      clampedCenter = clamped;
      break;
    }
    if (clampedCenter !== null) break;
  }

  clampedCenter ??= clampPointToBoundary(add2D(lerpPoint2D(pair.from, pair.to, baseT), normal, offsetSign * offsetMagnitude), layout.boundary, 5);
  const length = clamp(pair.distance * lerp(0.38, 0.54, unitFromSeed(salt ^ 0x85ebca6b)), 78, 138);
  const thickness = lerp(22, 34, unitFromSeed(salt ^ 0xc2b2ae35));
  const heightRows = Math.round(clamp(pair.distance * 0.19, 52, 76));

  stampNaturalMountainRidge(
    layout,
    blocks,
    clampedCenter,
    length,
    thickness,
    heightRows,
    block,
    Math.atan2(normal.z, normal.x),
    salt ^ 0x7f4a7c15
  );
}

function stampRectRoof(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  center: { x: number; z: number },
  halfExtents: { x: number; z: number },
  heightRows: number,
  block: number,
  rotation = 0,
  overhang = 0.35,
  thicknessRows = 2
): void {
  const roofExtents = {
    x: halfExtents.x + overhang,
    z: halfExtents.z + overhang,
  };
  const boundsRadius = Math.hypot(roofExtents.x, roofExtents.z);
  const minX = Math.floor((center.x - boundsRadius - layout.origin.x) / VOXEL_SIZE.x);
  const maxX = Math.ceil((center.x + boundsRadius - layout.origin.x) / VOXEL_SIZE.x);
  const minZ = Math.floor((center.z - boundsRadius - layout.origin.z) / VOXEL_SIZE.z);
  const maxZ = Math.ceil((center.z + boundsRadius - layout.origin.z) / VOXEL_SIZE.z);
  const roofY = Math.min(
    layout.size.y - 1,
    getSurfaceRow(layout, center) + Math.max(1, heightRows)
  );
  const maxY = Math.min(layout.size.y - 1, roofY + Math.max(1, thicknessRows) - 1);

  for (let z = minZ; z <= maxZ; z++) {
    for (let x = minX; x <= maxX; x++) {
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
      const local = rotatePoint2D({ x: worldX, z: worldZ }, center, rotation);
      if (Math.abs(local.x) > roofExtents.x || Math.abs(local.z) > roofExtents.z) continue;
      for (let y = roofY; y <= maxY; y++) {
        setBlock(layout, blocks, x, y, z, block);
      }
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

function stampCylinderRoof(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  center: { x: number; z: number },
  radius: number,
  heightRows: number,
  block: number,
  overhang = 0.35,
  thicknessRows = 2
): void {
  const grid = worldToGrid(layout, { x: center.x, y: 0, z: center.z });
  const roofRadius = radius + overhang;
  const radiusCells = Math.ceil(roofRadius / VOXEL_SIZE.x);
  const roofY = Math.min(
    layout.size.y - 1,
    getSurfaceRow(layout, center) + Math.max(1, heightRows)
  );
  const maxY = Math.min(layout.size.y - 1, roofY + Math.max(1, thicknessRows) - 1);

  for (let z = grid.z - radiusCells; z <= grid.z + radiusCells; z++) {
    for (let x = grid.x - radiusCells; x <= grid.x + radiusCells; x++) {
      const worldX = layout.origin.x + (x + 0.5) * VOXEL_SIZE.x;
      const worldZ = layout.origin.z + (z + 0.5) * VOXEL_SIZE.z;
      if (Math.hypot(worldX - center.x, worldZ - center.z) > roofRadius) continue;
      for (let y = roofY; y <= maxY; y++) {
        setBlock(layout, blocks, x, y, z, block);
      }
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
      stampCylinderRoof(layout, blocks, center, 5.8, poi.heightRows, METAL, 0.45, 2);
      stampRectRoof(layout, blocks, center, { x: 17, z: 1.4 }, 5, METAL, angle, 0.25, 1);
      stampRectRoof(layout, blocks, center, { x: 1.4, z: 17 }, 5, METAL, angle, 0.25, 1);
      break;
    case 'watchtower':
      stampCylinder(layout, blocks, poi.position, Math.max(2.8, poi.radius * 0.5), poi.heightRows, METAL, GLASS);
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius }, 3, GLASS, true, angle);
      stampCylinderRoof(layout, blocks, center, Math.max(3.2, poi.radius * 0.54), poi.heightRows, METAL, 0.35, 2);
      stampRectRoof(layout, blocks, center, { x: poi.radius * 0.9, z: poi.radius * 0.9 }, poi.heightRows, METAL, angle, 0.35, 1);
      stampRectRoof(layout, blocks, center, { x: poi.radius, z: poi.radius }, 3, METAL, angle, 0.25, 1);
      break;
    case 'bunker':
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.72 }, poi.heightRows, METAL, true, angle);
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.52, z: poi.radius * 0.4 }, 3, GLASS, false, angle);
      stampRectRoof(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.72 }, poi.heightRows, METAL, angle, 0.45, 2);
      break;
    case 'depot':
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.58 }, poi.heightRows, METAL, true, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 2.2, z: -2.2 }), { x: 2.7, z: 2.7 }, 4, GLASS, false, angle);
      stampRectRoof(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.58 }, poi.heightRows, METAL, angle, 0.4, 2);
      break;
    case 'highrise':
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.9, z: poi.radius * 0.9 }, 5, METAL, false, angle);
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.48, z: poi.radius * 0.55 }, poi.heightRows, METAL, false, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 0, z: poi.radius * 0.58 }), { x: poi.radius * 0.5, z: 0.7 }, poi.heightRows - 4, GLASS, false, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 0, z: -poi.radius * 0.58 }), { x: poi.radius * 0.5, z: 0.7 }, poi.heightRows - 6, GLASS, false, angle);
      stampRectRoof(layout, blocks, center, { x: poi.radius * 0.9, z: poi.radius * 0.9 }, 5, METAL, angle, 0.35, 1);
      stampRectRoof(layout, blocks, center, { x: poi.radius * 0.5, z: poi.radius * 0.57 }, poi.heightRows, METAL, angle, 0.35, 2);
      break;
    case 'hangar':
      stampRectPrism(layout, blocks, center, { x: poi.radius * 1.25, z: poi.radius * 0.55 }, poi.heightRows, METAL, true, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: -poi.radius * 0.45, z: 0 }), { x: poi.radius * 0.35, z: poi.radius * 0.42 }, Math.max(4, poi.heightRows - 3), GLASS, false, angle);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: poi.radius * 0.72, z: 0 }), { x: 1.2, z: poi.radius * 0.5 }, Math.max(3, poi.heightRows - 5), METAL, false, angle);
      stampRectRoof(layout, blocks, center, { x: poi.radius * 1.25, z: poi.radius * 0.55 }, poi.heightRows, METAL, angle, 0.5, 2);
      break;
    case 'relay':
      stampRectPrism(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.72 }, 4, METAL, false, angle);
      stampCylinder(layout, blocks, poi.position, Math.max(2, poi.radius * 0.34), poi.heightRows, METAL, GLASS);
      stampRectPrism(layout, blocks, offsetByRotation(center, angle, { x: 0, z: poi.radius * 0.52 }), { x: poi.radius * 0.85, z: 0.7 }, Math.max(4, poi.heightRows - 8), GLASS, false, angle);
      stampRectRoof(layout, blocks, center, { x: poi.radius, z: poi.radius * 0.72 }, 4, METAL, angle, 0.35, 1);
      stampCylinderRoof(layout, blocks, center, Math.max(2.35, poi.radius * 0.38), poi.heightRows, METAL, 0.35, 2);
      break;
    case 'compound':
      stampRectPrism(layout, blocks, center, { x: poi.radius * 0.95, z: poi.radius * 0.42 }, poi.heightRows, METAL, true, angle);
      stampRectRoof(layout, blocks, center, { x: poi.radius * 0.95, z: poi.radius * 0.42 }, poi.heightRows, METAL, angle, 0.45, 2);
      {
        const westWingCenter = offsetByRotation(center, angle, { x: -poi.radius * 0.42, z: poi.radius * 0.58 });
        const westWingHeight = Math.max(5, poi.heightRows - 5);
        const eastWingCenter = offsetByRotation(center, angle, { x: poi.radius * 0.46, z: -poi.radius * 0.56 });
        const eastWingHeight = Math.max(5, poi.heightRows - 7);
        stampRectPrism(layout, blocks, westWingCenter, { x: poi.radius * 0.42, z: poi.radius * 0.36 }, westWingHeight, METAL, false, angle);
        stampRectRoof(layout, blocks, westWingCenter, { x: poi.radius * 0.42, z: poi.radius * 0.36 }, westWingHeight, METAL, angle, 0.28, 1);
        stampRectPrism(layout, blocks, eastWingCenter, { x: poi.radius * 0.36, z: poi.radius * 0.4 }, eastWingHeight, GLASS, false, angle + Math.PI * 0.5);
        stampRectRoof(layout, blocks, eastWingCenter, { x: poi.radius * 0.36, z: poi.radius * 0.4 }, eastWingHeight, METAL, angle + Math.PI * 0.5, 0.28, 1);
      }
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

function stampStrategicLandmarkScreens(
  layout: BattleRoyalLayout,
  blocks: Uint8Array,
  block: number
): void {
  const districtById = new Map(layout.districts.map((district) => [district.id, district]));
  for (const district of layout.districts) {
    if (district.kind !== 'open_field' && district.kind !== 'wildland') continue;
    const radial = normalize2D({ x: district.center.x, z: district.center.z });
    const tangent = { x: -radial.z, z: radial.x };
    const salt = hashSeed(layout.seed ^ Math.imul(district.id.length + layout.districts.indexOf(district), 0x6ac690c5));
    const centerFactors = district.kind === 'wildland'
      ? [0.56, 0.66, 0.76]
      : [0.48, 0.6, 0.72];
    const offsetMagnitude = lerp(10, 26, unitFromSeed(salt));
    const offsetCandidates = [0, offsetMagnitude, -offsetMagnitude, offsetMagnitude * 0.5, -offsetMagnitude * 0.5];
    let center: { x: number; z: number } | null = null;

    for (const factor of centerFactors) {
      for (const offset of offsetCandidates) {
        const candidate = add2D(
          {
            x: district.center.x * factor,
            z: district.center.z * factor,
          },
          tangent,
          offset
        );
        const clamped = clampPointToBoundary(candidate, layout.boundary, 5);
        if (isRepairProtectedTerrainCell(layout, clamped.x, clamped.z)) continue;
        center = clamped;
        break;
      }
      if (center !== null) break;
    }

    if (center === null) continue;

    stampNaturalMountainRidge(
      layout,
      blocks,
      center,
      clamp(district.influenceRadius * 1.9, 74, 128),
      lerp(24, 36, unitFromSeed(salt ^ 0xc2b2ae35)),
      Math.round(lerp(district.kind === 'wildland' ? 64 : 58, district.kind === 'wildland' ? 84 : 76, unitFromSeed(salt ^ 0x85ebca6b))),
      block,
      Math.atan2(tangent.z, tangent.x),
      salt ^ 0x7f4a7c15
    );
  }

  const screenPairs = layout.pois
    .flatMap((poi, index, pois) => (
      pois.slice(index + 1).map((other) => {
        const aDistrict = poi.districtId ? districtById.get(poi.districtId) : undefined;
        const bDistrict = other.districtId ? districtById.get(other.districtId) : undefined;
        const openAreaPair = aDistrict?.kind === 'open_field' || aDistrict?.kind === 'wildland' ||
          bDistrict?.kind === 'open_field' || bDistrict?.kind === 'wildland';
        const distance = distance2D(poi.position, other.position);
        return {
          a: poi,
          b: other,
          distance,
          score: distance + (openAreaPair ? 90 : 0),
        };
      })
    ))
    .filter((pair) => pair.distance >= layout.profile.sightlineOcclusionTargetDistance * 0.92)
    .sort((a, b) => b.score - a.score)
    .slice(0, 34);

  for (let index = 0; index < screenPairs.length; index++) {
    const pair = screenPairs[index];
    const direction = normalize2D({
      x: pair.b.position.x - pair.a.position.x,
      z: pair.b.position.z - pair.a.position.z,
    });
    const normal = { x: -direction.z, z: direction.x };
    const salt = hashSeed(layout.seed ^ Math.imul(index + 1, 0x4cf5ad43));
    const tCandidates = [0.5, 0.62, 0.38, 0.74, 0.26];
    const offsetMagnitude = lerp(8, 24, unitFromSeed(salt));
    const offsetCandidates = [
      0,
      offsetMagnitude,
      -offsetMagnitude,
      offsetMagnitude * 0.5,
      -offsetMagnitude * 0.5,
    ];
    let center: { x: number; z: number } | null = null;

    for (const t of tCandidates) {
      for (const offset of offsetCandidates) {
        const candidate = add2D(lerpPoint2D(pair.a.position, pair.b.position, t), normal, offset);
        const clamped = clampPointToBoundary(candidate, layout.boundary, 5);
        if (isRepairProtectedTerrainCell(layout, clamped.x, clamped.z)) continue;
        center = clamped;
        break;
      }
      if (center !== null) break;
    }

    if (center === null) continue;

    stampNaturalMountainRidge(
      layout,
      blocks,
      center,
      clamp(pair.distance * lerp(0.38, 0.5, unitFromSeed(salt ^ 0x85ebca6b)), 74, 132),
      lerp(22, 34, unitFromSeed(salt ^ 0xc2b2ae35)),
      Math.round(clamp(pair.distance * 0.21, 56, 82)),
      block,
      Math.atan2(normal.z, normal.x),
      salt ^ 0x7f4a7c15
    );
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

function findNearestDistrict(
  layout: BattleRoyalLayout,
  position: { x: number; z: number },
  predicate: (district: BattleRoyalDistrict) => boolean = () => true
): BattleRoyalDistrict {
  let nearest = layout.districts.find(predicate) ?? layout.districts[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const district of layout.districts) {
    if (!predicate(district)) continue;
    const distance = distance2D(position, district.center);
    if (distance < nearestDistance) {
      nearest = district;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function getLaneTravelSpeed(laneId: string): number {
  if (laneId === ROAD_LANE_PRIMARY) return 7.8;
  if (laneId === ROAD_LANE_LOOP) return 7.2;
  if (laneId === ROAD_LANE_WILD) return 6.6;
  return 7.4;
}

function createRouteGraph(layout: BattleRoyalLayout): RouteGraph {
  const nodes: RouteGraphNode[] = [];
  const edges: RouteGraphEdge[] = [];
  const primaryRouteNodeIds: TeamMap<string[]> = {};
  const fallbackAnchorNodeIds: TeamMap<string[]> = {};
  const nodeIds = new Set<string>();
  const city = layout.districts.find((district) => district.kind === 'city_core') ?? layout.districts[0];
  const connectedLaneIds = (nodeId: string): string[] => {
    const laneIds = new Set<string>();
    for (const segment of layout.roadSegments) {
      if (segment.fromNodeId === nodeId || segment.toNodeId === nodeId) {
        laneIds.add(segment.laneId);
      }
    }
    if (nodeId.endsWith('_node')) laneIds.add(ROAD_LANE_SETTLEMENT);
    return Array.from(laneIds);
  };
  const addNode = (node: RouteGraphNode): void => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (
    id: string,
    from: string,
    to: string,
    laneId: string,
    distance: number,
    width: number,
    traversal: RouteGraphEdge['traversal'],
    tags: string[]
  ): void => {
    edges.push({
      id,
      from,
      to,
      laneId,
      distance,
      expectedTravelTimeSeconds: distance / getLaneTravelSpeed(laneId),
      width,
      traversal,
      tags,
    });
  };

  for (const node of layout.roadNodes) {
    addNode({
      id: node.id,
      kind: node.kind === 'spawn'
        ? 'spawn'
        : node.tags.includes('open_field') || node.tags.includes('wildland')
          ? 'flank'
          : 'landmark',
      position: node.position,
      team: node.team,
      laneIds: connectedLaneIds(node.id),
      tags: node.tags,
    });
  }

  for (const segment of layout.roadSegments) {
    let previousNodeId = segment.fromNodeId;
    let previousPoint = layout.roadNodes.find((node) => node.id === segment.fromNodeId)?.position ?? segment.points[0];
    for (let pointIndex = 1; pointIndex < segment.points.length - 1; pointIndex++) {
      const waypointId = `${segment.id}_wp_${pointIndex}`;
      const point = segment.points[pointIndex];
      addNode({
        id: waypointId,
        kind: segment.kind === 'wild' ? 'flank' : 'midfield',
        position: point,
        laneIds: [segment.laneId],
        tags: ['road_waypoint', ...segment.tags],
      });
      addEdge(
        `${segment.id}_${pointIndex - 1}`,
        previousNodeId,
        waypointId,
        segment.laneId,
        distance2D(previousPoint, point),
        segment.width,
        segment.traversal,
        ['road_segment', ...segment.tags]
      );
      previousNodeId = waypointId;
      previousPoint = point;
    }

    const endPoint = layout.roadNodes.find((node) => node.id === segment.toNodeId)?.position ?? segment.points[segment.points.length - 1];
    addEdge(
      `${segment.id}_end`,
      previousNodeId,
      segment.toNodeId,
      segment.laneId,
      distance2D(previousPoint, endPoint),
      segment.width,
      segment.traversal,
      ['road_segment', ...segment.tags]
    );
  }

  for (const poi of layout.pois) {
    addNode({
      id: poi.id,
      kind: 'landmark',
      position: poi.position,
      laneIds: [ROAD_LANE_SETTLEMENT],
      tags: [poi.role, poi.districtId ?? 'standalone_poi'],
    });
    const districtNodeId = poi.districtId ? `${poi.districtId}_node` : city?.roadNodeId;
    if (districtNodeId && nodeIds.has(districtNodeId)) {
      addEdge(
        `${poi.id}_settlement_path`,
        districtNodeId,
        poi.id,
        ROAD_LANE_SETTLEMENT,
        distance2D(layout.roadNodes.find((node) => node.id === districtNodeId)?.position ?? poi.position, poi.position),
        poi.role === 'citadel' ? 9 : 5.5,
        'ground',
        ['settlement_path', poi.role]
      );
    }
  }

  for (const [team, spawn] of Object.entries(layout.spawns)) {
    const nodeId = `${team}_spawn_node`;
    const nearestDistrict = findNearestDistrict(layout, spawn.center, (district) => (
      district.kind !== 'open_field' && district.kind !== 'wildland' && district.kind !== 'city_core'
    ));
    primaryRouteNodeIds[team] = city
      ? [nodeId, nearestDistrict.roadNodeId, city.roadNodeId]
      : [nodeId, nearestDistrict.roadNodeId];
    fallbackAnchorNodeIds[team] = [nodeId, nearestDistrict.roadNodeId];
  }

  return { nodes, edges, primaryRouteNodeIds, fallbackAnchorNodeIds };
}

function heightfieldRowAt(heightfield: VoxelHeightfield, point: { x: number; z: number }): number {
  const x = Math.floor((point.x - heightfield.origin.x) / heightfield.voxelSize.x);
  const z = Math.floor((point.z - heightfield.origin.z) / heightfield.voxelSize.z);
  if (x < 0 || z < 0 || x >= heightfield.size.x || z >= heightfield.size.z) return 0;
  return heightfield.topSolidRows[x + z * heightfield.size.x];
}

function hasHeightfieldLineOfSight(
  heightfield: VoxelHeightfield,
  from: { x: number; z: number },
  to: { x: number; z: number }
): boolean {
  const distance = distance2D(from, to);
  if (distance <= SIGHTLINE_MIN_REPORTED_DISTANCE) return true;

  const fromEyeRow = heightfieldRowAt(heightfield, from) + SIGHTLINE_EYE_ROWS;
  const toEyeRow = heightfieldRowAt(heightfield, to) + SIGHTLINE_EYE_ROWS;
  const steps = Math.max(2, Math.ceil(distance / SIGHTLINE_SAMPLE_STEP_DISTANCE));
  for (let step = 1; step < steps; step++) {
    const t = step / steps;
    const point = lerpPoint2D(from, to, t);
    const terrainRow = heightfieldRowAt(heightfield, point);
    const sightlineRow = lerp(fromEyeRow, toEyeRow, t);
    if (terrainRow >= sightlineRow - 0.75) return false;
  }

  return true;
}

function isPlayableSightlineSample(heightfield: VoxelHeightfield, sample: SightlineSamplePoint): boolean {
  if (!sample.id.startsWith('grid_')) return true;

  const row = heightfieldRowAt(heightfield, sample);
  if (row <= 0 || row >= MAX_TERRAIN_ROWS - 2) return false;

  const cellX = Math.floor((sample.x - heightfield.origin.x) / heightfield.voxelSize.x);
  const cellZ = Math.floor((sample.z - heightfield.origin.z) / heightfield.voxelSize.z);
  let maxNeighborDelta = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const neighborX = cellX + dx;
      const neighborZ = cellZ + dz;
      if (neighborX < 0 || neighborZ < 0 || neighborX >= heightfield.size.x || neighborZ >= heightfield.size.z) continue;
      const neighborRow = heightfield.topSolidRows[neighborX + neighborZ * heightfield.size.x];
      if (neighborRow <= 0) continue;
      maxNeighborDelta = Math.max(maxNeighborDelta, Math.abs(row - neighborRow));
    }
  }

  return maxNeighborDelta <= 14;
}

function createSightlineSamplePoints(layout: BattleRoyalLayout, routeGraph: RouteGraph): SightlineSamplePoint[] {
  const points: SightlineSamplePoint[] = [];
  const keys = new Set<string>();
  const addPoint = (id: string, point: { x: number; z: number }): void => {
    if (!isInsideBoundaryPolygon(point.x, point.z, layout.boundary)) return;
    const key = `${Math.round(point.x / 4)}:${Math.round(point.z / 4)}`;
    if (keys.has(key)) return;
    keys.add(key);
    points.push({ id, x: point.x, z: point.z });
  };

  for (const node of routeGraph.nodes) {
    if (node.kind === 'spawn') continue;
    addPoint(node.id, node.position);
  }

  for (const district of layout.districts) {
    addPoint(district.id, district.center);
  }

  for (const poi of layout.pois) {
    addPoint(poi.id, poi.position);
  }

  for (
    let z = -layout.profile.baseRadius + layout.profile.sightlineSampleGridSpacing * 0.5;
    z <= layout.profile.baseRadius - layout.profile.sightlineSampleGridSpacing * 0.5;
    z += layout.profile.sightlineSampleGridSpacing
  ) {
    for (
      let x = -layout.profile.baseRadius + layout.profile.sightlineSampleGridSpacing * 0.5;
      x <= layout.profile.baseRadius - layout.profile.sightlineSampleGridSpacing * 0.5;
      x += layout.profile.sightlineSampleGridSpacing
    ) {
      addPoint(`grid_${Math.round(x)}_${Math.round(z)}`, { x, z });
    }
  }

  return points;
}

function computeSightlineMetrics(input: {
  layout: BattleRoyalLayout;
  routeGraph: RouteGraph;
  heightfield: VoxelHeightfield;
}): SightlineMetrics {
  const samplePoints = createSightlineSamplePoints(input.layout, input.routeGraph)
    .filter((point) => isPlayableSightlineSample(input.heightfield, point));
  let maxSightlineLength = 0;

  for (let a = 0; a < samplePoints.length; a++) {
    for (let b = a + 1; b < samplePoints.length; b++) {
      const distance = distance2D(samplePoints[a], samplePoints[b]);
      if (distance <= maxSightlineLength || distance < SIGHTLINE_MIN_REPORTED_DISTANCE) continue;
      if (hasHeightfieldLineOfSight(input.heightfield, samplePoints[a], samplePoints[b])) {
        maxSightlineLength = distance;
      }
    }
  }

  const spawnCenters = Object.values(input.layout.spawns).map((spawn) => spawn.center);
  let spawnVisibilityPairs = 0;
  for (let a = 0; a < spawnCenters.length; a++) {
    for (let b = a + 1; b < spawnCenters.length; b++) {
      if (hasHeightfieldLineOfSight(input.heightfield, spawnCenters[a], spawnCenters[b])) {
        spawnVisibilityPairs++;
      }
    }
  }

  return {
    maxSightlineLength: Math.round(maxSightlineLength),
    spawnVisibilityPairs,
  };
}

function createLayoutSightlineSamplePoints(layout: BattleRoyalLayout): SightlineSamplePoint[] {
  const points: SightlineSamplePoint[] = [];
  const keys = new Set<string>();
  const addPoint = (id: string, point: { x: number; z: number }): void => {
    if (!isInsideBoundaryPolygon(point.x, point.z, layout.boundary)) return;
    const key = `${Math.round(point.x / 4)}:${Math.round(point.z / 4)}`;
    if (keys.has(key)) return;
    keys.add(key);
    points.push({ id, x: point.x, z: point.z });
  };

  for (const node of layout.roadNodes) {
    if (node.kind !== 'spawn') addPoint(node.id, node.position);
  }
  for (const segment of layout.roadSegments) {
    segment.points.forEach((point, index) => addPoint(`${segment.id}_p${index}`, point));
  }
  for (const district of layout.districts) {
    addPoint(district.id, district.center);
  }
  for (const poi of layout.pois) {
    addPoint(poi.id, poi.position);
  }

  for (
    let z = -layout.profile.baseRadius + layout.profile.sightlineSampleGridSpacing * 0.5;
    z <= layout.profile.baseRadius - layout.profile.sightlineSampleGridSpacing * 0.5;
    z += layout.profile.sightlineSampleGridSpacing
  ) {
    for (
      let x = -layout.profile.baseRadius + layout.profile.sightlineSampleGridSpacing * 0.5;
      x <= layout.profile.baseRadius - layout.profile.sightlineSampleGridSpacing * 0.5;
      x += layout.profile.sightlineSampleGridSpacing
    ) {
      addPoint(`grid_${Math.round(x)}_${Math.round(z)}`, { x, z });
    }
  }

  return points;
}

function findLongestVisibleSightline(
  heightfield: VoxelHeightfield,
  samplePoints: readonly SightlineSamplePoint[],
  targetDistance: number
): SightlinePair | null {
  let longest: SightlinePair | null = null;
  const playableSamplePoints = samplePoints.filter((point) => isPlayableSightlineSample(heightfield, point));
  for (let a = 0; a < playableSamplePoints.length; a++) {
    for (let b = a + 1; b < playableSamplePoints.length; b++) {
      const distance = distance2D(playableSamplePoints[a], playableSamplePoints[b]);
      if (distance <= targetDistance || distance <= (longest?.distance ?? 0)) continue;
      if (hasHeightfieldLineOfSight(heightfield, playableSamplePoints[a], playableSamplePoints[b])) {
        longest = { from: playableSamplePoints[a], to: playableSamplePoints[b], distance };
      }
    }
  }

  return longest;
}

function createDiagnostics(input: {
  layout: BattleRoyalLayout;
  routeGraph: RouteGraph;
  heightfield: VoxelHeightfield;
  stats: VoxelMapStats;
  generationMs: number;
}): MapDiagnostics {
  const sightlineMetrics = computeSightlineMetrics({
    layout: input.layout,
    routeGraph: input.routeGraph,
    heightfield: input.heightfield,
  });
  const spawnCenters = Object.values(input.layout.spawns).map((spawn) => spawn.center);
  let minSpawnSeparation = Infinity;
  for (let a = 0; a < spawnCenters.length; a++) {
    for (let b = a + 1; b < spawnCenters.length; b++) {
      minSpawnSeparation = Math.min(minSpawnSeparation, distance2D(spawnCenters[a], spawnCenters[b]));
    }
  }
  const districtCounts = countBy(input.layout.districts.map((district) => district.kind));
  const settlementCount = (districtCounts.city_core ?? 0) +
    (districtCounts.town ?? 0) +
    (districtCounts.industrial ?? 0) +
    (districtCounts.hamlet ?? 0) +
    (districtCounts.outpost ?? 0);
  const openAreaCount = (districtCounts.open_field ?? 0) + (districtCounts.wildland ?? 0);
  const playableArea = Math.PI * input.layout.profile.baseRadius * input.layout.profile.baseRadius;
  const settlementCoverage = input.layout.districts
    .filter((district) => district.kind !== 'open_field' && district.kind !== 'wildland')
    .reduce((total, district) => total + Math.PI * district.radius * district.radius, 0) / playableArea;
  const openAreaCoverage = input.layout.districts
    .filter((district) => district.kind === 'open_field' || district.kind === 'wildland')
    .reduce((total, district) => total + Math.PI * district.radius * district.radius, 0) / playableArea;
  const laneLengths = input.routeGraph.edges.reduce<Record<string, number>>((lengths, edge) => {
    lengths[edge.laneId] = (lengths[edge.laneId] ?? 0) + edge.distance;
    return lengths;
  }, {});
  const laneWidths = input.routeGraph.edges.reduce<Record<string, number>>((widths, edge) => {
    widths[edge.laneId] = Math.max(widths[edge.laneId] ?? 0, edge.width);
    return widths;
  }, {});
  const scoreBreakdown = {
    spawnSeparation: clamp(minSpawnSeparation / 74, 0, 1) * 18,
    roadConnectivity: clamp(input.layout.roadSegments.length / 24, 0, 1) * 18,
    settlementStructure: clamp(settlementCount / 10, 0, 1) * 18,
    openAreaStructure: clamp(openAreaCount / 7, 0, 1) * 14,
    routeChoices: clamp(input.routeGraph.edges.length / 70, 0, 1) * 14,
    verticality: 12,
    budget: input.stats.solidBlocks < 6_800_000 && input.stats.renderableChunkCount < 7600 ? 6 : 3,
  };
  const warnings: string[] = [];
  if (minSpawnSeparation < 70) warnings.push('spawn separation below battle royal target');
  if ((districtCounts.city_core ?? 0) < 1 || (districtCounts.town ?? 0) < 3) warnings.push('settlement structure below target');
  if (openAreaCount < 7) warnings.push('open area structure below target');
  if (input.layout.roadSegments.length < 22) warnings.push('road network below target');
  if (sightlineMetrics.maxSightlineLength > input.layout.profile.sightlineWarningMaxDistance) {
    warnings.push('sightline occlusion below battle royal target');
  }
  if (sightlineMetrics.spawnVisibilityPairs > 0) warnings.push('spawn sightlines exposed');
  if (input.stats.solidBlocks > 8_750_000) warnings.push('solid block budget exceeded');
  if (input.stats.renderableChunkCount > 7600) warnings.push('renderable chunk budget exceeded');

  return {
    familyId: 'battle_royal_large',
    topologyId: 'ring',
    themeId: input.layout.theme.id,
    candidateCount: 1,
    selectedCandidateId: `battle_royal_large_${input.layout.seed.toString(16)}`,
    rejectedCandidates: [],
    score: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
    scoreBreakdown,
    stageTimingsMs: { total: input.generationMs },
    laneLengths,
    laneWidths,
    routeChoiceCount: input.routeGraph.edges.length,
    coverDensityByLane: {
      [ROAD_LANE_PRIMARY]: 0.54,
      [ROAD_LANE_OUTER]: 0.58,
      [ROAD_LANE_LOOP]: 0.5,
      [ROAD_LANE_SETTLEMENT]: 0.68,
      [ROAD_LANE_WILD]: 0.42,
    },
    maxSightlineLength: sightlineMetrics.maxSightlineLength,
    spawnVisibilityPairs: sightlineMetrics.spawnVisibilityPairs,
    flagApproachClearances: {},
    colliderCount: input.stats.colliderCount,
    chunkCount: input.stats.chunkCount,
    solidBlockCount: input.stats.solidBlocks,
    moduleCountsByRole: {
      central_landmark: 1,
      medium_landmark: input.layout.pois.length - 1,
      cover_cluster: input.layout.coverPieces.length,
      spawn_cluster: BATTLE_ROYAL_TEAM_IDS.length,
      district_city_core: districtCounts.city_core ?? 0,
      district_town: districtCounts.town ?? 0,
      district_industrial: districtCounts.industrial ?? 0,
      district_hamlet: districtCounts.hamlet ?? 0,
      district_outpost: districtCounts.outpost ?? 0,
      open_area: openAreaCount,
      road_segment: input.layout.roadSegments.length,
    },
    repairActions: {
      settlementCoverage: Math.round(settlementCoverage * 1000) / 1000,
      openAreaCoverage: Math.round(openAreaCoverage * 1000) / 1000,
    },
    warnings,
  };
}

function createPreview(layout: BattleRoyalLayout): MapBlueprint['preview'] {
  const routeKindForSegment = (segment: RoadSegment): LaneDescriptor['kind'] => {
    if (segment.laneId === ROAD_LANE_PRIMARY) return 'primary';
    if (segment.laneId === ROAD_LANE_OUTER || segment.laneId === ROAD_LANE_LOOP) return 'flank';
    return 'access';
  };
  const routes = layout.roadSegments.map((segment) => ({
    id: segment.id,
    kind: routeKindForSegment(segment),
    points: segment.points,
    width: segment.width,
  }));
  const spawns: TeamMap<Vec3> = {};
  for (const [team, spawn] of Object.entries(layout.spawns)) {
    spawns[team] = spawn.center;
  }
  const districtPreviewRole = (district: BattleRoyalDistrict): MapBlueprint['preview']['thumbnailSilhouette']['landmarks'][number]['role'] => {
    if (district.kind === 'city_core') return 'midfield_occluder';
    if (district.kind === 'open_field' || district.kind === 'wildland') return 'soft_cover_cluster';
    if (district.kind === 'outpost') return 'defender_perch';
    return 'flank_landmark';
  };
  const poiPreviewRole = (poi: BattleRoyalPoi): MapBlueprint['preview']['thumbnailSilhouette']['landmarks'][number]['role'] => {
    if (poi.role === 'citadel') return 'midfield_occluder';
    if (poi.role === 'watchtower') return 'defender_perch';
    return 'flank_landmark';
  };
  const landmarks: MapBlueprint['preview']['thumbnailSilhouette']['landmarks'] = [
    ...layout.districts.map((district) => ({
      id: district.id,
      role: districtPreviewRole(district),
      position: district.center,
      radius: district.radius,
    })),
    ...layout.pois.map((poi) => ({
      id: poi.id,
      role: poiPreviewRole(poi),
      position: poi.position,
      radius: poi.radius,
    })),
  ];

  return {
    camera: {
      position: { x: 0, y: 282, z: 310 },
      target: { x: 0, y: 8, z: 0 },
      fov: 48,
      near: 0.5,
      far: 720,
    },
    thumbnailSilhouette: {
      bounds: {
        minX: -layout.profile.baseRadius,
        maxX: layout.profile.baseRadius,
        minZ: -layout.profile.baseRadius,
        maxZ: layout.profile.baseRadius,
      },
      boundary: layout.boundary,
      routes,
      landmarks,
      objectives: {
        flags: {},
        spawns,
      },
    },
    labelTags: layout.profile.labelTags,
  };
}

export interface BattleRoyalMapPreview {
  seed: number;
  mapSize: VoxelMapSizeId;
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
  options: { themeId?: VoxelMapTheme['id'] | null; mapSize?: VoxelMapSizeId | null } = {}
): BattleRoyalMapPreview {
  const normalizedSeed = seed >>> 0;
  const layout = createBattleRoyalLayout(normalizedSeed, options.themeId, options.mapSize);
  const routeGraph = createRouteGraph(layout);
  const preview = createPreview(layout);
  const districtCounts = countBy(layout.districts.map((district) => district.kind));
  const laneLengths = routeGraph.edges.reduce<Record<string, number>>((lengths, edge) => {
    lengths[edge.laneId] = (lengths[edge.laneId] ?? 0) + edge.distance;
    return lengths;
  }, {});

  return {
    seed: normalizedSeed,
    mapSize: layout.profile.mapSize,
    familyId: 'battle_royal_large',
    topologyId: 'ring',
    themeId: layout.theme.id,
    themeName: layout.theme.name,
    name: `${layout.theme.name} Wilds`,
    preview,
    diagnostics: {
      score: 90,
      scoreBreakdown: {
        roadConnectivity: 18,
        settlementStructure: Math.min(18, ((districtCounts.city_core ?? 0) + (districtCounts.town ?? 0) + (districtCounts.industrial ?? 0)) * 4),
        openAreaStructure: Math.min(14, ((districtCounts.open_field ?? 0) + (districtCounts.wildland ?? 0)) * 2),
        verticality: 12,
        routeChoices: Math.min(20, routeGraph.edges.length * 0.2),
        budget: 8,
      },
      laneLengths,
      routeChoiceCount: routeGraph.edges.length,
      warnings: [],
    },
  };
}

export function generateBattleRoyalVoxelMap(
  seed = 0,
  options: { themeId?: VoxelMapTheme['id'] | null; mapSize?: VoxelMapSizeId | null } = {}
): VoxelMapManifest {
  const startedAt = Date.now();
  const normalizedSeed = seed >>> 0;
  const layout = createBattleRoyalLayout(normalizedSeed, options.themeId, options.mapSize);
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
  const routeGraph = createRouteGraph(layout);
  const namedLocations = createNamedLocations(normalizedSeed, layout);
  const diagnostics = createDiagnostics({
    layout,
    routeGraph,
    heightfield: blockResult.heightfield,
    stats,
    generationMs,
  });
  const preview = createPreview(layout);
  const designBrief: MapDesignBrief = {
    seed: normalizedSeed,
    mapSize: layout.profile.mapSize,
    gameMode: 'battle_royal',
    profileId: 'battle_royal_large',
    teamSize: 3,
    familyId: 'battle_royal_large',
    themeId: layout.theme.id,
    targetMatchLengthSeconds: 1200,
    desiredTopology: 'ring',
    desiredSymmetry: 'asymmetric_balanced',
    performanceBudget: layout.profile.performanceBudget,
    rngStreams: {
      boundary: hashSeed(normalizedSeed ^ 0xb417e),
      spawns: hashSeed(normalizedSeed ^ 0x51a7),
      pois: hashSeed(normalizedSeed ^ 0xc17ade1),
      pickups: hashSeed(normalizedSeed ^ 0x9f2d),
      cover: hashSeed(normalizedSeed ^ 0xc0a7e),
      districts: hashSeed(normalizedSeed ^ 0xd157c7),
      roads: hashSeed(normalizedSeed ^ 0x70ad),
      terrainFeatures: hashSeed(normalizedSeed ^ 0x7e44a11),
      terrain: hashSeed(normalizedSeed ^ 0x514f),
    },
  };
  const protectedZones: ProtectedZone[] = [
    ...Object.values(layout.spawns).map((spawn) => ({
      ...spawn,
      kind: 'spawn' as const,
      clearanceRadius: SPAWN_FLATTEN_RADIUS,
      blocksDressing: true,
      blocksModules: true,
    })),
    ...layout.districts
      .filter((district) => district.kind !== 'wildland')
      .map((district): ProtectedZone => ({
        id: `${district.id}_zone`,
        shape: 'circle',
        center: district.center,
        radius: district.radius,
        kind: 'no_dressing',
        clearanceRadius: district.radius,
        blocksDressing: true,
        blocksModules: false,
      })),
  ];
  const laneDistance = (laneId: string): number => routeGraph.edges
    .filter((edge) => edge.laneId === laneId)
    .reduce((total, edge) => total + edge.distance, 0);
  const laneWidth = (laneId: string, fallback: number): number => routeGraph.edges
    .filter((edge) => edge.laneId === laneId)
    .reduce((width, edge) => Math.max(width, edge.width), fallback);
  const createLane = (
    id: string,
    label: string,
    kind: LaneDescriptor['kind'],
    coverDensityTarget: number,
    verticalityBand: LaneDescriptor['verticalityBand']
  ): LaneDescriptor => {
    const expectedDistance = laneDistance(id);
    return {
      id,
      label,
      kind,
      nodeIds: routeGraph.nodes.filter((node) => node.laneIds.includes(id)).map((node) => node.id),
      width: laneWidth(id, id === ROAD_LANE_PRIMARY ? 9 : 6),
      expectedDistance,
      expectedTravelTimeSeconds: expectedDistance / getLaneTravelSpeed(id),
      coverDensityTarget,
      verticalityBand,
    };
  };
  const lanes: LaneDescriptor[] = [
    createLane(ROAD_LANE_PRIMARY, 'Primary Roads', 'primary', 0.54, { minY: 3, maxY: 34 }),
    createLane(ROAD_LANE_OUTER, 'Outer Rotations', 'flank', 0.58, { minY: 3, maxY: 30 }),
    createLane(ROAD_LANE_LOOP, 'Settlement Loop', 'flank', 0.5, { minY: 3, maxY: 30 }),
    createLane(ROAD_LANE_SETTLEMENT, 'Settlement Paths', 'access', 0.68, { minY: 4, maxY: 38 }),
    createLane(ROAD_LANE_WILD, 'Wildland Routes', 'access', 0.42, { minY: 3, maxY: 32 }),
  ].filter((lane) => lane.nodeIds.length > 0);
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
    id: `battle_royal_${layout.profile.mapSize}_${normalizedSeed.toString(16).padStart(8, '0')}`,
    version: CONSTRUCTED_MAP_MANIFEST_VERSION,
    seed: normalizedSeed,
    mapSize: layout.profile.mapSize,
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
      namedLocations,
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
