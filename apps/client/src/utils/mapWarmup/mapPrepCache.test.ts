import assert from 'node:assert/strict';
import { CONSTRUCTED_MAP_MANIFEST_VERSION } from '@voxel-strike/shared';
import {
  clearPreparedVoxelMapCache,
  getPreparedVoxelMap,
  getMapPrepCacheKey,
  prepareVoxelMapCpu,
} from './mapPrepCache';

clearPreparedVoxelMapCache();

assert.equal(
  getMapPrepCacheKey({ seed: 123 }),
  `procedural-v${CONSTRUCTED_MAP_MANIFEST_VERSION}:123`
);
assert.equal(
  getMapPrepCacheKey({ seed: -1 }),
  `procedural-v${CONSTRUCTED_MAP_MANIFEST_VERSION}:4294967295`
);
assert.equal(
  getMapPrepCacheKey({ seed: 123, mapSize: 'large' }),
  `procedural-v${CONSTRUCTED_MAP_MANIFEST_VERSION}:123:large`
);
assert.equal(
  getMapPrepCacheKey({ seed: 123, mapSize: 'large', mapProfileId: 'battle_royal_large' }),
  `procedural-v${CONSTRUCTED_MAP_MANIFEST_VERSION}:123:battle_royal_large:large`
);
assert.equal(
  getMapPrepCacheKey({ seed: 123, mapSize: 'large', pregeneratedMapId: 'pgmap_client_cache' }),
  `pregenerated-v${CONSTRUCTED_MAP_MANIFEST_VERSION}:pgmap_client_cache`
);

const first = prepareVoxelMapCpu({ seed: 20260611, source: 'test' });
const second = prepareVoxelMapCpu({ seed: 20260611, source: 'test' });

assert.equal(first, second);
assert.equal(second.cacheHits, 1);
assert.equal(first.manifest.seed, 20260611);
assert.ok(first.renderableRegions.length > 0);

const large = prepareVoxelMapCpu({ seed: 20260611, mapSize: 'large', source: 'test' });
assert.notEqual(first, large);
assert.equal(large.manifest.mapSize, 'large');
assert.ok(large.manifest.size.x > first.manifest.size.x);
assert.ok(first.manifest.gameplay.powerups.length > 0);

const small = prepareVoxelMapCpu({ seed: 20260611, mapSize: 'small', source: 'test' });
assert.ok(small.manifest.gameplay.powerups.length < first.manifest.gameplay.powerups.length);
assert.ok(first.manifest.gameplay.powerups.length < large.manifest.gameplay.powerups.length);

clearPreparedVoxelMapCache();

const fakeBattleRoyalManifest = {
  ...large.manifest,
  profileId: 'battle_royal_large' as const,
  mapSize: 'large' as const,
  chunks: [],
};
const battleRoyalOne = prepareVoxelMapCpu({
  seed: 1001,
  manifest: { ...fakeBattleRoyalManifest, seed: 1001, id: 'br-one' },
  pregeneratedMapId: 'pgmap_br_one',
  source: 'test',
});
const battleRoyalTwo = prepareVoxelMapCpu({
  seed: 1002,
  manifest: { ...fakeBattleRoyalManifest, seed: 1002, id: 'br-two' },
  pregeneratedMapId: 'pgmap_br_two',
  source: 'test',
});

assert.equal(battleRoyalOne.manifest.profileId, 'battle_royal_large');
assert.equal(battleRoyalTwo.manifest.profileId, 'battle_royal_large');
assert.equal(getPreparedVoxelMap({
  seed: 1001,
  themeId: fakeBattleRoyalManifest.themeId,
  mapSize: 'large',
  mapProfileId: 'battle_royal_large',
}), null);
assert.equal(
  getPreparedVoxelMap({
    seed: 1002,
    themeId: fakeBattleRoyalManifest.themeId,
    mapSize: 'large',
    mapProfileId: 'battle_royal_large',
    pregeneratedMapId: 'pgmap_br_two',
  })?.manifest.id,
  'br-two'
);
