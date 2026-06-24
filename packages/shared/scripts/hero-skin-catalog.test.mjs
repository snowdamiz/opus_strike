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

assert.equal(HERO_SKIN_CATALOG.length, 5);
assert.equal(isHeroSkinId('phantom.void-monarch'), true);
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

const voidMonarch = HERO_SKIN_CATALOG.find((skin) => skin.id === 'phantom.void-monarch');
assert.ok(voidMonarch);
assert.equal(voidMonarch.availability, 'paid');
assert.equal(voidMonarch.releaseState, 'ready_when_token_launches');
assert.equal(voidMonarch.price.amountBaseUnits, null);
assert.equal(voidMonarch.price.disabledReason, 'Game SPL token has not launched yet');

const matched = resolveHeroSkinDefinition('phantom', 'phantom.void-monarch', {
  ownedSkinIds: new Set(['phantom.void-monarch']),
});
assert.equal(matched.skin.id, 'phantom.void-monarch');
assert.equal(matched.fallback, false);

const locked = resolveHeroSkinDefinition('phantom', 'phantom.void-monarch', {
  ownedSkinIds: new Set(),
});
assert.equal(locked.skin.id, 'phantom.default');
assert.equal(locked.fallback, true);
assert.equal(locked.fallbackReason, 'locked');

const mismatched = resolveHeroSkinDefinition('blaze', 'phantom.void-monarch');
assert.equal(mismatched.skin.id, 'blaze.default');
assert.equal(mismatched.fallbackReason, 'hero_mismatch');

const unknown = resolveHeroSkinDefinition('phantom', 'phantom.unknown');
assert.equal(unknown.skin.id, 'phantom.default');
assert.equal(unknown.fallbackReason, 'unknown_skin');

console.log('hero skin catalog tests passed');
