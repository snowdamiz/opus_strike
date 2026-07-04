import assert from 'node:assert/strict';
import {
  getPlayerRewardRuntimeConfig,
  type PlayerRewardRuntimeConfig,
} from '../rewards/config';
import {
  RankedBrRewardAccumulator,
  computeRankedBrDynamicMatchPoolLamports,
} from '../rewards/rankedBrCombatRewards';
import {
  computeMinimumPayoutLamports,
  parseUsdDecimalToMicroUsd,
} from '../rewards/solPrice';

const config: PlayerRewardRuntimeConfig = {
  enabled: true,
  settingsVersion: 7,
  dailyRankedDripLamports: 0n,
  dailyRankedDripMaxMatches: 0,
  minMatchDurationMs: 0,
  objectiveWinLamports: 0n,
  objectiveFlagCaptureLamports: 0n,
  objectiveFlagReturnLamports: 0n,
  objectiveAssistLamports: 0n,
  maxPlayerMatchLamports: 0n,
  maxMatchPayoutLamports: 0n,
  treasuryReserveLamports: 0n,
  payoutBatchSize: 100,
  rankedBrCombatRewardsEnabled: true,
  rankedBrCombatRewardsShadowMode: false,
  rankedBrDamageLamportsPerHp: 250n,
  rankedBrKillLamports: 100_000n,
  rankedBrBotTargetRewardBps: 7_000,
  rankedBrSourceVictimDamageCapHp: 315,
  rankedBrMaxPlayerMatchLamports: 750_000n,
  rankedBrMaxPlayerDailyLamports: 2_500_000n,
  rankedBrMaxMatchLamports: 5_000_000n,
  rankedBrTreasuryExposureBps: 10,
  rankedBrClientRewardTextMinLamports: 1_000n,
  minPayoutUsdCents: 1_500,
  payoutPriceQuoteTtlMs: 300_000,
};

{
  const previousTreasuryReserve = process.env.PLAYER_REWARD_TREASURY_RESERVE_LAMPORTS;
  delete process.env.PLAYER_REWARD_TREASURY_RESERVE_LAMPORTS;
  try {
    const defaults = getPlayerRewardRuntimeConfig();
    assert.equal(defaults.rankedBrCombatRewardsEnabled, true);
    assert.equal(defaults.rankedBrCombatRewardsShadowMode, false);
    assert.equal(defaults.treasuryReserveLamports, 0n);
    assert.equal(defaults.rankedBrTreasuryExposureBps, 10_000);
  } finally {
    if (previousTreasuryReserve === undefined) {
      delete process.env.PLAYER_REWARD_TREASURY_RESERVE_LAMPORTS;
    } else {
      process.env.PLAYER_REWARD_TREASURY_RESERVE_LAMPORTS = previousTreasuryReserve;
    }
  }
}

function accumulator(overrides: Partial<ConstructorParameters<typeof RankedBrRewardAccumulator>[0]> = {}) {
  return new RankedBrRewardAccumulator({
    matchId: 'match-br',
    roomId: 'room-br',
    lobbyId: 'lobby-br',
    dailyTotalsByUserId: new Map(),
    matchPoolLamports: 5_000_000n,
    ...overrides,
  });
}

function record(input: {
  acc: RankedBrRewardAccumulator;
  targetKind?: 'human' | 'official_ranked_br_bot';
  damage: number;
  kill?: boolean;
  config?: PlayerRewardRuntimeConfig;
}) {
  return input.acc.recordDamage({
    config: input.config ?? config,
    sourcePlayerId: 'source-session',
    sourceUserId: 'source-user',
    sourceTeam: 'red',
    targetPlayerId: input.targetKind === 'official_ranked_br_bot' ? 'bot-target' : 'human-target',
    targetTeam: 'blue',
    targetKind: input.targetKind ?? 'human',
    playerSessionId: 'source-session',
    serverAppliedDamageHp: input.damage,
    finalEnemyElimination: input.kill === true,
  });
}

{
  const acc = accumulator();
  assert.equal(record({ acc, damage: 12 })?.amountLamports, 3_000n);
  assert.equal(record({ acc, damage: 40 })?.amountLamports, 10_000n);
  assert.equal(record({ acc, damage: 100 })?.amountLamports, 25_000n);
}

{
  const acc = accumulator();
  assert.equal(record({ acc, targetKind: 'official_ranked_br_bot', damage: 100 })?.amountLamports, 17_500n);
  assert.equal(record({ acc, targetKind: 'official_ranked_br_bot', damage: 0, kill: true })?.amountLamports, 70_000n);
}

{
  const acc = accumulator();
  assert.equal(record({ acc, damage: 400 })?.amountLamports, 78_750n);
  assert.equal(record({ acc, damage: 1 }), null);
}

{
  const acc = accumulator({ dailyTotalsByUserId: new Map([['source-user', 2_499_000n]]) });
  assert.equal(record({ acc, damage: 100 })?.amountLamports, 1_000n);
  assert.equal(record({ acc, damage: 100 }), null);
}

{
  const acc = accumulator();
  const shadowConfig = { ...config, rankedBrCombatRewardsShadowMode: true };
  assert.equal(record({ acc, damage: 100, config: shadowConfig }), null);
  assert.equal(acc.buildGrants().length, 0);
}

{
  const acc = accumulator();
  record({ acc, damage: 100 });
  record({ acc, damage: 0, kill: true });
  const grants = acc.buildGrants();
  assert.equal(grants.length, 1);
  assert.equal(grants[0].amountLamports, 125_000n);
  assert.equal(grants[0].metadata.formulaVersion, 'ranked_br_sol_v1');
  assert.equal(grants[0].metadata.humanRewardableDamageHp, 100);
  assert.equal(grants[0].metadata.humanKills, 1);
  assert.equal(grants[0].metadata.damageRewardLamports, '25000');
  assert.equal(grants[0].metadata.killRewardLamports, '100000');
}

assert.equal(computeRankedBrDynamicMatchPoolLamports({
  availableTreasuryLamports: 10_000_000_000n,
  maxMatchLamports: 5_000_000n,
  treasuryExposureBps: 10,
}), 5_000_000n);

assert.equal(parseUsdDecimalToMicroUsd('150.1234567'), 150_123_457n);
assert.equal(computeMinimumPayoutLamports(1_500, 150_000_000n), 100_000_000n);

console.log('ranked BR combat rewards tests passed');
