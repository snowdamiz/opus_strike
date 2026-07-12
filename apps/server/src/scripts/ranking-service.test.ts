import assert from 'node:assert/strict';
import {
  BATTLE_ROYAL_MATCH_DELTA_MIN,
  BATTLE_ROYAL_MATCH_DELTA_MAX,
  RANKED_BATTLE_ROYAL_RULES_VERSION,
  calculateRankedRatingUpdates,
  MATCH_DELTA_MAX,
  MATCH_DELTA_MIN,
} from '../ranking/ratingService';
import type { RankedMatchParticipant, RankedUserState } from '../ranking/ratingService';
import { getGameplayModeRules, type Team } from '@voxel-strike/shared';

const endedAt = new Date('2026-06-10T12:00:00.000Z');
const fullBattleRoyalRules = getGameplayModeRules('battle_royal');
const fullBattleRoyalPlayerCount = fullBattleRoyalRules.maxPlayers;
const fullBattleRoyalTeamCount = fullBattleRoyalRules.maxTeams;

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
  users: [user('top', 2500, 70), user('challenger', 2500, 70)],
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
      activeTeamCount: fullBattleRoyalTeamCount,
      humanKills: 2,
      humanAssists: 1,
      botKills: 10,
      botAssists: 4,
    }),
  ],
  humanParticipants: 1,
  botParticipants: fullBattleRoyalPlayerCount - 1,
  totalParticipants: fullBattleRoyalPlayerCount,
  activeTeamCount: fullBattleRoyalTeamCount,
});
assert.equal(singleHumanBattleRoyalWin.length, 1);
assert.equal(singleHumanBattleRoyalWin[0].ratingDelta, 57);
assert.equal(singleHumanBattleRoyalWin[0].rankedRulesVersion, RANKED_BATTLE_ROYAL_RULES_VERSION);
assert.equal(singleHumanBattleRoyalWin[0].rankedPlacementPoints, 110);
assert.equal(singleHumanBattleRoyalWin[0].rankedCombatPoints, 75);
assert.equal(singleHumanBattleRoyalWin[0].rankedEntryCost, 30);
assert.equal(singleHumanBattleRoyalWin[0].rankedBreakdown?.positiveCap, 75);
assert.ok(Math.abs((singleHumanBattleRoyalWin[0].rankedQualityMultiplier ?? 0) - (0.45 + (1 / fullBattleRoyalPlayerCount) * 0.55)) < 0.000001);

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
assert.equal(normalizedSmallLobby[0].rankedBreakdown?.normalizedPlacement, 9);
assert.equal(normalizedSmallLobby[0].rankedPlacementPoints, 0);

const bottomHalfBattleRoyalFinish = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [user('bottom-half', 800, 20)],
  participants: [
    battleRoyalParticipant({
      userId: 'bottom-half',
      placement: 6,
      activeTeamCount: fullBattleRoyalTeamCount,
    }),
  ],
  humanParticipants: fullBattleRoyalPlayerCount,
  totalParticipants: fullBattleRoyalPlayerCount,
  activeTeamCount: fullBattleRoyalTeamCount,
});
assert.ok(bottomHalfBattleRoyalFinish[0].ratingDelta < 0);

const bronzePlacementDeltas = Array.from({ length: fullBattleRoyalTeamCount }, (_, index) => {
  const placement = index + 1;
  return calculateRankedRatingUpdates({
    gameplayMode: 'battle_royal',
    endedAt,
    winningTeam: 'br_01',
    users: [user(`bronze-placement-${placement}`, 800, 20)],
    participants: [
      battleRoyalParticipant({
        userId: `bronze-placement-${placement}`,
        placement,
        activeTeamCount: fullBattleRoyalTeamCount,
      }),
    ],
    humanParticipants: fullBattleRoyalPlayerCount,
    totalParticipants: fullBattleRoyalPlayerCount,
    activeTeamCount: fullBattleRoyalTeamCount,
  })[0].ratingDelta;
});
assert.deepEqual(bronzePlacementDeltas, [75, 50, 30, 15, 0, -15, -30, -30, -30]);
assert.ok(bronzePlacementDeltas.slice(5).every((delta) => delta < 0));
assert.ok(bronzePlacementDeltas.reduce((sum, delta) => sum + delta, 0) / bronzePlacementDeltas.length < 8);

const fullHumanLastPlaceDelta = bronzePlacementDeltas.at(-1);
const botHeavyLastPlace = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [user('bot-heavy-last', 800, 20)],
  participants: [
    battleRoyalParticipant({
      userId: 'bot-heavy-last',
      placement: fullBattleRoyalTeamCount,
      activeTeamCount: fullBattleRoyalTeamCount,
    }),
  ],
  humanParticipants: 1,
  botParticipants: fullBattleRoyalPlayerCount - 1,
  totalParticipants: fullBattleRoyalPlayerCount,
  activeTeamCount: fullBattleRoyalTeamCount,
})[0];
assert.equal(botHeavyLastPlace.ratingDelta, fullHumanLastPlaceDelta);
assert.equal(botHeavyLastPlace.visibleRankBefore, 'Bronze 1');
assert.equal(botHeavyLastPlace.visibleRankAfter, 'Plastic 4');

const historicalV1BattleRoyalFinish = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  battleRoyalRulesVersion: 'ranked_br_v1',
  endedAt,
  winningTeam: 'br_01',
  users: [user('historical-v1', 800, 20)],
  participants: [
    battleRoyalParticipant({
      userId: 'historical-v1',
      placement: 7,
      activeTeamCount: fullBattleRoyalTeamCount,
    }),
  ],
  humanParticipants: 1,
  totalParticipants: 1,
  activeTeamCount: fullBattleRoyalTeamCount,
});
assert.equal(historicalV1BattleRoyalFinish[0].rankedRulesVersion, 'ranked_br_v1');
assert.equal(historicalV1BattleRoyalFinish[0].ratingDelta, -6);

const cappedPromotion = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [user('capped-promotion', 849, 20)],
  participants: [
    battleRoyalParticipant({
      userId: 'capped-promotion',
      outcome: 'win',
      placement: 1,
      activeTeamCount: fullBattleRoyalTeamCount,
    }),
  ],
  humanParticipants: fullBattleRoyalPlayerCount,
  totalParticipants: fullBattleRoyalPlayerCount,
  activeTeamCount: fullBattleRoyalTeamCount,
});
assert.equal(cappedPromotion[0].ratingDelta, BATTLE_ROYAL_MATCH_DELTA_MAX);
assert.equal(cappedPromotion[0].visibleRankBefore, 'Bronze 1');
assert.equal(cappedPromotion[0].visibleRankAfter, 'Bronze 2');

const entryCostCases: Array<[string, number, number]> = [
  ['plastic', 400, 0],
  ['bronze', 800, 30],
  ['silver', 1200, 40],
  ['gold', 1600, 50],
  ['diamond', 2000, 60],
  ['unemployed', 2400, 75],
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
        placement: 7,
        activeTeamCount: fullBattleRoyalTeamCount,
      }),
    ],
    humanParticipants: 1,
    totalParticipants: 1,
    activeTeamCount: fullBattleRoyalTeamCount,
  });
  assert.equal(update.rankedEntryCost, entryCost);
  assert.equal(update.ratingDelta, entryCost === 0 ? 0 : -entryCost);
}

const battleRoyalLeaver = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [user('early-leaver', 2400, 20)],
  participants: [
    battleRoyalParticipant({
      userId: 'early-leaver',
      outcome: 'win',
      placement: 1,
      activeTeamCount: fullBattleRoyalTeamCount,
      leftAt: new Date('2026-06-10T11:40:00.000Z'),
      teamEliminatedAt: new Date('2026-06-10T11:55:00.000Z'),
    }),
  ],
  humanParticipants: 1,
  totalParticipants: 1,
  activeTeamCount: fullBattleRoyalTeamCount,
});
assert.equal(battleRoyalLeaver[0].leaverPenaltyApplied, true);
assert.equal(battleRoyalLeaver[0].ratingDelta, BATTLE_ROYAL_MATCH_DELTA_MIN);

const botOnlyExcluded = calculateRankedRatingUpdates({
  gameplayMode: 'battle_royal',
  endedAt,
  winningTeam: 'br_01',
  users: [],
  participants: [
    battleRoyalParticipant({ userId: 'bot-user', placement: 1, activeTeamCount: fullBattleRoyalTeamCount }),
  ],
  humanParticipants: 0,
  botParticipants: fullBattleRoyalPlayerCount,
  totalParticipants: fullBattleRoyalPlayerCount,
  activeTeamCount: fullBattleRoyalTeamCount,
});
assert.equal(botOnlyExcluded.length, 0);

console.log('ranking service tests passed');
