import { loggers } from '../utils/logger';

export interface SolUsdPriceQuote {
  source: string;
  solUsdPriceMicroUsd: bigint;
  observedAt: Date;
}

export interface SolUsdPriceQuoteSnapshot {
  source: string;
  solUsdPriceMicroUsd: string;
  observedAt: string;
  expiresAt: string;
  fresh: boolean;
}

const SOL_USD_PRICE_SOURCE = 'coinbase_exchange_rates';
const SOL_USD_PRICE_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=SOL';
const MICRO_USD_PER_USD = 1_000_000n;
const LAMPORTS_PER_SOL = 1_000_000_000n;

let cachedQuote: (SolUsdPriceQuote & { expiresAtMs: number }) | null = null;

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('denominator must be greater than zero');
  return (numerator + denominator - 1n) / denominator;
}

export function parseUsdDecimalToMicroUsd(value: string): bigint {
  const trimmed = value.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(trimmed)) {
    throw new Error('SOL/USD price must be a positive decimal');
  }
  const [wholePart, fractionPart = ''] = trimmed.split('.');
  const whole = BigInt(wholePart);
  const paddedFraction = (fractionPart + '000000').slice(0, 6);
  const remainder = fractionPart.slice(6);
  const roundedFraction = BigInt(paddedFraction) + (/[1-9]/.test(remainder) ? 1n : 0n);
  return whole * MICRO_USD_PER_USD + roundedFraction;
}

export function computeUsdCentsToLamports(
  usdCents: number,
  solUsdPriceMicroUsd: bigint
): bigint {
  if (!Number.isInteger(usdCents) || usdCents <= 0) {
    throw new Error('usdCents must be a positive integer');
  }
  if (solUsdPriceMicroUsd <= 0n) {
    throw new Error('solUsdPriceMicroUsd must be greater than zero');
  }

  const thresholdMicroUsd = BigInt(usdCents) * 10_000n;
  return ceilDiv(thresholdMicroUsd * LAMPORTS_PER_SOL, solUsdPriceMicroUsd);
}

export function computeMinimumPayoutLamports(
  minPayoutUsdCents: number,
  solUsdPriceMicroUsd: bigint
): bigint {
  return computeUsdCentsToLamports(minPayoutUsdCents, solUsdPriceMicroUsd);
}

function readCoinbaseUsdRate(payload: unknown): string {
  const data = typeof payload === 'object' && payload !== null && 'data' in payload
    ? (payload as { data?: unknown }).data
    : null;
  const rates = typeof data === 'object' && data !== null && 'rates' in data
    ? (data as { rates?: unknown }).rates
    : null;
  const usd = typeof rates === 'object' && rates !== null && 'USD' in rates
    ? (rates as { USD?: unknown }).USD
    : null;
  if (typeof usd !== 'string' || usd.trim() === '') {
    throw new Error('Coinbase SOL/USD response did not include a USD rate');
  }
  return usd;
}

export class SolUsdPriceService {
  async getFreshQuote(ttlMs: number, now = new Date()): Promise<SolUsdPriceQuote | null> {
    const safeTtlMs = Math.max(1_000, Math.floor(ttlMs));
    const nowMs = now.getTime();
    if (cachedQuote && cachedQuote.expiresAtMs > nowMs) {
      return {
        source: cachedQuote.source,
        solUsdPriceMicroUsd: cachedQuote.solUsdPriceMicroUsd,
        observedAt: cachedQuote.observedAt,
      };
    }

    try {
      const response = await fetch(SOL_USD_PRICE_URL, {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Coinbase SOL/USD quote failed with HTTP ${response.status}`);
      }

      const observedAt = new Date();
      const payload = await response.json() as unknown;
      const solUsdPriceMicroUsd = parseUsdDecimalToMicroUsd(readCoinbaseUsdRate(payload));
      const quote = {
        source: SOL_USD_PRICE_SOURCE,
        solUsdPriceMicroUsd,
        observedAt,
        expiresAtMs: observedAt.getTime() + safeTtlMs,
      };
      cachedQuote = quote;
      return {
        source: quote.source,
        solUsdPriceMicroUsd: quote.solUsdPriceMicroUsd,
        observedAt: quote.observedAt,
      };
    } catch (error) {
      loggers.room.warn('SOL/USD price quote unavailable; deferring reward payouts', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  clearCache(): void {
    cachedQuote = null;
  }

  getCachedQuoteSnapshot(ttlMs: number, now = new Date()): SolUsdPriceQuoteSnapshot | null {
    if (!cachedQuote) return null;
    const safeTtlMs = Math.max(1_000, Math.floor(ttlMs));
    const expiresAtMs = cachedQuote.observedAt.getTime() + safeTtlMs;
    return {
      source: cachedQuote.source,
      solUsdPriceMicroUsd: cachedQuote.solUsdPriceMicroUsd.toString(),
      observedAt: cachedQuote.observedAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      fresh: expiresAtMs > now.getTime(),
    };
  }
}

export const solUsdPriceService = new SolUsdPriceService();
