import assert from 'node:assert/strict';
import {
  calculateMatchmakingRating,
  getAllowedBucketDistance,
  getSkillBucket,
  normalizeSkillBucket,
} from '../matchmaking/skill';
import { createMatchmakingTicket, verifyMatchmakingTicket } from '../security/matchmakingTickets';

process.env.ENTRY_TICKET_SECRET = process.env.ENTRY_TICKET_SECRET || 'matchmaking-skill-test-secret';

assert.equal(calculateMatchmakingRating(null), 1000);
assert.equal(getSkillBucket(calculateMatchmakingRating(null)).id, 'contender');

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

assert.ok(newPlayer < 1000, `expected new player rating below default, got ${newPlayer}`);
assert.ok(strongPlayer > 1300, `expected strong player rating above veteran threshold, got ${strongPlayer}`);

assert.equal(normalizeSkillBucket('elite'), 'elite');
assert.equal(normalizeSkillBucket('not-real'), 'contender');
assert.equal(getAllowedBucketDistance(0), 0);
assert.equal(getAllowedBucketDistance(30_000), 1);
assert.equal(getAllowedBucketDistance(90_000), 2);

const { ticket, claims } = createMatchmakingTicket({
  userId: 'user_1',
  skillRating: strongPlayer,
  skillBucket: getSkillBucket(strongPlayer).id,
  targetSkillBucket: 'veteran',
});

const verified = verifyMatchmakingTicket(ticket, claims.issuedAt + 1);
assert.ok(verified);
assert.equal(verified.userId, 'user_1');
assert.equal(verified.skillRating, strongPlayer);
assert.equal(verified.targetSkillBucket, 'veteran');

assert.equal(verifyMatchmakingTicket(`${ticket.slice(0, -1)}x`, claims.issuedAt + 1), null);
assert.equal(verifyMatchmakingTicket(ticket, claims.expiresAt + 1), null);

console.log('matchmaking skill tests passed');
