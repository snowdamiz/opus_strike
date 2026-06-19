import type { Team } from '../../types/team.js';
import type { Vec3 } from '../../types/vector.js';

export const DEFAULT_PROCEDURAL_MAP_SEED = 0x57564f58;
export const CONSTRUCTED_MAP_MANIFEST_VERSION = 10;

export type VoxelMapSizeId = 'small' | 'medium' | 'large';
export const DEFAULT_VOXEL_MAP_SIZE_ID: VoxelMapSizeId = 'medium';

export type VoxelBlockId =
  | 'air'
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'metal'
  | 'glass'
  | 'neon_red'
  | 'neon_blue'
  | 'spawn_pad'
  | 'spawn_pad_red'
  | 'spawn_pad_blue'
  | 'flag_pad'
  | 'barrier'
  | 'wood'
  | 'leaves'
  | 'cactus'
  | 'ash'
  | 'lava'
  | 'obsidian'
  | 'sand'
  | 'snow'
  | 'ice'
  | 'moss'
  | 'bamboo'
  | 'blossom_leaves'
  | 'gold'
  | 'gold_ore'
  | 'gold_panel'
  | 'gold_glass'
  | 'crystal_growth'
  | 'health_pad'
  | 'powerup_pad';

export interface VoxelSize {
  x: number;
  y: number;
  z: number;
}

export interface VoxelChunkCoord {
  x: number;
  y: number;
  z: number;
}

export interface VoxelChunk {
  coord: VoxelChunkCoord;
  size: VoxelSize;
  blocks: Uint8Array;
  solidBlockCount: number;
}

export interface BoundaryPoint {
  x: number;
  z: number;
}

export interface VoxelCollider {
  center: Vec3;
  halfExtents: Vec3;
  material: 'default' | 'ice' | 'bounce' | 'barrier';
}

export type MapTeam = Team;
export type TeamMap<T> = Record<MapTeam, T>;
export type MapGameMode = 'ctf' | 'battle_royal';
export type MapFamilyId = 'ctf_semantic_arena' | 'battle_royal_large';
export type MapProfileId = 'ctf_arena' | 'tdm_arena' | 'battle_royal_large';
export type MapTopologyId = 'lane_triad' | 'diamond' | 'hourglass' | 'ring' | 'split_level';
export type MapSymmetryLevel = 'mirrored' | 'rotational' | 'asymmetric_balanced';

export interface MapPerformanceBudget {
  maxSolidBlocks: number;
  maxColliders: number;
  maxRenderableChunks: number;
  maxGenerationMs: number;
}

export interface MapDesignBrief {
  seed: number;
  mapSize: VoxelMapSizeId;
  gameMode: MapGameMode;
  profileId?: MapProfileId;
  teamSize: number;
  familyId: MapFamilyId;
  themeId: VoxelMapTheme['id'];
  targetMatchLengthSeconds: number;
  desiredTopology: MapTopologyId;
  desiredSymmetry: MapSymmetryLevel;
  performanceBudget: MapPerformanceBudget;
  rngStreams: Record<string, number>;
}

export type ZoneShape = 'circle' | 'capsule' | 'polygon' | 'rect';

export interface ZoneDescriptor {
  id: string;
  shape: ZoneShape;
  center: Vec3;
  radius?: number;
  halfExtents?: { x: number; z: number };
  points?: BoundaryPoint[];
  facing?: { x: number; z: number };
}

export interface BaseZone extends ZoneDescriptor {
  team: MapTeam;
  exits: Vec3[];
  defensivePositions: Vec3[];
}

export interface FlagZone extends ZoneDescriptor {
  team: MapTeam;
  pickupRadius: number;
  captureRadius: number;
  approachDirections: Vec3[];
  returnPathNodeIds: string[];
}

export interface SpawnCluster extends ZoneDescriptor {
  team: MapTeam;
  points: Vec3[];
  fallbackPoints: Vec3[];
  protectedExitDirections: Vec3[];
  facing: { x: number; z: number };
}

export type ProtectedZoneKind = 'spawn' | 'flag' | 'base' | 'route' | 'module_pad' | 'no_dressing';

export interface ProtectedZone extends ZoneDescriptor {
  kind: ProtectedZoneKind;
  team?: MapTeam;
  clearanceRadius: number;
  blocksDressing: boolean;
  blocksModules: boolean;
}

export type LaneKind = 'primary' | 'flank' | 'return' | 'access';

export interface LaneDescriptor {
  id: string;
  label: string;
  kind: LaneKind;
  nodeIds: string[];
  width: number;
  expectedDistance: number;
  expectedTravelTimeSeconds: number;
  coverDensityTarget: number;
  verticalityBand: { minY: number; maxY: number };
}

export type RouteNodeKind =
  | 'base'
  | 'flag'
  | 'spawn'
  | 'midfield'
  | 'flank'
  | 'contest'
  | 'landmark'
  | 'fallback';

export interface RouteGraphNode {
  id: string;
  kind: RouteNodeKind;
  position: Vec3;
  team?: MapTeam;
  laneIds: string[];
  tags: string[];
}

export interface RouteGraphEdge {
  id: string;
  from: string;
  to: string;
  laneId: string;
  distance: number;
  expectedTravelTimeSeconds: number;
  width: number;
  traversal: 'ground' | 'ramp' | 'bridge' | 'tunnel' | 'drop';
  tags: string[];
}

export interface RouteGraph {
  nodes: RouteGraphNode[];
  edges: RouteGraphEdge[];
  primaryRouteNodeIds: TeamMap<string[]>;
  fallbackAnchorNodeIds: TeamMap<string[]>;
}

export type MapPowerupKind = 'health_pack' | 'powerup';
export type MapPowerupStrategicRole =
  | 'midfield_contest'
  | 'flank_reward'
  | 'return_route'
  | 'defensive_reset'
  | 'route_bridge';

export interface MapPowerupPickup {
  id: string;
  kind: MapPowerupKind;
  position: Vec3;
  radius: number;
  respawnSeconds: number;
  strategicRole: MapPowerupStrategicRole;
  routeNodeId?: string;
  laneId?: string;
  teamBias?: MapTeam;
}

export type MapNamedLocationKind =
  | 'city'
  | 'town'
  | 'industrial'
  | 'hamlet'
  | 'outpost'
  | 'open_area'
  | 'wildland'
  | 'landmark';

export interface MapNamedLocation {
  id: string;
  name: string;
  kind: MapNamedLocationKind;
  position: Vec3;
  radius: number;
  priority: number;
  tags: string[];
}

export interface SightlineSample {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  from: Vec3;
  to: Vec3;
  purpose: 'block_spawn_to_spawn' | 'limit_midfield_range' | 'preserve_lane_read';
  maxAllowedDistance: number;
  requiresOcclusion: boolean;
  status: 'planned' | 'passed' | 'repaired' | 'failed';
}

export type TacticalSlotRole =
  | 'base_shell'
  | 'spawn_shelter'
  | 'flag_stand'
  | 'midfield_occluder'
  | 'side_lane_cover_chain'
  | 'flank_landmark'
  | 'elevated_bridge'
  | 'tunnel_entrance'
  | 'defender_perch'
  | 'soft_cover_cluster'
  | 'hard_cover_cluster'
  | 'traversal_ramp'
  | 'underpass';

export interface TacticalSlot {
  id: string;
  role: TacticalSlotRole;
  position: Vec3;
  facing: { x: number; z: number };
  footprint: {
    shape: 'circle' | 'rect' | 'capsule';
    radius?: number;
    halfExtents?: { x: number; z: number };
  };
  heightBand: { minRows: number; maxRows: number };
  allowedModuleIds: string[];
  protectedClearance: number;
  laneId?: string;
  nodeId?: string;
  edgeId?: string;
  team?: MapTeam;
  sightlinePurpose?: SightlineSample['purpose'];
  budget: {
    cover: number;
    occlusion: number;
    verticality: number;
    estimatedSolidBlocks: number;
    estimatedColliders: number;
  };
}

export type ModuleRoleTag =
  | TacticalSlotRole
  | 'base'
  | 'route_cover'
  | 'landmark'
  | 'traversal'
  | 'natural'
  | 'structure';

export interface ModuleConnector {
  id: string;
  kind: 'entrance' | 'exit' | 'ramp' | 'bridge' | 'tunnel' | 'sightline_blocker';
  position: Vec3;
  direction: { x: number; z: number };
  width: number;
}

export interface ModuleDefinition {
  id: string;
  name: string;
  roleTags: ModuleRoleTag[];
  footprintShape: TacticalSlot['footprint']['shape'];
  heightRangeRows: { min: number; max: number };
  connectorKinds: ModuleConnector['kind'][];
  coverContribution: number;
  occlusionContribution: number;
  traversalAffordances: Array<'ramp' | 'bridge' | 'tunnel' | 'perch' | 'cover'>;
  blockBudgetEstimate: number;
  colliderBudgetEstimate: number;
  allowedThemes: Array<VoxelMapTheme['id'] | 'any'>;
  protectedZoneBehavior: 'avoid' | 'accent' | 'occupy';
}

export interface ModuleInstance {
  id: string;
  moduleId: string;
  slotId: string;
  roleTags: ModuleRoleTag[];
  position: Vec3;
  facing: { x: number; z: number };
  footprint: TacticalSlot['footprint'];
  connectors: ModuleConnector[];
  estimatedSolidBlocks: number;
  estimatedColliders: number;
  validation: {
    status: 'planned' | 'accepted' | 'rejected' | 'repaired';
    reasons: string[];
  };
}

export type TerrainConstraintKind =
  | 'lane_centerline'
  | 'lane_width'
  | 'base_pad'
  | 'spawn_pad'
  | 'flag_pad'
  | 'module_pad'
  | 'ramp_corridor'
  | 'no_trap_zone'
  | 'no_dressing_zone'
  | 'boundary_wall_band'
  | 'sightline_band'
  | 'cover_slot';

export interface TerrainConstraint {
  id: string;
  kind: TerrainConstraintKind;
  center?: Vec3;
  points?: Vec3[];
  radius: number;
  width?: number;
  targetHeightRows?: number;
  maxStepRows: number;
  priority: number;
  laneId?: string;
  slotId?: string;
  team?: MapTeam;
}

export interface PreviewCameraHint {
  position: Vec3;
  target: Vec3;
  fov: number;
  near: number;
  far: number;
}

export interface PreviewSilhouette {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  boundary: BoundaryPoint[];
  routes: Array<{ id: string; kind: LaneKind; points: Vec3[]; width: number }>;
  landmarks: Array<{ id: string; role: TacticalSlotRole; position: Vec3; radius: number }>;
  objectives: {
    flags: TeamMap<Vec3>;
    spawns: TeamMap<Vec3>;
  };
}

export interface BlueprintPreview {
  camera: PreviewCameraHint;
  thumbnailSilhouette: PreviewSilhouette;
  labelTags: string[];
}

export interface MapDiagnostics {
  familyId: MapFamilyId;
  topologyId: MapTopologyId;
  themeId: VoxelMapTheme['id'];
  candidateCount: number;
  selectedCandidateId: string;
  rejectedCandidates: Array<{ id: string; score: number; reasons: string[] }>;
  score: number;
  scoreBreakdown: Record<string, number>;
  stageTimingsMs: Record<string, number>;
  laneLengths: Record<string, number>;
  laneWidths: Record<string, number>;
  routeChoiceCount: number;
  coverDensityByLane: Record<string, number>;
  maxSightlineLength: number;
  spawnVisibilityPairs: number;
  flagApproachClearances: TeamMap<number>;
  colliderCount: number;
  chunkCount: number;
  solidBlockCount: number;
  moduleCountsByRole: Record<string, number>;
  repairActions: Record<string, number>;
  warnings: string[];
}

export interface MapBlueprint {
  id: string;
  seed: number;
  familyId: MapFamilyId;
  topologyId: MapTopologyId;
  themeId: VoxelMapTheme['id'];
  boundary: BoundaryPoint[];
  bases: TeamMap<BaseZone>;
  flags: TeamMap<FlagZone>;
  spawns: TeamMap<SpawnCluster>;
  protectedZones: ProtectedZone[];
  lanes: LaneDescriptor[];
  routeGraph: RouteGraph;
  sightlineSamples: SightlineSample[];
  tacticalSlots: TacticalSlot[];
  terrainConstraints: TerrainConstraint[];
  moduleInstances: ModuleInstance[];
  preview: BlueprintPreview;
  diagnostics: MapDiagnostics;
}

export interface VoxelMapStats {
  chunkCount: number;
  totalChunkSlots: number;
  emptyChunkSlots: number;
  renderableChunkCount: number;
  solidBlocks: number;
  colliderCount: number;
  colliderSignature?: string;
  estimatedTrianglesByProfile?: {
    potato: number;
    competitive: number;
    balanced: number;
    cinematic: number;
  };
}

export interface VoxelHeightfield {
  origin: Vec3;
  voxelSize: VoxelSize;
  size: { x: number; z: number };
  topSolidRows: Uint16Array;
}

export type VoxelSkyVariantId =
  | 'clear_day'
  | 'stormfront'
  | 'desert_heat'
  | 'frost_glow'
  | 'crystal_dusk'
  | 'ember_haze'
  | 'sakura_dawn'
  | 'treasury_glow';

export interface VoxelMapTheme {
  id: 'verdant' | 'basalt' | 'desert' | 'frost' | 'crystal' | 'volcanic' | 'sakura' | 'golden';
  name: string;
  skyVariantId: VoxelSkyVariantId;
  skyColor: string;
  ambientColor: string;
  sunColor: string;
  fogColor: string;
  ground: {
    top: string;
    side: string;
    dirt: string;
    stone: string;
  };
  structures: {
    metal: string;
    glass: string;
    barrier: string;
    accent: string;
  };
}

export interface VoxelMapManifest {
  id: string;
  version: number;
  seed: number;
  mapSize: VoxelMapSizeId;
  profileId?: MapProfileId;
  familyId: MapFamilyId;
  topologyId: MapTopologyId;
  themeId: VoxelMapTheme['id'];
  theme: VoxelMapTheme;
  origin: Vec3;
  voxelSize: VoxelSize;
  size: VoxelSize;
  chunkSize: VoxelSize;
  spawnPoints: Record<MapTeam, Vec3[]>;
  flagZones: Record<MapTeam, Vec3>;
  boundary: BoundaryPoint[];
  heightfield: VoxelHeightfield;
  chunks: VoxelChunk[];
  colliders: VoxelCollider[];
  stats: VoxelMapStats;
  gameplay: {
    mode: MapGameMode;
    boundary: BoundaryPoint[];
    bases: TeamMap<BaseZone>;
    flags: TeamMap<FlagZone>;
    spawns: TeamMap<SpawnCluster>;
    protectedZones: ProtectedZone[];
    lanes: LaneDescriptor[];
    routeGraph: RouteGraph;
    powerups: MapPowerupPickup[];
    namedLocations?: MapNamedLocation[];
    sightlineSamples: SightlineSample[];
  };
  construction: {
    designBrief: MapDesignBrief;
    blueprintId: string;
    topologyId: MapTopologyId;
    tacticalSlots: TacticalSlot[];
    moduleDefinitions: ModuleDefinition[];
    moduleInstances: ModuleInstance[];
    terrainConstraints: TerrainConstraint[];
    diagnostics: MapDiagnostics;
  };
  world: {
    origin: Vec3;
    voxelSize: VoxelSize;
    size: VoxelSize;
    heightfield: VoxelHeightfield;
    chunks: VoxelChunk[];
    colliders: VoxelCollider[];
    stats: VoxelMapStats;
  };
  preview: {
    camera: PreviewCameraHint;
    thumbnailSilhouette: PreviewSilhouette;
    labelTags: string[];
  };
}
