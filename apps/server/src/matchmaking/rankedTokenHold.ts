import { Connection, PublicKey } from '@solana/web3.js';
import { envFlag } from '../config/security';

const MICRO_USD_PER_USD = 1_000_000n;
const MICRO_USD_PER_CENT = 10_000n;
export const RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const DEFAULT_RANKED_TOKEN_HOLD_USD_CENTS = 2_000;
const DEFAULT_RANKED_TOKEN_HOLD_PRICE_STALE_MS = 60 * 1000;
const DEFAULT_RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS = 5 * 1000;

type RankedTokenPriceSource = 'env' | 'coingecko';

interface CachedPrice {
  source: RankedTokenPriceSource;
  tokenAddress: string;
  tokenUsdPriceMicroUsd: bigint;
  fetchedAt: number;
}

let cachedPrice: CachedPrice | null = null;

export interface RankedTokenHoldRuntimeConfig {
  enabled: boolean;
  tokenAddress: string;
  tokenSymbol: string;
  usdCents: number;
  cluster: string;
  rpcUrl: string;
  priceSource: RankedTokenPriceSource;
  priceStaleMs: number;
  rpcTimeoutMs: number;
}

export interface RankedTokenHoldingStatus {
  eligible: boolean;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number | null;
  usdCents: number;
  tokenUsdPrice: string;
  tokenUsdPriceMicroUsd: string;
  requiredTokenBaseUnits: string;
  balanceTokenBaseUnits: string;
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

function rankedTokenAddressEnv(): string {
  const raw = process.env.RANKED_TOKEN_HOLD_TOKEN_ADDRESS
    || RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS;

  let tokenAddress: string;
  try {
    tokenAddress = new PublicKey(raw).toBase58();
  } catch {
    throw new Error('RANKED_TOKEN_HOLD_TOKEN_ADDRESS must be a valid Solana token address');
  }

  return tokenAddress;
}

function rankedTokenSymbolEnv(tokenAddress: string): string {
  const fallback = tokenAddress === RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS ? 'SOL' : 'TOKEN';
  const raw = (process.env.RANKED_TOKEN_HOLD_TOKEN_SYMBOL || fallback).trim().replace(/^\$/, '').toUpperCase();

  if (!/^[A-Z0-9]{1,12}$/.test(raw)) {
    throw new Error('RANKED_TOKEN_HOLD_TOKEN_SYMBOL must be 1-12 letters or numbers');
  }

  return raw;
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

function tokenBaseUnitScale(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Token decimals must be an integer between 0 and 255');
  }
  return 10n ** BigInt(decimals);
}

function calculateRequiredTokenBaseUnits(usdCents: number, tokenUsdPriceMicroUsd: bigint, tokenDecimals: number): bigint {
  const requiredMicroUsd = BigInt(usdCents) * MICRO_USD_PER_CENT;
  return ceilDiv(requiredMicroUsd * tokenBaseUnitScale(tokenDecimals), tokenUsdPriceMicroUsd);
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
  const tokenAddress = rankedTokenAddressEnv();

  return {
    enabled: envFlag('RANKED_TOKEN_HOLD_ENABLED', true),
    tokenAddress,
    tokenSymbol: rankedTokenSymbolEnv(tokenAddress),
    usdCents: intEnv('RANKED_TOKEN_HOLD_USD_CENTS', DEFAULT_RANKED_TOKEN_HOLD_USD_CENTS, { min: 1, max: 1_000_000 }),
    cluster: process.env.SOLANA_CLUSTER || 'mainnet-beta',
    rpcUrl: process.env.RANKED_TOKEN_HOLD_RPC_URL || process.env.SOLANA_RPC_URL || '',
    priceSource: normalizePriceSource(process.env.RANKED_TOKEN_HOLD_PRICE_SOURCE),
    priceStaleMs: intEnv('RANKED_TOKEN_HOLD_PRICE_STALE_MS', DEFAULT_RANKED_TOKEN_HOLD_PRICE_STALE_MS, { min: 5_000, max: 60 * 60 * 1000 }),
    rpcTimeoutMs: intEnv('RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS', DEFAULT_RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS, { min: 1_000, max: 60_000 }),
  };
}

async function fetchEnvPriceMicroUsd(): Promise<bigint> {
  const explicitMicro = process.env.RANKED_TOKEN_HOLD_TOKEN_USD_MICRO_USD;
  if (explicitMicro) {
    if (!/^[0-9]+$/.test(explicitMicro)) {
      throw new Error('RANKED_TOKEN_HOLD_TOKEN_USD_MICRO_USD must be an unsigned integer');
    }
    const parsed = BigInt(explicitMicro);
    if (parsed <= 0n) {
      throw new Error('RANKED_TOKEN_HOLD_TOKEN_USD_MICRO_USD must be greater than zero');
    }
    return parsed;
  }

  const decimal = process.env.RANKED_TOKEN_HOLD_TOKEN_USD_PRICE;
  if (!decimal) {
    throw new Error('RANKED_TOKEN_HOLD_TOKEN_USD_PRICE is required when RANKED_TOKEN_HOLD_PRICE_SOURCE=env');
  }
  return parseDecimalToMicroUsd(decimal, 'RANKED_TOKEN_HOLD_TOKEN_USD_PRICE');
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`CoinGecko responded with HTTP ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function coingeckoUsdPrice(payload: unknown, tokenAddress: string): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const direct = data[tokenAddress] ?? data[tokenAddress.toLowerCase()];
  const candidates = [
    direct,
    ...Object.values(data),
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const price = (candidate as { usd?: unknown }).usd;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) return price;
  }

  return null;
}

async function fetchCoingeckoPriceMicroUsd(tokenAddress: string): Promise<bigint> {
  const payload = tokenAddress === RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS
    ? await fetchJsonWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', 5_000)
    : await fetchJsonWithTimeout(`https://api.coingecko.com/api/v3/simple/token_price/solana?contract_addresses=${encodeURIComponent(tokenAddress)}&vs_currencies=usd`, 5_000);
  const price = tokenAddress === RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS
    ? (payload as { solana?: { usd?: unknown } })?.solana?.usd
    : coingeckoUsdPrice(payload, tokenAddress);

  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    throw new Error('CoinGecko response did not include a usable token/USD price');
  }

  return parseDecimalToMicroUsd(price.toFixed(6), 'CoinGecko token/USD price');
}

async function resolveTokenUsdPriceMicroUsd(config: RankedTokenHoldRuntimeConfig): Promise<bigint> {
  const now = Date.now();
  if (
    cachedPrice
    && cachedPrice.source === config.priceSource
    && cachedPrice.tokenAddress === config.tokenAddress
    && now - cachedPrice.fetchedAt <= config.priceStaleMs
  ) {
    return cachedPrice.tokenUsdPriceMicroUsd;
  }

  const tokenUsdPriceMicroUsd = config.priceSource === 'coingecko'
    ? await fetchCoingeckoPriceMicroUsd(config.tokenAddress)
    : await fetchEnvPriceMicroUsd();

  cachedPrice = {
    source: config.priceSource,
    tokenAddress: config.tokenAddress,
    tokenUsdPriceMicroUsd,
    fetchedAt: now,
  };
  return tokenUsdPriceMicroUsd;
}

async function withTimeout<T>(promise: Promise<T>, message: string, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

interface TokenHoldingBalance {
  balanceBaseUnits: bigint;
  decimals: number;
}

function parseTokenAccountBalance(account: unknown, expectedMint: string): TokenHoldingBalance | null {
  if (!account || typeof account !== 'object') return null;
  const data = (account as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const parsed = (data as { parsed?: unknown }).parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  const info = (parsed as { info?: unknown }).info;
  if (!info || typeof info !== 'object') return null;
  if ((info as { mint?: unknown }).mint !== expectedMint) return null;
  const tokenAmount = (info as { tokenAmount?: unknown }).tokenAmount;
  if (!tokenAmount || typeof tokenAmount !== 'object') return null;

  const amount = (tokenAmount as { amount?: unknown }).amount;
  const decimals = (tokenAmount as { decimals?: unknown }).decimals;
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) return null;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) return null;

  return {
    balanceBaseUnits: BigInt(amount),
    decimals,
  };
}

async function getNativeSolBalance(
  connection: Connection,
  walletAddress: PublicKey,
  timeoutMs: number
): Promise<TokenHoldingBalance> {
  const balance = await withTimeout(
    connection.getBalance(walletAddress, 'confirmed'),
    'Timed out checking ranked SOL balance',
    timeoutMs
  );

  return {
    balanceBaseUnits: BigInt(balance),
    decimals: 9,
  };
}

async function getSplTokenMintDecimals(
  connection: Connection,
  tokenMint: PublicKey,
  timeoutMs: number
): Promise<number> {
  const supply = await withTimeout(
    connection.getTokenSupply(tokenMint, 'confirmed'),
    'Timed out checking ranked token mint',
    timeoutMs
  );
  const decimals = supply.value.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Ranked token mint returned invalid decimals');
  }
  return decimals;
}

async function getSplTokenBalance(
  connection: Connection,
  walletAddress: PublicKey,
  tokenMint: PublicKey,
  timeoutMs: number
): Promise<TokenHoldingBalance> {
  const tokenAccounts = await withTimeout(
    connection.getParsedTokenAccountsByOwner(walletAddress, { mint: tokenMint }, 'confirmed'),
    'Timed out checking ranked token balance',
    timeoutMs
  );

  let balanceBaseUnits = 0n;
  let decimals: number | null = null;
  for (const tokenAccount of tokenAccounts.value) {
    const parsedBalance = parseTokenAccountBalance(tokenAccount.account, tokenMint.toBase58());
    if (!parsedBalance) continue;
    balanceBaseUnits += parsedBalance.balanceBaseUnits;
    decimals = parsedBalance.decimals;
  }

  return {
    balanceBaseUnits,
    decimals: decimals ?? await getSplTokenMintDecimals(connection, tokenMint, timeoutMs),
  };
}

export async function getRankedTokenHoldingStatus(walletAddress: string): Promise<RankedTokenHoldingStatus> {
  const config = getRankedTokenHoldRuntimeConfig();
  const checkedAt = new Date();

  if (!config.enabled) {
    return {
      eligible: true,
      tokenAddress: config.tokenAddress,
      tokenSymbol: config.tokenSymbol,
      tokenDecimals: null,
      usdCents: config.usdCents,
      tokenUsdPrice: '0',
      tokenUsdPriceMicroUsd: '0',
      requiredTokenBaseUnits: '0',
      balanceTokenBaseUnits: '0',
      cluster: config.cluster,
      priceSource: config.priceSource,
      checkedAt: checkedAt.toISOString(),
    };
  }

  if (!config.rpcUrl) {
    throw Object.assign(new Error('SOLANA_RPC_URL is required for ranked SOL holding checks'), { statusCode: 503 });
  }

  const publicKey = parseWalletAddress(walletAddress);
  const tokenMint = new PublicKey(config.tokenAddress);
  const connection = new Connection(config.rpcUrl, 'confirmed');
  const balance = config.tokenAddress === RANKED_TOKEN_HOLD_NATIVE_SOL_ADDRESS
    ? await getNativeSolBalance(connection, publicKey, config.rpcTimeoutMs)
    : await getSplTokenBalance(connection, publicKey, tokenMint, config.rpcTimeoutMs);
  const tokenUsdPriceMicroUsd = await resolveTokenUsdPriceMicroUsd(config);
  const requiredTokenBaseUnits = calculateRequiredTokenBaseUnits(
    config.usdCents,
    tokenUsdPriceMicroUsd,
    balance.decimals
  );

  return {
    eligible: balance.balanceBaseUnits >= requiredTokenBaseUnits,
    tokenAddress: config.tokenAddress,
    tokenSymbol: config.tokenSymbol,
    tokenDecimals: balance.decimals,
    usdCents: config.usdCents,
    tokenUsdPrice: formatMicroUsd(tokenUsdPriceMicroUsd),
    tokenUsdPriceMicroUsd: tokenUsdPriceMicroUsd.toString(),
    requiredTokenBaseUnits: requiredTokenBaseUnits.toString(),
    balanceTokenBaseUnits: balance.balanceBaseUnits.toString(),
    cluster: config.cluster,
    priceSource: config.priceSource,
    checkedAt: checkedAt.toISOString(),
  };
}

export async function assertRankedTokenHoldingEligibility(walletAddress: string): Promise<RankedTokenHoldingStatus> {
  const status = await getRankedTokenHoldingStatus(walletAddress);
  if (!status.eligible) {
    throw Object.assign(
      new Error(`Ranked requires holding at least ${formatUsdCents(status.usdCents)} worth of the configured token`),
      { statusCode: 403, tokenHold: status }
    );
  }
  return status;
}
