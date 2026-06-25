import type { VoxelChunk } from '@voxel-strike/shared';

export const VOXEL_REGION_CHUNK_SPAN = 4;

export function getVoxelChunkRegionId(coord: VoxelChunk['coord']): string {
  const regionX = Math.floor(coord.x / VOXEL_REGION_CHUNK_SPAN);
  const regionZ = Math.floor(coord.z / VOXEL_REGION_CHUNK_SPAN);
  return `${regionX}:${coord.y}:${regionZ}`;
}
