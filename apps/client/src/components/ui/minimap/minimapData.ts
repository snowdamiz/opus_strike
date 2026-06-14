import {
  getBlockId,
  type BoundaryPoint,
  type Player,
  type Team,
  type Vec3,
  type VoxelBlockId,
  type VoxelChunk,
  type VoxelMapManifest,
} from '@voxel-strike/shared';

export interface MinimapBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  width: number;
  depth: number;
}

export interface MinimapProjection {
  bounds: MinimapBounds;
  size: number;
  padding: number;
  scale: number;
  contentWidth: number;
  contentHeight: number;
  offsetX: number;
  offsetY: number;
}

export interface MinimapPoint {
  x: number;
  y: number;
}

export type MinimapSurfaceKind =
  | 'empty'
  | 'terrain'
  | 'structure'
  | 'accentRed'
  | 'accentBlue'
  | 'spawnRed'
  | 'spawnBlue'
  | 'flag'
  | 'barrier'
  | 'hazard';

export interface MinimapPlayerLike {
  id: string;
  team: Team;
  state: Player['state'];
  position: Vec3;
  lookYaw: number;
  hasFlag?: boolean;
}

export function getMinimapBounds(manifest: Pick<VoxelMapManifest, 'boundary' | 'origin' | 'size' | 'voxelSize'>): MinimapBounds {
  if (manifest.boundary.length > 0) {
    return getBoundaryBounds(manifest.boundary);
  }

  const minX = manifest.origin.x;
  const minZ = manifest.origin.z;
  const maxX = minX + manifest.size.x * manifest.voxelSize.x;
  const maxZ = minZ + manifest.size.z * manifest.voxelSize.z;
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: Math.max(1, maxX - minX),
    depth: Math.max(1, maxZ - minZ),
  };
}

export function getBoundaryBounds(boundary: BoundaryPoint[]): MinimapBounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (const point of boundary) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minZ = Math.min(minZ, point.z);
    maxZ = Math.max(maxZ, point.z);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1, width: 2, depth: 2 };
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: Math.max(1, maxX - minX),
    depth: Math.max(1, maxZ - minZ),
  };
}

export function createMinimapProjection(bounds: MinimapBounds, size: number, padding: number): MinimapProjection {
  const contentSize = Math.max(1, size - padding * 2);
  const scale = Math.min(contentSize / bounds.width, contentSize / bounds.depth);
  const contentWidth = bounds.width * scale;
  const contentHeight = bounds.depth * scale;

  return {
    bounds,
    size,
    padding,
    scale,
    contentWidth,
    contentHeight,
    offsetX: (size - contentWidth) / 2,
    offsetY: (size - contentHeight) / 2,
  };
}

export function worldToMinimap(
  projection: MinimapProjection,
  position: Pick<Vec3, 'x' | 'z'>
): MinimapPoint {
  return {
    x: projection.offsetX + (position.x - projection.bounds.minX) * projection.scale,
    y: projection.offsetY + (position.z - projection.bounds.minZ) * projection.scale,
  };
}

export function minimapToWorld(
  projection: MinimapProjection,
  point: MinimapPoint
): { x: number; z: number } {
  return {
    x: projection.bounds.minX + (point.x - projection.offsetX) / projection.scale,
    z: projection.bounds.minZ + (point.y - projection.offsetY) / projection.scale,
  };
}

export function isWorldPointInsideBoundary(position: Pick<Vec3, 'x' | 'z'>, boundary: BoundaryPoint[]): boolean {
  if (boundary.length < 3) return true;

  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[i];
    const b = boundary[j];
    const intersects = (
      (a.z > position.z) !== (b.z > position.z) &&
      position.x < ((b.x - a.x) * (position.z - a.z)) / (b.z - a.z || Number.EPSILON) + a.x
    );
    if (intersects) inside = !inside;
  }

  return inside;
}

export function getGridIndexForWorld(manifest: VoxelMapManifest, worldX: number, worldZ: number): number {
  const gridX = Math.floor((worldX - manifest.heightfield.origin.x) / manifest.heightfield.voxelSize.x);
  const gridZ = Math.floor((worldZ - manifest.heightfield.origin.z) / manifest.heightfield.voxelSize.z);

  if (
    gridX < 0 ||
    gridZ < 0 ||
    gridX >= manifest.heightfield.size.x ||
    gridZ >= manifest.heightfield.size.z
  ) {
    return -1;
  }

  return gridX + gridZ * manifest.heightfield.size.x;
}

export function buildTopBlockIndex(manifest: VoxelMapManifest): Uint8Array {
  const { size } = manifest.heightfield;
  const topBlocks = new Uint8Array(size.x * size.z);
  const chunks = createChunkLookup(manifest);

  for (let z = 0; z < size.z; z++) {
    for (let x = 0; x < size.x; x++) {
      const index = x + z * size.x;
      const topRow = manifest.heightfield.topSolidRows[index] ?? 0;
      if (topRow <= 0) continue;

      topBlocks[index] = getBlockAtGrid(manifest, chunks, x, topRow - 1, z);
    }
  }

  return topBlocks;
}

export function classifyMinimapBlock(blockId: number): MinimapSurfaceKind {
  const block = getBlockId(blockId);
  return classifyMinimapBlockId(block);
}

export function classifyMinimapBlockId(block: VoxelBlockId): MinimapSurfaceKind {
  switch (block) {
    case 'air':
      return 'empty';
    case 'barrier':
      return 'barrier';
    case 'lava':
      return 'hazard';
    case 'spawn_pad_red':
      return 'spawnRed';
    case 'spawn_pad_blue':
      return 'spawnBlue';
    case 'spawn_pad':
      return 'structure';
    case 'flag_pad':
      return 'flag';
    case 'neon_red':
      return 'accentRed';
    case 'neon_blue':
      return 'accentBlue';
    case 'metal':
    case 'glass':
    case 'wood':
      return 'structure';
    default:
      return 'terrain';
  }
}

export function getHeightRange(topSolidRows: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < topSolidRows.length; i++) {
    const height = topSolidRows[i] ?? 0;
    if (height <= 0) continue;
    min = Math.min(min, height);
    max = Math.max(max, height);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 0, max: 1 };
  }

  return { min, max: Math.max(min + 1, max) };
}

export function selectVisibleTeammates(
  localPlayer: MinimapPlayerLike | null,
  players: Iterable<MinimapPlayerLike>,
  out: MinimapPlayerLike[] = []
): MinimapPlayerLike[] {
  out.length = 0;
  if (!localPlayer) return out;

  for (const player of players) {
    if (player.id === localPlayer.id) continue;
    if (player.team !== localPlayer.team) continue;
    if (player.state === 'dead' || player.state === 'spectating' || player.state === 'selecting') continue;
    out.push(player);
  }

  return out;
}

interface ChunkLookup {
  chunks: Array<VoxelChunk | undefined>;
  chunksX: number;
  chunksZ: number;
}

function createChunkLookup(manifest: VoxelMapManifest): ChunkLookup {
  const chunksX = Math.ceil(manifest.size.x / manifest.chunkSize.x);
  const chunksY = Math.ceil(manifest.size.y / manifest.chunkSize.y);
  const chunksZ = Math.ceil(manifest.size.z / manifest.chunkSize.z);
  const chunks = new Array<VoxelChunk | undefined>(chunksX * chunksY * chunksZ);

  for (const chunk of manifest.chunks) {
    chunks[chunkLookupIndex(chunk.coord.x, chunk.coord.y, chunk.coord.z, chunksX, chunksZ)] = chunk;
  }

  return { chunks, chunksX, chunksZ };
}

function getBlockAtGrid(
  manifest: VoxelMapManifest,
  lookup: ChunkLookup,
  x: number,
  y: number,
  z: number
): number {
  if (x < 0 || x >= manifest.size.x || y < 0 || y >= manifest.size.y || z < 0 || z >= manifest.size.z) {
    return 0;
  }

  const cx = Math.floor(x / manifest.chunkSize.x);
  const cy = Math.floor(y / manifest.chunkSize.y);
  const cz = Math.floor(z / manifest.chunkSize.z);
  const chunk = lookup.chunks[chunkLookupIndex(cx, cy, cz, lookup.chunksX, lookup.chunksZ)];
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

function blockIndex(x: number, y: number, z: number, size: { x: number; y: number; z: number }): number {
  return x + size.x * (z + size.z * y);
}

function chunkLookupIndex(x: number, y: number, z: number, chunksX: number, chunksZ: number): number {
  return x + chunksX * (z + chunksZ * y);
}
