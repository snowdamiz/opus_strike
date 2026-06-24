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
assertMatched('Tidebreaker', 'hookshot.tidebreaker');
assertMatched('hookshot.tidebreaker', 'hookshot.tidebreaker');
assertMatched('Solar Forge', 'blaze.solar-forge');
assertMatched('solar-forge', 'blaze.solar-forge');
assertMatched('Epoch Regent', 'chronos.epoch-regent');
assertMatched('chronos.epoch-regent', 'chronos.epoch-regent');
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

console.log('game console skin command tests passed');
