import type { Vec3 } from '../../types/vector.js';
import { getBlockDefinition, isCollisionBlock } from './blocks.js';
import { clampToBoundaryPolygon } from './boundaries.js';
import type { VoxelChunk, VoxelMapManifest } from './types.js';

export interface ProceduralTerrainLookup {
  getGroundY(position: Vec3): number | null;
  clampToPlayableMap(position: Vec3): Vec3;
  getBlockAtWorld(position: Vec3): number;
}

function chunkLookupIndex(x: number, y: number, z: number, chunksX: number, chunksZ: number): number {
  return x + chunksX * (z + chunksZ * y);
}

function worldToGrid(value: number, origin: number, voxelSize: number): number {
  return Math.floor((value - origin) / voxelSize);
}

function isWalkableCollisionBlock(block: number): boolean {
  return isCollisionBlock(block) && getBlockDefinition(block).walkable;
}

function buildChunkLookup(manifest: VoxelMapManifest): {
  chunksX: number;
  chunksZ: number;
  chunks: Map<number, VoxelChunk>;
} {
  const chunksX = Math.ceil(manifest.size.x / manifest.chunkSize.x);
  const chunksZ = Math.ceil(manifest.size.z / manifest.chunkSize.z);
  const chunks = new Map<number, VoxelChunk>();

  for (const chunk of manifest.chunks) {
    chunks.set(chunkLookupIndex(chunk.coord.x, chunk.coord.y, chunk.coord.z, chunksX, chunksZ), chunk);
  }

  return { chunksX, chunksZ, chunks };
}

export function createProceduralTerrainLookup(manifest: VoxelMapManifest): ProceduralTerrainLookup {
  const { chunksX, chunksZ, chunks } = buildChunkLookup(manifest);

  const getBlockAtWorld = (position: Vec3): number => {
    const gx = worldToGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
    const gy = worldToGrid(position.y, manifest.origin.y, manifest.voxelSize.y);
    const gz = worldToGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

    if (gx < 0 || gx >= manifest.size.x || gy < 0 || gy >= manifest.size.y || gz < 0 || gz >= manifest.size.z) {
      return 0;
    }

    const cx = Math.floor(gx / manifest.chunkSize.x);
    const cy = Math.floor(gy / manifest.chunkSize.y);
    const cz = Math.floor(gz / manifest.chunkSize.z);
    const chunk = chunks.get(chunkLookupIndex(cx, cy, cz, chunksX, chunksZ));
    if (!chunk) return 0;

    const lx = gx - cx * manifest.chunkSize.x;
    const ly = gy - cy * manifest.chunkSize.y;
    const lz = gz - cz * manifest.chunkSize.z;
    return chunk.blocks[lx + chunk.size.x * (lz + chunk.size.z * ly)] ?? 0;
  };

  return {
    getBlockAtWorld,
    getGroundY(position: Vec3): number | null {
      const gx = worldToGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
      const gz = worldToGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

      if (gx < 0 || gx >= manifest.size.x || gz < 0 || gz >= manifest.size.z) {
        return null;
      }

      const topRow = manifest.heightfield.topSolidRows[gx + gz * manifest.heightfield.size.x];
      if (topRow > 0) {
        const topBlock = getBlockAtWorld({
          x: manifest.origin.x + (gx + 0.5) * manifest.voxelSize.x,
          y: manifest.origin.y + (topRow - 0.5) * manifest.voxelSize.y,
          z: manifest.origin.z + (gz + 0.5) * manifest.voxelSize.z,
        });
        const topY = manifest.origin.y + topRow * manifest.voxelSize.y;
        if (isWalkableCollisionBlock(topBlock) && position.y >= topY - 0.75) {
          return topY;
        }
      }

      const startY = Math.max(0, Math.min(
        manifest.size.y - 1,
        worldToGrid(position.y - 0.15, manifest.origin.y, manifest.voxelSize.y)
      ));

      for (let gy = startY; gy >= 0; gy--) {
        const block = getBlockAtWorld({
          x: position.x,
          y: manifest.origin.y + (gy + 0.5) * manifest.voxelSize.y,
          z: position.z,
        });
        if (isWalkableCollisionBlock(block)) {
          return manifest.origin.y + (gy + 1) * manifest.voxelSize.y;
        }
      }

      return null;
    },
    clampToPlayableMap(position: Vec3): Vec3 {
      const bounds = {
        minX: manifest.origin.x,
        maxX: manifest.origin.x + manifest.size.x * manifest.voxelSize.x,
        minZ: manifest.origin.z,
        maxZ: manifest.origin.z + manifest.size.z * manifest.voxelSize.z,
      };
      const clampedBoundary = clampToBoundaryPolygon(position.x, position.z, manifest.boundary);

      return {
        x: Math.max(bounds.minX, Math.min(bounds.maxX, clampedBoundary.x)),
        y: Math.max(-20, Math.min(120, position.y)),
        z: Math.max(bounds.minZ, Math.min(bounds.maxZ, clampedBoundary.z)),
      };
    },
  };
}
