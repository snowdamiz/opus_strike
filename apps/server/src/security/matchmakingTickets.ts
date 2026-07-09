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
  RANKED_GAMEPLAY_MODE,
  isGameplayMode,
  isHeroSkinId,
  isMatchMode,
  isMatchPerspective,
  isKnownHeroId,
  getHeroSkinDefinition,
  type GameplayMode,
  type HeroId,
  type HeroSkinId,
  type MatchMode,
  type MatchPerspective,
} from '@voxel-strike/shared';
import { createSignedTicket, readSignedTicketClaims } from './signedTicket';
import {
  isMatchmakingBotFillMode,
  normalizeMatchmakingBotFillMode,
  RANKED_BOT_FILL_MODE,
  type MatchmakingBotFillMode,
} from '../matchmaking/matchSettings';
import { normalizeMatchmakingRegion } from '../matchmaking/region';

export interface MatchmakingTicketClaims {
  version: 2;
  mode: MatchMode;
  gameplayMode: GameplayMode;
  botFillMode: MatchmakingBotFillMode;
  matchPerspective: MatchPerspective;
  selectedHero?: HeroId;
  selectedSkinId?: HeroSkinId;
  matchmakingRegion?: string;
  userId: string;
  competitiveRating: number;
  rankDivisionIndex: number;
  targetRankDivisionIndex: number;
  placementRemaining: number;
  rankedTokenAddress?: string;
  rankedTokenDecimals?: number;
  rankedTokenRequiredBaseUnits?: string;
  rankedTokenBalanceBaseUnits?: string;
  rankedTokenCheckedAt?: number;
  rankedRewardEligible?: boolean;
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
  selectedSkinId?: HeroSkinId;
  matchmakingRegion?: string;
  userId: string;
  competitiveRating: number;
  rankDivisionIndex: number;
  targetRankDivisionIndex: number;
  placementRemaining: number;
  rankedTokenAddress?: string;
  rankedTokenDecimals?: number;
  rankedTokenRequiredBaseUnits?: string;
  rankedTokenBalanceBaseUnits?: string;
  rankedTokenCheckedAt?: number;
  rankedRewardEligible?: boolean;
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

function normalizeSelectedSkinId(heroId: HeroId | undefined, skinId: unknown): HeroSkinId | undefined {
  if (!heroId || !isHeroSkinId(skinId)) return undefined;
  const skin = getHeroSkinDefinition(skinId);
  return skin.heroId === heroId ? skinId : undefined;
}

export function createMatchmakingTicket(input: CreateMatchmakingTicketInput): {
  ticket: string;
  claims: MatchmakingTicketClaims;
} {
  const now = Date.now();
  const selectedHero = isKnownHeroId(input.selectedHero) ? input.selectedHero : undefined;
  const claims: MatchmakingTicketClaims = {
    version: 2,
    mode: input.mode,
    gameplayMode: input.mode === 'ranked'
      ? RANKED_GAMEPLAY_MODE
      : isGameplayMode(input.gameplayMode)
        ? input.gameplayMode
        : DEFAULT_GAMEPLAY_MODE,
    botFillMode: input.mode === 'ranked'
      ? RANKED_BOT_FILL_MODE
      : normalizeMatchmakingBotFillMode(input.botFillMode),
    matchPerspective: input.mode === 'quick_play' && isMatchPerspective(input.matchPerspective)
      ? input.matchPerspective
      : DEFAULT_MATCH_PERSPECTIVE,
    selectedHero,
    selectedSkinId: normalizeSelectedSkinId(selectedHero, input.selectedSkinId),
    matchmakingRegion: normalizeMatchmakingRegion(input.matchmakingRegion),
    userId: input.userId,
    competitiveRating: Math.round(Number.isFinite(input.competitiveRating) ? input.competitiveRating : DEFAULT_MATCHMAKING_RATING),
    rankDivisionIndex: normalizeRankDivisionIndex(input.rankDivisionIndex),
    targetRankDivisionIndex: normalizeRankDivisionIndex(input.targetRankDivisionIndex),
    placementRemaining: Math.max(0, Math.floor(Number.isFinite(input.placementRemaining) ? input.placementRemaining : 0)),
    rankedTokenAddress: input.mode === 'ranked' ? input.rankedTokenAddress : undefined,
    rankedTokenDecimals: input.mode === 'ranked' ? input.rankedTokenDecimals : undefined,
    rankedTokenRequiredBaseUnits: input.mode === 'ranked' ? input.rankedTokenRequiredBaseUnits : undefined,
    rankedTokenBalanceBaseUnits: input.mode === 'ranked' ? input.rankedTokenBalanceBaseUnits : undefined,
    rankedTokenCheckedAt: input.mode === 'ranked' ? input.rankedTokenCheckedAt : undefined,
    rankedRewardEligible: input.mode === 'ranked' ? input.rankedRewardEligible === true : undefined,
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
  const gameplayMode = mode === 'ranked'
    ? RANKED_GAMEPLAY_MODE
    : isGameplayMode(claims.gameplayMode)
      ? claims.gameplayMode
      : DEFAULT_GAMEPLAY_MODE;
  const botFillMode = mode === 'ranked'
    ? RANKED_BOT_FILL_MODE
    : isMatchmakingBotFillMode(claims.botFillMode)
      ? claims.botFillMode
      : 'manual';
  const matchPerspective = mode === 'quick_play' && isMatchPerspective(claims.matchPerspective)
    ? claims.matchPerspective
    : DEFAULT_MATCH_PERSPECTIVE;
  const selectedHero = isKnownHeroId(claims.selectedHero) ? claims.selectedHero : undefined;
  const selectedSkinId = normalizeSelectedSkinId(selectedHero, claims.selectedSkinId);
  const matchmakingRegion = normalizeMatchmakingRegion(claims.matchmakingRegion);
  if (!claims.userId || !claims.nonce) return null;
  if (claims.expiresAt < now || claims.issuedAt > now + 5_000) return null;
  if (!Number.isFinite(claims.competitiveRating)) return null;
  if (normalizeRankDivisionIndex(claims.rankDivisionIndex) !== claims.rankDivisionIndex) return null;
  if (normalizeRankDivisionIndex(claims.targetRankDivisionIndex) !== claims.targetRankDivisionIndex) return null;

  if (
    claims.rankedTokenAddress !== undefined
    && !isCanonicalSolanaAddress(claims.rankedTokenAddress)
  ) return null;
  if (
    claims.rankedTokenDecimals !== undefined
    && (!Number.isInteger(claims.rankedTokenDecimals) || claims.rankedTokenDecimals < 0 || claims.rankedTokenDecimals > 255)
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
  if (
    claims.rankedRewardEligible !== undefined
    && typeof claims.rankedRewardEligible !== 'boolean'
  ) return null;

  return {
    ...claims,
    mode,
    gameplayMode,
    botFillMode,
    matchPerspective,
    selectedHero,
    selectedSkinId,
    matchmakingRegion,
    competitiveRating: Math.round(claims.competitiveRating),
    rankDivisionIndex: claims.rankDivisionIndex ?? DEFAULT_RANK_DIVISION_INDEX,
    targetRankDivisionIndex: claims.targetRankDivisionIndex ?? DEFAULT_RANK_DIVISION_INDEX,
    placementRemaining: Math.max(0, Math.floor(claims.placementRemaining ?? 0)),
    rankedTokenAddress: mode === 'ranked' ? claims.rankedTokenAddress : undefined,
    rankedTokenDecimals: mode === 'ranked' ? claims.rankedTokenDecimals : undefined,
    rankedTokenRequiredBaseUnits: mode === 'ranked' ? claims.rankedTokenRequiredBaseUnits : undefined,
    rankedTokenBalanceBaseUnits: mode === 'ranked' ? claims.rankedTokenBalanceBaseUnits : undefined,
    rankedTokenCheckedAt: mode === 'ranked' ? claims.rankedTokenCheckedAt : undefined,
    rankedRewardEligible: mode === 'ranked' ? claims.rankedRewardEligible === true : undefined,
  };
}
