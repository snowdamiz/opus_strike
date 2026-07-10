import assert from 'node:assert/strict';
import {
  BLAZE_PRIMARY_MAGAZINE_SIZE,
  BLAZE_SCRAPSHOT_MAGAZINE_SIZE,
  BLAZE_SCRAPSHOT_PELLET_COUNT,
  BLAZE_SCRAPSHOT_PELLET_DAMAGE,
  BLAZE_SCRAPSHOT_RANGE,
  calculateBlazeScrapshotPelletDamage,
  getBlazePrimaryAbilityId,
  getBlazePrimaryMagazineSize,
  getBlazeScrapshotPelletDirections,
  isBlazePrimarySkill,
  normalizeBlazePrimarySkill,
} from '../dist/index.js';

assert.equal(isBlazePrimarySkill('fireball_rockets'), true);
assert.equal(isBlazePrimarySkill('scrapshot'), true);
assert.equal(isBlazePrimarySkill('other'), false);
assert.equal(normalizeBlazePrimarySkill('other'), 'fireball_rockets');
assert.equal(getBlazePrimaryAbilityId('fireball_rockets'), 'blaze_rocket');
assert.equal(getBlazePrimaryAbilityId('scrapshot'), 'blaze_scrapshot');
assert.equal(getBlazePrimaryMagazineSize('fireball_rockets'), BLAZE_PRIMARY_MAGAZINE_SIZE);
assert.equal(getBlazePrimaryMagazineSize('scrapshot'), BLAZE_SCRAPSHOT_MAGAZINE_SIZE);
assert.equal(calculateBlazeScrapshotPelletDamage(0), BLAZE_SCRAPSHOT_PELLET_DAMAGE);
assert.equal(calculateBlazeScrapshotPelletDamage(4), BLAZE_SCRAPSHOT_PELLET_DAMAGE);
assert.ok(calculateBlazeScrapshotPelletDamage(8) < BLAZE_SCRAPSHOT_PELLET_DAMAGE);
assert.equal(calculateBlazeScrapshotPelletDamage(BLAZE_SCRAPSHOT_RANGE), 2);

const directions = getBlazeScrapshotPelletDirections({ x: 0, y: 0, z: -3 });
assert.equal(directions.length, BLAZE_SCRAPSHOT_PELLET_COUNT);
for (const direction of directions) {
  assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 0.000001);
  assert.ok(direction.z < -0.98);
}
assert.equal(new Set(directions.map((direction) => `${direction.x.toFixed(5)}:${direction.y.toFixed(5)}`)).size, BLAZE_SCRAPSHOT_PELLET_COUNT);

const verticalDirections = getBlazeScrapshotPelletDirections({ x: 0, y: 1, z: 0 });
assert.equal(verticalDirections.length, BLAZE_SCRAPSHOT_PELLET_COUNT);
assert.ok(verticalDirections.every((direction) => Number.isFinite(direction.x + direction.y + direction.z)));

console.log('blaze scrapshot tests passed');
