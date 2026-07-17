import type { HeroSkinId } from './skins.js';

export type MarketplaceListingStatus = 'active' | 'pending_sale' | 'sold' | 'canceled';

export type MarketplacePurchaseIntentStatus =
  | 'intent_created'
  | 'transaction_built'
  | 'submitted'
  | 'confirmed'
  | 'credited'
  | 'failed'
  | 'expired';

export interface MarketplaceListingSnapshot {
  listingId: string;
  skinId: HeroSkinId;
  // SOL price in lamports, serialized as a decimal string.
  priceLamports: string;
  status: MarketplaceListingStatus;
  sellerUserId: string;
  sellerName: string;
  isOwn: boolean;
  createdAt: string;
  soldAt: string | null;
}

export interface MarketplaceStateResponse {
  enabled: boolean;
  cluster: string;
  rpcConfigured: boolean;
  tokenSymbol: string;
  // Whole game tokens the seller must hold on-chain to list, e.g. "200000".
  listingHoldTokens: string;
  listingHoldTokenBaseUnits: string | null;
  tokenDecimals: number | null;
  // Current user's on-chain game-token balance; null when signed out or no
  // wallet is linked.
  holdBalanceTokenBaseUnits: string | null;
  canList: boolean;
  listDisabledReason: string | null;
}

export interface MarketplaceListingsResponse {
  listings: MarketplaceListingSnapshot[];
}

export interface MarketplacePurchaseIntentSnapshot {
  intentId: string;
  listingId: string;
  skinId: HeroSkinId;
  status: MarketplacePurchaseIntentStatus;
  buyerWalletAddress: string;
  sellerWalletAddress: string;
  priceLamports: string;
  memo: string;
  expiresAt: string;
  cluster: string;
  transactionSignature: string | null;
  creditedAt: string | null;
  lastError: string | null;
}

export interface MarketplacePurchaseTransactionSnapshot {
  intentId: string;
  transactionBase64: string;
  lastValidBlockHeight: number;
  cluster: string;
  priceLamports: string;
  sellerWalletAddress: string;
  memo: string;
}

export interface MarketplaceSettingsSnapshot {
  enabled: boolean;
  listingHoldTokens: string;
  updatedByUserId: string | null;
  updatedAt: string | null;
}
