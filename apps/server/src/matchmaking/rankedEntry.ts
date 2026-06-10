import prisma from '../db';
import { envFlag } from '../config/security';
import { assertWagerPaymentsConfigured, getWagerRuntimeConfig } from '../wagers/config';

const LAMPORTS_PER_SOL = 1_000_000_000n;
const MICRO_USD_PER_USD = 1_000_000n;
const MICRO_USD_PER_CENT = 10_000n;
const DEFAULT_RANKED_ENTRY_USD_CENTS = 500;
const DEFAULT_RANKED_ENTRY_QUOTE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_RANKED_ENTRY_PRICE_STALE_MS = 60 * 1000;

type RankedEntryPriceSource = 'env' | 'coingecko';

interface CachedPrice {
  source: RankedEntryPriceSource;
  solUsdPriceMicroUsd: bigint;
  fetchedAt: number;
}

let cachedPrice: CachedPrice | null = null;

export interface RankedEntryRuntimeConfig {
  enabled: boolean;
  usdCents: number;
  quoteTtlMs: number;
  priceSource: RankedEntryPriceSource;
  priceStaleMs: number;
}

export interface RankedEntryQuotePayload {
  quoteId: string;
  usdCents: number;
  solUsdPrice: string;
  solUsdPriceMicroUsd: string;
  coverChargeLamports: string;
  priceSource: string;
  expiresAt: string;
  cluster: string;
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

function normalizePriceSource(value: string | undefined): RankedEntryPriceSource {
  if (!value) return 'env';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'env' || normalized === 'coingecko') return normalized;
  throw new Error('RANKED_ENTRY_PRICE_SOURCE must be "env" or "coingecko"');
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

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error('Cannot divide by zero');
  }
  return (numerator + denominator - 1n) / denominator;
}

function calculateCoverChargeLamports(usdCents: number, solUsdPriceMicroUsd: bigint): bigint {
  const entryMicroUsd = BigInt(usdCents) * MICRO_USD_PER_CENT;
  return ceilDiv(entryMicroUsd * LAMPORTS_PER_SOL, solUsdPriceMicroUsd);
}

export function getRankedEntryRuntimeConfig(): RankedEntryRuntimeConfig {
  return {
    enabled: envFlag('RANKED_SOL_ENTRY_ENABLED', false),
    usdCents: intEnv('RANKED_ENTRY_USD_CENTS', DEFAULT_RANKED_ENTRY_USD_CENTS, { min: 1, max: 1_000_000 }),
    quoteTtlMs: intEnv('RANKED_ENTRY_QUOTE_TTL_MS', DEFAULT_RANKED_ENTRY_QUOTE_TTL_MS, { min: 15_000, max: 60 * 60 * 1000 }),
    priceSource: normalizePriceSource(process.env.RANKED_ENTRY_PRICE_SOURCE),
    priceStaleMs: intEnv('RANKED_ENTRY_PRICE_STALE_MS', DEFAULT_RANKED_ENTRY_PRICE_STALE_MS, { min: 5_000, max: 60 * 60 * 1000 }),
  };
}

export function assertRankedEntryConfigured(config = getRankedEntryRuntimeConfig()): void {
  if (!config.enabled) {
    throw Object.assign(new Error('Ranked SOL entry is not enabled'), { statusCode: 503 });
  }
  assertWagerPaymentsConfigured(getWagerRuntimeConfig());
}

async function fetchEnvPriceMicroUsd(): Promise<bigint> {
  const explicitMicro = process.env.RANKED_ENTRY_SOL_USD_MICRO_USD;
  if (explicitMicro) {
    if (!/^[0-9]+$/.test(explicitMicro)) {
      throw new Error('RANKED_ENTRY_SOL_USD_MICRO_USD must be an unsigned integer');
    }
    const parsed = BigInt(explicitMicro);
    if (parsed <= 0n) {
      throw new Error('RANKED_ENTRY_SOL_USD_MICRO_USD must be greater than zero');
    }
    return parsed;
  }

  const decimal = process.env.RANKED_ENTRY_SOL_USD_PRICE || process.env.SOL_USD_PRICE;
  if (!decimal) {
    throw new Error('RANKED_ENTRY_SOL_USD_PRICE is required when RANKED_ENTRY_PRICE_SOURCE=env');
  }
  return parseDecimalToMicroUsd(decimal, 'RANKED_ENTRY_SOL_USD_PRICE');
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

async function resolveSolUsdPriceMicroUsd(config: RankedEntryRuntimeConfig): Promise<bigint> {
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

export async function createRankedEntryQuote(userId: string): Promise<RankedEntryQuotePayload> {
  const rankedConfig = getRankedEntryRuntimeConfig();
  assertRankedEntryConfigured(rankedConfig);
  const wagerConfig = getWagerRuntimeConfig();

  const solUsdPriceMicroUsd = await resolveSolUsdPriceMicroUsd(rankedConfig);
  const coverChargeLamports = calculateCoverChargeLamports(rankedConfig.usdCents, solUsdPriceMicroUsd);
  if (coverChargeLamports < wagerConfig.minCoverChargeLamports || coverChargeLamports > wagerConfig.maxCoverChargeLamports) {
    throw Object.assign(
      new Error('Ranked entry quote is outside configured wager cover charge bounds'),
      { statusCode: 503 }
    );
  }

  const now = new Date();
  const quote = await prisma.rankedEntryQuote.create({
    data: {
      userId,
      usdCents: rankedConfig.usdCents,
      solUsdPriceMicroUsd,
      coverChargeLamports,
      priceSource: rankedConfig.priceSource,
      cluster: wagerConfig.cluster,
      createdAt: now,
      expiresAt: new Date(now.getTime() + rankedConfig.quoteTtlMs),
    },
  });

  return serializeRankedEntryQuote(quote);
}

export async function getValidRankedEntryQuote(input: {
  quoteId: string;
  userId: string;
}): Promise<{
  id: string;
  userId: string;
  usdCents: number;
  solUsdPriceMicroUsd: bigint;
  coverChargeLamports: bigint;
  priceSource: string;
  cluster: string;
  expiresAt: Date;
}> {
  assertRankedEntryConfigured();
  const quote = await prisma.rankedEntryQuote.findUnique({
    where: { id: input.quoteId },
  });

  if (!quote || quote.userId !== input.userId) {
    throw Object.assign(new Error('Ranked entry quote not found'), { statusCode: 404 });
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw Object.assign(new Error('Ranked entry quote has expired'), { statusCode: 410 });
  }
  if (quote.cluster !== getWagerRuntimeConfig().cluster) {
    throw Object.assign(new Error('Ranked entry quote cluster no longer matches server configuration'), { statusCode: 409 });
  }

  return quote;
}

export function serializeRankedEntryQuote(quote: {
  id: string;
  usdCents: number;
  solUsdPriceMicroUsd: bigint;
  coverChargeLamports: bigint;
  priceSource: string;
  expiresAt: Date;
  cluster: string;
}): RankedEntryQuotePayload {
  return {
    quoteId: quote.id,
    usdCents: quote.usdCents,
    solUsdPrice: formatMicroUsd(quote.solUsdPriceMicroUsd),
    solUsdPriceMicroUsd: quote.solUsdPriceMicroUsd.toString(),
    coverChargeLamports: quote.coverChargeLamports.toString(),
    priceSource: quote.priceSource,
    expiresAt: quote.expiresAt.toISOString(),
    cluster: quote.cluster,
  };
}
