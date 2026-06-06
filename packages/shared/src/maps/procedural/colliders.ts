import { isSolidBlock } from './blocks.js';
import type { VoxelChunk, VoxelCollider, VoxelMapManifest, VoxelSize } from './types.js';

interface ColliderInput {
  origin: VoxelMapManifest['origin'];
  voxelSize: VoxelSize;
  size: VoxelSize;
  chunkSize: VoxelSize;
  chunks: VoxelChunk[];
}

interface ColliderLookupInput extends ColliderInput {
  chunkLookup: Map<string, VoxelChunk>;
}

function index(x: number, y: number, z: number, size: VoxelSize): number {
  return x + size.x * (z + size.z * y);
}

function chunkKey(x: number, y: number, z: number): string {
  return `${x}:${y}:${z}`;
}

function getGlobalBlock(input: ColliderLookupInput, x: number, y: number, z: number): number {
  if (x < 0 || x >= input.size.x || y < 0 || y >= input.size.y || z < 0 || z >= input.size.z) return 0;

  const cx = Math.floor(x / input.chunkSize.x);
  const cy = Math.floor(y / input.chunkSize.y);
  const cz = Math.floor(z / input.chunkSize.z);
  const chunk = input.chunkLookup.get(chunkKey(cx, cy, cz));
  if (!chunk) return 0;

  const lx = x - cx * input.chunkSize.x;
  const ly = y - cy * input.chunkSize.y;
  const lz = z - cz * input.chunkSize.z;
  return chunk.blocks[index(lx, ly, lz, chunk.size)];
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

export function generateVoxelColliders(input: ColliderInput): VoxelCollider[] {
  const chunkLookup = new Map<string, VoxelChunk>();
  for (const chunk of input.chunks) {
    chunkLookup.set(chunkKey(chunk.coord.x, chunk.coord.y, chunk.coord.z), chunk);
  }
  const lookupInput: ColliderLookupInput = { ...input, chunkLookup };
  const solid = new Uint8Array(input.size.x * input.size.y * input.size.z);
  const visited = new Uint8Array(solid.length);

  for (let y = 0; y < input.size.y; y++) {
    for (let z = 0; z < input.size.z; z++) {
      for (let x = 0; x < input.size.x; x++) {
        if (isSolidBlock(getGlobalBlock(lookupInput, x, y, z))) {
          solid[index(x, y, z, input.size)] = 1;
        }
      }
    }
  }

  const colliders: VoxelCollider[] = [];

  for (let y = 0; y < input.size.y; y++) {
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
