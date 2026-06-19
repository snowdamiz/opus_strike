import * as THREE from 'three';
import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import {
  buildVoxelRegionGeometryData,
  type VoxelRegionGeometryDetail,
  type VoxelMeshGeometryData,
} from './meshGeometryData';

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
  buildMs?: number;
  message?: string;
}

const geometryCache = new Map<string, CachedVoxelGeometry>();
const pendingRegionRequests = new Map<number, PendingRegionRequest>();
const pendingRegionGeometryByCacheKey = new Map<string, Promise<THREE.BufferGeometry>>();
const VOXEL_MESH_REQUEST_CANCELLED = 'Voxel mesh request cancelled because manifest cache was cleared';
const VOXEL_GEOMETRY_CACHE_MAX_ENTRIES = 192;
const VOXEL_GEOMETRY_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const FALLBACK_REGION_FRAME_BUDGET_MS = 4;
const FALLBACK_REGION_MAX_BUILDS_PER_FRAME = 1;
const FALLBACK_REGION_QUEUE_COMPACT_THRESHOLD = 64;
let meshWorker: Worker | null = null;
let workerManifestId: string | null = null;
let nextWorkerRequestId = 1;
let geometryCacheBytes = 0;
const fallbackRegionQueue: FallbackRegionRequest[] = [];
let fallbackRegionQueueHead = 0;
let fallbackRegionQueueScheduled = false;

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

function cancelQueuedFallbackRequests(manifestId?: string): void {
  for (let index = fallbackRegionQueue.length - 1; index >= fallbackRegionQueueHead; index--) {
    const request = fallbackRegionQueue[index];
    if (manifestId && request.manifest.id !== manifestId && !request.cacheKey.startsWith(`${manifestId}:`)) {
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
  geometry.setAttribute('uv2', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('voxelTextureLayer', new THREE.BufferAttribute(data.textureLayers, 1));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.scale(manifest.voxelSize.x, manifest.voxelSize.y, manifest.voxelSize.z);
  geometry.translate(manifest.origin.x, manifest.origin.y, manifest.origin.z);
  geometry.computeBoundingSphere();

  const bytes = estimateGeometryBytes(geometry);
  geometryCache.set(cacheKey, {
    geometry,
    manifestId: manifest.id,
    bytes,
    lastUsedAt: performance.now(),
  });
  geometryCacheBytes += bytes;
  enforceVoxelGeometryCacheBudget(manifest.id);
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

function enforceVoxelGeometryCacheBudget(activeManifestId: string): void {
  if (
    geometryCache.size <= VOXEL_GEOMETRY_CACHE_MAX_ENTRIES &&
    geometryCacheBytes <= VOXEL_GEOMETRY_CACHE_MAX_BYTES
  ) {
    return;
  }

  const candidates = Array.from(geometryCache.entries())
    .filter(([, entry]) => entry.manifestId !== activeManifestId)
    .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

  for (const [cacheKey, entry] of candidates) {
    if (
      geometryCache.size <= VOXEL_GEOMETRY_CACHE_MAX_ENTRIES &&
      geometryCacheBytes <= VOXEL_GEOMETRY_CACHE_MAX_BYTES
    ) {
      break;
    }
    evictCachedGeometry(cacheKey, entry);
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
      pendingRegionRequests.delete(message.requestId);

      if (!message.positions || !message.normals || !message.uvs || !message.textureLayers || !message.indices) {
        pending.reject(new Error('Voxel mesh worker returned incomplete geometry data'));
        return;
      }

      const geometry = createGeometryFromData(
        pending.manifest,
        pending.cacheKey,
        {
          positions: message.positions,
          normals: message.normals,
          uvs: message.uvs,
          textureLayers: message.textureLayers,
          indices: message.indices,
        }
      );
      pending.resolve(geometry);
    };
    meshWorker.onerror = (event) => {
      const error = new Error(event.message || 'Voxel mesh worker error');
      for (const [requestId, pending] of pendingRegionRequests) {
        pending.reject(error);
        pendingRegionRequests.delete(requestId);
      }
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

  const data = buildVoxelRegionGeometryData(manifest, chunks, detail);
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

  worker.postMessage({
    type: 'buildRegion',
    requestId,
    manifestId: manifest.id,
    regionId,
    detail,
    chunkCoords: chunks.map((chunk) => chunk.coord),
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
    onDispatched?: (count: number) => void;
  } = {}
): Promise<void> {
  const frameBudgetMs = options.frameBudgetMs ?? 4;
  const detail = options.detail ?? 'full';
  let frameStart = performance.now();
  let dispatched = 0;

  for (const region of regions) {
    if (!getCachedVoxelGeometry(getVoxelRegionGeometryCacheKey(manifest, region.id, detail))) {
      void buildVoxelRegionGeometryAsync(manifest, region.id, region.chunks, detail);
      dispatched++;
      options.onDispatched?.(dispatched);
    }

    if (performance.now() - frameStart >= frameBudgetMs) {
      await waitForNextFrame();
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
    pendingRegionRequests.clear();
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

  for (const key of pendingRegionGeometryByCacheKey.keys()) {
    if (key.startsWith(`${manifestId}:`)) {
      pendingRegionGeometryByCacheKey.delete(key);
    }
  }

  cancelQueuedFallbackRequests(manifestId);

  for (const [requestId, pending] of pendingRegionRequests) {
    if (pending.manifest.id === manifestId) {
      pending.reject(new Error(VOXEL_MESH_REQUEST_CANCELLED));
      pendingRegionRequests.delete(requestId);
    }
  }

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
} {
  return {
    entries: geometryCache.size,
    bytes: geometryCacheBytes,
    pendingRegionRequests: pendingRegionRequests.size,
    pendingRegionBuilds: pendingRegionGeometryByCacheKey.size,
  };
}
