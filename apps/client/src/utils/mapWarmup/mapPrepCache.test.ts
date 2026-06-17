import assert from 'node:assert/strict';
import { CONSTRUCTED_MAP_MANIFEST_VERSION } from '@voxel-strike/shared';
import {
  clearPreparedVoxelMapCache,
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
