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
    'phantom.umbral-reaver',
    'phantom.obsidian-revenant',
  ],
  hookshot: [
    'hookshot.tidebreaker',
    'hookshot.iron-leviathan',
    'hookshot.abyssal-corsair',
    'hookshot.kraken-sovereign',
    'hookshot.coral-warden',
    'hookshot.maelstrom-warlord',
  ],
  blaze: [
    'blaze.solar-forge',
    'blaze.ashen-vanguard',
    'blaze.inferno-archon',
    'blaze.starfall-phoenix',
    'blaze.cinder-warden',
    'blaze.pyre-tyrant',
  ],
  chronos: [
    'chronos.epoch-regent',
    'chronos.paradox-sentinel',
    'chronos.meridian-oracle',
    'chronos.eternity-sovereign',
    'chronos.clockwork-marshal',
    'chronos.quantum-arbiter',
  ],
};
const paidSkinIds = Object.values(paidSkinIdsByHero).flat();
const founderSkinIdsByHero = {
  phantom: ['phantom.golden'],
  hookshot: ['hookshot.golden'],
  blaze: ['blaze.golden'],
  chronos: ['chronos.golden'],
};
const founderSkinIds = Object.values(founderSkinIdsByHero).flat();
const independenceSkinIdsByHero = {
  phantom: ['phantom.liberty-wraith'],
  hookshot: ['hookshot.liberty-anchor'],
  blaze: ['blaze.liberty-flare'],
  chronos: ['chronos.liberty-sentinel'],
};
const independenceSkinIds = Object.values(independenceSkinIdsByHero).flat();

assert.equal(HERO_SKIN_CATALOG.length, 36);
for (const skinId of [...paidSkinIds, ...independenceSkinIds, ...founderSkinIds]) {
  assert.equal(isHeroSkinId(skinId), true, `${skinId} should be a known skin id`);
}
assert.equal(isHeroSkinId('Phantom.Void Monarch'), false);

for (const heroId of ALL_HERO_IDS) {
  const defaultSkinId = getDefaultHeroSkinId(heroId);
  assert.equal(defaultSkinId, DEFAULT_HERO_SKIN_IDS[heroId]);

  const skins = getHeroSkinsForHero(heroId);
  assert.equal(skins.length, 9, `${heroId} should expose one default, six paid skins, one Independence skin, and one founder skin`);
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
  assert.deepEqual(
    skins.filter((skin) => skin.availability === 'unlockable').map((skin) => skin.id).sort(),
    [...independenceSkinIdsByHero[heroId], ...founderSkinIdsByHero[heroId]].sort(),
    `${heroId} unlockable skins should match the expected catalog`
  );
  assert.equal(skins.filter((skin) => skin.rarity === 'common').length, 1, `${heroId} should have one common skin`);
  assert.equal(skins.filter((skin) => skin.rarity === 'epic').length, 3, `${heroId} should have three epic skins`);
  assert.equal(skins.filter((skin) => skin.rarity === 'unique').length, 3, `${heroId} should have three unique skins`);
  assert.equal(skins.filter((skin) => skin.rarity === 'legendary').length, 2, `${heroId} should have two legendary skins`);
}

for (const skinId of paidSkinIds) {
  const skin = HERO_SKIN_CATALOG.find((catalogSkin) => catalogSkin.id === skinId);
  assert.ok(skin, `${skinId} should be in the catalog`);
  assert.equal(skin.availability, 'paid');
  assert.equal(skin.releaseState, 'ready_when_token_launches');
  assert.equal(skin.price.amountBaseUnits, null);
  assert.equal(skin.price.disabledReason, 'Disabled');
}

for (const skinId of independenceSkinIds) {
  const skin = HERO_SKIN_CATALOG.find((catalogSkin) => catalogSkin.id === skinId);
  assert.ok(skin, `${skinId} should be in the catalog`);
  assert.equal(skin.availability, 'unlockable');
  assert.equal(skin.releaseState, 'live');
  assert.equal(skin.unlockHint, 'Independence Day admin grant');
}

for (const skinId of founderSkinIds) {
  const skin = HERO_SKIN_CATALOG.find((catalogSkin) => catalogSkin.id === skinId);
  assert.ok(skin, `${skinId} should be in the catalog`);
  assert.equal(skin.availability, 'unlockable');
  assert.equal(skin.releaseState, 'live');
  assert.equal(skin.unlockHint, 'First 50 ranked BR winners');
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

for (const skinId of [...independenceSkinIds, ...founderSkinIds]) {
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
