import assert from 'node:assert/strict';
import { LineOfSightCache } from '../rooms/lineOfSightCache';

const start = { x: 0, y: 0, z: 0 };
const end = { x: 12, y: 0, z: 0 };

{
  const cache = new LineOfSightCache();
  let checks = 0;

  assert.equal(cache.hasLineOfSight(start, end, 1_000, 1, () => {
    checks++;
    return false;
  }), true);
  assert.ok(checks > 0, 'first LOS lookup should sample the path');

  const checksAfterFirstLookup = checks;
  assert.equal(cache.hasLineOfSight(start, end, 1_010, 1, () => {
    checks++;
    return true;
  }), true);
  assert.equal(checks, checksAfterFirstLookup, 'same-revision LOS lookup should use the cached result');

  assert.equal(cache.hasLineOfSight(start, end, 1_020, 2, () => {
    checks++;
    return true;
  }), false);
  assert.ok(checks > checksAfterFirstLookup, 'collision revision changes should recompute LOS');
}

{
  const cache = new LineOfSightCache();
  let checks = 0;

  assert.equal(cache.hasLineOfSight(start, end, 1_000, 1, () => {
    checks++;
    return false;
  }), true);

  const checksAfterFirstLookup = checks;
  assert.equal(cache.hasLineOfSight(start, end, 1_500, 1, () => {
    checks++;
    return true;
  }), false);
  assert.ok(checks > checksAfterFirstLookup, 'expired LOS cache entries should recompute');
}

{
  const cache = new LineOfSightCache();
  assert.equal(cache.hasLineOfSight(start, end, 1_000, 1, () => false), true);

  let rawChecks = 0;
  assert.equal(cache.traceLineOfSight(start, end, () => {
    rawChecks++;
    return true;
  }), false);
  assert.ok(rawChecks > 0, 'raw LOS traces should bypass a matching cached result');
}

{
  const cache = new LineOfSightCache();
  const alwaysClear = () => false;
  for (let index = 0; index <= 1_500; index++) {
    cache.hasLineOfSight(
      { x: index, y: 0, z: 0 },
      { x: index + 0.1, y: 0, z: 0 },
      1_000,
      1,
      alwaysClear
    );
  }
  const cacheSize = (cache as unknown as { cache: Map<number, unknown> }).cache.size;
  assert.ok(cacheSize <= 1_351, `capacity pruning should create batch headroom, received ${cacheSize}`);
}

console.log('line-of-sight-cache tests passed');
