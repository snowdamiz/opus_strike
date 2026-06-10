import assert from 'node:assert/strict';
import { calculateRankedRatingUpdates, MATCH_DELTA_MAX, MATCH_DELTA_MIN } from '../ranking/ratingService';
import type { RankedMatchParticipant, RankedUserState } from '../ranking/ratingService';

const endedAt = new Date('2026-06-10T12:00:00.000Z');

function user(id: string, rating: number, rankedGames = 0): RankedUserState {
  return {
    id,
    competitiveRating: rating,
    rankedGames,
    rankedWins: 0,
    rankedLosses: 0,
    rankedDraws: 0,
    rankedPlacementsRemaining: 0,
    rankedPeakRating: rating,
  };
}

function participant(
  userId: string,
  team: 'red' | 'blue',
  outcome: 'win' | 'loss' | 'draw',
  score: number,
  leftAt: Date | null = null
): RankedMatchParticipant {
  return {
    userId,
    team,
    outcome,
    score,
    kills: Math.max(0, Math.floor(score / 300)),
    deaths: outcome === 'loss' ? 4 : 1,
    assists: 2,
    flagCaptures: outcome === 'win' ? 1 : 0,
    flagReturns: score > 500 ? 1 : 0,
    leftAt,
  };
}

const balancedUpdates = calculateRankedRatingUpdates({
  endedAt,
  winningTeam: 'red',
  users: [
    user('red_1', 800, 4),
    user('red_2', 800, 10),
    user('blue_1', 800, 10),
    user('blue_2', 800, 10),
  ],
  participants: [
    participant('red_1', 'red', 'win', 900),
    participant('red_2', 'red', 'win', 600),
    participant('blue_1', 'blue', 'loss', 600),
    participant('blue_2', 'blue', 'loss', 500),
  ],
});

const starterWin = balancedUpdates.find((update) => update.userId === 'red_1');
assert.ok(starterWin);
assert.ok(starterWin.ratingDelta >= 0);
assert.equal(starterWin.visibleRankBefore, 'Bronze 1');
assert.notEqual(starterWin.visibleRankAfter, 'Unranked');
assert.equal(starterWin.rankedPlacementsRemainingAfter, 0);

const loss = balancedUpdates.find((update) => update.userId === 'blue_1');
assert.ok(loss);
assert.ok(loss.ratingDelta <= 0);

const leaverUpdates = calculateRankedRatingUpdates({
  endedAt,
  winningTeam: 'red',
  users: [user('leaver', 1200, 12), user('blue', 1200, 12)],
  participants: [
    participant('leaver', 'red', 'win', 1200, new Date('2026-06-10T11:50:00.000Z')),
    participant('blue', 'blue', 'loss', 700),
  ],
});

const leaver = leaverUpdates.find((update) => update.userId === 'leaver');
assert.ok(leaver);
assert.equal(leaver.leaverPenaltyApplied, true);
assert.ok(leaver.ratingDelta <= 0);

const topTierUpdates = calculateRankedRatingUpdates({
  endedAt,
  winningTeam: 'red',
  users: [user('top', 1700, 70), user('challenger', 1700, 70)],
  participants: [
    participant('top', 'red', 'win', 1400),
    participant('challenger', 'blue', 'loss', 800),
  ],
});

const topTierWin = topTierUpdates.find((update) => update.userId === 'top');
assert.ok(topTierWin);
assert.ok(topTierWin.ratingDelta > 0 && topTierWin.ratingDelta <= 16);

for (const update of [...balancedUpdates, ...leaverUpdates, ...topTierUpdates]) {
  assert.ok(update.ratingDelta >= MATCH_DELTA_MIN);
  assert.ok(update.ratingDelta <= MATCH_DELTA_MAX);
}

console.log('ranking service tests passed');
