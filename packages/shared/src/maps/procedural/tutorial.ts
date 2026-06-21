import { PLAYER_HEIGHT } from '../../constants/physics.js';
import { POWERUP_PICKUP_RADIUS, POWERUP_RESPAWN_SECONDS } from '../../constants/game.js';
import { getBlockNumericId, isSolidBlock } from './blocks.js';
import { generateVoxelColliders } from './colliders.js';
import { getVoxelMapTheme } from './themes.js';
import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  type BaseZone,
  type BoundaryPoint,
  type FlagZone,
  type LaneDescriptor,
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
  type VoxelBlockId,
  type VoxelChunk,
  type VoxelMapManifest,
  type VoxelMapStats,
  type VoxelSize,
} from './types.js';

export const TUTORIAL_MAP_SEED = 0x54555431;
export const TUTORIAL_MAP_ID = 'tutorial_ctf_training_lane';
export const TUTORIAL_MAP_SIZE_ID = 'small' as const;

const VOXEL_SIZE: VoxelSize = { x: 0.5, y: 0.5, z: 0.5 };
const MAP_SIZE: VoxelSize = { x: 72, y: 28, z: 176 };
const CHUNK_SIZE: VoxelSize = { x: 16, y: 16, z: 16 };
const CROUCH_COVER_MIN_ROW = 4;
const CROUCH_COVER_MAX_ROW = 5;
const SLIDE_COVER_MIN_ROW = 3;
const SLIDE_COVER_MAX_ROW = 4;
const SLIDE_COVER_START_Z = -21.5;
const SLIDE_COVER_END_Z = -19.5;
const SLIDE_TUNNEL_Z = (SLIDE_COVER_START_Z + SLIDE_COVER_END_Z) / 2;
const TUTORIAL_DECORATIVE_GATE_Z = [-34.7, -29.2, -23.8, -18.4, 7.4, 12.6, 18.8, 24.8, 35.4] as const;
const TUTORIAL_STAGE_MARKER_Z = [-36, -31, -26, -20, -12, -4, 4, 10, 16, 22, 30, 36] as const;
const SAFETY_DECK_MIN_X = -11;
const SAFETY_DECK_MAX_X = 11;
const SAFETY_DECK_MIN_Z = -41;
const SAFETY_DECK_MAX_Z = 41;
const BOUNDARY_WALL_HEIGHT_ROWS = 14;
const GATE_BEAM_MIN_ROW = 9;
const GATE_BEAM_MAX_ROW = 10;
const ORIGIN = {
  x: -(MAP_SIZE.x * VOXEL_SIZE.x) / 2,
  y: 0,
  z: -(MAP_SIZE.z * VOXEL_SIZE.z) / 2,
};
const FLOOR_TOP_Y = ORIGIN.y + VOXEL_SIZE.y;
const SPAWN_Y = FLOOR_TOP_Y + PLAYER_HEIGHT / 2 + 0.05;
const FLAG_Y = FLOOR_TOP_Y + 0.25;
const PICKUP_Y = FLOOR_TOP_Y + 0.55;
export const TUTORIAL_TARGET_STAND_POSITION = { x: 0, y: SPAWN_Y, z: 30.2 } as const;
export const TUTORIAL_TARGET_PRACTICE_POSITION = { x: 0, y: FLOOR_TOP_Y + 2.35, z: 31.6 } as const;
export const TUTORIAL_BOOST_PICKUP_POSITION = { x: 0, y: PICKUP_Y, z: 15.6 } as const;
export const TUTORIAL_HEALTH_PICKUP_POSITION = { x: -6.4, y: PICKUP_Y, z: 20.6 } as const;
const BOUNDARY: BoundaryPoint[] = [
  { x: -12, z: -42 },
  { x: 12, z: -42 },
  { x: 12, z: 42 },
  { x: -12, z: 42 },
];
const RED_FLAG = { x: 0, y: FLAG_Y, z: -39 };
const BLUE_FLAG = { x: 0, y: FLAG_Y, z: 39 };
const RED_SPAWNS = [
  { x: 0, y: SPAWN_Y, z: -40 },
  { x: -3.2, y: SPAWN_Y, z: -38.6 },
  { x: 3.2, y: SPAWN_Y, z: -38.6 },
  { x: 0, y: SPAWN_Y, z: -37 },
];
const BLUE_SPAWNS = [
  { x: 0, y: SPAWN_Y, z: 39.5 },
  { x: -3.2, y: SPAWN_Y, z: 37.8 },
  { x: 3.2, y: SPAWN_Y, z: 37.8 },
  { x: 0, y: SPAWN_Y, z: 35.8 },
];
const TUTORIAL_BOOST_PICKUP: MapPowerupPickup = {
  id: 'tutorial_boost_pickup',
  kind: 'powerup',
  position: TUTORIAL_BOOST_PICKUP_POSITION,
  radius: POWERUP_PICKUP_RADIUS,
  respawnSeconds: POWERUP_RESPAWN_SECONDS,
  strategicRole: 'route_bridge',
  routeNodeId: 'tutorial_powerup',
  laneId: 'tutorial_main',
};
const TUTORIAL_HEALTH_PICKUP: MapPowerupPickup = {
  id: 'tutorial_health_pickup',
  kind: 'health_pack',
  position: TUTORIAL_HEALTH_PICKUP_POSITION,
  radius: POWERUP_PICKUP_RADIUS,
  respawnSeconds: POWERUP_RESPAWN_SECONDS,
  strategicRole: 'return_route',
  routeNodeId: 'tutorial_health',
  laneId: 'tutorial_return',
};
const TUTORIAL_POWERUPS: MapPowerupPickup[] = [TUTORIAL_BOOST_PICKUP, TUTORIAL_HEALTH_PICKUP];

let tutorialManifest: VoxelMapManifest | null = null;

function blockId(id: VoxelBlockId): number {
  return getBlockNumericId(id);
}

function index(x: number, y: number, z: number, size: VoxelSize): number {
  return x + size.x * (z + size.z * y);
}

function clampGrid(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function worldToGridX(worldX: number): number {
  return clampGrid(Math.floor((worldX - ORIGIN.x) / VOXEL_SIZE.x), 0, MAP_SIZE.x);
}

function worldToGridZ(worldZ: number): number {
  return clampGrid(Math.floor((worldZ - ORIGIN.z) / VOXEL_SIZE.z), 0, MAP_SIZE.z);
}

function setBlock(blocks: Uint8Array, x: number, y: number, z: number, id: VoxelBlockId): void {
  if (x < 0 || x >= MAP_SIZE.x || y < 0 || y >= MAP_SIZE.y || z < 0 || z >= MAP_SIZE.z) return;
  blocks[index(x, y, z, MAP_SIZE)] = blockId(id);
}

function fillWorldCuboid(
  blocks: Uint8Array,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  minY: number,
  maxY: number,
  id: VoxelBlockId
): void {
  const startX = worldToGridX(minX);
  const endX = worldToGridX(maxX);
  const startZ = worldToGridZ(minZ);
  const endZ = worldToGridZ(maxZ);

  for (let y = minY; y < maxY; y++) {
    for (let z = startZ; z < endZ; z++) {
      for (let x = startX; x < endX; x++) {
        setBlock(blocks, x, y, z, id);
      }
    }
  }
}

function paintDisc(blocks: Uint8Array, centerX: number, centerZ: number, radius: number, id: VoxelBlockId): void {
  const radiusSq = radius * radius;
  for (let z = 0; z < MAP_SIZE.z; z++) {
    const worldZ = ORIGIN.z + (z + 0.5) * VOXEL_SIZE.z;
    for (let x = 0; x < MAP_SIZE.x; x++) {
      const worldX = ORIGIN.x + (x + 0.5) * VOXEL_SIZE.x;
      const dx = worldX - centerX;
      const dz = worldZ - centerZ;
      if (dx * dx + dz * dz <= radiusSq) {
        setBlock(blocks, x, 0, z, id);
      }
    }
  }
}

function paintTutorialSafetyDeck(blocks: Uint8Array): void {
  fillWorldCuboid(
    blocks,
    SAFETY_DECK_MIN_X,
    SAFETY_DECK_MAX_X,
    SAFETY_DECK_MIN_Z,
    SAFETY_DECK_MAX_Z,
    0,
    1,
    'stone'
  );
  fillWorldCuboid(blocks, -9.75, 9.75, -39.5, 39.5, 0, 1, 'moss');
}

function paintTutorialBoundaryWalls(blocks: Uint8Array): void {
  fillWorldCuboid(blocks, -12, -11, -42, 42, 1, BOUNDARY_WALL_HEIGHT_ROWS, 'barrier');
  fillWorldCuboid(blocks, 11, 12, -42, 42, 1, BOUNDARY_WALL_HEIGHT_ROWS, 'barrier');
  fillWorldCuboid(blocks, -12, 12, -42, -41, 1, BOUNDARY_WALL_HEIGHT_ROWS, 'barrier');
  fillWorldCuboid(blocks, -12, 12, 41, 42, 1, BOUNDARY_WALL_HEIGHT_ROWS, 'barrier');

  fillWorldCuboid(blocks, -12, -10.9, -42, 42, BOUNDARY_WALL_HEIGHT_ROWS - 1, BOUNDARY_WALL_HEIGHT_ROWS, 'gold');
  fillWorldCuboid(blocks, 10.9, 12, -42, 42, BOUNDARY_WALL_HEIGHT_ROWS - 1, BOUNDARY_WALL_HEIGHT_ROWS, 'gold');
  fillWorldCuboid(blocks, -12, 12, -42, -40.9, BOUNDARY_WALL_HEIGHT_ROWS - 1, BOUNDARY_WALL_HEIGHT_ROWS, 'gold');
  fillWorldCuboid(blocks, -12, 12, 40.9, 42, BOUNDARY_WALL_HEIGHT_ROWS - 1, BOUNDARY_WALL_HEIGHT_ROWS, 'gold');

  fillWorldCuboid(blocks, -11, -10.5, -40.5, 40.5, 1, 2, 'neon_red');
  fillWorldCuboid(blocks, 10.5, 11, -40.5, 40.5, 1, 2, 'neon_blue');
  fillWorldCuboid(blocks, -10.5, 10.5, -41, -40.5, 1, 2, 'neon_red');
  fillWorldCuboid(blocks, -10.5, 10.5, 40.5, 41, 1, 2, 'neon_blue');
}

function paintTutorialFloorAccents(blocks: Uint8Array): void {
  fillWorldCuboid(blocks, -0.25, 0.25, -39.5, 39.5, 0, 1, 'gold_panel');
  fillWorldCuboid(blocks, -10.5, -10, -39, 39, 0, 1, 'neon_red');
  fillWorldCuboid(blocks, 10, 10.5, -39, 39, 0, 1, 'neon_blue');

  for (const markerZ of TUTORIAL_STAGE_MARKER_Z) {
    fillWorldCuboid(blocks, -9.5, 9.5, markerZ, markerZ + 0.35, 0, 1, 'gold_ore');
  }

  paintDisc(blocks, 0, -12.5, 3.2, 'obsidian');
  paintDisc(blocks, 0, 5.5, 3, 'flag_pad');
  paintDisc(blocks, TUTORIAL_TARGET_STAND_POSITION.x, TUTORIAL_TARGET_STAND_POSITION.z, 3.6, 'gold_ore');
  paintDisc(blocks, TUTORIAL_TARGET_STAND_POSITION.x, TUTORIAL_TARGET_STAND_POSITION.z, 2.25, 'gold_panel');
}

function createTutorialBlocks(): Uint8Array {
  const blocks = new Uint8Array(MAP_SIZE.x * MAP_SIZE.y * MAP_SIZE.z);

  paintTutorialSafetyDeck(blocks);
  paintTutorialBoundaryWalls(blocks);

  fillWorldCuboid(blocks, -9, 9, -42, -35, 0, 1, 'spawn_pad_red');
  fillWorldCuboid(blocks, -5.5, 5.5, -35, -29, 0, 1, 'metal');
  fillWorldCuboid(blocks, -4.8, 4.8, -34.5, -30, 0, 1, 'gold_panel');
  fillWorldCuboid(blocks, -7, -6, -34.5, -30, 1, 3, 'neon_red');
  fillWorldCuboid(blocks, 6, 7, -34.5, -30, 1, 3, 'neon_red');

  fillWorldCuboid(blocks, -5, 5, -29, -24, 0, 1, 'metal');
  fillWorldCuboid(blocks, -6, -5, -29, -24, 1, 5, 'barrier');
  fillWorldCuboid(blocks, 5, 6, -29, -24, 1, 5, 'barrier');
  fillWorldCuboid(blocks, -4.2, 4.2, -27.8, -25.1, CROUCH_COVER_MIN_ROW, CROUCH_COVER_MAX_ROW, 'glass');
  fillWorldCuboid(blocks, -4.7, -3.7, -28.4, -24.2, 1, 3, 'stone');
  fillWorldCuboid(blocks, 3.7, 4.7, -28.4, -24.2, 1, 3, 'stone');

  fillWorldCuboid(blocks, -4.5, 4.5, -24, -18.5, 0, 1, 'metal');
  fillWorldCuboid(blocks, -5.5, -4.5, -24, -18.5, 1, 4, 'barrier');
  fillWorldCuboid(blocks, 4.5, 5.5, -24, -18.5, 1, 4, 'barrier');
  fillWorldCuboid(blocks, -3.5, 3.5, SLIDE_COVER_START_Z, SLIDE_COVER_END_Z, SLIDE_COVER_MIN_ROW, SLIDE_COVER_MAX_ROW, 'neon_blue');

  fillWorldCuboid(blocks, -10, 10, -18.5, 6.5, 0, 1, 'obsidian');
  fillWorldCuboid(blocks, -10.5, -9.5, -18.2, 6.2, 1, 3, 'gold');
  fillWorldCuboid(blocks, 9.5, 10.5, -18.2, 6.2, 1, 3, 'gold');
  fillWorldCuboid(blocks, -5, 5, 4, 7.5, 0, 1, 'flag_pad');

  fillWorldCuboid(blocks, -6.5, 6.5, 6.5, 12.8, 0, 1, 'metal');
  fillWorldCuboid(blocks, -7.5, -6.5, 6.5, 12.8, 1, 5, 'barrier');
  fillWorldCuboid(blocks, 6.5, 7.5, 6.5, 12.8, 1, 5, 'barrier');
  fillWorldCuboid(blocks, -6, -3.6, 8.2, 9.7, 1, 7, 'metal');
  fillWorldCuboid(blocks, 3.6, 6, 8.2, 9.7, 1, 7, 'metal');
  fillWorldCuboid(blocks, -6, 6, 8.2, 9.7, 6, 7, 'glass');
  fillWorldCuboid(blocks, -2.2, 2.2, 8.85, 9.15, 0, 1, 'neon_blue');

  fillWorldCuboid(blocks, -6, 6, 12.8, 18.2, 0, 1, 'powerup_pad');
  fillWorldCuboid(blocks, -3.5, 3.5, 14.6, 16.5, 0, 1, 'gold_panel');

  fillWorldCuboid(blocks, -5, 5, 18.2, 24.5, 0, 1, 'metal');
  fillWorldCuboid(blocks, -9, -3, 18.2, 24.5, 0, 1, 'health_pad');
  fillWorldCuboid(blocks, -6.8, 2, 19.4, 21.8, 0, 1, 'spawn_pad');
  fillWorldCuboid(blocks, -8.5, -7.5, 18.2, 24.5, 1, 4, 'wood');
  fillWorldCuboid(blocks, -4.2, -3.3, 21.2, 24.5, 1, 4, 'wood');

  fillWorldCuboid(blocks, -8, 8, 24.5, 35.8, 0, 1, 'metal');
  fillWorldCuboid(blocks, -8, -7, 24.5, 35.8, 1, 5, 'barrier');
  fillWorldCuboid(blocks, 7, 8, 24.5, 35.8, 1, 5, 'barrier');
  fillWorldCuboid(blocks, -5.8, -4.5, 28, 35.3, 1, 3, 'wood');
  fillWorldCuboid(blocks, 4.5, 5.8, 28, 35.3, 1, 3, 'wood');

  fillWorldCuboid(blocks, -5, 5, 35.8, 42, 0, 1, 'metal');
  fillWorldCuboid(blocks, -9, 9, 36, 42, 0, 1, 'spawn_pad_blue');
  fillWorldCuboid(blocks, -4, 4, 35.9, 36.7, 0, 1, 'gold_panel');

  for (const gateZ of TUTORIAL_DECORATIVE_GATE_Z) {
    fillWorldCuboid(blocks, -7, -6.2, gateZ, gateZ + 0.5, 1, 5, 'gold');
    fillWorldCuboid(blocks, 6.2, 7, gateZ, gateZ + 0.5, 1, 5, 'gold');
    fillWorldCuboid(blocks, -7, 7, gateZ, gateZ + 0.5, GATE_BEAM_MIN_ROW, GATE_BEAM_MAX_ROW, 'gold_glass');
    fillWorldCuboid(blocks, -4.5, 4.5, gateZ, gateZ + 0.5, 0, 1, 'gold_panel');
  }

  paintTutorialFloorAccents(blocks);
  paintDisc(blocks, RED_FLAG.x, RED_FLAG.z, 3.1, 'flag_pad');
  paintDisc(blocks, BLUE_FLAG.x, BLUE_FLAG.z, 3.1, 'flag_pad');
  for (const spawn of RED_SPAWNS) paintDisc(blocks, spawn.x, spawn.z, 1.75, 'spawn_pad_red');
  for (const spawn of BLUE_SPAWNS) paintDisc(blocks, spawn.x, spawn.z, 1.75, 'spawn_pad_blue');
  paintDisc(blocks, TUTORIAL_BOOST_PICKUP.position.x, TUTORIAL_BOOST_PICKUP.position.z, 2.7, 'gold_panel');
  paintDisc(blocks, TUTORIAL_HEALTH_PICKUP.position.x, TUTORIAL_HEALTH_PICKUP.position.z, 2.1, 'health_pad');

  return blocks;
}

function createHeightfield(blocks: Uint8Array) {
  const topSolidRows = new Uint16Array(MAP_SIZE.x * MAP_SIZE.z);

  for (let z = 0; z < MAP_SIZE.z; z++) {
    for (let x = 0; x < MAP_SIZE.x; x++) {
      for (let y = MAP_SIZE.y - 1; y >= 0; y--) {
        const block = blocks[index(x, y, z, MAP_SIZE)];
        if (isSolidBlock(block)) {
          topSolidRows[x + z * MAP_SIZE.x] = y + 1;
          break;
        }
      }
    }
  }

  return {
    origin: ORIGIN,
    voxelSize: VOXEL_SIZE,
    size: { x: MAP_SIZE.x, z: MAP_SIZE.z },
    topSolidRows,
  };
}

function buildChunks(blocks: Uint8Array): VoxelChunk[] {
  const chunks: VoxelChunk[] = [];
  const chunksX = Math.ceil(MAP_SIZE.x / CHUNK_SIZE.x);
  const chunksY = Math.ceil(MAP_SIZE.y / CHUNK_SIZE.y);
  const chunksZ = Math.ceil(MAP_SIZE.z / CHUNK_SIZE.z);

  for (let cy = 0; cy < chunksY; cy++) {
    for (let cz = 0; cz < chunksZ; cz++) {
      for (let cx = 0; cx < chunksX; cx++) {
        const size = {
          x: Math.min(CHUNK_SIZE.x, MAP_SIZE.x - cx * CHUNK_SIZE.x),
          y: Math.min(CHUNK_SIZE.y, MAP_SIZE.y - cy * CHUNK_SIZE.y),
          z: Math.min(CHUNK_SIZE.z, MAP_SIZE.z - cz * CHUNK_SIZE.z),
        };
        const chunkBlocks = new Uint8Array(size.x * size.y * size.z);
        let solidBlockCount = 0;

        for (let y = 0; y < size.y; y++) {
          for (let z = 0; z < size.z; z++) {
            for (let x = 0; x < size.x; x++) {
              const globalX = cx * CHUNK_SIZE.x + x;
              const globalY = cy * CHUNK_SIZE.y + y;
              const globalZ = cz * CHUNK_SIZE.z + z;
              const block = blocks[index(globalX, globalY, globalZ, MAP_SIZE)];
              chunkBlocks[index(x, y, z, size)] = block;
              if (isSolidBlock(block)) solidBlockCount++;
            }
          }
        }

        if (solidBlockCount > 0) {
          chunks.push({
            coord: { x: cx, y: cy, z: cz },
            size,
            blocks: chunkBlocks,
            solidBlockCount,
          });
        }
      }
    }
  }

  return chunks;
}

function createStats(chunks: VoxelChunk[], colliderCount: number): VoxelMapStats {
  const solidBlocks = chunks.reduce((total, chunk) => total + chunk.solidBlockCount, 0);
  const totalChunkSlots =
    Math.ceil(MAP_SIZE.x / CHUNK_SIZE.x) *
    Math.ceil(MAP_SIZE.y / CHUNK_SIZE.y) *
    Math.ceil(MAP_SIZE.z / CHUNK_SIZE.z);
  const renderableChunkCount = chunks.filter((chunk) => chunk.solidBlockCount > 0).length;
  const competitiveTriangles = solidBlocks * 6;

  return {
    chunkCount: chunks.length,
    totalChunkSlots,
    emptyChunkSlots: Math.max(0, totalChunkSlots - chunks.length),
    renderableChunkCount,
    solidBlocks,
    colliderCount,
    estimatedTrianglesByProfile: {
      potato: Math.round(competitiveTriangles * 0.45),
      competitive: competitiveTriangles,
      balanced: Math.round(competitiveTriangles * 1.15),
      cinematic: Math.round(competitiveTriangles * 1.35),
    },
  };
}

function average(points: Array<{ x: number; y: number; z: number }>) {
  const count = Math.max(1, points.length);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / count,
    y: points.reduce((sum, point) => sum + point.y, 0) / count,
    z: points.reduce((sum, point) => sum + point.z, 0) / count,
  };
}

function createBaseZone(team: 'red' | 'blue', center: { x: number; y: number; z: number }): BaseZone {
  return {
    id: `${team}_tutorial_base`,
    team,
    shape: 'rect',
    center,
    halfExtents: { x: 8, z: 4 },
    exits: [{ x: 0, y: SPAWN_Y, z: team === 'red' ? -35 : 35 }],
    defensivePositions: [{ x: team === 'red' ? -4 : 4, y: SPAWN_Y, z: center.z }],
  };
}

function createFlagZone(team: 'red' | 'blue', center: { x: number; y: number; z: number }): FlagZone {
  return {
    id: `${team}_tutorial_flag`,
    team,
    shape: 'circle',
    center,
    radius: 3.2,
    pickupRadius: 2,
    captureRadius: 3,
    approachDirections: [{ x: 0, y: 0, z: team === 'red' ? 1 : -1 }],
    returnPathNodeIds: team === 'red'
      ? ['tutorial_spawn', 'tutorial_run_gate']
      : ['tutorial_objective', 'tutorial_target_range'],
  };
}

function createSpawnCluster(
  team: 'red' | 'blue',
  points: Array<{ x: number; y: number; z: number }>
): SpawnCluster {
  const center = average(points);
  return {
    id: `${team}_tutorial_spawn`,
    team,
    shape: 'rect',
    center,
    halfExtents: { x: 6, z: 5 },
    points,
    fallbackPoints: points,
    protectedExitDirections: [{ x: 0, y: 0, z: team === 'red' ? 1 : -1 }],
    facing: { x: 0, z: team === 'red' ? 1 : -1 },
  };
}

function createProtectedZones(): ProtectedZone[] {
  return [
    {
      id: 'tutorial_red_spawn_clearance',
      kind: 'spawn',
      team: 'red',
      shape: 'circle',
      center: average(RED_SPAWNS),
      radius: 5,
      clearanceRadius: 5,
      blocksDressing: true,
      blocksModules: true,
    },
    {
      id: 'tutorial_blue_spawn_clearance',
      kind: 'spawn',
      team: 'blue',
      shape: 'circle',
      center: average(BLUE_SPAWNS),
      radius: 5,
      clearanceRadius: 5,
      blocksDressing: true,
      blocksModules: true,
    },
    {
      id: 'tutorial_objective_clearance',
      kind: 'flag',
      shape: 'circle',
      center: BLUE_FLAG,
      radius: 5,
      clearanceRadius: 5,
      blocksDressing: true,
      blocksModules: true,
    },
    {
      id: 'tutorial_powerup_clearance',
      kind: 'route',
      shape: 'circle',
      center: TUTORIAL_BOOST_PICKUP.position,
      radius: 4,
      clearanceRadius: 4,
      blocksDressing: true,
      blocksModules: true,
    },
  ];
}

function distance(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function createRouteNode(id: string, kind: RouteGraphNode['kind'], position: { x: number; y: number; z: number }, tags: string[]): RouteGraphNode {
  return {
    id,
    kind,
    position,
    laneIds: ['tutorial_main'],
    tags,
  };
}

function createRouteGraph(): RouteGraph {
  const nodes: RouteGraphNode[] = [
    createRouteNode('tutorial_spawn', 'spawn', RED_SPAWNS[0], ['movement']),
    createRouteNode('tutorial_run_gate', 'landmark', { x: 0, y: FLOOR_TOP_Y, z: -31.5 }, ['movement', 'run']),
    createRouteNode('tutorial_crouch_gate', 'landmark', { x: 0, y: FLOOR_TOP_Y, z: -26.5 }, ['movement', 'crouch']),
    createRouteNode('tutorial_slide_tunnel', 'landmark', { x: 0, y: FLOOR_TOP_Y, z: SLIDE_TUNNEL_Z }, ['movement', 'slide']),
    createRouteNode('tutorial_bunny_hop_zone', 'landmark', { x: 0, y: FLOOR_TOP_Y, z: -12.5 }, ['movement', 'bunny_hop']),
    createRouteNode('tutorial_checkpoint', 'landmark', { x: 0, y: FLOOR_TOP_Y, z: 5.5 }, ['movement', 'checkpoint']),
    createRouteNode('tutorial_skill_gate', 'contest', { x: 0, y: FLOOR_TOP_Y, z: 9 }, ['skill']),
    createRouteNode('tutorial_powerup', 'midfield', TUTORIAL_BOOST_PICKUP.position, ['powerup']),
    createRouteNode('tutorial_health', 'fallback', TUTORIAL_HEALTH_PICKUP.position, ['health_pack']),
    createRouteNode('tutorial_target_range', 'contest', TUTORIAL_TARGET_PRACTICE_POSITION, ['combat', 'target_practice']),
    createRouteNode('tutorial_objective', 'flag', BLUE_FLAG, ['objective']),
    createRouteNode('tutorial_capture', 'flag', RED_FLAG, ['capture']),
  ];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edgePairs: Array<[string, string, RouteGraphEdge['traversal'], string[]]> = [
    ['tutorial_spawn', 'tutorial_run_gate', 'ground', ['movement', 'run']],
    ['tutorial_run_gate', 'tutorial_crouch_gate', 'ground', ['crouch']],
    ['tutorial_crouch_gate', 'tutorial_slide_tunnel', 'ground', ['slide']],
    ['tutorial_slide_tunnel', 'tutorial_bunny_hop_zone', 'ground', ['bunny_hop']],
    ['tutorial_bunny_hop_zone', 'tutorial_checkpoint', 'ground', ['checkpoint']],
    ['tutorial_checkpoint', 'tutorial_skill_gate', 'ground', ['skill']],
    ['tutorial_skill_gate', 'tutorial_powerup', 'ground', ['powerup']],
    ['tutorial_powerup', 'tutorial_health', 'ground', ['health_pack']],
    ['tutorial_health', 'tutorial_powerup', 'ground', ['return']],
    ['tutorial_health', 'tutorial_target_range', 'ground', ['target_practice']],
    ['tutorial_target_range', 'tutorial_objective', 'ground', ['objective']],
    ['tutorial_objective', 'tutorial_capture', 'ground', ['return']],
  ];
  const edges: RouteGraphEdge[] = edgePairs.map(([from, to, traversal, tags]) => {
    const fromNode = byId.get(from)!;
    const toNode = byId.get(to)!;
    const edgeDistance = distance(fromNode.position, toNode.position);
    return {
      id: `${from}_to_${to}`,
      from,
      to,
      laneId: 'tutorial_main',
      distance: edgeDistance,
      expectedTravelTimeSeconds: edgeDistance / 7.2,
      width: 6,
      traversal,
      tags,
    };
  });

  return {
    nodes,
    edges,
    primaryRouteNodeIds: {
      red: [
        'tutorial_spawn',
        'tutorial_run_gate',
        'tutorial_crouch_gate',
        'tutorial_slide_tunnel',
        'tutorial_bunny_hop_zone',
        'tutorial_checkpoint',
        'tutorial_skill_gate',
        'tutorial_powerup',
        'tutorial_health',
        'tutorial_target_range',
        'tutorial_objective',
      ],
      blue: [
        'tutorial_objective',
        'tutorial_target_range',
        'tutorial_health',
        'tutorial_powerup',
        'tutorial_skill_gate',
        'tutorial_checkpoint',
        'tutorial_bunny_hop_zone',
        'tutorial_slide_tunnel',
        'tutorial_crouch_gate',
        'tutorial_run_gate',
        'tutorial_capture',
      ],
    },
    fallbackAnchorNodeIds: {
      red: ['tutorial_capture'],
      blue: ['tutorial_objective'],
    },
  };
}

function createLanes(): LaneDescriptor[] {
  return [
    {
      id: 'tutorial_main',
      label: 'Tutorial Main Lane',
      kind: 'primary',
      nodeIds: [
        'tutorial_spawn',
        'tutorial_run_gate',
        'tutorial_crouch_gate',
        'tutorial_slide_tunnel',
        'tutorial_bunny_hop_zone',
        'tutorial_checkpoint',
        'tutorial_skill_gate',
        'tutorial_powerup',
        'tutorial_health',
        'tutorial_target_range',
        'tutorial_objective',
      ],
      width: 6,
      expectedDistance: 79,
      expectedTravelTimeSeconds: 38,
      coverDensityTarget: 0.28,
      verticalityBand: { minY: FLOOR_TOP_Y, maxY: FLOOR_TOP_Y + 3 },
    },
    {
      id: 'tutorial_return',
      label: 'Tutorial Return Lane',
      kind: 'return',
      nodeIds: ['tutorial_objective', 'tutorial_target_range', 'tutorial_health', 'tutorial_capture'],
      width: 6,
      expectedDistance: 78,
      expectedTravelTimeSeconds: 35,
      coverDensityTarget: 0.2,
      verticalityBand: { minY: FLOOR_TOP_Y, maxY: FLOOR_TOP_Y + 3 },
    },
  ];
}

function createDiagnostics(stats: VoxelMapStats): MapDiagnostics {
  return {
    familyId: 'ctf_semantic_arena',
    topologyId: 'lane_triad',
    themeId: 'verdant',
    candidateCount: 1,
    selectedCandidateId: TUTORIAL_MAP_ID,
    rejectedCandidates: [],
    score: 1,
    scoreBreakdown: {
      tutorialClarity: 1,
      objectiveReadability: 1,
      traversalSafety: 1,
    },
    stageTimingsMs: {},
    laneLengths: {
      tutorial_main: 79,
      tutorial_return: 78,
    },
    laneWidths: {
      tutorial_main: 6,
      tutorial_return: 6,
    },
    routeChoiceCount: 1,
    coverDensityByLane: {
      tutorial_main: 0.28,
      tutorial_return: 0.2,
    },
    maxSightlineLength: 34,
    spawnVisibilityPairs: 0,
    flagApproachClearances: {
      red: 7,
      blue: 7,
    },
    colliderCount: stats.colliderCount,
    chunkCount: stats.chunkCount,
    solidBlockCount: stats.solidBlocks,
    moduleCountsByRole: {},
    repairActions: {},
    warnings: [],
  };
}

function createDesignBrief(): MapDesignBrief {
  return {
    seed: TUTORIAL_MAP_SEED,
    mapSize: TUTORIAL_MAP_SIZE_ID,
    gameMode: 'ctf',
    teamSize: 1,
    familyId: 'ctf_semantic_arena',
    themeId: 'verdant',
    targetMatchLengthSeconds: 180,
    desiredTopology: 'lane_triad',
    desiredSymmetry: 'asymmetric_balanced',
    performanceBudget: {
      maxSolidBlocks: 24_000,
      maxColliders: 1_200,
      maxRenderableChunks: 64,
      maxGenerationMs: 16,
    },
    rngStreams: {},
  };
}

function createPreview(routeGraph: RouteGraph) {
  return {
    camera: {
      position: { x: 0, y: 56, z: 50 },
      target: { x: 0, y: 0, z: 0 },
      fov: 42,
      near: 0.1,
      far: 210,
    },
    thumbnailSilhouette: {
      bounds: { minX: -12, maxX: 12, minZ: -42, maxZ: 42 },
      boundary: BOUNDARY,
      routes: [
        {
          id: 'tutorial_main',
          kind: 'primary' as const,
          points: routeGraph.primaryRouteNodeIds.red.map((nodeId) => routeGraph.nodes.find((node) => node.id === nodeId)!.position),
          width: 6,
        },
      ],
      landmarks: [
        { id: 'tutorial_slide_tunnel', role: 'midfield_occluder' as const, position: { x: 0, y: FLOOR_TOP_Y, z: SLIDE_TUNNEL_Z }, radius: 4 },
        { id: 'tutorial_target_range', role: 'soft_cover_cluster' as const, position: TUTORIAL_TARGET_PRACTICE_POSITION, radius: 5 },
        { id: 'tutorial_skill_gate', role: 'midfield_occluder' as const, position: { x: 0, y: FLOOR_TOP_Y, z: 9 }, radius: 4 },
        { id: 'tutorial_powerup', role: 'soft_cover_cluster' as const, position: TUTORIAL_BOOST_PICKUP.position, radius: 4 },
      ],
      objectives: {
        flags: { red: RED_FLAG, blue: BLUE_FLAG },
        spawns: { red: average(RED_SPAWNS), blue: average(BLUE_SPAWNS) },
      },
    },
    labelTags: ['Tutorial', 'Movement', 'Skills', 'Powerups', 'Objective'],
  };
}

export function isTutorialMapSeed(seed: number): boolean {
  return (seed >>> 0) === TUTORIAL_MAP_SEED;
}

export function createTutorialVoxelMapManifest(): VoxelMapManifest {
  if (tutorialManifest) return tutorialManifest;

  const blocks = createTutorialBlocks();
  const heightfield = createHeightfield(blocks);
  const chunks = buildChunks(blocks);
  const colliders = generateVoxelColliders({
    origin: ORIGIN,
    voxelSize: VOXEL_SIZE,
    size: MAP_SIZE,
    chunkSize: CHUNK_SIZE,
    chunks,
  });
  const stats = createStats(chunks, colliders.length);
  const routeGraph = createRouteGraph();
  const lanes = createLanes();
  const bases: TeamMap<BaseZone> = {
    red: createBaseZone('red', average(RED_SPAWNS)),
    blue: createBaseZone('blue', average(BLUE_SPAWNS)),
  };
  const flags: TeamMap<FlagZone> = {
    red: createFlagZone('red', RED_FLAG),
    blue: createFlagZone('blue', BLUE_FLAG),
  };
  const spawns: TeamMap<SpawnCluster> = {
    red: createSpawnCluster('red', RED_SPAWNS),
    blue: createSpawnCluster('blue', BLUE_SPAWNS),
  };
  const protectedZones = createProtectedZones();
  const diagnostics = createDiagnostics(stats);
  const designBrief = createDesignBrief();
  const preview = createPreview(routeGraph);
  const blueprint: MapBlueprint = {
    id: TUTORIAL_MAP_ID,
    seed: TUTORIAL_MAP_SEED,
    familyId: 'ctf_semantic_arena',
    topologyId: 'lane_triad',
    themeId: 'verdant',
    boundary: BOUNDARY,
    bases,
    flags,
    spawns,
    protectedZones,
    lanes,
    routeGraph,
    sightlineSamples: [],
    tacticalSlots: [],
    terrainConstraints: [],
    moduleInstances: [],
    preview,
    diagnostics,
  };
  const theme = getVoxelMapTheme(TUTORIAL_MAP_SEED, 'verdant');

  tutorialManifest = {
    id: TUTORIAL_MAP_ID,
    version: CONSTRUCTED_MAP_MANIFEST_VERSION,
    seed: TUTORIAL_MAP_SEED,
    mapSize: TUTORIAL_MAP_SIZE_ID,
    familyId: designBrief.familyId,
    topologyId: blueprint.topologyId,
    themeId: theme.id,
    theme,
    origin: ORIGIN,
    voxelSize: VOXEL_SIZE,
    size: MAP_SIZE,
    chunkSize: CHUNK_SIZE,
    spawnPoints: { red: RED_SPAWNS, blue: BLUE_SPAWNS },
    flagZones: { red: RED_FLAG, blue: BLUE_FLAG },
    boundary: BOUNDARY,
    heightfield,
    chunks,
    colliders,
    stats,
    gameplay: {
      mode: 'ctf',
      boundary: BOUNDARY,
      bases,
      flags,
      spawns,
      protectedZones,
      lanes,
      routeGraph,
      powerups: TUTORIAL_POWERUPS,
      sightlineSamples: [],
    },
    construction: {
      designBrief,
      blueprintId: blueprint.id,
      topologyId: blueprint.topologyId,
      tacticalSlots: [],
      moduleDefinitions: [],
      moduleInstances: [],
      terrainConstraints: [],
      diagnostics,
    },
    world: {
      origin: ORIGIN,
      voxelSize: VOXEL_SIZE,
      size: MAP_SIZE,
      heightfield,
      chunks,
      colliders,
      stats,
    },
    preview,
  };

  return tutorialManifest;
}
