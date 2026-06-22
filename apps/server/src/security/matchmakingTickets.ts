import crypto from 'crypto';
import { PublicKey } from '@solana/web3.js';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  normalizeRankDivisionIndex,
} from '../matchmaking/skill';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  isGameplayMode,
  isMatchMode,
  isMatchPerspective,
  isKnownHeroId,
  type GameplayMode,
  type HeroId,
  type MatchMode,
  type MatchPerspective,
} from '@voxel-strike/shared';
import { createSignedTicket, readSignedTicketClaims } from './signedTicket';
import {
  isMatchmakingBotFillMode,
  normalizeMatchmakingBotFillMode,
  type MatchmakingBotFillMode,
} from '../matchmaking/matchSettings';

export interface MatchmakingTicketClaims {
  version: 2;
  mode: MatchMode;
  gameplayMode: GameplayMode;
  botFillMode: MatchmakingBotFillMode;
  matchPerspective: MatchPerspective;
  selectedHero?: HeroId;
  userId: string;
  competitiveRating: number;
  rankDivisionIndex: number;
  targetRankDivisionIndex: number;
  placementRemaining: number;
  rankedEntryQuoteId?: string;
  coverChargeLamports?: string;
  rankedEntryQuoteExpiresAt?: number;
  rankedTokenAddress?: string;
  rankedTokenDecimals?: number;
  rankedTokenHoldUsdCents?: number;
  rankedTokenRequiredBaseUnits?: string;
  rankedTokenBalanceBaseUnits?: string;
  rankedTokenCheckedAt?: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface CreateMatchmakingTicketInput {
  mode: MatchMode;
  gameplayMode?: GameplayMode;
  botFillMode?: MatchmakingBotFillMode;
  matchPerspective?: MatchPerspective;
  selectedHero?: HeroId;
  userId: string;
  competitiveRating: number;
  rankDivisionIndex: number;
  targetRankDivisionIndex: number;
  placementRemaining: number;
  rankedEntryQuoteId?: string;
  coverChargeLamports?: string;
  rankedEntryQuoteExpiresAt?: number;
  rankedTokenAddress?: string;
  rankedTokenDecimals?: number;
  rankedTokenHoldUsdCents?: number;
  rankedTokenRequiredBaseUnits?: string;
  rankedTokenBalanceBaseUnits?: string;
  rankedTokenCheckedAt?: number;
  ttlMs?: number;
}

const DEFAULT_TICKET_TTL_MS = 60_000;

function isCanonicalSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

export function createMatchmakingTicket(input: CreateMatchmakingTicketInput): {
  ticket: string;
  claims: MatchmakingTicketClaims;
} {
  const now = Date.now();
  const claims: MatchmakingTicketClaims = {
    version: 2,
    mode: input.mode,
    gameplayMode: input.mode === 'quick_play' && isGameplayMode(input.gameplayMode)
      ? input.gameplayMode
      : DEFAULT_GAMEPLAY_MODE,
    botFillMode: input.mode === 'quick_play'
      ? normalizeMatchmakingBotFillMode(input.botFillMode)
      : 'manual',
    matchPerspective: input.mode === 'quick_play' && isMatchPerspective(input.matchPerspective)
      ? input.matchPerspective
      : DEFAULT_MATCH_PERSPECTIVE,
    selectedHero: isKnownHeroId(input.selectedHero) ? input.selectedHero : undefined,
    userId: input.userId,
    competitiveRating: Math.round(Number.isFinite(input.competitiveRating) ? input.competitiveRating : DEFAULT_MATCHMAKING_RATING),
    rankDivisionIndex: normalizeRankDivisionIndex(input.rankDivisionIndex),
    targetRankDivisionIndex: normalizeRankDivisionIndex(input.targetRankDivisionIndex),
    placementRemaining: Math.max(0, Math.floor(Number.isFinite(input.placementRemaining) ? input.placementRemaining : 0)),
    rankedEntryQuoteId: input.mode === 'ranked' ? input.rankedEntryQuoteId : undefined,
    coverChargeLamports: input.mode === 'ranked' ? input.coverChargeLamports : undefined,
    rankedEntryQuoteExpiresAt: input.mode === 'ranked' ? input.rankedEntryQuoteExpiresAt : undefined,
    rankedTokenAddress: input.mode === 'ranked' ? input.rankedTokenAddress : undefined,
    rankedTokenDecimals: input.mode === 'ranked' ? input.rankedTokenDecimals : undefined,
    rankedTokenHoldUsdCents: input.mode === 'ranked' ? input.rankedTokenHoldUsdCents : undefined,
    rankedTokenRequiredBaseUnits: input.mode === 'ranked' ? input.rankedTokenRequiredBaseUnits : undefined,
    rankedTokenBalanceBaseUnits: input.mode === 'ranked' ? input.rankedTokenBalanceBaseUnits : undefined,
    rankedTokenCheckedAt: input.mode === 'ranked' ? input.rankedTokenCheckedAt : undefined,
    issuedAt: now,
    expiresAt: now + (input.ttlMs ?? DEFAULT_TICKET_TTL_MS),
    nonce: crypto.randomBytes(16).toString('hex'),
  };

  return {
    ticket: createSignedTicket(claims),
    claims,
  };
}

export function verifyMatchmakingTicket(ticket: unknown, now = Date.now()): MatchmakingTicketClaims | null {
  const claims = readSignedTicketClaims<MatchmakingTicketClaims>(ticket);
  if (!claims) return null;

  if (claims.version !== 2) return null;
  const mode = isMatchMode(claims.mode) ? claims.mode : 'quick_play';
  const gameplayMode = mode === 'quick_play' && isGameplayMode(claims.gameplayMode)
    ? claims.gameplayMode
    : DEFAULT_GAMEPLAY_MODE;
  const botFillMode = mode === 'quick_play' && isMatchmakingBotFillMode(claims.botFillMode)
    ? claims.botFillMode
    : 'manual';
  const matchPerspective = mode === 'quick_play' && isMatchPerspective(claims.matchPerspective)
    ? claims.matchPerspective
    : DEFAULT_MATCH_PERSPECTIVE;
  const selectedHero = isKnownHeroId(claims.selectedHero) ? claims.selectedHero : undefined;
  if (!claims.userId || !claims.nonce) return null;
  if (claims.expiresAt < now || claims.issuedAt > now + 5_000) return null;
  if (!Number.isFinite(claims.competitiveRating)) return null;
  if (normalizeRankDivisionIndex(claims.rankDivisionIndex) !== claims.rankDivisionIndex) return null;
  if (normalizeRankDivisionIndex(claims.targetRankDivisionIndex) !== claims.targetRankDivisionIndex) return null;

  if (
    claims.coverChargeLamports !== undefined
    && (typeof claims.coverChargeLamports !== 'string' || !/^[0-9]+$/.test(claims.coverChargeLamports))
  ) return null;
  if (claims.coverChargeLamports !== undefined && BigInt(claims.coverChargeLamports) <= 0n) return null;
  if (
    claims.rankedEntryQuoteExpiresAt !== undefined
    && !Number.isFinite(claims.rankedEntryQuoteExpiresAt)
  ) return null;
  if (
    claims.rankedTokenAddress !== undefined
    && !isCanonicalSolanaAddress(claims.rankedTokenAddress)
  ) return null;
  if (
    claims.rankedTokenDecimals !== undefined
    && (!Number.isInteger(claims.rankedTokenDecimals) || claims.rankedTokenDecimals < 0 || claims.rankedTokenDecimals > 255)
  ) return null;
  if (
    claims.rankedTokenHoldUsdCents !== undefined
    && (!Number.isInteger(claims.rankedTokenHoldUsdCents) || claims.rankedTokenHoldUsdCents < 0)
  ) return null;
  if (
    claims.rankedTokenRequiredBaseUnits !== undefined
    && (typeof claims.rankedTokenRequiredBaseUnits !== 'string' || !/^[0-9]+$/.test(claims.rankedTokenRequiredBaseUnits))
  ) return null;
  if (
    claims.rankedTokenBalanceBaseUnits !== undefined
    && (typeof claims.rankedTokenBalanceBaseUnits !== 'string' || !/^[0-9]+$/.test(claims.rankedTokenBalanceBaseUnits))
  ) return null;
  if (
    claims.rankedTokenCheckedAt !== undefined
    && !Number.isFinite(claims.rankedTokenCheckedAt)
  ) return null;

  return {
    ...claims,
    mode,
    gameplayMode,
    botFillMode,
    matchPerspective,
    selectedHero,
    competitiveRating: Math.round(claims.competitiveRating),
    rankDivisionIndex: claims.rankDivisionIndex ?? DEFAULT_RANK_DIVISION_INDEX,
    targetRankDivisionIndex: claims.targetRankDivisionIndex ?? DEFAULT_RANK_DIVISION_INDEX,
    placementRemaining: Math.max(0, Math.floor(claims.placementRemaining ?? 0)),
    rankedEntryQuoteId: mode === 'ranked' ? claims.rankedEntryQuoteId : undefined,
    coverChargeLamports: mode === 'ranked' ? claims.coverChargeLamports : undefined,
    rankedEntryQuoteExpiresAt: mode === 'ranked' ? claims.rankedEntryQuoteExpiresAt : undefined,
    rankedTokenAddress: mode === 'ranked' ? claims.rankedTokenAddress : undefined,
    rankedTokenDecimals: mode === 'ranked' ? claims.rankedTokenDecimals : undefined,
    rankedTokenHoldUsdCents: mode === 'ranked' ? claims.rankedTokenHoldUsdCents : undefined,
    rankedTokenRequiredBaseUnits: mode === 'ranked' ? claims.rankedTokenRequiredBaseUnits : undefined,
    rankedTokenBalanceBaseUnits: mode === 'ranked' ? claims.rankedTokenBalanceBaseUnits : undefined,
    rankedTokenCheckedAt: mode === 'ranked' ? claims.rankedTokenCheckedAt : undefined,
  };
}
