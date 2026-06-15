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

const first = prepareVoxelMapCpu({ seed: 20260611, source: 'test' });
const second = prepareVoxelMapCpu({ seed: 20260611, source: 'test' });

assert.equal(first, second);
assert.equal(second.cacheHits, 1);
assert.equal(first.manifest.seed, 20260611);
assert.ok(first.renderableRegions.length > 0);

clearPreparedVoxelMapCache();
