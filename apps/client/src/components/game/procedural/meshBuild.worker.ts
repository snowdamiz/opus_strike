import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import {
  buildVoxelRegionGeometryData,
  transformVoxelMeshGeometryDataToWorld,
  type VoxelRegionGeometryDetail,
} from './meshGeometryData';
import { getVoxelChunkRegionId } from '../../../utils/mapWarmup/voxelRegionKeys';

type WorkerRequest =
  | {
      type: 'init';
      manifest: VoxelMapManifest;
    }
  | {
      type: 'buildRegion';
      requestId: number;
      manifestId: string;
      regionId: string;
      detail?: VoxelRegionGeometryDetail;
      chunkCoords?: Array<{ x: number; y: number; z: number }>;
    };

type WorkerResponse =
  | {
      type: 'ready';
      manifestId: string;
    }
  | {
      type: 'regionBuilt';
      requestId: number;
      manifestId: string;
      regionId: string;
      positions: Float32Array;
      normals: Float32Array;
      uvs: Float32Array;
      textureLayers: Float32Array;
      indices: Uint16Array | Uint32Array;
      boundingSphere?: {
        center: { x: number; y: number; z: number };
        radius: number;
      };
      buildMs: number;
    }
  | {
      type: 'error';
      requestId?: number;
      message: string;
    };

let activeManifest: VoxelMapManifest | null = null;
const chunksByCoord = new Map<string, VoxelChunk>();
const chunksByRegionId = new Map<string, VoxelChunk[]>();

function coordKey(coord: { x: number; y: number; z: number }): string {
  return `${coord.x}:${coord.y}:${coord.z}`;
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === 'init') {
      activeManifest = message.manifest;
      chunksByCoord.clear();
      chunksByRegionId.clear();
      for (const chunk of activeManifest.chunks) {
        chunksByCoord.set(coordKey(chunk.coord), chunk);
        if (chunk.solidBlockCount <= 0) continue;

        const regionId = getVoxelChunkRegionId(chunk.coord);
        const regionChunks = chunksByRegionId.get(regionId);
        if (regionChunks) {
          regionChunks.push(chunk);
        } else {
          chunksByRegionId.set(regionId, [chunk]);
        }
      }

      const response: WorkerResponse = {
        type: 'ready',
        manifestId: activeManifest.id,
      };
      self.postMessage(response);
      return;
    }

    if (!activeManifest || activeManifest.id !== message.manifestId) {
      throw new Error(`Worker has no initialized manifest for ${message.manifestId}`);
    }

    const chunks = chunksByRegionId.get(message.regionId) ?? (
      message.chunkCoords
        ? message.chunkCoords
          .map((coord) => chunksByCoord.get(coordKey(coord)))
          .filter((chunk): chunk is VoxelChunk => Boolean(chunk))
        : null
    );
    if (!chunks) {
      throw new Error(`Worker has no chunks for region ${message.regionId}`);
    }

    const start = performance.now();
    const data = transformVoxelMeshGeometryDataToWorld(
      activeManifest,
      buildVoxelRegionGeometryData(activeManifest, chunks, message.detail ?? 'full')
    );
    const response: WorkerResponse = {
      type: 'regionBuilt',
      requestId: message.requestId,
      manifestId: activeManifest.id,
      regionId: message.regionId,
      ...data,
      buildMs: performance.now() - start,
    };

    (self as unknown as { postMessage: (message: WorkerResponse, transfer: Transferable[]) => void }).postMessage(response, [
      data.positions.buffer,
      data.normals.buffer,
      data.uvs.buffer,
      data.textureLayers.buffer,
      data.indices.buffer,
    ] as Transferable[]);
  } catch (error) {
    const response: WorkerResponse = {
      type: 'error',
      requestId: message.type === 'buildRegion' ? message.requestId : undefined,
      message: error instanceof Error ? error.message : String(error),
    };
    self.postMessage(response);
  }
};
