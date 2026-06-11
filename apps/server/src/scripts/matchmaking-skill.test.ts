import assert from 'node:assert/strict';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  calculateMatchmakingRating,
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from '../matchmaking/skill';
import { createMatchmakingTicket, verifyMatchmakingTicket } from '../security/matchmakingTickets';
import { getRankDivisionIndex } from '@voxel-strike/shared';

process.env.ENTRY_TICKET_SECRET = process.env.ENTRY_TICKET_SECRET || 'matchmaking-skill-test-secret';

assert.equal(calculateMatchmakingRating(null), DEFAULT_MATCHMAKING_RATING);
assert.equal(DEFAULT_RANK_DIVISION_INDEX, getRankDivisionIndex(DEFAULT_MATCHMAKING_RATING));
assert.equal(getRankDivisionLabel(DEFAULT_RANK_DIVISION_INDEX), 'Bronze 1');

const newPlayer = calculateMatchmakingRating({
  totalGames: 1,
  totalWins: 0,
  totalKills: 0,
  totalDeaths: 4,
  totalAssists: 0,
  totalCaptures: 0,
  totalFlagReturns: 0,
  totalScore: 100,
});
const strongPlayer = calculateMatchmakingRating({
  totalGames: 35,
  totalWins: 25,
  totalKills: 420,
  totalDeaths: 160,
  totalAssists: 120,
  totalCaptures: 25,
  totalFlagReturns: 40,
  totalScore: 52000,
});

assert.ok(newPlayer < DEFAULT_MATCHMAKING_RATING, `expected new player rating below default, got ${newPlayer}`);
assert.ok(strongPlayer > 1300, `expected strong player rating above Gold 3 threshold, got ${strongPlayer}`);

assert.equal(normalizeRankDivisionIndex(99), 23);
assert.equal(normalizeRankDivisionIndex('not-real'), DEFAULT_RANK_DIVISION_INDEX);
assert.equal(getAllowedRankDivisionDistance(0), 2);
assert.equal(getAllowedRankDivisionDistance(30_000), 2);
assert.equal(getAllowedRankDivisionDistance(90_000), 6);

const { ticket, claims } = createMatchmakingTicket({
  mode: 'quick_play',
  userId: 'user_1',
  competitiveRating: strongPlayer,
  rankDivisionIndex: getRankDivisionIndex(strongPlayer),
  targetRankDivisionIndex: getRankDivisionIndex(1300),
  placementRemaining: 0,
});

const verified = verifyMatchmakingTicket(ticket, claims.issuedAt + 1);
assert.ok(verified);
assert.equal(verified.userId, 'user_1');
assert.equal(verified.version, 2);
assert.equal(verified.mode, 'quick_play');
assert.equal(verified.competitiveRating, strongPlayer);
assert.equal(verified.targetRankDivisionIndex, getRankDivisionIndex(1300));

assert.equal(verifyMatchmakingTicket(`${ticket.slice(0, -1)}x`, claims.issuedAt + 1), null);
assert.equal(verifyMatchmakingTicket(ticket, claims.expiresAt + 1), null);

const ranked = createMatchmakingTicket({
  mode: 'ranked',
  userId: 'user_ranked',
  competitiveRating: strongPlayer,
  rankDivisionIndex: getRankDivisionIndex(strongPlayer),
  targetRankDivisionIndex: getRankDivisionIndex(strongPlayer),
  placementRemaining: 0,
  rankedEntryQuoteId: 'quote_1',
  coverChargeLamports: '33000000',
  rankedEntryQuoteExpiresAt: claims.issuedAt + 60_000,
});
const rankedVerified = verifyMatchmakingTicket(ranked.ticket, ranked.claims.issuedAt + 1);
assert.ok(rankedVerified);
assert.equal(rankedVerified.mode, 'ranked');
assert.equal(rankedVerified.rankedEntryQuoteId, 'quote_1');
assert.equal(rankedVerified.coverChargeLamports, '33000000');

console.log('matchmaking skill tests passed');
