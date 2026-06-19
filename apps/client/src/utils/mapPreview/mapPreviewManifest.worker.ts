import {
  generateProceduralVoxelMap,
  type MapProfileId,
  type VoxelChunk,
  type VoxelMapManifest,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

type WorkerRequest = {
  type: 'generate';
  requestId: number;
  seed: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | string | null;
};

type WorkerResponse =
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

function getManifestTransferList(manifest: VoxelMapManifest): Transferable[] {
  const transfers = new Set<ArrayBuffer>();
  addChunkTransferBuffers(manifest.chunks, transfers);
  addChunkTransferBuffers(manifest.world.chunks, transfers);
  addHeightfieldTransferBuffers(manifest, transfers);
  return Array.from(transfers);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'generate') return;

  try {
    const start = performance.now();
    const manifest = generateProceduralVoxelMap(message.seed, {
      themeId: message.themeId,
      mapSize: message.mapSize,
      profileId: message.mapProfileId,
    });
    const response: WorkerResponse = {
      type: 'generated',
      requestId: message.requestId,
      manifest,
      generationMs: performance.now() - start,
    };

    (self as unknown as { postMessage: (response: WorkerResponse, transfer: Transferable[]) => void }).postMessage(
      response,
      getManifestTransferList(manifest)
    );
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId: message.requestId,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
