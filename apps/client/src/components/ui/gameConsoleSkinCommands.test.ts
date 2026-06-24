import assert from 'node:assert/strict';
import {
  formatConsoleSkinLine,
  resolveConsoleSkinQuery,
} from './gameConsoleSkinCommands';
import type { HeroId } from '@voxel-strike/shared';

function assertMatched(query: string, expectedSkinId: string, heroId?: HeroId): void {
  const resolution = resolveConsoleSkinQuery(query, { heroId });
  assert.equal(resolution.status, 'matched');
  if (resolution.status !== 'matched') return;
  assert.equal(resolution.skin.id, expectedSkinId);
}

assertMatched('Void Monarch', 'phantom.void-monarch');
assertMatched('void-monarch', 'phantom.void-monarch');
assertMatched('phantom.void-monarch', 'phantom.void-monarch');
assertMatched('Nightglass Wraith', 'phantom.nightglass-wraith');
assertMatched('astral-executioner', 'phantom.astral-executioner');
assertMatched('Eclipse Seraph', 'phantom.eclipse-seraph');
assertMatched('Tidebreaker', 'hookshot.tidebreaker');
assertMatched('hookshot.tidebreaker', 'hookshot.tidebreaker');
assertMatched('Iron Leviathan', 'hookshot.iron-leviathan');
assertMatched('abyssal-corsair', 'hookshot.abyssal-corsair');
assertMatched('Kraken Sovereign', 'hookshot.kraken-sovereign');
assertMatched('Solar Forge', 'blaze.solar-forge');
assertMatched('solar-forge', 'blaze.solar-forge');
assertMatched('Ashen Vanguard', 'blaze.ashen-vanguard');
assertMatched('inferno-archon', 'blaze.inferno-archon');
assertMatched('Starfall Phoenix', 'blaze.starfall-phoenix');
assertMatched('Epoch Regent', 'chronos.epoch-regent');
assertMatched('chronos.epoch-regent', 'chronos.epoch-regent');
assertMatched('Paradox Sentinel', 'chronos.paradox-sentinel');
assertMatched('meridian-oracle', 'chronos.meridian-oracle');
assertMatched('Eternity Sovereign', 'chronos.eternity-sovereign');
assertMatched('default', 'phantom.default', 'phantom');

const ambiguousDefault = resolveConsoleSkinQuery('default');
assert.equal(ambiguousDefault.status, 'ambiguous');
if (ambiguousDefault.status === 'ambiguous') {
  assert.ok(ambiguousDefault.matches.length > 1);
}

const missing = resolveConsoleSkinQuery('missing skin');
assert.equal(missing.status, 'not_found');

const voidMonarch = resolveConsoleSkinQuery('Void Monarch');
assert.equal(voidMonarch.status, 'matched');
if (voidMonarch.status !== 'matched') {
  throw new Error('expected Void Monarch to resolve');
}
const formatted = formatConsoleSkinLine(voidMonarch.skin);
assert.ok(formatted.includes('Void Monarch (phantom.void-monarch)'));
assert.ok(formatted.includes('epic, paid'));

const meridianOracle = resolveConsoleSkinQuery('Meridian Oracle');
assert.equal(meridianOracle.status, 'matched');
if (meridianOracle.status !== 'matched') {
  throw new Error('expected Meridian Oracle to resolve');
}
assert.ok(formatConsoleSkinLine(meridianOracle.skin).includes('unique, paid'));

const starfallPhoenix = resolveConsoleSkinQuery('Starfall Phoenix');
assert.equal(starfallPhoenix.status, 'matched');
if (starfallPhoenix.status !== 'matched') {
  throw new Error('expected Starfall Phoenix to resolve');
}
assert.ok(formatConsoleSkinLine(starfallPhoenix.skin).includes('legendary, paid'));

console.log('game console skin command tests passed');
