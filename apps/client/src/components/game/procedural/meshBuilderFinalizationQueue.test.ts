import assert from 'node:assert/strict';
import type { VoxelMapManifest } from '@voxel-strike/shared';

type RafCallback = (timestamp: number) => void;

interface FakeWorkerBuildMessage {
  requestId: number;
  manifestId: string;
  regionId: string;
  chunkCoords?: Array<{ x: number; y: number; z: number }>;
}

class FakeMeshWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: { type: string; manifest?: VoxelMapManifest } & Partial<FakeWorkerBuildMessage>): void {
    if (message.type === 'init' && message.manifest) {
      this.onmessage?.({
        data: {
          type: 'ready',
          manifestId: message.manifest.id,
        },
      } as MessageEvent);
      return;
    }

    if (message.type === 'buildRegion' && message.requestId !== undefined && message.manifestId && message.regionId) {
      workerBuilds.push({
        worker: this,
        requestId: message.requestId,
        manifestId: message.manifestId,
        regionId: message.regionId,
        chunkCoords: message.chunkCoords,
      });
    }
  }

  terminate(): void {
    this.onmessage = null;
    this.onerror = null;
  }
}

const manifest = {
  id: 'mesh-finalization-queue-test',
  origin: { x: 0, y: 0, z: 0 },
  voxelSize: { x: 1, y: 1, z: 1 },
} as VoxelMapManifest;

const originalWindow = globalThis.window;
const originalWorker = globalThis.Worker;
const rafCallbacks: RafCallback[] = [];
const workerBuilds: Array<FakeWorkerBuildMessage & { worker: FakeMeshWorker }> = [];

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    requestAnimationFrame: (callback: RafCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    cancelAnimationFrame: () => undefined,
  },
});
Object.defineProperty(globalThis, 'Worker', {
  configurable: true,
  value: FakeMeshWorker,
});

function emitBuiltRegion(build: FakeWorkerBuildMessage & { worker: FakeMeshWorker }): void {
  build.worker.onmessage?.({
    data: {
      type: 'regionBuilt',
      requestId: build.requestId,
      manifestId: build.manifestId,
      regionId: build.regionId,
      positions: new Float32Array([
        0, 0, 0,
        1, 0, 0,
        1, 1, 0,
        0, 1, 0,
      ]),
      normals: new Float32Array([
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
        0, 0, 1,
      ]),
      uvs: new Float32Array([
        0, 0,
        1, 0,
        1, 1,
        0, 1,
      ]),
      textureLayers: new Float32Array([0, 0, 0, 0]),
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      buildMs: 0,
    },
  } as MessageEvent);
}

function flushNextFrame(): void {
  const callback = rafCallbacks.shift();
  assert.ok(callback, 'expected a queued animation frame');
  callback(performance.now());
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index++) {
    await Promise.resolve();
  }
}

try {
  const {
    buildVoxelRegionGeometryAsync,
    cancelVoxelRegionGeometryBuild,
    clearVoxelGeometryCache,
    getVoxelGeometryCacheStats,
    getVoxelRegionGeometryCacheKey,
    isVoxelMeshRequestCancelledError,
  } = await import('./meshBuilder');
  const resolvedRegions: string[] = [];
  const regionPromises = ['a', 'b', 'c'].map((regionId) => (
    buildVoxelRegionGeometryAsync(manifest, regionId, [], 'full').then((geometry) => {
      assert.ok(geometry.getAttribute('uv'));
      assert.equal(geometry.getAttribute('uv2'), undefined);
      resolvedRegions.push(regionId);
    })
  ));

  assert.equal(workerBuilds.length, 3);
  assert.equal(workerBuilds.some((build) => build.chunkCoords !== undefined), false);
  for (const build of workerBuilds) {
    emitBuiltRegion(build);
  }

  await flushMicrotasks();
  assert.equal(resolvedRegions.length, 0);
  assert.equal(getVoxelGeometryCacheStats().pendingRegionFinalizations, 3);

  flushNextFrame();
  await flushMicrotasks();
  assert.equal(resolvedRegions.join(','), 'a');

  flushNextFrame();
  await flushMicrotasks();
  assert.equal(resolvedRegions.join(','), 'a,b');

  flushNextFrame();
  await Promise.all(regionPromises);
  assert.equal(resolvedRegions.join(','), 'a,b,c');
  assert.equal(getVoxelGeometryCacheStats().pendingRegionFinalizations, 0);

  const cancelledRegionPromise = buildVoxelRegionGeometryAsync(manifest, 'cancelled', [], 'full');
  assert.equal(workerBuilds.length, 4);
  cancelVoxelRegionGeometryBuild(getVoxelRegionGeometryCacheKey(manifest, 'cancelled', 'full'));
  await assert.rejects(cancelledRegionPromise, isVoxelMeshRequestCancelledError);
  assert.equal(getVoxelGeometryCacheStats().pendingRegionBuilds, 0);
  assert.equal(getVoxelGeometryCacheStats().pendingRegionRequests, 0);
  emitBuiltRegion(workerBuilds[3]);
  await flushMicrotasks();
  assert.equal(getVoxelGeometryCacheStats().pendingRegionFinalizations, 0);

  clearVoxelGeometryCache(manifest.id);
  console.log('mesh builder finalization queue tests passed');
} finally {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    value: originalWorker,
  });
}
