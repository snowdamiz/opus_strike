import type { VoxelBlockId } from './types.js';

export interface VoxelBlockDefinition {
  id: VoxelBlockId;
  numericId: number;
  solid: boolean;
  walkable: boolean;
  grappleable: boolean;
  slippery: boolean;
  teamTint?: 'red' | 'blue';
}

export const VOXEL_BLOCK_IDS: VoxelBlockId[] = [
  'air',
  'grass',
  'dirt',
  'stone',
  'metal',
  'glass',
  'neon_red',
  'neon_blue',
  'spawn_pad',
  'flag_pad',
  'barrier',
  'wood',
  'leaves',
  'cactus',
  'spawn_pad_red',
  'spawn_pad_blue',
];

export const VOXEL_BLOCKS: Record<VoxelBlockId, VoxelBlockDefinition> = {
  air: { id: 'air', numericId: 0, solid: false, walkable: false, grappleable: false, slippery: false },
  grass: { id: 'grass', numericId: 1, solid: true, walkable: true, grappleable: true, slippery: false },
  dirt: { id: 'dirt', numericId: 2, solid: true, walkable: true, grappleable: true, slippery: false },
  stone: { id: 'stone', numericId: 3, solid: true, walkable: true, grappleable: true, slippery: false },
  metal: { id: 'metal', numericId: 4, solid: true, walkable: true, grappleable: true, slippery: false },
  glass: { id: 'glass', numericId: 5, solid: true, walkable: true, grappleable: true, slippery: false },
  neon_red: { id: 'neon_red', numericId: 6, solid: true, walkable: true, grappleable: true, slippery: false, teamTint: 'red' },
  neon_blue: { id: 'neon_blue', numericId: 7, solid: true, walkable: true, grappleable: true, slippery: false, teamTint: 'blue' },
  spawn_pad: { id: 'spawn_pad', numericId: 8, solid: true, walkable: true, grappleable: false, slippery: false },
  flag_pad: { id: 'flag_pad', numericId: 9, solid: true, walkable: true, grappleable: false, slippery: false },
  barrier: { id: 'barrier', numericId: 10, solid: true, walkable: false, grappleable: true, slippery: false },
  wood: { id: 'wood', numericId: 11, solid: true, walkable: true, grappleable: true, slippery: false },
  leaves: { id: 'leaves', numericId: 12, solid: true, walkable: false, grappleable: true, slippery: false },
  cactus: { id: 'cactus', numericId: 13, solid: true, walkable: false, grappleable: true, slippery: false },
  spawn_pad_red: { id: 'spawn_pad_red', numericId: 14, solid: true, walkable: true, grappleable: false, slippery: false, teamTint: 'red' },
  spawn_pad_blue: { id: 'spawn_pad_blue', numericId: 15, solid: true, walkable: true, grappleable: false, slippery: false, teamTint: 'blue' },
};

export function getBlockDefinition(blockId: VoxelBlockId | number): VoxelBlockDefinition {
  if (typeof blockId === 'number') {
    return VOXEL_BLOCKS[VOXEL_BLOCK_IDS[blockId] ?? 'air'];
  }

  return VOXEL_BLOCKS[blockId];
}

export function getBlockNumericId(blockId: VoxelBlockId): number {
  return VOXEL_BLOCKS[blockId].numericId;
}

export function getBlockId(numericId: number): VoxelBlockId {
  return VOXEL_BLOCK_IDS[numericId] ?? 'air';
}

export function isSolidBlock(blockId: VoxelBlockId | number): boolean {
  return getBlockDefinition(blockId).solid;
}

const NON_COLLIDING_DECORATIVE_BLOCKS = new Set<VoxelBlockId>(['wood', 'leaves', 'cactus']);

export function isCollisionBlock(blockId: VoxelBlockId | number): boolean {
  const block = getBlockDefinition(blockId);
  return block.solid && !NON_COLLIDING_DECORATIVE_BLOCKS.has(block.id);
}
