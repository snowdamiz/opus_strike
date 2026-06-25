import { parentPort, workerData } from 'node:worker_threads';
import { generateProceduralVoxelMap } from '@voxel-strike/shared';
import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import type { RoomMapGenerationInput } from './roomMapGeneration';

const input = workerData as RoomMapGenerationInput;

function addChunkTransferBuffers(chunks: readonly VoxelChunk[], transfers: Set<ArrayBuffer>): void {
  for (const chunk of chunks) {
    const buffer = chunk.blocks.buffer;
    if (buffer instanceof ArrayBuffer && buffer.byteLength > 0) {
      transfers.add(buffer);
    }
  }
}

function addHeightfieldTransferBuffers(manifest: VoxelMapManifest, transfers: Set<ArrayBuffer>): void {
  const topSolidRowsBuffer = manifest.heightfield.topSolidRows.buffer;
  if (topSolidRowsBuffer instanceof ArrayBuffer && topSolidRowsBuffer.byteLength > 0) {
    transfers.add(topSolidRowsBuffer);
  }

  const worldTopSolidRowsBuffer = manifest.world.heightfield.topSolidRows.buffer;
  if (worldTopSolidRowsBuffer instanceof ArrayBuffer && worldTopSolidRowsBuffer.byteLength > 0) {
    transfers.add(worldTopSolidRowsBuffer);
  }
}

function getManifestTransferList(manifest: VoxelMapManifest): ArrayBuffer[] {
  const transfers = new Set<ArrayBuffer>();
  addChunkTransferBuffers(manifest.chunks, transfers);
  addChunkTransferBuffers(manifest.world.chunks, transfers);
  addHeightfieldTransferBuffers(manifest, transfers);
  return Array.from(transfers);
}

try {
  const manifest = generateProceduralVoxelMap(input.mapSeed, {
    themeId: input.mapThemeId,
    mapSize: input.mapSize,
    profileId: input.mapProfileId,
  });
  parentPort?.postMessage({ ok: true, manifest }, getManifestTransferList(manifest));
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
