import { Connection, PublicKey } from '@solana/web3.js';
import type { RankedEntryGateMode as PrismaRankedEntryGateMode } from '@prisma/client';
import prisma from '../db';
import { getGameTokenConfig } from '../config/gameToken';

const RANKED_ENTRY_GATE_SETTINGS_ID = 'default';
const DEFAULT_RANKED_ENTRY_TOKEN_SYMBOL = '';
const DEFAULT_RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS = 5 * 1000;
const DEFAULT_RANKED_TOKEN_HOLD_STATUS_CACHE_MS = 30 * 1000;
const RANKED_ENTRY_GATE_CACHE_TTL_MS = 10 * 1000;
const MAX_STATUS_CACHE_ENTRIES = 2_000;

export type RankedEntryGateMode = 'locked' | 'token_required';
type RankedTokenHoldConnectionFactory = (rpcUrl: string) => Connection;

interface RankedEntryGateRow {
  id: string;
  mode: PrismaRankedEntryGateMode;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  requiredTokenAmount: string;
  updatedByUserId: string | null;
  updatedAt: Date;
}

export interface RankedEntryGateAdminView {
  mode: RankedEntryGateMode;
  tokenMintAddress: string | null;
  tokenAddress: string;
  tokenSymbol: string;
  requiredTokenAmount: string;
  cluster: string;
  rpcConfigured: boolean;
  updatedAt: string;
  updatedByUserId: string | null;
}

export interface RankedEntryGateUpdateInput {
  mode: unknown;
  requiredTokenAmount?: unknown;
}

export interface RankedTokenHoldRuntimeConfig {
  mode: RankedEntryGateMode;
  tokenMintAddress: string | null;
  tokenAddress: string;
  tokenSymbol: string;
  requiredTokenAmount: string;
  cluster: string;
  rpcUrl: string;
  rpcTimeoutMs: number;
  statusCacheMs: number;
}

export interface RankedTokenHoldingStatus {
  rankedPlayEligible: true;
  eligible: boolean;
  rewardEligible: boolean;
  mode: RankedEntryGateMode;
  rewardIneligibleReason?:
    | 'reward_gate_disabled'
    | 'wallet_not_linked'
    | 'invalid_wallet'
    | 'reward_gate_unconfigured'
    | 'rpc_unconfigured'
    | 'rpc_unavailable'
    | 'insufficient_balance';
  lockedReason?: string;
  tokenMintAddress: string | null;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number | null;
  requiredTokenAmount: string;
  requiredTokenBaseUnits: string;
  balanceTokenBaseUnits: string;
  cluster: string;
  checkedAt: string;
}

const cachedStatuses = new Map<string, { expiresAt: number; status: RankedTokenHoldingStatus }>();
let rankedEntryGateCache: { value: RankedEntryGateAdminView; expiresAt: number } | null = null;
let lastStatusCleanupAt = 0;
let connectionFactory: RankedTokenHoldConnectionFactory = (rpcUrl) => new Connection(rpcUrl, 'confirmed');

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

function readWholeTokenAmount(value: unknown, options: { requirePositive: boolean }): string {
  const raw = typeof value === 'bigint'
    ? value.toString()
    : typeof value === 'number'
      ? Number.isSafeInteger(value) && value >= 0 ? Math.trunc(value).toString() : ''
      : typeof value === 'string'
        ? value.trim()
        : '';

  if (!raw && !options.requirePositive) return '0';
  if (!/^[0-9]+$/.test(raw)) {
    throw new Error('Required token amount must be a whole number');
  }

  const parsed = BigInt(raw);
  if (options.requirePositive && parsed <= 0n) {
    throw new Error('Required token amount must be greater than zero');
  }

  return parsed.toString();
}

function readGateMode(value: unknown): RankedEntryGateMode {
  if (value === 'locked' || value === 'token_required') return value;
  throw new Error('Invalid ranked reward gate mode');
}

function toGateMode(value: PrismaRankedEntryGateMode): RankedEntryGateMode {
  return value === 'token_required' ? 'token_required' : 'locked';
}

function createDefaultGateData() {
  return {
    id: RANKED_ENTRY_GATE_SETTINGS_ID,
    mode: 'locked' as PrismaRankedEntryGateMode,
    tokenSymbol: DEFAULT_RANKED_ENTRY_TOKEN_SYMBOL,
    requiredTokenAmount: '0',
  };
}

function rpcUrlEnv(): string {
  return process.env.RANKED_TOKEN_HOLD_RPC_URL || process.env.SOLANA_RPC_URL || '';
}

function toRankedEntryGateView(row: RankedEntryGateRow): RankedEntryGateAdminView {
  // Token identity comes from the single global game-token config, never the
  // per-feature row. The row only owns the gate mode + required amount.
  const token = getGameTokenConfig();

  return {
    mode: toGateMode(row.mode),
    tokenMintAddress: token.mintAddress,
    tokenAddress: token.mintAddress ?? '',
    tokenSymbol: token.mintAddress ? token.symbol : '',
    requiredTokenAmount: readWholeTokenAmount(row.requiredTokenAmount, { requirePositive: false }),
    cluster: token.cluster,
    rpcConfigured: token.rpcConfigured,
    updatedAt: row.updatedAt.toISOString(),
    updatedByUserId: row.updatedByUserId,
  };
}

function runtimeConfigFromView(view: RankedEntryGateAdminView): RankedTokenHoldRuntimeConfig {
  return {
    mode: view.mode,
    tokenMintAddress: view.tokenMintAddress,
    tokenAddress: view.tokenAddress,
    tokenSymbol: view.tokenSymbol,
    requiredTokenAmount: view.requiredTokenAmount,
    cluster: view.cluster,
    rpcUrl: rpcUrlEnv(),
    rpcTimeoutMs: intEnv('RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS', DEFAULT_RANKED_TOKEN_HOLD_RPC_TIMEOUT_MS, { min: 1_000, max: 60_000 }),
    statusCacheMs: intEnv('RANKED_TOKEN_HOLD_STATUS_CACHE_MS', DEFAULT_RANKED_TOKEN_HOLD_STATUS_CACHE_MS, { min: 0, max: 5 * 60 * 1000 }),
  };
}

async function ensureRankedEntryGateSettings(): Promise<RankedEntryGateRow> {
  return prisma.rankedEntryGateSettings.upsert({
    where: { id: RANKED_ENTRY_GATE_SETTINGS_ID },
    create: createDefaultGateData(),
    update: {},
  });
}

function clearRankedEntryGateCaches(): void {
  rankedEntryGateCache = null;
  cachedStatuses.clear();
}

export function setRankedTokenHoldConnectionFactoryForTests(factory: RankedTokenHoldConnectionFactory | null): void {
  connectionFactory = factory ?? ((rpcUrl) => new Connection(rpcUrl, 'confirmed'));
  clearRankedEntryGateCaches();
}

export async function getRankedEntryGateSettings(): Promise<RankedEntryGateAdminView> {
  const now = Date.now();
  if (rankedEntryGateCache && rankedEntryGateCache.expiresAt > now) {
    return rankedEntryGateCache.value;
  }

  const value = toRankedEntryGateView(await ensureRankedEntryGateSettings());
  rankedEntryGateCache = {
    value,
    expiresAt: now + RANKED_ENTRY_GATE_CACHE_TTL_MS,
  };
  return value;
}

export async function setRankedEntryGateSettings(
  input: RankedEntryGateUpdateInput,
  updatedByUserId?: string | null
): Promise<RankedEntryGateAdminView> {
  const current = await ensureRankedEntryGateSettings();
  const mode = readGateMode(input.mode);
  const requiredTokenAmount = input.requiredTokenAmount === undefined
    ? readWholeTokenAmount(current.requiredTokenAmount, { requirePositive: mode === 'token_required' })
    : readWholeTokenAmount(input.requiredTokenAmount, { requirePositive: mode === 'token_required' });

  // The game token is configured globally (GAME_TOKEN_MINT); the gate cannot
  // require a token that isn't configured.
  if (mode === 'token_required' && !getGameTokenConfig().mintAddress) {
    throw new Error('A game token (GAME_TOKEN_MINT) must be configured before enabling token-gated ranked');
  }

  const updated = await prisma.rankedEntryGateSettings.update({
    where: { id: RANKED_ENTRY_GATE_SETTINGS_ID },
    data: {
      mode: mode as PrismaRankedEntryGateMode,
      requiredTokenAmount,
      updatedByUserId: updatedByUserId ?? null,
    },
  });

  clearRankedEntryGateCaches();
  return toRankedEntryGateView(updated);
}

export async function getRankedTokenHoldRuntimeConfig(): Promise<RankedTokenHoldRuntimeConfig> {
  return runtimeConfigFromView(await getRankedEntryGateSettings());
}

function statusCacheKey(walletAddress: string | null | undefined, config: RankedTokenHoldRuntimeConfig): string {
  return [
    walletAddress ?? 'no-wallet',
    config.mode,
    config.tokenMintAddress ?? '',
    config.requiredTokenAmount,
    config.cluster,
    config.rpcUrl,
  ].join(':');
}

function cleanupStatusCache(now: number): void {
  if (now - lastStatusCleanupAt < 30_000 && cachedStatuses.size <= MAX_STATUS_CACHE_ENTRIES) return;
  lastStatusCleanupAt = now;

  for (const [key, entry] of cachedStatuses.entries()) {
    if (entry.expiresAt <= now) cachedStatuses.delete(key);
  }

  while (cachedStatuses.size > MAX_STATUS_CACHE_ENTRIES) {
    const oldestKey = cachedStatuses.keys().next().value;
    if (!oldestKey) break;
    cachedStatuses.delete(oldestKey);
  }
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

function calculateRequiredTokenBaseUnits(requiredTokenAmount: string, tokenDecimals: number): bigint {
  return BigInt(requiredTokenAmount) * (10n ** BigInt(tokenDecimals));
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

async function getSplTokenMintDecimals(
  connection: Connection,
  tokenMint: PublicKey,
  timeoutMs: number
): Promise<number> {
  try {
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
  } catch (error) {
    if (error instanceof Error && error.message === 'Ranked token mint returned invalid decimals') throw error;
    throw Object.assign(new Error('Ranked token mint is unavailable from the configured Solana RPC'), { statusCode: 503 });
  }
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

function lockedStatus(config: RankedTokenHoldRuntimeConfig, checkedAt: Date): RankedTokenHoldingStatus {
  return {
    rankedPlayEligible: true,
    eligible: false,
    rewardEligible: false,
    mode: 'locked',
    rewardIneligibleReason: 'reward_gate_disabled',
    lockedReason: 'Ranked SOL rewards are disabled until the token reward requirement is enabled',
    tokenMintAddress: config.tokenMintAddress,
    tokenAddress: config.tokenAddress,
    tokenSymbol: config.tokenSymbol,
    tokenDecimals: null,
    requiredTokenAmount: config.requiredTokenAmount,
    requiredTokenBaseUnits: '0',
    balanceTokenBaseUnits: '0',
    cluster: config.cluster,
    checkedAt: checkedAt.toISOString(),
  };
}

function rewardIneligibleStatus(
  config: RankedTokenHoldRuntimeConfig,
  checkedAt: Date,
  reason: RankedTokenHoldingStatus['rewardIneligibleReason'],
  overrides: Partial<Pick<RankedTokenHoldingStatus, 'tokenDecimals' | 'requiredTokenBaseUnits' | 'balanceTokenBaseUnits'>> = {}
): RankedTokenHoldingStatus {
  return {
    rankedPlayEligible: true,
    eligible: false,
    rewardEligible: false,
    mode: config.mode,
    rewardIneligibleReason: reason,
    tokenMintAddress: config.tokenMintAddress,
    tokenAddress: config.tokenAddress,
    tokenSymbol: config.tokenSymbol,
    tokenDecimals: overrides.tokenDecimals ?? null,
    requiredTokenAmount: config.requiredTokenAmount,
    requiredTokenBaseUnits: overrides.requiredTokenBaseUnits ?? '0',
    balanceTokenBaseUnits: overrides.balanceTokenBaseUnits ?? '0',
    cluster: config.cluster,
    checkedAt: checkedAt.toISOString(),
  };
}

function cacheStatus(cacheKey: string, status: RankedTokenHoldingStatus, now: number, ttlMs: number): RankedTokenHoldingStatus {
  if (ttlMs > 0) {
    cachedStatuses.set(cacheKey, { expiresAt: now + ttlMs, status });
  }
  return status;
}

export async function getRankedTokenHoldingStatus(walletAddress?: string | null): Promise<RankedTokenHoldingStatus> {
  const config = await getRankedTokenHoldRuntimeConfig();
  const checkedAt = new Date();
  const now = checkedAt.getTime();
  const cacheKey = statusCacheKey(walletAddress, config);
  cleanupStatusCache(now);

  if (config.statusCacheMs > 0) {
    const cached = cachedStatuses.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.status;
    }
  }

  if (config.mode === 'locked') {
    return cacheStatus(cacheKey, lockedStatus(config, checkedAt), now, config.statusCacheMs);
  }

  if (!walletAddress) {
    return cacheStatus(
      cacheKey,
      rewardIneligibleStatus(config, checkedAt, 'wallet_not_linked'),
      now,
      config.statusCacheMs
    );
  }
  if (!config.tokenMintAddress || BigInt(config.requiredTokenAmount) <= 0n) {
    return cacheStatus(
      cacheKey,
      rewardIneligibleStatus(config, checkedAt, 'reward_gate_unconfigured'),
      now,
      config.statusCacheMs
    );
  }
  if (!config.rpcUrl) {
    return cacheStatus(
      cacheKey,
      rewardIneligibleStatus(config, checkedAt, 'rpc_unconfigured'),
      now,
      config.statusCacheMs
    );
  }

  let publicKey: PublicKey;
  try {
    publicKey = parseWalletAddress(walletAddress);
  } catch {
    return cacheStatus(
      cacheKey,
      rewardIneligibleStatus(config, checkedAt, 'invalid_wallet'),
      now,
      config.statusCacheMs
    );
  }

  let tokenMint: PublicKey;
  try {
    tokenMint = new PublicKey(config.tokenMintAddress);
  } catch {
    return cacheStatus(
      cacheKey,
      rewardIneligibleStatus(config, checkedAt, 'reward_gate_unconfigured'),
      now,
      config.statusCacheMs
    );
  }

  let connection: Connection;
  try {
    connection = connectionFactory(config.rpcUrl);
  } catch {
    return cacheStatus(
      cacheKey,
      rewardIneligibleStatus(config, checkedAt, 'rpc_unavailable'),
      now,
      config.statusCacheMs
    );
  }

  let balance: TokenHoldingBalance;
  try {
    balance = await getSplTokenBalance(connection, publicKey, tokenMint, config.rpcTimeoutMs);
  } catch {
    return cacheStatus(
      cacheKey,
      rewardIneligibleStatus(config, checkedAt, 'rpc_unavailable'),
      now,
      config.statusCacheMs
    );
  }

  const requiredTokenBaseUnits = calculateRequiredTokenBaseUnits(config.requiredTokenAmount, balance.decimals);
  const rewardEligible = balance.balanceBaseUnits >= requiredTokenBaseUnits;
  const status: RankedTokenHoldingStatus = {
    rankedPlayEligible: true,
    eligible: rewardEligible,
    rewardEligible,
    mode: 'token_required',
    rewardIneligibleReason: rewardEligible ? undefined : 'insufficient_balance',
    tokenMintAddress: config.tokenMintAddress,
    tokenAddress: config.tokenAddress,
    tokenSymbol: config.tokenSymbol,
    tokenDecimals: balance.decimals,
    requiredTokenAmount: config.requiredTokenAmount,
    requiredTokenBaseUnits: requiredTokenBaseUnits.toString(),
    balanceTokenBaseUnits: balance.balanceBaseUnits.toString(),
    cluster: config.cluster,
    checkedAt: checkedAt.toISOString(),
  };

  return cacheStatus(cacheKey, status, now, config.statusCacheMs);
}
