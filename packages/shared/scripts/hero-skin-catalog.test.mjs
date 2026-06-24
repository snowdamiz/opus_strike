import assert from 'node:assert/strict';
import {
  ALL_HERO_IDS,
  DEFAULT_HERO_SKIN_IDS,
  HERO_SKIN_CATALOG,
  getDefaultHeroSkinId,
  getHeroSkinsForHero,
  isHeroSkinId,
  resolveHeroSkinDefinition,
  validateHeroSkinCatalog,
} from '../dist/index.js';

const validation = validateHeroSkinCatalog();
assert.deepEqual(validation.errors, []);
assert.equal(validation.ok, true);

const paidSkinIds = [
  'phantom.void-monarch',
  'hookshot.tidebreaker',
  'blaze.solar-forge',
  'chronos.epoch-regent',
];

assert.equal(HERO_SKIN_CATALOG.length, 8);
for (const skinId of paidSkinIds) {
  assert.equal(isHeroSkinId(skinId), true, `${skinId} should be a known skin id`);
}
assert.equal(isHeroSkinId('Phantom.Void Monarch'), false);

for (const heroId of ALL_HERO_IDS) {
  const defaultSkinId = getDefaultHeroSkinId(heroId);
  assert.equal(defaultSkinId, DEFAULT_HERO_SKIN_IDS[heroId]);

  const skins = getHeroSkinsForHero(heroId);
  assert.equal(
    skins.filter((skin) => skin.id === defaultSkinId).length,
    1,
    `${heroId} should expose exactly one default skin`
  );
}

for (const skinId of paidSkinIds) {
  const skin = HERO_SKIN_CATALOG.find((catalogSkin) => catalogSkin.id === skinId);
  assert.ok(skin, `${skinId} should be in the catalog`);
  assert.equal(skin.availability, 'paid');
  assert.equal(skin.releaseState, 'ready_when_token_launches');
  assert.equal(skin.price.amountBaseUnits, null);
  assert.equal(skin.price.disabledReason, 'Game SPL token has not launched yet');
}

const matched = resolveHeroSkinDefinition('phantom', 'phantom.void-monarch', {
  ownedSkinIds: new Set(['phantom.void-monarch']),
});
assert.equal(matched.skin.id, 'phantom.void-monarch');
assert.equal(matched.fallback, false);

for (const skinId of paidSkinIds) {
  const skin = HERO_SKIN_CATALOG.find((catalogSkin) => catalogSkin.id === skinId);
  const locked = resolveHeroSkinDefinition(skin.heroId, skinId, {
    ownedSkinIds: new Set(),
  });
  assert.equal(locked.skin.id, DEFAULT_HERO_SKIN_IDS[skin.heroId]);
  assert.equal(locked.fallback, true);
  assert.equal(locked.fallbackReason, 'locked');
}

const mismatched = resolveHeroSkinDefinition('blaze', 'phantom.void-monarch');
assert.equal(mismatched.skin.id, 'blaze.default');
assert.equal(mismatched.fallbackReason, 'hero_mismatch');

const unknown = resolveHeroSkinDefinition('phantom', 'phantom.unknown');
assert.equal(unknown.skin.id, 'phantom.default');
assert.equal(unknown.fallbackReason, 'unknown_skin');

console.log('hero skin catalog tests passed');
