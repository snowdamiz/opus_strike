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
      updatedByUserId: null,
      updatedAt: null,
    },
    wagers: {
      enabled: true,
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

function valuesFor(economy: RewardEconomy | null): string[] {
  return getEarningRules('UNITS', economy).map((rule) => rule.value);
}

assert.deepEqual(
  labelsFor(createEconomy()),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Play Ranked', 'Golden map', 'Wager Games'],
  'enabled reward economy should show all payout rules',
);

assert.deepEqual(
  labelsFor(createEconomy({ playerRewards: { enabled: false } })),
  ['Play Ranked', 'Golden map', 'Wager Games'],
  'turning off ranked payouts should hide ranked match and bonuses',
);

assert.deepEqual(
  labelsFor(createEconomy({ goldenBiome: { enabled: false } })),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Play Ranked', 'Wager Games'],
  'turning off golden map rewards should hide the golden map row',
);

assert.deepEqual(
  labelsFor(createEconomy({ wagers: { enabled: false } })),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Play Ranked', 'Golden map'],
  'turning off wagers should hide the wager row',
);

assert.deepEqual(
  labelsFor(createEconomy({
    playerRewards: { enabled: false },
    goldenBiome: { enabled: false },
    wagers: { enabled: false },
  })),
  ['Play Ranked'],
  'ranked token hold copy stays visible when payout rewards are disabled',
);

assert.deepEqual(
  labelsFor(null),
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Play Ranked', 'Golden map', 'Wager Games'],
  'missing economy data should keep default copy while the API request is pending or unavailable',
);

assert.deepEqual(
  valuesFor(createEconomy()),
  [
    '20K UNITS, max 5/day',
    '10K UNITS win, 2K UNITS assist',
    '15K UNITS capture, 5K UNITS return',
    'Hold 1M UNITS',
    '2% roll, 0.2 SOL each winner',
    'Winners split pot',
  ],
  'token payout values should be compact and human-readable',
);

console.log('earning rules tests passed');
