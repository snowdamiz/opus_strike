import assert from 'node:assert/strict';
import {
  generateProceduralVoxelMap,
  getPregeneratedMapStats,
  type VoxelMapManifest,
} from '@voxel-strike/shared';
import {
  createPregeneratedMapArtifactEnvelope,
  decodePregeneratedMapArtifactEnvelope,
  decodePregeneratedMapManifest,
  encodePregeneratedMapArtifactEnvelope,
  getPregeneratedMapContentHash,
} from '../maps/pregeneratedMapArtifact';

const encoder = new TextEncoder();

function assertUint8ArrayEqual(actual: Uint8Array, expected: Uint8Array): void {
  assert.equal(actual.byteLength, expected.byteLength);
  assert.equal(Buffer.compare(Buffer.from(actual), Buffer.from(expected)), 0);
}

function assertUint16ArrayEqual(actual: Uint16Array, expected: Uint16Array): void {
  assert.equal(actual.length, expected.length);
  const actualBytes = Buffer.from(actual.buffer, actual.byteOffset, actual.byteLength);
  const expectedBytes = Buffer.from(expected.buffer, expected.byteOffset, expected.byteLength);
  assert.equal(Buffer.compare(actualBytes, expectedBytes), 0);
}

function assertManifestRoundTrip(manifest: VoxelMapManifest, mapId: string, artifactId: string): void {
  const envelope = createPregeneratedMapArtifactEnvelope({ mapId, artifactId, manifest });
  const contentHash = envelope.header.contentHash;
  assert.ok(contentHash);
  assert.equal(getPregeneratedMapContentHash(envelope), contentHash);

  const bytes = encodePregeneratedMapArtifactEnvelope(envelope);
  const decodedEnvelope = decodePregeneratedMapArtifactEnvelope(bytes);
  assert.equal(decodedEnvelope.header.contentHash, contentHash);
  assert.equal(decodedEnvelope.header.mapId, mapId);
  assert.equal(decodedEnvelope.header.artifactId, artifactId);

  const restored = decodePregeneratedMapManifest(bytes);
  assert.equal(restored.seed, manifest.seed);
  assert.equal(restored.themeId, manifest.themeId);
  assert.equal(restored.profileId, manifest.profileId);
  assert.equal(restored.mapSize, manifest.mapSize);
  assert.equal(restored.topologyId, manifest.topologyId);
  assert.deepEqual(getPregeneratedMapStats(restored), getPregeneratedMapStats(manifest));
  assert.equal(restored.chunks.length, manifest.chunks.length);
  assertUint16ArrayEqual(restored.heightfield.topSolidRows, manifest.heightfield.topSolidRows);
  assertUint16ArrayEqual(restored.world.heightfield.topSolidRows, manifest.world.heightfield.topSolidRows);

  const chunkIndexes = Array.from(new Set([
    0,
    Math.floor(manifest.chunks.length / 2),
    manifest.chunks.length - 1,
  ])).filter((index) => index >= 0);
  for (const index of chunkIndexes) {
    const original = manifest.chunks[index];
    const decoded = restored.chunks[index];
    assert.ok(original);
    assert.ok(decoded);
    assert.deepEqual(decoded.coord, original.coord);
    assertUint8ArrayEqual(decoded.blocks, original.blocks);
  }

  const tampered = JSON.parse(JSON.stringify(envelope));
  tampered.manifest.seed = (tampered.manifest.seed + 1) >>> 0;
  assert.throws(
    () => decodePregeneratedMapArtifactEnvelope(encoder.encode(JSON.stringify(tampered))),
    /content hash mismatch/
  );
}

assertManifestRoundTrip(
  generateProceduralVoxelMap(0x515101, {
    themeId: 'verdant',
    mapSize: 'small',
    profileId: 'ctf_arena',
  }),
  'pgmap_test_arena',
  'pgartifact_test_arena'
);

assertManifestRoundTrip(
  generateProceduralVoxelMap(0x515102, {
    themeId: 'basalt',
    mapSize: 'large',
    profileId: 'battle_royal_large',
  }),
  'pgmap_test_battle_royal',
  'pgartifact_test_battle_royal'
);

console.log('pregenerated map artifact tests passed');
