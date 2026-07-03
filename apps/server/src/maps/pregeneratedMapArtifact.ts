import crypto from 'node:crypto';
import {
  PREGENERATED_MAP_ARTIFACT_SCHEMA_VERSION,
  deserializeVoxelMapManifest,
  serializeVoxelMapManifest,
  type PregeneratedMapArtifactEnvelope,
  type PregeneratedMapArtifactHeader,
  type PregeneratedMapArtifactId,
  type PregeneratedMapId,
  type VoxelMapManifest,
} from '@voxel-strike/shared';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface CreatePregeneratedMapArtifactEnvelopeInput {
  mapId: PregeneratedMapId;
  artifactId: PregeneratedMapArtifactId;
  manifest: VoxelMapManifest;
  createdAt?: Date;
}

function hashArtifactEnvelopePayload(envelope: PregeneratedMapArtifactEnvelope): string {
  const header: PregeneratedMapArtifactHeader = {
    ...envelope.header,
    contentHash: undefined,
  };
  const payload = JSON.stringify({
    header,
    manifest: envelope.manifest,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

export function createPregeneratedMapArtifactEnvelope(
  input: CreatePregeneratedMapArtifactEnvelopeInput
): PregeneratedMapArtifactEnvelope {
  const { manifest } = input;
  const envelope: PregeneratedMapArtifactEnvelope = {
    header: {
      schemaVersion: PREGENERATED_MAP_ARTIFACT_SCHEMA_VERSION,
      artifactId: input.artifactId,
      mapId: input.mapId,
      generatorVersion: manifest.version,
      seed: manifest.seed >>> 0,
      themeId: manifest.themeId,
      profileId: manifest.profileId ?? 'ctf_arena',
      gameplayMode: manifest.gameplay.mode,
      familyId: manifest.familyId,
      mapSize: manifest.mapSize,
      topologyId: manifest.topologyId,
      compressionCodec: 'none',
      createdAt: (input.createdAt ?? new Date()).toISOString(),
    },
    manifest: serializeVoxelMapManifest(manifest),
  };
  envelope.header.contentHash = hashArtifactEnvelopePayload(envelope);
  return envelope;
}

export function getPregeneratedMapContentHash(envelope: PregeneratedMapArtifactEnvelope): string {
  return hashArtifactEnvelopePayload(envelope);
}

export function encodePregeneratedMapArtifactEnvelope(envelope: PregeneratedMapArtifactEnvelope): Uint8Array {
  return textEncoder.encode(JSON.stringify(envelope));
}

export function decodePregeneratedMapArtifactEnvelope(bytes: Uint8Array): PregeneratedMapArtifactEnvelope {
  const decoded = JSON.parse(textDecoder.decode(bytes)) as PregeneratedMapArtifactEnvelope;
  if (decoded.header.schemaVersion !== PREGENERATED_MAP_ARTIFACT_SCHEMA_VERSION) {
    throw new Error(`Unsupported map artifact schema version: ${decoded.header.schemaVersion}`);
  }

  const expectedHash = decoded.header.contentHash;
  if (!expectedHash) {
    throw new Error('Map artifact is missing content hash');
  }
  const actualHash = getPregeneratedMapContentHash(decoded);
  if (actualHash !== expectedHash) {
    throw new Error(`Map artifact content hash mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
  return decoded;
}

export function decodePregeneratedMapManifest(bytes: Uint8Array): VoxelMapManifest {
  const envelope = decodePregeneratedMapArtifactEnvelope(bytes);
  return deserializeVoxelMapManifest(envelope.manifest);
}
