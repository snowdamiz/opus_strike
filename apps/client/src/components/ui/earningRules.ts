import type { RewardEconomyResponse } from '../../contexts/networkApi';

export type EarningRule = {
  label: string;
  value: string;
};

export type RewardEconomy = RewardEconomyResponse['economy'];

export function rewardTokenTicker(symbol?: string | null): string | null {
  const cleaned = symbol?.trim().replace(/^\$/, '').toUpperCase() ?? '';
  return /^[A-Z0-9]{1,16}$/.test(cleaned) ? cleaned : null;
}

function formatCompactInteger(value: string | undefined, fallback: string): string {
  try {
    const amount = BigInt(value ?? fallback);
    const units: Array<[bigint, string]> = [
      [1_000_000_000n, 'B'],
      [1_000_000n, 'M'],
      [1_000n, 'k'],
    ];
    for (const [unit, suffix] of units) {
      if (amount >= unit && amount % unit === 0n) {
        return `${amount / unit}${suffix}`;
      }
    }
    return amount.toLocaleString('en-US');
  } catch {
    return fallback;
  }
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

export function getEarningRules(tokenSymbol: string | null, economy: RewardEconomy | null): EarningRule[] {
  const token = rewardTokenTicker(tokenSymbol);
  const rewards = economy?.playerRewards;
  const wagers = economy?.wagers;
  const golden = economy?.goldenBiome;
  const rankedRewardsEnabled = rewards?.enabled !== false;
  const weeklyRewardsEnabled = rewards?.weeklyEnabled !== false;
  const goldenRewardsEnabled = golden?.enabled !== false;
  const wagersEnabled = wagers?.enabled !== false;
  const rules: EarningRule[] = [];

  if (rankedRewardsEnabled) {
    const rankedDrip = formatCompactInteger(rewards?.dailyRankedDripLamports, '20k');
    const maxDaily = rewards?.dailyRankedDripMaxMatches ?? 5;
    const win = formatCompactInteger(rewards?.objectiveWinLamports, '10k');
    const assist = formatCompactInteger(rewards?.objectiveAssistLamports, '2k');
    const capture = formatCompactInteger(rewards?.objectiveFlagCaptureLamports, '15k');
    const flagReturn = formatCompactInteger(rewards?.objectiveFlagReturnLamports, '5k');

    rules.push(
      { label: 'Ranked match', value: `${tokenAmountLabel(rankedDrip, token)}, max ${maxDaily}/day` },
      { label: 'Win + assist', value: `${tokenAmountLabel(win, token)} win, ${tokenAmountLabel(assist, token)} assist` },
      { label: 'Flag bonus', value: `${tokenAmountLabel(capture, token)} capture, ${tokenAmountLabel(flagReturn, token)} return` },
    );
  }

  if (weeklyRewardsEnabled) {
    const weeklyTop = rewards?.weeklyTopPlayers ?? 10;
    const weeklyPool = formatCompactInteger(rewards?.weeklyPoolLamports, '1M');
    rules.push({ label: `Weekly top ${weeklyTop}`, value: `split ${tokenAmountLabel(weeklyPool, token)}` });
  }

  if (goldenRewardsEnabled) {
    const goldenChance = formatBpsShort(golden?.chanceBps, 200);
    const goldenReward = formatSolLamports(golden?.winnerRewardLamports, '200000000');
    rules.push({ label: 'Golden map', value: `${goldenChance} roll, ${goldenReward} SOL each winner` });
  }

  if (wagersEnabled) {
    const wagerFee = formatBpsShort(wagers?.platformFeeBps, 500);
    rules.push({ label: 'Wagers', value: `winners split pot, treasury keeps ${wagerFee}` });
  }

  return rules;
}
