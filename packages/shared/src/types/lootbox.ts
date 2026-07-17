import type { HeroSkinId, HeroSkinRarity } from './skins.js';

export type LootboxOpenIntentStatus =
  | 'intent_created'
  | 'transaction_built'
  | 'submitted'
  | 'confirmed'
  | 'credited'
  | 'failed'
  | 'expired';

// Raw admin-configured rarity weights. They are relative shares within the
// skin outcome; ownership never changes them.
export interface LootboxRarityWeights {
  common: number;
  epic: number;
  unique: number;
  legendary: number;
}

export interface LootboxRarityOdds {
  rarity: HeroSkinRarity;
  // Effective overall crate chance after the direct-token outcome, in bps.
  chanceBps: number;
  totalSkins: number;
  remainingForUser: number;
}

export interface LootboxDuplicateRewardSettings {
  // Whole-token conversion ranges keyed by lootbox-eligible skin. Live
  // settings contain every skin; legacy paid intents can contain no entries.
  skinTokenRanges: Partial<Record<HeroSkinId, LootboxTokenRange>>;
}

export interface LootboxTokenRange {
  minTokens: string;
  maxTokens: string;
}

export interface LootboxDirectTokenRewardSettings {
  // Independent chance that the crate awards raw game tokens instead of
  // entering the skin pool.
  chanceBps: number;
  range: LootboxTokenRange;
}

export type LootboxRewardKind = 'skin' | 'game_token';

export interface LootboxStateResponse {
  enabled: boolean;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  cluster: string;
  rpcConfigured: boolean;
  // Whole game tokens, e.g. "75000".
  priceTokens: string;
  priceTokenBaseUnits: string | null;
  tokenDecimals: number | null;
  weights: LootboxRarityWeights;
  directTokenReward: LootboxDirectTokenRewardSettings;
  // Derived from this player's ownership. Every skin retains its normal pull
  // rate; selecting an owned skin converts it into game tokens.
  duplicateChanceBps: number;
  duplicateReward: LootboxDuplicateRewardSettings;
  odds: LootboxRarityOdds[];
  poolSize: number;
  remainingForUser: number;
  openDisabledReason: string | null;
  // Admin-granted opens that skip the on-chain payment. A wallet is required
  // whenever a direct-token or duplicate-token outcome can occur.
  freeOpensAvailable: number;
  freeOpenDisabledReason: string | null;
}

export interface LootboxOpenIntentSnapshot {
  intentId: string;
  status: LootboxOpenIntentStatus;
  walletAddress: string;
  tokenMintAddress: string;
  tokenSymbol: string;
  tokenAmountBaseUnits: string;
  priceTokens: string;
  // Immutable server-side rarity weights quoted when this intent was created.
  quotedWeights: LootboxRarityWeights;
  // Immutable direct-token chance and range quoted with the intent.
  quotedDirectTokenReward: LootboxDirectTokenRewardSettings;
  // Immutable per-skin conversion ranges quoted with the intent.
  quotedDuplicateReward: LootboxDuplicateRewardSettings;
  treasuryTokenAccount: string;
  memo: string;
  expiresAt: string;
  cluster: string;
  transactionSignature: string | null;
  resultSkinId: HeroSkinId | null;
  resultRarity: HeroSkinRarity | null;
  resultKind: LootboxRewardKind | null;
  // Whole game tokens. Present only when resultKind is game_token.
  resultTokenAmount: string | null;
  tokenPayoutId: string | null;
  creditedAt: string | null;
  lastError: string | null;
}

export interface LootboxOpenTransactionSnapshot {
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

export interface LootboxSettingsSnapshot {
  enabled: boolean;
  priceTokens: string;
  weights: LootboxRarityWeights;
  directTokenReward: LootboxDirectTokenRewardSettings;
  duplicateReward: LootboxDuplicateRewardSettings;
  updatedByUserId: string | null;
  updatedAt: string | null;
}
