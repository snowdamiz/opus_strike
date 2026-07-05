import type { HeroId } from './hero.js';

export type HeroSkinId =
  | 'phantom.default'
  | 'hookshot.default'
  | 'blaze.default'
  | 'chronos.default'
  | 'phantom.void-monarch'
  | 'phantom.nightglass-wraith'
  | 'phantom.astral-executioner'
  | 'phantom.eclipse-seraph'
  | 'hookshot.tidebreaker'
  | 'hookshot.iron-leviathan'
  | 'hookshot.abyssal-corsair'
  | 'hookshot.kraken-sovereign'
  | 'blaze.solar-forge'
  | 'blaze.ashen-vanguard'
  | 'blaze.inferno-archon'
  | 'blaze.starfall-phoenix'
  | 'chronos.epoch-regent'
  | 'chronos.paradox-sentinel'
  | 'chronos.meridian-oracle'
  | 'chronos.eternity-sovereign'
  | 'phantom.umbral-reaver'
  | 'phantom.obsidian-revenant'
  | 'hookshot.coral-warden'
  | 'hookshot.maelstrom-warlord'
  | 'blaze.cinder-warden'
  | 'blaze.pyre-tyrant'
  | 'chronos.clockwork-marshal'
  | 'chronos.quantum-arbiter'
  | 'phantom.liberty-wraith'
  | 'hookshot.liberty-anchor'
  | 'blaze.liberty-flare'
  | 'chronos.liberty-sentinel'
  | 'phantom.golden'
  | 'hookshot.golden'
  | 'blaze.golden'
  | 'chronos.golden';

export type HeroSkinRarity = 'common' | 'epic' | 'unique' | 'legendary';
// 'unlockable' skins are shown in the store but cannot be purchased — they are
// granted via achievements/events (e.g. the first-50-ranked founder reward).
export type HeroSkinAvailability = 'free' | 'paid' | 'unlockable';
export type HeroSkinReleaseState = 'live' | 'ready_when_token_launches' | 'disabled';
export type HeroSkinEntitlement = 'free' | 'paid' | 'admin_grant' | 'event';

export interface HeroSkinPrice {
  tokenSymbol: string;
  tokenMintAddress: string | null;
  amountBaseUnits: string | null;
  tokenDecimals?: number | null;
  adminEditable: boolean;
  disabledReason?: string | null;
}

export interface HeroSkinDefinition {
  id: HeroSkinId;
  heroId: HeroId;
  displayName: string;
  subtitle: string;
  rarity: HeroSkinRarity;
  availability: HeroSkinAvailability;
  releaseState: HeroSkinReleaseState;
  modelDocumentId: string;
  price?: HeroSkinPrice;
  // Short unlock condition shown in the store for non-purchasable skins
  // (e.g. "First 50 ranked players"). Surfaced to the client via HeroSkinCatalogItem.
  unlockHint?: string;
}

export interface HeroSkinOwnership {
  skinId: HeroSkinId;
  source: HeroSkinEntitlement;
  grantedAt: string;
  revokedAt?: string | null;
  purchaseId?: string | null;
}

export interface HeroLoadoutSelection {
  heroId: HeroId;
  skinId: HeroSkinId;
}

export interface HeroSkinCatalogPriceState extends HeroSkinPrice {
  saleEnabled: boolean;
  maxSupply: number | null;
  soldCount: number;
  reservedCount: number;
  remainingSupply: number | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: string | null;
}

export interface HeroSkinCatalogItem extends HeroSkinDefinition {
  owned: boolean;
  equipped: boolean;
  entitlementSource: HeroSkinEntitlement | null;
  shopPrice: HeroSkinCatalogPriceState | null;
  purchaseDisabledReason: string | null;
}

export interface HeroSkinCatalogResponse {
  shop: {
    enabled: boolean;
    tokenMintAddress: string | null;
    tokenSymbol: string;
    treasuryWallet: string | null;
    cluster: string;
    rpcConfigured: boolean;
  };
  skins: HeroSkinCatalogItem[];
  loadouts: HeroLoadoutSelection[];
}

export type SkinPurchaseIntentStatus =
  | 'intent_created'
  | 'transaction_built'
  | 'submitted'
  | 'confirmed'
  | 'credited'
  | 'failed'
  | 'expired';

export interface SkinPurchaseIntentSnapshot {
  intentId: string;
  skinId: HeroSkinId;
  status: SkinPurchaseIntentStatus;
  walletAddress: string;
  tokenMintAddress: string;
  tokenSymbol: string;
  tokenAmountBaseUnits: string;
  treasuryTokenAccount: string;
  memo: string;
  priceVersion: number;
  expiresAt: string;
  cluster: string;
  transactionSignature: string | null;
  creditedAt: string | null;
  lastError: string | null;
}

export interface SkinPurchaseTransactionSnapshot {
  intentId: string;
  transactionBase64: string;
  lastValidBlockHeight: number;
  cluster: string;
  tokenMintAddress: string;
  tokenSymbol: string;
  tokenAmountBaseUnits: string;
  treasuryTokenAccount: string;
  memo: string;
}
