import * as THREE from 'three';
import {
  getBlockId,
  isSolidBlock,
  type VoxelChunk,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import { ATLAS_COLUMNS, ATLAS_ROWS, getTileForBlock, type VoxelFaceDirection } from './textureAtlas';
import { recordSystemTime, recordVoxelMeshBuild } from '../../../utils/perfMarks';

interface MeshBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  tileOrigins: number[];
  indices: number[];
}

interface FaceRect {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  blockId: number;
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

function chunkLookupIndex(coord: ChunkLookupKey, chunksX: number, chunksZ: number): number {
  return coord.x + chunksX * (coord.z + chunksZ * coord.y);
}

function createBlockAccessor(manifest: VoxelMapManifest): (x: number, y: number, z: number) => number {
  const cached = blockAccessorCache.get(manifest.id);
  if (cached) return cached;

  const chunks = new Map<number, VoxelChunk>();
  const chunksX = Math.ceil(manifest.size.x / manifest.chunkSize.x);
  const chunksZ = Math.ceil(manifest.size.z / manifest.chunkSize.z);

  for (const chunk of manifest.chunks) {
    chunks.set(chunkLookupIndex(chunk.coord, chunksX, chunksZ), chunk);
  }

  const accessor = (x: number, y: number, z: number) => {
    if (x < 0 || x >= manifest.size.x || y < 0 || y >= manifest.size.y || z < 0 || z >= manifest.size.z) {
      return 0;
    }

    const cx = Math.floor(x / manifest.chunkSize.x);
    const cy = Math.floor(y / manifest.chunkSize.y);
    const cz = Math.floor(z / manifest.chunkSize.z);
    const chunk = chunks.get(chunkLookupIndex({ x: cx, y: cy, z: cz }, chunksX, chunksZ));
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

function pushUv(
  buffers: MeshBuffers,
  blockId: number,
  face: VoxelFaceDirection,
  repeatWidth: number,
  repeatHeight: number
): void {
  const tile = getTileForBlock(getBlockId(blockId), face);
  const tileOriginU = tile.x / ATLAS_COLUMNS;
  const tileOriginV = 1 - (tile.y + 1) / ATLAS_ROWS;

  buffers.uvs.push(0, 0, repeatWidth, 0, repeatWidth, repeatHeight, 0, repeatHeight);
  buffers.tileOrigins.push(
    tileOriginU,
    tileOriginV,
    tileOriginU,
    tileOriginV,
    tileOriginU,
    tileOriginV,
    tileOriginU,
    tileOriginV
  );
}

function pushQuad(
  buffers: MeshBuffers,
  vertices: [number, number, number][],
  normal: [number, number, number],
  blockId: number,
  face: VoxelFaceDirection,
  repeatWidth: number,
  repeatHeight: number
): void {
  const baseIndex = buffers.positions.length / 3;

  for (const vertex of vertices) {
    buffers.positions.push(vertex[0], vertex[1], vertex[2]);
    buffers.normals.push(normal[0], normal[1], normal[2]);
  }

  pushUv(buffers, blockId, face, repeatWidth, repeatHeight);
  buffers.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}

function emitFace(
  buffers: MeshBuffers,
  direction: 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz',
  rect: FaceRect
): void {
  const { x, y, z, width, height, blockId } = rect;

  if (direction === 'px') {
    pushQuad(buffers, [[x + 1, y, z + width], [x + 1, y, z], [x + 1, y + height, z], [x + 1, y + height, z + width]], [1, 0, 0], blockId, 'side', width, height);
  } else if (direction === 'nx') {
    pushQuad(buffers, [[x, y, z], [x, y, z + width], [x, y + height, z + width], [x, y + height, z]], [-1, 0, 0], blockId, 'side', width, height);
  } else if (direction === 'py') {
    pushQuad(buffers, [[x, y + 1, z], [x, y + 1, z + height], [x + width, y + 1, z + height], [x + width, y + 1, z]], [0, 1, 0], blockId, 'top', height, width);
  } else if (direction === 'ny') {
    pushQuad(buffers, [[x, y, z + height], [x, y, z], [x + width, y, z], [x + width, y, z + height]], [0, -1, 0], blockId, 'bottom', height, width);
  } else if (direction === 'pz') {
    pushQuad(buffers, [[x, y, z + 1], [x + width, y, z + 1], [x + width, y + height, z + 1], [x, y + height, z + 1]], [0, 0, 1], blockId, 'side', width, height);
  } else {
    pushQuad(buffers, [[x + width, y, z], [x, y, z], [x, y + height, z], [x + width, y + height, z]], [0, 0, -1], blockId, 'side', width, height);
  }
}

function greedyMask(
  mask: Uint8Array,
  width: number,
  height: number,
  emit: (u: number, v: number, w: number, h: number, blockId: number) => void
): void {
  const used = new Uint8Array(mask.length);

  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const i = u + v * width;
      const blockId = mask[i];
      if (blockId === 0 || used[i]) continue;

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

function appendVoxelChunkBuffers(
  manifest: VoxelMapManifest,
  chunk: VoxelChunk,
  buffers: MeshBuffers,
  getBlock: (x: number, y: number, z: number) => number
): void {
  const chunkOrigin = {
    x: chunk.coord.x * manifest.chunkSize.x,
    y: chunk.coord.y * manifest.chunkSize.y,
    z: chunk.coord.z * manifest.chunkSize.z,
  };

  const isFaceVisible = (block: number, neighbor: number): boolean => isSolidBlock(block) && !isSolidBlock(neighbor);

  for (let lx = 0; lx < chunk.size.x; lx++) {
    const pxMask = new Uint8Array(chunk.size.z * chunk.size.y);
    const nxMask = new Uint8Array(chunk.size.z * chunk.size.y);
    const gx = chunkOrigin.x + lx;

    for (let ly = 0; ly < chunk.size.y; ly++) {
      for (let lz = 0; lz < chunk.size.z; lz++) {
        const gy = chunkOrigin.y + ly;
        const gz = chunkOrigin.z + lz;
        const block = getBlock(gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const index = lz + ly * chunk.size.z;
        if (isFaceVisible(block, getBlock(gx + 1, gy, gz))) pxMask[index] = block;
        if (isFaceVisible(block, getBlock(gx - 1, gy, gz))) nxMask[index] = block;
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
    const pyMask = new Uint8Array(chunk.size.x * chunk.size.z);
    const nyMask = new Uint8Array(chunk.size.x * chunk.size.z);
    const gy = chunkOrigin.y + ly;

    for (let lz = 0; lz < chunk.size.z; lz++) {
      for (let lx = 0; lx < chunk.size.x; lx++) {
        const gx = chunkOrigin.x + lx;
        const gz = chunkOrigin.z + lz;
        const block = getBlock(gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const index = lx + lz * chunk.size.x;
        if (isFaceVisible(block, getBlock(gx, gy + 1, gz))) pyMask[index] = block;
        if (isFaceVisible(block, getBlock(gx, gy - 1, gz))) nyMask[index] = block;
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
    const pzMask = new Uint8Array(chunk.size.x * chunk.size.y);
    const nzMask = new Uint8Array(chunk.size.x * chunk.size.y);
    const gz = chunkOrigin.z + lz;

    for (let ly = 0; ly < chunk.size.y; ly++) {
      for (let lx = 0; lx < chunk.size.x; lx++) {
        const gx = chunkOrigin.x + lx;
        const gy = chunkOrigin.y + ly;
        const block = getBlock(gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const index = lx + ly * chunk.size.x;
        if (isFaceVisible(block, getBlock(gx, gy, gz + 1))) pzMask[index] = block;
        if (isFaceVisible(block, getBlock(gx, gy, gz - 1))) nzMask[index] = block;
      }
    }

    greedyMask(pzMask, chunk.size.x, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'pz', { x: chunkOrigin.x + u, y: chunkOrigin.y + v, z: gz, width, height, blockId });
    });
    greedyMask(nzMask, chunk.size.x, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'nz', { x: chunkOrigin.x + u, y: chunkOrigin.y + v, z: gz, width, height, blockId });
    });
  }
}

function createGeometryFromBuffers(
  manifest: VoxelMapManifest,
  cacheKey: string,
  buffers: MeshBuffers,
  metricName: 'voxelMeshBuild' | 'voxelRegionMeshBuild',
  buildStart = performance.now()
): THREE.BufferGeometry {
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(buffers.positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(buffers.normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('uv2', new THREE.Float32BufferAttribute(buffers.uvs, 2));
  geometry.setAttribute('voxelTileOrigin', new THREE.Float32BufferAttribute(buffers.tileOrigins, 2));
  geometry.setIndex(buffers.indices);
  geometry.scale(manifest.voxelSize.x, manifest.voxelSize.y, manifest.voxelSize.z);
  geometry.translate(manifest.origin.x, manifest.origin.y, manifest.origin.z);
  geometry.computeBoundingSphere();

  geometryCache.set(cacheKey, geometry);
  const buildMs = performance.now() - buildStart;
  recordVoxelMeshBuild(buildMs);
  recordSystemTime(metricName, buildMs);
  return geometry;
}

export function buildVoxelChunkGeometry(manifest: VoxelMapManifest, chunk: VoxelChunk): THREE.BufferGeometry {
  const cacheKey = `${manifest.id}:${chunk.coord.x}:${chunk.coord.y}:${chunk.coord.z}`;
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const buildStart = performance.now();
  const buffers: MeshBuffers = { positions: [], normals: [], uvs: [], tileOrigins: [], indices: [] };
  appendVoxelChunkBuffers(manifest, chunk, buffers, createBlockAccessor(manifest));
  return createGeometryFromBuffers(manifest, cacheKey, buffers, 'voxelMeshBuild', buildStart);
}

export function buildVoxelRegionGeometry(
  manifest: VoxelMapManifest,
  regionId: string,
  chunks: VoxelChunk[]
): THREE.BufferGeometry {
  const cacheKey = `${manifest.id}:region:${regionId}`;
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const buildStart = performance.now();
  const buffers: MeshBuffers = { positions: [], normals: [], uvs: [], tileOrigins: [], indices: [] };
  const getBlock = createBlockAccessor(manifest);

  for (const chunk of chunks) {
    appendVoxelChunkBuffers(manifest, chunk, buffers, getBlock);
  }

  return createGeometryFromBuffers(manifest, cacheKey, buffers, 'voxelRegionMeshBuild', buildStart);
}

export function clearVoxelGeometryCache(manifestId?: string): void {
  if (!manifestId) {
    for (const geometry of geometryCache.values()) {
      geometry.dispose();
    }
    geometryCache.clear();
    blockAccessorCache.clear();
    return;
  }

  for (const key of geometryCache.keys()) {
    if (key.startsWith(`${manifestId}:`)) {
      geometryCache.get(key)?.dispose();
      geometryCache.delete(key);
    }
  }
  blockAccessorCache.delete(manifestId);
}
