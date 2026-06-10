import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { matchMaker } from 'colyseus';
import prisma from '../db';
import { isGuestPlayAllowed } from '../config/security';
import { parseCookies, verifyAuthToken } from '../auth/session';
import { createMatchmakingTicket } from '../security/matchmakingTickets';
import {
  calculateMatchmakingRating,
  getAllowedBucketDistance,
  getSkillBucket,
  getSkillBucketIndex,
  getSkillBucketLabel,
  normalizeSkillBucket,
  type MatchmakingSkillBucket,
  type MatchmakingStats,
} from './skill';

const router: RouterType = Router();

interface MatchmakingUserContext {
  userId: string;
  stats: MatchmakingStats | null;
}

interface QuickPlayCandidate {
  bucket: MatchmakingSkillBucket;
  humanCount: number;
  waitMs: number;
  distance: number;
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
      },
    });

    if (user && (!payload.walletAddress || user.walletAddress === payload.walletAddress)) {
      return {
        userId: user.id,
        stats: user,
      };
    }
  }

  if (!isGuestPlayAllowed()) {
    throw new Error('Authentication required');
  }

  return {
    userId: 'guest:quick-play',
    stats: null,
  };
}

async function chooseQuickPlayBucket(playerBucket: MatchmakingSkillBucket): Promise<MatchmakingSkillBucket> {
  const now = Date.now();
  const playerBucketIndex = getSkillBucketIndex(playerBucket);
  const rooms = await matchMaker.query({ name: 'lobby_room' });

  const candidates: QuickPlayCandidate[] = rooms.flatMap((room: any) => {
    const metadata = room.metadata ?? {};
    if (room.locked || metadata.matchmakingMode !== true || metadata.status !== 'matchmaking') return [];

    const bucket = normalizeSkillBucket(metadata.skillBucket);
    const bucketIndex = getSkillBucketIndex(bucket);
    const distance = Math.abs(bucketIndex - playerBucketIndex);
    const createdAt = typeof metadata.matchmakingCreatedAt === 'number' ? metadata.matchmakingCreatedAt : now;
    const waitMs = Math.max(0, now - createdAt);
    const humanCount = typeof metadata.humanCount === 'number' ? metadata.humanCount : room.clients ?? 0;
    const requiredPlayers = typeof metadata.requiredPlayers === 'number' ? metadata.requiredPlayers : room.maxClients ?? 0;

    if (humanCount >= requiredPlayers) return [];
    if (distance > getAllowedBucketDistance(waitMs)) return [];

    return [{
      bucket,
      humanCount,
      waitMs,
      distance,
    }];
  });

  candidates.sort((a, b) => (
    a.distance - b.distance
    || b.humanCount - a.humanCount
    || b.waitMs - a.waitMs
  ));

  return candidates[0]?.bucket ?? playerBucket;
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
    const skillRating = calculateMatchmakingRating(context.stats);
    const skillBucket = getSkillBucket(skillRating).id;
    const targetSkillBucket = await chooseQuickPlayBucket(skillBucket);
    const { ticket, claims } = createMatchmakingTicket({
      userId: context.userId,
      skillRating,
      skillBucket,
      targetSkillBucket,
    });

    res.json({
      ticket,
      expiresAt: claims.expiresAt,
      skillRating,
      skillBucket,
      skillBucketLabel: getSkillBucketLabel(skillBucket),
      targetSkillBucket,
      targetSkillBucketLabel: getSkillBucketLabel(targetSkillBucket),
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
