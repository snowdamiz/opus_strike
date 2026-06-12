import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBlockNumericId, type VoxelChunk, type VoxelMapManifest } from '@voxel-strike/shared';
import { buildVoxelRegionGeometryData } from './meshGeometryData';
import {
  getTextureLayerForBlock,
  TERRAIN_TEXTURE_LAYER_COUNT,
} from './terrainTextures';

const blocks = new Uint8Array([
  getBlockNumericId('grass'),
  getBlockNumericId('stone'),
]);

const chunk: VoxelChunk = {
  coord: { x: 0, y: 0, z: 0 },
  size: { x: 2, y: 1, z: 1 },
  blocks,
  solidBlockCount: 2,
};

const manifest = {
  id: 'terrain-texture-plan-test',
  size: { x: 2, y: 1, z: 1 },
  chunkSize: { x: 2, y: 1, z: 1 },
  chunks: [chunk],
} as unknown as VoxelMapManifest;

const meshData = buildVoxelRegionGeometryData(manifest, [chunk]);
const textureLayers = Array.from(meshData.textureLayers);
const uniqueLayers = new Set(textureLayers);

assert.equal(textureLayers.length, meshData.positions.length / 3);
assert.equal(meshData.textureLayers.length, 40);
assert.ok(uniqueLayers.has(getTextureLayerForBlock('grass', 'top').layer));
assert.ok(uniqueLayers.has(getTextureLayerForBlock('grass', 'side').layer));
assert.ok(uniqueLayers.has(getTextureLayerForBlock('grass', 'bottom').layer));
assert.ok(uniqueLayers.has(getTextureLayerForBlock('stone', 'side').layer));
assert.equal(getTextureLayerForBlock('grass', 'bottom').layer, getTextureLayerForBlock('dirt', 'side').layer);

assert.equal(TERRAIN_TEXTURE_LAYER_COUNT, 30);

const terrainTexturesSource = readFileSync(new URL('./terrainTextures.ts', import.meta.url), 'utf8');
const materialSource = readFileSync(new URL('./materials.ts', import.meta.url), 'utf8');

assert.match(terrainTexturesSource, /new THREE\.DataArrayTexture/);
assert.match(terrainTexturesSource, /createLinearGradient/);
assert.match(materialSource, /sampler2DArray/);
assert.match(materialSource, /new THREE\.MeshLambertMaterial/);
assert.doesNotMatch(materialSource, /MeshStandardMaterial/);
assert.doesNotMatch(materialSource, /envMapIntensity|roughnessMap|metalnessMap|bumpMap|aoMap/);
assert.doesNotMatch(materialSource, /voxelAtlas|voxelTileOrigin|createVoxelAtlasTextures/);
assert.doesNotMatch(terrainTexturesSource, /CanvasTexture|roughness|metalness|bump|aoMap|createVoxelAtlas/);
assert.doesNotMatch(terrainTexturesSource, /fillRect\(x \+ inset, y \+ inset, TILE_SIZE - inset \* 2, 2\)/);
assert.doesNotMatch(terrainTexturesSource, /bottom - 2/);

console.log('procedural terrain texture plan tests passed');
