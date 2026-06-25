import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  DEFAULT_VOXEL_MAP_SIZE_ID,
  generateProceduralVoxelMap,
  normalizeVoxelMapSizeId,
  type VoxelChunk,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  getMapPrepCacheKey,
  type MapPrepCacheKeyInput,
} from './mapPrepCacheKey';
import { getVoxelChunkRegionId } from './voxelRegionKeys';

export { getMapPrepCacheKey, type MapPrepCacheKeyInput } from './mapPrepCacheKey';

const MAX_PREPARED_MAPS = 4;
const MAX_PREPARED_BATTLE_ROYAL_MAPS = 1;

export interface VoxelChunkRegionBounds {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  center: { x: number; y: number; z: number };
  radius: number;
}

export interface VoxelChunkRegion {
  id: string;
  chunks: VoxelChunk[];
  castShadow: boolean;
  bounds: VoxelChunkRegionBounds;
}

export interface PrepareVoxelMapOptions extends MapPrepCacheKeyInput {
  manifest?: VoxelMapManifest;
  source?: 'match' | 'mapVotePreview' | 'mapVoteFinalized' | 'mapGenerationStarted' | 'test';
}

export interface PreparedVoxelMap {
  key: string;
  seed: number;
  generatorVersion: number;
  manifest: VoxelMapManifest;
  renderableRegions: VoxelChunkRegion[];
  renderableChunkCount: number;
  generatedAtMs: number;
  lastUsedAtMs: number;
  source: NonNullable<PrepareVoxelMapOptions['source']>;
  cacheHits: number;
}

const preparedMapCache = new Map<string, PreparedVoxelMap>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createEmptyRegionBounds(): VoxelChunkRegionBounds {
  return {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
    center: { x: 0, y: 0, z: 0 },
    radius: 0,
  };
}

function includeChunkInRegionBounds(
  bounds: VoxelChunkRegionBounds,
  manifest: VoxelMapManifest,
  chunk: VoxelChunk
): void {
  const minVoxelX = chunk.coord.x * manifest.chunkSize.x;
  const minVoxelY = chunk.coord.y * manifest.chunkSize.y;
  const minVoxelZ = chunk.coord.z * manifest.chunkSize.z;
  const maxVoxelX = minVoxelX + chunk.size.x;
  const maxVoxelY = minVoxelY + chunk.size.y;
  const maxVoxelZ = minVoxelZ + chunk.size.z;

  bounds.min.x = Math.min(bounds.min.x, manifest.origin.x + minVoxelX * manifest.voxelSize.x);
  bounds.min.y = Math.min(bounds.min.y, manifest.origin.y + minVoxelY * manifest.voxelSize.y);
  bounds.min.z = Math.min(bounds.min.z, manifest.origin.z + minVoxelZ * manifest.voxelSize.z);
  bounds.max.x = Math.max(bounds.max.x, manifest.origin.x + maxVoxelX * manifest.voxelSize.x);
  bounds.max.y = Math.max(bounds.max.y, manifest.origin.y + maxVoxelY * manifest.voxelSize.y);
  bounds.max.z = Math.max(bounds.max.z, manifest.origin.z + maxVoxelZ * manifest.voxelSize.z);
}

function finalizeRegionBounds(bounds: VoxelChunkRegionBounds, manifest: VoxelMapManifest): void {
  const padding = Math.max(manifest.voxelSize.x, manifest.voxelSize.y, manifest.voxelSize.z) * 0.75;
  bounds.min.x -= padding;
  bounds.min.y -= padding;
  bounds.min.z -= padding;
  bounds.max.x += padding;
  bounds.max.y += padding;
  bounds.max.z += padding;

  bounds.center.x = (bounds.min.x + bounds.max.x) * 0.5;
  bounds.center.y = (bounds.min.y + bounds.max.y) * 0.5;
  bounds.center.z = (bounds.min.z + bounds.max.z) * 0.5;
  bounds.radius = Math.hypot(
    bounds.max.x - bounds.min.x,
    bounds.max.y - bounds.min.y,
    bounds.max.z - bounds.min.z
  ) * 0.5;
}

export function createVoxelChunkRegions(chunks: VoxelChunk[], manifest: VoxelMapManifest): VoxelChunkRegion[] {
  const regions = new Map<string, VoxelChunkRegion>();

  for (const chunk of chunks) {
    const id = getVoxelChunkRegionId(chunk.coord);
    let region = regions.get(id);

    if (!region) {
      region = { id, chunks: [], castShadow: chunk.coord.y > 0, bounds: createEmptyRegionBounds() };
      regions.set(id, region);
    }

    region.chunks.push(chunk);
    region.castShadow ||= chunk.coord.y > 0;
    includeChunkInRegionBounds(region.bounds, manifest, chunk);
  }

  const preparedRegions = Array.from(regions.values());
  for (const region of preparedRegions) {
    finalizeRegionBounds(region.bounds, manifest);
  }
  return preparedRegions;
}

function evictLeastRecentlyUsedPreparedMap(): void {
  const battleRoyalEntries = Array.from(preparedMapCache.entries()).filter(([, entry]) => (
    entry.manifest.profileId === 'battle_royal_large'
  ));
  while (battleRoyalEntries.length > MAX_PREPARED_BATTLE_ROYAL_MAPS) {
    let oldestIndex = 0;
    let oldestUsedAt = battleRoyalEntries[0]?.[1].lastUsedAtMs ?? Infinity;
    for (let index = 1; index < battleRoyalEntries.length; index++) {
      const [, entry] = battleRoyalEntries[index];
      if (entry.lastUsedAtMs < oldestUsedAt) {
        oldestIndex = index;
        oldestUsedAt = entry.lastUsedAtMs;
      }
    }
    const removed = battleRoyalEntries.splice(oldestIndex, 1)[0];
    if (!removed) break;
    preparedMapCache.delete(removed[0]);
  }

  if (preparedMapCache.size <= MAX_PREPARED_MAPS) return;

  let oldestKey: string | null = null;
  let oldestUsedAt = Infinity;

  for (const [key, entry] of preparedMapCache) {
    if (entry.lastUsedAtMs < oldestUsedAt) {
      oldestUsedAt = entry.lastUsedAtMs;
      oldestKey = key;
    }
  }

  if (oldestKey) {
    preparedMapCache.delete(oldestKey);
  }
}

export function prepareVoxelMapCpu(options: PrepareVoxelMapOptions): PreparedVoxelMap {
  const generatorVersion = options.generatorVersion ?? CONSTRUCTED_MAP_MANIFEST_VERSION;
  const key = getMapPrepCacheKey({
    seed: options.seed,
    themeId: options.themeId ?? options.manifest?.themeId ?? null,
    mapSize: options.mapSize ?? options.manifest?.mapSize ?? DEFAULT_VOXEL_MAP_SIZE_ID,
    mapProfileId: options.mapProfileId ?? options.manifest?.profileId ?? null,
    generatorVersion,
  });
  const cached = preparedMapCache.get(key);

  if (cached) {
    cached.lastUsedAtMs = nowMs();
    cached.cacheHits++;
    return cached;
  }

  const source = options.source ?? 'match';
  const mapSize = normalizeVoxelMapSizeId(options.mapSize ?? options.manifest?.mapSize ?? DEFAULT_VOXEL_MAP_SIZE_ID);
  const mapProfileId = options.mapProfileId ?? options.manifest?.profileId ?? null;
  const manifest = options.manifest ?? generateProceduralVoxelMap(options.seed, {
    themeId: options.themeId,
    mapSize,
    profileId: mapProfileId,
  });

  const renderableChunks = manifest.chunks.filter((chunk) => chunk.solidBlockCount > 0);
  const renderableRegions = createVoxelChunkRegions(renderableChunks, manifest);

  const entry: PreparedVoxelMap = {
    key,
    seed: options.seed >>> 0,
    generatorVersion,
    manifest,
    renderableRegions,
    renderableChunkCount: renderableChunks.length,
    generatedAtMs: nowMs(),
    lastUsedAtMs: nowMs(),
    source,
    cacheHits: 0,
  };

  preparedMapCache.set(key, entry);
  evictLeastRecentlyUsedPreparedMap();
  return entry;
}

export function seedMapPrepCacheFromManifest(
  seed: number,
  manifest: VoxelMapManifest,
  source: NonNullable<PrepareVoxelMapOptions['source']> = 'mapVotePreview'
): PreparedVoxelMap {
  return prepareVoxelMapCpu({ seed, manifest, source });
}

export function getPreparedVoxelMap(options: MapPrepCacheKeyInput): PreparedVoxelMap | null {
  const key = getMapPrepCacheKey(options);
  const entry = preparedMapCache.get(key) ?? null;
  if (entry) {
    entry.lastUsedAtMs = nowMs();
    entry.cacheHits++;
  }
  return entry;
}

export function clearPreparedVoxelMapCache(): void {
  preparedMapCache.clear();
}
