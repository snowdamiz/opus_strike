import { isCollisionBlock } from './blocks.js';
import type { VoxelChunk, VoxelCollider, VoxelMapManifest, VoxelSize } from './types.js';

interface ColliderInput {
  origin: VoxelMapManifest['origin'];
  voxelSize: VoxelSize;
  size: VoxelSize;
  chunkSize: VoxelSize;
  chunks: VoxelChunk[];
}

function index(x: number, y: number, z: number, size: VoxelSize): number {
  return x + size.x * (z + size.z * y);
}

function canFillCuboid(
  solid: Uint8Array,
  visited: Uint8Array,
  size: VoxelSize,
  x0: number,
  y0: number,
  z0: number,
  width: number,
  height: number,
  depth: number
): boolean {
  for (let y = y0; y < y0 + height; y++) {
    for (let z = z0; z < z0 + depth; z++) {
      for (let x = x0; x < x0 + width; x++) {
        const i = index(x, y, z, size);
        if (!solid[i] || visited[i]) return false;
      }
    }
  }

  return true;
}

function fillSolidLookup(input: ColliderInput): { solid: Uint8Array; visited: Uint8Array; rowHasSolid: Uint8Array } {
  const solid = new Uint8Array(input.size.x * input.size.y * input.size.z);
  const visited = new Uint8Array(solid.length);
  const rowHasSolid = new Uint8Array(input.size.y);

  for (const chunk of input.chunks) {
    const baseX = chunk.coord.x * input.chunkSize.x;
    const baseY = chunk.coord.y * input.chunkSize.y;
    const baseZ = chunk.coord.z * input.chunkSize.z;

    for (let y = 0; y < chunk.size.y; y++) {
      const globalY = baseY + y;
      if (globalY < 0 || globalY >= input.size.y) continue;

      for (let z = 0; z < chunk.size.z; z++) {
        const globalZ = baseZ + z;
        if (globalZ < 0 || globalZ >= input.size.z) continue;

        for (let x = 0; x < chunk.size.x; x++) {
          const globalX = baseX + x;
          if (globalX < 0 || globalX >= input.size.x) continue;

          const block = chunk.blocks[index(x, y, z, chunk.size)];
          if (!isCollisionBlock(block)) continue;

          solid[index(globalX, globalY, globalZ, input.size)] = 1;
          rowHasSolid[globalY] = 1;
        }
      }
    }
  }

  return { solid, visited, rowHasSolid };
}

export function generateVoxelColliders(input: ColliderInput): VoxelCollider[] {
  const { solid, visited, rowHasSolid } = fillSolidLookup(input);
  const colliders: VoxelCollider[] = [];

  for (let y = 0; y < input.size.y; y++) {
    if (!rowHasSolid[y]) continue;
    for (let z = 0; z < input.size.z; z++) {
      for (let x = 0; x < input.size.x; x++) {
        const startIndex = index(x, y, z, input.size);
        if (!solid[startIndex] || visited[startIndex]) continue;

        let width = 1;
        while (
          x + width < input.size.x &&
          canFillCuboid(solid, visited, input.size, x, y, z, width + 1, 1, 1)
        ) {
          width++;
        }

        let depth = 1;
        while (
          z + depth < input.size.z &&
          canFillCuboid(solid, visited, input.size, x, y, z, width, 1, depth + 1)
        ) {
          depth++;
        }

        let height = 1;
        while (
          y + height < input.size.y &&
          canFillCuboid(solid, visited, input.size, x, y, z, width, height + 1, depth)
        ) {
          height++;
        }

        for (let yy = y; yy < y + height; yy++) {
          for (let zz = z; zz < z + depth; zz++) {
            for (let xx = x; xx < x + width; xx++) {
              visited[index(xx, yy, zz, input.size)] = 1;
            }
          }
        }

        colliders.push({
          center: {
            x: input.origin.x + (x + width / 2) * input.voxelSize.x,
            y: input.origin.y + (y + height / 2) * input.voxelSize.y,
            z: input.origin.z + (z + depth / 2) * input.voxelSize.z,
          },
          halfExtents: {
            x: (width * input.voxelSize.x) / 2,
            y: (height * input.voxelSize.y) / 2,
            z: (depth * input.voxelSize.z) / 2,
          },
          material: 'default',
        });
      }
    }
  }

  return colliders;
}
