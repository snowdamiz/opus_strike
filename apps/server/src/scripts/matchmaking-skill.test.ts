import assert from 'node:assert/strict';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from '../matchmaking/skill';
import { createMatchmakingTicket, verifyMatchmakingTicket } from '../security/matchmakingTickets';
import { getRankDivisionIndex } from '@voxel-strike/shared';

process.env.ENTRY_TICKET_SECRET = process.env.ENTRY_TICKET_SECRET || 'matchmaking-skill-test-secret';

const RANKED_TEST_SPL_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

assert.equal(DEFAULT_RANK_DIVISION_INDEX, getRankDivisionIndex(DEFAULT_MATCHMAKING_RATING));
assert.equal(getRankDivisionLabel(DEFAULT_RANK_DIVISION_INDEX), 'Bronze 1');

assert.equal(normalizeRankDivisionIndex(99), 23);
assert.equal(normalizeRankDivisionIndex('not-real'), DEFAULT_RANK_DIVISION_INDEX);
assert.equal(getAllowedRankDivisionDistance(0), 2);
assert.equal(getAllowedRankDivisionDistance(30_000), 2);
assert.equal(getAllowedRankDivisionDistance(90_000), 6);

const strongPlayer = 1450;
const { ticket, claims } = createMatchmakingTicket({
  mode: 'quick_play',
  gameplayMode: 'battle_royal',
  botFillMode: 'fill_even',
  matchPerspective: 'third_person',
  selectedHero: 'phantom',
  matchmakingRegion: 'LHR',
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
assert.equal(verified.gameplayMode, 'battle_royal');
assert.equal(verified.botFillMode, 'fill_even');
assert.equal(verified.matchPerspective, 'third_person');
assert.equal(verified.selectedHero, 'phantom');
assert.equal(verified.matchmakingRegion, 'lhr');
assert.equal(verified.competitiveRating, strongPlayer);
assert.equal(verified.targetRankDivisionIndex, getRankDivisionIndex(1300));

assert.equal(verifyMatchmakingTicket(`${ticket.slice(0, -1)}x`, claims.issuedAt + 1), null);
assert.equal(verifyMatchmakingTicket(ticket, claims.expiresAt + 1), null);

const ranked = createMatchmakingTicket({
  mode: 'ranked',
  selectedHero: 'chronos',
  userId: 'user_ranked',
  competitiveRating: strongPlayer,
  rankDivisionIndex: getRankDivisionIndex(strongPlayer),
  targetRankDivisionIndex: getRankDivisionIndex(strongPlayer),
  placementRemaining: 0,
  rankedTokenAddress: RANKED_TEST_SPL_MINT,
  rankedTokenDecimals: 6,
  rankedTokenRequiredBaseUnits: '120000000',
  rankedTokenBalanceBaseUnits: '140000000',
  rankedTokenCheckedAt: claims.issuedAt,
});
const rankedVerified = verifyMatchmakingTicket(ranked.ticket, ranked.claims.issuedAt + 1);
assert.ok(rankedVerified);
assert.equal(rankedVerified.mode, 'ranked');
assert.equal(rankedVerified.gameplayMode, 'capture_the_flag');
assert.equal(rankedVerified.botFillMode, 'manual');
assert.equal(rankedVerified.matchPerspective, 'first_person');
assert.equal(rankedVerified.selectedHero, 'chronos');
assert.equal(rankedVerified.rankedTokenAddress, RANKED_TEST_SPL_MINT);
assert.equal(rankedVerified.rankedTokenDecimals, 6);
assert.equal(rankedVerified.rankedTokenRequiredBaseUnits, '120000000');
assert.equal(rankedVerified.rankedTokenBalanceBaseUnits, '140000000');

console.log('matchmaking skill tests passed');
