import { envFlag } from '../config/security';

export interface PlayerRewardRuntimeConfig {
  enabled: boolean;
  dailyRankedDripLamports: bigint;
  dailyRankedDripMaxMatches: number;
  minMatchDurationMs: number;
  objectiveWinLamports: bigint;
  objectiveFlagCaptureLamports: bigint;
  objectiveFlagReturnLamports: bigint;
  objectiveAssistLamports: bigint;
  maxPlayerMatchLamports: bigint;
  maxMatchPayoutLamports: bigint;
  treasuryReserveLamports: bigint;
  payoutBatchSize: number;
  weeklyEnabled: boolean;
  weeklyPoolLamports: bigint;
  weeklyTopPlayers: number;
}

const DEFAULT_DAILY_RANKED_DRIP_LAMPORTS = 20_000n;
const DEFAULT_DAILY_RANKED_DRIP_MAX_MATCHES = 5;
const DEFAULT_MIN_MATCH_DURATION_MS = 180_000;
const DEFAULT_OBJECTIVE_WIN_LAMPORTS = 10_000n;
const DEFAULT_OBJECTIVE_FLAG_CAPTURE_LAMPORTS = 15_000n;
const DEFAULT_OBJECTIVE_FLAG_RETURN_LAMPORTS = 5_000n;
const DEFAULT_OBJECTIVE_ASSIST_LAMPORTS = 2_000n;
const DEFAULT_MAX_PLAYER_MATCH_LAMPORTS = 50_000n;
const DEFAULT_MAX_MATCH_PAYOUT_LAMPORTS = 250_000n;
const DEFAULT_TREASURY_RESERVE_LAMPORTS = 1_000_000_000n;
const DEFAULT_PAYOUT_BATCH_SIZE = 100;
const DEFAULT_WEEKLY_POOL_LAMPORTS = 1_000_000n;
const DEFAULT_WEEKLY_TOP_PLAYERS = 10;

function bigintEnv(name: string, fallback: bigint): bigint {
  const value = process.env[name];
  if (!value) return fallback;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`${name} must be an unsigned integer`);
  }
  return BigInt(value);
}

function intEnv(name: string, fallback: number, options: { min?: number; max?: number } = {}): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${name} must be an integer`);
  }
  if (options.min !== undefined && parsed < options.min) {
    throw new Error(`${name} must be >= ${options.min}`);
  }
  if (options.max !== undefined && parsed > options.max) {
    throw new Error(`${name} must be <= ${options.max}`);
  }
  return parsed;
}

export function getPlayerRewardRuntimeConfig(): PlayerRewardRuntimeConfig {
  const defaultEnabled = Boolean(process.env.SOLANA_RPC_URL && process.env.WAGER_TREASURY_WALLET);
  const enabled = envFlag('PLAYER_REWARDS_ENABLED', defaultEnabled);

  return {
    enabled,
    dailyRankedDripLamports: bigintEnv('PLAYER_REWARD_DAILY_RANKED_DRIP_LAMPORTS', DEFAULT_DAILY_RANKED_DRIP_LAMPORTS),
    dailyRankedDripMaxMatches: intEnv('PLAYER_REWARD_DAILY_RANKED_DRIP_MAX_MATCHES', DEFAULT_DAILY_RANKED_DRIP_MAX_MATCHES, { min: 0, max: 100 }),
    minMatchDurationMs: intEnv('PLAYER_REWARD_MIN_MATCH_DURATION_MS', DEFAULT_MIN_MATCH_DURATION_MS, { min: 0 }),
    objectiveWinLamports: bigintEnv('PLAYER_REWARD_OBJECTIVE_WIN_LAMPORTS', DEFAULT_OBJECTIVE_WIN_LAMPORTS),
    objectiveFlagCaptureLamports: bigintEnv('PLAYER_REWARD_OBJECTIVE_FLAG_CAPTURE_LAMPORTS', DEFAULT_OBJECTIVE_FLAG_CAPTURE_LAMPORTS),
    objectiveFlagReturnLamports: bigintEnv('PLAYER_REWARD_OBJECTIVE_FLAG_RETURN_LAMPORTS', DEFAULT_OBJECTIVE_FLAG_RETURN_LAMPORTS),
    objectiveAssistLamports: bigintEnv('PLAYER_REWARD_OBJECTIVE_ASSIST_LAMPORTS', DEFAULT_OBJECTIVE_ASSIST_LAMPORTS),
    maxPlayerMatchLamports: bigintEnv('PLAYER_REWARD_MAX_PLAYER_MATCH_LAMPORTS', DEFAULT_MAX_PLAYER_MATCH_LAMPORTS),
    maxMatchPayoutLamports: bigintEnv('PLAYER_REWARD_MAX_MATCH_PAYOUT_LAMPORTS', DEFAULT_MAX_MATCH_PAYOUT_LAMPORTS),
    treasuryReserveLamports: bigintEnv('PLAYER_REWARD_TREASURY_RESERVE_LAMPORTS', DEFAULT_TREASURY_RESERVE_LAMPORTS),
    payoutBatchSize: intEnv('PLAYER_REWARD_PAYOUT_BATCH_SIZE', DEFAULT_PAYOUT_BATCH_SIZE, { min: 1, max: 500 }),
    weeklyEnabled: envFlag('PLAYER_REWARD_WEEKLY_ENABLED', enabled),
    weeklyPoolLamports: bigintEnv('PLAYER_REWARD_WEEKLY_POOL_LAMPORTS', DEFAULT_WEEKLY_POOL_LAMPORTS),
    weeklyTopPlayers: intEnv('PLAYER_REWARD_WEEKLY_TOP_PLAYERS', DEFAULT_WEEKLY_TOP_PLAYERS, { min: 1, max: 100 }),
  };
}
