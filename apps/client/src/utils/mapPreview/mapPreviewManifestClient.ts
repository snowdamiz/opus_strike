import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  DEFAULT_VOXEL_MAP_SIZE_ID,
  generateProceduralVoxelMap,
  isTutorialMapSeed,
  normalizeVoxelMapSizeId,
  TUTORIAL_MAP_SEED,
  type MapProfileId,
  type VoxelMapManifest,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

export interface MapPreviewManifestRequest {
  seed: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | string | null;
  generatorVersion?: number;
}

type PreviewManifestWorkerRequest = {
  type: 'generate';
  requestId: number;
  seed: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | string | null;
};

type PreviewManifestWorkerResponse =
  | {
      type: 'generated';
      requestId: number;
      manifest: VoxelMapManifest;
      generationMs: number;
    }
  | {
      type: 'error';
      requestId: number;
      message: string;
    };

interface PendingPreviewManifestRequest {
  key: string;
  resolve: (manifest: VoxelMapManifest) => void;
  reject: (error: Error) => void;
}

const manifestCache = new Map<string, VoxelMapManifest>();
const pendingManifestPromises = new Map<string, Promise<VoxelMapManifest>>();
const pendingManifestRequests = new Map<number, PendingPreviewManifestRequest>();

let previewManifestWorker: Worker | null = null;
let nextPreviewManifestRequestId = 1;

export function getMapPreviewManifestCacheKey({
  seed,
  themeId,
  mapSize,
  mapProfileId,
  generatorVersion = CONSTRUCTED_MAP_MANIFEST_VERSION,
}: MapPreviewManifestRequest): string {
  if (isTutorialMapSeed(seed)) {
    return `tutorial-v${generatorVersion}:${TUTORIAL_MAP_SEED}`;
  }

  const themeSuffix = themeId ? `:${themeId}` : '';
  const profileSuffix = mapProfileId ? `:${mapProfileId}` : '';
  const normalizedMapSize = normalizeVoxelMapSizeId(mapSize);
  const sizeSuffix = normalizedMapSize === DEFAULT_VOXEL_MAP_SIZE_ID ? '' : `:${normalizedMapSize}`;
  return `procedural-v${generatorVersion}:${seed >>> 0}${themeSuffix}${profileSuffix}${sizeSuffix}`;
}

function rejectPendingWorkerRequests(error: Error): void {
  for (const [requestId, pending] of pendingManifestRequests) {
    pending.reject(error);
    pendingManifestPromises.delete(pending.key);
    pendingManifestRequests.delete(requestId);
  }
}

function resetPreviewManifestWorker(error?: Error): void {
  if (error) {
    rejectPendingWorkerRequests(error);
  }

  previewManifestWorker?.terminate();
  previewManifestWorker = null;
}

function getPreviewManifestWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (previewManifestWorker) return previewManifestWorker;

  try {
    previewManifestWorker = new Worker(new URL('./mapPreviewManifest.worker.ts', import.meta.url), { type: 'module' });
    previewManifestWorker.onmessage = (event: MessageEvent<PreviewManifestWorkerResponse>) => {
      const message = event.data;
      const pending = pendingManifestRequests.get(message.requestId);
      if (!pending) return;

      pendingManifestRequests.delete(message.requestId);
      pendingManifestPromises.delete(pending.key);

      if (message.type === 'error') {
        pending.reject(new Error(message.message));
        return;
      }

      manifestCache.set(pending.key, message.manifest);
      pending.resolve(message.manifest);
    };
    previewManifestWorker.onerror = (event) => {
      resetPreviewManifestWorker(new Error(event.message || 'Map preview manifest worker failed'));
    };
  } catch {
    previewManifestWorker = null;
  }

  return previewManifestWorker;
}

function generatePreviewManifestOnMainThread(input: MapPreviewManifestRequest): Promise<VoxelMapManifest> {
  return new Promise((resolve) => {
    const schedule = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
    schedule(() => {
      resolve(generateProceduralVoxelMap(input.seed, {
        themeId: input.themeId,
        mapSize: input.mapSize,
        profileId: input.mapProfileId,
      }));
    }, 0);
  });
}

export function requestMapPreviewManifest(input: MapPreviewManifestRequest): Promise<VoxelMapManifest> {
  const key = getMapPreviewManifestCacheKey(input);
  const cached = manifestCache.get(key);
  if (cached) return Promise.resolve(cached);

  const pending = pendingManifestPromises.get(key);
  if (pending) return pending;

  const worker = getPreviewManifestWorker();
  const promise = worker
    ? new Promise<VoxelMapManifest>((resolve, reject) => {
        const requestId = nextPreviewManifestRequestId++;
        pendingManifestRequests.set(requestId, { key, resolve, reject });
        const message: PreviewManifestWorkerRequest = {
          type: 'generate',
          requestId,
          seed: input.seed >>> 0,
          themeId: input.themeId,
          mapSize: input.mapSize,
          mapProfileId: input.mapProfileId,
        };
        try {
          worker.postMessage(message);
        } catch (error) {
          pendingManifestRequests.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      })
    : generatePreviewManifestOnMainThread(input).then((manifest) => {
        manifestCache.set(key, manifest);
        return manifest;
      });

  pendingManifestPromises.set(key, promise);
  promise.catch(() => {
    pendingManifestPromises.delete(key);
  });
  return promise;
}

export function getCachedMapPreviewManifest(input: MapPreviewManifestRequest): VoxelMapManifest | null {
  return manifestCache.get(getMapPreviewManifestCacheKey(input)) ?? null;
}

export function clearMapPreviewManifestCache(): void {
  manifestCache.clear();
  pendingManifestPromises.clear();
  resetPreviewManifestWorker(new Error('Map preview manifest cache was cleared'));
}
