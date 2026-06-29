import { createHash } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { create, fetchCollection } from '@metaplex-foundation/mpl-core';
import { createSignerFromKeypair, generateSigner, keypairIdentity, publicKey } from '@metaplex-foundation/umi';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import {
  DEFAULT_HERO_SKIN_IDS,
  getHeroSkinDefinition,
  isHeroSkinId,
  type HeroSkinDefinition,
  type HeroSkinId,
} from '@voxel-strike/shared';
import prisma from '../db';
import { loggers } from '../utils/logger';

const DEFAULT_SYNC_CACHE_MS = 60_000;
const DEFAULT_DAS_LIMIT = 100;
const DEFAULT_DAS_TIMEOUT_MS = 12_000;
const DEFAULT_NFT_EDITION = 'genesis';
const STALE_MINTING_RETRY_MS = 5 * 60 * 1000;

export class SkinNftServiceError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'SkinNftServiceError';
    this.statusCode = statusCode;
  }
}

export interface SkinNftConfig {
  enabled: boolean;
  collectionAddress: string | null;
  mintAuthorityPublicKey: string | null;
  metadataBaseUri: string | null;
  metadataUriTemplate: string | null;
  dasRpcUrl: string | null;
  rpcUrl: string | null;
  cluster: string;
  edition: string;
  founderMintEnabled: boolean;
  syncCacheMs: number;
  mintAuthoritySecretConfigured: boolean;
}

export interface SkinNftReadiness {
  enabled: boolean;
  collectionAddress: string | null;
  collectionConfigured: boolean;
  mintAuthorityPublicKey: string | null;
  mintAuthoritySecretConfigured: boolean;
  mintAuthorityMatchesPublicKey: boolean | null;
  mintAuthorityError: string | null;
  metadataBaseUri: string | null;
  metadataUriTemplate: string | null;
  metadataConfigured: boolean;
  dasRpcConfigured: boolean;
  rpcConfigured: boolean;
  readyToSync: boolean;
  readyToMint: boolean;
  founderMintEnabled: boolean;
  cluster: string;
  edition: string;
}

export interface SkinNftWalletSyncSummary {
  enabled: boolean;
  collectionAddress: string | null;
  walletAddress: string | null;
  assetCount: number;
  activeEntitlementCount: number;
  synced: boolean;
  cached: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
}

export interface SkinNftOwnershipState {
  enabled: boolean;
  collectionAddress: string | null;
  readyToSync: boolean;
  sync: {
    lastSyncedAt: string | null;
    lastError: string | null;
  };
  assetCountsBySkin: Map<HeroSkinId, number>;
}

export interface MintSkinNftInput {
  ownerAddress: string;
  skin: HeroSkinDefinition;
  metadataUri: string;
  serial: string;
  source: string;
  assetSeed?: string;
}

export interface MintSkinNftResult {
  assetAddress: string;
  collectionAddress: string;
  metadataUri: string;
  mintSignature: string;
  serial: string;
  edition: string;
}

export interface MintedSkinNftProjectionInput {
  assetAddress: string;
  collectionAddress: string;
  metadataUri: string | null;
  mintSignature: string | null;
  serial: string;
  edition: string;
  userId: string;
  ownerWalletAddress: string;
  skin: HeroSkinDefinition;
  sourcePurchaseId: string | null;
  source: string;
  syncedAt?: Date;
}

export interface FailedSkinNftMintQueueItem {
  intentId: string;
  skinId: string;
  walletAddress: string;
  status: string;
  nftMintStatus: string;
  mintedAssetAddress: string | null;
  nftCollectionAddress: string | null;
  nftMetadataUri: string | null;
  nftMintSignature: string | null;
  nftMintAttemptCount: number;
  nftMintAttemptedAt: string | null;
  nftMintError: string | null;
  updatedAt: string;
}

function readEnv(name: string): string {
  return process.env[name]?.trim() || '';
}

function envFlag(name: string, fallback = false): boolean {
  const raw = readEnv(name).toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function readPositiveInteger(name: string, fallback: number): number {
  const raw = readEnv(name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function cleanPublicKey(value: string): string | null {
  if (!value) return null;
  try {
    const parsed = new PublicKey(value);
    return parsed.toBase58() === value ? value : null;
  } catch {
    return null;
  }
}

function readOptionalPublicKey(...names: string[]): string | null {
  for (const name of names) {
    const parsed = cleanPublicKey(readEnv(name));
    if (parsed) return parsed;
  }
  return null;
}

function readMintAuthoritySecret(): string {
  return readEnv('SKIN_NFT_MINT_AUTHORITY_SECRET_KEY') || readEnv('SKIN_NFT_MINT_AUTHORITY_KEYPAIR');
}

export function getSkinNftConfig(): SkinNftConfig {
  const collectionAddress = readOptionalPublicKey('SKIN_NFT_COLLECTION_ADDRESS');
  return {
    enabled: envFlag('SKIN_NFT_ENABLED', Boolean(collectionAddress)),
    collectionAddress,
    mintAuthorityPublicKey: readOptionalPublicKey('SKIN_NFT_MINT_AUTHORITY_PUBLIC_KEY'),
    metadataBaseUri: readEnv('SKIN_NFT_METADATA_BASE_URI') || null,
    metadataUriTemplate: readEnv('SKIN_NFT_METADATA_URI_TEMPLATE') || null,
    dasRpcUrl: readEnv('SKIN_NFT_DAS_RPC_URL') || null,
    rpcUrl: readEnv('SOLANA_RPC_URL') || null,
    cluster: readEnv('SOLANA_CLUSTER') || 'mainnet-beta',
    edition: readEnv('SKIN_NFT_EDITION') || DEFAULT_NFT_EDITION,
    founderMintEnabled: envFlag('SKIN_NFT_FOUNDER_ENABLED', false),
    syncCacheMs: readPositiveInteger('SKIN_NFT_SYNC_CACHE_MS', DEFAULT_SYNC_CACHE_MS),
    mintAuthoritySecretConfigured: Boolean(readMintAuthoritySecret()),
  };
}

function parseMintAuthoritySecret(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new SkinNftServiceError('SKIN_NFT_MINT_AUTHORITY_SECRET_KEY is not configured', 503);
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed) || !parsed.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      throw new SkinNftServiceError('SKIN_NFT_MINT_AUTHORITY_SECRET_KEY must be a byte array', 503);
    }
    return Uint8Array.from(parsed);
  }

  if (/^[0-9,\s]+$/.test(trimmed) && trimmed.includes(',')) {
    const bytes = trimmed.split(',').map((part) => Number(part.trim()));
    if (!bytes.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      throw new SkinNftServiceError('SKIN_NFT_MINT_AUTHORITY_SECRET_KEY contains invalid bytes', 503);
    }
    return Uint8Array.from(bytes);
  }

  try {
    return bs58.decode(trimmed);
  } catch {
    throw new SkinNftServiceError('SKIN_NFT_MINT_AUTHORITY_SECRET_KEY must be JSON bytes, comma bytes, or base58', 503);
  }
}

function keypairFromSecret(secret: string): Keypair {
  const bytes = parseMintAuthoritySecret(secret);
  if (bytes.length === 64) return Keypair.fromSecretKey(bytes);
  if (bytes.length === 32) return Keypair.fromSeed(bytes);
  throw new SkinNftServiceError('SKIN_NFT_MINT_AUTHORITY_SECRET_KEY must contain 32 or 64 bytes', 503);
}

function getMintAuthorityKeypair(config = getSkinNftConfig()): Keypair {
  const keypair = keypairFromSecret(readMintAuthoritySecret());
  const actualPublicKey = keypair.publicKey.toBase58();
  if (config.mintAuthorityPublicKey && config.mintAuthorityPublicKey !== actualPublicKey) {
    throw new SkinNftServiceError('SKIN_NFT_MINT_AUTHORITY_PUBLIC_KEY does not match the configured secret key', 503);
  }
  return keypair;
}

function getMintAuthorityDiagnostics(config: SkinNftConfig): Pick<
  SkinNftReadiness,
  'mintAuthorityPublicKey' | 'mintAuthoritySecretConfigured' | 'mintAuthorityMatchesPublicKey' | 'mintAuthorityError'
> {
  if (!config.mintAuthoritySecretConfigured) {
    return {
      mintAuthorityPublicKey: config.mintAuthorityPublicKey,
      mintAuthoritySecretConfigured: false,
      mintAuthorityMatchesPublicKey: null,
      mintAuthorityError: null,
    };
  }

  try {
    const keypair = getMintAuthorityKeypair(config);
    const actualPublicKey = keypair.publicKey.toBase58();
    return {
      mintAuthorityPublicKey: config.mintAuthorityPublicKey ?? actualPublicKey,
      mintAuthoritySecretConfigured: true,
      mintAuthorityMatchesPublicKey: config.mintAuthorityPublicKey ? config.mintAuthorityPublicKey === actualPublicKey : true,
      mintAuthorityError: null,
    };
  } catch (error) {
    return {
      mintAuthorityPublicKey: config.mintAuthorityPublicKey,
      mintAuthoritySecretConfigured: true,
      mintAuthorityMatchesPublicKey: false,
      mintAuthorityError: error instanceof Error ? error.message : String(error),
    };
  }
}

export function getSkinNftReadiness(config = getSkinNftConfig()): SkinNftReadiness {
  const authority = getMintAuthorityDiagnostics(config);
  const collectionConfigured = Boolean(config.collectionAddress);
  const metadataConfigured = Boolean(config.metadataBaseUri || config.metadataUriTemplate);
  const dasRpcConfigured = Boolean(config.dasRpcUrl || config.rpcUrl);
  const rpcConfigured = Boolean(config.rpcUrl);
  const readyToSync = config.enabled && collectionConfigured && dasRpcConfigured;
  const readyToMint = (
    config.enabled &&
    collectionConfigured &&
    metadataConfigured &&
    rpcConfigured &&
    authority.mintAuthoritySecretConfigured &&
    authority.mintAuthorityMatchesPublicKey !== false
  );

  return {
    enabled: config.enabled,
    collectionAddress: config.collectionAddress,
    collectionConfigured,
    ...authority,
    metadataBaseUri: config.metadataBaseUri,
    metadataUriTemplate: config.metadataUriTemplate,
    metadataConfigured,
    dasRpcConfigured,
    rpcConfigured,
    readyToSync,
    readyToMint,
    founderMintEnabled: config.founderMintEnabled,
    cluster: config.cluster,
    edition: config.edition,
  };
}

export function skinNftModeEnabled(config = getSkinNftConfig()): boolean {
  return config.enabled && Boolean(config.collectionAddress);
}

export function assertSkinNftMintReady(
  config = getSkinNftConfig(),
  options: { metadataConfigured?: boolean } = {}
): void {
  const readiness = getSkinNftReadiness(config);
  if (!readiness.enabled) throw new SkinNftServiceError('Skin NFT mode is disabled', 503);
  if (!readiness.collectionConfigured) throw new SkinNftServiceError('SKIN_NFT_COLLECTION_ADDRESS is not configured', 503);
  if (!readiness.metadataConfigured && !options.metadataConfigured) {
    throw new SkinNftServiceError('Skin NFT metadata URI configuration is missing', 503);
  }
  if (!readiness.rpcConfigured) throw new SkinNftServiceError('SOLANA_RPC_URL is not configured', 503);
  if (!readiness.mintAuthoritySecretConfigured) {
    throw new SkinNftServiceError('SKIN_NFT_MINT_AUTHORITY_SECRET_KEY is not configured', 503);
  }
  if (readiness.mintAuthorityMatchesPublicKey === false) {
    throw new SkinNftServiceError(readiness.mintAuthorityError ?? 'Skin NFT mint authority is invalid', 503);
  }
}

function encodeTemplateValue(value: string): string {
  return encodeURIComponent(value).replace(/\./g, '.');
}

export function resolveSkinNftMetadataUri(input: {
  skin: HeroSkinDefinition;
  overrideUri?: string | null;
  config?: SkinNftConfig;
}): string {
  const config = input.config ?? getSkinNftConfig();
  const override = input.overrideUri?.trim();
  if (override) return override;

  const replacements: Record<string, string> = {
    skinId: input.skin.id,
    heroId: input.skin.heroId,
    rarity: input.skin.rarity,
    edition: config.edition,
  };

  if (config.metadataUriTemplate) {
    return Object.entries(replacements).reduce((uri, [key, value]) => (
      uri.replaceAll(`{${key}}`, encodeTemplateValue(value))
    ), config.metadataUriTemplate);
  }

  if (!config.metadataBaseUri) {
    throw new SkinNftServiceError('Skin NFT metadata URI configuration is missing', 503);
  }

  return `${config.metadataBaseUri.replace(/\/+$/, '')}/${encodeTemplateValue(input.skin.id)}.json`;
}

function buildSkinNftAttributes(input: {
  skin: HeroSkinDefinition;
  serial: string;
  source: string;
  config: SkinNftConfig;
}) {
  return [
    { key: 'skinId', value: input.skin.id },
    { key: 'heroId', value: input.skin.heroId },
    { key: 'rarity', value: input.skin.rarity },
    { key: 'season', value: readEnv('SKIN_NFT_SEASON') || 'launch' },
    { key: 'edition', value: input.config.edition },
    { key: 'serial', value: input.serial },
    { key: 'source', value: input.source },
  ];
}

export function buildPurchaseSkinNftSerial(intentId: string): string {
  return intentId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12).toUpperCase() || '000000';
}

function createSeededAssetSigner(
  umi: ReturnType<typeof createUmi>,
  seed: string
): ReturnType<typeof generateSigner> {
  const digest = createHash('sha256').update(`opus-strike-skin-nft:${seed}`).digest();
  return createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSeed(digest));
}

function assertNftEligibleSkin(skin: HeroSkinDefinition, config = getSkinNftConfig()): void {
  if (skin.availability === 'free') {
    throw new SkinNftServiceError('Default skins do not need NFTs');
  }
  if (skin.availability === 'unlockable' && !config.founderMintEnabled) {
    throw new SkinNftServiceError('Founder skin NFT minting is not enabled');
  }
  if (skin.releaseState === 'disabled') {
    throw new SkinNftServiceError('Disabled skins cannot be minted');
  }
}

export async function mintSkinNft(input: MintSkinNftInput): Promise<MintSkinNftResult> {
  const config = getSkinNftConfig();
  assertSkinNftMintReady(config, { metadataConfigured: Boolean(input.metadataUri) });
  assertNftEligibleSkin(input.skin, config);
  if (!config.collectionAddress || !config.rpcUrl) {
    throw new SkinNftServiceError('Skin NFT mint configuration is incomplete', 503);
  }

  const owner = cleanPublicKey(input.ownerAddress);
  if (!owner) throw new SkinNftServiceError('Owner wallet must be a valid Solana public key');

  const authority = getMintAuthorityKeypair(config);
  const umi = createUmi(config.rpcUrl).use(keypairIdentity(fromWeb3JsKeypair(authority)));
  const asset = input.assetSeed ? createSeededAssetSigner(umi, input.assetSeed) : generateSigner(umi);
  const collection = await fetchCollection(umi, config.collectionAddress);
  const attributes = buildSkinNftAttributes({
    skin: input.skin,
    serial: input.serial,
    source: input.source,
    config,
  });
  const name = `${input.skin.displayName} #${input.serial}`;

  const mint = await create(umi, {
    asset,
    collection,
    owner: publicKey(owner),
    name,
    uri: input.metadataUri,
    plugins: [
      {
        type: 'Attributes',
        attributeList: attributes,
      },
      { type: 'ImmutableMetadata' },
    ],
  }).sendAndConfirm(umi, {
    confirm: { commitment: 'confirmed' },
  });

  return {
    assetAddress: asset.publicKey.toString(),
    collectionAddress: config.collectionAddress,
    metadataUri: input.metadataUri,
    mintSignature: bs58.encode(mint.signature),
    serial: input.serial,
    edition: config.edition,
  };
}

type ProjectionClient = Pick<typeof prisma, 'skinNftAsset' | 'userSkinOwnership'>;

async function upsertNftEntitlement(
  client: ProjectionClient,
  input: {
    userId: string;
    skinId: HeroSkinId;
    purchaseId?: string | null;
    grantedAt: Date;
  }
): Promise<void> {
  const existing = await client.userSkinOwnership.findUnique({
    where: { userId_skinId: { userId: input.userId, skinId: input.skinId } },
    select: { source: true },
  });
  if (existing?.source === 'admin_grant' || existing?.source === 'event') return;

  await client.userSkinOwnership.upsert({
    where: { userId_skinId: { userId: input.userId, skinId: input.skinId } },
    create: {
      userId: input.userId,
      skinId: input.skinId,
      source: 'nft',
      purchaseId: input.purchaseId ?? undefined,
      grantedAt: input.grantedAt,
    },
    update: {
      source: 'nft',
      ...(input.purchaseId ? { purchaseId: input.purchaseId } : {}),
      revokedAt: null,
    },
  });
}

export async function upsertMintedSkinNftProjection(
  client: ProjectionClient,
  input: MintedSkinNftProjectionInput
): Promise<void> {
  const syncedAt = input.syncedAt ?? new Date();
  await client.skinNftAsset.upsert({
    where: { assetAddress: input.assetAddress },
    create: {
      assetAddress: input.assetAddress,
      collectionAddress: input.collectionAddress,
      ownerWalletAddress: input.ownerWalletAddress,
      ownerUserId: input.userId,
      skinId: input.skin.id,
      heroId: input.skin.heroId,
      rarity: input.skin.rarity,
      metadataUri: input.metadataUri || null,
      name: `${input.skin.displayName} #${input.serial}`,
      edition: input.edition,
      serial: input.serial,
      source: input.source,
      sourcePurchaseId: input.sourcePurchaseId ?? undefined,
      mintSignature: input.mintSignature || undefined,
      firstSeenAt: syncedAt,
      lastSyncedAt: syncedAt,
      revokedAt: null,
    },
    update: {
      collectionAddress: input.collectionAddress,
      ownerWalletAddress: input.ownerWalletAddress,
      ownerUserId: input.userId,
      skinId: input.skin.id,
      heroId: input.skin.heroId,
      rarity: input.skin.rarity,
      metadataUri: input.metadataUri || null,
      name: `${input.skin.displayName} #${input.serial}`,
      edition: input.edition,
      serial: input.serial,
      source: input.source,
      sourcePurchaseId: input.sourcePurchaseId ?? undefined,
      ...(input.mintSignature ? { mintSignature: input.mintSignature } : {}),
      lastSyncedAt: syncedAt,
      revokedAt: null,
    },
  });

  await upsertNftEntitlement(client, {
    userId: input.userId,
    skinId: input.skin.id,
    purchaseId: input.sourcePurchaseId,
    grantedAt: syncedAt,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNestedString(source: unknown, path: string[]): string | null {
  let current = source;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return readString(current);
}

function getAssetId(asset: unknown): string | null {
  return (
    readNestedString(asset, ['id']) ??
    readNestedString(asset, ['publicKey']) ??
    readNestedString(asset, ['address']) ??
    readNestedString(asset, ['assetAddress'])
  );
}

function getAssetOwner(asset: unknown): string | null {
  return (
    readNestedString(asset, ['ownership', 'owner']) ??
    readNestedString(asset, ['owner']) ??
    readNestedString(asset, ['ownerAddress'])
  );
}

function getAssetName(asset: unknown): string | null {
  return (
    readNestedString(asset, ['content', 'metadata', 'name']) ??
    readNestedString(asset, ['metadata', 'name']) ??
    readNestedString(asset, ['name'])
  );
}

function getAssetUri(asset: unknown): string | null {
  return (
    readNestedString(asset, ['content', 'json_uri']) ??
    readNestedString(asset, ['content', 'jsonUri']) ??
    readNestedString(asset, ['uri']) ??
    readNestedString(asset, ['metadataUri'])
  );
}

function pushAttributePairs(target: Map<string, string>, attributes: unknown): void {
  if (!Array.isArray(attributes)) return;
  for (const item of attributes) {
    if (!isRecord(item)) continue;
    const key = readString(item.key) ?? readString(item.trait_type) ?? readString(item.traitType);
    const value = readString(item.value);
    if (key && value) target.set(key, value);
  }
}

function extractAssetAttributes(asset: unknown): Map<string, string> {
  const attributes = new Map<string, string>();
  pushAttributePairs(attributes, readNestedUnknown(asset, ['content', 'metadata', 'attributes']));
  pushAttributePairs(attributes, readNestedUnknown(asset, ['metadata', 'attributes']));
  pushAttributePairs(attributes, readNestedUnknown(asset, ['attributes', 'attributeList']));
  pushAttributePairs(attributes, readNestedUnknown(asset, ['plugins', 'attributes', 'attributeList']));
  pushAttributePairs(attributes, readNestedUnknown(asset, ['attributeList']));

  const plugins = readNestedUnknown(asset, ['plugins']);
  if (Array.isArray(plugins)) {
    for (const plugin of plugins) {
      if (!isRecord(plugin)) continue;
      const type = readString(plugin.type) ?? readString(plugin.__kind);
      if (type === 'Attributes') {
        pushAttributePairs(attributes, plugin.attributeList);
        pushAttributePairs(attributes, readNestedUnknown(plugin, ['fields', '0', 'attributeList']));
      }
    }
  }

  return attributes;
}

function readNestedUnknown(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function hasVerifiedCollection(asset: unknown, collectionAddress: string): boolean {
  const grouping = readNestedUnknown(asset, ['grouping']) ?? readNestedUnknown(asset, ['groupings']);
  if (Array.isArray(grouping)) {
    for (const group of grouping) {
      if (!isRecord(group)) continue;
      const key = readString(group.group_key) ?? readString(group.groupKey) ?? readString(group.key);
      const value = readString(group.group_value) ?? readString(group.groupValue) ?? readString(group.value);
      if (key === 'collection' && value === collectionAddress) return true;
    }
  }

  const collection = readNestedUnknown(asset, ['collection']);
  if (isRecord(collection)) {
    const address = readString(collection.address) ?? readString(collection.key) ?? readString(collection.id);
    const verified = collection.verified;
    if (address === collectionAddress && verified !== false) return true;
  }

  const updateAuthorityType = readNestedString(asset, ['updateAuthority', 'type']);
  const updateAuthorityAddress = readNestedString(asset, ['updateAuthority', 'address']);
  if (updateAuthorityType === 'Collection' && updateAuthorityAddress === collectionAddress) return true;

  return false;
}

interface ParsedSkinNftAsset {
  assetAddress: string;
  ownerWalletAddress: string;
  collectionAddress: string;
  skinId: HeroSkinId;
  heroId: string | null;
  rarity: string | null;
  metadataUri: string | null;
  name: string | null;
  edition: string | null;
  serial: string | null;
  source: string | null;
}

export function parseVerifiedSkinNftAsset(asset: unknown, config = getSkinNftConfig()): ParsedSkinNftAsset | null {
  if (!config.collectionAddress || !hasVerifiedCollection(asset, config.collectionAddress)) return null;
  const assetAddress = cleanPublicKey(getAssetId(asset) ?? '');
  const ownerWalletAddress = cleanPublicKey(getAssetOwner(asset) ?? '');
  if (!assetAddress || !ownerWalletAddress) return null;

  const attributes = extractAssetAttributes(asset);
  const rawSkinId = attributes.get('skinId');
  if (!isHeroSkinId(rawSkinId)) return null;
  const skin = getHeroSkinDefinition(rawSkinId);
  if (skin.releaseState === 'disabled') return null;
  if (skin.availability === 'free') return null;
  if (skin.availability === 'unlockable' && !config.founderMintEnabled) return null;

  return {
    assetAddress,
    ownerWalletAddress,
    collectionAddress: config.collectionAddress,
    skinId: rawSkinId,
    heroId: attributes.get('heroId') ?? null,
    rarity: attributes.get('rarity') ?? null,
    metadataUri: getAssetUri(asset),
    name: getAssetName(asset),
    edition: attributes.get('edition') ?? null,
    serial: attributes.get('serial') ?? null,
    source: attributes.get('source') ?? null,
  };
}

async function fetchDasPage(input: {
  rpcUrl: string;
  ownerAddress: string;
  page: number;
  limit: number;
}): Promise<{ items: unknown[]; total: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_DAS_TIMEOUT_MS);
  try {
    const response = await fetch(input.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `skin-nft-sync-${input.ownerAddress}-${input.page}`,
        method: 'getAssetsByOwner',
        params: {
          ownerAddress: input.ownerAddress,
          page: input.page,
          limit: input.limit,
          options: {
            showCollectionMetadata: true,
            showUnverifiedCollections: false,
          },
        },
      }),
      signal: controller.signal,
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      throw new SkinNftServiceError(`DAS RPC failed with HTTP ${response.status}`, 502);
    }
    if (!isRecord(payload)) throw new SkinNftServiceError('DAS RPC returned an invalid response', 502);
    if (payload.error) {
      const message = readNestedString(payload.error, ['message']) ?? 'DAS RPC returned an error';
      throw new SkinNftServiceError(message, 502);
    }
    const result = payload.result;
    if (!isRecord(result)) throw new SkinNftServiceError('DAS RPC response is missing result', 502);
    const items = Array.isArray(result.items) ? result.items : [];
    const total = readNumber(result.total) ?? readNumber(result.grand_total) ?? null;
    return { items, total };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchDasAssetsByOwner(input: {
  ownerAddress: string;
  config?: SkinNftConfig;
}): Promise<unknown[]> {
  const config = input.config ?? getSkinNftConfig();
  const rpcUrl = config.dasRpcUrl ?? config.rpcUrl;
  if (!rpcUrl) throw new SkinNftServiceError('SKIN_NFT_DAS_RPC_URL or SOLANA_RPC_URL is not configured', 503);

  const assets: unknown[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await fetchDasPage({
      rpcUrl,
      ownerAddress: input.ownerAddress,
      page,
      limit: DEFAULT_DAS_LIMIT,
    });
    assets.push(...result.items);
    if (result.items.length < DEFAULT_DAS_LIMIT) break;
    if (result.total !== null && page * DEFAULT_DAS_LIMIT >= result.total) break;
  }
  return assets;
}

async function updateWalletSyncRow(input: {
  userId: string;
  walletAddress: string;
  collectionAddress: string;
  assetCount: number;
  activeEntitlementCount: number;
  syncedAt: Date;
  lastError: string | null;
}): Promise<void> {
  await prisma.skinNftWalletSync.upsert({
    where: {
      userId_walletAddress_collectionAddress: {
        userId: input.userId,
        walletAddress: input.walletAddress,
        collectionAddress: input.collectionAddress,
      },
    },
    create: {
      userId: input.userId,
      walletAddress: input.walletAddress,
      collectionAddress: input.collectionAddress,
      assetCount: input.assetCount,
      activeEntitlementCount: input.activeEntitlementCount,
      lastSyncedAt: input.syncedAt,
      lastError: input.lastError,
    },
    update: {
      assetCount: input.assetCount,
      activeEntitlementCount: input.activeEntitlementCount,
      lastSyncedAt: input.syncedAt,
      lastError: input.lastError,
    },
  });
}

async function revokeMissingNftEntitlements(input: {
  userId: string;
  activeSkinIds: Set<HeroSkinId>;
  revokedAt: Date;
}): Promise<void> {
  await prisma.userSkinOwnership.updateMany({
    where: {
      userId: input.userId,
      source: 'nft',
      revokedAt: null,
      ...(input.activeSkinIds.size > 0 ? { skinId: { notIn: [...input.activeSkinIds] } } : {}),
    },
    data: { revokedAt: input.revokedAt },
  });
}

async function repairRevokedNftLoadouts(input: {
  userId: string;
  activeOwnedSkinIds: Set<HeroSkinId>;
}): Promise<void> {
  const loadouts = await prisma.userHeroLoadout.findMany({ where: { userId: input.userId } });
  for (const loadout of loadouts) {
    if (!isHeroSkinId(loadout.selectedSkinId)) continue;
    if (input.activeOwnedSkinIds.has(loadout.selectedSkinId)) continue;
    const skin = getHeroSkinDefinition(loadout.selectedSkinId);
    const defaultSkinId = DEFAULT_HERO_SKIN_IDS[skin.heroId];
    if (loadout.selectedSkinId === defaultSkinId) continue;
    await prisma.userHeroLoadout.update({
      where: { userId_heroId: { userId: input.userId, heroId: loadout.heroId } },
      data: { selectedSkinId: defaultSkinId },
    });
    loggers.nft.warn('Reset loadout after NFT entitlement disappeared', {
      userId: input.userId,
      heroId: loadout.heroId,
      missingSkinId: loadout.selectedSkinId,
      fallbackSkinId: defaultSkinId,
    });
  }
}

export async function syncWalletNftOwnership(input: {
  userId: string;
  walletAddress: string | null | undefined;
  force?: boolean;
}): Promise<SkinNftWalletSyncSummary> {
  const config = getSkinNftConfig();
  const readiness = getSkinNftReadiness(config);
  if (!skinNftModeEnabled(config) || !config.collectionAddress) {
    return {
      enabled: false,
      collectionAddress: config.collectionAddress,
      walletAddress: input.walletAddress ?? null,
      assetCount: 0,
      activeEntitlementCount: 0,
      synced: false,
      cached: false,
      lastSyncedAt: null,
      lastError: null,
    };
  }
  if (!readiness.readyToSync) {
    return {
      enabled: true,
      collectionAddress: config.collectionAddress,
      walletAddress: input.walletAddress ?? null,
      assetCount: 0,
      activeEntitlementCount: 0,
      synced: false,
      cached: false,
      lastSyncedAt: null,
      lastError: 'Skin NFT DAS RPC is not configured',
    };
  }

  const walletAddress = cleanPublicKey(input.walletAddress ?? '');
  if (!walletAddress) throw new SkinNftServiceError('A linked Solana wallet is required for NFT skin sync', 400);

  const previous = await prisma.skinNftWalletSync.findUnique({
    where: {
      userId_walletAddress_collectionAddress: {
        userId: input.userId,
        walletAddress,
        collectionAddress: config.collectionAddress,
      },
    },
  });
  if (
    previous &&
    !input.force &&
    !previous.lastError &&
    Date.now() - previous.lastSyncedAt.getTime() < config.syncCacheMs
  ) {
    return {
      enabled: true,
      collectionAddress: config.collectionAddress,
      walletAddress,
      assetCount: previous.assetCount,
      activeEntitlementCount: previous.activeEntitlementCount,
      synced: true,
      cached: true,
      lastSyncedAt: previous.lastSyncedAt.toISOString(),
      lastError: null,
    };
  }

  const syncedAt = new Date();
  try {
    const rawAssets = await fetchDasAssetsByOwner({ ownerAddress: walletAddress, config });
    const parsedAssets = rawAssets
      .map((asset) => parseVerifiedSkinNftAsset(asset, config))
      .filter((asset): asset is ParsedSkinNftAsset => asset !== null && asset.ownerWalletAddress === walletAddress);
    const activeAssetAddresses = new Set(parsedAssets.map((asset) => asset.assetAddress));
    const activeSkinIds = new Set(parsedAssets.map((asset) => asset.skinId));

    await prisma.$transaction(async (tx) => {
      for (const asset of parsedAssets) {
        const skin = getHeroSkinDefinition(asset.skinId);
        await upsertMintedSkinNftProjection(tx, {
          assetAddress: asset.assetAddress,
          collectionAddress: asset.collectionAddress,
          ownerWalletAddress: walletAddress,
          userId: input.userId,
          skin,
          metadataUri: asset.metadataUri ?? '',
          edition: asset.edition ?? config.edition,
          serial: asset.serial ?? asset.assetAddress.slice(0, 8),
          source: asset.source ?? 'wallet_sync',
          sourcePurchaseId: null,
          mintSignature: null,
          syncedAt,
        });
      }

      await tx.skinNftAsset.updateMany({
        where: {
          ownerUserId: input.userId,
          ownerWalletAddress: walletAddress,
          collectionAddress: config.collectionAddress!,
          revokedAt: null,
          ...(activeAssetAddresses.size > 0 ? { assetAddress: { notIn: [...activeAssetAddresses] } } : {}),
        },
        data: {
          revokedAt: syncedAt,
          lastSyncedAt: syncedAt,
        },
      });
    });

    await revokeMissingNftEntitlements({
      userId: input.userId,
      activeSkinIds,
      revokedAt: syncedAt,
    });

    const activeOwnerships = await prisma.userSkinOwnership.findMany({
      where: { userId: input.userId, revokedAt: null },
      select: { skinId: true },
    });
    const activeOwnedSkinIds = new Set<HeroSkinId>(Object.values(DEFAULT_HERO_SKIN_IDS));
    for (const ownership of activeOwnerships) {
      if (isHeroSkinId(ownership.skinId)) activeOwnedSkinIds.add(ownership.skinId);
    }
    await repairRevokedNftLoadouts({ userId: input.userId, activeOwnedSkinIds });

    await updateWalletSyncRow({
      userId: input.userId,
      walletAddress,
      collectionAddress: config.collectionAddress,
      assetCount: parsedAssets.length,
      activeEntitlementCount: activeSkinIds.size,
      syncedAt,
      lastError: null,
    });

    return {
      enabled: true,
      collectionAddress: config.collectionAddress,
      walletAddress,
      assetCount: parsedAssets.length,
      activeEntitlementCount: activeSkinIds.size,
      synced: true,
      cached: false,
      lastSyncedAt: syncedAt.toISOString(),
      lastError: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateWalletSyncRow({
      userId: input.userId,
      walletAddress,
      collectionAddress: config.collectionAddress,
      assetCount: previous?.assetCount ?? 0,
      activeEntitlementCount: previous?.activeEntitlementCount ?? 0,
      syncedAt,
      lastError: message,
    });
    loggers.nft.warn('Skin NFT wallet sync failed', {
      userId: input.userId,
      walletAddress,
      collectionAddress: config.collectionAddress,
      error: message,
    });
    throw error;
  }
}

export async function syncUserSkinNftOwnership(input: {
  userId: string;
  force?: boolean;
}): Promise<SkinNftWalletSyncSummary> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { walletAddress: true },
  });
  return syncWalletNftOwnership({
    userId: input.userId,
    walletAddress: user?.walletAddress,
    force: input.force,
  });
}

export async function loadSkinNftOwnershipState(input: {
  userId: string | null | undefined;
  walletAddress: string | null | undefined;
}): Promise<SkinNftOwnershipState> {
  const config = getSkinNftConfig();
  const readiness = getSkinNftReadiness(config);
  const state: SkinNftOwnershipState = {
    enabled: skinNftModeEnabled(config),
    collectionAddress: config.collectionAddress,
    readyToSync: readiness.readyToSync,
    sync: {
      lastSyncedAt: null,
      lastError: null,
    },
    assetCountsBySkin: new Map(),
  };
  const walletAddress = cleanPublicKey(input.walletAddress ?? '');
  if (!state.enabled || !config.collectionAddress || !input.userId || !walletAddress) return state;

  const [syncRow, assetRows] = await Promise.all([
    prisma.skinNftWalletSync.findUnique({
      where: {
        userId_walletAddress_collectionAddress: {
          userId: input.userId,
          walletAddress,
          collectionAddress: config.collectionAddress,
        },
      },
    }),
    prisma.skinNftAsset.groupBy({
      by: ['skinId'],
      where: {
        ownerUserId: input.userId,
        ownerWalletAddress: walletAddress,
        collectionAddress: config.collectionAddress,
        revokedAt: null,
      },
      _count: { _all: true },
    }),
  ]);

  state.sync = {
    lastSyncedAt: syncRow?.lastSyncedAt.toISOString() ?? null,
    lastError: syncRow?.lastError ?? null,
  };
  for (const row of assetRows) {
    if (isHeroSkinId(row.skinId)) state.assetCountsBySkin.set(row.skinId, row._count._all);
  }
  return state;
}

export function canRetrySkinNftMint(intent: {
  nftMintStatus: string;
  mintedAssetAddress: string | null;
  nftMintAttemptedAt: Date | null;
}): boolean {
  if (intent.mintedAssetAddress) return false;
  if (intent.nftMintStatus === 'pending' || intent.nftMintStatus === 'failed') return true;
  if (intent.nftMintStatus !== 'minting' || !intent.nftMintAttemptedAt) return false;
  return Date.now() - intent.nftMintAttemptedAt.getTime() > STALE_MINTING_RETRY_MS;
}

export async function getSkinNftAdminOverview(): Promise<{
  readiness: SkinNftReadiness;
  failedMintQueue: FailedSkinNftMintQueueItem[];
  pendingMintCount: number;
  failedMintCount: number;
  assetCountBySkin: Array<{ skinId: HeroSkinId; count: number }>;
  latestWalletSyncs: Array<{
    userId: string;
    walletAddress: string;
    collectionAddress: string;
    assetCount: number;
    activeEntitlementCount: number;
    lastSyncedAt: string;
    lastError: string | null;
  }>;
}> {
  const config = getSkinNftConfig();
  const [failedMintQueue, pendingMintCount, failedMintCount, assetRows, latestWalletSyncs] = await Promise.all([
    prisma.skinPurchaseIntent.findMany({
      where: { nftMintStatus: 'failed' },
      orderBy: { updatedAt: 'desc' },
      take: 25,
      select: {
        id: true,
        skinId: true,
        walletAddress: true,
        status: true,
        nftMintStatus: true,
        mintedAssetAddress: true,
        nftCollectionAddress: true,
        nftMetadataUri: true,
        nftMintSignature: true,
        nftMintAttemptCount: true,
        nftMintAttemptedAt: true,
        nftMintError: true,
        updatedAt: true,
      },
    }),
    prisma.skinPurchaseIntent.count({ where: { nftMintStatus: { in: ['pending', 'minting'] } } }),
    prisma.skinPurchaseIntent.count({ where: { nftMintStatus: 'failed' } }),
    prisma.skinNftAsset.groupBy({
      by: ['skinId'],
      where: {
        ...(config.collectionAddress ? { collectionAddress: config.collectionAddress } : {}),
        revokedAt: null,
      },
      _count: { _all: true },
    }),
    prisma.skinNftWalletSync.findMany({
      orderBy: { lastSyncedAt: 'desc' },
      take: 20,
      select: {
        userId: true,
        walletAddress: true,
        collectionAddress: true,
        assetCount: true,
        activeEntitlementCount: true,
        lastSyncedAt: true,
        lastError: true,
      },
    }),
  ]);

  return {
    readiness: getSkinNftReadiness(config),
    failedMintQueue: failedMintQueue.map((intent) => ({
      intentId: intent.id,
      skinId: intent.skinId,
      walletAddress: intent.walletAddress,
      status: intent.status,
      nftMintStatus: intent.nftMintStatus,
      mintedAssetAddress: intent.mintedAssetAddress,
      nftCollectionAddress: intent.nftCollectionAddress,
      nftMetadataUri: intent.nftMetadataUri,
      nftMintSignature: intent.nftMintSignature,
      nftMintAttemptCount: intent.nftMintAttemptCount,
      nftMintAttemptedAt: intent.nftMintAttemptedAt?.toISOString() ?? null,
      nftMintError: intent.nftMintError,
      updatedAt: intent.updatedAt.toISOString(),
    })),
    pendingMintCount,
    failedMintCount,
    assetCountBySkin: assetRows
      .filter((row): row is typeof row & { skinId: HeroSkinId } => isHeroSkinId(row.skinId))
      .map((row) => ({ skinId: row.skinId, count: row._count._all })),
    latestWalletSyncs: latestWalletSyncs.map((sync) => ({
      ...sync,
      lastSyncedAt: sync.lastSyncedAt.toISOString(),
    })),
  };
}
