import assert from 'node:assert/strict';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from '../matchmaking/skill';
import {
  RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS,
  getRankedTokenHoldRuntimeConfig,
} from '../matchmaking/rankedTokenHold';
import { createMatchmakingTicket, verifyMatchmakingTicket } from '../security/matchmakingTickets';
import { getRankDivisionIndex } from '@voxel-strike/shared';

process.env.ENTRY_TICKET_SECRET = process.env.ENTRY_TICKET_SECRET || 'matchmaking-skill-test-secret';

function withEnvValue<T>(name: string, value: string | undefined, fn: () => T): T {
  const original = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  }
}

assert.equal(
  withEnvValue('RANKED_TOKEN_HOLD_TOKEN_ADDRESS', undefined, () => getRankedTokenHoldRuntimeConfig().tokenAddress),
  RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS
);
assert.equal(
  withEnvValue('RANKED_TOKEN_HOLD_TOKEN_SYMBOL', undefined, () => getRankedTokenHoldRuntimeConfig().tokenSymbol),
  'SOL'
);
assert.equal(
  withEnvValue('RANKED_TOKEN_HOLD_TOKEN_SYMBOL', '$slop', () => getRankedTokenHoldRuntimeConfig().tokenSymbol),
  'SLOP'
);
assert.throws(
  () => withEnvValue('RANKED_TOKEN_HOLD_TOKEN_SYMBOL', 'too-long-symbol', () => getRankedTokenHoldRuntimeConfig()),
  /RANKED_TOKEN_HOLD_TOKEN_SYMBOL must be 1-12 letters or numbers/
);
assert.equal(
  withEnvValue('RANKED_TOKEN_HOLD_TOKEN_ADDRESS', RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS, () => getRankedTokenHoldRuntimeConfig().tokenAddress),
  RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS
);
assert.equal(
  withEnvValue('RANKED_TOKEN_HOLD_TOKEN_ADDRESS', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', () => getRankedTokenHoldRuntimeConfig().tokenAddress),
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
);
assert.throws(
  () => withEnvValue('RANKED_TOKEN_HOLD_TOKEN_ADDRESS', 'not-a-token-address', () => getRankedTokenHoldRuntimeConfig()),
  /RANKED_TOKEN_HOLD_TOKEN_ADDRESS must be a valid Solana token address/
);

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
  rankedTokenAddress: RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS,
  rankedTokenDecimals: 9,
  rankedTokenHoldUsdCents: 2000,
  rankedTokenRequiredBaseUnits: '120000000',
  rankedTokenBalanceBaseUnits: '140000000',
  rankedTokenCheckedAt: claims.issuedAt,
});
const rankedVerified = verifyMatchmakingTicket(ranked.ticket, ranked.claims.issuedAt + 1);
assert.ok(rankedVerified);
assert.equal(rankedVerified.mode, 'ranked');
assert.equal(rankedVerified.rankedEntryQuoteId, undefined);
assert.equal(rankedVerified.coverChargeLamports, undefined);
assert.equal(rankedVerified.rankedTokenAddress, RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS);
assert.equal(rankedVerified.rankedTokenDecimals, 9);
assert.equal(rankedVerified.rankedTokenHoldUsdCents, 2000);
assert.equal(rankedVerified.rankedTokenRequiredBaseUnits, '120000000');
assert.equal(rankedVerified.rankedTokenBalanceBaseUnits, '140000000');

console.log('matchmaking skill tests passed');
