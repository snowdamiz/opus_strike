import assert from 'node:assert/strict';
import type { VoxelChunk } from '@voxel-strike/shared';
import {
  VoxelChunkLookup,
  type VoxelChunkLookupManifest,
  worldToVoxelGrid,
} from '../rooms/voxelChunkLookup';

function chunk(input: {
  coord: { x: number; y: number; z: number };
  blocks: number[];
}): VoxelChunk {
  return {
    coord: input.coord,
    size: { x: 2, y: 2, z: 2 },
    blocks: Uint8Array.from(input.blocks),
    solidBlockCount: input.blocks.filter((block) => block > 0).length,
  };
}

function manifest(chunks: VoxelChunk[]): VoxelChunkLookupManifest {
  return {
    origin: { x: 10, y: 20, z: 30 },
    voxelSize: { x: 1, y: 1, z: 1 },
    size: { x: 4, y: 4, z: 4 },
    chunkSize: { x: 2, y: 2, z: 2 },
    chunks,
  };
}

assert.equal(worldToVoxelGrid(11.9, 10, 1), 1);
assert.equal(worldToVoxelGrid(9.9, 10, 1), -1);
assert.equal(worldToVoxelGrid(13, 10, 2), 1);

{
  const lookup = new VoxelChunkLookup();
  const first = chunk({
    coord: { x: 0, y: 0, z: 0 },
    blocks: [0, 0, 0, 7, 0, 0, 0, 0],
  });
  const map = manifest([first]);
  lookup.reset(map);

  assert.equal(lookup.getChunk(0, 0, 0), first);
  assert.equal(lookup.getBlockAtWorld(map, { x: 11.25, y: 20.25, z: 31.25 }), 7);
  assert.equal(lookup.getBlockAtWorld(map, { x: 9.99, y: 20.25, z: 31.25 }), 0);
  assert.equal(lookup.getBlockAtWorld(map, { x: 13.25, y: 20.25, z: 31.25 }), 0);
}

{
  const lookup = new VoxelChunkLookup();
  const first = chunk({
    coord: { x: 0, y: 0, z: 0 },
    blocks: [1, 0, 0, 0, 0, 0, 0, 0],
  });
  const second = chunk({
    coord: { x: 1, y: 0, z: 0 },
    blocks: [9, 0, 0, 0, 0, 0, 0, 0],
  });

  const firstMap = manifest([first]);
  lookup.reset(firstMap);
  assert.equal(lookup.getBlockAtWorld(firstMap, { x: 10.25, y: 20.25, z: 30.25 }), 1);

  const secondMap = manifest([second]);
  lookup.reset(secondMap);
  assert.equal(lookup.getChunk(0, 0, 0), undefined);
  assert.equal(lookup.getBlockAtWorld(secondMap, { x: 10.25, y: 20.25, z: 30.25 }), 0);
  assert.equal(lookup.getBlockAtWorld(secondMap, { x: 12.25, y: 20.25, z: 30.25 }), 9);

  lookup.clear();
  assert.equal(lookup.getChunk(1, 0, 0), undefined);
}

console.log('voxel chunk lookup tests passed');
