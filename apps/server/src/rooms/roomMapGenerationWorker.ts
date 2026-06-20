import { parentPort, workerData } from 'node:worker_threads';
import { generateProceduralVoxelMap } from '@voxel-strike/shared';
import type { RoomMapGenerationInput } from './roomMapGeneration';

const input = workerData as RoomMapGenerationInput;

try {
  const manifest = generateProceduralVoxelMap(input.mapSeed, {
    themeId: input.mapThemeId,
    mapSize: input.mapSize,
    profileId: input.mapProfileId,
  });
  parentPort?.postMessage({ ok: true, manifest });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
