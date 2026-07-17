import { randomInt, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { Connection, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  getHeroSkinDefinition,
  getLootboxEligibleSkins,
  isHeroSkinId,
  type HeroSkinDefinition,
  type HeroSkinId,
  type HeroSkinRarity,
  type LootboxOpenIntentSnapshot,
  type LootboxOpenTransactionSnapshot,
  type LootboxDirectTokenRewardSettings,
  type LootboxDuplicateRewardSettings,
  type LootboxRarityOdds,
  type LootboxRarityWeights,
  type LootboxRewardKind,
  type LootboxSettingsSnapshot,
  type LootboxStateResponse,
  type LootboxTokenRange,
} from '@voxel-strike/shared';
import prisma from '../db';
import { getGameTokenConfig } from '../config/gameToken';
import {
  assertSolanaPublicKey,
  buildSplTokenPaymentTransaction,
  getAssociatedTokenAccountAddress,
  getSplTokenMintRuntime,
  signatureLooksValid,
  verifyParsedSplTokenPayment,
  type SplTokenMintRuntime,
} from '../cosmetics/tokenPayments';
import { getSettlementKeypair } from '../wagers/config';

export const LOOTBOX_PAYMENT_MEMO_PREFIX = 'opus-lootbox:';
export const LOOTBOX_FREE_OPEN_MEMO_PREFIX = 'opus-lootbox-free:';
// Placeholder for the intent columns a free open never touches (wallet,
// treasury, mint). Free opens are recorded as credited LootboxOpenIntent rows
// so admin totals and recent pulls include them.
const FREE_OPEN_PLACEHOLDER = 'free-open';
const MAX_FREE_OPEN_GRANT = 1000;

const LOOTBOX_SETTINGS_ID = 'default';
const DEFAULT_INTENT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_INTENT_EXPIRY_GRACE_MS = 2 * 60 * 1000;
const DEFAULT_RPC_TIMEOUT_MS = 12_000;
const SETTINGS_CACHE_TTL_MS = 5_000;
const MAX_PRICE_TOKENS = 10n ** 12n;
const MAX_RARITY_WEIGHT = 1_000_000;
const MAX_DROP_CHANCE_BPS = 10_000;
const TOKEN_RANGE_SCALE_STEPS = 10_000;
const RARITY_ORDER: readonly HeroSkinRarity[] = ['common', 'epic', 'unique', 'legendary'];

type LootboxConnectionFactory = (rpcUrl: string) => Connection;

let lootboxConnectionFactory: LootboxConnectionFactory = (rpcUrl) => new Connection(rpcUrl, {
  commitment: 'confirmed',
  confirmTransactionInitialTimeout: DEFAULT_RPC_TIMEOUT_MS,
});

export function setLootboxConnectionFactoryForTests(factory: LootboxConnectionFactory | null): void {
  lootboxConnectionFactory = factory ?? ((rpcUrl) => new Connection(rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: DEFAULT_RPC_TIMEOUT_MS,
  }));
}

export class LootboxServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'LootboxServiceError';
    this.statusCode = statusCode;
  }
}

function isSerializableTransactionConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

export function createLootboxPaymentMemo(intentId: string): string {
  return `${LOOTBOX_PAYMENT_MEMO_PREFIX}${intentId}`;
}

function readTreasuryWallet(): string | null {
  return process.env.WAGER_TREASURY_WALLET?.trim() || null;
}

function readSolanaRpcUrl(): string | null {
  return process.env.SOLANA_RPC_URL?.trim() || null;
}

type LootboxSettingsRow = NonNullable<Awaited<ReturnType<typeof prisma.lootboxSettings.findUnique>>>;
type LootboxDuplicateRewardRow = Awaited<ReturnType<typeof prisma.lootboxDuplicateRewardSetting.findMany>>[number];

interface LootboxConfig {
  settings: LootboxSettingsRow;
  duplicateRewards: LootboxDuplicateRewardRow[];
}

let settingsCache: { value: LootboxConfig; expiresAt: number } | null = null;

export function clearLootboxSettingsCache(): void {
  settingsCache = null;
}

function defaultDuplicateRewardTokens(rarity: HeroSkinRarity): string {
  if (rarity === 'legendary') return '2500';
  if (rarity === 'unique') return '1000';
  if (rarity === 'epic') return '500';
  return '250';
}

async function getOrCreateLootboxConfig(): Promise<LootboxConfig> {
  const now = Date.now();
  if (settingsCache && settingsCache.expiresAt > now) return settingsCache.value;

  await Promise.all([
    prisma.lootboxSettings.createMany({
      data: [{ id: LOOTBOX_SETTINGS_ID }],
      skipDuplicates: true,
    }),
    prisma.lootboxDuplicateRewardSetting.createMany({
      data: lootboxPool().map((skin) => ({
        skinId: skin.id,
        minTokenAmountTokens: defaultDuplicateRewardTokens(skin.rarity),
        maxTokenAmountTokens: defaultDuplicateRewardTokens(skin.rarity),
      })),
      skipDuplicates: true,
    }),
  ]);
  const [settings, duplicateRewards] = await Promise.all([
    prisma.lootboxSettings.findUnique({ where: { id: LOOTBOX_SETTINGS_ID } }),
    prisma.lootboxDuplicateRewardSetting.findMany({ orderBy: { skinId: 'asc' } }),
  ]);
  if (!settings) {
    throw new LootboxServiceError('Lootbox settings could not be initialized', 500);
  }
  const config = { settings, duplicateRewards };
  settingsCache = { value: config, expiresAt: now + SETTINGS_CACHE_TTL_MS };
  return config;
}

function settingsWeights(settings: LootboxSettingsRow): LootboxRarityWeights {
  return {
    common: settings.commonWeightBps,
    epic: settings.epicWeightBps,
    unique: settings.uniqueWeightBps,
    legendary: settings.legendaryWeightBps,
  };
}

function intentWeights(intent: LootboxOpenIntentRecord): LootboxRarityWeights {
  return {
    common: intent.quotedCommonWeightBps,
    epic: intent.quotedEpicWeightBps,
    unique: intent.quotedUniqueWeightBps,
    legendary: intent.quotedLegendaryWeightBps,
  };
}

function duplicateTokenRanges(rows: LootboxDuplicateRewardRow[]): Record<HeroSkinId, LootboxTokenRange> {
  const eligibleSkinIds = new Set(lootboxPool().map((skin) => skin.id));
  return Object.fromEntries(
    rows
      .filter((row) => eligibleSkinIds.has(row.skinId as HeroSkinId))
      .map((row) => [row.skinId, {
        minTokens: row.minTokenAmountTokens,
        maxTokens: row.maxTokenAmountTokens,
      }])
  ) as Record<HeroSkinId, LootboxTokenRange>;
}

function settingsDuplicateReward(config: LootboxConfig): LootboxDuplicateRewardSettings {
  return {
    skinTokenRanges: duplicateTokenRanges(config.duplicateRewards),
  };
}

function settingsDirectTokenReward(settings: LootboxSettingsRow): LootboxDirectTokenRewardSettings {
  return {
    chanceBps: settings.directTokenRewardChanceBps,
    range: {
      minTokens: settings.directTokenRewardMinTokens,
      maxTokens: settings.directTokenRewardMaxTokens,
    },
  };
}

function duplicateTokenRangesJson(
  ranges: LootboxDuplicateRewardSettings['skinTokenRanges']
): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.entries(ranges)
      .filter((entry): entry is [string, LootboxTokenRange] => Boolean(entry[1]))
      .map(([skinId, range]) => [skinId, {
        minTokens: range.minTokens,
        maxTokens: range.maxTokens,
      }])
  );
}

function intentDuplicateReward(intent: LootboxOpenIntentRecord): LootboxDuplicateRewardSettings {
  const raw = intent.quotedDuplicateTokenRanges;
  const skinTokenRanges: Partial<Record<HeroSkinId, LootboxTokenRange>> = {};
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [skinId, value] of Object.entries(raw)) {
      if (
        !isHeroSkinId(skinId)
        || !value
        || typeof value !== 'object'
        || Array.isArray(value)
        || !('minTokens' in value)
        || !('maxTokens' in value)
        || typeof value.minTokens !== 'string'
        || typeof value.maxTokens !== 'string'
        || !/^[0-9]+$/.test(value.minTokens)
        || !/^[0-9]+$/.test(value.maxTokens)
        || BigInt(value.minTokens) <= 0n
        || BigInt(value.minTokens) > BigInt(value.maxTokens)
        || BigInt(value.maxTokens) > MAX_PRICE_TOKENS
      ) continue;
      skinTokenRanges[skinId] = { minTokens: value.minTokens, maxTokens: value.maxTokens };
    }
  }
  return {
    skinTokenRanges,
  };
}

function intentDirectTokenReward(intent: LootboxOpenIntentRecord): LootboxDirectTokenRewardSettings {
  return {
    chanceBps: intent.quotedDirectTokenRewardChanceBps,
    range: {
      minTokens: intent.quotedDirectTokenRewardMinTokens,
      maxTokens: intent.quotedDirectTokenRewardMaxTokens,
    },
  };
}

export function serializeLootboxSettings(config: LootboxConfig): LootboxSettingsSnapshot {
  return {
    enabled: config.settings.enabled,
    priceTokens: config.settings.priceTokens,
    weights: settingsWeights(config.settings),
    directTokenReward: settingsDirectTokenReward(config.settings),
    duplicateReward: settingsDuplicateReward(config),
    updatedByUserId: config.settings.updatedByUserId,
    updatedAt: config.settings.updatedAt.toISOString(),
  };
}

function readPriceTokens(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new LootboxServiceError('Lootbox price must be a whole game-token amount');
  }
  const text = String(value).trim().replace(/,/g, '');
  if (!/^[0-9]+$/.test(text)) {
    throw new LootboxServiceError('Lootbox price must be a whole game-token amount');
  }
  const parsed = BigInt(text);
  if (parsed <= 0n) {
    throw new LootboxServiceError('Lootbox price must be greater than zero');
  }
  if (parsed > MAX_PRICE_TOKENS) {
    throw new LootboxServiceError(`Lootbox price cannot exceed ${MAX_PRICE_TOKENS}`);
  }
  return parsed.toString();
}

function readRarityWeight(value: unknown, rarity: HeroSkinRarity): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_RARITY_WEIGHT) {
    throw new LootboxServiceError(`${rarity} weight must be an integer between 0 and ${MAX_RARITY_WEIGHT}`);
  }
  return value;
}

function readTokenRewardAmount(
  value: unknown,
  label: string,
  boundary: 'minimum' | 'maximum'
): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'bigint') {
    throw new LootboxServiceError(`${label} ${boundary} must be a whole game-token amount`);
  }
  const text = String(value).trim().replace(/,/g, '');
  if (!/^[0-9]+$/.test(text)) {
    throw new LootboxServiceError(`${label} ${boundary} must be a whole game-token amount`);
  }
  const parsed = BigInt(text);
  if (parsed <= 0n) {
    throw new LootboxServiceError(`${label} ${boundary} must be greater than zero`);
  }
  if (parsed > MAX_PRICE_TOKENS) {
    throw new LootboxServiceError(`${label} ${boundary} cannot exceed ${MAX_PRICE_TOKENS}`);
  }
  return parsed.toString();
}

function readTokenRewardRange(value: unknown, label: string): LootboxTokenRange {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new LootboxServiceError(`${label} range must be an object`);
  }
  const range = value as { minTokens?: unknown; maxTokens?: unknown };
  const minTokens = readTokenRewardAmount(range.minTokens, label, 'minimum');
  const maxTokens = readTokenRewardAmount(range.maxTokens, label, 'maximum');
  if (BigInt(minTokens) > BigInt(maxTokens)) {
    throw new LootboxServiceError(`${label} minimum cannot exceed its maximum`);
  }
  return { minTokens, maxTokens };
}

function readDropChanceBps(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > MAX_DROP_CHANCE_BPS) {
    throw new LootboxServiceError(`Direct token chance must be an integer between 0 and ${MAX_DROP_CHANCE_BPS}`);
  }
  return value;
}

export async function updateLootboxSettings(input: {
  enabled?: unknown;
  priceTokens?: unknown;
  weights?: unknown;
  directTokenReward?: unknown;
  duplicateReward?: unknown;
  updatedByUserId: string;
}): Promise<LootboxSettingsSnapshot> {
  const current = await getOrCreateLootboxConfig();

  const data: Prisma.LootboxSettingsUpdateInput = { updatedByUserId: input.updatedByUserId };
  if (input.enabled !== undefined) data.enabled = input.enabled === true;
  if (input.priceTokens !== undefined) data.priceTokens = readPriceTokens(input.priceTokens);
  let nextDirectTokenReward = settingsDirectTokenReward(current.settings);
  if (input.directTokenReward !== undefined) {
    if (!input.directTokenReward || typeof input.directTokenReward !== 'object' || Array.isArray(input.directTokenReward)) {
      throw new LootboxServiceError('Direct token reward settings must be an object');
    }
    const directTokenReward = input.directTokenReward as { chanceBps?: unknown; range?: unknown };
    nextDirectTokenReward = {
      chanceBps: directTokenReward.chanceBps === undefined
        ? nextDirectTokenReward.chanceBps
        : readDropChanceBps(directTokenReward.chanceBps),
      range: directTokenReward.range === undefined
        ? nextDirectTokenReward.range
        : readTokenRewardRange(directTokenReward.range, 'Direct token reward'),
    };
    data.directTokenRewardChanceBps = nextDirectTokenReward.chanceBps;
    data.directTokenRewardMinTokens = nextDirectTokenReward.range.minTokens;
    data.directTokenRewardMaxTokens = nextDirectTokenReward.range.maxTokens;
  }
  let nextWeights = settingsWeights(current.settings);
  if (input.weights !== undefined) {
    if (!input.weights || typeof input.weights !== 'object') {
      throw new LootboxServiceError('Rarity weights must be an object');
    }
    const weights = input.weights as Partial<Record<HeroSkinRarity, unknown>>;
    nextWeights = {
      common: weights.common === undefined ? current.settings.commonWeightBps : readRarityWeight(weights.common, 'common'),
      epic: weights.epic === undefined ? current.settings.epicWeightBps : readRarityWeight(weights.epic, 'epic'),
      unique: weights.unique === undefined ? current.settings.uniqueWeightBps : readRarityWeight(weights.unique, 'unique'),
      legendary: weights.legendary === undefined ? current.settings.legendaryWeightBps : readRarityWeight(weights.legendary, 'legendary'),
    };
    data.commonWeightBps = nextWeights.common;
    data.epicWeightBps = nextWeights.epic;
    data.uniqueWeightBps = nextWeights.unique;
    data.legendaryWeightBps = nextWeights.legendary;
  }

  const duplicateRewardUpdates = new Map<HeroSkinId, LootboxTokenRange>();
  if (input.duplicateReward !== undefined) {
    if (!input.duplicateReward || typeof input.duplicateReward !== 'object') {
      throw new LootboxServiceError('Duplicate reward settings must be an object');
    }
    const duplicateReward = input.duplicateReward as {
      skinTokenRanges?: unknown;
    };
    if (duplicateReward.skinTokenRanges !== undefined) {
      if (!duplicateReward.skinTokenRanges || typeof duplicateReward.skinTokenRanges !== 'object') {
        throw new LootboxServiceError('Per-skin duplicate rewards must be an object');
      }
      for (const [skinId, value] of Object.entries(duplicateReward.skinTokenRanges)) {
        if (!isHeroSkinId(skinId) || !lootboxPool().some((skin) => skin.id === skinId)) {
          throw new LootboxServiceError(`Unknown lootbox skin: ${skinId}`);
        }
        const range = readTokenRewardRange(value, `${skinId} duplicate`);
        duplicateRewardUpdates.set(skinId, range);
      }
    }
  }

  const totalRarityWeight = (
    nextWeights.common + nextWeights.epic + nextWeights.unique + nextWeights.legendary
  );
  if (totalRarityWeight <= 0 && nextDirectTokenReward.chanceBps < MAX_DROP_CHANCE_BPS) {
    throw new LootboxServiceError('At least one rarity weight must be positive');
  }

  await prisma.$transaction([
    prisma.lootboxSettings.update({ where: { id: LOOTBOX_SETTINGS_ID }, data }),
    ...Array.from(duplicateRewardUpdates, ([skinId, range]) => (
      prisma.lootboxDuplicateRewardSetting.update({
        where: { skinId },
        data: {
          minTokenAmountTokens: range.minTokens,
          maxTokenAmountTokens: range.maxTokens,
          updatedByUserId: input.updatedByUserId,
        },
      })
    )),
  ]);
  clearLootboxSettingsCache();
  return serializeLootboxSettings(await getOrCreateLootboxConfig());
}

function lootboxPool(): HeroSkinDefinition[] {
  return getLootboxEligibleSkins();
}

async function loadOwnedSkinIds(userId: string | null | undefined): Promise<Set<string>> {
  if (!userId) return new Set();
  const [ownershipRows, reservedPurchaseRows] = await Promise.all([
    prisma.userSkinOwnership.findMany({
      where: { userId, revokedAt: null },
      select: { skinId: true },
    }),
    prisma.marketplacePurchaseIntent.findMany({
      where: {
        buyerUserId: userId,
        status: { in: ['intent_created', 'transaction_built', 'submitted', 'confirmed'] },
      },
      select: { skinId: true },
    }),
  ]);
  return new Set([
    ...ownershipRows.map((row) => row.skinId),
    ...reservedPurchaseRows.map((row) => row.skinId),
  ]);
}

interface RarityBucket {
  rarity: HeroSkinRarity;
  total: HeroSkinDefinition[];
  remaining: HeroSkinDefinition[];
}

function buildRarityBuckets(ownedSkinIds: ReadonlySet<string>): RarityBucket[] {
  const pool = lootboxPool();
  return RARITY_ORDER
    .map((rarity) => {
      const total = pool.filter((skin) => skin.rarity === rarity);
      return {
        rarity,
        total,
        remaining: total.filter((skin) => !ownedSkinIds.has(skin.id)),
      };
    })
    .filter((bucket) => bucket.total.length > 0);
}

function buildOdds(
  buckets: RarityBucket[],
  weights: LootboxRarityWeights,
  directTokenChanceBps: number
): { odds: LootboxRarityOdds[]; duplicateChanceBps: number } {
  const skinOutcomeShare = (MAX_DROP_CHANCE_BPS - directTokenChanceBps) / MAX_DROP_CHANCE_BPS;
  const weightOf = (bucket: RarityBucket): number => weights[bucket.rarity];
  let totalWeight = buckets.reduce((sum, bucket) => sum + weightOf(bucket), 0);
  // All-zero weights degrade to a uniform full-pool pick, matching
  // rollWeightedSkin. Ownership never changes a rarity or skin's pull rate.
  const uniform = totalWeight <= 0;
  if (uniform) totalWeight = buckets.reduce((sum, bucket) => sum + bucket.total.length, 0);
  let duplicateShare = 0;

  const odds = buckets.map((bucket) => {
    const share = totalWeight <= 0
      ? 0
      : uniform
        ? bucket.total.length / totalWeight
        : weightOf(bucket) / totalWeight;
    const ownedInRarity = bucket.total.length - bucket.remaining.length;
    duplicateShare += skinOutcomeShare * share * (ownedInRarity / bucket.total.length);
    return {
      rarity: bucket.rarity,
      chanceBps: Math.round(skinOutcomeShare * share * MAX_DROP_CHANCE_BPS),
      totalSkins: bucket.total.length,
      remainingForUser: bucket.remaining.length,
    };
  });
  return {
    odds,
    duplicateChanceBps: Math.round(duplicateShare * MAX_DROP_CHANCE_BPS),
  };
}

export type RolledLootboxReward =
  | { kind: 'skin'; skin: HeroSkinDefinition }
  | { kind: 'game_token'; source: 'duplicate'; skin: HeroSkinDefinition; amountTokens: string }
  | { kind: 'game_token'; source: 'direct'; amountTokens: string };

function rollWeightedSkin(
  candidates: HeroSkinDefinition[],
  weights: LootboxRarityWeights
): HeroSkinDefinition | null {
  if (candidates.length === 0) return null;
  const buckets = RARITY_ORDER
    .map((rarity) => ({ rarity, skins: candidates.filter((skin) => skin.rarity === rarity) }))
    .filter((bucket) => bucket.skins.length > 0);
  const totalWeight = buckets.reduce((sum, bucket) => sum + weights[bucket.rarity], 0);
  if (totalWeight <= 0) return candidates[randomInt(candidates.length)];

  let roll = randomInt(totalWeight);
  for (const bucket of buckets) {
    roll -= weights[bucket.rarity];
    if (roll < 0) return bucket.skins[randomInt(bucket.skins.length)];
  }
  return buckets[buckets.length - 1].skins[0];
}

// Taking the lower of two uniform rolls produces a linearly descending
// probability curve: the low end is common, while each step toward the maximum
// is progressively less likely. The pure roll mapping is exported so the
// economy curve can be verified deterministically without mocking crypto.
export function tokenAmountFromSlidingScaleRolls(
  range: LootboxTokenRange,
  firstRoll: number,
  secondRoll: number
): string {
  if (
    !Number.isInteger(firstRoll)
    || !Number.isInteger(secondRoll)
    || firstRoll < 0
    || secondRoll < 0
    || firstRoll > TOKEN_RANGE_SCALE_STEPS
    || secondRoll > TOKEN_RANGE_SCALE_STEPS
  ) {
    throw new LootboxServiceError(`Token range rolls must be integers between 0 and ${TOKEN_RANGE_SCALE_STEPS}`, 500);
  }
  if (
    !/^[0-9]+$/.test(range.minTokens)
    || !/^[0-9]+$/.test(range.maxTokens)
    || BigInt(range.minTokens) <= 0n
    || BigInt(range.minTokens) > BigInt(range.maxTokens)
    || BigInt(range.maxTokens) > MAX_PRICE_TOKENS
  ) {
    throw new LootboxServiceError('Token reward range is invalid', 500);
  }

  const minimum = BigInt(range.minTokens);
  const spread = BigInt(range.maxTokens) - minimum;
  if (spread === 0n) return minimum.toString();
  const lowerBiasedRoll = BigInt(Math.min(firstRoll, secondRoll));
  return (minimum + ((spread * lowerBiasedRoll) / BigInt(TOKEN_RANGE_SCALE_STEPS))).toString();
}

function rollSlidingScaleTokenAmount(range: LootboxTokenRange): string {
  return tokenAmountFromSlidingScaleRolls(
    range,
    randomInt(TOKEN_RANGE_SCALE_STEPS + 1),
    randomInt(TOKEN_RANGE_SCALE_STEPS + 1)
  );
}

export function directTokenDropWins(chanceBps: number, roll: number): boolean {
  if (!Number.isInteger(chanceBps) || chanceBps < 0 || chanceBps > MAX_DROP_CHANCE_BPS) {
    throw new LootboxServiceError(`Direct token chance must be between 0 and ${MAX_DROP_CHANCE_BPS}`, 500);
  }
  if (!Number.isInteger(roll) || roll < 0 || roll >= MAX_DROP_CHANCE_BPS) {
    throw new LootboxServiceError(`Direct token roll must be between 0 and ${MAX_DROP_CHANCE_BPS - 1}`, 500);
  }
  return roll < chanceBps;
}

// Every skin keeps the same pull rate regardless of ownership. Ownership is
// checked only after the full-pool skin roll; owned results convert to the
// snapshotted per-skin game-token range instead of granting another copy.
export function rollLootboxReward(
  ownedSkinIds: ReadonlySet<string>,
  weights: LootboxRarityWeights,
  duplicateReward: LootboxDuplicateRewardSettings,
  directTokenReward: LootboxDirectTokenRewardSettings,
  candidates: HeroSkinDefinition[] = lootboxPool()
): RolledLootboxReward | null {
  if (directTokenDropWins(directTokenReward.chanceBps, randomInt(MAX_DROP_CHANCE_BPS))) {
    return {
      kind: 'game_token',
      source: 'direct',
      amountTokens: rollSlidingScaleTokenAmount(directTokenReward.range),
    };
  }
  const skin = rollWeightedSkin(candidates, weights);
  if (!skin) return null;
  return resolveLootboxRewardForSkin(skin, ownedSkinIds, duplicateReward);
}

export function resolveLootboxRewardForSkin(
  skin: HeroSkinDefinition,
  ownedSkinIds: ReadonlySet<string>,
  duplicateReward: LootboxDuplicateRewardSettings
): RolledLootboxReward {
  if (ownedSkinIds.has(skin.id)) {
    const tokenRange = duplicateReward.skinTokenRanges[skin.id];
    if (!tokenRange) {
      throw new LootboxServiceError(`Duplicate reward is not configured for ${skin.id}`, 500);
    }
    const amountTokens = rollSlidingScaleTokenAmount(tokenRange);
    return { kind: 'game_token', source: 'duplicate', skin, amountTokens };
  }
  return { kind: 'skin', skin };
}

// Skin-only helper retained for pre-feature intent fallback and focused rarity
// tests. Normal opens use rollLootboxReward's full-pool selection.
export function rollLootboxSkin(
  ownedSkinIds: ReadonlySet<string>,
  weights: LootboxRarityWeights,
  candidates: HeroSkinDefinition[] = lootboxPool()
): HeroSkinDefinition | null {
  return rollWeightedSkin(
    candidates.filter((skin) => !ownedSkinIds.has(skin.id)),
    weights
  );
}

function intentSkinPool(intent: LootboxOpenIntentRecord): HeroSkinDefinition[] {
  if (!Array.isArray(intent.quotedSkinIds) || intent.quotedSkinIds.length === 0) {
    throw new LootboxServiceError('The quoted crate catalog is unavailable', 503);
  }
  const definitions = intent.quotedSkinIds
    .filter((skinId): skinId is HeroSkinId => typeof skinId === 'string' && isHeroSkinId(skinId))
    .map((skinId) => getHeroSkinDefinition(skinId));
  if (definitions.length !== intent.quotedSkinIds.length) {
    throw new LootboxServiceError('The quoted crate catalog is no longer available', 503);
  }
  return definitions;
}

interface LootboxRuntime {
  settings: LootboxSettingsRow;
  duplicateRewards: LootboxDuplicateRewardRow[];
  tokenMintAddress: string | null;
  tokenSymbol: string;
  cluster: string;
  treasuryWallet: string | null;
  rpcUrl: string | null;
  settlementSignerAddress: string | null;
}

async function loadLootboxRuntime(): Promise<LootboxRuntime> {
  const config = await getOrCreateLootboxConfig();
  const token = getGameTokenConfig();
  const settlementSigner = getSettlementKeypair();
  return {
    settings: config.settings,
    duplicateRewards: config.duplicateRewards,
    tokenMintAddress: token.mintAddress,
    tokenSymbol: token.symbol,
    cluster: token.cluster,
    treasuryWallet: readTreasuryWallet(),
    rpcUrl: readSolanaRpcUrl(),
    settlementSignerAddress: settlementSigner?.publicKey.toBase58() ?? null,
  };
}

function connectionForLootbox(runtime: LootboxRuntime): Connection {
  if (!runtime.rpcUrl) throw new LootboxServiceError('SOLANA_RPC_URL is not configured', 503);
  return lootboxConnectionFactory(runtime.rpcUrl);
}

async function loadTokenRuntime(runtime: LootboxRuntime): Promise<SplTokenMintRuntime | null> {
  if (!runtime.tokenMintAddress || !runtime.rpcUrl) return null;
  try {
    return await getSplTokenMintRuntime(connectionForLootbox(runtime), runtime.tokenMintAddress);
  } catch {
    return null;
  }
}

function tokenPayoutInfrastructureDisabledReason(runtime: LootboxRuntime): string | null {
  if (!runtime.tokenMintAddress) return 'Game token mint is not configured';
  if (!runtime.tokenSymbol) return 'GAME_TOKEN_SYMBOL is not configured';
  if (!runtime.treasuryWallet) return 'WAGER_TREASURY_WALLET is not configured';
  if (!runtime.rpcUrl) return 'SOLANA_RPC_URL is not configured';
  if (!runtime.settlementSignerAddress) return 'WAGER_SETTLEMENT_SECRET_KEY is not configured';
  if (runtime.settlementSignerAddress !== runtime.treasuryWallet) {
    return 'WAGER_SETTLEMENT_SECRET_KEY does not match WAGER_TREASURY_WALLET';
  }
  return null;
}

function openDisabledReason(runtime: LootboxRuntime): string | null {
  if (!runtime.settings.enabled) return 'Lootboxes are currently disabled';
  if (!runtime.tokenMintAddress) return 'Game token mint is not configured';
  if (!runtime.treasuryWallet) return 'WAGER_TREASURY_WALLET is not configured';
  if (!runtime.rpcUrl) return 'SOLANA_RPC_URL is not configured';
  return tokenPayoutInfrastructureDisabledReason(runtime);
}

function freeOpenDisabledReason(
  runtime: LootboxRuntime,
  ownedLootboxSkins: number
): string | null {
  const tokenRewardCanDrop = runtime.settings.directTokenRewardChanceBps > 0 || ownedLootboxSkins > 0;
  const payoutReason = tokenRewardCanDrop
    ? tokenPayoutInfrastructureDisabledReason(runtime)
    : null;
  return payoutReason;
}

function priceBaseUnits(priceTokens: string, decimals: number): bigint {
  return BigInt(priceTokens) * (10n ** BigInt(decimals));
}

async function loadFreeOpenBalance(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  const row = await prisma.lootboxFreeOpenBalance.findUnique({
    where: { userId },
    select: { balance: true },
  });
  return row && row.balance > 0 ? row.balance : 0;
}

export async function getLootboxStateForUser(userId?: string | null): Promise<LootboxStateResponse> {
  const [runtime, ownedSkinIds, freeOpensAvailable] = await Promise.all([
    loadLootboxRuntime(),
    loadOwnedSkinIds(userId),
    loadFreeOpenBalance(userId),
  ]);
  const tokenRuntime = await loadTokenRuntime(runtime);
  const buckets = buildRarityBuckets(ownedSkinIds);
  const weights = settingsWeights(runtime.settings);
  const poolSize = buckets.reduce((sum, bucket) => sum + bucket.total.length, 0);
  const remainingForUser = buckets.reduce((sum, bucket) => sum + bucket.remaining.length, 0);
  const configuredDuplicateReward = settingsDuplicateReward({
    settings: runtime.settings,
    duplicateRewards: runtime.duplicateRewards,
  });
  const directTokenReward = settingsDirectTokenReward(runtime.settings);
  const ownedLootboxSkins = poolSize - remainingForUser;
  const oddsSummary = buildOdds(buckets, weights, directTokenReward.chanceBps);

  return {
    enabled: runtime.settings.enabled,
    tokenMintAddress: runtime.tokenMintAddress,
    tokenSymbol: runtime.tokenMintAddress ? runtime.tokenSymbol : '',
    cluster: runtime.cluster,
    rpcConfigured: Boolean(runtime.rpcUrl),
    priceTokens: runtime.settings.priceTokens,
    priceTokenBaseUnits: tokenRuntime
      ? priceBaseUnits(runtime.settings.priceTokens, tokenRuntime.decimals).toString()
      : null,
    tokenDecimals: tokenRuntime?.decimals ?? null,
    weights,
    directTokenReward,
    duplicateChanceBps: oddsSummary.duplicateChanceBps,
    duplicateReward: configuredDuplicateReward,
    odds: oddsSummary.odds,
    poolSize,
    remainingForUser,
    openDisabledReason: openDisabledReason(runtime),
    freeOpensAvailable,
    freeOpenDisabledReason: freeOpenDisabledReason(runtime, ownedLootboxSkins),
  };
}

type LootboxOpenIntentRecord = NonNullable<Awaited<ReturnType<typeof prisma.lootboxOpenIntent.findUnique>>>;

function serializeIntent(intent: LootboxOpenIntentRecord): LootboxOpenIntentSnapshot {
  return {
    intentId: intent.id,
    status: intent.status as LootboxOpenIntentSnapshot['status'],
    walletAddress: intent.walletAddress,
    tokenMintAddress: intent.tokenMintAddress,
    tokenSymbol: intent.tokenSymbol,
    tokenAmountBaseUnits: intent.tokenAmountBaseUnits.toString(),
    priceTokens: intent.quotedPriceTokens,
    quotedWeights: intentWeights(intent),
    quotedDirectTokenReward: intentDirectTokenReward(intent),
    quotedDuplicateReward: intentDuplicateReward(intent),
    treasuryTokenAccount: intent.treasuryTokenAccount,
    memo: intent.memo,
    expiresAt: intent.intentExpiresAt.toISOString(),
    cluster: intent.cluster,
    transactionSignature: intent.transactionSignature,
    resultSkinId: intent.resultSkinId && isHeroSkinId(intent.resultSkinId) ? intent.resultSkinId : null,
    resultRarity: (intent.resultRarity as HeroSkinRarity | null) ?? null,
    resultKind: (intent.resultKind as LootboxRewardKind | null) ?? null,
    resultTokenAmount: intent.resultTokenAmount,
    tokenPayoutId: intent.tokenPayoutId,
    creditedAt: intent.creditedAt?.toISOString() ?? null,
    lastError: intent.lastError,
  };
}

function readPayerWalletAddress(walletAddress: string): string {
  const trimmed = walletAddress.trim();
  if (!trimmed) {
    throw new LootboxServiceError('A connected Solana wallet is required');
  }
  try {
    return assertSolanaPublicKey(trimmed, 'walletAddress').toBase58();
  } catch {
    throw new LootboxServiceError('walletAddress must be a valid Solana public key');
  }
}

export async function createLootboxOpenIntent(input: {
  userId: string;
  walletAddress: string;
}): Promise<LootboxOpenIntentSnapshot> {
  const walletAddress = readPayerWalletAddress(input.walletAddress);
  const [user, runtime] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } }),
    loadLootboxRuntime(),
  ]);
  if (!user) {
    throw new LootboxServiceError('Sign in to open lootboxes', 401);
  }

  const reason = openDisabledReason(runtime);
  if (reason) throw new LootboxServiceError(reason, 400);

  const tokenMintAddress = runtime.tokenMintAddress!;
  const treasuryWallet = runtime.treasuryWallet!;
  assertSolanaPublicKey(tokenMintAddress, 'tokenMintAddress');
  assertSolanaPublicKey(treasuryWallet, 'treasuryWallet');
  if (walletAddress === treasuryWallet) {
    throw new LootboxServiceError('Connect a wallet different from WAGER_TREASURY_WALLET to open lootboxes');
  }

  const connection = connectionForLootbox(runtime);
  const tokenRuntime = await getSplTokenMintRuntime(connection, tokenMintAddress);
  const treasuryTokenAccount = await getAssociatedTokenAccountAddress({
    ownerAddress: treasuryWallet,
    tokenMintAddress,
    tokenProgramId: tokenRuntime.tokenProgramId,
  });

  const intentId = randomUUID();
  const now = new Date();
  const duplicateReward = settingsDuplicateReward({
    settings: runtime.settings,
    duplicateRewards: runtime.duplicateRewards,
  });
  const intent = await prisma.lootboxOpenIntent.create({
    data: {
      id: intentId,
      userId: input.userId,
      walletAddress,
      quotedPriceTokens: runtime.settings.priceTokens,
      quotedCommonWeightBps: runtime.settings.commonWeightBps,
      quotedEpicWeightBps: runtime.settings.epicWeightBps,
      quotedUniqueWeightBps: runtime.settings.uniqueWeightBps,
      quotedLegendaryWeightBps: runtime.settings.legendaryWeightBps,
      quotedDirectTokenRewardChanceBps: runtime.settings.directTokenRewardChanceBps,
      quotedDirectTokenRewardMinTokens: runtime.settings.directTokenRewardMinTokens,
      quotedDirectTokenRewardMaxTokens: runtime.settings.directTokenRewardMaxTokens,
      quotedDuplicateTokenRanges: duplicateTokenRangesJson(duplicateReward.skinTokenRanges),
      quotedSkinIds: lootboxPool().map((skin) => skin.id),
      tokenMintAddress,
      tokenSymbol: runtime.tokenSymbol,
      tokenAmountBaseUnits: priceBaseUnits(runtime.settings.priceTokens, tokenRuntime.decimals),
      tokenDecimals: tokenRuntime.decimals,
      treasuryWallet,
      treasuryTokenAccount,
      cluster: runtime.cluster,
      memo: createLootboxPaymentMemo(intentId),
      status: 'intent_created',
      intentExpiresAt: new Date(now.getTime() + DEFAULT_INTENT_TTL_MS),
    },
  });

  return serializeIntent(intent);
}

async function getIntentForUser(userId: string, intentId: string): Promise<LootboxOpenIntentRecord> {
  const intent = await prisma.lootboxOpenIntent.findUnique({ where: { id: intentId } });
  if (!intent || intent.userId !== userId) {
    throw new LootboxServiceError('Lootbox open intent not found', 404);
  }
  return intent;
}

function assertIntentCanBuild(intent: { status: string; intentExpiresAt: Date }): void {
  if (intent.status === 'expired' || intent.intentExpiresAt.getTime() <= Date.now()) {
    throw new LootboxServiceError('Lootbox open intent has expired', 409);
  }
  if (intent.status !== 'intent_created' && intent.status !== 'transaction_built') {
    throw new LootboxServiceError('Lootbox payment can no longer be rebuilt', 409);
  }
}

export async function buildLootboxOpenTransaction(input: {
  userId: string;
  intentId: string;
}): Promise<LootboxOpenTransactionSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  assertIntentCanBuild(intent);

  const runtime = await loadLootboxRuntime();
  const connection = connectionForLootbox(runtime);
  const tokenRuntime = await getSplTokenMintRuntime(connection, intent.tokenMintAddress);
  const built = await buildSplTokenPaymentTransaction({
    connection,
    walletAddress: intent.walletAddress,
    tokenMintAddress: intent.tokenMintAddress,
    treasuryWallet: intent.treasuryWallet,
    tokenAmountBaseUnits: intent.tokenAmountBaseUnits.toString(),
    tokenDecimals: intent.tokenDecimals ?? tokenRuntime.decimals,
    tokenProgramId: tokenRuntime.tokenProgramId,
    memo: intent.memo,
  });

  const transitioned = await prisma.lootboxOpenIntent.updateMany({
    where: {
      id: intent.id,
      status: { in: ['intent_created', 'transaction_built'] },
      transactionSignature: null,
    },
    data: {
      status: 'transaction_built',
      treasuryTokenAccount: built.treasuryTokenAccount,
      lastValidBlockHeight: BigInt(built.lastValidBlockHeight),
      lastError: null,
    },
  });
  if (transitioned.count !== 1) {
    throw new LootboxServiceError('Lootbox payment state changed; refresh and try again', 409);
  }
  const updated = await getIntentForUser(input.userId, intent.id);

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

function signedTransactionSignature(transaction: Transaction, intent: {
  walletAddress: string;
  memo: string;
}): string {
  if (transaction.feePayer?.toBase58() !== intent.walletAddress) {
    throw new LootboxServiceError('Signed transaction fee payer does not match wallet');
  }
  const hasMemo = transaction.instructions.some((instruction) => (
    instruction.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' &&
    Buffer.from(instruction.data).toString('utf8') === intent.memo
  ));
  if (!hasMemo) throw new LootboxServiceError('Signed transaction memo does not match lootbox intent');
  const payerSignature = transaction.signatures.find((entry) => entry.publicKey.toBase58() === intent.walletAddress);
  if (!payerSignature?.signature) {
    throw new LootboxServiceError('Signed transaction is missing the wallet signature');
  }
  return bs58.encode(payerSignature.signature);
}

function decodeLootboxTransaction(transactionBase64: string): Transaction {
  if (typeof transactionBase64 !== 'string' || transactionBase64.length > 16_384) {
    throw new LootboxServiceError('Invalid transaction payload');
  }
  try {
    return Transaction.from(Buffer.from(transactionBase64, 'base64'));
  } catch {
    throw new LootboxServiceError('Transaction could not be decoded');
  }
}

export async function submitSignedLootboxOpenTransaction(input: {
  userId: string;
  intentId: string;
  signedTransactionBase64: string;
}): Promise<LootboxOpenIntentSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  if (intent.status === 'failed' || intent.status === 'expired' || intent.status === 'confirmed') {
    throw new LootboxServiceError('Lootbox payment can no longer be submitted', 409);
  }

  const transaction = decodeLootboxTransaction(input.signedTransactionBase64);
  const signature = signedTransactionSignature(transaction, intent);
  await recordLootboxOpenSignature({
    userId: input.userId,
    intentId: input.intentId,
    signature,
  });

  const runtime = await loadLootboxRuntime();
  try {
    const broadcastSignature = await connectionForLootbox(runtime).sendRawTransaction(transaction.serialize(), {
      maxRetries: 0,
      preflightCommitment: 'confirmed',
    });
    if (broadcastSignature !== signature) {
      throw new LootboxServiceError('Solana returned an unexpected transaction signature', 502);
    }
  } catch (error) {
    // The deterministic signature is already durable. The reconciliation
    // worker will distinguish an accepted broadcast from a transaction that
    // never landed, without asking the player to pay again.
    console.warn('[lootbox] signed payment broadcast needs reconciliation', {
      intentId: intent.id,
      signature,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return verifySubmittedLootboxOpen(input.userId, intent.id, { keepSubmittedWhenNotFound: true });
}

async function recordLootboxOpenSignature(input: {
  userId: string;
  intentId: string;
  signature: string;
}): Promise<LootboxOpenIntentSnapshot> {
  if (!signatureLooksValid(input.signature)) {
    throw new LootboxServiceError('Invalid Solana transaction signature');
  }
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  if (intent.transactionSignature && intent.transactionSignature !== input.signature) {
    throw new LootboxServiceError('A different transaction is already attached to this open', 409);
  }
  if (intent.status === 'failed' || intent.status === 'expired' || intent.status === 'confirmed') {
    throw new LootboxServiceError('Lootbox payment can no longer be submitted', 409);
  }
  if (intent.intentExpiresAt.getTime() <= Date.now() && !intent.transactionSignature) {
    throw new LootboxServiceError('Lootbox open intent has expired', 409);
  }

  const duplicate = await prisma.lootboxOpenIntent.findFirst({
    where: {
      transactionSignature: input.signature,
      id: { not: intent.id },
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new LootboxServiceError('Transaction signature has already been used', 409);
  }

  const transitioned = await prisma.lootboxOpenIntent.updateMany({
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
    throw new LootboxServiceError('Lootbox payment state changed; refresh and try again', 409);
  }
  return serializeIntent(await getIntentForUser(input.userId, intent.id));
}

export async function submitLootboxOpenSignature(input: {
  userId: string;
  intentId: string;
  signature: string;
}): Promise<LootboxOpenIntentSnapshot> {
  const recorded = await recordLootboxOpenSignature(input);
  if (recorded.status === 'credited') return recorded;

  return verifySubmittedLootboxOpen(input.userId, input.intentId, { keepSubmittedWhenNotFound: true });
}

async function createLootboxTokenPayout(
  tx: Prisma.TransactionClient,
  input: {
    intentId: string;
    userId: string;
    walletAddress: string;
    tokenMintAddress: string;
    tokenSymbol: string;
    tokenDecimals: number;
    amountTokens: string;
  }
): Promise<string> {
  const amountBaseUnits = priceBaseUnits(input.amountTokens, input.tokenDecimals);
  const payout = await tx.gameTokenPayout.create({
    data: {
      userId: input.userId,
      walletAddress: input.walletAddress,
      tokenMintAddress: input.tokenMintAddress,
      tokenSymbol: input.tokenSymbol,
      tokenAmountBaseUnits: amountBaseUnits,
      recipientAmountBaseUnits: amountBaseUnits,
      burnAmountBaseUnits: 0n,
      playerShareBps: 10_000,
      burnShareBps: 0,
      tokenDecimals: input.tokenDecimals,
      idempotencyKey: `lootbox:${input.intentId}`,
    },
  });
  return payout.id;
}

// Rolls and grants the outcome atomically. The roll happens here — after the
// on-chain payment has been verified — never at intent time, so a pending
// intent leaks nothing about its outcome. Serializable isolation plus the
// in-transaction status re-check makes concurrent verify calls credit (and
async function creditLootboxOpen(intent: LootboxOpenIntentRecord): Promise<LootboxOpenIntentSnapshot> {
  const creditedAt = new Date();
  const credited = await (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const current = await tx.lootboxOpenIntent.findUnique({ where: { id: intent.id } });
        if (!current) throw new LootboxServiceError('Lootbox open intent not found', 404);
        if (current.status === 'credited') return current;
        if (current.status !== 'confirmed' && current.status !== 'submitted') {
          throw new LootboxServiceError('Lootbox payment is not ready to credit', 409);
        }

        const [ownershipRows, reservedPurchaseRows] = await Promise.all([
          tx.userSkinOwnership.findMany({
            where: { userId: intent.userId, revokedAt: null },
            select: { skinId: true },
          }),
          tx.marketplacePurchaseIntent.findMany({
            where: {
              buyerUserId: intent.userId,
              status: { in: ['intent_created', 'transaction_built', 'submitted', 'confirmed'] },
            },
            select: { skinId: true },
          }),
        ]);
        const ownedSkinIds = new Set([
          ...ownershipRows.map((row) => row.skinId),
          ...reservedPurchaseRows.map((row) => row.skinId),
        ]);
        const quotedWeights = intentWeights(current);
        const quotedPool = intentSkinPool(current);
        const rolled = rollLootboxReward(
          ownedSkinIds,
          quotedWeights,
          intentDuplicateReward(current),
          intentDirectTokenReward(current),
          quotedPool
        );
        if (!rolled) throw new LootboxServiceError('No lootbox rewards are available', 503);

        let tokenPayoutId: string | null = null;
        const rolledSkin = 'skin' in rolled ? rolled.skin : null;
        if (rolled.kind === 'skin') {
          await tx.userSkinOwnership.upsert({
            where: { userId_skinId: { userId: intent.userId, skinId: rolled.skin.id } },
            create: {
              userId: intent.userId,
              skinId: rolled.skin.id,
              source: 'lootbox',
              grantedAt: creditedAt,
            },
            update: {
              source: 'lootbox',
              purchaseId: null,
              revokedAt: null,
            },
          });
        } else {
          if (current.tokenDecimals === null) {
            throw new LootboxServiceError('Game token decimals were not snapshotted for this open', 500);
          }
          tokenPayoutId = await createLootboxTokenPayout(tx, {
            intentId: current.id,
            userId: current.userId,
            walletAddress: current.walletAddress,
            tokenMintAddress: current.tokenMintAddress,
            tokenSymbol: current.tokenSymbol,
            tokenDecimals: current.tokenDecimals,
            amountTokens: rolled.amountTokens,
          });
        }
        return tx.lootboxOpenIntent.update({
          where: { id: intent.id },
          data: {
            status: 'credited',
            resultKind: rolled.kind,
            resultSkinId: rolledSkin?.id ?? null,
            resultRarity: rolledSkin?.rarity ?? null,
            resultTokenAmount: rolled.kind === 'game_token' ? rolled.amountTokens : null,
            tokenPayoutId,
            creditedAt,
            lastError: null,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializableTransactionConflict(error)) {
        throw new LootboxServiceError('Lootbox is being opened; try again', 409);
      }
      throw error;
    }
  })();

  return serializeIntent(credited);
}

export async function verifySubmittedLootboxOpen(
  userId: string,
  intentId: string,
  options: { keepSubmittedWhenNotFound?: boolean } = {}
): Promise<LootboxOpenIntentSnapshot> {
  const intent = await getIntentForUser(userId, intentId);
  if (intent.status === 'credited') return serializeIntent(intent);
  if (!intent.transactionSignature) {
    return serializeIntent(intent);
  }
  if (intent.status === 'confirmed') {
    return creditLootboxOpen(intent);
  }

  const runtime = await loadLootboxRuntime();
  const connection = connectionForLootbox(runtime);
  const transaction = await connection.getParsedTransaction(intent.transactionSignature, {
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
          // A failed block-height lookup cannot prove the transaction expired.
          transactionNotFoundExpired = false;
        }
      } else {
        const retryDeadlineMs = intent.intentExpiresAt.getTime() + DEFAULT_INTENT_EXPIRY_GRACE_MS;
        transactionNotFoundExpired = Date.now() > retryDeadlineMs;
      }
    }
    if (
      result.reason === 'transaction_not_found' &&
      options.keepSubmittedWhenNotFound &&
      !transactionNotFoundExpired
    ) {
      await prisma.lootboxOpenIntent.updateMany({
        where: { id: intent.id, status: { in: ['submitted', 'confirmed'] } },
        data: { lastError: result.reason },
      });
      return serializeIntent(await getIntentForUser(userId, intent.id));
    }
    await prisma.lootboxOpenIntent.updateMany({
      where: { id: intent.id, status: { in: ['submitted', 'confirmed'] } },
      data: {
        status: result.reason === 'expired_intent' || transactionNotFoundExpired ? 'expired' : 'failed',
        lastError: transactionNotFoundExpired
          ? 'expired_intent'
          : result.reason,
      },
    });
    return serializeIntent(await getIntentForUser(userId, intent.id));
  }

  await prisma.lootboxOpenIntent.updateMany({
    where: { id: intent.id, status: 'submitted' },
    data: { status: 'confirmed', lastError: null },
  });
  return creditLootboxOpen(await getIntentForUser(userId, intent.id));
}

export async function getLootboxOpenIntent(input: {
  userId: string;
  intentId: string;
}): Promise<LootboxOpenIntentSnapshot> {
  const intent = await getIntentForUser(input.userId, input.intentId);
  if (
    (intent.status === 'intent_created' || intent.status === 'transaction_built') &&
    intent.intentExpiresAt.getTime() <= Date.now()
  ) {
    await prisma.lootboxOpenIntent.updateMany({
      where: { id: intent.id, status: { in: ['intent_created', 'transaction_built'] } },
      data: { status: 'expired', lastError: 'intent_expired' },
    });
    return serializeIntent(await getIntentForUser(input.userId, intent.id));
  }
  if (intent.status === 'submitted' || intent.status === 'confirmed') {
    return verifySubmittedLootboxOpen(input.userId, input.intentId, { keepSubmittedWhenNotFound: true });
  }
  return serializeIntent(intent);
}

export interface LootboxReconciliationResult {
  scanned: number;
  credited: number;
  pending: number;
  terminal: number;
  failures: Array<{ intentId: string; message: string }>;
}

// Reconciles wallet payments even when the browser closes or loses the submit
// response. Calls are idempotent: verification is read-only on-chain and the
// serializable credit transaction re-checks the intent status before granting.
export async function reconcilePendingLootboxOpens(limit = 25): Promise<LootboxReconciliationResult> {
  const take = Number.isFinite(limit)
    ? Math.max(1, Math.min(100, Math.trunc(limit)))
    : 25;
  const candidates = await prisma.lootboxOpenIntent.findMany({
    where: {
      transactionSignature: { not: null },
      OR: [
        { status: 'submitted' },
        { status: 'confirmed' },
      ],
    },
    orderBy: { updatedAt: 'asc' },
    take,
    select: { id: true, userId: true },
  });

  const result: LootboxReconciliationResult = {
    scanned: candidates.length,
    credited: 0,
    pending: 0,
    terminal: 0,
    failures: [],
  };

  for (const candidate of candidates) {
    try {
      const reconciled = await verifySubmittedLootboxOpen(candidate.userId, candidate.id, {
        keepSubmittedWhenNotFound: true,
      });
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

// Opens a crate using an admin-granted free credit. No payment or wallet
// signature is needed, but a recipient wallet is required whenever a direct
// token drop or duplicate conversion can occur. The credit spend, outcome,
// entitlement/payout, and audit intent all commit atomically.
export async function openLootboxWithFreeCredit(input: {
  userId: string;
  walletAddress?: string;
}): Promise<LootboxOpenIntentSnapshot> {
  const [user, runtime, ownedSkinIdsBeforeOpen] = await Promise.all([
    prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, walletAddress: true } }),
    loadLootboxRuntime(),
    loadOwnedSkinIds(input.userId),
  ]);
  if (!user) {
    throw new LootboxServiceError('Sign in to open lootboxes', 401);
  }

  const duplicateReward = settingsDuplicateReward({
    settings: runtime.settings,
    duplicateRewards: runtime.duplicateRewards,
  });
  const directTokenReward = settingsDirectTokenReward(runtime.settings);
  const duplicateCanDrop = lootboxPool().some((skin) => ownedSkinIdsBeforeOpen.has(skin.id));
  const tokenRewardCanDrop = directTokenReward.chanceBps > 0 || duplicateCanDrop;
  const payoutReason = tokenRewardCanDrop ? tokenPayoutInfrastructureDisabledReason(runtime) : null;
  if (payoutReason) throw new LootboxServiceError(payoutReason, 503);

  const recipientWallet = tokenRewardCanDrop
    ? readPayerWalletAddress(input.walletAddress ?? user.walletAddress ?? '')
    : (input.walletAddress?.trim() || user.walletAddress || FREE_OPEN_PLACEHOLDER);
  if (tokenRewardCanDrop && recipientWallet === runtime.treasuryWallet) {
    throw new LootboxServiceError('Connect a wallet different from WAGER_TREASURY_WALLET to open lootboxes');
  }
  const tokenRuntime = tokenRewardCanDrop ? await loadTokenRuntime(runtime) : null;
  if (tokenRewardCanDrop && !tokenRuntime) {
    throw new LootboxServiceError('Game token runtime is unavailable', 503);
  }

  const creditedAt = new Date();
  const intentId = randomUUID();
  const credited = await (async () => {
    try {
      return await prisma.$transaction(async (tx) => {
        const credit = await tx.lootboxFreeOpenBalance.findUnique({ where: { userId: input.userId } });
        if (!credit || credit.balance <= 0) {
          throw new LootboxServiceError('No free crate opens available', 400);
        }

        const [ownershipRows, reservedPurchaseRows] = await Promise.all([
          tx.userSkinOwnership.findMany({
            where: { userId: input.userId, revokedAt: null },
            select: { skinId: true },
          }),
          tx.marketplacePurchaseIntent.findMany({
            where: {
              buyerUserId: input.userId,
              status: { in: ['intent_created', 'transaction_built', 'submitted', 'confirmed'] },
            },
            select: { skinId: true },
          }),
        ]);
        const rolled = rollLootboxReward(
          new Set([
            ...ownershipRows.map((row) => row.skinId),
            ...reservedPurchaseRows.map((row) => row.skinId),
          ]),
          settingsWeights(runtime.settings),
          duplicateReward,
          directTokenReward
        );
        if (!rolled) {
          throw new LootboxServiceError('No lootbox rewards are available', 503);
        }

        await tx.lootboxFreeOpenBalance.update({
          where: { userId: input.userId },
          data: { balance: { decrement: 1 } },
        });
        let tokenPayoutId: string | null = null;
        const rolledSkin = 'skin' in rolled ? rolled.skin : null;
        if (rolled.kind === 'skin') {
          await tx.userSkinOwnership.upsert({
            where: { userId_skinId: { userId: input.userId, skinId: rolled.skin.id } },
            create: {
              userId: input.userId,
              skinId: rolled.skin.id,
              source: 'lootbox',
              grantedAt: creditedAt,
            },
            update: {
              source: 'lootbox',
              purchaseId: null,
              revokedAt: null,
            },
          });
        } else {
          if (!tokenRuntime || recipientWallet === FREE_OPEN_PLACEHOLDER || !runtime.tokenMintAddress) {
            throw new LootboxServiceError('Connect a wallet to receive a token reward', 409);
          }
          tokenPayoutId = await createLootboxTokenPayout(tx, {
            intentId,
            userId: input.userId,
            walletAddress: recipientWallet,
            tokenMintAddress: runtime.tokenMintAddress,
            tokenSymbol: runtime.tokenSymbol,
            tokenDecimals: tokenRuntime.decimals,
            amountTokens: rolled.amountTokens,
          });
        }
        return tx.lootboxOpenIntent.create({
          data: {
            id: intentId,
            userId: input.userId,
            walletAddress: recipientWallet,
            quotedPriceTokens: '0',
            quotedCommonWeightBps: runtime.settings.commonWeightBps,
            quotedEpicWeightBps: runtime.settings.epicWeightBps,
            quotedUniqueWeightBps: runtime.settings.uniqueWeightBps,
            quotedLegendaryWeightBps: runtime.settings.legendaryWeightBps,
            quotedDirectTokenRewardChanceBps: directTokenReward.chanceBps,
            quotedDirectTokenRewardMinTokens: directTokenReward.range.minTokens,
            quotedDirectTokenRewardMaxTokens: directTokenReward.range.maxTokens,
            quotedDuplicateTokenRanges: duplicateTokenRangesJson(duplicateReward.skinTokenRanges),
            quotedSkinIds: lootboxPool().map((skin) => skin.id),
            tokenMintAddress: runtime.tokenMintAddress ?? FREE_OPEN_PLACEHOLDER,
            tokenSymbol: runtime.tokenMintAddress ? runtime.tokenSymbol : '',
            tokenAmountBaseUnits: 0n,
            tokenDecimals: tokenRuntime?.decimals ?? null,
            treasuryWallet: runtime.treasuryWallet ?? FREE_OPEN_PLACEHOLDER,
            treasuryTokenAccount: FREE_OPEN_PLACEHOLDER,
            cluster: runtime.cluster,
            memo: `${LOOTBOX_FREE_OPEN_MEMO_PREFIX}${intentId}`,
            status: 'credited',
            intentExpiresAt: creditedAt,
            resultKind: rolled.kind,
            resultSkinId: rolledSkin?.id ?? null,
            resultRarity: rolledSkin?.rarity ?? null,
            resultTokenAmount: rolled.kind === 'game_token' ? rolled.amountTokens : null,
            tokenPayoutId,
            creditedAt,
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isSerializableTransactionConflict(error)) {
        throw new LootboxServiceError('Crate is being opened; try again', 409);
      }
      throw error;
    }
  })();

  return serializeIntent(credited);
}

export interface LootboxFreeOpenGrantResult {
  granted: Array<{ userId: string; name: string | null; balance: number }>;
  skippedUserIds: string[];
  count: number;
}

function readFreeOpenGrantCount(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof parsed !== 'number' || !Number.isInteger(parsed) || parsed < 1 || parsed > MAX_FREE_OPEN_GRANT) {
    throw new LootboxServiceError(`Free open count must be an integer between 1 and ${MAX_FREE_OPEN_GRANT}`);
  }
  return parsed;
}

export async function grantLootboxFreeOpens(input: {
  userIds: string[];
  count: unknown;
  grantedByUserId: string;
}): Promise<LootboxFreeOpenGrantResult> {
  const count = readFreeOpenGrantCount(input.count);
  const userIds = Array.from(new Set(input.userIds.map((id) => id.trim()).filter(Boolean)));
  if (userIds.length === 0) {
    throw new LootboxServiceError('Provide at least one user id');
  }
  if (userIds.length > 1000) {
    throw new LootboxServiceError('Cannot grant to more than 1000 users at once');
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const foundIds = new Set(users.map((user) => user.id));

  const updated = await prisma.$transaction(users.map((user) =>
    prisma.lootboxFreeOpenBalance.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        balance: count,
        totalGranted: count,
        lastGrantedById: input.grantedByUserId,
      },
      update: {
        balance: { increment: count },
        totalGranted: { increment: count },
        lastGrantedById: input.grantedByUserId,
      },
    })
  ));
  const nameByUserId = new Map(users.map((user) => [user.id, user.name]));

  return {
    granted: updated.map((row) => ({
      userId: row.userId,
      name: nameByUserId.get(row.userId) ?? null,
      balance: row.balance,
    })),
    skippedUserIds: userIds.filter((id) => !foundIds.has(id)),
    count,
  };
}

export interface LootboxAdminOverview {
  settings: LootboxSettingsSnapshot;
  tokenPayoutsReady: boolean;
  tokenPayoutsDisabledReason: string | null;
  totalOpens: number;
  recentResults: Array<{
    intentId: string;
    userId: string;
    rewardKind: LootboxRewardKind;
    skinId: string | null;
    rarity: string | null;
    tokenAmount: string | null;
    tokenSymbol: string;
    tokenPayoutStatus: string | null;
    creditedAt: string;
  }>;
  freeOpens: {
    totalOutstanding: number;
    balances: Array<{ userId: string; name: string | null; balance: number; totalGranted: number }>;
  };
}

export async function getLootboxAdminOverview(): Promise<LootboxAdminOverview> {
  const [runtime, totalOpens, recent, freeOpenRows, freeOpenSum] = await Promise.all([
    loadLootboxRuntime(),
    prisma.lootboxOpenIntent.count({ where: { status: 'credited' } }),
    prisma.lootboxOpenIntent.findMany({
      where: { status: 'credited' },
      orderBy: { creditedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        userId: true,
        resultKind: true,
        resultSkinId: true,
        resultRarity: true,
        resultTokenAmount: true,
        tokenSymbol: true,
        creditedAt: true,
        tokenPayout: { select: { status: true } },
      },
    }),
    prisma.lootboxFreeOpenBalance.findMany({
      where: { balance: { gt: 0 } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
      include: { user: { select: { name: true } } },
    }),
    prisma.lootboxFreeOpenBalance.aggregate({
      _sum: { balance: true },
      where: { balance: { gt: 0 } },
    }),
  ]);
  const payoutsDisabledReason = tokenPayoutInfrastructureDisabledReason(runtime);

  return {
    settings: serializeLootboxSettings({
      settings: runtime.settings,
      duplicateRewards: runtime.duplicateRewards,
    }),
    tokenPayoutsReady: payoutsDisabledReason === null,
    tokenPayoutsDisabledReason: payoutsDisabledReason,
    totalOpens,
    freeOpens: {
      totalOutstanding: freeOpenSum._sum.balance ?? 0,
      balances: freeOpenRows.map((row) => ({
        userId: row.userId,
        name: row.user?.name ?? null,
        balance: row.balance,
        totalGranted: row.totalGranted,
      })),
    },
    recentResults: recent
      .filter((row) => row.resultKind && row.creditedAt)
      .map((row) => ({
        intentId: row.id,
        userId: row.userId,
        rewardKind: row.resultKind!,
        skinId: row.resultSkinId,
        rarity: row.resultRarity,
        tokenAmount: row.resultTokenAmount,
        tokenSymbol: row.tokenSymbol,
        tokenPayoutStatus: row.tokenPayout?.status ?? null,
        creditedAt: row.creditedAt!.toISOString(),
      })),
  };
}

export function describeLootboxSkin(skinId: HeroSkinId): HeroSkinDefinition {
  return getHeroSkinDefinition(skinId);
}
