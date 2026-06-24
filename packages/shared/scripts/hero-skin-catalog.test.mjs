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

const paidSkinIdsByHero = {
  phantom: [
    'phantom.void-monarch',
    'phantom.nightglass-wraith',
    'phantom.astral-executioner',
    'phantom.eclipse-seraph',
  ],
  hookshot: [
    'hookshot.tidebreaker',
    'hookshot.iron-leviathan',
    'hookshot.abyssal-corsair',
    'hookshot.kraken-sovereign',
  ],
  blaze: [
    'blaze.solar-forge',
    'blaze.ashen-vanguard',
    'blaze.inferno-archon',
    'blaze.starfall-phoenix',
  ],
  chronos: [
    'chronos.epoch-regent',
    'chronos.paradox-sentinel',
    'chronos.meridian-oracle',
    'chronos.eternity-sovereign',
  ],
};
const paidSkinIds = Object.values(paidSkinIdsByHero).flat();

assert.equal(HERO_SKIN_CATALOG.length, 20);
for (const skinId of paidSkinIds) {
  assert.equal(isHeroSkinId(skinId), true, `${skinId} should be a known skin id`);
}
assert.equal(isHeroSkinId('Phantom.Void Monarch'), false);

for (const heroId of ALL_HERO_IDS) {
  const defaultSkinId = getDefaultHeroSkinId(heroId);
  assert.equal(defaultSkinId, DEFAULT_HERO_SKIN_IDS[heroId]);

  const skins = getHeroSkinsForHero(heroId);
  assert.equal(skins.length, 5, `${heroId} should expose one default and four paid skins`);
  assert.equal(
    skins.filter((skin) => skin.id === defaultSkinId).length,
    1,
    `${heroId} should expose exactly one default skin`
  );
  assert.deepEqual(
    skins.filter((skin) => skin.availability === 'paid').map((skin) => skin.id).sort(),
    [...paidSkinIdsByHero[heroId]].sort(),
    `${heroId} paid skins should match the expected catalog`
  );
  assert.equal(skins.filter((skin) => skin.rarity === 'common').length, 1, `${heroId} should have one common skin`);
  assert.equal(skins.filter((skin) => skin.rarity === 'epic').length, 2, `${heroId} should have two epic skins`);
  assert.equal(skins.filter((skin) => skin.rarity === 'unique').length, 1, `${heroId} should have one unique skin`);
  assert.equal(skins.filter((skin) => skin.rarity === 'legendary').length, 1, `${heroId} should have one legendary skin`);
}

for (const skinId of paidSkinIds) {
  const skin = HERO_SKIN_CATALOG.find((catalogSkin) => catalogSkin.id === skinId);
  assert.ok(skin, `${skinId} should be in the catalog`);
  assert.equal(skin.availability, 'paid');
  assert.equal(skin.releaseState, 'ready_when_token_launches');
  assert.equal(skin.price.amountBaseUnits, null);
  assert.equal(skin.price.disabledReason, 'Disabled');
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
