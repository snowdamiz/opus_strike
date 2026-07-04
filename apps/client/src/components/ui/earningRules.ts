import type { RewardEconomyResponse } from '../../contexts/networkApi';
import { formatCompactTokenAmount } from '../../utils/tokenAmountFormat';

export type EarningRule = {
  label: string;
  value: string;
  emphasis?: 'sol-combat';
};

export type RewardEconomy = RewardEconomyResponse['economy'];

export function rewardTokenTicker(symbol?: string | null): string | null {
  const cleaned = symbol?.trim().replace(/^\$/, '').toUpperCase() ?? '';
  return /^[A-Z0-9]{1,16}$/.test(cleaned) ? cleaned : null;
}

function formatBpsShort(value: number | undefined, fallback: number): string {
  const bps = Number.isFinite(value) ? value ?? fallback : fallback;
  return `${(bps / 100).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
}

function formatSolLamports(value: string | undefined, fallback: string): string {
  try {
    const lamports = BigInt(value ?? fallback);
    const whole = lamports / 1_000_000_000n;
    const fractional = lamports % 1_000_000_000n;
    if (fractional === 0n) return whole.toString();
    return `${whole}.${fractional.toString().padStart(9, '0').replace(/0+$/, '')}`;
  } catch {
    return '0.2';
  }
}

function tokenAmountLabel(amount: string, tokenSymbol: string | null): string {
  return tokenSymbol ? `${amount} ${tokenSymbol}` : `${amount} tokens`;
}

function formatUsdCents(cents: number | undefined, fallback: number): string {
  const value = Number.isFinite(cents) ? cents ?? fallback : fallback;
  return `$${(value / 100).toFixed(2).replace(/\.00$/, '')}`;
}

function rankedEntryGateLabel(economy: RewardEconomy | null, tokenSymbol: string | null): string | null {
  const gate = economy?.rankedEntryGate;
  if (!gate) return null;
  if (gate.mode === 'locked') return 'Locked';

  const amount = formatCompactTokenAmount(gate.requiredTokenAmount, gate.requiredTokenAmount || '0');
  return `Hold ${tokenAmountLabel(amount, tokenSymbol)}`;
}

function getRankedBrSolCombatRules(rewards: RewardEconomy['playerRewards'] | undefined): EarningRule[] {
  if (rewards?.rankedBrCombatRewardsEnabled === false) return [];
  if (rewards?.rankedBrCombatRewardsShadowMode === true) return [];

  const damage = formatSolLamports(rewards?.rankedBrDamageLamportsPerHp, '250');
  const kill = formatSolLamports(rewards?.rankedBrKillLamports, '100000');
  const botMultiplier = formatBpsShort(rewards?.rankedBrBotTargetRewardBps, 7000);
  const minPayout = formatUsdCents(rewards?.minPayoutUsdCents, 1500);

  return [
    {
      label: 'Ranked BR SOL',
      value: `Enemy damage: ${damage} SOL/HP; eliminations +${kill} SOL`,
      emphasis: 'sol-combat',
    },
    { label: 'SOL payouts', value: `Bots pay ${botMultiplier}; clean matches pay after ${minPayout}` },
  ];
}

export function getEarningRules(tokenSymbol: string | null, economy: RewardEconomy | null): EarningRule[] {
  const token = rewardTokenTicker(tokenSymbol);
  const rewards = economy?.playerRewards;
  const wagers = economy?.wagers;
  const golden = economy?.goldenBiome;
  const rankedRewardsEnabled = rewards?.enabled !== false;
  const goldenRewardsEnabled = golden?.enabled !== false;
  const wagersEnabled = wagers?.enabled !== false;
  const rules: EarningRule[] = [];

  if (rankedRewardsEnabled) {
    const rankedDrip = formatCompactTokenAmount(rewards?.dailyRankedDripLamports, '20K');
    const maxDaily = rewards?.dailyRankedDripMaxMatches ?? 5;
    const win = formatCompactTokenAmount(rewards?.objectiveWinLamports, '10K');
    const assist = formatCompactTokenAmount(rewards?.objectiveAssistLamports, '2K');
    const capture = formatCompactTokenAmount(rewards?.objectiveFlagCaptureLamports, '15K');
    const flagReturn = formatCompactTokenAmount(rewards?.objectiveFlagReturnLamports, '5K');

    rules.push(
      { label: 'Ranked match', value: `${tokenAmountLabel(rankedDrip, token)}, max ${maxDaily}/day` },
      { label: 'Win + assist', value: `${tokenAmountLabel(win, token)} win, ${tokenAmountLabel(assist, token)} assist` },
      { label: 'Flag bonus', value: `${tokenAmountLabel(capture, token)} capture, ${tokenAmountLabel(flagReturn, token)} return` },
    );
  }

  rules.push(...getRankedBrSolCombatRules(rewards));

  const rankedGateLabel = rankedEntryGateLabel(economy, token);
  if (rankedGateLabel) {
    rules.push({ label: 'Play Ranked', value: rankedGateLabel });
  }

  if (goldenRewardsEnabled) {
    const goldenChance = formatBpsShort(golden?.chanceBps, 200);
    const goldenReward = formatSolLamports(golden?.winnerRewardLamports, '200000000');
    rules.push({ label: 'Golden map', value: `${goldenChance} roll, ${goldenReward} SOL each winner` });
  }

  if (wagersEnabled) {
    const winnerSplit = formatBpsShort(wagers?.winnerPoolBps, 9000);
    const burnSplit = formatBpsShort(wagers?.burnBps, 500);
    const treasurySplit = formatBpsShort(wagers?.treasuryBps, 500);
    rules.push({ label: 'Wager Games', value: `${winnerSplit} winners, ${burnSplit} burn, ${treasurySplit} treasury` });
  }

  return rules;
}
