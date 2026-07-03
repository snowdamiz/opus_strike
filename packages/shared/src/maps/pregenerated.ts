import type {
  BlueprintPreview,
  MapDiagnostics,
  MapFamilyId,
  MapGameMode,
  MapProfileId,
  MapTopologyId,
  VoxelChunk,
  VoxelHeightfield,
  VoxelMapManifest,
  VoxelMapSizeId,
  VoxelMapStats,
  VoxelMapTheme,
} from './procedural/types.js';

export const PREGENERATED_MAP_ARTIFACT_SCHEMA_VERSION = 1;

export type PregeneratedMapId = string;
export type PregeneratedMapArtifactId = string;
export type PregeneratedMapStatus = 'generating' | 'ready' | 'reserved' | 'active' | 'retired' | 'failed';
export type PregeneratedMapVisibility = 'public' | 'matchmaking-only' | 'admin-only';
export type PregeneratedMapStorageProvider = 'database' | 'local-disk' | 'object-storage';
export type PregeneratedMapCompressionCodec = 'none';
export type PregeneratedMapSelectionSource =
  | 'vote'
  | 'matchmaking'
  | 'battle-royal-auto'
  | 'streamer-rotation'
  | 'admin'
  | 'fallback';

export interface PregeneratedMapStats {
  solidBlockCount: number;
  renderableChunkCount: number;
  colliderCount: number;
  estimatedTriangles: number;
}

export interface PregeneratedMapArtifactHeader {
  schemaVersion: number;
  artifactId: PregeneratedMapArtifactId;
  mapId: PregeneratedMapId;
  generatorVersion: number;
  seed: number;
  themeId: VoxelMapTheme['id'];
  profileId: MapProfileId;
  gameplayMode: MapGameMode;
  familyId: MapFamilyId;
  mapSize: VoxelMapSizeId;
  topologyId: MapTopologyId;
  compressionCodec: PregeneratedMapCompressionCodec;
  contentHash?: string;
  createdAt: string;
}

export interface PregeneratedMapArtifactEnvelope {
  header: PregeneratedMapArtifactHeader;
  manifest: SerializedVoxelMapManifest;
}

export interface PregeneratedMapCatalogSummary {
  id: PregeneratedMapId;
  artifactId: PregeneratedMapArtifactId;
  seed: number;
  themeId: VoxelMapTheme['id'];
  profileId: MapProfileId;
  gameplayMode: MapGameMode;
  familyId: MapFamilyId;
  mapSize: VoxelMapSizeId;
  topologyId: MapTopologyId;
  displayName: string;
  previewTags: string[];
  preview: BlueprintPreview;
  stats: PregeneratedMapStats;
  diagnosticsScore: number;
  diagnosticsWarnings: string[];
  status: PregeneratedMapStatus;
  visibility: PregeneratedMapVisibility;
  generatorVersion: number;
  lastSelectedAt: string | null;
  selectionCount: number;
  failureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SerializedTypedArray {
  type: 'Uint8Array' | 'Uint16Array';
  encoding: 'base64';
  byteOrder: 'little-endian';
  length: number;
  byteLength: number;
  data: string;
}

export interface SerializedVoxelChunk extends Omit<VoxelChunk, 'blocks'> {
  blocks: SerializedTypedArray;
}

export interface SerializedVoxelHeightfield extends Omit<VoxelHeightfield, 'topSolidRows'> {
  topSolidRows: SerializedTypedArray;
}

export type SerializedVoxelMapManifest = Omit<
  VoxelMapManifest,
  'heightfield' | 'chunks' | 'world'
> & {
  heightfield: SerializedVoxelHeightfield;
  chunks: SerializedVoxelChunk[];
  world: Omit<VoxelMapManifest['world'], 'heightfield' | 'chunks'> & {
    heightfield: SerializedVoxelHeightfield;
    chunks: SerializedVoxelChunk[];
  };
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function serializeTypedArray(array: Uint8Array | Uint16Array): SerializedTypedArray {
  const bytes = array instanceof Uint8Array
    ? new Uint8Array(array)
    : new Uint8Array(array.buffer.slice(array.byteOffset, array.byteOffset + array.byteLength));

  return {
    type: array instanceof Uint8Array ? 'Uint8Array' : 'Uint16Array',
    encoding: 'base64',
    byteOrder: 'little-endian',
    length: array.length,
    byteLength: bytes.byteLength,
    data: bytesToBase64(bytes),
  };
}

function deserializeTypedArray(serialized: SerializedTypedArray): Uint8Array | Uint16Array {
  if (serialized.encoding !== 'base64') {
    throw new Error(`Unsupported typed-array encoding: ${serialized.encoding}`);
  }
  if (serialized.byteOrder !== 'little-endian') {
    throw new Error(`Unsupported typed-array byte order: ${serialized.byteOrder}`);
  }

  const bytes = base64ToBytes(serialized.data);
  if (bytes.byteLength !== serialized.byteLength) {
    throw new Error(`Typed-array byte length mismatch: expected ${serialized.byteLength}, got ${bytes.byteLength}`);
  }

  if (serialized.type === 'Uint8Array') {
    if (bytes.length !== serialized.length) {
      throw new Error(`Uint8Array length mismatch: expected ${serialized.length}, got ${bytes.length}`);
    }
    return bytes;
  }

  if (serialized.type === 'Uint16Array') {
    if (bytes.byteLength % Uint16Array.BYTES_PER_ELEMENT !== 0) {
      throw new Error('Uint16Array payload byte length must be even');
    }
    const copy = new Uint8Array(bytes);
    const view = new Uint16Array(copy.buffer);
    if (view.length !== serialized.length) {
      throw new Error(`Uint16Array length mismatch: expected ${serialized.length}, got ${view.length}`);
    }
    return view;
  }

  throw new Error(`Unsupported typed-array type: ${(serialized as { type?: string }).type}`);
}

function serializeChunk(chunk: VoxelChunk): SerializedVoxelChunk {
  return {
    ...chunk,
    blocks: serializeTypedArray(chunk.blocks),
  };
}

function deserializeChunk(chunk: SerializedVoxelChunk): VoxelChunk {
  const blocks = deserializeTypedArray(chunk.blocks);
  if (!(blocks instanceof Uint8Array)) {
    throw new Error('Voxel chunk blocks must deserialize to Uint8Array');
  }
  return {
    ...chunk,
    blocks,
  };
}

function serializeHeightfield(heightfield: VoxelHeightfield): SerializedVoxelHeightfield {
  return {
    ...heightfield,
    topSolidRows: serializeTypedArray(heightfield.topSolidRows),
  };
}

function deserializeHeightfield(heightfield: SerializedVoxelHeightfield): VoxelHeightfield {
  const topSolidRows = deserializeTypedArray(heightfield.topSolidRows);
  if (!(topSolidRows instanceof Uint16Array)) {
    throw new Error('Voxel heightfield rows must deserialize to Uint16Array');
  }
  return {
    ...heightfield,
    topSolidRows,
  };
}

export function serializeVoxelMapManifest(manifest: VoxelMapManifest): SerializedVoxelMapManifest {
  return {
    ...manifest,
    heightfield: serializeHeightfield(manifest.heightfield),
    chunks: manifest.chunks.map(serializeChunk),
    world: {
      ...manifest.world,
      heightfield: serializeHeightfield(manifest.world.heightfield),
      chunks: manifest.world.chunks.map(serializeChunk),
    },
  };
}

export function deserializeVoxelMapManifest(serialized: SerializedVoxelMapManifest): VoxelMapManifest {
  return {
    ...serialized,
    heightfield: deserializeHeightfield(serialized.heightfield),
    chunks: serialized.chunks.map(deserializeChunk),
    world: {
      ...serialized.world,
      heightfield: deserializeHeightfield(serialized.world.heightfield),
      chunks: serialized.world.chunks.map(deserializeChunk),
    },
  };
}

export function getPregeneratedMapStats(manifest: Pick<VoxelMapManifest, 'stats'>): PregeneratedMapStats {
  const estimatedTrianglesByProfile = manifest.stats.estimatedTrianglesByProfile;
  return {
    solidBlockCount: manifest.stats.solidBlocks,
    renderableChunkCount: manifest.stats.renderableChunkCount,
    colliderCount: manifest.stats.colliderCount,
    estimatedTriangles: Math.max(
      0,
      estimatedTrianglesByProfile?.balanced
        ?? estimatedTrianglesByProfile?.competitive
        ?? estimatedTrianglesByProfile?.cinematic
        ?? estimatedTrianglesByProfile?.potato
        ?? 0
    ),
  };
}

export function getPregeneratedMapDiagnostics(manifest: Pick<VoxelMapManifest, 'construction'>): {
  score: number;
  warnings: string[];
} {
  const diagnostics: MapDiagnostics = manifest.construction.diagnostics;
  return {
    score: diagnostics.score,
    warnings: [...diagnostics.warnings],
  };
}

export function getPregeneratedMapPreviewTags(manifest: Pick<VoxelMapManifest, 'preview' | 'mapSize' | 'topologyId'>): string[] {
  return Array.from(new Set([
    ...manifest.preview.labelTags,
    manifest.mapSize,
    manifest.topologyId,
  ]));
}
