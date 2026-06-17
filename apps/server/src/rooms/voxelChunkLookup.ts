import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';

export type VoxelChunkLookupManifest = Pick<
  VoxelMapManifest,
  'origin' | 'voxelSize' | 'size' | 'chunkSize' | 'chunks'
>;

export function worldToVoxelGrid(value: number, origin: number, voxelSize: number): number {
  return Math.floor((value - origin) / voxelSize);
}

export class VoxelChunkLookup {
  private readonly chunks = new Map<string, VoxelChunk>();

  reset(manifest: VoxelChunkLookupManifest): void {
    this.chunks.clear();
    for (const chunk of manifest.chunks) {
      this.chunks.set(this.getChunkKey(chunk.coord.x, chunk.coord.y, chunk.coord.z), chunk);
    }
  }

  clear(): void {
    this.chunks.clear();
  }

  getChunk(x: number, y: number, z: number): VoxelChunk | undefined {
    return this.chunks.get(this.getChunkKey(x, y, z));
  }

  getBlockAtWorld(
    manifest: VoxelChunkLookupManifest,
    position: { x: number; y: number; z: number }
  ): number {
    const gx = worldToVoxelGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
    const gy = worldToVoxelGrid(position.y, manifest.origin.y, manifest.voxelSize.y);
    const gz = worldToVoxelGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

    if (gx < 0 || gx >= manifest.size.x || gy < 0 || gy >= manifest.size.y || gz < 0 || gz >= manifest.size.z) {
      return 0;
    }

    const cx = Math.floor(gx / manifest.chunkSize.x);
    const cy = Math.floor(gy / manifest.chunkSize.y);
    const cz = Math.floor(gz / manifest.chunkSize.z);
    const chunk = this.getChunk(cx, cy, cz);
    if (!chunk) return 0;

    const lx = gx - cx * manifest.chunkSize.x;
    const ly = gy - cy * manifest.chunkSize.y;
    const lz = gz - cz * manifest.chunkSize.z;
    return chunk.blocks[lx + chunk.size.x * (lz + chunk.size.z * ly)] || 0;
  }

  private getChunkKey(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }
}
