import assert from 'node:assert/strict';
import { getEarningRules, type RewardEconomy } from './earningRules';

type RewardEconomyOverrides = Partial<Omit<RewardEconomy, 'playerRewards' | 'wagers' | 'goldenBiome' | 'rankedEntryGate'>> & {
  playerRewards?: Partial<RewardEconomy['playerRewards']>;
  wagers?: Partial<RewardEconomy['wagers']>;
  goldenBiome?: Partial<RewardEconomy['goldenBiome']>;
  rankedEntryGate?: Partial<RewardEconomy['rankedEntryGate']>;
};

function createEconomy(overrides: RewardEconomyOverrides = {}): RewardEconomy {
  const economy: RewardEconomy = {
    rewardTokenSymbol: 'UNITS',
    rankedEntryGate: {
      mode: 'token_required',
      tokenAddress: 'Token1111111111111111111111111111111111111',
      requiredTokenAmount: '2500000',
    },
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
    rankedEntryGate: {
      ...economy.rankedEntryGate,
      ...overrides.rankedEntryGate,
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
  ['Ranked match', 'Win + assist', 'Flag bonus', 'Golden map', 'Wager Games'],
  'missing economy data should not show a stale ranked token requirement',
);

assert.deepEqual(
  valuesFor(createEconomy()),
  [
    '20K UNITS, max 5/day',
    '10K UNITS win, 2K UNITS assist',
    '15K UNITS capture, 5K UNITS return',
    'Hold 2.5M UNITS',
    '2% roll, 0.2 SOL each winner',
    'Winners split pot',
  ],
  'token payout values should be compact and human-readable',
);

assert.equal(
  valuesFor(createEconomy({ rankedEntryGate: { requiredTokenAmount: '500' } })).at(3),
  'Hold 500 UNITS',
  'ranked token hold copy should use the admin-configured amount',
);

assert.equal(
  valuesFor(createEconomy({ rankedEntryGate: { mode: 'locked', requiredTokenAmount: '0' } })).at(3),
  'Locked',
  'locked ranked gates should not show a token amount',
);

console.log('earning rules tests passed');
