import type { Team } from '@voxel-strike/shared';

export const WAGER_TOKEN = 'SOL' as const;
export const WAGER_PLATFORM_FEE_BPS = 500;
export const WAGER_BPS_DENOMINATOR = 10_000n;

export interface WagerPayoutMath {
  totalPotLamports: bigint;
  developerFeeLamports: bigint;
  winnerPoolLamports: bigint;
  winnerShareLamports: bigint;
  dustLamports: bigint;
  developerTotalLamports: bigint;
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
  winningPaidHumanCount: number,
  platformFeeBps = WAGER_PLATFORM_FEE_BPS
): WagerPayoutMath {
  if (totalPotLamports < 0n) {
    throw new Error('total pot cannot be negative');
  }
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > 10_000) {
    throw new Error('platform fee bps must be between 0 and 10000');
  }
  if (!Number.isInteger(winningPaidHumanCount) || winningPaidHumanCount < 1) {
    throw new Error('winning paid human count must be at least one');
  }

  const developerFeeLamports = totalPotLamports * BigInt(platformFeeBps) / WAGER_BPS_DENOMINATOR;
  const winnerPoolLamports = totalPotLamports - developerFeeLamports;
  const winnerShareLamports = winnerPoolLamports / BigInt(winningPaidHumanCount);
  const dustLamports = winnerPoolLamports - winnerShareLamports * BigInt(winningPaidHumanCount);

  return {
    totalPotLamports,
    developerFeeLamports,
    winnerPoolLamports,
    winnerShareLamports,
    dustLamports,
    developerTotalLamports: developerFeeLamports + dustLamports,
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
