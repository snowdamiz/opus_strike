import type { Request } from 'express';
import { matchMaker } from 'colyseus';
import prisma from '../db';
import { verifyAuthToken } from '../auth/session';
import { getRequestAuthToken } from '../auth/http';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { createMatchmakingTicket } from '../security/matchmakingTickets';
import {
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from './skill';
import { getRankDivisionIndex } from '@voxel-strike/shared';
import type { MatchMode } from '@voxel-strike/shared';
import { serializeRankPayload, type PublicRankPayload } from '../ranking/serialization';
import type { RankedTokenHoldingStatus } from './rankedTokenHold';

export interface MatchmakingUserContext {
  userId: string;
  walletAddress: string | null;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: PublicRankPayload;
  tutorialCompletedAt: Date | null;
}

interface QueueCandidate {
  rankBandId: number;
  humanCount: number;
  queuedHumanCount: number;
  waitMs: number;
  distance: number;
  ratingDistance: number;
}

export interface IssuedMatchmakingTicket {
  ticket: string;
  mode: 'quick_play' | 'ranked';
  expiresAt: number;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: PublicRankPayload;
  targetRankDivisionIndex: number;
  targetRankLabel: string;
}

export interface IssuedRankedTicket extends IssuedMatchmakingTicket {
  mode: 'ranked';
  tokenHold: RankedTokenHoldingStatus;
}

export async function getMatchmakingUserContext(req: Request): Promise<MatchmakingUserContext> {
  const token = getRequestAuthToken(req, { allowBearer: true });
  const payload = token ? verifyAuthToken(token) : null;

  if (payload) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: payload.userId },
          ...(payload.walletAddress ? [{ walletAddress: payload.walletAddress }] : []),
        ],
      },
      select: {
        id: true,
        walletAddress: true,
        totalGames: true,
        totalWins: true,
        totalKills: true,
        totalDeaths: true,
        totalAssists: true,
        totalCaptures: true,
        totalFlagReturns: true,
        totalScore: true,
        competitiveRating: true,
        rankedGames: true,
        rankedWins: true,
        rankedLosses: true,
        rankedDraws: true,
        rankedPlacementsRemaining: true,
        rankedPeakRating: true,
        rankedLastMatchAt: true,
        tutorialCompletedAt: true,
      },
    });

    if (user && (!payload.walletAddress || user.walletAddress === payload.walletAddress)) {
      await assertGameplayAccountEligible(user.id);
      const rank = serializeRankPayload(user);
      return {
        userId: user.id,
        walletAddress: user.walletAddress,
        competitiveRating: user.competitiveRating,
        rankDivisionIndex: getRankDivisionIndex(user.competitiveRating),
        rank,
        tutorialCompletedAt: user.tutorialCompletedAt,
      };
    }
  }

  throw new Error('Authentication required');
}

export async function chooseMatchmakingRankBand(input: {
  mode: 'quick_play' | 'ranked';
  playerRating: number;
  playerDivisionIndex: number;
}): Promise<number> {
  const now = Date.now();
  const rooms = await matchMaker.query({ name: 'lobby_room' });

  const candidates: QueueCandidate[] = rooms.flatMap((room: any) => {
    const metadata = room.metadata ?? {};
    if (room.locked || metadata.matchmakingMode !== true || metadata.status !== 'matchmaking') return [];
    const mode = metadata.matchMode === 'ranked' ? 'ranked' : 'quick_play';
    if (mode !== input.mode) return [];
    const rankBandId = normalizeRankDivisionIndex(metadata.rankBandId);
    const averageCompetitiveRating = typeof metadata.averageCompetitiveRating === 'number'
      ? metadata.averageCompetitiveRating
      : input.playerRating;
    const averageDivisionIndex = getRankDivisionIndex(averageCompetitiveRating);
    const distance = Math.abs(averageDivisionIndex - input.playerDivisionIndex);
    const ratingDistance = Math.abs(averageCompetitiveRating - input.playerRating);
    const createdAt = typeof metadata.matchmakingCreatedAt === 'number' ? metadata.matchmakingCreatedAt : now;
    const waitMs = Math.max(0, now - createdAt);
    const humanCount = typeof metadata.humanCount === 'number' ? metadata.humanCount : room.clients ?? 0;
    const participantCount = typeof metadata.participantCount === 'number'
      ? metadata.participantCount
      : humanCount;
    const queuedHumanCount = typeof metadata.queuedHumanCount === 'number'
      ? metadata.queuedHumanCount
      : humanCount;
    const requiredPlayers = typeof metadata.requiredPlayers === 'number' ? metadata.requiredPlayers : room.maxClients ?? 0;

    if (participantCount >= requiredPlayers) return [];
    if (distance > getAllowedRankDivisionDistance(waitMs)) return [];

    return [{
      rankBandId,
      humanCount,
      queuedHumanCount,
      waitMs,
      distance,
      ratingDistance,
    }];
  });

  candidates.sort((a, b) => (
    a.ratingDistance - b.ratingDistance
    || a.distance - b.distance
    || b.humanCount - a.humanCount
    || b.waitMs - a.waitMs
  ));

  return candidates[0]?.rankBandId ?? input.playerDivisionIndex;
}

export function issueQuickPlayTicket(
  context: MatchmakingUserContext,
  targetRankDivisionIndex: number
): IssuedMatchmakingTicket {
  const { ticket, claims } = createMatchmakingTicket({
    mode: 'quick_play',
    userId: context.userId,
    competitiveRating: context.competitiveRating,
    rankDivisionIndex: context.rankDivisionIndex,
    targetRankDivisionIndex,
    placementRemaining: context.rank.rankedPlacementsRemaining,
  });

  return {
    ticket,
    mode: 'quick_play',
    expiresAt: claims.expiresAt,
    competitiveRating: context.competitiveRating,
    rankDivisionIndex: context.rankDivisionIndex,
    rank: context.rank,
    targetRankDivisionIndex,
    targetRankLabel: getRankDivisionLabel(targetRankDivisionIndex),
  };
}

export function issueRankedTicket(
  context: MatchmakingUserContext,
  targetRankDivisionIndex: number,
  tokenHold: RankedTokenHoldingStatus
): IssuedRankedTicket {
  const { ticket, claims } = createMatchmakingTicket({
    mode: 'ranked',
    userId: context.userId,
    competitiveRating: context.competitiveRating,
    rankDivisionIndex: context.rankDivisionIndex,
    targetRankDivisionIndex,
    placementRemaining: context.rank.rankedPlacementsRemaining,
    rankedTokenAddress: tokenHold.tokenAddress,
    rankedTokenDecimals: tokenHold.tokenDecimals ?? undefined,
    rankedTokenHoldUsdCents: tokenHold.usdCents,
    rankedTokenRequiredBaseUnits: tokenHold.requiredTokenBaseUnits,
    rankedTokenBalanceBaseUnits: tokenHold.balanceTokenBaseUnits,
    rankedTokenCheckedAt: Date.parse(tokenHold.checkedAt),
  });

  return {
    ticket,
    mode: 'ranked',
    expiresAt: claims.expiresAt,
    competitiveRating: context.competitiveRating,
    rankDivisionIndex: context.rankDivisionIndex,
    rank: context.rank,
    targetRankDivisionIndex,
    targetRankLabel: getRankDivisionLabel(targetRankDivisionIndex),
    tokenHold,
  };
}

export function averageMatchmakingContext(
  contexts: MatchmakingUserContext[],
  mode: MatchMode
): { mode: 'quick_play' | 'ranked'; playerRating: number; playerDivisionIndex: number } {
  if (mode !== 'quick_play' && mode !== 'ranked') {
    throw new Error('Party matchmaking requires quick play or ranked mode');
  }
  if (contexts.length === 0) {
    throw new Error('Cannot choose matchmaking band for an empty party');
  }

  const playerRating = Math.round(
    contexts.reduce((total, context) => total + context.competitiveRating, 0) / contexts.length
  );

  return {
    mode,
    playerRating,
    playerDivisionIndex: getRankDivisionIndex(playerRating),
  };
}
