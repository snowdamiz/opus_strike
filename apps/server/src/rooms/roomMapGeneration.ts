import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import {
  generateProceduralVoxelMap,
  type MapProfileId,
  type VoxelMapManifest,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { loggers } from '../utils/logger';

export interface RoomMapGenerationInput {
  mapSeed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
}

type RoomMapGenerationWorkerResponse =
  | { ok: true; manifest: VoxelMapManifest }
  | { ok: false; error: string };

const MAP_GENERATION_WORKER_TIMEOUT_MS = 120_000;
const MAP_GENERATION_SLOW_LOG_MS = 3000;
const MAP_GENERATION_QUEUE_WAIT_LOG_MS = 1000;

let mapGenerationQueue = Promise.resolve();

function generateMapSync(input: RoomMapGenerationInput): VoxelMapManifest {
  return generateProceduralVoxelMap(input.mapSeed, {
    themeId: input.mapThemeId,
    mapSize: input.mapSize,
    profileId: input.mapProfileId,
  });
}

function shouldUseMapGenerationWorker(input: RoomMapGenerationInput): boolean {
  if (process.env.SERVER_MAP_GENERATION_WORKER === '0') return false;
  if (input.mapProfileId !== 'battle_royal_large') return false;
  return existsSync(path.join(__dirname, 'roomMapGenerationWorker.js'));
}

function generateMapWithWorker(input: RoomMapGenerationInput): Promise<VoxelMapManifest> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'roomMapGenerationWorker.js'), {
      workerData: input,
    });
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new Error(`Map generation worker timed out after ${MAP_GENERATION_WORKER_TIMEOUT_MS}ms`));
    }, MAP_GENERATION_WORKER_TIMEOUT_MS);
    timeout.unref?.();

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    worker.once('message', (message: RoomMapGenerationWorkerResponse) => {
      finish(() => {
        if (message.ok) {
          resolve(message.manifest);
        } else {
          reject(new Error(message.error));
        }
      });
    });

    worker.once('error', (error) => {
      finish(() => reject(error));
    });

    worker.once('exit', (code) => {
      if (code === 0) return;
      finish(() => reject(new Error(`Map generation worker exited with code ${code}`)));
    });
  });
}

export function generateRoomMapManifest(input: RoomMapGenerationInput): Promise<VoxelMapManifest> {
  const requestedAt = performance.now();
  const run = async () => {
    const startedAt = performance.now();
    const queueWaitMs = startedAt - requestedAt;
    const worker = shouldUseMapGenerationWorker(input);
    try {
      const manifest = worker
        ? await generateMapWithWorker(input)
        : generateMapSync(input);
      const durationMs = performance.now() - startedAt;
      if (durationMs >= MAP_GENERATION_SLOW_LOG_MS || queueWaitMs >= MAP_GENERATION_QUEUE_WAIT_LOG_MS) {
        loggers.room.warn('Room map generation slow', {
          mapSeed: input.mapSeed,
          mapThemeId: input.mapThemeId ?? null,
          mapSize: input.mapSize ?? null,
          mapProfileId: input.mapProfileId ?? null,
          worker,
          queueWaitMs: Math.round(queueWaitMs),
          durationMs: Math.round(durationMs),
          renderableChunkCount: manifest.stats.renderableChunkCount,
          colliderCount: manifest.stats.colliderCount,
          solidBlockCount: manifest.stats.solidBlocks,
        });
      }
      return manifest;
    } catch (error) {
      loggers.room.error('Room map generation failed', {
        mapSeed: input.mapSeed,
        mapThemeId: input.mapThemeId ?? null,
        mapSize: input.mapSize ?? null,
        mapProfileId: input.mapProfileId ?? null,
        worker,
        queueWaitMs: Math.round(queueWaitMs),
        durationMs: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
  const queued = mapGenerationQueue.then(run, run);
  mapGenerationQueue = queued.then(
    () => undefined,
    () => undefined
  );
  return queued;
}
