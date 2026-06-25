import * as THREE from 'three';
import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import {
  buildVoxelRegionGeometryData,
  transformVoxelMeshGeometryDataToWorld,
  type VoxelRegionGeometryDetail,
  type VoxelMeshGeometryData,
} from './meshGeometryData';
import {
  recordTerrainGeometryBuild,
  recordTerrainGeometryFinalization,
} from '../../../movement/networkDiagnostics';

interface PendingRegionRequest {
  resolve: (geometry: THREE.BufferGeometry) => void;
  reject: (error: Error) => void;
  manifest: VoxelMapManifest;
  cacheKey: string;
}

interface FallbackRegionRequest extends PendingRegionRequest {
  regionId: string;
  detail: VoxelRegionGeometryDetail;
  chunks: VoxelChunk[];
  trackedPromise?: Promise<THREE.BufferGeometry>;
  cancelled: boolean;
}

interface CachedVoxelGeometry {
  geometry: THREE.BufferGeometry;
  manifestId: string;
  bytes: number;
  lastUsedAt: number;
  retainCount: number;
}

interface MeshWorkerResponse {
  type: 'ready' | 'regionBuilt' | 'error';
  requestId?: number;
  manifestId?: string;
  regionId?: string;
  detail?: VoxelRegionGeometryDetail;
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  textureLayers?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  boundingSphere?: VoxelMeshGeometryData['boundingSphere'];
  buildMs?: number;
  message?: string;
}

interface WorkerRegionFinalizationRequest {
  requestId: number;
  pending: PendingRegionRequest;
  data: VoxelMeshGeometryData;
}

const geometryCache = new Map<string, CachedVoxelGeometry>();
const pendingRegionRequests = new Map<number, PendingRegionRequest>();
const pendingRegionGeometryByCacheKey = new Map<string, Promise<THREE.BufferGeometry>>();
const VOXEL_MESH_REQUEST_CANCELLED = 'Voxel mesh request cancelled because manifest cache was cleared';
const VOXEL_GEOMETRY_CACHE_MAX_ENTRIES = 1536;
const VOXEL_GEOMETRY_CACHE_MAX_BYTES = 128 * 1024 * 1024;
const PREBUILD_MAX_PENDING_REGION_REQUESTS = 8;
const PREBUILD_MAX_PENDING_FINALIZATIONS = 16;
const FALLBACK_REGION_FRAME_BUDGET_MS = 4;
const FALLBACK_REGION_MAX_BUILDS_PER_FRAME = 1;
const FALLBACK_REGION_QUEUE_COMPACT_THRESHOLD = 64;
const WORKER_REGION_FINALIZATION_FRAME_BUDGET_MS = 4;
const WORKER_REGION_FINALIZATION_MAX_PER_FRAME = 1;
const WORKER_REGION_FINALIZATION_QUEUE_COMPACT_THRESHOLD = 64;
let meshWorker: Worker | null = null;
let workerManifestId: string | null = null;
let nextWorkerRequestId = 1;
let geometryCacheBytes = 0;
const fallbackRegionQueue: FallbackRegionRequest[] = [];
let fallbackRegionQueueHead = 0;
let fallbackRegionQueueScheduled = false;
const workerRegionFinalizationQueue: WorkerRegionFinalizationRequest[] = [];
let workerRegionFinalizationQueueHead = 0;
let workerRegionFinalizationQueueScheduled = false;

function shouldSendChunkCoordsToWorker(regionId: string): boolean {
  return regionId.startsWith('macro:');
}

function matchesVoxelGeometryBuild(
  cacheKeyToCheck: string,
  manifestId?: string,
  cacheKey?: string
): boolean {
  if (cacheKey) return cacheKeyToCheck === cacheKey;
  if (manifestId) return cacheKeyToCheck.startsWith(`${manifestId}:`);
  return true;
}

export function isVoxelMeshRequestCancelledError(error: unknown): boolean {
  return error instanceof Error && error.message === VOXEL_MESH_REQUEST_CANCELLED;
}

function waitForNextFrame(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();

  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function scheduleFallbackRegionQueue(): void {
  if (fallbackRegionQueueScheduled || typeof window === 'undefined') return;
  fallbackRegionQueueScheduled = true;
  window.requestAnimationFrame(processFallbackRegionQueue);
}

function processFallbackRegionQueue(): void {
  fallbackRegionQueueScheduled = false;
  const frameStart = performance.now();
  let buildsThisFrame = 0;

  while (fallbackRegionQueueHead < fallbackRegionQueue.length) {
    if (
      buildsThisFrame >= FALLBACK_REGION_MAX_BUILDS_PER_FRAME ||
      performance.now() - frameStart >= FALLBACK_REGION_FRAME_BUDGET_MS
    ) {
      compactFallbackRegionQueue();
      scheduleFallbackRegionQueue();
      return;
    }

    const request = fallbackRegionQueue[fallbackRegionQueueHead++];
    if (!request || request.cancelled) continue;
    if (pendingRegionGeometryByCacheKey.get(request.cacheKey) !== request.trackedPromise) {
      request.cancelled = true;
      request.reject(new Error(VOXEL_MESH_REQUEST_CANCELLED));
      continue;
    }

    buildsThisFrame++;
    try {
      request.resolve(buildVoxelRegionGeometry(request.manifest, request.regionId, request.chunks, request.detail));
    } catch (error) {
      request.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  fallbackRegionQueue.length = 0;
  fallbackRegionQueueHead = 0;
}

function compactFallbackRegionQueue(force = false): void {
  if (fallbackRegionQueueHead === 0) return;
  if (
    !force &&
    fallbackRegionQueueHead < FALLBACK_REGION_QUEUE_COMPACT_THRESHOLD &&
    fallbackRegionQueueHead * 2 < fallbackRegionQueue.length
  ) {
    return;
  }

  fallbackRegionQueue.splice(0, fallbackRegionQueueHead);
  fallbackRegionQueueHead = 0;
}

function queueFallbackVoxelRegionGeometry(
  manifest: VoxelMapManifest,
  regionId: string,
  detail: VoxelRegionGeometryDetail,
  chunks: VoxelChunk[],
  cacheKey: string
): Promise<THREE.BufferGeometry> {
  if (typeof window === 'undefined') {
    return Promise.resolve(buildVoxelRegionGeometry(manifest, regionId, chunks, detail));
  }

  const request: FallbackRegionRequest = {
    resolve: () => undefined,
    reject: () => undefined,
    manifest,
    cacheKey,
    regionId,
    detail,
    chunks,
    cancelled: false,
  };

  const fallbackPromise = new Promise<THREE.BufferGeometry>((resolve, reject) => {
    request.resolve = resolve;
    request.reject = reject;
  });
  const trackedPromise = fallbackPromise.finally(() => {
    request.cancelled = true;
    pendingRegionGeometryByCacheKey.delete(cacheKey);
  });
  request.trackedPromise = trackedPromise;
  pendingRegionGeometryByCacheKey.set(cacheKey, trackedPromise);
  fallbackRegionQueue.push(request);
  scheduleFallbackRegionQueue();
  return trackedPromise;
}

function cancelQueuedFallbackRequests(manifestId?: string, cacheKey?: string): void {
  for (let index = fallbackRegionQueue.length - 1; index >= fallbackRegionQueueHead; index--) {
    const request = fallbackRegionQueue[index];
    if (!matchesVoxelGeometryBuild(request.cacheKey, manifestId, cacheKey)) {
      continue;
    }

    request.cancelled = true;
    request.reject(new Error(VOXEL_MESH_REQUEST_CANCELLED));
    fallbackRegionQueue.splice(index, 1);
  }

  if (fallbackRegionQueueHead >= fallbackRegionQueue.length) {
    fallbackRegionQueue.length = 0;
    fallbackRegionQueueHead = 0;
  } else {
    compactFallbackRegionQueue(true);
  }
}

function scheduleWorkerRegionFinalizationQueue(): void {
  if (workerRegionFinalizationQueueScheduled) return;
  workerRegionFinalizationQueueScheduled = true;

  if (typeof window === 'undefined') {
    processWorkerRegionFinalizationQueue();
    return;
  }

  window.requestAnimationFrame(processWorkerRegionFinalizationQueue);
}

function processWorkerRegionFinalizationQueue(): void {
  workerRegionFinalizationQueueScheduled = false;
  const frameStart = performance.now();
  let finalizationsThisFrame = 0;
  const shouldRespectFrameBudget = typeof window !== 'undefined';

  while (workerRegionFinalizationQueueHead < workerRegionFinalizationQueue.length) {
    if (
      shouldRespectFrameBudget &&
      (finalizationsThisFrame >= WORKER_REGION_FINALIZATION_MAX_PER_FRAME ||
        performance.now() - frameStart >= WORKER_REGION_FINALIZATION_FRAME_BUDGET_MS)
    ) {
      compactWorkerRegionFinalizationQueue();
      scheduleWorkerRegionFinalizationQueue();
      return;
    }

    const request = workerRegionFinalizationQueue[workerRegionFinalizationQueueHead++];
    if (!request || pendingRegionRequests.get(request.requestId) !== request.pending) continue;

    pendingRegionRequests.delete(request.requestId);
    finalizationsThisFrame++;

    try {
      request.pending.resolve(createGeometryFromData(
        request.pending.manifest,
        request.pending.cacheKey,
        request.data
      ));
    } catch (error) {
      request.pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  workerRegionFinalizationQueue.length = 0;
  workerRegionFinalizationQueueHead = 0;
}

function compactWorkerRegionFinalizationQueue(force = false): void {
  if (workerRegionFinalizationQueueHead === 0) return;
  if (
    !force &&
    workerRegionFinalizationQueueHead < WORKER_REGION_FINALIZATION_QUEUE_COMPACT_THRESHOLD &&
    workerRegionFinalizationQueueHead * 2 < workerRegionFinalizationQueue.length
  ) {
    return;
  }

  workerRegionFinalizationQueue.splice(0, workerRegionFinalizationQueueHead);
  workerRegionFinalizationQueueHead = 0;
}

function discardQueuedWorkerRegionFinalizations(manifestId?: string, cacheKey?: string): void {
  for (let index = workerRegionFinalizationQueue.length - 1; index >= workerRegionFinalizationQueueHead; index--) {
    const request = workerRegionFinalizationQueue[index];
    if (!matchesVoxelGeometryBuild(request.pending.cacheKey, manifestId, cacheKey)) {
      continue;
    }

    workerRegionFinalizationQueue.splice(index, 1);
  }

  if (workerRegionFinalizationQueueHead >= workerRegionFinalizationQueue.length) {
    workerRegionFinalizationQueue.length = 0;
    workerRegionFinalizationQueueHead = 0;
  } else {
    compactWorkerRegionFinalizationQueue(true);
  }
}

function rejectPendingRegionRequests(manifestId?: string, cacheKey?: string): void {
  for (const [requestId, pending] of pendingRegionRequests) {
    if (!matchesVoxelGeometryBuild(pending.cacheKey, manifestId, cacheKey)) {
      continue;
    }

    pending.reject(new Error(VOXEL_MESH_REQUEST_CANCELLED));
    pendingRegionRequests.delete(requestId);
  }
}

function cancelPendingVoxelGeometryBuilds(manifestId?: string, cacheKey?: string): void {
  for (const pendingCacheKey of Array.from(pendingRegionGeometryByCacheKey.keys())) {
    if (matchesVoxelGeometryBuild(pendingCacheKey, manifestId, cacheKey)) {
      pendingRegionGeometryByCacheKey.delete(pendingCacheKey);
    }
  }

  cancelQueuedFallbackRequests(manifestId, cacheKey);
  discardQueuedWorkerRegionFinalizations(manifestId, cacheKey);
  rejectPendingRegionRequests(manifestId, cacheKey);
}

export function cancelVoxelRegionGeometryBuild(cacheKey: string): void {
  cancelPendingVoxelGeometryBuilds(undefined, cacheKey);
}

export function cancelVoxelGeometryBuilds(manifestId: string): void {
  cancelPendingVoxelGeometryBuilds(manifestId);
}

function createGeometryFromData(
  manifest: VoxelMapManifest,
  cacheKey: string,
  data: VoxelMeshGeometryData
): THREE.BufferGeometry {
  const cached = geometryCache.get(cacheKey);
  if (cached) {
    cached.lastUsedAt = performance.now();
    return cached.geometry;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('voxelTextureLayer', new THREE.BufferAttribute(data.textureLayers, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  if (data.boundingSphere) {
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(
        data.boundingSphere.center.x,
        data.boundingSphere.center.y,
        data.boundingSphere.center.z
      ),
      data.boundingSphere.radius
    );
  } else {
    geometry.computeBoundingSphere();
  }

  const bytes = estimateGeometryBytes(geometry);
  geometryCache.set(cacheKey, {
    geometry,
    manifestId: manifest.id,
    bytes,
    lastUsedAt: performance.now(),
    retainCount: 0,
  });
  geometryCacheBytes += bytes;
  enforceVoxelGeometryCacheBudget(manifest.id);
  recordTerrainGeometryFinalization();
  return geometry;
}

function estimateGeometryBytes(geometry: THREE.BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array.byteLength;
  }
  if (geometry.index) {
    bytes += geometry.index.array.byteLength;
  }
  return bytes;
}

function evictCachedGeometry(cacheKey: string, entry: CachedVoxelGeometry): void {
  entry.geometry.dispose();
  geometryCache.delete(cacheKey);
  geometryCacheBytes = Math.max(0, geometryCacheBytes - entry.bytes);
}

function enforceVoxelGeometryCacheBudget(_activeManifestId: string): void {
  if (
    geometryCache.size <= VOXEL_GEOMETRY_CACHE_MAX_ENTRIES &&
    geometryCacheBytes <= VOXEL_GEOMETRY_CACHE_MAX_BYTES
  ) {
    return;
  }

  while (
    geometryCache.size > VOXEL_GEOMETRY_CACHE_MAX_ENTRIES ||
    geometryCacheBytes > VOXEL_GEOMETRY_CACHE_MAX_BYTES
  ) {
    let oldestCacheKey: string | null = null;
    let oldestEntry: CachedVoxelGeometry | null = null;

    for (const [cacheKey, entry] of geometryCache) {
      if (entry.retainCount > 0) continue;
      if (!oldestEntry || entry.lastUsedAt < oldestEntry.lastUsedAt) {
        oldestCacheKey = cacheKey;
        oldestEntry = entry;
      }
    }

    if (!oldestCacheKey || !oldestEntry) return;
    evictCachedGeometry(oldestCacheKey, oldestEntry);
  }
}

function getMeshWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (meshWorker) return meshWorker;

  try {
    meshWorker = new Worker(new URL('./meshBuild.worker.ts', import.meta.url), { type: 'module' });
    meshWorker.onmessage = (event: MessageEvent<MeshWorkerResponse>) => {
      const message = event.data;
      if (message.type === 'ready') {
        workerManifestId = message.manifestId ?? null;
        return;
      }

      if (message.type === 'error') {
        if (message.requestId !== undefined) {
          const pending = pendingRegionRequests.get(message.requestId);
          if (pending) {
            pendingRegionRequests.delete(message.requestId);
            pending.reject(new Error(message.message ?? 'Voxel mesh worker failed'));
          }
        }
        return;
      }

      if (message.type !== 'regionBuilt' || message.requestId === undefined) return;
      const pending = pendingRegionRequests.get(message.requestId);
      if (!pending) return;

      if (!message.positions || !message.normals || !message.uvs || !message.textureLayers || !message.indices) {
        pendingRegionRequests.delete(message.requestId);
        pending.reject(new Error('Voxel mesh worker returned incomplete geometry data'));
        return;
      }

      workerRegionFinalizationQueue.push({
        requestId: message.requestId,
        pending,
        data: {
          positions: message.positions,
          normals: message.normals,
          uvs: message.uvs,
          textureLayers: message.textureLayers,
          indices: message.indices,
          boundingSphere: message.boundingSphere,
        },
      });
      recordTerrainGeometryBuild();
      scheduleWorkerRegionFinalizationQueue();
    };
    meshWorker.onerror = (event) => {
      const error = new Error(event.message || 'Voxel mesh worker error');
      for (const [requestId, pending] of pendingRegionRequests) {
        pending.reject(error);
        pendingRegionRequests.delete(requestId);
      }
      discardQueuedWorkerRegionFinalizations();
      meshWorker?.terminate();
      meshWorker = null;
      workerManifestId = null;
    };
  } catch {
    meshWorker = null;
  }

  return meshWorker;
}

function initializeWorkerManifest(worker: Worker, manifest: VoxelMapManifest): void {
  if (workerManifestId === manifest.id) return;
  workerManifestId = manifest.id;
  worker.postMessage({
    type: 'init',
    manifest,
  });
}

export function getCachedVoxelGeometry(cacheKey: string): THREE.BufferGeometry | null {
  const cached = geometryCache.get(cacheKey);
  if (!cached) return null;
  cached.lastUsedAt = performance.now();
  return cached.geometry;
}

export function retainVoxelGeometryCacheKey(cacheKey: string): void {
  const cached = geometryCache.get(cacheKey);
  if (!cached) return;
  cached.retainCount++;
  cached.lastUsedAt = performance.now();
}

export function releaseVoxelGeometryCacheKey(cacheKey: string): void {
  const cached = geometryCache.get(cacheKey);
  if (!cached) return;
  cached.retainCount = Math.max(0, cached.retainCount - 1);
  cached.lastUsedAt = performance.now();
  enforceVoxelGeometryCacheBudget(cached.manifestId);
}

export function getVoxelRegionGeometryCacheKey(
  manifest: VoxelMapManifest,
  regionId: string,
  detail: VoxelRegionGeometryDetail = 'full'
): string {
  return `${manifest.id}:region:${detail}:${regionId}`;
}

export function buildVoxelRegionGeometry(
  manifest: VoxelMapManifest,
  regionId: string,
  chunks: VoxelChunk[],
  detail: VoxelRegionGeometryDetail = 'full'
): THREE.BufferGeometry {
  const cacheKey = getVoxelRegionGeometryCacheKey(manifest, regionId, detail);
  const cached = geometryCache.get(cacheKey);
  if (cached) {
    cached.lastUsedAt = performance.now();
    return cached.geometry;
  }

  const data = transformVoxelMeshGeometryDataToWorld(
    manifest,
    buildVoxelRegionGeometryData(manifest, chunks, detail)
  );
  recordTerrainGeometryBuild();
  return createGeometryFromData(manifest, cacheKey, data);
}

export function buildVoxelRegionGeometryAsync(
  manifest: VoxelMapManifest,
  regionId: string,
  chunks: VoxelChunk[],
  detail: VoxelRegionGeometryDetail = 'full'
): Promise<THREE.BufferGeometry> {
  const cacheKey = getVoxelRegionGeometryCacheKey(manifest, regionId, detail);
  const cached = geometryCache.get(cacheKey);
  if (cached) {
    cached.lastUsedAt = performance.now();
    return Promise.resolve(cached.geometry);
  }

  const pending = pendingRegionGeometryByCacheKey.get(cacheKey);
  if (pending) return pending;

  const worker = getMeshWorker();
  if (!worker) {
    return queueFallbackVoxelRegionGeometry(manifest, regionId, detail, chunks, cacheKey);
  }

  initializeWorkerManifest(worker, manifest);
  const requestId = nextWorkerRequestId++;
  const promise = new Promise<THREE.BufferGeometry>((resolve, reject) => {
    pendingRegionRequests.set(requestId, {
      resolve,
      reject,
      manifest,
      cacheKey,
    });
  });

  const chunkCoords = shouldSendChunkCoordsToWorker(regionId)
    ? chunks.map((chunk) => chunk.coord)
    : undefined;

  worker.postMessage({
    type: 'buildRegion',
    requestId,
    manifestId: manifest.id,
    regionId,
    detail,
    ...(chunkCoords ? { chunkCoords } : {}),
  });

  const resolvedPromise = promise
    .catch((error) => {
      if (error instanceof Error && error.message === VOXEL_MESH_REQUEST_CANCELLED) {
        throw error;
      }
      return queueFallbackVoxelRegionGeometry(manifest, regionId, detail, chunks, cacheKey);
    })
    .finally(() => {
      pendingRegionGeometryByCacheKey.delete(cacheKey);
    });
  pendingRegionGeometryByCacheKey.set(cacheKey, resolvedPromise);
  return resolvedPromise;
}

export async function prebuildVoxelRegionGeometries(
  manifest: VoxelMapManifest,
  regions: Array<{ id: string; chunks: VoxelChunk[] }>,
  options: {
    frameBudgetMs?: number;
    detail?: VoxelRegionGeometryDetail;
    signal?: AbortSignal;
    maxPendingRequests?: number;
    maxPendingFinalizations?: number;
    onDispatched?: (count: number) => void;
  } = {}
): Promise<void> {
  const frameBudgetMs = options.frameBudgetMs ?? 4;
  const detail = options.detail ?? 'full';
  const maxPendingRequests = options.maxPendingRequests ?? PREBUILD_MAX_PENDING_REGION_REQUESTS;
  const maxPendingFinalizations = options.maxPendingFinalizations ?? PREBUILD_MAX_PENDING_FINALIZATIONS;
  let frameStart = performance.now();
  let dispatched = 0;

  for (const region of regions) {
    if (options.signal?.aborted) return;
    while (
      pendingRegionGeometryByCacheKey.size >= maxPendingRequests ||
      workerRegionFinalizationQueue.length - workerRegionFinalizationQueueHead >= maxPendingFinalizations
    ) {
      if (options.signal?.aborted) return;
      await waitForNextFrame();
      frameStart = performance.now();
    }

    if (!getCachedVoxelGeometry(getVoxelRegionGeometryCacheKey(manifest, region.id, detail))) {
      void buildVoxelRegionGeometryAsync(manifest, region.id, region.chunks, detail).catch((error) => {
        if (!isVoxelMeshRequestCancelledError(error) && !options.signal?.aborted) {
          console.warn('[VoxelMap] Failed to prebuild region mesh', region.id, detail, error);
        }
      });
      dispatched++;
      options.onDispatched?.(dispatched);
    }

    if (performance.now() - frameStart >= frameBudgetMs) {
      await waitForNextFrame();
      if (options.signal?.aborted) return;
      frameStart = performance.now();
    }
  }
}

export function clearVoxelGeometryCache(manifestId?: string): void {
  if (!manifestId) {
    for (const entry of geometryCache.values()) {
      entry.geometry.dispose();
    }
    geometryCache.clear();
    geometryCacheBytes = 0;
    rejectPendingRegionRequests();
    discardQueuedWorkerRegionFinalizations();
    pendingRegionGeometryByCacheKey.clear();
    cancelQueuedFallbackRequests();
    meshWorker?.terminate();
    meshWorker = null;
    workerManifestId = null;
    return;
  }

  for (const [key, entry] of geometryCache) {
    if (entry.manifestId === manifestId || key.startsWith(`${manifestId}:`)) {
      evictCachedGeometry(key, entry);
    }
  }

  cancelPendingVoxelGeometryBuilds(manifestId);

  if (workerManifestId === manifestId) {
    meshWorker?.terminate();
    meshWorker = null;
    workerManifestId = null;
  }
}

export function getVoxelGeometryCacheStats(): {
  entries: number;
  bytes: number;
  pendingRegionRequests: number;
  pendingRegionBuilds: number;
  pendingRegionFinalizations: number;
} {
  return {
    entries: geometryCache.size,
    bytes: geometryCacheBytes,
    pendingRegionRequests: pendingRegionRequests.size,
    pendingRegionBuilds: pendingRegionGeometryByCacheKey.size,
    pendingRegionFinalizations: workerRegionFinalizationQueue.length - workerRegionFinalizationQueueHead,
  };
}
