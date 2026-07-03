import type { MapProfileId, VoxelMapSizeId, VoxelMapTheme } from '@voxel-strike/shared';
import { seedMapPrepCacheFromManifest } from './mapWarmup/mapPrepCache';
import { getMapPrepCacheKey } from './mapWarmup/mapPrepCacheKey';
import { prebuildPreparedMapGeometryDeferred } from './mapWarmup/deferredMapGeometryWarmup';
import { requestMatchMapManifest } from './mapWarmup/mapManifestLoader';

const STREAMER_MAP_PRELOAD_TIMEOUT_MS = 2_600;

export interface StreamerMapTransitionTarget {
  mapSeed: number | null;
  mapThemeId?: VoxelMapTheme['id'] | string | null;
  mapSize?: VoxelMapSizeId | string | null;
  mapProfileId?: MapProfileId | string | null;
  pregeneratedMapId?: string | null;
}

function withPreloadTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} preload timed out after ${STREAMER_MAP_PRELOAD_TIMEOUT_MS}ms`));
    }, STREAMER_MAP_PRELOAD_TIMEOUT_MS);
  });

  return Promise.race([
    promise.finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }),
    timeoutPromise,
  ]);
}

export function getStreamerMapTransitionKey(target: StreamerMapTransitionTarget): string {
  if (typeof target.mapSeed !== 'number') return 'streamer:unknown-map';

  return getMapPrepCacheKey({
    seed: target.mapSeed,
    themeId: (target.mapThemeId ?? null) as VoxelMapTheme['id'] | null,
    mapSize: target.mapSize ?? null,
    mapProfileId: target.mapProfileId ?? null,
    pregeneratedMapId: target.pregeneratedMapId ?? null,
  });
}

export async function preloadStreamerMapTransitionTarget(
  target: StreamerMapTransitionTarget,
  label: string
): Promise<void> {
  if (typeof target.mapSeed !== 'number') return;

  const { manifest } = await withPreloadTimeout(
    requestMatchMapManifest({
      seed: target.mapSeed,
      themeId: (target.mapThemeId ?? null) as VoxelMapTheme['id'] | null,
      mapSize: (target.mapSize ?? null) as VoxelMapSizeId | null,
      mapProfileId: target.mapProfileId ?? null,
      pregeneratedMapId: target.pregeneratedMapId ?? null,
    }),
    label
  );
  const preparedMap = seedMapPrepCacheFromManifest(target.mapSeed, manifest, 'match', target.pregeneratedMapId);
  prebuildPreparedMapGeometryDeferred(preparedMap, { frameBudgetMs: 2, label });
}
