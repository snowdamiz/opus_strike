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
  | 'chronos.eternity-sovereign';

export type HeroSkinRarity = 'common' | 'epic' | 'unique' | 'legendary';
export type HeroSkinAvailability = 'free' | 'paid';
export type HeroSkinReleaseState = 'live' | 'ready_when_token_launches' | 'disabled';
export type HeroSkinEntitlement = 'free' | 'paid' | 'admin_grant' | 'event';

export interface HeroSkinPrice {
  tokenSymbol: string;
  tokenMintAddress: string | null;
  amountBaseUnits: string | null;
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
