import assert from 'node:assert/strict';
import {
  PLAYER_SCORE_VALUES,
  calculateParticipantScore,
  getMatchOutcome,
  normalizeMatchParticipants,
} from '../persistence/matchPersistence';
import type { MatchParticipantSnapshot } from '../persistence/matchPersistence';

const joinedAt = new Date('2026-06-10T10:00:00.000Z');
const rejoinedAt = new Date('2026-06-10T10:05:00.000Z');

const baseParticipant: MatchParticipantSnapshot = {
  userId: 'user_red',
  playerSessionId: 'session_red_1',
  displayName: 'Red Player',
  team: 'red',
  heroId: 'phantom',
  kills: 2,
  deaths: 1,
  assists: 3,
  flagCaptures: 1,
  flagReturns: 2,
  joinedAt,
  leftAt: null,
};

assert.equal(
  calculateParticipantScore(baseParticipant),
  2 * PLAYER_SCORE_VALUES.kill
    + 3 * PLAYER_SCORE_VALUES.assist
    + PLAYER_SCORE_VALUES.flagCapture
    + 2 * PLAYER_SCORE_VALUES.flagReturn
);

assert.equal(getMatchOutcome('red', 'red'), 'win');
assert.equal(getMatchOutcome('blue', 'red'), 'loss');
assert.equal(getMatchOutcome('blue', null), 'draw');

const normalized = normalizeMatchParticipants([
  baseParticipant,
  {
    ...baseParticipant,
    playerSessionId: 'session_red_2',
    displayName: 'Red Player Reconnected',
    heroId: 'blaze',
    kills: 1,
    deaths: 0,
    assists: 1,
    flagCaptures: 0,
    flagReturns: 0,
    joinedAt: rejoinedAt,
    leftAt: new Date('2026-06-10T10:08:00.000Z'),
  },
  {
    ...baseParticipant,
    userId: 'user_blue',
    playerSessionId: 'session_blue',
    displayName: 'Blue Player',
    team: 'blue',
    heroId: 'hookshot',
    kills: 4,
    deaths: 2,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 1,
  },
], 'red');

assert.equal(normalized.length, 2);

const red = normalized.find((participant) => participant.userId === 'user_red');
assert.ok(red);
assert.equal(red.playerSessionId, 'session_red_2');
assert.equal(red.displayName, 'Red Player Reconnected');
assert.equal(red.heroId, 'blaze');
assert.equal(red.kills, 3);
assert.equal(red.deaths, 1);
assert.equal(red.assists, 4);
assert.equal(red.flagCaptures, 1);
assert.equal(red.flagReturns, 2);
assert.equal(red.outcome, 'win');
assert.equal(red.joinedAt, joinedAt);
assert.equal(red.leftAt?.toISOString(), '2026-06-10T10:08:00.000Z');

const blue = normalized.find((participant) => participant.userId === 'user_blue');
assert.ok(blue);
assert.equal(blue.outcome, 'loss');
assert.equal(blue.score, calculateParticipantScore(blue));

console.log('match-persistence tests passed');
