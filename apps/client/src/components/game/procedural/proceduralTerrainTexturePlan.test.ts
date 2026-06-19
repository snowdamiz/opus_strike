import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getBlockNumericId, type VoxelChunk, type VoxelMapManifest } from '@voxel-strike/shared';
import { buildVoxelRegionGeometryData } from './meshGeometryData';
import {
  getTerrainTextureAnisotropy,
  TERRAIN_TEXTURE_ANISOTROPY_BY_QUALITY,
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

assert.equal(TERRAIN_TEXTURE_LAYER_COUNT, 36);
assert.deepEqual(TERRAIN_TEXTURE_ANISOTROPY_BY_QUALITY, {
  off: 4,
  minimum: 4,
  low: 8,
  medium: 8,
  high: 8,
  ultra: 16,
});
assert.equal(getTerrainTextureAnisotropy('off'), 4);
assert.equal(getTerrainTextureAnisotropy('low'), 8);
assert.equal(getTerrainTextureAnisotropy('ultra'), 16);

const terrainTexturesSource = readFileSync(new URL('./terrainTextures.ts', import.meta.url), 'utf8');
const materialSource = readFileSync(new URL('./materials.ts', import.meta.url), 'utf8');

assert.match(terrainTexturesSource, /new THREE\.DataArrayTexture/);
assert.match(terrainTexturesSource, /createLinearGradient/);
assert.match(terrainTexturesSource, /MATERIAL_QUALITY_PAINT_PROFILES/);
assert.match(terrainTexturesSource, /TERRAIN_DETAIL_GRID_SIZE = 8/);
assert.match(terrainTexturesSource, /TERRAIN_TEXTURE_ANISOTROPY_BY_QUALITY/);
assert.match(terrainTexturesSource, /\$\{theme\.id\}:\$\{materialQuality\}/);
assert.match(terrainTexturesSource, /getTerrainDetailKindForTile/);
assert.match(terrainTexturesSource, /tile === TILE_MAP\.gold \|\| tile === TILE_MAP\.gold_ore\) return 'stone'/);
assert.match(terrainTexturesSource, /if \(isGoldenTheme\) \{\s*glowTiles\.push\(/);
assert.match(materialSource, /sampler2DArray/);
assert.match(materialSource, /voxelTerrainColorTexture/);
assert.match(materialSource, /voxelTerrainEmissiveTexture/);
assert.match(materialSource, /TERRAIN_TEXTURE_MIP_FOOTPRINT_SCALE/);
assert.match(materialSource, /materialQuality/);
assert.match(materialSource, /new THREE\.MeshLambertMaterial/);
assert.doesNotMatch(terrainTexturesSource, /TERRAIN_TEXTURE_ANISOTROPY\s*=\s*1/);
assert.doesNotMatch(materialSource, /MeshStandardMaterial/);
assert.doesNotMatch(materialSource, /envMapIntensity|roughnessMap|metalnessMap|bumpMap|aoMap/);
assert.doesNotMatch(materialSource, /voxelAtlas|voxelTileOrigin|createVoxelAtlasTextures/);
assert.doesNotMatch(materialSource, /map:\s*textures\.color|emissiveMap:\s*textures\.emissive/);
assert.doesNotMatch(materialSource, /voxelMacroTint|voxelMacroTintStrength|vVoxelWorldPosition/);
assert.doesNotMatch(terrainTexturesSource, /CanvasTexture|roughness|metalness|bump|aoMap|createVoxelAtlas/);
assert.doesNotMatch(terrainTexturesSource, /VoxelTerrainTextureDetail|DEFAULT_TILE_SIZE|MEDIUM_DETAIL_TILE_SIZE|getTerrainTextureProfile/);
assert.doesNotMatch(terrainTexturesSource, /paintGrassTop|paintMetalTile|paintGlassTile|paintPadTile/);
assert.doesNotMatch(terrainTexturesSource, /paintBlockyVeins|paintBroadFacets/);
assert.doesNotMatch(terrainTexturesSource, /middle - 1|rivetSize = 4/);
assert.doesNotMatch(terrainTexturesSource, /fillRect\(x \+ inset, y \+ inset, TILE_SIZE - inset \* 2, 2\)/);
assert.doesNotMatch(terrainTexturesSource, /bottom - 2/);

console.log('procedural terrain texture plan tests passed');
