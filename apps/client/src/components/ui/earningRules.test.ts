import assert from 'node:assert/strict';
import { getEarningRules, type RewardEconomy } from './earningRules';

type RewardEconomyOverrides = Partial<Omit<RewardEconomy, 'playerRewards' | 'wagers' | 'goldenBiome'>> & {
  playerRewards?: Partial<RewardEconomy['playerRewards']>;
  wagers?: Partial<RewardEconomy['wagers']>;
  goldenBiome?: Partial<RewardEconomy['goldenBiome']>;
};

function createEconomy(overrides: RewardEconomyOverrides = {}): RewardEconomy {
  const economy: RewardEconomy = {
    rewardTokenSymbol: 'UNITS',
    playerRewards: {
      enabled: true,
      dailyRankedDripLamports: '20000',
      dailyRankedDripMaxMatches: 5,
      minMatchDurationMs: 180000,
      objectiveWinLamports: '10000',
      objectiveFlagCaptureLamports: '15000',
      objectiveFlagReturnLamports: '5000',
      objectiveAssistLamports: '2000',
      maxPlayerMatchLamports: '50000',
      maxMatchPayoutLamports: '250000',
      treasuryReserveLamports: '1000000000',
      payoutBatchSize: 100,
      weeklyEnabled: true,
      weeklyPoolLamports: '1000000',
      weeklyTopPlayers: 10,
      updatedByUserId: null,
      updatedAt: null,
    },
    wagers: {
      platformFeeBps: 500,
      updatedByUserId: null,
      updatedAt: null,
    },
    goldenBiome: {
      distributionMode: 'manual',
      enabled: true,
      chanceBps: 200,
      winnerRewardLamports: '200000000',
      treasuryMinLamports: '1000000000',
      treasuryWallet: null,
      updatedByUserId: null,
      updatedAt: null,
    },
  };

  return {
    ...economy,
    ...overrides,
    playerRewards: {
      ...economy.playerRewards,
      ...overrides.playerRewards,
    },
    wagers: {
      ...economy.wagers,
      ...overrides.wagers,
    },
    goldenBiome: {
      ...economy.goldenBiome,
      ...overrides.goldenBiome,
    },
  };
}

function labelsFor(economy: RewardEconomy | null): string[] {
  return getEarningRules('UNITS', economy).map((rule) => rule.label);
}

assert.deepEqual(
  labelsFor(createEconomy()),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Weekly top 10', 'Golden map', 'Wagers'],
  'enabled reward economy should show all payout rules',
);

assert.deepEqual(
  labelsFor(createEconomy({ playerRewards: { enabled: false } })),
  ['Golden map', 'Wagers'],
  'turning off ranked payouts should hide ranked match, bonuses, and weekly leaderboard rewards',
);

assert.deepEqual(
  labelsFor(createEconomy({ playerRewards: { weeklyEnabled: false } })),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Golden map', 'Wagers'],
  'turning off weekly payouts should hide the weekly leaderboard row only',
);

assert.deepEqual(
  labelsFor(createEconomy({ goldenBiome: { enabled: false } })),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Weekly top 10', 'Wagers'],
  'turning off golden map rewards should hide the golden map row',
);

assert.deepEqual(
  labelsFor(null),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Weekly top 10', 'Golden map', 'Wagers'],
  'missing economy data should keep default copy while the API request is pending or unavailable',
);

console.log('earning rules tests passed');
