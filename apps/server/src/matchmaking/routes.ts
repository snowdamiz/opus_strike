import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { matchMaker } from 'colyseus';
import prisma from '../db';
import { isGuestPlayAllowed } from '../config/security';
import { parseCookies, verifyAuthToken } from '../auth/session';
import { createMatchmakingTicket } from '../security/matchmakingTickets';
import {
  createRankedEntryQuote,
  getValidRankedEntryQuote,
} from './rankedEntry';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from './skill';
import { getRankDivisionIndex } from '@voxel-strike/shared';
import type { MatchMode } from '@voxel-strike/shared';
import { serializeRankPayload, type PublicRankPayload } from '../ranking/serialization';

const router: RouterType = Router();

interface MatchmakingUserContext {
  userId: string;
  walletAddress: string | null;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: PublicRankPayload;
  isGuest: boolean;
}

interface QueueCandidate {
  rankBandId: number;
  humanCount: number;
  queuedHumanCount: number;
  waitMs: number;
  distance: number;
  ratingDistance: number;
}

interface MatchmakingQueueStatus {
  mode: MatchMode;
  totalPlayersInQueue: number;
  queueCount: number;
  provisionalPlayerCount?: number;
  requiredPlayers?: number;
}

function getRequestToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim() || null;
  }

  const cookies = parseCookies(req.headers.cookie);
  return cookies.auth_token || null;
}

function sendRouteError(res: Response, error: unknown, fallbackMessage: string): void {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode) || 500
    : error instanceof Error && error.message === 'Authentication required'
      ? 401
      : 500;
  const message = error instanceof Error ? error.message : fallbackMessage;
  res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ error: message });
}

async function getMatchmakingUserContext(
  req: Request,
  options: { allowGuest: boolean } = { allowGuest: true }
): Promise<MatchmakingUserContext> {
  const token = getRequestToken(req);
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
      },
    });

    if (user && (!payload.walletAddress || user.walletAddress === payload.walletAddress)) {
      const rank = serializeRankPayload(user);
      return {
        userId: user.id,
        walletAddress: user.walletAddress,
        competitiveRating: user.competitiveRating,
        rankDivisionIndex: getRankDivisionIndex(user.competitiveRating),
        rank,
        isGuest: false,
      };
    }
  }

  if (!options.allowGuest || !isGuestPlayAllowed()) {
    throw new Error('Authentication required');
  }

  return {
    userId: 'guest:quick-play',
    walletAddress: null,
    competitiveRating: DEFAULT_MATCHMAKING_RATING,
    rankDivisionIndex: DEFAULT_RANK_DIVISION_INDEX,
    rank: serializeRankPayload(null),
    isGuest: true,
  };
}

async function chooseMatchmakingRankBand(input: {
  mode: 'quick_play' | 'ranked';
  playerRating: number;
  playerDivisionIndex: number;
  coverChargeLamports?: string;
}): Promise<number> {
  const now = Date.now();
  const rooms = await matchMaker.query({ name: 'lobby_room' });

  const candidates: QueueCandidate[] = rooms.flatMap((room: any) => {
    const metadata = room.metadata ?? {};
    if (room.locked || metadata.matchmakingMode !== true || metadata.status !== 'matchmaking') return [];
    const mode = metadata.matchMode === 'ranked' ? 'ranked' : 'quick_play';
    if (mode !== input.mode) return [];
    if (
      input.mode === 'ranked'
      && metadata.rankedCoverChargeLamports !== input.coverChargeLamports
    ) return [];

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
    const queuedHumanCount = typeof metadata.queuedHumanCount === 'number'
      ? metadata.queuedHumanCount
      : humanCount;
    const requiredPlayers = typeof metadata.requiredPlayers === 'number' ? metadata.requiredPlayers : room.maxClients ?? 0;

    if (humanCount >= requiredPlayers) return [];
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

async function getQueueStatus(mode: MatchMode): Promise<MatchmakingQueueStatus> {
  const rooms = await matchMaker.query({ name: 'lobby_room' });
  let totalPlayersInQueue = 0;
  let provisionalPlayerCount = 0;
  let queueCount = 0;
  let requiredPlayers: number | undefined;

  for (const room of rooms as any[]) {
    const metadata = room.metadata ?? {};
    if (metadata.matchmakingMode !== true || metadata.status !== 'matchmaking') continue;
    const roomMode: MatchMode = metadata.matchMode === 'ranked' ? 'ranked' : 'quick_play';
    if (roomMode !== mode) continue;

    const humanCount = Math.max(0, typeof metadata.humanCount === 'number' ? metadata.humanCount : room.clients ?? 0);
    const queuedHumanCount = Math.max(0, typeof metadata.queuedHumanCount === 'number'
      ? metadata.queuedHumanCount
      : humanCount);
    const roomRequiredPlayers = typeof metadata.requiredPlayers === 'number' ? metadata.requiredPlayers : room.maxClients ?? 0;
    requiredPlayers = roomRequiredPlayers || requiredPlayers;
    if (roomRequiredPlayers > 0 && queuedHumanCount >= roomRequiredPlayers) continue;

    totalPlayersInQueue += queuedHumanCount;
    provisionalPlayerCount += Math.max(0, humanCount - queuedHumanCount);
    queueCount++;
  }

  return {
    mode,
    totalPlayersInQueue,
    queueCount,
    provisionalPlayerCount,
    requiredPlayers,
  };
}

router.get('/queue-status', async (req: Request, res: Response) => {
  try {
    const requestedMode = req.query.mode === 'ranked' ? 'ranked' : 'quick_play';
    res.json(await getQueueStatus(requestedMode));
  } catch (error) {
    console.error('[matchmaking] Failed to get queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

router.get('/quick-play-ticket', async (req: Request, res: Response) => {
  try {
    const context = await getMatchmakingUserContext(req);
    const targetRankDivisionIndex = await chooseMatchmakingRankBand({
      mode: 'quick_play',
      playerRating: context.competitiveRating,
      playerDivisionIndex: context.rankDivisionIndex,
    });
    const { ticket, claims } = createMatchmakingTicket({
      mode: 'quick_play',
      userId: context.userId,
      competitiveRating: context.competitiveRating,
      rankDivisionIndex: context.rankDivisionIndex,
      targetRankDivisionIndex,
      placementRemaining: context.rank.rankedPlacementsRemaining,
    });

    res.json({
      ticket,
      mode: claims.mode,
      expiresAt: claims.expiresAt,
      competitiveRating: context.competitiveRating,
      rankDivisionIndex: context.rankDivisionIndex,
      rank: context.rank,
      isGuest: context.isGuest,
      targetRankDivisionIndex,
      targetRankLabel: getRankDivisionLabel(targetRankDivisionIndex),
    });
  } catch (error) {
    console.error('[matchmaking] Failed to issue quick-play ticket:', error);
    sendRouteError(res, error, 'Failed to issue matchmaking ticket');
  }
});

router.get('/ranked-entry-quote', async (req: Request, res: Response) => {
  try {
    const context = await getMatchmakingUserContext(req, { allowGuest: false });
    if (!context.walletAddress) {
      throw Object.assign(new Error('A linked Solana wallet is required for ranked'), { statusCode: 400 });
    }

    res.json({ quote: await createRankedEntryQuote(context.userId) });
  } catch (error) {
    console.error('[matchmaking] Failed to create ranked entry quote:', error);
    sendRouteError(res, error, 'Failed to create ranked entry quote');
  }
});

router.post('/ranked-ticket', async (req: Request, res: Response) => {
  try {
    const context = await getMatchmakingUserContext(req, { allowGuest: false });
    if (!context.walletAddress) {
      throw Object.assign(new Error('A linked Solana wallet is required for ranked'), { statusCode: 400 });
    }

    const quoteId = typeof req.body?.quoteId === 'string' ? req.body.quoteId : '';
    if (!quoteId) {
      throw Object.assign(new Error('quoteId is required'), { statusCode: 400 });
    }

    const quote = await getValidRankedEntryQuote({
      quoteId,
      userId: context.userId,
    });
    const coverChargeLamports = quote.coverChargeLamports.toString();
    const targetRankDivisionIndex = await chooseMatchmakingRankBand({
      mode: 'ranked',
      playerRating: context.competitiveRating,
      playerDivisionIndex: context.rankDivisionIndex,
      coverChargeLamports,
    });
    const now = Date.now();
    const ttlMs = Math.max(1, Math.min(60_000, quote.expiresAt.getTime() - now));
    const { ticket, claims } = createMatchmakingTicket({
      mode: 'ranked',
      userId: context.userId,
      competitiveRating: context.competitiveRating,
      rankDivisionIndex: context.rankDivisionIndex,
      targetRankDivisionIndex,
      placementRemaining: context.rank.rankedPlacementsRemaining,
      rankedEntryQuoteId: quote.id,
      coverChargeLamports,
      rankedEntryQuoteExpiresAt: quote.expiresAt.getTime(),
      ttlMs,
    });

    res.json({
      ticket,
      mode: claims.mode,
      expiresAt: claims.expiresAt,
      competitiveRating: context.competitiveRating,
      rankDivisionIndex: context.rankDivisionIndex,
      rank: context.rank,
      isGuest: false,
      targetRankDivisionIndex,
      targetRankLabel: getRankDivisionLabel(targetRankDivisionIndex),
      quote: {
        quoteId: quote.id,
        usdCents: quote.usdCents,
        solUsdPriceMicroUsd: quote.solUsdPriceMicroUsd.toString(),
        coverChargeLamports,
        priceSource: quote.priceSource,
        expiresAt: quote.expiresAt.toISOString(),
        cluster: quote.cluster,
      },
    });
  } catch (error) {
    console.error('[matchmaking] Failed to issue ranked ticket:', error);
    sendRouteError(res, error, 'Failed to issue ranked ticket');
  }
});

export default router;
