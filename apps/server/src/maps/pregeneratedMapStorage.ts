import type { PrismaClient } from '@prisma/client';
import prisma from '../db';
import {
  decodePregeneratedMapArtifactEnvelope,
  encodePregeneratedMapArtifactEnvelope,
} from './pregeneratedMapArtifact';
import type {
  PregeneratedMapArtifactId,
  PregeneratedMapArtifactEnvelope,
  PregeneratedMapCompressionCodec,
  PregeneratedMapStorageProvider,
} from '@voxel-strike/shared';

export interface StorePregeneratedMapArtifactInput {
  envelope: PregeneratedMapArtifactEnvelope;
  storageProvider?: PregeneratedMapStorageProvider;
  storageKey?: string;
}

export interface StoredPregeneratedMapArtifact {
  id: PregeneratedMapArtifactId;
  storageProvider: PregeneratedMapStorageProvider;
  storageKey: string;
  byteSize: number;
  compressionCodec: PregeneratedMapCompressionCodec;
  contentHash: string;
  manifestSchemaVersion: number;
  envelope: PregeneratedMapArtifactEnvelope;
}

export interface PregeneratedMapArtifactStorage {
  storeArtifact(input: StorePregeneratedMapArtifactInput): Promise<StoredPregeneratedMapArtifact>;
  loadArtifact(artifactId: PregeneratedMapArtifactId): Promise<StoredPregeneratedMapArtifact | null>;
}

function toBytes(data: unknown): Uint8Array | null {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data);
  return null;
}

export class PrismaPregeneratedMapArtifactStorage implements PregeneratedMapArtifactStorage {
  constructor(private readonly client: PrismaClient) {}

  async storeArtifact(input: StorePregeneratedMapArtifactInput): Promise<StoredPregeneratedMapArtifact> {
    const envelope = input.envelope;
    const contentHash = envelope.header.contentHash;
    if (!contentHash) throw new Error('Cannot store pregenerated map artifact without content hash');

    const bytes = encodePregeneratedMapArtifactEnvelope(envelope);
    const storageProvider = input.storageProvider ?? 'database';
    const storageKey = input.storageKey ?? `pregenerated-maps/${envelope.header.artifactId}.json`;

    const artifact = await this.client.pregeneratedMapArtifact.upsert({
      where: { contentHash },
      create: {
        id: envelope.header.artifactId,
        storageProvider,
        storageKey,
        byteSize: bytes.byteLength,
        compressionCodec: envelope.header.compressionCodec,
        contentHash,
        manifestSchemaVersion: envelope.header.schemaVersion,
        data: Buffer.from(bytes),
        createdAt: new Date(envelope.header.createdAt),
      },
      update: {},
    });

    return {
      id: artifact.id,
      storageProvider: artifact.storageProvider as PregeneratedMapStorageProvider,
      storageKey: artifact.storageKey,
      byteSize: artifact.byteSize,
      compressionCodec: artifact.compressionCodec as PregeneratedMapCompressionCodec,
      contentHash: artifact.contentHash,
      manifestSchemaVersion: artifact.manifestSchemaVersion,
      envelope,
    };
  }

  async loadArtifact(artifactId: PregeneratedMapArtifactId): Promise<StoredPregeneratedMapArtifact | null> {
    const artifact = await this.client.pregeneratedMapArtifact.findUnique({
      where: { id: artifactId },
    });
    if (!artifact) return null;

    const bytes = toBytes(artifact.data);
    if (!bytes) {
      throw new Error(`Map artifact ${artifact.id} has no database payload`);
    }

    const envelope = decodePregeneratedMapArtifactEnvelope(bytes);
    if (envelope.header.contentHash !== artifact.contentHash) {
      throw new Error(`Map artifact ${artifact.id} database hash does not match envelope hash`);
    }

    return {
      id: artifact.id,
      storageProvider: artifact.storageProvider as PregeneratedMapStorageProvider,
      storageKey: artifact.storageKey,
      byteSize: artifact.byteSize,
      compressionCodec: artifact.compressionCodec as PregeneratedMapCompressionCodec,
      contentHash: artifact.contentHash,
      manifestSchemaVersion: artifact.manifestSchemaVersion,
      envelope,
    };
  }
}

export const pregeneratedMapArtifactStorage = new PrismaPregeneratedMapArtifactStorage(prisma);
