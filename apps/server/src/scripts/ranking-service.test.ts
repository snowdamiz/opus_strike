import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_MATCH_DELTA_MIN,
  RANKED_BATTLE_ROYAL_RULES_VERSION,
  calculateRankedRatingUpdates,
  MATCH_DELTA_MAX,
  MATCH_DELTA_MIN,
} from '../ranking/ratingService';
import type { RankedMatchParticipant, RankedUserState } from '../ranking/ratingService';
import type { Team } from '@voxel-strike/shared';

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

function battleRoyalParticipant(input: Partial<RankedMatchParticipant> & { userId: string; team?: Team }): RankedMatchParticipant {
  return {
    userId: input.userId,
    team: input.team ?? 'br_01',
    outcome: input.outcome ?? 'loss',
    score: input.score ?? 0,
    kills: input.kills ?? 0,
    deaths: input.deaths ?? 0,
    assists: input.assists ?? 0,
    flagCaptures: 0,
    flagReturns: 0,
    leftAt: input.leftAt ?? null,
    placement: input.placement,
    activeTeamCount: input.activeTeamCount,
    teamEliminatedAt: input.teamEliminatedAt,
    humanKills: input.humanKills,
    botKills: input.botKills,
    humanAssists: input.humanAssists,
    botAssists: input.botAssists,
    rankedEntryCost: input.rankedEntryCost,
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

const singleHumanBattleRoyalWin = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [user('solo', 800, 10)],
  participants: [
    battleRoyalParticipant({
      userId: 'solo',
      team: 'br_01',
      outcome: 'win',
      placement: 1,
      activeTeamCount: 11,
      humanKills: 2,
      humanAssists: 1,
      botKills: 10,
      botAssists: 4,
    }),
  ],
  humanParticipants: 1,
  botParticipants: 32,
  totalParticipants: 33,
  activeTeamCount: 11,
});
assert.equal(singleHumanBattleRoyalWin.length, 1);
assert.equal(singleHumanBattleRoyalWin[0].ratingDelta, 35);
assert.equal(singleHumanBattleRoyalWin[0].rankedRulesVersion, RANKED_BATTLE_ROYAL_RULES_VERSION);
assert.equal(singleHumanBattleRoyalWin[0].rankedPlacementPoints, 125);
assert.equal(singleHumanBattleRoyalWin[0].rankedCombatPoints, 75);
assert.equal(singleHumanBattleRoyalWin[0].rankedEntryCost, 6);
assert.equal(singleHumanBattleRoyalWin[0].rankedBreakdown?.positiveCap, 35);
assert.ok(Math.abs((singleHumanBattleRoyalWin[0].rankedQualityMultiplier ?? 0) - (0.45 + (1 / 33) * 0.55)) < 0.000001);

const normalizedSmallLobby = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [user('third-of-three', 800, 10)],
  participants: [
    battleRoyalParticipant({
      userId: 'third-of-three',
      team: 'br_03',
      placement: 3,
      activeTeamCount: 3,
    }),
  ],
  humanParticipants: 3,
  totalParticipants: 3,
  activeTeamCount: 3,
});
assert.equal(normalizedSmallLobby[0].rankedBreakdown?.normalizedPlacement, 11);
assert.equal(normalizedSmallLobby[0].rankedPlacementPoints, -15);

const entryCostCases: Array<[string, number, number]> = [
  ['plastic', 600, 0],
  ['bronze', 800, 6],
  ['silver', 1000, 14],
  ['gold', 1200, 26],
  ['diamond', 1400, 40],
  ['unemployed', 1600, 58],
];
for (const [id, rating, entryCost] of entryCostCases) {
  const [update] = calculateRankedRatingUpdates({
    gameplayMode: 'battle_royal',
    endedAt,
    winningTeam: 'br_01',
    users: [user(id, rating, 20)],
    participants: [
      battleRoyalParticipant({
        userId: id,
        placement: 8,
        activeTeamCount: 11,
      }),
    ],
    humanParticipants: 1,
    totalParticipants: 1,
    activeTeamCount: 11,
  });
  assert.equal(update.rankedEntryCost, entryCost);
  assert.equal(update.ratingDelta, entryCost === 0 ? 0 : -entryCost);
}

const battleRoyalLeaver = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [user('early-leaver', 1600, 20)],
  participants: [
    battleRoyalParticipant({
      userId: 'early-leaver',
      outcome: 'win',
      placement: 1,
      activeTeamCount: 11,
      leftAt: new Date('2026-06-10T11:40:00.000Z'),
      teamEliminatedAt: new Date('2026-06-10T11:55:00.000Z'),
    }),
  ],
  humanParticipants: 1,
  totalParticipants: 1,
  activeTeamCount: 11,
});
assert.equal(battleRoyalLeaver[0].leaverPenaltyApplied, true);
assert.equal(battleRoyalLeaver[0].ratingDelta, BATTLE_ROYAL_MATCH_DELTA_MIN);

const botOnlyExcluded = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [],
  participants: [
    battleRoyalParticipant({ userId: 'bot-user', placement: 1, activeTeamCount: 11 }),
  ],
  humanParticipants: 0,
  botParticipants: 33,
  totalParticipants: 33,
  activeTeamCount: 11,
});
assert.equal(botOnlyExcluded.length, 0);

console.log('ranking service tests passed');
