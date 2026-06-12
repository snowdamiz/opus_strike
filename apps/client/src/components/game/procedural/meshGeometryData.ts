import {
  getBlockId,
  isSolidBlock,
  type VoxelChunk,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import { getTileLayerForBlock, type VoxelFaceDirection } from './terrainTextures';

export interface VoxelMeshGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  tileLayers: Float32Array;
  indices: Uint16Array | Uint32Array;
}

interface FaceRect {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  blockId: number;
}

interface ChunkLookup {
  chunks: Array<VoxelChunk | undefined>;
  chunksX: number;
  chunksZ: number;
  manifest: VoxelMapManifest;
}

class FloatBuilder {
  private buffer: Float32Array;
  length = 0;

  constructor(initialCapacity: number) {
    this.buffer = new Float32Array(initialCapacity);
  }

  push(...values: number[]): void {
    this.ensure(values.length);
    this.buffer.set(values, this.length);
    this.length += values.length;
  }

  finish(): Float32Array {
    return this.buffer.slice(0, this.length);
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;

    let nextCapacity = this.buffer.length;
    while (nextCapacity < needed) {
      nextCapacity = Math.max(nextCapacity * 2, 1024);
    }

    const next = new Float32Array(nextCapacity);
    next.set(this.buffer);
    this.buffer = next;
  }
}

class IndexBuilder {
  private buffer: Uint32Array;
  length = 0;

  constructor(initialCapacity: number) {
    this.buffer = new Uint32Array(initialCapacity);
  }

  push(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.ensure(6);
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
    this.buffer[this.length++] = d;
    this.buffer[this.length++] = e;
    this.buffer[this.length++] = f;
  }

  finish(vertexCount: number): Uint16Array | Uint32Array {
    const view = this.buffer.subarray(0, this.length);
    if (vertexCount <= 65_535) {
      return new Uint16Array(view);
    }
    return view.slice();
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;

    let nextCapacity = this.buffer.length;
    while (nextCapacity < needed) {
      nextCapacity = Math.max(nextCapacity * 2, 1024);
    }

    const next = new Uint32Array(nextCapacity);
    next.set(this.buffer);
    this.buffer = next;
  }
}

interface MeshBufferBuilders {
  positions: FloatBuilder;
  normals: FloatBuilder;
  uvs: FloatBuilder;
  tileLayers: FloatBuilder;
  indices: IndexBuilder;
}

function createMeshBufferBuilders(chunks: VoxelChunk[]): MeshBufferBuilders {
  const estimatedFaces = Math.max(64, chunks.reduce((sum, chunk) => sum + Math.ceil(chunk.solidBlockCount * 0.42), 0));
  const estimatedVertices = estimatedFaces * 4;
  return {
    positions: new FloatBuilder(estimatedVertices * 3),
    normals: new FloatBuilder(estimatedVertices * 3),
    uvs: new FloatBuilder(estimatedVertices * 2),
    tileLayers: new FloatBuilder(estimatedVertices),
    indices: new IndexBuilder(estimatedFaces * 6),
  };
}

function blockIndex(x: number, y: number, z: number, size: { x: number; y: number; z: number }): number {
  return x + size.x * (z + size.z * y);
}

function chunkLookupIndex(x: number, y: number, z: number, chunksX: number, chunksZ: number): number {
  return x + chunksX * (z + chunksZ * y);
}

export function createChunkLookup(manifest: VoxelMapManifest): ChunkLookup {
  const chunksX = Math.ceil(manifest.size.x / manifest.chunkSize.x);
  const chunksY = Math.ceil(manifest.size.y / manifest.chunkSize.y);
  const chunksZ = Math.ceil(manifest.size.z / manifest.chunkSize.z);
  const chunks = new Array<VoxelChunk | undefined>(chunksX * chunksY * chunksZ);

  for (const chunk of manifest.chunks) {
    chunks[chunkLookupIndex(chunk.coord.x, chunk.coord.y, chunk.coord.z, chunksX, chunksZ)] = chunk;
  }

  return { chunks, chunksX, chunksZ, manifest };
}

function getBlock(lookup: ChunkLookup, x: number, y: number, z: number): number {
  const { manifest, chunks, chunksX, chunksZ } = lookup;
  if (x < 0 || x >= manifest.size.x || y < 0 || y >= manifest.size.y || z < 0 || z >= manifest.size.z) {
    return 0;
  }

  const cx = Math.floor(x / manifest.chunkSize.x);
  const cy = Math.floor(y / manifest.chunkSize.y);
  const cz = Math.floor(z / manifest.chunkSize.z);
  const chunk = chunks[chunkLookupIndex(cx, cy, cz, chunksX, chunksZ)];
  if (!chunk) return 0;

  return chunk.blocks[
    blockIndex(
      x - cx * manifest.chunkSize.x,
      y - cy * manifest.chunkSize.y,
      z - cz * manifest.chunkSize.z,
      chunk.size
    )
  ] ?? 0;
}

function pushUv(
  buffers: MeshBufferBuilders,
  blockId: number,
  face: VoxelFaceDirection,
  repeatWidth: number,
  repeatHeight: number
): void {
  const tileLayer = getTileLayerForBlock(getBlockId(blockId), face);

  buffers.uvs.push(0, 0, repeatWidth, 0, repeatWidth, repeatHeight, 0, repeatHeight);
  buffers.tileLayers.push(tileLayer, tileLayer, tileLayer, tileLayer);
}

function pushQuad(
  buffers: MeshBufferBuilders,
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
  buffers: MeshBufferBuilders,
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
  used: Uint8Array,
  width: number,
  height: number,
  emit: (u: number, v: number, w: number, h: number, blockId: number) => void
): void {
  const area = width * height;
  used.fill(0, 0, area);

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
        used.fill(1, u + yy * width, u + w + yy * width);
      }

      emit(u, v, w, h, blockId);
    }
  }
}

function appendVoxelChunkBuffers(
  manifest: VoxelMapManifest,
  lookup: ChunkLookup,
  chunk: VoxelChunk,
  buffers: MeshBufferBuilders
): void {
  const chunkOrigin = {
    x: chunk.coord.x * manifest.chunkSize.x,
    y: chunk.coord.y * manifest.chunkSize.y,
    z: chunk.coord.z * manifest.chunkSize.z,
  };

  const isFaceVisible = (block: number, neighbor: number): boolean => isSolidBlock(block) && !isSolidBlock(neighbor);

  const xMaskArea = chunk.size.z * chunk.size.y;
  const pxMask = new Uint8Array(xMaskArea);
  const nxMask = new Uint8Array(xMaskArea);
  const xUsed = new Uint8Array(xMaskArea);

  for (let lx = 0; lx < chunk.size.x; lx++) {
    pxMask.fill(0);
    nxMask.fill(0);
    const gx = chunkOrigin.x + lx;

    for (let ly = 0; ly < chunk.size.y; ly++) {
      for (let lz = 0; lz < chunk.size.z; lz++) {
        const gy = chunkOrigin.y + ly;
        const gz = chunkOrigin.z + lz;
        const block = getBlock(lookup, gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const index = lz + ly * chunk.size.z;
        if (isFaceVisible(block, getBlock(lookup, gx + 1, gy, gz))) pxMask[index] = block;
        if (isFaceVisible(block, getBlock(lookup, gx - 1, gy, gz))) nxMask[index] = block;
      }
    }

    greedyMask(pxMask, xUsed, chunk.size.z, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'px', { x: gx, y: chunkOrigin.y + v, z: chunkOrigin.z + u, width, height, blockId });
    });
    greedyMask(nxMask, xUsed, chunk.size.z, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'nx', { x: gx, y: chunkOrigin.y + v, z: chunkOrigin.z + u, width, height, blockId });
    });
  }

  const yMaskArea = chunk.size.x * chunk.size.z;
  const pyMask = new Uint8Array(yMaskArea);
  const nyMask = new Uint8Array(yMaskArea);
  const yUsed = new Uint8Array(yMaskArea);

  for (let ly = 0; ly < chunk.size.y; ly++) {
    pyMask.fill(0);
    nyMask.fill(0);
    const gy = chunkOrigin.y + ly;

    for (let lz = 0; lz < chunk.size.z; lz++) {
      for (let lx = 0; lx < chunk.size.x; lx++) {
        const gx = chunkOrigin.x + lx;
        const gz = chunkOrigin.z + lz;
        const block = getBlock(lookup, gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const index = lx + lz * chunk.size.x;
        if (isFaceVisible(block, getBlock(lookup, gx, gy + 1, gz))) pyMask[index] = block;
        if (isFaceVisible(block, getBlock(lookup, gx, gy - 1, gz))) nyMask[index] = block;
      }
    }

    greedyMask(pyMask, yUsed, chunk.size.x, chunk.size.z, (u, v, width, height, blockId) => {
      emitFace(buffers, 'py', { x: chunkOrigin.x + u, y: gy, z: chunkOrigin.z + v, width, height, blockId });
    });
    greedyMask(nyMask, yUsed, chunk.size.x, chunk.size.z, (u, v, width, height, blockId) => {
      emitFace(buffers, 'ny', { x: chunkOrigin.x + u, y: gy, z: chunkOrigin.z + v, width, height, blockId });
    });
  }

  const zMaskArea = chunk.size.x * chunk.size.y;
  const pzMask = new Uint8Array(zMaskArea);
  const nzMask = new Uint8Array(zMaskArea);
  const zUsed = new Uint8Array(zMaskArea);

  for (let lz = 0; lz < chunk.size.z; lz++) {
    pzMask.fill(0);
    nzMask.fill(0);
    const gz = chunkOrigin.z + lz;

    for (let ly = 0; ly < chunk.size.y; ly++) {
      for (let lx = 0; lx < chunk.size.x; lx++) {
        const gx = chunkOrigin.x + lx;
        const gy = chunkOrigin.y + ly;
        const block = getBlock(lookup, gx, gy, gz);
        if (!isSolidBlock(block)) continue;

        const index = lx + ly * chunk.size.x;
        if (isFaceVisible(block, getBlock(lookup, gx, gy, gz + 1))) pzMask[index] = block;
        if (isFaceVisible(block, getBlock(lookup, gx, gy, gz - 1))) nzMask[index] = block;
      }
    }

    greedyMask(pzMask, zUsed, chunk.size.x, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'pz', { x: chunkOrigin.x + u, y: chunkOrigin.y + v, z: gz, width, height, blockId });
    });
    greedyMask(nzMask, zUsed, chunk.size.x, chunk.size.y, (u, v, width, height, blockId) => {
      emitFace(buffers, 'nz', { x: chunkOrigin.x + u, y: chunkOrigin.y + v, z: gz, width, height, blockId });
    });
  }
}

export function buildVoxelChunkGeometryData(manifest: VoxelMapManifest, chunk: VoxelChunk): VoxelMeshGeometryData {
  return buildVoxelRegionGeometryData(manifest, [chunk]);
}

export function buildVoxelRegionGeometryData(manifest: VoxelMapManifest, chunks: VoxelChunk[]): VoxelMeshGeometryData {
  const lookup = createChunkLookup(manifest);
  const buffers = createMeshBufferBuilders(chunks);

  for (const chunk of chunks) {
    appendVoxelChunkBuffers(manifest, lookup, chunk, buffers);
  }

  const vertexCount = buffers.positions.length / 3;
  return {
    positions: buffers.positions.finish(),
    normals: buffers.normals.finish(),
    uvs: buffers.uvs.finish(),
    tileLayers: buffers.tileLayers.finish(),
    indices: buffers.indices.finish(vertexCount),
  };
}
