import assert from 'node:assert/strict';
import {
  PLAYER_SCORE_VALUES,
  calculateParticipantExperience,
  calculateParticipantScore,
  getMatchOutcome,
  normalizeMatchParticipants,
  persistCompletedMatch,
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
assert.equal(calculateParticipantExperience(baseParticipant, 'win'), 665);

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
assert.equal(
  red.experienceGained,
  calculateParticipantExperience(baseParticipant, 'win')
    + calculateParticipantExperience({
      kills: 1,
      deaths: 0,
      assists: 1,
      flagCaptures: 0,
      flagReturns: 0,
    }, 'win')
);
assert.equal(red.joinedAt, joinedAt);
assert.equal(red.leftAt?.toISOString(), '2026-06-10T10:08:00.000Z');

const blue = normalized.find((participant) => participant.userId === 'user_blue');
assert.ok(blue);
assert.equal(blue.outcome, 'loss');
assert.equal(blue.score, calculateParticipantScore(blue));

function createFakeUser(id: string) {
  return {
    id,
    name: id,
    competitiveRating: 800,
    rankedGames: 5,
    rankedWins: 2,
    rankedLosses: 2,
    rankedDraws: 1,
    rankedPlacementsRemaining: 0,
    rankedPeakRating: 800,
    totalGames: 0,
    totalWins: 0,
    totalLosses: 0,
    totalDraws: 0,
    totalKills: 0,
    totalDeaths: 0,
    totalAssists: 0,
    totalCaptures: 0,
    totalFlagReturns: 0,
    totalScore: 0,
    totalExperience: 0,
  };
}

function applyUpdate(target: Record<string, any>, update: Record<string, any>): void {
  for (const [key, value] of Object.entries(update)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      target[key] = (target[key] ?? 0) + value.increment;
    } else {
      target[key] = value;
    }
  }
}

function createFakePrisma() {
  const users = new Map<string, any>([
    ['ranked_red', createFakeUser('ranked_red')],
    ['ranked_blue', createFakeUser('ranked_blue')],
    ['unranked_red', createFakeUser('unranked_red')],
    ['unranked_blue', createFakeUser('unranked_blue')],
    ['custom_wager_red', createFakeUser('custom_wager_red')],
    ['custom_wager_blue', createFakeUser('custom_wager_blue')],
  ]);
  const matches = new Map<string, any>();
  const participants: any[] = [];
  const rankedSeasonStats = new Map<string, any>();
  const rankedSeasonSettings = {
    id: 'default',
    mode: 'season',
    seasonNumber: 1,
    endsAt: null,
    lastResetAt: null,
    updatedByUserId: null,
    updatedAt: new Date('2026-06-10T10:00:00.000Z'),
  };

  const tx = {
    gameMatch: {
      findUnique: async ({ where }: any) => matches.get(where.id) ?? null,
      create: async ({ data }: any) => {
        if (matches.has(data.id)) {
          const error = new Error('Unique constraint') as Error & { code: string };
          error.code = 'P2002';
          throw error;
        }
        matches.set(data.id, data);
        return data;
      },
    },
    gameMatchParticipant: {
      createMany: async ({ data }: any) => {
        participants.push(...data);
        return { count: data.length };
      },
    },
    user: {
      findMany: async ({ where, select }: any) => {
        return where.id.in
          .map((id: string) => users.get(id))
          .filter(Boolean)
          .map((user: any) => Object.fromEntries(
            Object.keys(select).map((key) => [key, user[key]])
          ));
      },
      update: async ({ where, data }: any) => {
        const user = users.get(where.id);
        assert.ok(user);
        applyUpdate(user, data);
        return user;
      },
    },
    rankedSeasonSettings: {
      upsert: async () => rankedSeasonSettings,
    },
    rankedSeasonUserStats: {
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.mode_seasonNumber_userId.mode}:${where.mode_seasonNumber_userId.seasonNumber}:${where.mode_seasonNumber_userId.userId}`;
        const existing = rankedSeasonStats.get(key);
        if (existing) {
          applyUpdate(existing, update);
          return existing;
        }
        const row = {
          id: key,
          ...create,
        };
        rankedSeasonStats.set(key, row);
        return row;
      },
    },
  };

  return {
    users,
    matches,
    participants,
    rankedSeasonStats,
    prisma: {
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
}

async function runPersistenceWriteTests() {
  const fake = createFakePrisma();
  const rankedResult = await persistCompletedMatch(fake.prisma as any, {
    matchId: 'ranked_match',
    roomId: 'room_ranked',
    lobbyId: 'lobby_ranked',
    matchMode: 'ranked',
    mapSeed: 123,
    rankedEligible: true,
    startedAt: joinedAt,
    endedAt: new Date('2026-06-10T10:20:00.000Z'),
    redScore: 3,
    blueScore: 1,
    winningTeam: 'red',
    participants: [
      { ...baseParticipant, userId: 'ranked_red', team: 'red', leftAt: null },
      { ...baseParticipant, userId: 'ranked_blue', team: 'blue', leftAt: new Date('2026-06-10T10:15:00.000Z') },
    ],
  });

  assert.equal(rankedResult.alreadyPersisted, false);
  assert.equal(fake.matches.get('ranked_match').rankedEligible, true);
  assert.equal(fake.matches.get('ranked_match').matchMode, 'ranked');
  assert.equal(fake.users.get('ranked_red').rankedGames, 6);
  assert.notEqual(fake.users.get('ranked_red').competitiveRating, 800);
  const rankedRedSeason = fake.rankedSeasonStats.get('season:1:ranked_red');
  assert.ok(rankedRedSeason);
  assert.equal(rankedRedSeason.rankedGames, 6);
  assert.equal(rankedRedSeason.totalGames, 6);
  assert.equal(rankedRedSeason.totalKills, baseParticipant.kills);
  assert.equal(rankedRedSeason.totalCaptures, baseParticipant.flagCaptures);
  const rankedParticipant = fake.participants.find((participant) => participant.userId === 'ranked_blue');
  assert.equal(rankedParticipant.rankedEligible, true);
  assert.equal(typeof rankedParticipant.ratingDelta, 'number');
  assert.equal(rankedParticipant.leaverPenaltyApplied, true);

  const duplicateResult = await persistCompletedMatch(fake.prisma as any, {
    matchId: 'ranked_match',
    roomId: 'room_ranked',
    lobbyId: 'lobby_ranked',
    matchMode: 'ranked',
    mapSeed: 123,
    rankedEligible: true,
    startedAt: joinedAt,
    endedAt: new Date('2026-06-10T10:20:00.000Z'),
    redScore: 3,
    blueScore: 1,
    winningTeam: 'red',
    participants: [
      { ...baseParticipant, userId: 'ranked_red', team: 'red', leftAt: null },
      { ...baseParticipant, userId: 'ranked_blue', team: 'blue', leftAt: null },
    ],
  });
  assert.equal(duplicateResult.alreadyPersisted, true);
  assert.equal(fake.users.get('ranked_red').rankedGames, 6);

  const unrankedBefore = fake.users.get('unranked_red').competitiveRating;
  await persistCompletedMatch(fake.prisma as any, {
    matchId: 'unranked_match',
    roomId: 'room_unranked',
    lobbyId: 'lobby_unranked',
    matchMode: 'quick_play',
    mapSeed: 456,
    rankedEligible: false,
    startedAt: joinedAt,
    endedAt: new Date('2026-06-10T10:20:00.000Z'),
    redScore: 1,
    blueScore: 1,
    winningTeam: null,
    participants: [
      { ...baseParticipant, userId: 'unranked_red', team: 'red', leftAt: null },
      { ...baseParticipant, userId: 'unranked_blue', team: 'blue', leftAt: null },
    ],
  });

  assert.equal(fake.matches.get('unranked_match').rankedEligible, false);
  assert.equal(fake.users.get('unranked_red').competitiveRating, unrankedBefore);
  assert.equal(fake.users.get('unranked_red').rankedGames, 5);
  assert.equal(fake.users.get('unranked_red').totalGames, 1);
  assert.equal(fake.rankedSeasonStats.has('season:1:unranked_red'), false);

  const customWagerBefore = fake.users.get('custom_wager_red').competitiveRating;
  await persistCompletedMatch(fake.prisma as any, {
    matchId: 'custom_wager_match',
    roomId: 'room_custom_wager',
    lobbyId: 'lobby_custom_wager',
    matchMode: 'custom_wager',
    mapSeed: 789,
    rankedEligible: false,
    startedAt: joinedAt,
    endedAt: new Date('2026-06-10T10:25:00.000Z'),
    redScore: 3,
    blueScore: 1,
    winningTeam: 'red',
    participants: [
      { ...baseParticipant, userId: 'custom_wager_red', team: 'red', leftAt: null },
      { ...baseParticipant, userId: 'custom_wager_blue', team: 'blue', leftAt: null },
    ],
  });

  assert.equal(fake.matches.get('custom_wager_match').matchMode, 'custom_wager');
  assert.equal(fake.matches.get('custom_wager_match').rankedEligible, false);
  assert.equal(fake.users.get('custom_wager_red').competitiveRating, customWagerBefore);
  assert.equal(fake.users.get('custom_wager_red').rankedGames, 5);
}

runPersistenceWriteTests()
  .then(() => {
    console.log('match-persistence tests passed');
  });
