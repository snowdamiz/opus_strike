import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  generateProceduralVoxelMap,
  type VoxelChunk,
  type VoxelMapManifest,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

const VOXEL_REGION_CHUNK_SPAN = 4;
const MAX_PREPARED_MAPS = 4;

export interface VoxelChunkRegion {
  id: string;
  chunks: VoxelChunk[];
  castShadow: boolean;
}

export interface MapPrepCacheKeyInput {
  seed: number;
  themeId?: VoxelMapTheme['id'] | null;
  generatorVersion?: number;
}

export interface PrepareVoxelMapOptions extends MapPrepCacheKeyInput {
  manifest?: VoxelMapManifest;
  source?: 'match' | 'mapVotePreview' | 'mapVoteFinalized' | 'test';
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

export function getMapPrepCacheKey({
  seed,
  themeId,
  generatorVersion = CONSTRUCTED_MAP_MANIFEST_VERSION,
}: MapPrepCacheKeyInput): string {
  const themeSuffix = themeId ? `:${themeId}` : '';
  return `procedural-v${generatorVersion}:${seed >>> 0}${themeSuffix}`;
}

export function createVoxelChunkRegions(chunks: VoxelChunk[]): VoxelChunkRegion[] {
  const regions = new Map<string, VoxelChunkRegion>();

  for (const chunk of chunks) {
    const regionX = Math.floor(chunk.coord.x / VOXEL_REGION_CHUNK_SPAN);
    const regionZ = Math.floor(chunk.coord.z / VOXEL_REGION_CHUNK_SPAN);
    const id = `${regionX}:${chunk.coord.y}:${regionZ}`;
    let region = regions.get(id);

    if (!region) {
      region = { id, chunks: [], castShadow: chunk.coord.y > 0 };
      regions.set(id, region);
    }

    region.chunks.push(chunk);
    region.castShadow ||= chunk.coord.y > 0;
  }

  return Array.from(regions.values());
}

function evictLeastRecentlyUsedPreparedMap(): void {
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
    generatorVersion,
  });
  const cached = preparedMapCache.get(key);

  if (cached) {
    cached.lastUsedAtMs = nowMs();
    cached.cacheHits++;
    return cached;
  }

  const source = options.source ?? 'match';
  const manifest = options.manifest ?? generateProceduralVoxelMap(options.seed, { themeId: options.themeId });

  const renderableChunks = manifest.chunks.filter((chunk) => chunk.solidBlockCount > 0);
  const renderableRegions = createVoxelChunkRegions(renderableChunks);

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
