import {
  getBlockId,
  isSolidBlock,
  type VoxelChunk,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import { getTextureLayerForBlock, type VoxelFaceDirection } from './terrainTextures';

export interface VoxelMeshGeometryData {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  textureLayers: Float32Array;
  indices: Uint16Array | Uint32Array;
}

export type VoxelRegionGeometryDetail = 'full' | 'coarse';

const COARSE_REGION_VOXEL_STEP = 8;

interface ChunkLookup {
  chunks: Array<VoxelChunk | undefined>;
  chunksX: number;
  chunksY: number;
  chunksZ: number;
  manifest: VoxelMapManifest;
}

interface VoxelChunkMeshScratch {
  positiveMask: Uint8Array;
  negativeMask: Uint8Array;
}

const chunkLookupCache = new WeakMap<VoxelMapManifest, ChunkLookup>();
const solidBlockCache: Array<boolean | undefined> = [];
const textureLayerCache: Array<[number | undefined, number | undefined, number | undefined] | undefined> = [];

class FloatBuilder {
  private buffer: Float32Array;
  length = 0;

  constructor(initialCapacity: number) {
    this.buffer = new Float32Array(initialCapacity);
  }

  push4(a: number, b: number, c: number, d: number): void {
    this.ensure(4);
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
    this.buffer[this.length++] = d;
  }

  push12(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number,
    i: number,
    j: number,
    k: number,
    l: number
  ): void {
    this.ensure(12);
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
    this.buffer[this.length++] = d;
    this.buffer[this.length++] = e;
    this.buffer[this.length++] = f;
    this.buffer[this.length++] = g;
    this.buffer[this.length++] = h;
    this.buffer[this.length++] = i;
    this.buffer[this.length++] = j;
    this.buffer[this.length++] = k;
    this.buffer[this.length++] = l;
  }

  pushRepeated3x4(a: number, b: number, c: number): void {
    this.ensure(12);
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
  }

  finish(): Float32Array {
    return this.length === this.buffer.length ? this.buffer : this.buffer.slice(0, this.length);
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
  private buffer: Uint16Array | Uint32Array;
  length = 0;
  private usesUint32 = false;

  constructor(initialCapacity: number) {
    this.buffer = new Uint16Array(initialCapacity);
  }

  push(a: number, b: number, c: number, d: number, e: number, f: number): void {
    if (!this.usesUint32 && (a > 65_535 || b > 65_535 || c > 65_535 || d > 65_535 || e > 65_535 || f > 65_535)) {
      this.promoteToUint32();
    }
    this.ensure(6);
    this.buffer[this.length++] = a;
    this.buffer[this.length++] = b;
    this.buffer[this.length++] = c;
    this.buffer[this.length++] = d;
    this.buffer[this.length++] = e;
    this.buffer[this.length++] = f;
  }

  finish(vertexCount: number): Uint16Array | Uint32Array {
    if (vertexCount > 65_535 && !this.usesUint32) {
      this.promoteToUint32();
    }

    return this.length === this.buffer.length ? this.buffer : this.buffer.slice(0, this.length);
  }

  private ensure(extra: number): void {
    const needed = this.length + extra;
    if (needed <= this.buffer.length) return;

    let nextCapacity = this.buffer.length;
    while (nextCapacity < needed) {
      nextCapacity = Math.max(nextCapacity * 2, 1024);
    }

    const next = this.usesUint32 ? new Uint32Array(nextCapacity) : new Uint16Array(nextCapacity);
    next.set(this.buffer);
    this.buffer = next;
  }

  private promoteToUint32(): void {
    const next = new Uint32Array(this.buffer.length);
    next.set(this.buffer);
    this.buffer = next;
    this.usesUint32 = true;
  }
}

interface MeshBufferBuilders {
  positions: FloatBuilder;
  normals: FloatBuilder;
  uvs: FloatBuilder;
  textureLayers: FloatBuilder;
  indices: IndexBuilder;
}

function createMeshBufferBuildersForEstimatedFaces(estimatedFaces: number): MeshBufferBuilders {
  const estimatedVertices = estimatedFaces * 4;
  return {
    positions: new FloatBuilder(estimatedVertices * 3),
    normals: new FloatBuilder(estimatedVertices * 3),
    uvs: new FloatBuilder(estimatedVertices * 2),
    textureLayers: new FloatBuilder(estimatedVertices),
    indices: new IndexBuilder(estimatedFaces * 6),
  };
}

function createMeshBufferBuilders(chunks: VoxelChunk[]): MeshBufferBuilders {
  const estimatedFaces = Math.max(64, chunks.reduce((sum, chunk) => sum + Math.ceil(chunk.solidBlockCount * 0.42), 0));
  return createMeshBufferBuildersForEstimatedFaces(estimatedFaces);
}

function createVoxelChunkMeshScratch(manifest: VoxelMapManifest): VoxelChunkMeshScratch {
  const maxMaskArea = Math.max(
    manifest.chunkSize.z * manifest.chunkSize.y,
    manifest.chunkSize.x * manifest.chunkSize.z,
    manifest.chunkSize.x * manifest.chunkSize.y
  );

  return {
    positiveMask: new Uint8Array(maxMaskArea),
    negativeMask: new Uint8Array(maxMaskArea),
  };
}

function blockIndex(x: number, y: number, z: number, size: { x: number; y: number; z: number }): number {
  return x + size.x * (z + size.z * y);
}

function chunkLookupIndex(x: number, y: number, z: number, chunksX: number, chunksZ: number): number {
  return x + chunksX * (z + chunksZ * y);
}

export function createChunkLookup(manifest: VoxelMapManifest): ChunkLookup {
  const cached = chunkLookupCache.get(manifest);
  if (cached) return cached;

  const chunksX = Math.ceil(manifest.size.x / manifest.chunkSize.x);
  const chunksY = Math.ceil(manifest.size.y / manifest.chunkSize.y);
  const chunksZ = Math.ceil(manifest.size.z / manifest.chunkSize.z);
  const chunks = new Array<VoxelChunk | undefined>(chunksX * chunksY * chunksZ);

  for (const chunk of manifest.chunks) {
    chunks[chunkLookupIndex(chunk.coord.x, chunk.coord.y, chunk.coord.z, chunksX, chunksZ)] = chunk;
  }

  const lookup = { chunks, chunksX, chunksY, chunksZ, manifest };
  chunkLookupCache.set(manifest, lookup);
  return lookup;
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

function isSolidNumericBlock(block: number): boolean {
  if (block === 0) return false;
  const cached = solidBlockCache[block];
  if (cached !== undefined) return cached;

  const solid = isSolidBlock(block);
  solidBlockCache[block] = solid;
  return solid;
}

function getChunkNeighbor(
  lookup: ChunkLookup,
  x: number,
  y: number,
  z: number
): VoxelChunk | undefined {
  if (x < 0 || x >= lookup.chunksX || y < 0 || y >= lookup.chunksY || z < 0 || z >= lookup.chunksZ) {
    return undefined;
  }
  return lookup.chunks[chunkLookupIndex(x, y, z, lookup.chunksX, lookup.chunksZ)];
}

function getChunkBlock(chunk: VoxelChunk | undefined, x: number, y: number, z: number): number {
  if (!chunk || x < 0 || x >= chunk.size.x || y < 0 || y >= chunk.size.y || z < 0 || z >= chunk.size.z) {
    return 0;
  }
  return chunk.blocks[blockIndex(x, y, z, chunk.size)] ?? 0;
}

function getFaceTextureIndex(face: VoxelFaceDirection): 0 | 1 | 2 {
  return face === 'top' ? 0 : face === 'bottom' ? 1 : 2;
}

function getCachedTextureLayer(blockId: number, face: VoxelFaceDirection): number {
  const faceIndex = getFaceTextureIndex(face);
  let layers = textureLayerCache[blockId];
  if (!layers) {
    layers = [undefined, undefined, undefined];
    textureLayerCache[blockId] = layers;
  }

  const cached = layers[faceIndex];
  if (cached !== undefined) return cached;

  const layer = getTextureLayerForBlock(getBlockId(blockId), face).layer;
  layers[faceIndex] = layer;
  return layer;
}

function pushUv(
  buffers: MeshBufferBuilders,
  blockId: number,
  face: VoxelFaceDirection,
  repeatWidth: number,
  repeatHeight: number
): void {
  const layer = getCachedTextureLayer(blockId, face);

  buffers.uvs.push4(0, 0, repeatWidth, 0);
  buffers.uvs.push4(repeatWidth, repeatHeight, 0, repeatHeight);
  buffers.textureLayers.push4(layer, layer, layer, layer);
}

function pushQuad(
  buffers: MeshBufferBuilders,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
  dx: number,
  dy: number,
  dz: number,
  normalX: number,
  normalY: number,
  normalZ: number,
  blockId: number,
  face: VoxelFaceDirection,
  repeatWidth: number,
  repeatHeight: number
): void {
  const baseIndex = buffers.positions.length / 3;

  buffers.positions.push12(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
  buffers.normals.pushRepeated3x4(normalX, normalY, normalZ);

  pushUv(buffers, blockId, face, repeatWidth, repeatHeight);
  buffers.indices.push(baseIndex, baseIndex + 1, baseIndex + 2, baseIndex, baseIndex + 2, baseIndex + 3);
}

function emitPositiveXFace(
  buffers: MeshBufferBuilders,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  blockId: number
): void {
  pushQuad(
    buffers,
    x + 1, y, z + width,
    x + 1, y, z,
    x + 1, y + height, z,
    x + 1, y + height, z + width,
    1, 0, 0,
    blockId, 'side', width, height
  );
}

function emitNegativeXFace(
  buffers: MeshBufferBuilders,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  blockId: number
): void {
  pushQuad(
    buffers,
    x, y, z,
    x, y, z + width,
    x, y + height, z + width,
    x, y + height, z,
    -1, 0, 0,
    blockId, 'side', width, height
  );
}

function emitPositiveYFace(
  buffers: MeshBufferBuilders,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  blockId: number
): void {
  pushQuad(
    buffers,
    x, y + 1, z,
    x, y + 1, z + height,
    x + width, y + 1, z + height,
    x + width, y + 1, z,
    0, 1, 0,
    blockId, 'top', height, width
  );
}

function emitNegativeYFace(
  buffers: MeshBufferBuilders,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  blockId: number
): void {
  pushQuad(
    buffers,
    x, y, z + height,
    x, y, z,
    x + width, y, z,
    x + width, y, z + height,
    0, -1, 0,
    blockId, 'bottom', height, width
  );
}

function emitPositiveZFace(
  buffers: MeshBufferBuilders,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  blockId: number
): void {
  pushQuad(
    buffers,
    x, y, z + 1,
    x + width, y, z + 1,
    x + width, y + height, z + 1,
    x, y + height, z + 1,
    0, 0, 1,
    blockId, 'side', width, height
  );
}

function emitNegativeZFace(
  buffers: MeshBufferBuilders,
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
  blockId: number
): void {
  pushQuad(
    buffers,
    x + width, y, z,
    x, y, z,
    x, y + height, z,
    x + width, y + height, z,
    0, 0, -1,
    blockId, 'side', width, height
  );
}

function greedyMask(
  mask: Uint8Array,
  width: number,
  height: number,
  emit: (u: number, v: number, w: number, h: number, blockId: number) => void
): void {
  for (let v = 0; v < height; v++) {
    for (let u = 0; u < width; u++) {
      const i = u + v * width;
      const blockId = mask[i];
      if (blockId === 0) continue;

      let w = 1;
      while (u + w < width && mask[i + w] === blockId) {
        w++;
      }

      let h = 1;
      scan: while (v + h < height) {
        for (let x = 0; x < w; x++) {
          const next = u + x + (v + h) * width;
          if (mask[next] !== blockId) break scan;
        }
        h++;
      }

      for (let yy = 0; yy < h; yy++) {
        mask.fill(0, u + yy * width, u + w + yy * width);
      }

      emit(u, v, w, h, blockId);
    }
  }
}

function appendVoxelChunkBuffers(
  manifest: VoxelMapManifest,
  lookup: ChunkLookup,
  chunk: VoxelChunk,
  buffers: MeshBufferBuilders,
  scratch: VoxelChunkMeshScratch
): void {
  const chunkOrigin = {
    x: chunk.coord.x * manifest.chunkSize.x,
    y: chunk.coord.y * manifest.chunkSize.y,
    z: chunk.coord.z * manifest.chunkSize.z,
  };
  const { blocks, size } = chunk;
  const sizeX = size.x;
  const sizeY = size.y;
  const sizeZ = size.z;
  const yStride = sizeX * sizeZ;
  const positiveMask = scratch.positiveMask;
  const negativeMask = scratch.negativeMask;
  const coordX = chunk.coord.x;
  const coordY = chunk.coord.y;
  const coordZ = chunk.coord.z;
  const positiveXNeighbor = getChunkNeighbor(lookup, coordX + 1, coordY, coordZ);
  const negativeXNeighbor = getChunkNeighbor(lookup, coordX - 1, coordY, coordZ);
  const positiveYNeighbor = getChunkNeighbor(lookup, coordX, coordY + 1, coordZ);
  const negativeYNeighbor = getChunkNeighbor(lookup, coordX, coordY - 1, coordZ);
  const positiveZNeighbor = getChunkNeighbor(lookup, coordX, coordY, coordZ + 1);
  const negativeZNeighbor = getChunkNeighbor(lookup, coordX, coordY, coordZ - 1);

  const xMaskArea = sizeZ * sizeY;

  for (let lx = 0; lx < sizeX; lx++) {
    positiveMask.fill(0, 0, xMaskArea);
    negativeMask.fill(0, 0, xMaskArea);
    const gx = chunkOrigin.x + lx;

    for (let ly = 0; ly < sizeY; ly++) {
      const rowOffset = lx + yStride * ly;
      const gy = chunkOrigin.y + ly;
      for (let lz = 0; lz < sizeZ; lz++) {
        const gz = chunkOrigin.z + lz;
        const blockOffset = rowOffset + sizeX * lz;
        const block = blocks[blockOffset];
        if (block === 0) continue;
        if (!isSolidNumericBlock(block)) continue;

        const index = lz + ly * sizeZ;
        const pxNeighbor = lx + 1 < sizeX ? blocks[blockOffset + 1] : getChunkBlock(positiveXNeighbor, 0, ly, lz);
        const nxNeighbor = lx > 0 ? blocks[blockOffset - 1] : getChunkBlock(negativeXNeighbor, negativeXNeighbor ? negativeXNeighbor.size.x - 1 : 0, ly, lz);
        if (pxNeighbor === 0 || !isSolidNumericBlock(pxNeighbor)) positiveMask[index] = block;
        if (nxNeighbor === 0 || !isSolidNumericBlock(nxNeighbor)) negativeMask[index] = block;
      }
    }

    greedyMask(positiveMask, sizeZ, sizeY, (u, v, width, height, blockId) => {
      emitPositiveXFace(buffers, gx, chunkOrigin.y + v, chunkOrigin.z + u, width, height, blockId);
    });
    greedyMask(negativeMask, sizeZ, sizeY, (u, v, width, height, blockId) => {
      emitNegativeXFace(buffers, gx, chunkOrigin.y + v, chunkOrigin.z + u, width, height, blockId);
    });
  }

  const yMaskArea = sizeX * sizeZ;

  for (let ly = 0; ly < sizeY; ly++) {
    positiveMask.fill(0, 0, yMaskArea);
    negativeMask.fill(0, 0, yMaskArea);
    const gy = chunkOrigin.y + ly;

    for (let lz = 0; lz < sizeZ; lz++) {
      const rowOffset = sizeX * (lz + sizeZ * ly);
      const gz = chunkOrigin.z + lz;
      for (let lx = 0; lx < sizeX; lx++) {
        const gx = chunkOrigin.x + lx;
        const blockOffset = rowOffset + lx;
        const block = blocks[blockOffset];
        if (block === 0) continue;
        if (!isSolidNumericBlock(block)) continue;

        const index = lx + lz * sizeX;
        const pyNeighbor = ly + 1 < sizeY ? blocks[blockOffset + yStride] : getChunkBlock(positiveYNeighbor, lx, 0, lz);
        const nyNeighbor = ly > 0 ? blocks[blockOffset - yStride] : getChunkBlock(negativeYNeighbor, lx, negativeYNeighbor ? negativeYNeighbor.size.y - 1 : 0, lz);
        if (pyNeighbor === 0 || !isSolidNumericBlock(pyNeighbor)) positiveMask[index] = block;
        if (nyNeighbor === 0 || !isSolidNumericBlock(nyNeighbor)) negativeMask[index] = block;
      }
    }

    greedyMask(positiveMask, sizeX, sizeZ, (u, v, width, height, blockId) => {
      emitPositiveYFace(buffers, chunkOrigin.x + u, gy, chunkOrigin.z + v, width, height, blockId);
    });
    greedyMask(negativeMask, sizeX, sizeZ, (u, v, width, height, blockId) => {
      emitNegativeYFace(buffers, chunkOrigin.x + u, gy, chunkOrigin.z + v, width, height, blockId);
    });
  }

  const zMaskArea = sizeX * sizeY;

  for (let lz = 0; lz < sizeZ; lz++) {
    positiveMask.fill(0, 0, zMaskArea);
    negativeMask.fill(0, 0, zMaskArea);
    const gz = chunkOrigin.z + lz;

    for (let ly = 0; ly < sizeY; ly++) {
      const rowOffset = sizeX * (lz + sizeZ * ly);
      const gy = chunkOrigin.y + ly;
      for (let lx = 0; lx < sizeX; lx++) {
        const gx = chunkOrigin.x + lx;
        const blockOffset = rowOffset + lx;
        const block = blocks[blockOffset];
        if (block === 0) continue;
        if (!isSolidNumericBlock(block)) continue;

        const index = lx + ly * sizeX;
        const pzNeighbor = lz + 1 < sizeZ ? blocks[blockOffset + sizeX] : getChunkBlock(positiveZNeighbor, lx, ly, 0);
        const nzNeighbor = lz > 0 ? blocks[blockOffset - sizeX] : getChunkBlock(negativeZNeighbor, lx, ly, negativeZNeighbor ? negativeZNeighbor.size.z - 1 : 0);
        if (pzNeighbor === 0 || !isSolidNumericBlock(pzNeighbor)) positiveMask[index] = block;
        if (nzNeighbor === 0 || !isSolidNumericBlock(nzNeighbor)) negativeMask[index] = block;
      }
    }

    greedyMask(positiveMask, sizeX, sizeY, (u, v, width, height, blockId) => {
      emitPositiveZFace(buffers, chunkOrigin.x + u, chunkOrigin.y + v, gz, width, height, blockId);
    });
    greedyMask(negativeMask, sizeX, sizeY, (u, v, width, height, blockId) => {
      emitNegativeZFace(buffers, chunkOrigin.x + u, chunkOrigin.y + v, gz, width, height, blockId);
    });
  }
}

function getChunkVoxelBounds(manifest: VoxelMapManifest, chunks: VoxelChunk[]): {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
} {
  let minX = manifest.size.x;
  let minZ = manifest.size.z;
  let maxX = 0;
  let maxZ = 0;

  for (const chunk of chunks) {
    const chunkMinX = chunk.coord.x * manifest.chunkSize.x;
    const chunkMinZ = chunk.coord.z * manifest.chunkSize.z;
    minX = Math.min(minX, chunkMinX);
    minZ = Math.min(minZ, chunkMinZ);
    maxX = Math.max(maxX, chunkMinX + chunk.size.x);
    maxZ = Math.max(maxZ, chunkMinZ + chunk.size.z);
  }

  return {
    minX: Math.max(0, minX),
    minZ: Math.max(0, minZ),
    maxX: Math.min(manifest.size.x, maxX),
    maxZ: Math.min(manifest.size.z, maxZ),
  };
}

function getTopSolidBlock(
  manifest: VoxelMapManifest,
  lookup: ChunkLookup,
  x: number,
  z: number
): { y: number; block: number } | null {
  if (x < 0 || x >= manifest.size.x || z < 0 || z >= manifest.size.z) return null;

  const topRows = manifest.heightfield?.topSolidRows;
  const heightfieldSize = manifest.heightfield?.size;
  let startY = manifest.size.y - 1;
  if (
    topRows?.length &&
    heightfieldSize &&
    x < heightfieldSize.x &&
    z < heightfieldSize.z
  ) {
    const topRow = topRows[x + z * heightfieldSize.x] ?? 0;
    if (topRow <= 0) return null;
    startY = Math.min(manifest.size.y - 1, topRow - 1);
    const block = getBlock(lookup, x, startY, z);
    if (block !== 0 && isSolidNumericBlock(block)) return { y: startY, block };
  }

  for (let y = startY; y >= 0; y--) {
    const block = getBlock(lookup, x, y, z);
    if (block !== 0 && isSolidNumericBlock(block)) return { y, block };
  }

  return null;
}

function buildCoarseVoxelRegionGeometryData(
  manifest: VoxelMapManifest,
  chunks: VoxelChunk[]
): VoxelMeshGeometryData {
  const lookup = createChunkLookup(manifest);
  const bounds = getChunkVoxelBounds(manifest, chunks);
  const estimatedCoarseFaces = Math.max(
    16,
    Math.ceil((bounds.maxX - bounds.minX) / COARSE_REGION_VOXEL_STEP) *
      Math.ceil((bounds.maxZ - bounds.minZ) / COARSE_REGION_VOXEL_STEP)
  );
  const buffers = createMeshBufferBuildersForEstimatedFaces(estimatedCoarseFaces);

  for (let z = bounds.minZ; z < bounds.maxZ; z += COARSE_REGION_VOXEL_STEP) {
    const z1 = Math.min(bounds.maxZ, z + COARSE_REGION_VOXEL_STEP);
    const sampleZ = Math.min(manifest.size.z - 1, z + Math.floor((z1 - z) * 0.5));

    for (let x = bounds.minX; x < bounds.maxX; x += COARSE_REGION_VOXEL_STEP) {
      const x1 = Math.min(bounds.maxX, x + COARSE_REGION_VOXEL_STEP);
      const sampleX = Math.min(manifest.size.x - 1, x + Math.floor((x1 - x) * 0.5));
      const topBlock = getTopSolidBlock(manifest, lookup, sampleX, sampleZ);
      if (!topBlock) continue;

      emitPositiveYFace(buffers, x, topBlock.y, z, x1 - x, z1 - z, topBlock.block);
    }
  }

  const vertexCount = buffers.positions.length / 3;
  return {
    positions: buffers.positions.finish(),
    normals: buffers.normals.finish(),
    uvs: buffers.uvs.finish(),
    textureLayers: buffers.textureLayers.finish(),
    indices: buffers.indices.finish(vertexCount),
  };
}

export function buildVoxelRegionGeometryData(
  manifest: VoxelMapManifest,
  chunks: VoxelChunk[],
  detail: VoxelRegionGeometryDetail = 'full'
): VoxelMeshGeometryData {
  if (detail === 'coarse') {
    return buildCoarseVoxelRegionGeometryData(manifest, chunks);
  }

  const lookup = createChunkLookup(manifest);
  const buffers = createMeshBufferBuilders(chunks);
  const scratch = createVoxelChunkMeshScratch(manifest);

  for (const chunk of chunks) {
    appendVoxelChunkBuffers(manifest, lookup, chunk, buffers, scratch);
  }

  const vertexCount = buffers.positions.length / 3;
  return {
    positions: buffers.positions.finish(),
    normals: buffers.normals.finish(),
    uvs: buffers.uvs.finish(),
    textureLayers: buffers.textureLayers.finish(),
    indices: buffers.indices.finish(vertexCount),
  };
}
