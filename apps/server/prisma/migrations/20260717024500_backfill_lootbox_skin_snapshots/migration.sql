-- Freeze the catalog used by intents created before quotedSkinIds existed.
-- This is an additive backfill; no intent or reward history is removed.
UPDATE "LootboxOpenIntent"
SET "quotedSkinIds" = to_jsonb(ARRAY[
  'phantom.void-monarch',
  'phantom.nightglass-wraith',
  'phantom.astral-executioner',
  'phantom.eclipse-seraph',
  'phantom.umbral-reaver',
  'phantom.obsidian-revenant',
  'phantom.static-wraith',
  'phantom.crimson-lotus',
  'hookshot.tidebreaker',
  'hookshot.iron-leviathan',
  'hookshot.abyssal-corsair',
  'hookshot.kraken-sovereign',
  'hookshot.coral-warden',
  'hookshot.maelstrom-warlord',
  'hookshot.glacier-breaker',
  'hookshot.void-angler',
  'blaze.solar-forge',
  'blaze.ashen-vanguard',
  'blaze.inferno-archon',
  'blaze.starfall-phoenix',
  'blaze.cinder-warden',
  'blaze.pyre-tyrant',
  'blaze.frostfire-herald',
  'blaze.ember-drake',
  'chronos.epoch-regent',
  'chronos.paradox-sentinel',
  'chronos.meridian-oracle',
  'chronos.eternity-sovereign',
  'chronos.clockwork-marshal',
  'chronos.quantum-arbiter',
  'chronos.dune-prophet',
  'chronos.zodiac-weaver'
]::text[])
WHERE "quotedSkinIds" = '[]'::jsonb;
