import { DEFAULT_GAME_CONFIG, FLAG_CAPTURE_RADIUS, FLAG_PICKUP_RADIUS } from '../../constants/game.js';
import type { Vec3 } from '../../types/vector.js';
import { clamp, lerp } from '../../utils/math.js';
import { clampToBoundaryPolygon } from './boundaries.js';
import {
  PROCEDURAL_MAP_FOOTPRINT_SCALE,
  PROCEDURAL_MAP_SCALE,
  PROCEDURAL_VOXEL_SIZE,
  createProceduralCTFLayout,
  getVoxelMapSizeDefinition,
  type ProceduralCTFLayout,
} from './ctfLayout.js';
import { createBattleRoyalMapPreview } from './battleRoyalGenerator.js';
import { hashSeed, mulberry32 } from './rng.js';
import { getVoxelMapTheme } from './themes.js';
import type {
  BaseZone,
  BlueprintPreview,
  BoundaryPoint,
  FlagZone,
  LaneDescriptor,
  LaneKind,
  MapBlueprint,
  MapDesignBrief,
  MapDiagnostics,
  MapPerformanceBudget,
  MapProfileId,
  MapTeam,
  MapTopologyId,
  ModuleConnector,
  ModuleDefinition,
  ModuleInstance,
  ProtectedZone,
  RouteGraph,
  RouteGraphEdge,
  RouteGraphNode,
  SightlineSample,
  SpawnCluster,
  TacticalSlot,
  TacticalSlotRole,
  TeamMap,
  TerrainConstraint,
  VoxelMapStats,
  VoxelMapSizeId,
  VoxelMapTheme,
} from './types.js';

export interface ProceduralMapPreview {
  seed: number;
  mapSize: VoxelMapSizeId;
  familyId: MapDesignBrief['familyId'];
  topologyId: MapTopologyId;
  themeId: VoxelMapTheme['id'];
  themeName: string;
  name: string;
  preview: BlueprintPreview;
  diagnostics: Pick<MapDiagnostics, 'score' | 'scoreBreakdown' | 'laneLengths' | 'routeChoiceCount' | 'warnings'>;
}

export interface MapConstructionResult {
  designBrief: MapDesignBrief;
  blueprint: MapBlueprint;
  rejectedCandidates: MapDiagnostics['rejectedCandidates'];
  moduleDefinitions: ModuleDefinition[];
}

export interface CompiledMapDiagnosticInput {
  stats: VoxelMapStats;
  stageTimingsMs?: Record<string, number>;
  repairActions?: Record<string, number>;
  spawnVisibilityPairs?: number;
  acceptedModuleIds?: string[];
  rejectedModuleReasons?: Record<string, number>;
}

const STREAM_NAMES = [
  'topology',
  'boundary',
  'bases',
  'lanes',
  'slots',
  'modules',
  'terrain',
  'materials',
  'dressing',
  'diagnostics',
];

const TOPOLOGIES: MapTopologyId[] = ['lane_triad', 'diamond', 'hourglass', 'ring', 'split_level'];
const DEFAULT_PAD_HEIGHT_ROWS = Math.round(5 / PROCEDURAL_VOXEL_SIZE.y);
const PLAYER_TRAVEL_SPEED = 7.6;
const OPTIONAL_GENERATED_SLOT_ROLES = new Set<TacticalSlotRole>([
  'defender_perch',
  'flank_landmark',
  'soft_cover_cluster',
  'underpass',
  'elevated_bridge',
  'traversal_ramp',
  'tunnel_entrance',
]);

export const MAP_MODULE_DEFINITIONS: ModuleDefinition[] = [
  {
    id: 'base_courtyard',
    name: 'Base Courtyard',
    roleTags: ['base_shell', 'base', 'structure'],
    footprintShape: 'rect',
    heightRangeRows: { min: 12, max: 28 },
    connectorKinds: ['entrance', 'exit', 'ramp'],
    coverContribution: 0.58,
    occlusionContribution: 0.42,
    traversalAffordances: ['cover', 'ramp'],
    blockBudgetEstimate: 5200,
    colliderBudgetEstimate: 420,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'accent',
  },
  {
    id: 'spawn_shelter',
    name: 'Spawn Shelter',
    roleTags: ['spawn_shelter', 'base', 'structure'],
    footprintShape: 'rect',
    heightRangeRows: { min: 10, max: 20 },
    connectorKinds: ['entrance', 'exit'],
    coverContribution: 0.72,
    occlusionContribution: 0.5,
    traversalAffordances: ['cover'],
    blockBudgetEstimate: 2800,
    colliderBudgetEstimate: 260,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'accent',
  },
  {
    id: 'flag_pedestal',
    name: 'Flag Pedestal',
    roleTags: ['flag_stand', 'base', 'structure'],
    footprintShape: 'circle',
    heightRangeRows: { min: 3, max: 8 },
    connectorKinds: ['entrance'],
    coverContribution: 0.2,
    occlusionContribution: 0.05,
    traversalAffordances: ['cover'],
    blockBudgetEstimate: 900,
    colliderBudgetEstimate: 80,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'occupy',
  },
  {
    id: 'midfield_wall',
    name: 'Midfield Wall',
    roleTags: ['midfield_occluder', 'hard_cover_cluster', 'route_cover', 'structure'],
    footprintShape: 'capsule',
    heightRangeRows: { min: 18, max: 42 },
    connectorKinds: ['sightline_blocker'],
    coverContribution: 0.64,
    occlusionContribution: 0.9,
    traversalAffordances: ['cover'],
    blockBudgetEstimate: 4600,
    colliderBudgetEstimate: 360,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'avoid',
  },
  {
    id: 'side_lane_ruin',
    name: 'Side-Lane Ruin',
    roleTags: ['side_lane_cover_chain', 'hard_cover_cluster', 'route_cover', 'structure'],
    footprintShape: 'rect',
    heightRangeRows: { min: 9, max: 24 },
    connectorKinds: ['entrance', 'exit'],
    coverContribution: 0.76,
    occlusionContribution: 0.38,
    traversalAffordances: ['cover'],
    blockBudgetEstimate: 3200,
    colliderBudgetEstimate: 290,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'avoid',
  },
  {
    id: 'bridge_platform',
    name: 'Bridge Platform',
    roleTags: ['elevated_bridge', 'traversal', 'structure'],
    footprintShape: 'capsule',
    heightRangeRows: { min: 12, max: 28 },
    connectorKinds: ['bridge', 'ramp', 'exit'],
    coverContribution: 0.34,
    occlusionContribution: 0.24,
    traversalAffordances: ['bridge', 'ramp'],
    blockBudgetEstimate: 3600,
    colliderBudgetEstimate: 340,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'avoid',
  },
  {
    id: 'tunnel_segment',
    name: 'Tunnel Segment',
    roleTags: ['underpass', 'tunnel_entrance', 'traversal', 'natural'],
    footprintShape: 'capsule',
    heightRangeRows: { min: 10, max: 22 },
    connectorKinds: ['tunnel', 'entrance', 'exit'],
    coverContribution: 0.46,
    occlusionContribution: 0.68,
    traversalAffordances: ['tunnel'],
    blockBudgetEstimate: 4200,
    colliderBudgetEstimate: 400,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'avoid',
  },
  {
    id: 'tower_perch',
    name: 'Tower Perch',
    roleTags: ['defender_perch', 'flank_landmark', 'landmark', 'structure'],
    footprintShape: 'circle',
    heightRangeRows: { min: 22, max: 48 },
    connectorKinds: ['entrance', 'ramp'],
    coverContribution: 0.38,
    occlusionContribution: 0.36,
    traversalAffordances: ['perch', 'cover'],
    blockBudgetEstimate: 3000,
    colliderBudgetEstimate: 300,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'avoid',
  },
  {
    id: 'boulder_field',
    name: 'Boulder Field',
    roleTags: ['soft_cover_cluster', 'flank_landmark', 'natural', 'route_cover'],
    footprintShape: 'circle',
    heightRangeRows: { min: 6, max: 22 },
    connectorKinds: ['sightline_blocker'],
    coverContribution: 0.68,
    occlusionContribution: 0.45,
    traversalAffordances: ['cover'],
    blockBudgetEstimate: 2600,
    colliderBudgetEstimate: 260,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'avoid',
  },
  {
    id: 'soft_natural_cover_patch',
    name: 'Soft Natural Cover Patch',
    roleTags: ['soft_cover_cluster', 'natural', 'route_cover'],
    footprintShape: 'circle',
    heightRangeRows: { min: 4, max: 18 },
    connectorKinds: ['sightline_blocker'],
    coverContribution: 0.44,
    occlusionContribution: 0.2,
    traversalAffordances: ['cover'],
    blockBudgetEstimate: 1600,
    colliderBudgetEstimate: 180,
    allowedThemes: ['any'],
    protectedZoneBehavior: 'avoid',
  },
];

function streamSeed(seed: number, name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hashSeed(seed ^ hash);
}

function createRngStreams(seed: number): Record<string, number> {
  return Object.fromEntries(STREAM_NAMES.map((name) => [name, streamSeed(seed, name)]));
}

function scaleMap(value: number): number {
  return value * PROCEDURAL_MAP_SCALE;
}

function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

function add2(point: Vec3, direction: { x: number; z: number }, amount: number): Vec3 {
  return { x: point.x + direction.x * amount, y: point.y, z: point.z + direction.z * amount };
}

function midpoint(a: Vec3, b: Vec3, y = (a.y + b.y) / 2): Vec3 {
  return { x: (a.x + b.x) / 2, y, z: (a.z + b.z) / 2 };
}

function distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function distance3D(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function normalize2D(vector: { x: number; z: number }, fallback = { x: 0, z: 1 }): { x: number; z: number } {
  const length = Math.hypot(vector.x, vector.z);
  if (length < 0.0001) return fallback;
  return { x: vector.x / length, z: vector.z / length };
}

function perpendicular(direction: { x: number; z: number }): { x: number; z: number } {
  return { x: -direction.z, z: direction.x };
}

function averagePoint(points: Vec3[]): Vec3 {
  if (points.length === 0) return vec3(0, 5, 0);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    z: points.reduce((sum, point) => sum + point.z, 0) / points.length,
  };
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

function distanceToSegment(
  point: { x: number; z: number },
  start: { x: number; z: number },
  end: { x: number; z: number }
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 0.0001) return distance2D(point, start);
  const t = clamp(((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq, 0, 1);
  return distance2D(point, { x: start.x + dx * t, z: start.z + dz * t });
}

function distanceToBoundary(worldX: number, worldZ: number, boundary: BoundaryPoint[]): number {
  let closestDistance = Infinity;
  for (let index = 0; index < boundary.length; index++) {
    closestDistance = Math.min(
      closestDistance,
      distanceToSegment({ x: worldX, z: worldZ }, boundary[index], boundary[(index + 1) % boundary.length])
    );
  }
  return closestDistance;
}

function clampToBoundary(point: Vec3, boundary: BoundaryPoint[], inset = scaleMap(3)): Vec3 {
  const clamped = clampToBoundaryPolygon(point.x, point.z, boundary);
  const boundaryDistance = distanceToBoundary(clamped.x, clamped.z, boundary);
  if (boundaryDistance >= inset) return { ...point, x: clamped.x, z: clamped.z };

  const center = boundary.reduce(
    (sum, next) => ({ x: sum.x + next.x / boundary.length, z: sum.z + next.z / boundary.length }),
    { x: 0, z: 0 }
  );
  const inward = normalize2D({ x: center.x - clamped.x, z: center.z - clamped.z });
  return {
    ...point,
    x: clamped.x + inward.x * (inset - boundaryDistance),
    z: clamped.z + inward.z * (inset - boundaryDistance),
  };
}

function routeDistance(points: Vec3[]): number {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    distance += distance2D(points[index - 1], points[index]);
  }
  return distance;
}

function makeZoneCenter(point: Vec3): Vec3 {
  return { x: point.x, y: point.y, z: point.z };
}

function createDesignBrief(
  seed: number,
  theme: VoxelMapTheme,
  topologyId?: MapTopologyId,
  mapSize?: VoxelMapSizeId
): MapDesignBrief {
  const normalizedSeed = seed >>> 0;
  const streams = createRngStreams(normalizedSeed);
  const topology = topologyId ?? TOPOLOGIES[streams.topology % TOPOLOGIES.length];
  const mapSizeDefinition = getVoxelMapSizeDefinition(mapSize);
  const mapAreaScale = mapSizeDefinition.scale ** 2;
  const performanceBudget: MapPerformanceBudget = {
    maxSolidBlocks: Math.round(1_750_000 * mapAreaScale),
    maxColliders: Math.round(48_000 * Math.max(0.8, mapAreaScale)),
    maxRenderableChunks: Math.round(1_100 * PROCEDURAL_MAP_FOOTPRINT_SCALE ** 2 * mapAreaScale),
    maxGenerationMs: 900,
  };

  return {
    seed: normalizedSeed,
    mapSize: mapSizeDefinition.id,
    gameMode: 'ctf',
    teamSize: DEFAULT_GAME_CONFIG.teamSize,
    familyId: 'ctf_semantic_arena',
    themeId: theme.id,
    targetMatchLengthSeconds: DEFAULT_GAME_CONFIG.roundTimeSeconds,
    desiredTopology: topology,
    desiredSymmetry: topology === 'ring' ? 'rotational' : topology === 'split_level' ? 'asymmetric_balanced' : 'mirrored',
    performanceBudget,
    rngStreams: streams,
  };
}

export function createMapDesignBrief(seed = 0, topologyId?: MapTopologyId, mapSize?: VoxelMapSizeId): MapDesignBrief {
  return createDesignBrief(seed, getVoxelMapTheme(seed), topologyId, mapSize);
}

function createNode(id: string, kind: RouteGraphNode['kind'], position: Vec3, laneIds: string[], tags: string[], team?: MapTeam): RouteGraphNode {
  return { id, kind, position, team, laneIds, tags };
}

function createEdge(
  from: RouteGraphNode,
  to: RouteGraphNode,
  lane: Pick<LaneDescriptor, 'id' | 'width' | 'kind'>,
  traversal: RouteGraphEdge['traversal'] = 'ground',
  tags: string[] = []
): RouteGraphEdge {
  const distance = distance2D(from.position, to.position);
  return {
    id: `${lane.id}:${from.id}->${to.id}`,
    from: from.id,
    to: to.id,
    laneId: lane.id,
    distance,
    expectedTravelTimeSeconds: distance / PLAYER_TRAVEL_SPEED,
    width: lane.width,
    traversal,
    tags: [lane.kind, ...tags],
  };
}

function lane(
  id: string,
  label: string,
  kind: LaneKind,
  nodeIds: string[],
  width: number,
  points: Vec3[],
  coverDensityTarget: number,
  verticalityBand = { minY: 4, maxY: 8 }
): LaneDescriptor {
  const expectedDistance = routeDistance(points);
  return {
    id,
    label,
    kind,
    nodeIds,
    width,
    expectedDistance,
    expectedTravelTimeSeconds: expectedDistance / PLAYER_TRAVEL_SPEED,
    coverDensityTarget,
    verticalityBand,
  };
}

function topologyParams(topologyId: MapTopologyId, random: () => number): {
  flankOffset: number;
  primaryWidth: number;
  flankWidth: number;
  midOffset: number;
  coverBias: number;
  verticalityMaxY: number;
} {
  const jitter = lerp(-0.7, 0.7, random());
  switch (topologyId) {
    case 'diamond':
      return {
        flankOffset: scaleMap(13.2 + jitter),
        primaryWidth: scaleMap(7.5),
        flankWidth: scaleMap(6.3),
        midOffset: scaleMap(1.6 * jitter),
        coverBias: 0.58,
        verticalityMaxY: 8,
      };
    case 'hourglass':
      return {
        flankOffset: scaleMap(9.8 + jitter),
        primaryWidth: scaleMap(5.6),
        flankWidth: scaleMap(5.4),
        midOffset: scaleMap(0.8 * jitter),
        coverBias: 0.72,
        verticalityMaxY: 7,
      };
    case 'ring':
      return {
        flankOffset: scaleMap(16.2 + jitter),
        primaryWidth: scaleMap(6.6),
        flankWidth: scaleMap(6.8),
        midOffset: scaleMap(2.4 * jitter),
        coverBias: 0.5,
        verticalityMaxY: 8,
      };
    case 'split_level':
      return {
        flankOffset: scaleMap(12.4 + jitter),
        primaryWidth: scaleMap(6.2),
        flankWidth: scaleMap(5.9),
        midOffset: scaleMap(2.8 * jitter),
        coverBias: 0.54,
        verticalityMaxY: 11,
      };
    case 'lane_triad':
    default:
      return {
        flankOffset: scaleMap(11.6 + jitter),
        primaryWidth: scaleMap(7.0),
        flankWidth: scaleMap(5.8),
        midOffset: scaleMap(1.2 * jitter),
        coverBias: 0.62,
        verticalityMaxY: 8,
      };
  }
}

function createBaseZone(team: MapTeam, flag: Vec3, spawnCenter: Vec3, outward: { x: number; z: number }, normal: { x: number; z: number }): BaseZone {
  const center = midpoint(flag, spawnCenter, flag.y);
  return {
    id: `${team}_base`,
    shape: 'circle',
    team,
    center,
    radius: scaleMap(8.8),
    facing: outward,
    exits: [
      add2(flag, { x: -outward.x, z: -outward.z }, scaleMap(4.2)),
      add2(flag, normal, scaleMap(4.4)),
      add2(flag, { x: -normal.x, z: -normal.z }, scaleMap(4.4)),
    ],
    defensivePositions: [
      add2(flag, normal, scaleMap(3.4)),
      add2(flag, { x: -normal.x, z: -normal.z }, scaleMap(3.4)),
      add2(spawnCenter, { x: -outward.x, z: -outward.z }, scaleMap(2.6)),
    ],
  };
}

function createFlagZone(team: MapTeam, flag: Vec3, outward: { x: number; z: number }, normal: { x: number; z: number }): FlagZone {
  return {
    id: `${team}_flag`,
    shape: 'circle',
    team,
    center: makeZoneCenter(flag),
    radius: FLAG_CAPTURE_RADIUS,
    pickupRadius: FLAG_PICKUP_RADIUS,
    captureRadius: FLAG_CAPTURE_RADIUS,
    facing: outward,
    approachDirections: [
      add2(flag, { x: -outward.x, z: -outward.z }, 1),
      add2(flag, normal, 1),
      add2(flag, { x: -normal.x, z: -normal.z }, 1),
    ],
    returnPathNodeIds: [`${team}_spawn`, `${team}_flag`, 'midfield'],
  };
}

function createSpawnCluster(team: MapTeam, points: Vec3[], flag: Vec3, outward: { x: number; z: number }, normal: { x: number; z: number }): SpawnCluster {
  const center = averagePoint(points);
  return {
    id: `${team}_spawn_cluster`,
    shape: 'circle',
    team,
    center,
    radius: scaleMap(5.2),
    points,
    fallbackPoints: [
      add2(center, normal, scaleMap(1.8)),
      add2(center, { x: -normal.x, z: -normal.z }, scaleMap(1.8)),
      midpoint(center, flag, center.y),
    ],
    protectedExitDirections: [
      vec3(normalize2D({ x: flag.x - center.x, z: flag.z - center.z }).x, 0, normalize2D({ x: flag.x - center.x, z: flag.z - center.z }).z),
      vec3(normal.x, 0, normal.z),
      vec3(-normal.x, 0, -normal.z),
    ],
    facing: normalize2D({ x: flag.x - center.x, z: flag.z - center.z }),
  };
}

function createProtectedZones(bases: TeamMap<BaseZone>, flags: TeamMap<FlagZone>, spawns: TeamMap<SpawnCluster>, lanes: LaneDescriptor[], nodes: RouteGraphNode[]): ProtectedZone[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const zones: ProtectedZone[] = [
    {
      id: 'red_base_protected',
      kind: 'base',
      team: 'red',
      shape: 'circle',
      center: bases.red.center,
      radius: bases.red.radius,
      clearanceRadius: scaleMap(8.2),
      blocksDressing: true,
      blocksModules: false,
    },
    {
      id: 'blue_base_protected',
      kind: 'base',
      team: 'blue',
      shape: 'circle',
      center: bases.blue.center,
      radius: bases.blue.radius,
      clearanceRadius: scaleMap(8.2),
      blocksDressing: true,
      blocksModules: false,
    },
    ...(['red', 'blue'] as MapTeam[]).flatMap((team): ProtectedZone[] => [
      {
        id: `${team}_flag_clearance`,
        kind: 'flag',
        team,
        shape: 'circle',
        center: flags[team].center,
        radius: scaleMap(4.7),
        clearanceRadius: scaleMap(4.7),
        blocksDressing: true,
        blocksModules: true,
      },
      {
        id: `${team}_spawn_clearance`,
        kind: 'spawn',
        team,
        shape: 'circle',
        center: spawns[team].center,
        radius: scaleMap(4.1),
        clearanceRadius: scaleMap(4.1),
        blocksDressing: true,
        blocksModules: true,
      },
    ]),
  ];

  for (const laneDescriptor of lanes) {
    const laneNodes: RouteGraphNode[] = [];
    for (const nodeId of laneDescriptor.nodeIds) {
      const node = nodesById.get(nodeId);
      if (node) laneNodes.push(node);
    }
    zones.push({
      id: `${laneDescriptor.id}_route_clearance`,
      kind: 'route',
      shape: 'capsule',
      center: midpoint(laneNodes[0]?.position ?? flags.red.center, laneNodes[laneNodes.length - 1]?.position ?? flags.blue.center),
      points: laneNodes.map((node) => ({ x: node.position.x, y: node.position.y, z: node.position.z })),
      radius: laneDescriptor.width * 0.48,
      clearanceRadius: laneDescriptor.width * 0.48,
      blocksDressing: laneDescriptor.kind === 'primary',
      blocksModules: false,
    });
  }

  return zones;
}

function createTacticalSlot(
  id: string,
  role: TacticalSlotRole,
  position: Vec3,
  facing: { x: number; z: number },
  allowedModuleIds: string[],
  options: Partial<Omit<TacticalSlot, 'id' | 'role' | 'position' | 'facing' | 'allowedModuleIds' | 'footprint' | 'heightBand' | 'budget'>> & {
    footprint?: TacticalSlot['footprint'];
    heightBand?: TacticalSlot['heightBand'];
    budget?: Partial<TacticalSlot['budget']>;
  } = {}
): TacticalSlot {
  const defaultRadius = role === 'midfield_occluder' ? scaleMap(5.5) : role === 'flag_stand' ? scaleMap(2.2) : scaleMap(3.8);
  return {
    id,
    role,
    position,
    facing,
    footprint: options.footprint ?? { shape: 'circle', radius: defaultRadius },
    heightBand: options.heightBand ?? { minRows: 4, maxRows: 28 },
    allowedModuleIds,
    protectedClearance: options.protectedClearance ?? scaleMap(2.8),
    laneId: options.laneId,
    nodeId: options.nodeId,
    edgeId: options.edgeId,
    team: options.team,
    sightlinePurpose: options.sightlinePurpose,
    budget: {
      cover: options.budget?.cover ?? 0.45,
      occlusion: options.budget?.occlusion ?? 0.35,
      verticality: options.budget?.verticality ?? 0.2,
      estimatedSolidBlocks: options.budget?.estimatedSolidBlocks ?? 2600,
      estimatedColliders: options.budget?.estimatedColliders ?? 240,
    },
  };
}

function createSlots(
  topologyId: MapTopologyId,
  boundary: BoundaryPoint[],
  bases: TeamMap<BaseZone>,
  flags: TeamMap<FlagZone>,
  spawns: TeamMap<SpawnCluster>,
  nodesById: Map<string, RouteGraphNode>,
  normal: { x: number; z: number },
  axis: { x: number; z: number }
): TacticalSlot[] {
  const midfield = nodesById.get('midfield')?.position ?? vec3(0, DEFAULT_PAD_HEIGHT_ROWS * PROCEDURAL_VOXEL_SIZE.y, 0);
  const leftMid = nodesById.get('left_contest')?.position ?? add2(midfield, normal, scaleMap(10));
  const rightMid = nodesById.get('right_contest')?.position ?? add2(midfield, { x: -normal.x, z: -normal.z }, scaleMap(10));
  const slots: TacticalSlot[] = [];

  for (const team of ['red', 'blue'] as MapTeam[]) {
    const enemyDirection = normalize2D({
      x: flags[team === 'red' ? 'blue' : 'red'].center.x - flags[team].center.x,
      z: flags[team === 'red' ? 'blue' : 'red'].center.z - flags[team].center.z,
    });
    slots.push(
      createTacticalSlot(`${team}_base_shell`, 'base_shell', bases[team].center, enemyDirection, ['base_courtyard'], {
        team,
        nodeId: `${team}_base`,
        footprint: { shape: 'rect', halfExtents: { x: scaleMap(5.2), z: scaleMap(4.6) } },
        budget: { cover: 0.62, occlusion: 0.42, estimatedSolidBlocks: 5200, estimatedColliders: 420 },
      }),
      createTacticalSlot(`${team}_spawn_shelter`, 'spawn_shelter', spawns[team].center, spawns[team].facing, ['spawn_shelter'], {
        team,
        nodeId: `${team}_spawn`,
        footprint: { shape: 'rect', halfExtents: { x: scaleMap(3.6), z: scaleMap(2.8) } },
        budget: { cover: 0.8, occlusion: 0.48, estimatedSolidBlocks: 2800, estimatedColliders: 260 },
      }),
      createTacticalSlot(`${team}_flag_stand`, 'flag_stand', flags[team].center, enemyDirection, ['flag_pedestal'], {
        team,
        nodeId: `${team}_flag`,
        footprint: { shape: 'circle', radius: scaleMap(2.1) },
        budget: { cover: 0.2, occlusion: 0.05, estimatedSolidBlocks: 900, estimatedColliders: 80 },
      }),
      createTacticalSlot(`${team}_defender_perch`, 'defender_perch', clampToBoundary(add2(flags[team].center, normal, team === 'red' ? scaleMap(4.8) : -scaleMap(4.8)), boundary), enemyDirection, ['tower_perch'], {
        team,
        footprint: { shape: 'circle', radius: scaleMap(2.8) },
        heightBand: { minRows: 16, maxRows: topologyId === 'split_level' ? 44 : 30 },
        budget: { cover: 0.36, occlusion: 0.32, verticality: 0.72, estimatedSolidBlocks: 3000, estimatedColliders: 300 },
      })
    );
  }

  slots.push(
    createTacticalSlot('midfield_occluder', 'midfield_occluder', midfield, normal, ['midfield_wall'], {
      laneId: 'primary',
      nodeId: 'midfield',
      sightlinePurpose: 'block_spawn_to_spawn',
      footprint: { shape: 'capsule', radius: topologyId === 'hourglass' ? scaleMap(6.4) : scaleMap(5.2) },
      heightBand: { minRows: 18, maxRows: topologyId === 'split_level' ? 46 : 38 },
      budget: { cover: 0.58, occlusion: 0.92, estimatedSolidBlocks: 4600, estimatedColliders: 360 },
    }),
    createTacticalSlot('left_flank_landmark', 'flank_landmark', leftMid, { x: -axis.x, z: -axis.z }, ['tower_perch', 'boulder_field'], {
      laneId: 'left_flank',
      nodeId: 'left_contest',
      footprint: { shape: 'circle', radius: scaleMap(4.4) },
      heightBand: { minRows: 8, maxRows: topologyId === 'split_level' ? 38 : 28 },
      budget: { cover: 0.52, occlusion: 0.36, verticality: 0.46, estimatedSolidBlocks: 3000, estimatedColliders: 300 },
    }),
    createTacticalSlot('right_flank_landmark', 'flank_landmark', rightMid, axis, ['boulder_field', 'side_lane_ruin'], {
      laneId: 'right_flank',
      nodeId: 'right_contest',
      footprint: { shape: 'circle', radius: scaleMap(4.4) },
      budget: { cover: 0.56, occlusion: 0.34, estimatedSolidBlocks: 2900, estimatedColliders: 280 },
    })
  );

  for (const [laneId, sidePosition, sideNormal] of [
    ['left_flank', leftMid, normal],
    ['right_flank', rightMid, { x: -normal.x, z: -normal.z }],
  ] as const) {
    slots.push(
      createTacticalSlot(`${laneId}_cover_red`, 'side_lane_cover_chain', clampToBoundary(add2(sidePosition, axis, scaleMap(8.2)), boundary), { x: -axis.x, z: -axis.z }, ['side_lane_ruin', 'soft_natural_cover_patch'], {
        laneId,
        footprint: { shape: 'rect', halfExtents: { x: scaleMap(3.6), z: scaleMap(2.7) } },
        budget: { cover: 0.74, occlusion: 0.38, estimatedSolidBlocks: 3200, estimatedColliders: 290 },
      }),
      createTacticalSlot(`${laneId}_cover_blue`, 'side_lane_cover_chain', clampToBoundary(add2(sidePosition, { x: -axis.x, z: -axis.z }, scaleMap(8.2)), boundary), axis, ['side_lane_ruin', 'soft_natural_cover_patch'], {
        laneId,
        footprint: { shape: 'rect', halfExtents: { x: scaleMap(3.6), z: scaleMap(2.7) } },
        budget: { cover: 0.74, occlusion: 0.38, estimatedSolidBlocks: 3200, estimatedColliders: 290 },
      }),
      createTacticalSlot(`${laneId}_soft_cover`, 'soft_cover_cluster', clampToBoundary(add2(sidePosition, sideNormal, scaleMap(2.6)), boundary), axis, ['boulder_field', 'soft_natural_cover_patch'], {
        laneId,
        footprint: { shape: 'circle', radius: scaleMap(3.2) },
        budget: { cover: 0.48, occlusion: 0.22, estimatedSolidBlocks: 1700, estimatedColliders: 180 },
      })
    );
  }

  if (topologyId === 'split_level') {
    slots.push(
      createTacticalSlot('upper_bridge', 'elevated_bridge', clampToBoundary(add2(midfield, normal, scaleMap(4.2)), boundary), axis, ['bridge_platform'], {
        laneId: 'primary',
        footprint: { shape: 'capsule', radius: scaleMap(4.6) },
        heightBand: { minRows: 18, maxRows: 36 },
        budget: { cover: 0.34, occlusion: 0.24, verticality: 0.86, estimatedSolidBlocks: 3600, estimatedColliders: 340 },
      })
    );
  }

  if (topologyId === 'ring' || topologyId === 'hourglass') {
    slots.push(
      createTacticalSlot('lower_underpass', 'underpass', clampToBoundary(add2(midfield, { x: -normal.x, z: -normal.z }, scaleMap(4.2)), boundary), axis, ['tunnel_segment'], {
        laneId: 'primary',
        footprint: { shape: 'capsule', radius: scaleMap(4.6) },
        budget: { cover: 0.46, occlusion: 0.68, verticality: 0.22, estimatedSolidBlocks: 4200, estimatedColliders: 400 },
      })
    );
  }

  return slots;
}

function chooseModuleDefinition(slot: TacticalSlot, theme: VoxelMapTheme, random: () => number): ModuleDefinition {
  const compatible = MAP_MODULE_DEFINITIONS.filter(
    (definition) =>
      slot.allowedModuleIds.includes(definition.id) &&
      (definition.allowedThemes.includes('any') || definition.allowedThemes.includes(theme.id))
  );
  if (compatible.length === 0) {
    return MAP_MODULE_DEFINITIONS[0];
  }
  return compatible[Math.floor(random() * compatible.length) % compatible.length];
}

function createConnectors(slot: TacticalSlot, definition: ModuleDefinition): ModuleConnector[] {
  const facing = normalize2D(slot.facing);
  const normal = perpendicular(facing);
  const radius = slot.footprint.radius ?? Math.max(slot.footprint.halfExtents?.x ?? scaleMap(2), slot.footprint.halfExtents?.z ?? scaleMap(2));
  return definition.connectorKinds.slice(0, 3).map((kind, index) => {
    const direction = index === 1 ? normal : index === 2 ? { x: -normal.x, z: -normal.z } : facing;
    const offset = kind === 'sightline_blocker' ? 0 : radius * 0.85;
    return {
      id: `${slot.id}_${kind}_${index + 1}`,
      kind,
      position: add2(slot.position, direction, offset),
      direction,
      width: kind === 'bridge' || kind === 'tunnel' ? scaleMap(3.4) : scaleMap(2.2),
    };
  });
}

function instantiateModules(slots: TacticalSlot[], theme: VoxelMapTheme, seed: number): ModuleInstance[] {
  const random = mulberry32(streamSeed(seed, 'modules'));
  return slots.map((slot) => {
    const definition = chooseModuleDefinition(slot, theme, random);
    return {
      id: `${slot.id}_${definition.id}`,
      moduleId: definition.id,
      slotId: slot.id,
      roleTags: definition.roleTags,
      position: slot.position,
      facing: slot.facing,
      footprint: slot.footprint,
      connectors: createConnectors(slot, definition),
      estimatedSolidBlocks: Math.min(slot.budget.estimatedSolidBlocks, definition.blockBudgetEstimate),
      estimatedColliders: Math.min(slot.budget.estimatedColliders, definition.colliderBudgetEstimate),
      validation: {
        status: 'planned',
        reasons: [],
      },
    };
  });
}

function terrainConstraintFromSlot(slot: TacticalSlot): TerrainConstraint {
  return {
    id: `${slot.id}_module_pad`,
    kind: 'module_pad',
    center: slot.position,
    radius: slot.footprint.radius ?? Math.max(slot.footprint.halfExtents?.x ?? scaleMap(2), slot.footprint.halfExtents?.z ?? scaleMap(2)),
    targetHeightRows: DEFAULT_PAD_HEIGHT_ROWS,
    maxStepRows: 1,
    priority: slot.role === 'midfield_occluder' ? 0.72 : 0.56,
    laneId: slot.laneId,
    slotId: slot.id,
    team: slot.team,
  };
}

function createTerrainConstraints(
  bases: TeamMap<BaseZone>,
  flags: TeamMap<FlagZone>,
  spawns: TeamMap<SpawnCluster>,
  lanes: LaneDescriptor[],
  nodesById: Map<string, RouteGraphNode>,
  slots: TacticalSlot[],
  boundary: BoundaryPoint[]
): TerrainConstraint[] {
  const constraints: TerrainConstraint[] = [];

  for (const team of ['red', 'blue'] as MapTeam[]) {
    constraints.push(
      {
        id: `${team}_base_pad`,
        kind: 'base_pad',
        center: bases[team].center,
        radius: scaleMap(7.2),
        targetHeightRows: DEFAULT_PAD_HEIGHT_ROWS,
        maxStepRows: 1,
        priority: 0.86,
        team,
      },
      {
        id: `${team}_flag_pad`,
        kind: 'flag_pad',
        center: flags[team].center,
        radius: scaleMap(4.8),
        targetHeightRows: DEFAULT_PAD_HEIGHT_ROWS,
        maxStepRows: 1,
        priority: 1,
        team,
      },
      {
        id: `${team}_spawn_pad`,
        kind: 'spawn_pad',
        center: spawns[team].center,
        radius: scaleMap(4.2),
        targetHeightRows: DEFAULT_PAD_HEIGHT_ROWS,
        maxStepRows: 1,
        priority: 0.95,
        team,
      }
    );
  }

  for (const laneDescriptor of lanes) {
    const points: Vec3[] = [];
    for (const nodeId of laneDescriptor.nodeIds) {
      const point = nodesById.get(nodeId)?.position;
      if (point) points.push(point);
    }
    constraints.push({
      id: `${laneDescriptor.id}_centerline`,
      kind: 'lane_centerline',
      points,
      radius: laneDescriptor.width * 0.52,
      width: laneDescriptor.width,
      targetHeightRows: DEFAULT_PAD_HEIGHT_ROWS,
      maxStepRows: 2,
      priority: laneDescriptor.kind === 'primary' ? 0.7 : 0.54,
      laneId: laneDescriptor.id,
    });
  }

  for (const slot of slots) {
    constraints.push(terrainConstraintFromSlot(slot));
    if (slot.role === 'midfield_occluder') {
      constraints.push({
        id: `${slot.id}_sightline_band`,
        kind: 'sightline_band',
        center: slot.position,
        radius: scaleMap(7.2),
        maxStepRows: 3,
        priority: 0.42,
        laneId: slot.laneId,
        slotId: slot.id,
      });
    }
  }

  const bounds = boundaryBounds(boundary);
  constraints.push({
    id: 'boundary_wall_band',
    kind: 'boundary_wall_band',
    center: vec3((bounds.minX + bounds.maxX) / 2, DEFAULT_PAD_HEIGHT_ROWS * PROCEDURAL_VOXEL_SIZE.y, (bounds.minZ + bounds.maxZ) / 2),
    radius: Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) * 0.5,
    maxStepRows: 4,
    priority: 0.34,
  });

  return constraints;
}

function createSightlineSamples(spawns: TeamMap<SpawnCluster>, nodesById: Map<string, RouteGraphNode>): SightlineSample[] {
  const redSpawn = nodesById.get('red_spawn')!;
  const blueSpawn = nodesById.get('blue_spawn')!;
  const midfield = nodesById.get('midfield')!;
  return [
    {
      id: 'spawn_to_spawn_block',
      fromNodeId: redSpawn.id,
      toNodeId: blueSpawn.id,
      from: spawns.red.center,
      to: spawns.blue.center,
      purpose: 'block_spawn_to_spawn',
      maxAllowedDistance: scaleMap(24),
      requiresOcclusion: true,
      status: 'planned',
    },
    {
      id: 'red_spawn_midfield_read',
      fromNodeId: redSpawn.id,
      toNodeId: midfield.id,
      from: spawns.red.center,
      to: midfield.position,
      purpose: 'preserve_lane_read',
      maxAllowedDistance: scaleMap(48),
      requiresOcclusion: false,
      status: 'planned',
    },
    {
      id: 'blue_spawn_midfield_read',
      fromNodeId: blueSpawn.id,
      toNodeId: midfield.id,
      from: spawns.blue.center,
      to: midfield.position,
      purpose: 'preserve_lane_read',
      maxAllowedDistance: scaleMap(48),
      requiresOcclusion: false,
      status: 'planned',
    },
  ];
}

function createPreview(
  boundary: BoundaryPoint[],
  lanes: LaneDescriptor[],
  nodesById: Map<string, RouteGraphNode>,
  slots: TacticalSlot[],
  flags: TeamMap<FlagZone>,
  spawns: TeamMap<SpawnCluster>,
  theme: VoxelMapTheme,
  topologyId: MapTopologyId
): BlueprintPreview {
  const bounds = boundaryBounds(boundary);
  const center = vec3((bounds.minX + bounds.maxX) / 2, 4.5, (bounds.minZ + bounds.maxZ) / 2);
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
  const routes = lanes
    .filter((laneDescriptor) => laneDescriptor.kind !== 'access')
    .map((laneDescriptor) => ({
      id: laneDescriptor.id,
      kind: laneDescriptor.kind,
      points: laneDescriptor.nodeIds
        .map((nodeId) => nodesById.get(nodeId)?.position)
        .filter((point): point is Vec3 => Boolean(point)),
      width: laneDescriptor.width,
    }));

  return {
    camera: {
      position: vec3(center.x + span * 0.16, Math.max(24, span * 0.42), center.z + span * 0.38),
      target: center,
      fov: 52,
      near: 0.1,
      far: 500,
    },
    thumbnailSilhouette: {
      bounds,
      boundary,
      routes,
      landmarks: slots
        .filter((slot) => ['midfield_occluder', 'flank_landmark', 'elevated_bridge', 'underpass'].includes(slot.role))
        .map((slot) => ({
          id: slot.id,
          role: slot.role,
          position: slot.position,
          radius: slot.footprint.radius ?? Math.max(slot.footprint.halfExtents?.x ?? scaleMap(2), slot.footprint.halfExtents?.z ?? scaleMap(2)),
        })),
      objectives: {
        flags: {
          red: flags.red.center,
          blue: flags.blue.center,
        },
        spawns: {
          red: spawns.red.center,
          blue: spawns.blue.center,
        },
      },
    },
    labelTags: [topologyId.replace('_', ' '), theme.name, 'semantic ctf'],
  };
}

function scoreBlueprint(
  candidateId: string,
  topologyId: MapTopologyId,
  lanes: LaneDescriptor[],
  protectedZones: ProtectedZone[],
  slots: TacticalSlot[],
  routeGraph: RouteGraph,
  flags: TeamMap<FlagZone>,
  spawns: TeamMap<SpawnCluster>,
  boundary: BoundaryPoint[]
): Pick<MapDiagnostics, 'score' | 'scoreBreakdown' | 'warnings' | 'routeChoiceCount' | 'laneLengths' | 'laneWidths' | 'coverDensityByLane' | 'maxSightlineLength' | 'flagApproachClearances'> & { rejectedReasons: string[] } {
  let primary: LaneDescriptor | undefined = lanes[0];
  let flankLengthTotal = 0;
  let flankLengthCount = 0;
  let routeChoices = 0;
  const laneLengths: Record<string, number> = {};
  const laneWidths: Record<string, number> = {};
  const coverDensityByLane: Record<string, number> = {};

  for (const laneDescriptor of lanes) {
    if (laneDescriptor.id === 'primary') primary = laneDescriptor;
    if (laneDescriptor.kind === 'flank') {
      flankLengthTotal += laneDescriptor.expectedDistance;
      flankLengthCount++;
    }
    if (laneDescriptor.kind === 'primary' || laneDescriptor.kind === 'flank') {
      routeChoices++;
    }
    laneLengths[laneDescriptor.id] = laneDescriptor.expectedDistance;
    laneWidths[laneDescriptor.id] = laneDescriptor.width;
    coverDensityByLane[laneDescriptor.id] = laneDescriptor.coverDensityTarget;
  }

  const averageFlank = flankLengthTotal / Math.max(1, flankLengthCount);
  const routeBalance = primary ? 1 - clamp(Math.abs(primary.expectedDistance - averageFlank) / Math.max(1, primary.expectedDistance), 0, 1) : 0.5;
  const spawnFlagBalance =
    1 -
    clamp(
      Math.abs(distance2D(spawns.red.center, flags.red.center) - distance2D(spawns.blue.center, flags.blue.center)) /
        Math.max(1, distance2D(spawns.red.center, flags.red.center), distance2D(spawns.blue.center, flags.blue.center)),
      0,
      1
    );
  routeChoices = Math.max(1, routeChoices);
  const routeChoiceScore = clamp(routeChoices / 3, 0, 1);
  const slotCoverage = clamp(slots.length / 14, 0, 1);
  const boundaryClearance = Math.min(
    distanceToBoundary(flags.red.center.x, flags.red.center.z, boundary),
    distanceToBoundary(flags.blue.center.x, flags.blue.center.z, boundary),
    distanceToBoundary(spawns.red.center.x, spawns.red.center.z, boundary),
    distanceToBoundary(spawns.blue.center.x, spawns.blue.center.z, boundary)
  );
  const boundaryScore = clamp(boundaryClearance / scaleMap(8), 0, 1);
  const protectedOverlapPenalty = protectedZones.reduce((penalty, zone, index) => {
    if (!zone.center || !zone.radius) return penalty;
    for (let otherIndex = index + 1; otherIndex < protectedZones.length; otherIndex++) {
      const other = protectedZones[otherIndex];
      if (!other.center || !other.radius) continue;
      if (distance2D(zone.center, other.center) < (zone.radius + other.radius) * 0.52) {
        penalty += 0.03;
      }
    }
    return penalty;
  }, 0);
  const topologyBonus = topologyId === 'split_level' ? 0.03 : topologyId === 'ring' ? 0.02 : 0;
  const scoreBreakdown = {
    routeBalance: routeBalance * 32,
    spawnFlagBalance: spawnFlagBalance * 18,
    routeChoices: routeChoiceScore * 18,
    tacticalSlots: slotCoverage * 20,
    boundaryClearance: boundaryScore * 12,
    topologyIdentity: topologyBonus * 100,
    protectedOverlapPenalty: -protectedOverlapPenalty * 100,
  };
  const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  const warnings: string[] = [];
  const rejectedReasons: string[] = [];

  if (routeChoices < 3) rejectedReasons.push(`${candidateId}: fewer than three route choices`);
  if (boundaryScore < 0.65) rejectedReasons.push(`${candidateId}: protected gameplay points close to boundary`);
  if (protectedOverlapPenalty > 0.12) rejectedReasons.push(`${candidateId}: protected zones overlap heavily`);
  if (score < 58) warnings.push('low semantic layout score');

  let maxRouteEdgeDistance = 0;
  for (const edge of routeGraph.edges) {
    maxRouteEdgeDistance = Math.max(maxRouteEdgeDistance, edge.distance);
  }
  const maxSightlineLength = Math.max(maxRouteEdgeDistance, distance2D(spawns.red.center, spawns.blue.center));
  const flagApproachClearances: TeamMap<number> = {
    red: distanceToBoundary(flags.red.center.x, flags.red.center.z, boundary),
    blue: distanceToBoundary(flags.blue.center.x, flags.blue.center.z, boundary),
  };

  return {
    score,
    scoreBreakdown,
    warnings,
    rejectedReasons,
    routeChoiceCount: routeChoices,
    laneLengths,
    laneWidths,
    coverDensityByLane,
    maxSightlineLength,
    flagApproachClearances,
  };
}

function buildBlueprintCandidate(
  candidateIndex: number,
  brief: MapDesignBrief,
  layout: ProceduralCTFLayout,
  theme: VoxelMapTheme,
  topologyId: MapTopologyId
): MapBlueprint {
  const random = mulberry32(streamSeed(brief.seed ^ Math.imul(candidateIndex + 1, 0x9e3779b1), 'lanes'));
  const params = topologyParams(topologyId, random);
  const redFlag = layout.flagZones.red;
  const blueFlag = layout.flagZones.blue;
  const redSpawnCenter = averagePoint(layout.spawnPoints.red);
  const blueSpawnCenter = averagePoint(layout.spawnPoints.blue);
  const redToBlue = normalize2D({ x: blueFlag.x - redFlag.x, z: blueFlag.z - redFlag.z });
  const blueToRed = { x: -redToBlue.x, z: -redToBlue.z };
  const normal = perpendicular(redToBlue);
  const center = clampToBoundary(add2(midpoint(redFlag, blueFlag, DEFAULT_PAD_HEIGHT_ROWS * PROCEDURAL_VOXEL_SIZE.y), normal, params.midOffset), layout.boundary);
  const flankRedOffset = topologyId === 'diamond' || topologyId === 'ring' ? scaleMap(6.8) : scaleMap(4.6);
  const flankBlueOffset = topologyId === 'diamond' || topologyId === 'ring' ? scaleMap(6.8) : scaleMap(4.6);
  const leftContest = clampToBoundary(add2(center, normal, params.flankOffset), layout.boundary);
  const rightContest = clampToBoundary(add2(center, { x: -normal.x, z: -normal.z }, params.flankOffset), layout.boundary);
  const leftRed = clampToBoundary(add2(add2(redFlag, redToBlue, flankRedOffset), normal, params.flankOffset * 0.72), layout.boundary);
  const leftBlue = clampToBoundary(add2(add2(blueFlag, blueToRed, flankBlueOffset), normal, params.flankOffset * 0.72), layout.boundary);
  const rightRed = clampToBoundary(add2(add2(redFlag, redToBlue, flankRedOffset), { x: -normal.x, z: -normal.z }, params.flankOffset * 0.72), layout.boundary);
  const rightBlue = clampToBoundary(add2(add2(blueFlag, blueToRed, flankBlueOffset), { x: -normal.x, z: -normal.z }, params.flankOffset * 0.72), layout.boundary);

  const laneShells = [
    lane('primary', topologyId === 'hourglass' ? 'Midfield Choke' : 'Main Lane', 'primary', ['red_flag', 'midfield', 'blue_flag'], params.primaryWidth, [redFlag, center, blueFlag], params.coverBias, { minY: 4, maxY: params.verticalityMaxY }),
    lane('left_flank', 'Left Flank', 'flank', ['red_flag', 'left_red', 'left_contest', 'left_blue', 'blue_flag'], params.flankWidth, [redFlag, leftRed, leftContest, leftBlue, blueFlag], Math.max(0.35, params.coverBias - 0.12), { minY: 4, maxY: params.verticalityMaxY }),
    lane('right_flank', 'Right Flank', 'flank', ['red_flag', 'right_red', 'right_contest', 'right_blue', 'blue_flag'], params.flankWidth, [redFlag, rightRed, rightContest, rightBlue, blueFlag], Math.max(0.35, params.coverBias - 0.08), { minY: 4, maxY: params.verticalityMaxY }),
    lane('red_return', 'Red Return', 'return', ['red_spawn', 'red_flag', 'midfield'], params.primaryWidth * 0.8, [redSpawnCenter, redFlag, center], 0.5, { minY: 4, maxY: params.verticalityMaxY }),
    lane('blue_return', 'Blue Return', 'return', ['blue_spawn', 'blue_flag', 'midfield'], params.primaryWidth * 0.8, [blueSpawnCenter, blueFlag, center], 0.5, { minY: 4, maxY: params.verticalityMaxY }),
  ];

  const nodes = [
    createNode('red_base', 'base', midpoint(redFlag, redSpawnCenter, redFlag.y), ['red_return'], ['base'], 'red'),
    createNode('red_spawn', 'spawn', redSpawnCenter, ['red_return'], ['spawn'], 'red'),
    createNode('red_flag', 'flag', redFlag, ['primary', 'left_flank', 'right_flank', 'red_return'], ['flag'], 'red'),
    createNode('midfield', 'midfield', center, ['primary', 'red_return', 'blue_return'], ['contest', topologyId]),
    createNode('left_red', 'flank', leftRed, ['left_flank'], ['flank']),
    createNode('left_contest', 'contest', leftContest, ['left_flank'], ['flank', 'contest']),
    createNode('left_blue', 'flank', leftBlue, ['left_flank'], ['flank']),
    createNode('right_red', 'flank', rightRed, ['right_flank'], ['flank']),
    createNode('right_contest', 'contest', rightContest, ['right_flank'], ['flank', 'contest']),
    createNode('right_blue', 'flank', rightBlue, ['right_flank'], ['flank']),
    createNode('blue_flag', 'flag', blueFlag, ['primary', 'left_flank', 'right_flank', 'blue_return'], ['flag'], 'blue'),
    createNode('blue_spawn', 'spawn', blueSpawnCenter, ['blue_return'], ['spawn'], 'blue'),
    createNode('blue_base', 'base', midpoint(blueFlag, blueSpawnCenter, blueFlag.y), ['blue_return'], ['base'], 'blue'),
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const edges: RouteGraphEdge[] = [];

  for (const laneDescriptor of laneShells) {
    for (let index = 1; index < laneDescriptor.nodeIds.length; index++) {
      const from = nodesById.get(laneDescriptor.nodeIds[index - 1]);
      const to = nodesById.get(laneDescriptor.nodeIds[index]);
      if (!from || !to) continue;
      const traversal: RouteGraphEdge['traversal'] =
        topologyId === 'split_level' && laneDescriptor.id === 'primary' && index === 1
          ? 'bridge'
          : topologyId === 'ring' && laneDescriptor.kind === 'flank'
            ? 'ramp'
            : 'ground';
      edges.push(createEdge(from, to, laneDescriptor, traversal));
      edges.push(createEdge(to, from, laneDescriptor, traversal, ['reverse']));
    }
  }

  const routeGraph: RouteGraph = {
    nodes,
    edges,
    primaryRouteNodeIds: {
      red: ['red_spawn', 'red_flag', 'midfield', 'blue_flag'],
      blue: ['blue_spawn', 'blue_flag', 'midfield', 'red_flag'],
    },
    fallbackAnchorNodeIds: {
      red: ['red_spawn', 'red_base', 'red_flag', 'midfield'],
      blue: ['blue_spawn', 'blue_base', 'blue_flag', 'midfield'],
    },
  };

  const bases: TeamMap<BaseZone> = {
    red: createBaseZone('red', redFlag, redSpawnCenter, blueToRed, normal),
    blue: createBaseZone('blue', blueFlag, blueSpawnCenter, redToBlue, normal),
  };
  const flags: TeamMap<FlagZone> = {
    red: createFlagZone('red', redFlag, blueToRed, normal),
    blue: createFlagZone('blue', blueFlag, redToBlue, normal),
  };
  const spawns: TeamMap<SpawnCluster> = {
    red: createSpawnCluster('red', layout.spawnPoints.red, redFlag, blueToRed, normal),
    blue: createSpawnCluster('blue', layout.spawnPoints.blue, blueFlag, redToBlue, normal),
  };
  const protectedZones = createProtectedZones(bases, flags, spawns, laneShells, nodes);
  const tacticalSlots = createSlots(topologyId, layout.boundary, bases, flags, spawns, nodesById, normal, redToBlue);
  const moduleInstances = instantiateModules(tacticalSlots, theme, brief.seed ^ candidateIndex);
  const terrainConstraints = createTerrainConstraints(bases, flags, spawns, laneShells, nodesById, tacticalSlots, layout.boundary);
  const sightlineSamples = createSightlineSamples(spawns, nodesById);
  const preview = createPreview(layout.boundary, laneShells, nodesById, tacticalSlots, flags, spawns, theme, topologyId);
  const score = scoreBlueprint(
    `candidate_${candidateIndex + 1}`,
    topologyId,
    laneShells,
    protectedZones,
    tacticalSlots,
    routeGraph,
    flags,
    spawns,
    layout.boundary
  );

  const moduleCountsByRole = tacticalSlots.reduce<Record<string, number>>((counts, slot) => {
    counts[slot.role] = (counts[slot.role] ?? 0) + 1;
    return counts;
  }, {});

  const diagnostics: MapDiagnostics = {
    familyId: brief.familyId,
    topologyId,
    themeId: theme.id,
    candidateCount: 1,
    selectedCandidateId: `candidate_${candidateIndex + 1}`,
    rejectedCandidates: [],
    score: score.score,
    scoreBreakdown: score.scoreBreakdown,
    stageTimingsMs: {},
    laneLengths: score.laneLengths,
    laneWidths: score.laneWidths,
    routeChoiceCount: score.routeChoiceCount,
    coverDensityByLane: score.coverDensityByLane,
    maxSightlineLength: score.maxSightlineLength,
    spawnVisibilityPairs: 0,
    flagApproachClearances: score.flagApproachClearances,
    colliderCount: 0,
    chunkCount: 0,
    solidBlockCount: 0,
    moduleCountsByRole,
    repairActions: {},
    warnings: score.warnings,
  };

  return {
    id: `blueprint_${brief.seed}_${topologyId}_${candidateIndex + 1}`,
    seed: brief.seed,
    familyId: brief.familyId,
    topologyId,
    themeId: theme.id,
    boundary: layout.boundary,
    bases,
    flags,
    spawns,
    protectedZones,
    lanes: laneShells,
    routeGraph,
    sightlineSamples,
    tacticalSlots,
    terrainConstraints,
    moduleInstances,
    preview,
    diagnostics,
  };
}

function chooseCandidate(candidates: MapBlueprint[]): { selected: MapBlueprint; rejected: MapDiagnostics['rejectedCandidates'] } {
  const sorted = [...candidates].sort((a, b) => b.diagnostics.score - a.diagnostics.score || a.id.localeCompare(b.id));
  const selected = sorted[0];
  const rejected = sorted.slice(1).map((candidate) => ({
    id: candidate.id,
    score: candidate.diagnostics.score,
    reasons: candidate.diagnostics.warnings.length > 0 ? candidate.diagnostics.warnings : ['lower semantic score than selected candidate'],
  }));
  selected.diagnostics.candidateCount = candidates.length;
  selected.diagnostics.rejectedCandidates = rejected;
  selected.diagnostics.selectedCandidateId = selected.id;
  return { selected, rejected };
}

export function createMapConstruction(
  seed = 0,
  layout = createProceduralCTFLayout(seed >>> 0),
  theme = getVoxelMapTheme(seed >>> 0)
): MapConstructionResult {
  const normalizedSeed = seed >>> 0;
  const baseBrief = createDesignBrief(normalizedSeed, theme, undefined, layout.mapSize);
  const topologyStartIndex = TOPOLOGIES.indexOf(baseBrief.desiredTopology);
  const candidates = Array.from({ length: 4 }, (_, index) => {
    const topologyId = TOPOLOGIES[(topologyStartIndex + index) % TOPOLOGIES.length];
    const brief = createDesignBrief(normalizedSeed, theme, topologyId, layout.mapSize);
    return buildBlueprintCandidate(index, brief, layout, theme, topologyId);
  });
  const { selected, rejected } = chooseCandidate(candidates);
  const designBrief = createDesignBrief(normalizedSeed, theme, selected.topologyId, layout.mapSize);

  selected.diagnostics.candidateCount = candidates.length;
  selected.diagnostics.rejectedCandidates = rejected;
  selected.diagnostics.selectedCandidateId = selected.id;

  return {
    designBrief,
    blueprint: selected,
    rejectedCandidates: rejected,
    moduleDefinitions: MAP_MODULE_DEFINITIONS,
  };
}

export function createProceduralMapPreview(
  seed = 0,
  mapSize?: VoxelMapSizeId | null,
  options: { profileId?: MapProfileId | string | null; themeId?: VoxelMapTheme['id'] | null } = {}
): ProceduralMapPreview {
  const normalizedSeed = seed >>> 0;
  if (options.profileId === 'battle_royal_large') {
    return createBattleRoyalMapPreview(normalizedSeed, { themeId: options.themeId });
  }

  const theme = getVoxelMapTheme(normalizedSeed, options.themeId);
  const layout = createProceduralCTFLayout(normalizedSeed, mapSize);
  const construction = createMapConstruction(normalizedSeed, layout, theme);
  const topologyLabel = construction.blueprint.topologyId
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

  return {
    seed: normalizedSeed,
    mapSize: layout.mapSize,
    familyId: construction.designBrief.familyId,
    topologyId: construction.blueprint.topologyId,
    themeId: theme.id,
    themeName: theme.name,
    name: `${theme.name} ${topologyLabel}`,
    preview: construction.blueprint.preview,
    diagnostics: {
      score: construction.blueprint.diagnostics.score,
      scoreBreakdown: construction.blueprint.diagnostics.scoreBreakdown,
      laneLengths: construction.blueprint.diagnostics.laneLengths,
      routeChoiceCount: construction.blueprint.diagnostics.routeChoiceCount,
      warnings: construction.blueprint.diagnostics.warnings,
    },
  };
}

export function finalizeCompiledMapDiagnostics(
  blueprint: MapBlueprint,
  input: CompiledMapDiagnosticInput
): MapDiagnostics {
  const diagnostics: MapDiagnostics = {
    ...blueprint.diagnostics,
    colliderCount: input.stats.colliderCount,
    chunkCount: input.stats.chunkCount,
    solidBlockCount: input.stats.solidBlocks,
    stageTimingsMs: {
      ...blueprint.diagnostics.stageTimingsMs,
      ...(input.stageTimingsMs ?? {}),
    },
    repairActions: {
      ...blueprint.diagnostics.repairActions,
      ...(input.repairActions ?? {}),
    },
    spawnVisibilityPairs: input.spawnVisibilityPairs ?? blueprint.diagnostics.spawnVisibilityPairs,
    warnings: [...blueprint.diagnostics.warnings],
  };

  if (input.stats.colliderCount > 0 && input.stats.colliderCount > 0.9 * 48_000) {
    diagnostics.warnings.push('collider count is close to budget');
  }
  if (input.stats.solidBlocks > 0 && input.stats.solidBlocks > 0.9 * 1_750_000) {
    diagnostics.warnings.push('solid block count is close to budget');
  }
  const slotRoles = new Map(blueprint.tacticalSlots.map((slot) => [slot.id, slot.role]));
  const rejectedCriticalSlots = blueprint.moduleInstances.filter(
    (instance) =>
      instance.validation.status !== 'accepted' &&
      !OPTIONAL_GENERATED_SLOT_ROLES.has(slotRoles.get(instance.slotId) ?? 'soft_cover_cluster')
  );
  if (rejectedCriticalSlots.length > 0) {
    diagnostics.warnings.push('one or more critical tactical slots did not receive generated map geometry');
  }
  if ((input.repairActions?.spawn_sightline_baffle ?? 0) > 0) {
    diagnostics.warnings.push('spawn sightline needed voxel-level repair');
  }
  if ((input.repairActions?.unsafe_groove_seal ?? 0) > 0) {
    diagnostics.warnings.push('unsafe groove sealing was used as a final safety pass');
  }

  return diagnostics;
}
