import * as THREE from 'three';
import {
  getBlockId,
  isSolidBlock,
  type VoxelBlockId,
  type VoxelChunk,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import { ATLAS_COLUMNS, ATLAS_ROWS, getTileForBlock, type VoxelFaceDirection } from './textureAtlas';

interface MeshBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

interface FaceRect {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  blockId: VoxelBlockId;
}

interface ChunkLookupKey {
  x: number;
  y: number;
  z: number;
}

const blockAccessorCache = new Map<string, (x: number, y: number, z: number) => number>();
const geometryCache = new Map<string, THREE.BufferGeometry>();

function blockIndex(x: number, y: number, z: number, size: { x: number; y: number; z: number }): number {
  return x + size.x * (z + size.z * y);
}

function chunkKey(coord: ChunkLookupKey): string {
  return `${coord.x}:${coord.y}:${coord.z}`;
}

function createBlockAccessor(manifest: VoxelMapManifest): (x: number, y: number, z: number) => number {
  const cached = blockAccessorCache.get(manifest.id);
  if (cached) return cached;

  const chunks = new Map<string, VoxelChunk>();

  for (const chunk of manifest.chunks) {
    chunks.set(chunkKey(chunk.coord), chunk);
  }

  const accessor = (x: number, y: number, z: number) => {
    if (x < 0 || x >= manifest.size.x || y < 0 || y >= manifest.size.y || z < 0 || z >= manifest.size.z) {
      return 0;
    }

    const cx = Math.floor(x / manifest.chunkSize.x);
    const cy = Math.floor(y / manifest.chunkSize.y);
    const cz = Math.floor(z / manifest.chunkSize.z);
    const chunk = chunks.get(chunkKey({ x: cx, y: cy, z: cz }));
    if (!chunk) return 0;

    return chunk.blocks[
      blockIndex(
        x - cx * manifest.chunkSize.x,
        y - cy * manifest.chunkSize.y,
        z - cz * manifest.chunkSize.z,
        chunk.size
      )
    ];
  };

  blockAccessorCache.set(manifest.id, accessor);
  return accessor;
}

function pushUv(buffers: MeshBuffers, blockId: VoxelBlockId, face: VoxelFaceDirection): void {
  const tile = getTileForBlock(blockId, face);
  const padding = 0.006;
  const u0 = tile.x / ATLAS_COLUMNS + padding;
  const v0 = 1 - (tile.y + 1) / ATLAS_ROWS + padding;
  const u1 = (tile.x + 1) / ATLAS_COLUMNS - padding;
  const v1 = 1 - tile.y / ATLAS_ROWS - padding;

  buffers.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
}

function pushQuad(
  buffers: MeshBuffers,
  vertices: [number, number, number][],
  normal: [number, number, number],
  blockId: VoxelBlockId,
  face: VoxelFaceDirection
): void {
  const baseIndex = buffers.positions.length / 3;

  for (const vertex of vertices) {
    buffers.positions.push(vertex[0], vertex[1], vertex[2]);
    buffers.normals.push(normal[0], normal[1], normal[2]);
  }

  pushUv(buffers, blockId, face);
  buffers.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}

function emitFace(
  buffers: MeshBuffers,
  direction: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz',
  rect: FaceRect
): void {
  const { x, y, z, width, height, blockId } = rect;

  if (direction === 'px') {
    pushQuad(buffers, [[x + 1, y, z + width], [x + 1, y, z], [x + 1, y + height, z], [x + 1, y + height, z + width]], [1, 0, 0], blockId, 'side');
  } else if (direction === 'nx') {
    pushQuad(buffers, [[x, y, z], [x, y, z + width], [x, y + height, z + width], [x, y + height, z]], [-1, 0, 0], blockId, 'side');
  } else if (direction === 'py') {
    pushQuad(buffers, [[x, y + 1, z], [x, y + 1, z + height], [x + width, y + 1, z + height], [x + width, y + 1, z]], [0, 1, 0], blockId, 'top');
  } else if (direction === 'ny') {
    pushQuad(buffers, [[x, y, z + height], [x, y, z], [x + width, y, z], [x + width, y, z + height]], [0, -1, 0], blockId, 'bottom');
  } else if (direction === 'pz') {
    pushQuad(buffers, [[x, y, z + 1], [x + width, y, z + 1], [x + width, y + height, z + 1], [x, y + height, z + 1]], [0, 0, 1], blockId, 'side');
  } else {
    pushQuad(buffers, [[x + width, y, z], [x, y, z], [x, y + height, z], [x + width, y + height, z]], [0, 0, -1], blockId, 'side');
  }
}

function greedyMask(
  mask: (VoxelBlockId | null)[],
  width: number,
  height: number,
  emit: (u: number, v: number, w: number, h: number, blockId: VoxelBlockId) => void
): void {
  const used = new Uint8Array(mask.length);

  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const i = u + v * width;
      const blockId = mask[i];
      if (!blockId || used[i]) continue;

      let w = 1;
      while (u + w < width && !used[i + w] && mask[i + w] === blockId) {
        w++;
      }

      let h = 1;
      scan: while (v + h < height) {
        for (let x = 0; x < w; x++) {
          const next = u + x + (v + h) * width;
          if (used[next] || mask[next] !== blockId) break scan;
        }
        h++;
      }

      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          used[u + xx + (v + yy) * width] = 1;
        }
      }

      emit(u, v, w, h, blockId);
    }
  }
}

export function buildVoxelChunkGeometry(manifest: VoxelMapManifest, chunk: VoxelChunk): THREE.BufferGeometry {
  const cacheKey = `${manifest.id}:${chunk.coord.x}:${chunk.coord.y}:${chunk.coord.z}`;
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const buffers: MeshBuffers = { positions: [], normals: [], uvs: [], indices: [] };
  const getBlock = createBlockAccessor(manifest);
  const chunkOrigin = {
    x: chunk.coord.x * manifest.chunkSize.x,
    y: chunk.coord.y * manifest.chunkSize.y,
    z: chunk.coord.z * manifest.chunkSize.z,
  };

  const isFaceVisible = (block: number, neighbor: number): boolean => isSolidBlock(block) && !isSolidBlock(neighbor);

  for (let lx = 0; lx < chunk.size.x; lx++) {
    const pxMask: (VoxelBlockId | null)[] = new Array(chunk.size.z * chunk.size.y).fill(null);
    const nxMask: (VoxelBlockId | null)[] = new Array(chunk.size.z * chunk.size.y).fill(null);
    const gx = chunkOrigin.x + lx;

    for (let ly = 0; ly < chunk.size.y; ly++) {
      for (let lz = 0; lz < chunk.size.z; lz++) {
        const gy = chunkOrigin.y + ly;
        const gz = chunkOrigin.z + lz;
        const block = getBlock(gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const blockId = getBlockId(block);
        const index = lz + ly * chunk.size.z;
        if (isFaceVisible(block, getBlock(gx + 1, gy, gz))) pxMask[index] = blockId;
        if (isFaceVisible(block, getBlock(gx - 1, gy, gz))) nxMask[index] = blockId;
      }
    }

    greedyMask(pxMask, chunk.size.z, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'px', { x: gx, y: chunkOrigin.y + v, z: chunkOrigin.z + u, width, height, blockId });
    });
    greedyMask(nxMask, chunk.size.z, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'nx', { x: gx, y: chunkOrigin.y + v, z: chunkOrigin.z + u, width, height, blockId });
    });
  }

  for (let ly = 0; ly < chunk.size.y; ly++) {
    const pyMask: (VoxelBlockId | null)[] = new Array(chunk.size.x * chunk.size.z).fill(null);
    const nyMask: (VoxelBlockId | null)[] = new Array(chunk.size.x * chunk.size.z).fill(null);
    const gy = chunkOrigin.y + ly;

    for (let lz = 0; lz < chunk.size.z; lz++) {
      for (let lx = 0; lx < chunk.size.x; lx++) {
        const gx = chunkOrigin.x + lx;
        const gz = chunkOrigin.z + lz;
        const block = getBlock(gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const blockId = getBlockId(block);
        const index = lx + lz * chunk.size.x;
        if (isFaceVisible(block, getBlock(gx, gy + 1, gz))) pyMask[index] = blockId;
        if (isFaceVisible(block, getBlock(gx, gy - 1, gz))) nyMask[index] = blockId;
      }
    }

    greedyMask(pyMask, chunk.size.x, chunk.size.z, (u, v, width, height, blockId) => {
      emitFace(buffers, 'py', { x: chunkOrigin.x + u, y: gy, z: chunkOrigin.z + v, width, height, blockId });
    });
    greedyMask(nyMask, chunk.size.x, chunk.size.z, (u, v, width, height, blockId) => {
      emitFace(buffers, 'ny', { x: chunkOrigin.x + u, y: gy, z: chunkOrigin.z + v, width, height, blockId });
    });
  }

  for (let lz = 0; lz < chunk.size.z; lz++) {
    const pzMask: (VoxelBlockId | null)[] = new Array(chunk.size.x * chunk.size.y).fill(null);
    const nzMask: (VoxelBlockId | null)[] = new Array(chunk.size.x * chunk.size.y).fill(null);
    const gz = chunkOrigin.z + lz;

    for (let ly = 0; ly < chunk.size.y; ly++) {
      for (let lx = 0; lx < chunk.size.x; lx++) {
        const gx = chunkOrigin.x + lx;
        const gy = chunkOrigin.y + ly;
        const block = getBlock(gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const blockId = getBlockId(block);
        const index = lx + ly * chunk.size.x;
        if (isFaceVisible(block, getBlock(gx, gy, gz + 1))) pzMask[index] = blockId;
        if (isFaceVisible(block, getBlock(gx, gy, gz - 1))) nzMask[index] = blockId;
      }
    }

    greedyMask(pzMask, chunk.size.x, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'pz', { x: chunkOrigin.x + u, y: chunkOrigin.y + v, z: gz, width, height, blockId });
    });
    greedyMask(nzMask, chunk.size.x, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'nz', { x: chunkOrigin.x + u, y: chunkOrigin.y + v, z: gz, width, height, blockId });
    });
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setIndex(buffers.indices);
  geometry.scale(manifest.voxelSize.x, manifest.voxelSize.y, manifest.voxelSize.z);
  geometry.translate(manifest.origin.x, manifest.origin.y, manifest.origin.z);
  geometry.computeBoundingSphere();

  geometryCache.set(cacheKey, geometry);
  return geometry;
}

export function clearVoxelGeometryCache(manifestId?: string): void {
  if (!manifestId) {
    geometryCache.clear();
    blockAccessorCache.clear();
    return;
  }

  for (const key of geometryCache.keys()) {
    if (key.startsWith(`${manifestId}:`)) {
      geometryCache.delete(key);
    }
  }
  blockAccessorCache.delete(manifestId);
}
