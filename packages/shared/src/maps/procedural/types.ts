import type { Vec3 } from '../../types/vector.js';

export const DEFAULT_PROCEDURAL_MAP_SEED = 0x57564f58;

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
  | 'cactus';

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

export interface VoxelMapTheme {
  id: 'verdant' | 'basalt' | 'desert' | 'frost' | 'crystal';
  name: string;
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
  seed: number;
  theme: VoxelMapTheme;
  origin: Vec3;
  voxelSize: VoxelSize;
  size: VoxelSize;
  chunkSize: VoxelSize;
  spawnPoints: { red: Vec3[]; blue: Vec3[] };
  flagZones: { red: Vec3; blue: Vec3 };
  boundary: BoundaryPoint[];
  chunks: VoxelChunk[];
  colliders: VoxelCollider[];
  stats: {
    chunkCount: number;
    solidBlocks: number;
    colliderCount: number;
  };
}
