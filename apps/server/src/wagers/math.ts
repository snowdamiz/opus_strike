import type { Team } from '@voxel-strike/shared';

export const WAGER_TOKEN = 'SOL' as const;
export const WAGER_BPS_DENOMINATOR = 10_000n;
export const WAGER_WINNER_POOL_BPS = 9_000;
export const WAGER_BURN_BPS = 500;
export const WAGER_TREASURY_BPS = 500;

export interface WagerPayoutMath {
  totalPotLamports: bigint;
  winnerPoolLamports: bigint;
  winnerShareLamports: bigint;
  winnerPayoutLamports: bigint[];
  burnLamports: bigint;
  treasuryFeeLamports: bigint;
  treasuryDustLamports: bigint;
  treasuryTotalLamports: bigint;
}

export interface WagerRosterPlayer {
  lobbyPlayerId: string;
  userId: string | null;
  name: string;
  team: Team | null;
  isBot: boolean;
}

export interface WagerStartEligibility {
  canStart: boolean;
  unpaidPlayers: Array<{ lobbyPlayerId: string; userId: string | null; name: string; team: Team }>;
  paidHumanCountByTeam: Record<Team, number>;
  reasons: string[];
}

export function calculateWagerPayouts(
  totalPotLamports: bigint,
  winningPaidHumanCount: number
): WagerPayoutMath {
  if (totalPotLamports < 0n) {
    throw new Error('total pot cannot be negative');
  }
  if (!Number.isInteger(winningPaidHumanCount) || winningPaidHumanCount < 1) {
    throw new Error('winning paid human count must be at least one');
  }

  const grossWinnerPoolLamports = totalPotLamports * BigInt(WAGER_WINNER_POOL_BPS) / WAGER_BPS_DENOMINATOR;
  const burnLamports = totalPotLamports * BigInt(WAGER_BURN_BPS) / WAGER_BPS_DENOMINATOR;
  const treasuryFeeLamports = totalPotLamports * BigInt(WAGER_TREASURY_BPS) / WAGER_BPS_DENOMINATOR;
  const splitDustLamports = totalPotLamports - grossWinnerPoolLamports - burnLamports - treasuryFeeLamports;
  const winnerShareLamports = grossWinnerPoolLamports / BigInt(winningPaidHumanCount);
  const winnerRemainderLamports = grossWinnerPoolLamports - winnerShareLamports * BigInt(winningPaidHumanCount);
  const winnerPayoutLamports = Array.from({ length: winningPaidHumanCount }, (_, index) => (
    winnerShareLamports + (BigInt(index) < winnerRemainderLamports ? 1n : 0n)
  ));

  return {
    totalPotLamports,
    winnerPoolLamports: grossWinnerPoolLamports,
    winnerShareLamports,
    winnerPayoutLamports,
    burnLamports,
    treasuryFeeLamports,
    treasuryDustLamports: splitDustLamports,
    treasuryTotalLamports: treasuryFeeLamports + splitDustLamports,
  };
}

export function evaluateWagerStartEligibility(
  roster: WagerRosterPlayer[],
  creditedUserIds: Set<string>
): WagerStartEligibility {
  const unpaidPlayers: WagerStartEligibility['unpaidPlayers'] = [];
  const paidHumanCountByTeam: Record<Team, number> = { red: 0, blue: 0 };

  for (const player of roster) {
    if (player.isBot) continue;
    if (player.team !== 'red' && player.team !== 'blue') continue;

    if (player.userId && creditedUserIds.has(player.userId)) {
      paidHumanCountByTeam[player.team]++;
      continue;
    }

    unpaidPlayers.push({
      lobbyPlayerId: player.lobbyPlayerId,
      userId: player.userId,
      name: player.name,
      team: player.team,
    });
  }

  const reasons: string[] = [];
  if (unpaidPlayers.length > 0) {
    reasons.push('unpaid_players');
  }
  if (paidHumanCountByTeam.red < 1) {
    reasons.push('missing_red_paid_human');
  }
  if (paidHumanCountByTeam.blue < 1) {
    reasons.push('missing_blue_paid_human');
  }

  return {
    canStart: reasons.length === 0,
    unpaidPlayers,
    paidHumanCountByTeam,
    reasons,
  };
}

export function calculateNetRefundLamports(
  grossLamports: bigint,
  outboundFeeLamports: bigint
): bigint {
  if (grossLamports < 0n) {
    throw new Error('refund gross lamports cannot be negative');
  }
  if (outboundFeeLamports < 0n) {
    throw new Error('refund fee lamports cannot be negative');
  }
  if (outboundFeeLamports >= grossLamports) {
    throw new Error('refund fee must be less than gross lamports; manual review required');
  }
  return grossLamports - outboundFeeLamports;
}

export function bigintToJson(value: bigint): string {
  return value.toString(10);
}

export function bigintFromJson(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new Error(`${fieldName} must be an integer lamport value`);
}
