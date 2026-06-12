import { Connection, PublicKey } from '@solana/web3.js';
import { envFlag } from '../config/security';

const LAMPORTS_PER_SOL = 1_000_000_000n;
const MICRO_USD_PER_USD = 1_000_000n;
const MICRO_USD_PER_CENT = 10_000n;
const DEFAULT_RANKED_TOKEN_HOLD_USD_CENTS = 2_000;
const DEFAULT_RANKED_TOKEN_HOLD_PRICE_STALE_MS = 60 * 1000;
const DEFAULT_RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS = 5 * 1000;

type RankedTokenPriceSource = 'env' | 'coingecko';

interface CachedPrice {
  source: RankedTokenPriceSource;
  solUsdPriceMicroUsd: bigint;
  fetchedAt: number;
}

let cachedPrice: CachedPrice | null = null;

export interface RankedTokenHoldRuntimeConfig {
  enabled: boolean;
  tokenSymbol: 'SOL';
  usdCents: number;
  cluster: string;
  rpcUrl: string;
  priceSource: RankedTokenPriceSource;
  priceStaleMs: number;
  rpcTimeoutMs: number;
}

export interface RankedTokenHoldingStatus {
  eligible: boolean;
  tokenSymbol: 'SOL';
  usdCents: number;
  solUsdPrice: string;
  solUsdPriceMicroUsd: string;
  requiredLamports: string;
  balanceLamports: string;
  cluster: string;
  priceSource: RankedTokenPriceSource;
  checkedAt: string;
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

function normalizePriceSource(value: string | undefined): RankedTokenPriceSource {
  if (!value) return 'coingecko';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'env' || normalized === 'coingecko') return normalized;
  throw new Error('RANKED_TOKEN_HOLD_PRICE_SOURCE must be "env" or "coingecko"');
}

function parseDecimalToMicroUsd(value: string, fieldName: string): bigint {
  const trimmed = value.trim();
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(trimmed);
  if (!match) {
    throw new Error(`${fieldName} must be a positive decimal USD price`);
  }

  const whole = BigInt(match[1]);
  const fractional = (match[2] ?? '').slice(0, 6).padEnd(6, '0');
  const micro = whole * MICRO_USD_PER_USD + BigInt(fractional || '0');
  if (micro <= 0n) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return micro;
}

function formatMicroUsd(value: bigint): string {
  const whole = value / MICRO_USD_PER_USD;
  const fractional = (value % MICRO_USD_PER_USD).toString().padStart(6, '0').replace(/0+$/, '');
  return fractional ? `${whole.toString()}.${fractional}` : whole.toString();
}

function formatUsdCents(usdCents: number): string {
  const dollars = Math.floor(usdCents / 100);
  const cents = usdCents % 100;
  return cents === 0 ? `$${dollars}` : `$${dollars}.${cents.toString().padStart(2, '0')}`;
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('Cannot divide by zero');
  }
  return (numerator + denominator - 1n) / denominator;
}

function calculateRequiredLamports(usdCents: number, solUsdPriceMicroUsd: bigint): bigint {
  const requiredMicroUsd = BigInt(usdCents) * MICRO_USD_PER_CENT;
  return ceilDiv(requiredMicroUsd * LAMPORTS_PER_SOL, solUsdPriceMicroUsd);
}

function parseWalletAddress(walletAddress: string): PublicKey {
  try {
    const parsed = new PublicKey(walletAddress);
    if (parsed.toBase58() !== walletAddress) {
      throw new Error('non-canonical public key');
    }
    return parsed;
  } catch {
    throw Object.assign(new Error('Linked wallet address is not a valid Solana public key'), { statusCode: 400 });
  }
}

export function getRankedTokenHoldRuntimeConfig(): RankedTokenHoldRuntimeConfig {
  return {
    enabled: envFlag('RANKED_TOKEN_HOLD_ENABLED', true),
    tokenSymbol: 'SOL',
    usdCents: intEnv('RANKED_TOKEN_HOLD_USD_CENTS', DEFAULT_RANKED_TOKEN_HOLD_USD_CENTS, { min: 1, max: 1_000_000 }),
    cluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
    rpcUrl: process.env.RANKED_TOKEN_HOLD_RPC_URL || process.env.SOLANA_RPC_URL || '',
    priceSource: normalizePriceSource(process.env.RANKED_TOKEN_HOLD_PRICE_SOURCE ?? process.env.RANKED_ENTRY_PRICE_SOURCE),
    priceStaleMs: intEnv('RANKED_TOKEN_HOLD_PRICE_STALE_MS', DEFAULT_RANKED_TOKEN_HOLD_PRICE_STALE_MS, { min: 5_000, max: 60 * 60 * 1000 }),
    rpcTimeoutMs: intEnv('RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS', DEFAULT_RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS, { min: 1_000, max: 60_000 }),
  };
}

async function fetchEnvPriceMicroUsd(): Promise<bigint> {
  const explicitMicro = process.env.RANKED_TOKEN_HOLD_SOL_USD_MICRO_USD
    || process.env.RANKED_ENTRY_SOL_USD_MICRO_USD;
  if (explicitMicro) {
    if (!/^[0-9]+$/.test(explicitMicro)) {
      throw new Error('RANKED_TOKEN_HOLD_SOL_USD_MICRO_USD must be an unsigned integer');
    }
    const parsed = BigInt(explicitMicro);
    if (parsed <= 0n) {
      throw new Error('RANKED_TOKEN_HOLD_SOL_USD_MICRO_USD must be greater than zero');
    }
    return parsed;
  }

  const decimal = process.env.RANKED_TOKEN_HOLD_SOL_USD_PRICE
    || process.env.RANKED_ENTRY_SOL_USD_PRICE
    || process.env.SOL_USD_PRICE;
  if (!decimal) {
    throw new Error('RANKED_TOKEN_HOLD_SOL_USD_PRICE is required when RANKED_TOKEN_HOLD_PRICE_SOURCE=env');
  }
  return parseDecimalToMicroUsd(decimal, 'RANKED_TOKEN_HOLD_SOL_USD_PRICE');
}

async function fetchCoingeckoPriceMicroUsd(): Promise<bigint> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`CoinGecko responded with HTTP ${response.status}`);
    }
    const payload = await response.json() as { solana?: { usd?: unknown } };
    const price = payload.solana?.usd;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      throw new Error('CoinGecko response did not include a usable SOL/USD price');
    }
    return parseDecimalToMicroUsd(price.toFixed(6), 'CoinGecko SOL/USD price');
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveSolUsdPriceMicroUsd(config: RankedTokenHoldRuntimeConfig): Promise<bigint> {
  const now = Date.now();
  if (
    cachedPrice
    && cachedPrice.source === config.priceSource
    && now - cachedPrice.fetchedAt <= config.priceStaleMs
  ) {
    return cachedPrice.solUsdPriceMicroUsd;
  }

  const solUsdPriceMicroUsd = config.priceSource === 'coingecko'
    ? await fetchCoingeckoPriceMicroUsd()
    : await fetchEnvPriceMicroUsd();

  cachedPrice = {
    source: config.priceSource,
    solUsdPriceMicroUsd,
    fetchedAt: now,
  };
  return solUsdPriceMicroUsd;
}

async function getBalanceWithTimeout(
  connection: Connection,
  walletAddress: PublicKey,
  timeoutMs: number
): Promise<number> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      connection.getBalance(walletAddress, 'confirmed'),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Timed out checking ranked SOL balance')), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function getRankedTokenHoldingStatus(walletAddress: string): Promise<RankedTokenHoldingStatus> {
  const config = getRankedTokenHoldRuntimeConfig();
  const checkedAt = new Date();

  if (!config.enabled) {
    return {
      eligible: true,
      tokenSymbol: config.tokenSymbol,
      usdCents: config.usdCents,
      solUsdPrice: '0',
      solUsdPriceMicroUsd: '0',
      requiredLamports: '0',
      balanceLamports: '0',
      cluster: config.cluster,
      priceSource: config.priceSource,
      checkedAt: checkedAt.toISOString(),
    };
  }

  if (!config.rpcUrl) {
    throw Object.assign(new Error('SOLANA_RPC_URL is required for ranked SOL holding checks'), { statusCode: 503 });
  }

  const publicKey = parseWalletAddress(walletAddress);
  const solUsdPriceMicroUsd = await resolveSolUsdPriceMicroUsd(config);
  const requiredLamports = calculateRequiredLamports(config.usdCents, solUsdPriceMicroUsd);
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const balanceLamports = BigInt(await getBalanceWithTimeout(connection, publicKey, config.rpcTimeoutMs));

  return {
    eligible: balanceLamports >= requiredLamports,
    tokenSymbol: config.tokenSymbol,
    usdCents: config.usdCents,
    solUsdPrice: formatMicroUsd(solUsdPriceMicroUsd),
    solUsdPriceMicroUsd: solUsdPriceMicroUsd.toString(),
    requiredLamports: requiredLamports.toString(),
    balanceLamports: balanceLamports.toString(),
    cluster: config.cluster,
    priceSource: config.priceSource,
    checkedAt: checkedAt.toISOString(),
  };
}

export async function assertRankedTokenHoldingEligibility(walletAddress: string): Promise<RankedTokenHoldingStatus> {
  const status = await getRankedTokenHoldingStatus(walletAddress);
  if (!status.eligible) {
    throw Object.assign(
      new Error(`Ranked requires holding at least ${formatUsdCents(status.usdCents)} worth of ${status.tokenSymbol}`),
      { statusCode: 403, tokenHold: status }
    );
  }
  return status;
}
