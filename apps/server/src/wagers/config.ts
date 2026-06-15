import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { envFlag, isProductionEnvironment } from '../config/security';

export interface WagerRuntimeConfig {
  enabled: boolean;
  cluster: string;
  rpcUrl: string;
  treasuryWallet: string;
  minCoverChargeLamports: bigint;
  maxCoverChargeLamports: bigint;
  platformFeeBps: number;
  intentTtlMs: number;
  intentExpiryGraceMs: number;
  settlementMaxAttempts: number;
  settlementRetryMs: number;
  treasuryLowBalanceLamports: bigint;
  refundFeeFallbackLamports: bigint;
  adminToken: string;
  goldenBiomeEnabled: boolean;
  goldenBiomeChanceBps: number;
  goldenBiomeTreasuryMinUsdCents: number;
  goldenBiomeWinnerRewardUsdCents: number;
  goldenBiomeSolUsdPriceSource: 'env' | 'coingecko';
  goldenBiomeSolUsdPriceStaleMs: number;
  goldenBiomeSolUsdPriceTimeoutMs: number;
}

const DEFAULT_MIN_COVER_CHARGE_LAMPORTS = 1_000_000n;
const DEFAULT_MAX_COVER_CHARGE_LAMPORTS = 10_000_000_000n;
const DEFAULT_TREASURY_LOW_BALANCE_LAMPORTS = 20_000_000n;
const DEFAULT_REFUND_FEE_FALLBACK_LAMPORTS = 5_000n;
const DEFAULT_GOLDEN_BIOME_CHANCE_BPS = 200;
const DEFAULT_GOLDEN_BIOME_TREASURY_MIN_USD_CENTS = 100_000;
const DEFAULT_GOLDEN_BIOME_WINNER_REWARD_USD_CENTS = 2_000;
const DEFAULT_GOLDEN_BIOME_PRICE_STALE_MS = 60 * 1000;
const DEFAULT_GOLDEN_BIOME_PRICE_TIMEOUT_MS = 5 * 1000;

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

function priceSourceEnv(name: string, fallback: 'env' | 'coingecko'): 'env' | 'coingecko' {
  const value = process.env[name];
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'env' || normalized === 'coingecko') return normalized;
  throw new Error(`${name} must be "env" or "coingecko"`);
}

export function assertPublicKey(address: string, fieldName: string): void {
  try {
    const parsed = new PublicKey(address);
    if (parsed.toBase58() !== address) {
      throw new Error('non-canonical public key');
    }
  } catch {
    throw new Error(`${fieldName} must be a valid Solana public key`);
  }
}

export function getWagerRuntimeConfig(): WagerRuntimeConfig {
  const treasuryWallet = process.env.WAGER_TREASURY_WALLET || '';
  if (treasuryWallet) {
    assertPublicKey(treasuryWallet, 'WAGER_TREASURY_WALLET');
  }

  const platformFeeBps = intEnv('WAGER_PLATFORM_FEE_BPS', 500, { min: 0, max: 10_000 });
  const minCoverChargeLamports = bigintEnv('WAGER_MIN_COVER_CHARGE_LAMPORTS', DEFAULT_MIN_COVER_CHARGE_LAMPORTS);
  const maxCoverChargeLamports = bigintEnv('WAGER_MAX_COVER_CHARGE_LAMPORTS', DEFAULT_MAX_COVER_CHARGE_LAMPORTS);

  if (minCoverChargeLamports > maxCoverChargeLamports) {
    throw new Error('WAGER_MIN_COVER_CHARGE_LAMPORTS cannot exceed WAGER_MAX_COVER_CHARGE_LAMPORTS');
  }

  return {
    enabled: envFlag('WAGER_SOL_ENABLED', Boolean(treasuryWallet) && Boolean(process.env.SOLANA_RPC_URL)),
    cluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
    rpcUrl: process.env.SOLANA_RPC_URL || '',
    treasuryWallet,
    minCoverChargeLamports,
    maxCoverChargeLamports,
    platformFeeBps,
    intentTtlMs: intEnv('WAGER_INTENT_TTL_MS', 15 * 60 * 1000, { min: 30_000 }),
    intentExpiryGraceMs: intEnv('WAGER_INTENT_EXPIRY_GRACE_MS', 2 * 60 * 1000, { min: 0 }),
    settlementMaxAttempts: intEnv('WAGER_SETTLEMENT_MAX_ATTEMPTS', 6, { min: 1, max: 50 }),
    settlementRetryMs: intEnv('WAGER_SETTLEMENT_RETRY_MS', 60_000, { min: 5_000 }),
    treasuryLowBalanceLamports: bigintEnv('WAGER_TREASURY_LOW_BALANCE_LAMPORTS', DEFAULT_TREASURY_LOW_BALANCE_LAMPORTS),
    refundFeeFallbackLamports: bigintEnv('WAGER_REFUND_FEE_FALLBACK_LAMPORTS', DEFAULT_REFUND_FEE_FALLBACK_LAMPORTS),
    adminToken: process.env.WAGER_ADMIN_TOKEN || '',
    goldenBiomeEnabled: envFlag('GOLDEN_BIOME_ENABLED', true),
    goldenBiomeChanceBps: intEnv('GOLDEN_BIOME_CHANCE_BPS', DEFAULT_GOLDEN_BIOME_CHANCE_BPS, { min: 0, max: 10_000 }),
    goldenBiomeTreasuryMinUsdCents: intEnv('GOLDEN_BIOME_TREASURY_MIN_USD_CENTS', DEFAULT_GOLDEN_BIOME_TREASURY_MIN_USD_CENTS, { min: 1 }),
    goldenBiomeWinnerRewardUsdCents: intEnv('GOLDEN_BIOME_WINNER_REWARD_USD_CENTS', DEFAULT_GOLDEN_BIOME_WINNER_REWARD_USD_CENTS, { min: 1 }),
    goldenBiomeSolUsdPriceSource: priceSourceEnv('GOLDEN_BIOME_SOL_USD_PRICE_SOURCE', 'coingecko'),
    goldenBiomeSolUsdPriceStaleMs: intEnv('GOLDEN_BIOME_SOL_USD_PRICE_STALE_MS', DEFAULT_GOLDEN_BIOME_PRICE_STALE_MS, { min: 5_000, max: 60 * 60 * 1000 }),
    goldenBiomeSolUsdPriceTimeoutMs: intEnv('GOLDEN_BIOME_SOL_USD_PRICE_TIMEOUT_MS', DEFAULT_GOLDEN_BIOME_PRICE_TIMEOUT_MS, { min: 1_000, max: 60_000 }),
  };
}

export function assertWagerPaymentsConfigured(config = getWagerRuntimeConfig()): void {
  if (!config.enabled) {
    throw new Error('SOL wagers are not enabled');
  }
  if (!config.rpcUrl) {
    throw new Error('SOLANA_RPC_URL is required for wagers');
  }
  if (!config.treasuryWallet) {
    throw new Error('WAGER_TREASURY_WALLET is required for wagers');
  }
}

export function getSettlementKeypair(): Keypair | null {
  const secret = process.env.WAGER_SETTLEMENT_SECRET_KEY || process.env.WAGER_SETTLEMENT_SIGNER_SECRET || '';
  if (!secret) return null;

  try {
    const bytes = secret.trim().startsWith('[')
      ? Uint8Array.from(JSON.parse(secret) as number[])
      : bs58.decode(secret.trim());
    return Keypair.fromSecretKey(bytes);
  } catch (error) {
    if (isProductionEnvironment()) {
      throw new Error('WAGER_SETTLEMENT_SECRET_KEY is invalid');
    }
    console.warn('[wagers] invalid WAGER_SETTLEMENT_SECRET_KEY:', error);
    return null;
  }
}

export function isAdminRetryAllowed(token: string | undefined, config = getWagerRuntimeConfig()): boolean {
  if (!config.adminToken) {
    return !isProductionEnvironment();
  }
  return token === config.adminToken;
}
