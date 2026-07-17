import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Connection, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  getHeroSkinDefinition,
  isMarketplaceTradeableSkin,
  isHeroSkinId,
  type HeroSkinId,
  type MarketplaceListingSnapshot,
  type MarketplaceListingsResponse,
  type MarketplacePurchaseIntentSnapshot,
  type MarketplacePurchaseTransactionSnapshot,
  type MarketplaceSettingsSnapshot,
  type MarketplaceStateResponse,
} from '@voxel-strike/shared';
import prisma from '../db';
import { getGameTokenConfig } from '../config/gameToken';
import { assertSolanaPublicKey, signatureLooksValid } from '../cosmetics/tokenPayments';
import { MEMO_PROGRAM_ID, verifyParsedSolPayment } from '../wagers/solana';

export const MARKETPLACE_PAYMENT_MEMO_PREFIX = 'opus-market:';

const MARKETPLACE_SETTINGS_ID = 'default';
const SETTINGS_CACHE_TTL_MS = 5_000;
const DEFAULT_INTENT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_INTENT_EXPIRY_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_RPC_TIMEOUT_MS = 12_000;
const MAX_HOLD_TOKENS = 10n ** 12n;
const MIN_PRICE_LAMPORTS = 1_000_000n; // 0.001 SOL
const MAX_PRICE_LAMPORTS = 10_000n * 1_000_000_000n; // 10,000 SOL
const BALANCE_CACHE_TTL_MS = 30_000;
const MAX_BALANCE_CACHE_ENTRIES = 500;
const BROWSE_LISTINGS_LIMIT = 200;

type MarketplaceConnectionFactory = (rpcUrl: string) => Connection;

let marketplaceConnectionFactory: MarketplaceConnectionFactory = (rpcUrl) => new Connection(rpcUrl, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: DEFAULT_RPC_TIMEOUT_MS,
});

export function setMarketplaceConnectionFactoryForTests(factory: MarketplaceConnectionFactory | null): void {
  marketplaceConnectionFactory = factory ?? ((rpcUrl) => new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: DEFAULT_RPC_TIMEOUT_MS,
  }));
}

export class MarketplaceServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'MarketplaceServiceError';
    this.statusCode = statusCode;
  }
}

function isSerializableTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export function createMarketplacePaymentMemo(intentId: string): string {
  return `${MARKETPLACE_PAYMENT_MEMO_PREFIX}${intentId}`;
}

function readSolanaRpcUrl(): string | null {
  return process.env.SOLANA_RPC_URL?.trim() || null;
}

type MarketplaceSettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.marketplaceSettings.findUnique>>>;

let settingsCache: { value: MarketplaceSettingsRow; expiresAt: number } | null = null;

export function clearMarketplaceSettingsCache(): void {
  settingsCache = null;
}

async function getOrCreateMarketplaceSettings(): Promise<MarketplaceSettingsRow> {
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) return settingsCache.value;

  await prisma.marketplaceSettings.createMany({
    data: [{ id: MARKETPLACE_SETTINGS_ID }],
    skipDuplicates: true,
  });
  const settings = await prisma.marketplaceSettings.findUnique({ where: { id: MARKETPLACE_SETTINGS_ID } });
  if (!settings) {
    throw new MarketplaceServiceError('Marketplace settings could not be initialized', 500);
  }
  settingsCache = { value: settings, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return settings;
}

export function serializeMarketplaceSettings(settings: MarketplaceSettingsRow): MarketplaceSettingsSnapshot {
  return {
    enabled: settings.enabled,
    listingHoldTokens: settings.listingHoldTokens,
    updatedByUserId: settings.updatedByUserId,
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function readHoldTokens(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new MarketplaceServiceError('Listing hold must be a whole game-token amount');
  }
  const text = String(value).trim().replace(/,/g, '');
  if (!/^[0-9]+$/.test(text)) {
    throw new MarketplaceServiceError('Listing hold must be a whole game-token amount');
  }
  const parsed = BigInt(text);
  if (parsed < 0n) {
    throw new MarketplaceServiceError('Listing hold cannot be negative');
  }
  if (parsed > MAX_HOLD_TOKENS) {
    throw new MarketplaceServiceError(`Listing hold cannot exceed ${MAX_HOLD_TOKENS}`);
  }
  return parsed.toString();
}

export async function updateMarketplaceSettings(input: {
  enabled?: unknown;
  listingHoldTokens?: unknown;
  updatedByUserId: string;
}): Promise<MarketplaceSettingsSnapshot> {
  await getOrCreateMarketplaceSettings();

  const data: Prisma.MarketplaceSettingsUpdateInput = { updatedByUserId: input.updatedByUserId };
  if (input.enabled !== undefined) data.enabled = input.enabled === true;
  if (input.listingHoldTokens !== undefined) data.listingHoldTokens = readHoldTokens(input.listingHoldTokens);

  const updated = await prisma.marketplaceSettings.update({
    where: { id: MARKETPLACE_SETTINGS_ID },
    data,
  });
  clearMarketplaceSettingsCache();
  return serializeMarketplaceSettings(updated);
}

interface MarketplaceRuntime {
  settings: MarketplaceSettingsRow;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  cluster: string;
  rpcUrl: string | null;
}

async function loadMarketplaceRuntime(): Promise<MarketplaceRuntime> {
  const settings = await getOrCreateMarketplaceSettings();
  const token = getGameTokenConfig();
  return {
    settings,
    tokenMintAddress: token.mintAddress,
    tokenSymbol: token.symbol,
    cluster: token.cluster,
    rpcUrl: readSolanaRpcUrl(),
  };
}

function connectionForMarketplace(runtime: Pick<MarketplaceRuntime, 'rpcUrl'>): Connection {
  if (!runtime.rpcUrl) throw new MarketplaceServiceError('SOLANA_RPC_URL is not configured', 503);
  return marketplaceConnectionFactory(runtime.rpcUrl);
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

async function getMintDecimals(connection: Connection, tokenMint: PublicKey): Promise<number> {
  const supply = await withTimeout(
    connection.getTokenSupply(tokenMint, 'confirmed'),
    'Timed out reading the game token mint',
    DEFAULT_RPC_TIMEOUT_MS
  );
  const decimals = supply.value.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new MarketplaceServiceError('Game token mint returned invalid decimals', 503);
  }
  return decimals;
}

const balanceCache = new Map<string, { value: TokenHoldingBalance; expiresAt: number }>();

function cleanupBalanceCache(now: number): void {
  if (balanceCache.size <= MAX_BALANCE_CACHE_ENTRIES) return;
  for (const [key, entry] of balanceCache.entries()) {
    if (entry.expiresAt <= now) balanceCache.delete(key);
  }
  while (balanceCache.size > MAX_BALANCE_CACHE_ENTRIES) {
    const oldestKey = balanceCache.keys().next().value;
    if (!oldestKey) break;
    balanceCache.delete(oldestKey);
  }
}

export function clearMarketplaceBalanceCacheForTests(): void {
  balanceCache.clear();
}

async function getGameTokenBalance(
  connection: Connection,
  walletAddress: string,
  tokenMintAddress: string,
  options: { bypassCache?: boolean } = {}
): Promise<TokenHoldingBalance> {
  const cacheKey = `${walletAddress}:${tokenMintAddress}`;
  const now = Date.now();
  if (!options.bypassCache) {
    const cached = balanceCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;
  }

  const wallet = assertSolanaPublicKey(walletAddress, 'walletAddress');
  const mint = assertSolanaPublicKey(tokenMintAddress, 'tokenMintAddress');
  const tokenAccounts = await withTimeout(
    connection.getParsedTokenAccountsByOwner(wallet, { mint }, 'confirmed'),
    'Timed out checking the game token balance',
    DEFAULT_RPC_TIMEOUT_MS
  );

  let balanceBaseUnits = 0n;
  let decimals: number | null = null;
  for (const tokenAccount of tokenAccounts.value) {
    const parsedBalance = parseTokenAccountBalance(tokenAccount.account, mint.toBase58());
    if (!parsedBalance) continue;
    balanceBaseUnits += parsedBalance.balanceBaseUnits;
    decimals = parsedBalance.decimals;
  }

  const value: TokenHoldingBalance = {
    balanceBaseUnits,
    decimals: decimals ?? await getMintDecimals(connection, mint),
  };
  balanceCache.set(cacheKey, { value, expiresAt: now + BALANCE_CACHE_TTL_MS });
  cleanupBalanceCache(now);
  return value;
}

function holdBaseUnits(listingHoldTokens: string, decimals: number): bigint {
  return BigInt(listingHoldTokens) * (10n ** BigInt(decimals));
}

function isListableSkinId(skinId: string): skinId is HeroSkinId {
  if (!isHeroSkinId(skinId)) return false;
  return isMarketplaceTradeableSkin(getHeroSkinDefinition(skinId));
}

export async function getMarketplaceStateForUser(user?: {
  id: string;
  walletAddress: string | null;
} | null): Promise<MarketplaceStateResponse> {
  const runtime = await loadMarketplaceRuntime();

  let tokenDecimals: number | null = null;
  let balance: TokenHoldingBalance | null = null;
  if (runtime.tokenMintAddress && runtime.rpcUrl) {
    const connection = connectionForMarketplace(runtime);
    try {
      if (user?.walletAddress) {
        balance = await getGameTokenBalance(connection, user.walletAddress, runtime.tokenMintAddress);
        tokenDecimals = balance.decimals;
      } else {
        tokenDecimals = await getMintDecimals(connection, assertSolanaPublicKey(runtime.tokenMintAddress, 'tokenMintAddress'));
      }
    } catch {
      tokenDecimals = null;
      balance = null;
    }
  }

  const requiredBaseUnits = tokenDecimals === null
    ? null
    : holdBaseUnits(runtime.settings.listingHoldTokens, tokenDecimals);

  let listDisabledReason: string | null = null;
  if (!runtime.settings.enabled) listDisabledReason = 'The marketplace is currently disabled';
  else if (!runtime.tokenMintAddress) listDisabledReason = 'Game token mint is not configured';
  else if (!runtime.rpcUrl) listDisabledReason = 'SOLANA_RPC_URL is not configured';
  else if (!user) listDisabledReason = 'Sign in to list skins';
  else if (!user.walletAddress) listDisabledReason = 'Link a Solana wallet to list skins';
  else if (balance === null || requiredBaseUnits === null) listDisabledReason = 'Game token balance is unavailable right now';
  else if (balance.balanceBaseUnits < requiredBaseUnits) {
    listDisabledReason = `Hold at least ${Number(runtime.settings.listingHoldTokens).toLocaleString('en-US')} $${runtime.tokenSymbol} to list skins`;
  }

  return {
    enabled: runtime.settings.enabled,
    cluster: runtime.cluster,
    rpcConfigured: Boolean(runtime.rpcUrl),
    tokenSymbol: runtime.tokenMintAddress ? runtime.tokenSymbol : '',
    listingHoldTokens: runtime.settings.listingHoldTokens,
    listingHoldTokenBaseUnits: requiredBaseUnits?.toString() ?? null,
    tokenDecimals,
    holdBalanceTokenBaseUnits: balance?.balanceBaseUnits.toString() ?? null,
    canList: listDisabledReason === null,
    listDisabledReason,
  };
}

type MarketplaceListingRecord = NonNullable<Awaited<ReturnType<typeof prisma.marketplaceListing.findUnique>>>;

function serializeListing(
  listing: MarketplaceListingRecord & { seller?: { name: string } | null },
  viewerUserId?: string | null
): MarketplaceListingSnapshot {
  return {
    listingId: listing.id,
    skinId: listing.skinId as HeroSkinId,
    priceLamports: listing.priceLamports.toString(),
    status: listing.status as MarketplaceListingSnapshot['status'],
    sellerUserId: listing.sellerUserId,
    sellerName: listing.seller?.name ?? '',
    isOwn: Boolean(viewerUserId && listing.sellerUserId === viewerUserId),
    createdAt: listing.createdAt.toISOString(),
    soldAt: listing.soldAt?.toISOString() ?? null,
  };
}

function readPriceLamports(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new MarketplaceServiceError('Price must be a whole lamport amount');
  }
  const text = String(value).trim().replace(/,/g, '');
  if (!/^[0-9]+$/.test(text)) {
    throw new MarketplaceServiceError('Price must be a whole lamport amount');
  }
  const parsed = BigInt(text);
  if (parsed < MIN_PRICE_LAMPORTS) {
    throw new MarketplaceServiceError('Price must be at least 0.001 SOL');
  }
  if (parsed > MAX_PRICE_LAMPORTS) {
    throw new MarketplaceServiceError('Price cannot exceed 10,000 SOL');
  }
  return parsed;
}

// Releases only intents that provably cannot settle. Submitted payments are
// never released by wall-clock age; the reconciliation worker first proves
// their blockhash expired or finalizes the on-chain payment.
export async function releaseStaleListingReservations(listingId?: string): Promise<void> {
  const now = new Date();
  const stale = await prisma.marketplaceListing.findMany({
    where: {
      status: 'pending_sale',
      reservedUntil: { lt: now },
      ...(listingId ? { id: listingId } : {}),
    },
    select: { id: true, reservedIntentId: true, reservedUntil: true },
    take: 25,
  });

  for (const listing of stale) {
    if (!listing.reservedIntentId) continue;
    const intent = await prisma.marketplacePurchaseIntent.findUnique({
      where: { id: listing.reservedIntentId },
      select: { id: true, status: true },
    });
    if (!intent) continue;

    let release = false;
    if (intent.status === 'intent_created' || intent.status === 'transaction_built') {
      await prisma.marketplacePurchaseIntent.updateMany({
        where: { id: intent.id, status: { in: ['intent_created', 'transaction_built'] } },
        data: { status: 'expired', activeBuyerSkinKey: null, lastError: 'intent_expired' },
      });
      release = true;
    } else if (intent.status === 'expired' || intent.status === 'failed') {
      await prisma.marketplacePurchaseIntent.updateMany({
        where: { id: intent.id, status: { in: ['expired', 'failed'] } },
        data: { activeBuyerSkinKey: null },
      });
      release = true;
    }

    if (release) {
      await prisma.marketplaceListing.updateMany({
        where: { id: listing.id, status: 'pending_sale', reservedIntentId: listing.reservedIntentId },
        data: { status: 'active', reservedIntentId: null, reservedUntil: null },
      });
    }
  }
}

export async function getMarketplaceListings(viewerUserId?: string | null): Promise<MarketplaceListingsResponse> {
  await releaseStaleListingReservations();
  const listings = await prisma.marketplaceListing.findMany({
    where: { status: 'active' },
    orderBy: { createdAt: 'desc' },
    take: BROWSE_LISTINGS_LIMIT,
    include: { seller: { select: { name: true } } },
  });
  return {
    listings: listings.map((listing) => serializeListing(listing, viewerUserId)),
  };
}

export async function getMyMarketplaceListings(userId: string): Promise<MarketplaceListingsResponse> {
  await releaseStaleListingReservations();
  const listings = await prisma.marketplaceListing.findMany({
    where: {
      sellerUserId: userId,
      OR: [
        { status: { in: ['active', 'pending_sale'] } },
        { status: { in: ['sold', 'canceled'] }, updatedAt: { gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: BROWSE_LISTINGS_LIMIT,
    include: { seller: { select: { name: true } } },
  });
  return {
    listings: listings.map((listing) => serializeListing(listing, userId)),
  };
}

export async function createMarketplaceListing(input: {
  userId: string;
  skinId: unknown;
  priceLamports: unknown;
}): Promise<MarketplaceListingSnapshot> {
  const runtime = await loadMarketplaceRuntime();
  if (!runtime.settings.enabled) {
    throw new MarketplaceServiceError('The marketplace is currently disabled', 403);
  }
  if (!runtime.tokenMintAddress) {
    throw new MarketplaceServiceError('Game token mint is not configured', 503);
  }
  if (!runtime.rpcUrl) {
    throw new MarketplaceServiceError('SOLANA_RPC_URL is not configured', 503);
  }

  if (typeof input.skinId !== 'string' || !isListableSkinId(input.skinId)) {
    throw new MarketplaceServiceError('This skin cannot be listed on the marketplace');
  }
  const skinId = input.skinId;
  const priceLamports = readPriceLamports(input.priceLamports);

  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, walletAddress: true },
  });
  if (!user) {
    throw new MarketplaceServiceError('Sign in to list skins', 401);
  }
  if (!user.walletAddress) {
    throw new MarketplaceServiceError('Link a Solana wallet to receive SOL from sales', 400);
  }
  const sellerWalletAddress = assertSolanaPublicKey(user.walletAddress, 'walletAddress').toBase58();

  const [ownership, existingListing] = await Promise.all([
    prisma.userSkinOwnership.findUnique({
      where: { userId_skinId: { userId: input.userId, skinId } },
      select: { id: true, revokedAt: true },
    }),
    prisma.marketplaceListing.findFirst({
      where: {
        sellerUserId: input.userId,
        skinId,
        status: { in: ['active', 'pending_sale'] },
      },
      select: { id: true },
    }),
  ]);
  if (existingListing) {
    throw new MarketplaceServiceError('This skin is already listed', 409);
  }
  if (!ownership || ownership.revokedAt) {
    throw new MarketplaceServiceError('You do not own that skin', 403);
  }

  // The 200k-token (configurable) listing gate: checked live on-chain.
  const connection = connectionForMarketplace(runtime);
  const balance = await getGameTokenBalance(connection, sellerWalletAddress, runtime.tokenMintAddress, { bypassCache: true });
  const requiredBaseUnits = holdBaseUnits(runtime.settings.listingHoldTokens, balance.decimals);
  if (balance.balanceBaseUnits < requiredBaseUnits) {
    throw new MarketplaceServiceError(
      `Hold at least ${Number(runtime.settings.listingHoldTokens).toLocaleString('en-US')} $${runtime.tokenSymbol} to list skins`,
      403
    );
  }

  const listing = await (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const currentOwnership = await tx.userSkinOwnership.findUnique({
          where: { userId_skinId: { userId: input.userId, skinId } },
          select: { id: true, revokedAt: true },
        });
        if (!currentOwnership || currentOwnership.revokedAt) {
          throw new MarketplaceServiceError('You do not own that skin', 403);
        }
        const existing = await tx.marketplaceListing.findFirst({
          where: {
            sellerUserId: input.userId,
            skinId,
            status: { in: ['active', 'pending_sale'] },
          },
          select: { id: true },
        });
        if (existing) {
          throw new MarketplaceServiceError('This skin is already listed', 409);
        }
        const escrowedAt = new Date();
        return tx.marketplaceListing.create({
          data: {
            sellerUserId: input.userId,
            sellerWalletAddress,
            skinId,
            priceLamports,
            status: 'active',
            escrowedOwnershipId: currentOwnership.id,
            escrowedAt,
          },
          include: { seller: { select: { name: true } } },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializableTransactionConflict(error)) {
        throw new MarketplaceServiceError('Listing changed; try again', 409);
      }
      throw error;
    }
  })();

  return serializeListing(listing, input.userId);
}

export async function cancelMarketplaceListing(input: {
  userId: string;
  listingId: string;
}): Promise<MarketplaceListingSnapshot> {
  await releaseStaleListingReservations(input.listingId);
  const listing = await prisma.marketplaceListing.findUnique({
    where: { id: input.listingId },
  });
  if (!listing || listing.sellerUserId !== input.userId) {
    throw new MarketplaceServiceError('Listing not found', 404);
  }
  if (listing.status === 'pending_sale') {
    throw new MarketplaceServiceError('A buyer is completing this purchase; try again shortly', 409);
  }
  if (listing.status !== 'active') {
    throw new MarketplaceServiceError('Listing is no longer active', 409);
  }

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.marketplaceListing.findUnique({ where: { id: listing.id } });
      if (!current || current.status !== 'active') {
        throw new MarketplaceServiceError('Listing is no longer active', 409);
      }
      if (!current.escrowedOwnershipId || !current.escrowedAt) {
        throw new MarketplaceServiceError('Listing escrow is unavailable; contact support', 409);
      }
      const escrowedOwnership = await tx.userSkinOwnership.findUnique({
        where: { id: current.escrowedOwnershipId },
      });
      if (
        !escrowedOwnership
        || escrowedOwnership.userId !== current.sellerUserId
        || escrowedOwnership.skinId !== current.skinId
        || escrowedOwnership.revokedAt
      ) {
        throw new MarketplaceServiceError('Listing escrow is invalid; contact support', 409);
      }
      await tx.marketplaceListing.update({
        where: { id: current.id },
        data: {
          status: 'canceled',
          canceledAt: new Date(),
          escrowedOwnershipId: null,
          escrowedAt: null,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (isSerializableTransactionConflict(error)) {
      throw new MarketplaceServiceError('Listing changed; try again', 409);
    }
    throw error;
  }

  const updated = await prisma.marketplaceListing.findUnique({
    where: { id: listing.id },
    include: { seller: { select: { name: true } } },
  });
  return serializeListing(updated!, input.userId);
}

type MarketplacePurchaseIntentRecord = NonNullable<Awaited<ReturnType<typeof prisma.marketplacePurchaseIntent.findUnique>>>;

function serializeIntent(intent: MarketplacePurchaseIntentRecord): MarketplacePurchaseIntentSnapshot {
  return {
    intentId: intent.id,
    listingId: intent.listingId,
    skinId: intent.skinId as HeroSkinId,
    status: intent.status as MarketplacePurchaseIntentSnapshot['status'],
    buyerWalletAddress: intent.buyerWalletAddress,
    sellerWalletAddress: intent.sellerWalletAddress,
    priceLamports: intent.priceLamports.toString(),
    memo: intent.memo,
    expiresAt: intent.intentExpiresAt.toISOString(),
    cluster: intent.cluster,
    transactionSignature: intent.transactionSignature,
    creditedAt: intent.creditedAt?.toISOString() ?? null,
    lastError: intent.lastError,
  };
}

export async function createMarketplacePurchaseIntent(input: {
  userId: string;
  listingId: string;
  walletAddress: string;
}): Promise<MarketplacePurchaseIntentSnapshot> {
  const runtime = await loadMarketplaceRuntime();
  if (!runtime.settings.enabled) {
    throw new MarketplaceServiceError('The marketplace is currently disabled', 403);
  }
  if (!runtime.rpcUrl) {
    throw new MarketplaceServiceError('SOLANA_RPC_URL is not configured', 503);
  }

  const trimmedWallet = input.walletAddress.trim();
  if (!trimmedWallet) {
    throw new MarketplaceServiceError('A connected Solana wallet is required');
  }
  const buyerWalletAddress = assertSolanaPublicKey(trimmedWallet, 'walletAddress').toBase58();

  const buyer = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true },
  });
  if (!buyer) {
    throw new MarketplaceServiceError('Sign in to buy skins', 401);
  }

  await releaseStaleListingReservations(input.listingId);
  const listing = await prisma.marketplaceListing.findUnique({ where: { id: input.listingId } });
  if (!listing || listing.status === 'canceled') {
    throw new MarketplaceServiceError('Listing not found', 404);
  }
  if (listing.sellerUserId === input.userId) {
    throw new MarketplaceServiceError('You cannot buy your own listing');
  }
  if (buyerWalletAddress === listing.sellerWalletAddress) {
    throw new MarketplaceServiceError('Connect a wallet different from the seller wallet');
  }
  if (listing.status !== 'active') {
    throw new MarketplaceServiceError('Listing is no longer available', 409);
  }

  const intentId = randomUUID();
  const now = new Date();
  const intentExpiresAt = new Date(now.getTime() + DEFAULT_INTENT_TTL_MS);
  const reservedUntil = new Date(intentExpiresAt.getTime() + DEFAULT_INTENT_EXPIRY_GRACE_MS);
  try {
    const intent = await prisma.$transaction(async (tx) => {
      const currentListing = await tx.marketplaceListing.findUnique({ where: { id: listing.id } });
      if (!currentListing || currentListing.status !== 'active') {
        throw new MarketplaceServiceError('Listing is no longer available', 409);
      }
      if (!currentListing.escrowedOwnershipId || !currentListing.escrowedAt) {
        throw new MarketplaceServiceError('Listing escrow is unavailable', 409);
      }
      const escrowedOwnership = await tx.userSkinOwnership.findUnique({
        where: { id: currentListing.escrowedOwnershipId },
      });
      if (
        !escrowedOwnership
        || escrowedOwnership.userId !== currentListing.sellerUserId
        || escrowedOwnership.skinId !== currentListing.skinId
        || escrowedOwnership.revokedAt
      ) {
        throw new MarketplaceServiceError('Listing escrow is invalid', 409);
      }

      const buyerOwnership = await tx.userSkinOwnership.findUnique({
        where: { userId_skinId: { userId: input.userId, skinId: currentListing.skinId } },
        select: { revokedAt: true },
      });
      if (buyerOwnership && !buyerOwnership.revokedAt) {
        throw new MarketplaceServiceError('You already own that skin', 409);
      }
      const existingBuyerIntent = await tx.marketplacePurchaseIntent.findFirst({
        where: {
          buyerUserId: input.userId,
          skinId: currentListing.skinId,
          status: { in: ['intent_created', 'transaction_built', 'submitted', 'confirmed'] },
        },
        select: { id: true },
      });
      if (existingBuyerIntent) {
        throw new MarketplaceServiceError('You already have a pending purchase for this skin', 409);
      }

      const claimed = await tx.marketplaceListing.updateMany({
        where: { id: currentListing.id, status: 'active' },
        data: { status: 'pending_sale', reservedIntentId: intentId, reservedUntil },
      });
      if (claimed.count !== 1) {
        throw new MarketplaceServiceError('Listing is no longer available', 409);
      }
      return tx.marketplacePurchaseIntent.create({
        data: {
          id: intentId,
          listingId: currentListing.id,
          buyerUserId: input.userId,
          buyerWalletAddress,
          sellerUserId: currentListing.sellerUserId,
          sellerWalletAddress: currentListing.sellerWalletAddress,
          skinId: currentListing.skinId,
          priceLamports: currentListing.priceLamports,
          cluster: runtime.cluster,
          memo: createMarketplacePaymentMemo(intentId),
          status: 'intent_created',
          activeBuyerSkinKey: `${input.userId}:${currentListing.skinId}`,
          intentExpiresAt,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return serializeIntent(intent);
  } catch (error) {
    if (isSerializableTransactionConflict(error)) {
      throw new MarketplaceServiceError('Listing changed; try again', 409);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new MarketplaceServiceError('You already have a pending purchase for this skin', 409);
    }
    throw error;
  }
}

async function getIntentForUser(userId: string, intentId: string): Promise<MarketplacePurchaseIntentRecord> {
  const intent = await prisma.marketplacePurchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.buyerUserId !== userId) {
    throw new MarketplaceServiceError('Purchase intent not found', 404);
  }
  return intent;
}

function assertIntentCanBuild(intent: { status: string; intentExpiresAt: Date }): void {
  if (intent.status === 'expired' || intent.intentExpiresAt.getTime() <= Date.now()) {
    throw new MarketplaceServiceError('Purchase intent has expired', 409);
  }
  if (intent.status !== 'intent_created' && intent.status !== 'transaction_built') {
    throw new MarketplaceServiceError('Purchase payment can no longer be rebuilt', 409);
  }
}

async function buildSolPaymentTransaction(input: {
  connection: Connection;
  fromWallet: string;
  toWallet: string;
  lamports: bigint;
  memo: string;
}): Promise<{ transactionBase64: string; lastValidBlockHeight: number }> {
  const from = assertSolanaPublicKey(input.fromWallet, 'walletAddress');
  const to = assertSolanaPublicKey(input.toWallet, 'sellerWalletAddress');
  if (from.equals(to)) {
    throw new MarketplaceServiceError('Buyer and seller wallets must be different');
  }
  const latest = await input.connection.getLatestBlockhash('confirmed');

  const transaction = new Transaction({
    feePayer: from,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: from,
      toPubkey: to,
      lamports: input.lamports,
    }),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(input.memo, 'utf8'),
    })
  );

  return {
    transactionBase64: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64'),
    lastValidBlockHeight: latest.lastValidBlockHeight,
  };
}

export async function buildMarketplacePurchaseTransaction(input: {
  userId: string;
  intentId: string;
}): Promise<MarketplacePurchaseTransactionSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  assertIntentCanBuild(intent);

  const runtime = await loadMarketplaceRuntime();
  const connection = connectionForMarketplace(runtime);
  const built = await buildSolPaymentTransaction({
    connection,
    fromWallet: intent.buyerWalletAddress,
    toWallet: intent.sellerWalletAddress,
    lamports: intent.priceLamports,
    memo: intent.memo,
  });

  const transitioned = await prisma.marketplacePurchaseIntent.updateMany({
    where: {
      id: intent.id,
      status: { in: ['intent_created', 'transaction_built'] },
      transactionSignature: null,
    },
    data: {
      status: 'transaction_built',
      lastValidBlockHeight: BigInt(built.lastValidBlockHeight),
      lastError: null,
    },
  });
  if (transitioned.count !== 1) {
    throw new MarketplaceServiceError('Purchase payment state changed; refresh and try again', 409);
  }
  const updated = await getIntentForUser(input.userId, intent.id);

  return {
    intentId: updated.id,
    transactionBase64: built.transactionBase64,
    lastValidBlockHeight: built.lastValidBlockHeight,
    cluster: updated.cluster,
    priceLamports: updated.priceLamports.toString(),
    sellerWalletAddress: updated.sellerWalletAddress,
    memo: updated.memo,
  };
}

function signedTransactionSignature(transaction: Transaction, intent: {
  buyerWalletAddress: string;
  memo: string;
}): string {
  if (transaction.feePayer?.toBase58() !== intent.buyerWalletAddress) {
    throw new MarketplaceServiceError('Signed transaction fee payer does not match wallet');
  }
  const hasMemo = transaction.instructions.some((instruction) => (
    instruction.programId.toBase58() === MEMO_PROGRAM_ID.toBase58() &&
    Buffer.from(instruction.data).toString('utf8') === intent.memo
  ));
  if (!hasMemo) throw new MarketplaceServiceError('Signed transaction memo does not match purchase intent');
  const payerSignature = transaction.signatures.find((entry) => entry.publicKey.toBase58() === intent.buyerWalletAddress);
  if (!payerSignature?.signature) {
    throw new MarketplaceServiceError('Signed transaction is missing the wallet signature');
  }
  return bs58.encode(payerSignature.signature);
}

function decodeMarketplaceTransaction(transactionBase64: string): Transaction {
  if (typeof transactionBase64 !== 'string' || transactionBase64.length > 16_384) {
    throw new MarketplaceServiceError('Invalid transaction payload');
  }
  try {
    return Transaction.from(Buffer.from(transactionBase64, 'base64'));
  } catch {
    throw new MarketplaceServiceError('Transaction could not be decoded');
  }
}

export async function submitSignedMarketplacePurchaseTransaction(input: {
  userId: string;
  intentId: string;
  signedTransactionBase64: string;
}): Promise<MarketplacePurchaseIntentSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  if (intent.status === 'failed' || intent.status === 'expired' || intent.status === 'confirmed') {
    throw new MarketplaceServiceError('Purchase payment can no longer be submitted', 409);
  }

  const transaction = decodeMarketplaceTransaction(input.signedTransactionBase64);
  const signature = signedTransactionSignature(transaction, intent);
  await recordMarketplacePurchaseSignature({
    userId: input.userId,
    intentId: input.intentId,
    signature,
  });

  const runtime = await loadMarketplaceRuntime();
  try {
    const broadcastSignature = await connectionForMarketplace(runtime).sendRawTransaction(transaction.serialize(), {
      maxRetries: 0,
      preflightCommitment: 'confirmed',
    });
    if (broadcastSignature !== signature) {
      throw new MarketplaceServiceError('Solana returned an unexpected transaction signature', 502);
    }
  } catch (error) {
    console.warn('[marketplace] signed payment broadcast needs reconciliation', {
      intentId: intent.id,
      signature,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return verifySubmittedMarketplacePurchase(input.userId, intent.id, { keepSubmittedWhenNotFound: true });
}

async function recordMarketplacePurchaseSignature(input: {
  userId: string;
  intentId: string;
  signature: string;
}): Promise<MarketplacePurchaseIntentSnapshot> {
  if (!signatureLooksValid(input.signature)) {
    throw new MarketplaceServiceError('Invalid Solana transaction signature');
  }
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  if (intent.transactionSignature && intent.transactionSignature !== input.signature) {
    throw new MarketplaceServiceError('A different transaction is already attached to this purchase', 409);
  }
  if (intent.status === 'failed' || intent.status === 'expired' || intent.status === 'confirmed') {
    throw new MarketplaceServiceError('Purchase payment can no longer be submitted', 409);
  }
  if (intent.intentExpiresAt.getTime() <= Date.now() && !intent.transactionSignature) {
    throw new MarketplaceServiceError('Purchase intent has expired', 409);
  }

  const duplicate = await prisma.marketplacePurchaseIntent.findFirst({
    where: {
      transactionSignature: input.signature,
      id: { not: intent.id },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new MarketplaceServiceError('Transaction signature has already been used', 409);
  }

  const transitioned = await prisma.marketplacePurchaseIntent.updateMany({
    where: {
      id: intent.id,
      status: { in: ['intent_created', 'transaction_built', 'submitted'] },
      OR: [
        { transactionSignature: null },
        { transactionSignature: input.signature },
      ],
    },
    data: {
      status: 'submitted',
      transactionSignature: input.signature,
      lastError: null,
    },
  });
  if (transitioned.count !== 1) {
    const current = await getIntentForUser(input.userId, intent.id);
    if (current.status === 'credited' || current.transactionSignature === input.signature) {
      return serializeIntent(current);
    }
    throw new MarketplaceServiceError('Purchase payment state changed; refresh and try again', 409);
  }
  return serializeIntent(await getIntentForUser(input.userId, intent.id));
}

export async function submitMarketplacePurchaseSignature(input: {
  userId: string;
  intentId: string;
  signature: string;
}): Promise<MarketplacePurchaseIntentSnapshot> {
  const recorded = await recordMarketplacePurchaseSignature(input);
  if (recorded.status === 'credited') return recorded;

  return verifySubmittedMarketplacePurchase(input.userId, input.intentId, { keepSubmittedWhenNotFound: true });
}

// Transfers the entitlement held in listing escrow after the buyer's SOL
// payment is verified. The seller row was already revoked when the listing was
// created, so no user action can make delivery fail after payment.
async function creditMarketplacePurchase(intent: MarketplacePurchaseIntentRecord): Promise<MarketplacePurchaseIntentSnapshot> {
  const creditedAt = new Date();
  const credited = await (async (): Promise<MarketplacePurchaseIntentRecord> => {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.marketplacePurchaseIntent.findUnique({ where: { id: intent.id } });
        if (!current) throw new MarketplaceServiceError('Purchase intent not found', 404);
        if (current.status === 'credited') return current;
        if (current.status !== 'confirmed' && current.status !== 'submitted') {
          throw new MarketplaceServiceError('Purchase payment is not ready to credit', 409);
        }

        const listing = await tx.marketplaceListing.findUnique({ where: { id: intent.listingId } });
        if (!listing || listing.status !== 'pending_sale' || listing.reservedIntentId !== intent.id) {
          throw new MarketplaceServiceError('Paid listing reservation requires support', 503);
        }
        if (!listing.escrowedOwnershipId || !listing.escrowedAt) {
          throw new MarketplaceServiceError('Paid listing escrow requires support', 503);
        }
        const sellerOwnership = await tx.userSkinOwnership.findUnique({
          where: { id: listing.escrowedOwnershipId },
        });
        if (
          !sellerOwnership
          || sellerOwnership.userId !== intent.sellerUserId
          || sellerOwnership.skinId !== intent.skinId
          || sellerOwnership.revokedAt
        ) {
          throw new MarketplaceServiceError('Paid listing escrow requires support', 503);
        }

        const buyerOwnership = await tx.userSkinOwnership.findUnique({
          where: { userId_skinId: { userId: intent.buyerUserId, skinId: intent.skinId } },
        });
        if (buyerOwnership && !buyerOwnership.revokedAt) {
          throw new MarketplaceServiceError('Buyer already owns the paid skin; support review required', 503);
        }
        // Release the cross-system acquisition lock inside this transaction.
        // Other transactions continue to see it until commit, while the DB
        // trigger allows this transaction to activate the buyer entitlement.
        await tx.marketplacePurchaseIntent.update({
          where: { id: intent.id },
          data: { activeBuyerSkinKey: null },
        });
        await tx.userSkinOwnership.update({
          where: { id: sellerOwnership.id },
          data: { revokedAt: creditedAt },
        });
        await tx.userSkinOwnership.upsert({
          where: { userId_skinId: { userId: intent.buyerUserId, skinId: intent.skinId } },
          create: {
            userId: intent.buyerUserId,
            skinId: intent.skinId,
            source: 'marketplace',
            grantedAt: creditedAt,
          },
          update: {
            source: 'marketplace',
            purchaseId: null,
            grantedAt: creditedAt,
            revokedAt: null,
          },
        });
        await tx.marketplaceListing.update({
          where: { id: listing.id },
          data: {
            status: 'sold',
            buyerUserId: intent.buyerUserId,
            soldAt: creditedAt,
            reservedIntentId: null,
            reservedUntil: null,
            escrowedOwnershipId: null,
            escrowedAt: null,
          },
        });
        const credited = await tx.marketplacePurchaseIntent.update({
          where: { id: intent.id },
          data: {
            status: 'credited',
            creditedAt,
            lastError: null,
          },
        });
        return credited;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializableTransactionConflict(error)) {
        throw new MarketplaceServiceError('Purchase is being finalized; try again', 409);
      }
      throw error;
    }
  })();
  return serializeIntent(credited);
}

export async function verifySubmittedMarketplacePurchase(
  userId: string,
  intentId: string,
  options: { keepSubmittedWhenNotFound?: boolean } = {}
): Promise<MarketplacePurchaseIntentSnapshot> {
  const intent = await getIntentForUser(userId, intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  if (!intent.transactionSignature) {
    return serializeIntent(intent);
  }
  if (intent.status === 'confirmed') {
    return creditMarketplacePurchase(intent);
  }

  const runtime = await loadMarketplaceRuntime();
  const connection = connectionForMarketplace(runtime);
  const transaction = await connection.getParsedTransaction(intent.transactionSignature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  const result = verifyParsedSolPayment(transaction, {
    senderWallet: intent.buyerWalletAddress,
    treasuryWallet: intent.sellerWalletAddress,
    amountLamports: intent.priceLamports,
    memo: intent.memo,
    createdAt: intent.createdAt,
    expiresAt: intent.intentExpiresAt,
    expiryGraceMs: DEFAULT_INTENT_EXPIRY_GRACE_MS,
    allowAfterExpiry: true,
  });

  if (!result.ok) {
    let transactionNotFoundExpired = false;
    if (result.reason === 'transaction_not_found') {
      if (intent.lastValidBlockHeight !== null) {
        try {
          transactionNotFoundExpired = (
            BigInt(await connection.getBlockHeight('confirmed')) > intent.lastValidBlockHeight
          );
        } catch {
          transactionNotFoundExpired = false;
        }
      } else {
        transactionNotFoundExpired = (
          Date.now() > intent.intentExpiresAt.getTime() + DEFAULT_INTENT_EXPIRY_GRACE_MS
        );
      }
    }
    if (
      result.reason === 'transaction_not_found'
      && options.keepSubmittedWhenNotFound
      && !transactionNotFoundExpired
    ) {
      await prisma.marketplacePurchaseIntent.updateMany({
        where: { id: intent.id, status: { in: ['submitted', 'confirmed'] } },
        data: { lastError: result.reason },
      });
      return serializeIntent(await getIntentForUser(userId, intent.id));
    }
    await prisma.marketplacePurchaseIntent.updateMany({
      where: { id: intent.id, status: { in: ['submitted', 'confirmed'] } },
      data: {
        status: transactionNotFoundExpired ? 'expired' : 'failed',
        activeBuyerSkinKey: null,
        lastError: transactionNotFoundExpired ? 'expired_intent' : result.reason ?? 'verification_failed',
      },
    });
    // Free the listing for other buyers when this payment can no longer land.
    await prisma.marketplaceListing.updateMany({
      where: { id: intent.listingId, status: 'pending_sale', reservedIntentId: intent.id },
      data: { status: 'active', reservedIntentId: null, reservedUntil: null },
    });
    return serializeIntent(await getIntentForUser(userId, intent.id));
  }

  await prisma.marketplacePurchaseIntent.updateMany({
    where: { id: intent.id, status: 'submitted' },
    data: { status: 'confirmed', lastError: null },
  });
  return creditMarketplacePurchase(await getIntentForUser(userId, intent.id));
}

export async function getMarketplacePurchaseIntent(input: {
  userId: string;
  intentId: string;
}): Promise<MarketplacePurchaseIntentSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (
    (intent.status === 'intent_created' || intent.status === 'transaction_built') &&
    intent.intentExpiresAt.getTime() <= Date.now()
  ) {
    await prisma.marketplacePurchaseIntent.updateMany({
      where: { id: intent.id, status: { in: ['intent_created', 'transaction_built'] } },
      data: { status: 'expired', activeBuyerSkinKey: null, lastError: 'intent_expired' },
    });
    await prisma.marketplaceListing.updateMany({
      where: { id: intent.listingId, status: 'pending_sale', reservedIntentId: intent.id },
      data: { status: 'active', reservedIntentId: null, reservedUntil: null },
    });
    return serializeIntent(await getIntentForUser(input.userId, intent.id));
  }
  if (intent.status === 'submitted' || intent.status === 'confirmed') {
    return verifySubmittedMarketplacePurchase(input.userId, input.intentId, { keepSubmittedWhenNotFound: true });
  }
  return serializeIntent(intent);
}

export interface MarketplaceReconciliationResult {
  scanned: number;
  credited: number;
  pending: number;
  terminal: number;
  failures: Array<{ intentId: string; message: string }>;
}

export async function reconcilePendingMarketplacePurchases(
  limit = 25
): Promise<MarketplaceReconciliationResult> {
  const take = Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.trunc(limit))) : 25;
  const candidates = await prisma.marketplacePurchaseIntent.findMany({
    where: {
      transactionSignature: { not: null },
      status: { in: ['submitted', 'confirmed'] },
    },
    orderBy: { updatedAt: 'asc' },
    take,
    select: { id: true, buyerUserId: true },
  });
  const result: MarketplaceReconciliationResult = {
    scanned: candidates.length,
    credited: 0,
    pending: 0,
    terminal: 0,
    failures: [],
  };
  for (const candidate of candidates) {
    try {
      const reconciled = await verifySubmittedMarketplacePurchase(
        candidate.buyerUserId,
        candidate.id,
        { keepSubmittedWhenNotFound: true }
      );
      if (reconciled.status === 'credited') result.credited += 1;
      else if (reconciled.status === 'submitted' || reconciled.status === 'confirmed') result.pending += 1;
      else result.terminal += 1;
    } catch (error) {
      result.failures.push({
        intentId: candidate.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export interface MarketplaceAdminOverview {
  settings: MarketplaceSettingsSnapshot;
  activeListings: number;
  soldListings: number;
  totalVolumeLamports: string;
}

export async function getMarketplaceAdminOverview(): Promise<MarketplaceAdminOverview> {
  const [settings, activeListings, soldListings, volume] = await Promise.all([
    getOrCreateMarketplaceSettings(),
    prisma.marketplaceListing.count({ where: { status: { in: ['active', 'pending_sale'] } } }),
    prisma.marketplaceListing.count({ where: { status: 'sold' } }),
    prisma.marketplaceListing.aggregate({
      where: { status: 'sold' },
      _sum: { priceLamports: true },
    }),
  ]);

  return {
    settings: serializeMarketplaceSettings(settings),
    activeListings,
    soldListings,
    totalVolumeLamports: (volume._sum.priceLamports ?? 0n).toString(),
  };
}
