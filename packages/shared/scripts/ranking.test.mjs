import assert from 'node:assert/strict';
import {
  DEFAULT_COMPETITIVE_RATING,
  getRankDivisionIndex,
  getRankFromDivisionIndex,
  getRankFromRating,
  getRankProgress,
  getRankTheme,
  RANK_DEFINITIONS,
  RANK_PLACEMENT_MATCHES,
} from '../dist/index.js';

const expected = [
  ['Plastic 1', 400],
  ['Plastic 2', 500],
  ['Plastic 3', 600],
  ['Plastic 4', 700],
  ['Bronze 1', 800],
  ['Bronze 2', 900],
  ['Bronze 3', 1000],
  ['Bronze 4', 1100],
  ['Silver 1', 1200],
  ['Silver 2', 1300],
  ['Silver 3', 1400],
  ['Silver 4', 1500],
  ['Gold 1', 1600],
  ['Gold 2', 1700],
  ['Gold 3', 1800],
  ['Gold 4', 1900],
  ['Diamond 1', 2000],
  ['Diamond 2', 2100],
  ['Diamond 3', 2200],
  ['Diamond 4', 2300],
  ['Unemployed 1', 2400],
  ['Unemployed 2', 2500],
  ['Unemployed 3', 2600],
  ['Unemployed 4', 2700],
];

assert.equal(RANK_DEFINITIONS.length, 6);
assert.equal(RANK_PLACEMENT_MATCHES, 0);
assert.equal(DEFAULT_COMPETITIVE_RATING, 800);

for (const [index, [label, rating]] of expected.entries()) {
  const rank = getRankFromRating(rating, RANK_PLACEMENT_MATCHES);
  assert.equal(rank.label, label);
  assert.equal(rank.divisionIndex, index);
  assert.equal(getRankDivisionIndex(rating), index);
  assert.equal(getRankFromDivisionIndex(index).label, label);
}

for (let index = 1; index < expected.length; index++) {
  assert.equal(expected[index][1] - expected[index - 1][1], 100);
}

assert.equal(getRankFromRating(399, RANK_PLACEMENT_MATCHES).label, 'Plastic 1');
assert.equal(getRankFromRating(400, RANK_PLACEMENT_MATCHES).label, 'Plastic 1');
assert.equal(getRankFromRating(499, RANK_PLACEMENT_MATCHES).label, 'Plastic 1');
assert.equal(getRankFromRating(500, RANK_PLACEMENT_MATCHES).label, 'Plastic 2');
assert.equal(getRankFromRating(2699, RANK_PLACEMENT_MATCHES).label, 'Unemployed 3');
assert.equal(getRankFromRating(2700, RANK_PLACEMENT_MATCHES).label, 'Unemployed 4');
assert.equal(getRankFromRating(3500, RANK_PLACEMENT_MATCHES).label, 'Unemployed 4');

const starterRank = getRankFromRating(DEFAULT_COMPETITIVE_RATING, 0);
assert.equal(starterRank.label, 'Bronze 1');
assert.equal(starterRank.isRanked, true);
assert.equal(starterRank.placementRemaining, 0);

const zeroGameRank = getRankFromRating(1800, 0);
assert.equal(zeroGameRank.label, 'Gold 3');
assert.equal(zeroGameRank.isRanked, true);
assert.equal(zeroGameRank.placementRemaining, 0);
assert.equal(getRankDivisionIndex(1800), 14);

const progress = getRankProgress(1650);
assert.equal(progress.currentDivisionFloor, 1600);
assert.equal(progress.nextDivisionFloor, 1700);
assert.equal(progress.progress, 0.5);

const topProgress = getRankProgress(2810);
assert.equal(topProgress.currentDivisionFloor, 2700);
assert.equal(topProgress.nextDivisionFloor, null);
assert.equal(topProgress.progress, 1);
assert.equal(topProgress.excessRating, 110);

assert.equal(getRankTheme('unranked').primary, '#94a3b8');
assert.equal(getRankTheme('gold').primary, '#f5c542');

console.log('ranking tests passed');
