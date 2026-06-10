import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { matchMaker } from 'colyseus';
import prisma from '../db';
import { isGuestPlayAllowed } from '../config/security';
import { parseCookies, verifyAuthToken } from '../auth/session';
import { createMatchmakingTicket } from '../security/matchmakingTickets';
import {
  DEFAULT_MATCHMAKING_RATING,
  DEFAULT_RANK_DIVISION_INDEX,
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from './skill';
import { getRankDivisionIndex } from '@voxel-strike/shared';
import { serializeRankPayload, type PublicRankPayload } from '../ranking/serialization';

const router: RouterType = Router();

interface MatchmakingUserContext {
  userId: string;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: PublicRankPayload;
  isGuest: boolean;
}

interface QuickPlayCandidate {
  rankBandId: number;
  humanCount: number;
  waitMs: number;
  distance: number;
  ratingDistance: number;
}

interface QuickPlayQueueStatus {
  totalPlayersInQueue: number;
  queueCount: number;
}

function getRequestToken(req: Request): string | null {
  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim() || null;
  }

  const cookies = parseCookies(req.headers.cookie);
  return cookies.auth_token || null;
}

async function getMatchmakingUserContext(req: Request): Promise<MatchmakingUserContext> {
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
        competitiveRating: user.competitiveRating,
        rankDivisionIndex: getRankDivisionIndex(user.competitiveRating),
        rank,
        isGuest: false,
      };
    }
  }

  if (!isGuestPlayAllowed()) {
    throw new Error('Authentication required');
  }

  return {
    userId: 'guest:quick-play',
    competitiveRating: DEFAULT_MATCHMAKING_RATING,
    rankDivisionIndex: DEFAULT_RANK_DIVISION_INDEX,
    rank: serializeRankPayload(null),
    isGuest: true,
  };
}

async function chooseQuickPlayRankBand(playerRating: number, playerDivisionIndex: number): Promise<number> {
  const now = Date.now();
  const rooms = await matchMaker.query({ name: 'lobby_room' });

  const candidates: QuickPlayCandidate[] = rooms.flatMap((room: any) => {
    const metadata = room.metadata ?? {};
    if (room.locked || metadata.matchmakingMode !== true || metadata.status !== 'matchmaking') return [];

    const rankBandId = normalizeRankDivisionIndex(metadata.rankBandId);
    const averageCompetitiveRating = typeof metadata.averageCompetitiveRating === 'number'
      ? metadata.averageCompetitiveRating
      : playerRating;
    const averageDivisionIndex = getRankDivisionIndex(averageCompetitiveRating);
    const distance = Math.abs(averageDivisionIndex - playerDivisionIndex);
    const ratingDistance = Math.abs(averageCompetitiveRating - playerRating);
    const createdAt = typeof metadata.matchmakingCreatedAt === 'number' ? metadata.matchmakingCreatedAt : now;
    const waitMs = Math.max(0, now - createdAt);
    const humanCount = typeof metadata.humanCount === 'number' ? metadata.humanCount : room.clients ?? 0;
    const requiredPlayers = typeof metadata.requiredPlayers === 'number' ? metadata.requiredPlayers : room.maxClients ?? 0;

    if (humanCount >= requiredPlayers) return [];
    if (distance > getAllowedRankDivisionDistance(waitMs)) return [];

    return [{
      rankBandId,
      humanCount,
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

  return candidates[0]?.rankBandId ?? playerDivisionIndex;
}

async function getQuickPlayQueueStatus(): Promise<QuickPlayQueueStatus> {
  const rooms = await matchMaker.query({ name: 'lobby_room' });
  let totalPlayersInQueue = 0;
  let queueCount = 0;

  for (const room of rooms as any[]) {
    const metadata = room.metadata ?? {};
    if (metadata.matchmakingMode !== true || metadata.status !== 'matchmaking') continue;

    const humanCount = Math.max(0, typeof metadata.humanCount === 'number' ? metadata.humanCount : room.clients ?? 0);
    const requiredPlayers = typeof metadata.requiredPlayers === 'number' ? metadata.requiredPlayers : room.maxClients ?? 0;
    if (requiredPlayers > 0 && humanCount >= requiredPlayers) continue;

    totalPlayersInQueue += humanCount;
    queueCount++;
  }

  return { totalPlayersInQueue, queueCount };
}

router.get('/queue-status', async (_req: Request, res: Response) => {
  try {
    res.json(await getQuickPlayQueueStatus());
  } catch (error) {
    console.error('[matchmaking] Failed to get queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

router.get('/quick-play-ticket', async (req: Request, res: Response) => {
  try {
    const context = await getMatchmakingUserContext(req);
    const targetRankDivisionIndex = await chooseQuickPlayRankBand(
      context.competitiveRating,
      context.rankDivisionIndex
    );
    const { ticket, claims } = createMatchmakingTicket({
      userId: context.userId,
      competitiveRating: context.competitiveRating,
      rankDivisionIndex: context.rankDivisionIndex,
      targetRankDivisionIndex,
      placementRemaining: context.rank.rankedPlacementsRemaining,
    });

    res.json({
      ticket,
      expiresAt: claims.expiresAt,
      competitiveRating: context.competitiveRating,
      rankDivisionIndex: context.rankDivisionIndex,
      rank: context.rank,
      isGuest: context.isGuest,
      targetRankDivisionIndex,
      targetRankLabel: getRankDivisionLabel(targetRankDivisionIndex),
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Authentication required') {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    console.error('[matchmaking] Failed to issue quick-play ticket:', error);
    res.status(500).json({ error: 'Failed to issue matchmaking ticket' });
  }
});

export default router;
