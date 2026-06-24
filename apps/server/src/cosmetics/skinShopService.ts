import { randomUUID } from 'node:crypto';
import { Connection, Transaction } from '@solana/web3.js';
import {
  ALL_HERO_IDS,
  DEFAULT_HERO_SKIN_IDS,
  HERO_SKIN_CATALOG,
  getDefaultHeroSkinId,
  getHeroSkinDefinition,
  getPurchaseDisabledReasonForSkin,
  isHeroSkinId,
  isKnownHeroId,
  resolveHeroSkinDefinition,
  type HeroId,
  type HeroSkinCatalogItem,
  type HeroSkinCatalogResponse,
  type HeroSkinCatalogPriceState,
  type HeroSkinDefinition,
  type HeroSkinEntitlement,
  type HeroSkinId,
  type HeroLoadoutSelection,
  type SkinPurchaseIntentSnapshot,
  type SkinPurchaseTransactionSnapshot,
} from '@voxel-strike/shared';
import prisma from '../db';
import {
  assertSolanaPublicKey,
  buildSplTokenPaymentTransaction,
  createSkinPaymentMemo,
  getAssociatedTokenAccountAddress,
  getSplTokenMintDecimals,
  signatureLooksValid,
  verifyParsedSplTokenPayment,
} from './tokenPayments';

const SHOP_SETTINGS_ID = 'default';
const DEFAULT_INTENT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_INTENT_EXPIRY_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_RPC_TIMEOUT_MS = 12_000;

export class SkinShopServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'SkinShopServiceError';
    this.statusCode = statusCode;
  }
}

export interface SkinShopAdminOverview {
  shop: Awaited<ReturnType<typeof serializeShopSettings>>;
  items: Array<{
    skin: HeroSkinDefinition;
    settings: SerializedSkinShopItemSettings;
    lastAudit: SerializedSkinShopItemAudit | null;
  }>;
}

export interface SerializedSkinShopItemSettings {
  skinId: HeroSkinId;
  saleEnabled: boolean;
  tokenAmountBaseUnits: string | null;
  displayNote: string | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface SerializedSkinShopItemAudit {
  id: string;
  skinId: HeroSkinId;
  updatedByUserId: string | null;
  oldTokenAmountBaseUnits: string | null;
  newTokenAmountBaseUnits: string | null;
  oldSaleEnabled: boolean | null;
  newSaleEnabled: boolean | null;
  oldDisplayNote: string | null;
  newDisplayNote: string | null;
  oldPriceVersion: number | null;
  newPriceVersion: number | null;
  createdAt: string;
}

export interface SkinPurchaseSimulationSnapshot {
  intentId: string;
  ok: boolean;
  error: unknown;
  logs: string[];
}

function envFlag(name: string, fallback = false): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function cleanOptionalString(value: unknown, maxLength: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new SkinShopServiceError('Invalid string value');
  const cleaned = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return cleaned || null;
}

function readPositiveBaseUnits(value: unknown, options: { required: boolean }): bigint | null {
  if (value === null || value === undefined || value === '') {
    if (options.required) throw new SkinShopServiceError('Token amount is required');
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new SkinShopServiceError('Token amount must be an integer in base units');
  }
  const text = String(value).trim();
  if (!/^[0-9]+$/.test(text)) {
    throw new SkinShopServiceError('Token amount must be an integer in base units');
  }
  const amount = BigInt(text);
  if (amount <= 0n) {
    throw new SkinShopServiceError('Token amount must be greater than zero');
  }
  return amount;
}

function bigintToString(value: bigint | number | null | undefined): string | null {
  return value === null || value === undefined ? null : value.toString();
}

function paidSkins(): HeroSkinDefinition[] {
  return HERO_SKIN_CATALOG.filter((skin) => skin.availability === 'paid');
}

function defaultShopSettingsInput() {
  return {
    id: SHOP_SETTINGS_ID,
    enabled: envFlag('SKIN_SHOP_ENABLED', false),
    tokenMintAddress: process.env.SKIN_SHOP_TOKEN_MINT?.trim() || null,
    tokenSymbol: process.env.SKIN_SHOP_TOKEN_SYMBOL?.trim() || 'TOKEN',
    treasuryWallet: process.env.SKIN_SHOP_TREASURY_WALLET?.trim() || null,
    rpcUrl: process.env.SKIN_SHOP_RPC_URL?.trim() || null,
    cluster: process.env.SKIN_SHOP_CLUSTER?.trim() || 'devnet',
  };
}

async function getOrCreateShopSettings() {
  return prisma.skinShopSettings.upsert({
    where: { id: SHOP_SETTINGS_ID },
    create: defaultShopSettingsInput(),
    update: {},
  });
}

async function getOrCreateItemSettings(skinId: HeroSkinId) {
  const skin = getHeroSkinDefinition(skinId);
  if (skin.availability !== 'paid') {
    throw new SkinShopServiceError('Only paid skins have shop settings');
  }
  return prisma.skinShopItemSettings.upsert({
    where: { skinId },
    create: {
      skinId,
      saleEnabled: false,
      tokenAmountBaseUnits: null,
      displayNote: skin.price?.disabledReason ?? null,
    },
    update: {},
  });
}

function serializeShopSettings(settings: {
  enabled: boolean;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  treasuryWallet: string | null;
  rpcUrl: string | null;
  cluster: string;
  updatedByUserId?: string | null;
  updatedAt?: Date | null;
}) {
  return {
    enabled: settings.enabled,
    tokenMintAddress: settings.tokenMintAddress,
    tokenSymbol: settings.tokenSymbol,
    treasuryWallet: settings.treasuryWallet,
    cluster: settings.cluster,
    rpcConfigured: Boolean(settings.rpcUrl),
    updatedByUserId: settings.updatedByUserId ?? null,
    updatedAt: settings.updatedAt?.toISOString() ?? null,
  };
}

function serializeItemSettings(item: {
  skinId: string;
  saleEnabled: boolean;
  tokenAmountBaseUnits: bigint | null;
  displayNote: string | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: Date;
}): SerializedSkinShopItemSettings {
  return {
    skinId: item.skinId as HeroSkinId,
    saleEnabled: item.saleEnabled,
    tokenAmountBaseUnits: bigintToString(item.tokenAmountBaseUnits),
    displayNote: item.displayNote,
    priceVersion: item.priceVersion,
    updatedByUserId: item.updatedByUserId,
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeAudit(audit: {
  id: string;
  skinId: string;
  updatedByUserId: string | null;
  oldTokenAmountBaseUnits: bigint | null;
  newTokenAmountBaseUnits: bigint | null;
  oldSaleEnabled: boolean | null;
  newSaleEnabled: boolean | null;
  oldDisplayNote: string | null;
  newDisplayNote: string | null;
  oldPriceVersion: number | null;
  newPriceVersion: number | null;
  createdAt: Date;
}): SerializedSkinShopItemAudit {
  return {
    id: audit.id,
    skinId: audit.skinId as HeroSkinId,
    updatedByUserId: audit.updatedByUserId,
    oldTokenAmountBaseUnits: bigintToString(audit.oldTokenAmountBaseUnits),
    newTokenAmountBaseUnits: bigintToString(audit.newTokenAmountBaseUnits),
    oldSaleEnabled: audit.oldSaleEnabled,
    newSaleEnabled: audit.newSaleEnabled,
    oldDisplayNote: audit.oldDisplayNote,
    newDisplayNote: audit.newDisplayNote,
    oldPriceVersion: audit.oldPriceVersion,
    newPriceVersion: audit.newPriceVersion,
    createdAt: audit.createdAt.toISOString(),
  };
}

function toEntitlementSource(value: string): HeroSkinEntitlement {
  return value === 'paid' || value === 'admin_grant' || value === 'event' || value === 'free'
    ? value
    : 'paid';
}

function buildOwnedSkinIds(ownerships: Array<{ skinId: string; revokedAt: Date | null }>): Set<HeroSkinId> {
  const owned = new Set<HeroSkinId>(Object.values(DEFAULT_HERO_SKIN_IDS));
  for (const ownership of ownerships) {
    if (!ownership.revokedAt && isHeroSkinId(ownership.skinId)) {
      owned.add(ownership.skinId);
    }
  }
  return owned;
}

async function loadOwnershipRows(userId: string | null | undefined) {
  if (!userId) return [];
  return prisma.userSkinOwnership.findMany({
    where: { userId, revokedAt: null },
    orderBy: { grantedAt: 'asc' },
  });
}

async function loadResolvedLoadouts(userId: string | null | undefined, ownedSkinIds: Set<HeroSkinId>): Promise<HeroLoadoutSelection[]> {
  const rows = userId
    ? await prisma.userHeroLoadout.findMany({ where: { userId } })
    : [];
  const rowsByHero = new Map(rows.map((row) => [row.heroId, row.selectedSkinId]));

  return ALL_HERO_IDS.map((heroId) => ({
    heroId,
    skinId: resolveHeroSkinDefinition(heroId, rowsByHero.get(heroId), { ownedSkinIds }).skin.id,
  }));
}

function buildShopPriceState(input: {
  skin: HeroSkinDefinition;
  shop: Awaited<ReturnType<typeof getOrCreateShopSettings>>;
  item: Awaited<ReturnType<typeof getOrCreateItemSettings>> | null;
}): HeroSkinCatalogPriceState | null {
  if (input.skin.availability !== 'paid') return null;
  return {
    tokenSymbol: input.shop.tokenSymbol || input.skin.price?.tokenSymbol || 'TOKEN',
    tokenMintAddress: input.shop.tokenMintAddress,
    amountBaseUnits: bigintToString(input.item?.tokenAmountBaseUnits),
    adminEditable: input.skin.price?.adminEditable ?? true,
    disabledReason: input.item?.displayNote ?? input.skin.price?.disabledReason ?? null,
    saleEnabled: input.item?.saleEnabled ?? false,
    priceVersion: input.item?.priceVersion ?? 1,
    updatedByUserId: input.item?.updatedByUserId ?? null,
    updatedAt: input.item?.updatedAt?.toISOString() ?? null,
    displayNote: input.item?.displayNote ?? null,
  };
}

function purchaseDisabledReason(input: {
  skin: HeroSkinDefinition;
  shop: Awaited<ReturnType<typeof getOrCreateShopSettings>>;
  item: Awaited<ReturnType<typeof getOrCreateItemSettings>> | null;
}): string | null {
  if (input.skin.availability !== 'paid') return null;
  const mergedSkin: HeroSkinDefinition = {
    ...input.skin,
    price: {
      tokenSymbol: input.shop.tokenSymbol || input.skin.price?.tokenSymbol || 'TOKEN',
      tokenMintAddress: input.shop.tokenMintAddress,
      amountBaseUnits: bigintToString(input.item?.tokenAmountBaseUnits),
      adminEditable: input.skin.price?.adminEditable ?? true,
      disabledReason: input.item?.displayNote ?? input.skin.price?.disabledReason ?? null,
    },
  };
  if (!input.shop.treasuryWallet) return 'Treasury wallet is not configured';
  if (!input.shop.rpcUrl) return 'Skin shop RPC is not configured';
  return getPurchaseDisabledReasonForSkin(
    mergedSkin,
    input.item?.saleEnabled ?? false,
    input.shop.enabled
  );
}

export async function getSkinCatalogForUser(userId?: string | null): Promise<HeroSkinCatalogResponse> {
  const [shop, ownerships, itemRows] = await Promise.all([
    getOrCreateShopSettings(),
    loadOwnershipRows(userId),
    prisma.skinShopItemSettings.findMany(),
  ]);
  const itemRowsBySkin = new Map(itemRows.map((item) => [item.skinId, item]));
  for (const skin of paidSkins()) {
    if (!itemRowsBySkin.has(skin.id)) {
      itemRowsBySkin.set(skin.id, await getOrCreateItemSettings(skin.id));
    }
  }

  const ownedSkinIds = buildOwnedSkinIds(ownerships);
  const entitlementBySkin = new Map<HeroSkinId, HeroSkinEntitlement>();
  for (const skinId of Object.values(DEFAULT_HERO_SKIN_IDS)) entitlementBySkin.set(skinId, 'free');
  for (const ownership of ownerships) {
    if (isHeroSkinId(ownership.skinId) && !ownership.revokedAt) {
      entitlementBySkin.set(ownership.skinId, toEntitlementSource(ownership.source));
    }
  }
  const loadouts = await loadResolvedLoadouts(userId, ownedSkinIds);
  const equippedSkinIds = new Set(loadouts.map((loadout) => loadout.skinId));

  const skins: HeroSkinCatalogItem[] = HERO_SKIN_CATALOG.map((skin) => {
    const item = itemRowsBySkin.get(skin.id) ?? null;
    return {
      ...skin,
      owned: ownedSkinIds.has(skin.id),
      equipped: equippedSkinIds.has(skin.id),
      entitlementSource: entitlementBySkin.get(skin.id) ?? null,
      shopPrice: buildShopPriceState({ skin, shop, item }),
      purchaseDisabledReason: purchaseDisabledReason({ skin, shop, item }),
    };
  });

  return {
    shop: serializeShopSettings(shop),
    skins,
    loadouts,
  };
}

export async function userOwnsSkin(userId: string, skinId: HeroSkinId): Promise<boolean> {
  const skin = getHeroSkinDefinition(skinId);
  if (skin.availability === 'free') return true;
  const ownership = await prisma.userSkinOwnership.findUnique({
    where: { userId_skinId: { userId, skinId } },
    select: { revokedAt: true },
  });
  return Boolean(ownership && !ownership.revokedAt);
}

export async function resolveUserLoadoutForHero(
  userId: string,
  heroId: HeroId,
  requestedSkinId?: HeroSkinId | string | null
): Promise<HeroSkinId> {
  const ownerships = await loadOwnershipRows(userId);
  const ownedSkinIds = buildOwnedSkinIds(ownerships);
  const stored = requestedSkinId === undefined
    ? await prisma.userHeroLoadout.findUnique({
      where: { userId_heroId: { userId, heroId } },
      select: { selectedSkinId: true },
    })
    : null;
  return resolveHeroSkinDefinition(heroId, requestedSkinId ?? stored?.selectedSkinId, { ownedSkinIds }).skin.id;
}

export async function updateUserHeroLoadout(input: {
  userId: string;
  heroId: HeroId;
  skinId: HeroSkinId;
}): Promise<HeroLoadoutSelection> {
  const skin = getHeroSkinDefinition(input.skinId);
  if (skin.heroId !== input.heroId) {
    throw new SkinShopServiceError('Skin does not belong to that hero');
  }
  if (!(await userOwnsSkin(input.userId, input.skinId))) {
    throw new SkinShopServiceError('You do not own that skin', 403);
  }

  const loadout = await prisma.userHeroLoadout.upsert({
    where: { userId_heroId: { userId: input.userId, heroId: input.heroId } },
    create: {
      userId: input.userId,
      heroId: input.heroId,
      selectedSkinId: input.skinId,
    },
    update: { selectedSkinId: input.skinId },
  });

  return {
    heroId: loadout.heroId as HeroId,
    skinId: loadout.selectedSkinId as HeroSkinId,
  };
}

function connectionForShop(shop: Awaited<ReturnType<typeof getOrCreateShopSettings>>): Connection {
  if (!shop.rpcUrl) throw new SkinShopServiceError('Skin shop RPC is not configured', 503);
  return new Connection(shop.rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: DEFAULT_RPC_TIMEOUT_MS,
  });
}

function assertPurchaseAvailable(input: {
  skin: HeroSkinDefinition;
  shop: Awaited<ReturnType<typeof getOrCreateShopSettings>>;
  item: Awaited<ReturnType<typeof getOrCreateItemSettings>>;
}): void {
  const reason = purchaseDisabledReason(input);
  if (reason) throw new SkinShopServiceError(reason, 400);
  if (!input.shop.tokenMintAddress || !input.shop.treasuryWallet || !input.item.tokenAmountBaseUnits) {
    throw new SkinShopServiceError('Token launch configuration is incomplete');
  }
  assertSolanaPublicKey(input.shop.tokenMintAddress, 'tokenMintAddress');
  assertSolanaPublicKey(input.shop.treasuryWallet, 'treasuryWallet');
}

function serializeIntent(
  intent: {
    id: string;
    skinId: string;
    status: string;
    walletAddress: string;
    tokenMintAddress: string;
    tokenSymbol: string;
    tokenAmountBaseUnits: bigint;
    treasuryTokenAccount: string;
    memo: string;
    quotedPriceVersion: number;
    intentExpiresAt: Date;
    cluster: string;
    transactionSignature: string | null;
    creditedAt: Date | null;
    lastError: string | null;
  }
): SkinPurchaseIntentSnapshot {
  return {
    intentId: intent.id,
    skinId: intent.skinId as HeroSkinId,
    status: intent.status as SkinPurchaseIntentSnapshot['status'],
    walletAddress: intent.walletAddress,
    tokenMintAddress: intent.tokenMintAddress,
    tokenSymbol: intent.tokenSymbol,
    tokenAmountBaseUnits: intent.tokenAmountBaseUnits.toString(),
    treasuryTokenAccount: intent.treasuryTokenAccount,
    memo: intent.memo,
    priceVersion: intent.quotedPriceVersion,
    expiresAt: intent.intentExpiresAt.toISOString(),
    cluster: intent.cluster,
    transactionSignature: intent.transactionSignature,
    creditedAt: intent.creditedAt?.toISOString() ?? null,
    lastError: intent.lastError,
  };
}

export async function createSkinPurchaseIntent(input: {
  userId: string;
  skinId: HeroSkinId;
}): Promise<SkinPurchaseIntentSnapshot> {
  const skin = getHeroSkinDefinition(input.skinId);
  if (skin.availability !== 'paid') {
    throw new SkinShopServiceError('Default skins do not need to be purchased');
  }
  if (await userOwnsSkin(input.userId, input.skinId)) {
    throw new SkinShopServiceError('Skin is already owned', 409);
  }

  const [user, shop, item] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { walletAddress: true },
    }),
    getOrCreateShopSettings(),
    getOrCreateItemSettings(input.skinId),
  ]);
  if (!user?.walletAddress) {
    throw new SkinShopServiceError('A linked Solana wallet is required', 400);
  }
  assertPurchaseAvailable({ skin, shop, item });

  const tokenMintAddress = shop.tokenMintAddress!;
  const treasuryWallet = shop.treasuryWallet!;
  const connection = connectionForShop(shop);
  const [tokenDecimals, treasuryTokenAccount] = await Promise.all([
    getSplTokenMintDecimals(connection, tokenMintAddress),
    getAssociatedTokenAccountAddress({
      ownerAddress: treasuryWallet,
      tokenMintAddress,
    }),
  ]);

  const intentId = randomUUID();
  const now = new Date();
  const intent = await prisma.skinPurchaseIntent.create({
    data: {
      id: intentId,
      userId: input.userId,
      walletAddress: user.walletAddress,
      skinId: input.skinId,
      quotedPriceVersion: item.priceVersion,
      tokenMintAddress,
      tokenSymbol: shop.tokenSymbol,
      tokenAmountBaseUnits: item.tokenAmountBaseUnits!,
      tokenDecimals,
      treasuryWallet,
      treasuryTokenAccount,
      cluster: shop.cluster,
      memo: createSkinPaymentMemo(intentId),
      status: 'intent_created',
      intentExpiresAt: new Date(now.getTime() + DEFAULT_INTENT_TTL_MS),
    },
  });

  return serializeIntent(intent);
}

async function getIntentForUser(userId: string, intentId: string) {
  const intent = await prisma.skinPurchaseIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.userId !== userId) {
    throw new SkinShopServiceError('Purchase intent not found', 404);
  }
  return intent;
}

function assertIntentActive(intent: { status: string; intentExpiresAt: Date }): void {
  if (intent.status === 'credited') throw new SkinShopServiceError('Purchase intent is already credited', 409);
  if (intent.status === 'failed') throw new SkinShopServiceError('Purchase intent failed', 409);
  if (intent.intentExpiresAt.getTime() <= Date.now()) {
    throw new SkinShopServiceError('Purchase intent has expired', 409);
  }
}

export async function buildSkinPurchaseTransaction(input: {
  userId: string;
  intentId: string;
}): Promise<SkinPurchaseTransactionSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  assertIntentActive(intent);

  const shop = await getOrCreateShopSettings();
  const connection = connectionForShop(shop);
  const built = await buildSplTokenPaymentTransaction({
    connection,
    walletAddress: intent.walletAddress,
    tokenMintAddress: intent.tokenMintAddress,
    treasuryWallet: intent.treasuryWallet,
    tokenAmountBaseUnits: intent.tokenAmountBaseUnits.toString(),
    tokenDecimals: intent.tokenDecimals ?? await getSplTokenMintDecimals(connection, intent.tokenMintAddress),
    memo: intent.memo,
  });

  const updated = await prisma.skinPurchaseIntent.update({
    where: { id: intent.id },
    data: {
      status: 'transaction_built',
      treasuryTokenAccount: built.treasuryTokenAccount,
      lastValidBlockHeight: BigInt(built.lastValidBlockHeight),
      lastError: null,
    },
  });

  return {
    intentId: updated.id,
    transactionBase64: built.transactionBase64,
    lastValidBlockHeight: built.lastValidBlockHeight,
    cluster: updated.cluster,
    tokenMintAddress: updated.tokenMintAddress,
    tokenSymbol: updated.tokenSymbol,
    tokenAmountBaseUnits: updated.tokenAmountBaseUnits.toString(),
    treasuryTokenAccount: updated.treasuryTokenAccount,
    memo: updated.memo,
  };
}

function assertTransactionMessageMatchesIntent(transaction: Transaction, intent: {
  walletAddress: string;
  memo: string;
}): void {
  if (transaction.feePayer?.toBase58() !== intent.walletAddress) {
    throw new SkinShopServiceError('Signed transaction fee payer does not match wallet');
  }
  const hasMemo = transaction.instructions.some((instruction) => (
    instruction.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' &&
    Buffer.from(instruction.data).toString('utf8') === intent.memo
  ));
  if (!hasMemo) throw new SkinShopServiceError('Signed transaction memo does not match purchase intent');
}

function assertSignedTransactionMatchesIntent(transaction: Transaction, intent: {
  walletAddress: string;
  memo: string;
}): void {
  assertTransactionMessageMatchesIntent(transaction, intent);
  const payerSignature = transaction.signatures.find((entry) => entry.publicKey.toBase58() === intent.walletAddress);
  if (!payerSignature?.signature) {
    throw new SkinShopServiceError('Signed transaction is missing the wallet signature');
  }
}

function decodeSkinPurchaseTransaction(transactionBase64: string): Transaction {
  if (typeof transactionBase64 !== 'string' || transactionBase64.length > 16_384) {
    throw new SkinShopServiceError('Invalid transaction payload');
  }
  try {
    return Transaction.from(Buffer.from(transactionBase64, 'base64'));
  } catch {
    throw new SkinShopServiceError('Transaction could not be decoded');
  }
}

export async function simulateSkinPurchaseTransaction(input: {
  userId: string;
  intentId: string;
  transactionBase64: string;
}): Promise<SkinPurchaseSimulationSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  assertIntentActive(intent);
  const transaction = decodeSkinPurchaseTransaction(input.transactionBase64);
  assertTransactionMessageMatchesIntent(transaction, intent);

  const shop = await getOrCreateShopSettings();
  const simulation = await (connectionForShop(shop) as Connection & {
    simulateTransaction: (
      transaction: Transaction,
      config?: { sigVerify?: boolean; replaceRecentBlockhash?: boolean }
    ) => Promise<{ value: { err: unknown; logs: string[] | null } }>;
  }).simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: false,
  });

  return {
    intentId: intent.id,
    ok: !simulation.value.err,
    error: simulation.value.err ?? null,
    logs: simulation.value.logs ?? [],
  };
}

export async function submitSignedSkinPurchaseTransaction(input: {
  userId: string;
  intentId: string;
  signedTransactionBase64: string;
}): Promise<SkinPurchaseIntentSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  assertIntentActive(intent);

  const transaction = decodeSkinPurchaseTransaction(input.signedTransactionBase64);
  assertSignedTransactionMatchesIntent(transaction, intent);

  const shop = await getOrCreateShopSettings();
  const signature = await connectionForShop(shop).sendRawTransaction(transaction.serialize(), {
    maxRetries: 0,
    preflightCommitment: 'confirmed',
  });
  return submitSkinPurchaseSignature({
    userId: input.userId,
    intentId: input.intentId,
    signature,
  });
}

export async function submitSkinPurchaseSignature(input: {
  userId: string;
  intentId: string;
  signature: string;
}): Promise<SkinPurchaseIntentSnapshot> {
  if (!signatureLooksValid(input.signature)) {
    throw new SkinShopServiceError('Invalid Solana transaction signature');
  }
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  assertIntentActive(intent);

  const duplicate = await prisma.skinPurchaseIntent.findFirst({
    where: {
      transactionSignature: input.signature,
      id: { not: intent.id },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new SkinShopServiceError('Transaction signature has already been used', 409);
  }

  await prisma.skinPurchaseIntent.update({
    where: { id: intent.id },
    data: {
      status: 'submitted',
      transactionSignature: input.signature,
      lastError: null,
    },
  });

  return verifySubmittedSkinPurchase(input.userId, intent.id, { keepSubmittedWhenNotFound: true });
}

export async function verifySubmittedSkinPurchase(
  userId: string,
  intentId: string,
  options: { keepSubmittedWhenNotFound?: boolean } = {}
): Promise<SkinPurchaseIntentSnapshot> {
  const intent = await getIntentForUser(userId, intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  if (!intent.transactionSignature) {
    return serializeIntent(intent);
  }

  const shop = await getOrCreateShopSettings();
  const transaction = await connectionForShop(shop).getParsedTransaction(intent.transactionSignature, {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  });
  const result = verifyParsedSplTokenPayment({
    transaction,
    walletAddress: intent.walletAddress,
    tokenMintAddress: intent.tokenMintAddress,
    treasuryTokenAccount: intent.treasuryTokenAccount,
    tokenAmountBaseUnits: intent.tokenAmountBaseUnits.toString(),
    memo: intent.memo,
    createdAt: intent.createdAt,
    expiresAt: intent.intentExpiresAt,
    expiryGraceMs: DEFAULT_INTENT_EXPIRY_GRACE_MS,
  });

  if (!result.ok) {
    if (result.reason === 'transaction_not_found' && options.keepSubmittedWhenNotFound) {
      const pending = await prisma.skinPurchaseIntent.update({
        where: { id: intent.id },
        data: { status: 'submitted', lastError: result.reason },
      });
      return serializeIntent(pending);
    }
    const failed = await prisma.skinPurchaseIntent.update({
      where: { id: intent.id },
      data: {
        status: result.reason === 'expired_intent' ? 'expired' : 'failed',
        lastError: result.reason,
      },
    });
    return serializeIntent(failed);
  }

  const creditedAt = new Date();
  const credited = await prisma.$transaction(async (tx) => {
    await tx.userSkinOwnership.upsert({
      where: { userId_skinId: { userId: intent.userId, skinId: intent.skinId } },
      create: {
        userId: intent.userId,
        skinId: intent.skinId,
        source: 'paid',
        purchaseId: intent.id,
        grantedAt: creditedAt,
      },
      update: {
        source: 'paid',
        purchaseId: intent.id,
        revokedAt: null,
      },
    });
    return tx.skinPurchaseIntent.update({
      where: { id: intent.id },
      data: {
        status: 'credited',
        creditedAt,
        lastError: null,
      },
    });
  });

  return serializeIntent(credited);
}

export async function getSkinPurchaseIntent(input: {
  userId: string;
  intentId: string;
}): Promise<SkinPurchaseIntentSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (
    (intent.status === 'intent_created' || intent.status === 'transaction_built') &&
    intent.intentExpiresAt.getTime() <= Date.now()
  ) {
    const expired = await prisma.skinPurchaseIntent.update({
      where: { id: intent.id },
      data: { status: 'expired', lastError: 'intent_expired' },
    });
    return serializeIntent(expired);
  }
  if (intent.status === 'submitted') {
    return verifySubmittedSkinPurchase(input.userId, input.intentId, { keepSubmittedWhenNotFound: true });
  }
  return serializeIntent(intent);
}

export async function getSkinShopAdminOverview(): Promise<SkinShopAdminOverview> {
  const [shop, audits] = await Promise.all([
    getOrCreateShopSettings(),
    prisma.skinShopItemAudit.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  const auditsBySkin = new Map<string, SerializedSkinShopItemAudit>();
  for (const audit of audits) {
    if (!auditsBySkin.has(audit.skinId)) auditsBySkin.set(audit.skinId, serializeAudit(audit));
  }

  const items = [];
  for (const skin of paidSkins()) {
    const settings = await getOrCreateItemSettings(skin.id);
    items.push({
      skin,
      settings: serializeItemSettings(settings),
      lastAudit: auditsBySkin.get(skin.id) ?? null,
    });
  }

  return {
    shop: serializeShopSettings(shop),
    items,
  };
}

export async function updateSkinShopSettings(input: {
  enabled?: unknown;
  tokenMintAddress?: unknown;
  tokenSymbol?: unknown;
  treasuryWallet?: unknown;
  rpcUrl?: unknown;
  cluster?: unknown;
  updatedByUserId: string;
}) {
  const tokenMintAddress = input.tokenMintAddress === undefined
    ? undefined
    : cleanOptionalString(input.tokenMintAddress, 96);
  const treasuryWallet = input.treasuryWallet === undefined
    ? undefined
    : cleanOptionalString(input.treasuryWallet, 96);
  if (tokenMintAddress) assertSolanaPublicKey(tokenMintAddress, 'tokenMintAddress');
  if (treasuryWallet) assertSolanaPublicKey(treasuryWallet, 'treasuryWallet');

  const tokenSymbol = input.tokenSymbol === undefined
    ? undefined
    : cleanOptionalString(input.tokenSymbol, 16) ?? 'TOKEN';
  const rpcUrl = input.rpcUrl === undefined
    ? undefined
    : cleanOptionalString(input.rpcUrl, 240);
  const cluster = input.cluster === undefined
    ? undefined
    : cleanOptionalString(input.cluster, 32) ?? 'devnet';

  const settings = await prisma.skinShopSettings.upsert({
    where: { id: SHOP_SETTINGS_ID },
    create: {
      ...defaultShopSettingsInput(),
      enabled: input.enabled === true,
      tokenMintAddress: tokenMintAddress ?? null,
      tokenSymbol: tokenSymbol ?? 'TOKEN',
      treasuryWallet: treasuryWallet ?? null,
      rpcUrl: rpcUrl ?? null,
      cluster: cluster ?? 'devnet',
      updatedByUserId: input.updatedByUserId,
    },
    update: {
      ...(input.enabled === undefined ? {} : { enabled: input.enabled === true }),
      ...(input.tokenMintAddress === undefined ? {} : { tokenMintAddress }),
      ...(input.tokenSymbol === undefined ? {} : { tokenSymbol }),
      ...(input.treasuryWallet === undefined ? {} : { treasuryWallet }),
      ...(input.rpcUrl === undefined ? {} : { rpcUrl }),
      ...(input.cluster === undefined ? {} : { cluster }),
      updatedByUserId: input.updatedByUserId,
    },
  });

  return serializeShopSettings(settings);
}

export async function updateSkinShopItemSettings(input: {
  skinId: HeroSkinId;
  saleEnabled?: unknown;
  tokenAmountBaseUnits?: unknown;
  displayNote?: unknown;
  expectedPriceVersion?: unknown;
  updatedByUserId: string;
}): Promise<SerializedSkinShopItemSettings> {
  const skin = getHeroSkinDefinition(input.skinId);
  if (skin.availability !== 'paid') {
    throw new SkinShopServiceError('Default skins cannot be priced');
  }
  const current = await getOrCreateItemSettings(input.skinId);
  if (
    typeof input.expectedPriceVersion === 'number' &&
    input.expectedPriceVersion !== current.priceVersion
  ) {
    throw new SkinShopServiceError('Skin price was updated by another admin', 409);
  }

  const nextSaleEnabled = input.saleEnabled === undefined
    ? current.saleEnabled
    : input.saleEnabled === true;
  const nextAmount = input.tokenAmountBaseUnits === undefined
    ? current.tokenAmountBaseUnits
    : readPositiveBaseUnits(input.tokenAmountBaseUnits, { required: nextSaleEnabled });
  if (nextSaleEnabled && !nextAmount) {
    throw new SkinShopServiceError('Token amount is required when sale is enabled');
  }
  const nextDisplayNote = input.displayNote === undefined
    ? current.displayNote
    : cleanOptionalString(input.displayNote, 160);
  const nextVersion = current.priceVersion + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.skinShopItemSettings.update({
      where: { skinId: input.skinId },
      data: {
        saleEnabled: nextSaleEnabled,
        tokenAmountBaseUnits: nextAmount,
        displayNote: nextDisplayNote,
        priceVersion: nextVersion,
        updatedByUserId: input.updatedByUserId,
      },
    });
    await tx.skinShopItemAudit.create({
      data: {
        skinId: input.skinId,
        updatedByUserId: input.updatedByUserId,
        oldTokenAmountBaseUnits: current.tokenAmountBaseUnits,
        newTokenAmountBaseUnits: nextAmount,
        oldSaleEnabled: current.saleEnabled,
        newSaleEnabled: nextSaleEnabled,
        oldDisplayNote: current.displayNote,
        newDisplayNote: nextDisplayNote,
        oldPriceVersion: current.priceVersion,
        newPriceVersion: nextVersion,
      },
    });
    return item;
  });

  return serializeItemSettings(updated);
}

export function parseHeroIdParam(value: unknown): HeroId | null {
  return typeof value === 'string' && isKnownHeroId(value) ? value : null;
}

export function parseSkinIdInput(value: unknown): HeroSkinId | null {
  return isHeroSkinId(value) ? value : null;
}
