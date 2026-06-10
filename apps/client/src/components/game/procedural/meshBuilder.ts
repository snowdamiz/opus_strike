import * as THREE from 'three';
import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import {
  buildVoxelChunkGeometryData,
  buildVoxelRegionGeometryData,
  type VoxelMeshGeometryData,
} from './meshGeometryData';
import { recordSystemTime, recordVoxelMeshBuild } from '../../../utils/perfMarks';

type MeshMetricName = 'voxelMeshBuild' | 'voxelRegionMeshBuild' | 'voxelRegionMeshBuildWorker';

interface PendingRegionRequest {
  resolve: (geometry: THREE.BufferGeometry) => void;
  reject: (error: Error) => void;
  manifest: VoxelMapManifest;
  cacheKey: string;
  metricName: MeshMetricName;
}

interface MeshWorkerResponse {
  type: 'ready' | 'regionBuilt' | 'error';
  requestId?: number;
  manifestId?: string;
  regionId?: string;
  positions?: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  tileOrigins?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  buildMs?: number;
  message?: string;
}

const geometryCache = new Map<string, THREE.BufferGeometry>();
const pendingRegionRequests = new Map<number, PendingRegionRequest>();
let meshWorker: Worker | null = null;
let workerManifestId: string | null = null;
let nextWorkerRequestId = 1;

function createGeometryFromData(
  manifest: VoxelMapManifest,
  cacheKey: string,
  data: VoxelMeshGeometryData,
  metricName: MeshMetricName,
  buildMs: number
): THREE.BufferGeometry {
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('uv2', new THREE.BufferAttribute(data.uvs, 2));
  geometry.setAttribute('voxelTileOrigin', new THREE.BufferAttribute(data.tileOrigins, 2));
  geometry.setIndex(new THREE.BufferAttribute(data.indices, 1));
  geometry.scale(manifest.voxelSize.x, manifest.voxelSize.y, manifest.voxelSize.z);
  geometry.translate(manifest.origin.x, manifest.origin.y, manifest.origin.z);
  geometry.computeBoundingSphere();

  geometryCache.set(cacheKey, geometry);
  recordVoxelMeshBuild(buildMs);
  recordSystemTime(metricName, buildMs);
  return geometry;
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

      if (!message.positions || !message.normals || !message.uvs || !message.tileOrigins || !message.indices) {
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
          tileOrigins: message.tileOrigins,
          indices: message.indices,
        },
        pending.metricName,
        message.buildMs ?? 0
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
  return geometryCache.get(cacheKey) ?? null;
}

export function getVoxelChunkGeometryCacheKey(manifest: VoxelMapManifest, chunk: VoxelChunk): string {
  return `${manifest.id}:${chunk.coord.x}:${chunk.coord.y}:${chunk.coord.z}`;
}

export function getVoxelRegionGeometryCacheKey(manifest: VoxelMapManifest, regionId: string): string {
  return `${manifest.id}:region:${regionId}`;
}

export function buildVoxelChunkGeometry(manifest: VoxelMapManifest, chunk: VoxelChunk): THREE.BufferGeometry {
  const cacheKey = getVoxelChunkGeometryCacheKey(manifest, chunk);
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const buildStart = performance.now();
  const data = buildVoxelChunkGeometryData(manifest, chunk);
  return createGeometryFromData(manifest, cacheKey, data, 'voxelMeshBuild', performance.now() - buildStart);
}

export function buildVoxelRegionGeometry(
  manifest: VoxelMapManifest,
  regionId: string,
  chunks: VoxelChunk[]
): THREE.BufferGeometry {
  const cacheKey = getVoxelRegionGeometryCacheKey(manifest, regionId);
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;

  const buildStart = performance.now();
  const data = buildVoxelRegionGeometryData(manifest, chunks);
  return createGeometryFromData(manifest, cacheKey, data, 'voxelRegionMeshBuild', performance.now() - buildStart);
}

export function buildVoxelRegionGeometryAsync(
  manifest: VoxelMapManifest,
  regionId: string,
  chunks: VoxelChunk[]
): Promise<THREE.BufferGeometry> {
  const cacheKey = getVoxelRegionGeometryCacheKey(manifest, regionId);
  const cached = geometryCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const worker = getMeshWorker();
  if (!worker) {
    return new Promise((resolve) => {
      window.setTimeout(() => resolve(buildVoxelRegionGeometry(manifest, regionId, chunks)), 0);
    });
  }

  initializeWorkerManifest(worker, manifest);
  const requestId = nextWorkerRequestId++;
  const promise = new Promise<THREE.BufferGeometry>((resolve, reject) => {
    pendingRegionRequests.set(requestId, {
      resolve,
      reject,
      manifest,
      cacheKey,
      metricName: 'voxelRegionMeshBuildWorker',
    });
  });

  worker.postMessage({
    type: 'buildRegion',
    requestId,
    manifestId: manifest.id,
    regionId,
    chunkCoords: chunks.map((chunk) => chunk.coord),
  });

  return promise.catch(() => buildVoxelRegionGeometry(manifest, regionId, chunks));
}

export function clearVoxelGeometryCache(manifestId?: string): void {
  if (!manifestId) {
    for (const geometry of geometryCache.values()) {
      geometry.dispose();
    }
    geometryCache.clear();
    pendingRegionRequests.clear();
    meshWorker?.terminate();
    meshWorker = null;
    workerManifestId = null;
    return;
  }

  for (const key of geometryCache.keys()) {
    if (key.startsWith(`${manifestId}:`)) {
      geometryCache.get(key)?.dispose();
      geometryCache.delete(key);
    }
  }

  if (workerManifestId === manifestId) {
    meshWorker?.terminate();
    meshWorker = null;
    workerManifestId = null;
  }
}
