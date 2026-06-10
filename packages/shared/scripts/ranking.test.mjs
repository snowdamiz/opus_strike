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
  ['Plastic 1', 600],
  ['Plastic 2', 650],
  ['Plastic 3', 700],
  ['Plastic 4', 750],
  ['Bronze 1', 800],
  ['Bronze 2', 850],
  ['Bronze 3', 900],
  ['Bronze 4', 950],
  ['Silver 1', 1000],
  ['Silver 2', 1050],
  ['Silver 3', 1100],
  ['Silver 4', 1150],
  ['Gold 1', 1200],
  ['Gold 2', 1250],
  ['Gold 3', 1300],
  ['Gold 4', 1350],
  ['Diamond 1', 1400],
  ['Diamond 2', 1450],
  ['Diamond 3', 1500],
  ['Diamond 4', 1550],
  ['Unemployed 1', 1600],
  ['Unemployed 2', 1650],
  ['Unemployed 3', 1700],
  ['Unemployed 4', 1750],
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

assert.equal(getRankFromRating(599, RANK_PLACEMENT_MATCHES).label, 'Plastic 1');
assert.equal(getRankFromRating(600, RANK_PLACEMENT_MATCHES).label, 'Plastic 1');
assert.equal(getRankFromRating(649, RANK_PLACEMENT_MATCHES).label, 'Plastic 1');
assert.equal(getRankFromRating(650, RANK_PLACEMENT_MATCHES).label, 'Plastic 2');
assert.equal(getRankFromRating(1749, RANK_PLACEMENT_MATCHES).label, 'Unemployed 3');
assert.equal(getRankFromRating(1750, RANK_PLACEMENT_MATCHES).label, 'Unemployed 4');
assert.equal(getRankFromRating(2200, RANK_PLACEMENT_MATCHES).label, 'Unemployed 4');

const starterRank = getRankFromRating(DEFAULT_COMPETITIVE_RATING, 0);
assert.equal(starterRank.label, 'Bronze 1');
assert.equal(starterRank.isRanked, true);
assert.equal(starterRank.placementRemaining, 0);

const zeroGameRank = getRankFromRating(1300, 0);
assert.equal(zeroGameRank.label, 'Gold 3');
assert.equal(zeroGameRank.isRanked, true);
assert.equal(zeroGameRank.placementRemaining, 0);
assert.equal(getRankDivisionIndex(1300), 14);

const progress = getRankProgress(1225);
assert.equal(progress.currentDivisionFloor, 1200);
assert.equal(progress.nextDivisionFloor, 1250);
assert.equal(progress.progress, 0.5);

const topProgress = getRankProgress(1810);
assert.equal(topProgress.currentDivisionFloor, 1750);
assert.equal(topProgress.nextDivisionFloor, null);
assert.equal(topProgress.progress, 1);
assert.equal(topProgress.excessRating, 60);

assert.equal(getRankTheme('unranked').primary, '#94a3b8');
assert.equal(getRankTheme('gold').primary, '#f5c542');

console.log('ranking tests passed');
