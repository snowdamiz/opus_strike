import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { matchMaker } from 'colyseus';
import prisma from '../db';
import { parseCookies, verifyAuthToken } from '../auth/session';
import { assertGameplayAccountEligible } from '../auth/accountEligibility';
import { consumeRateLimit, consumeRateLimitForKey } from '../auth/rateLimit';
import { createMatchmakingTicket } from '../security/matchmakingTickets';
import {
  assertRankedTokenHoldingEligibility,
  getRankedTokenHoldingStatus,
} from './rankedTokenHold';
import {
  getAllowedRankDivisionDistance,
  getRankDivisionLabel,
  normalizeRankDivisionIndex,
} from './skill';
import { collectInGameCapacitySnapshot, type InGameCapacitySnapshot } from './playerCapacity';
import { getRankDivisionIndex } from '@voxel-strike/shared';
import type { MatchMode } from '@voxel-strike/shared';
import { serializeRankPayload, type PublicRankPayload } from '../ranking/serialization';

const router: RouterType = Router();

const MATCHMAKING_RATE_LIMITS = {
  queueStatus: { limit: 120, windowMs: 60 * 1000 },
  ticket: { limit: 18, windowMs: 60 * 1000 },
  rankedStatus: { limit: 12, windowMs: 60 * 1000 },
  rankedTicket: { limit: 8, windowMs: 60 * 1000 },
  runningGameStatus: { limit: 60, windowMs: 60 * 1000 },
} as const;

interface MatchmakingUserContext {
  userId: string;
  walletAddress: string | null;
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: PublicRankPayload;
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
  capacity: InGameCapacitySnapshot;
}

interface QueueStatusCacheEntry {
  expiresAt: number;
  value?: MatchmakingQueueStatus;
  inFlight?: Promise<MatchmakingQueueStatus>;
}

const RUNNING_GAME_PHASES = new Set(['waiting', 'hero_select', 'countdown', 'playing', 'round_end']);
const QUEUE_STATUS_CACHE_TTL_MS = 750;
const queueStatusCache = new Map<MatchMode, QueueStatusCacheEntry>();

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

function enforceMatchmakingRateLimit(req: Request, res: Response, keyPrefix: string, options: {
  limit: number;
  windowMs: number;
}): boolean {
  const ipLimit = consumeRateLimit(req, { keyPrefix, ...options });
  if (!ipLimit.ok) {
    res.setHeader('Retry-After', ipLimit.retryAfterSeconds.toString());
    res.status(429).json({ error: 'Too many requests' });
    return false;
  }

  return true;
}

function enforceMatchmakingIdentityRateLimit(res: Response, keyPrefix: string, options: {
  limit: number;
  windowMs: number;
}, identity: string): boolean {
  const identityLimit = consumeRateLimitForKey(`user:${identity}`, {
    keyPrefix,
    limit: Math.max(2, options.limit),
    windowMs: options.windowMs,
  });
  if (identityLimit.ok) return true;

  res.setHeader('Retry-After', identityLimit.retryAfterSeconds.toString());
  res.status(429).json({ error: 'Too many requests' });
  return false;
}

function readRoomIdParam(req: Request): string | null {
  const value = typeof req.params.roomId === 'string' ? req.params.roomId.trim() : '';
  if (!value || value.length > 128) return null;
  return /^[a-zA-Z0-9_-]+$/.test(value) ? value : null;
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
      await assertGameplayAccountEligible(user.id);
      const rank = serializeRankPayload(user);
      return {
        userId: user.id,
        walletAddress: user.walletAddress,
        competitiveRating: user.competitiveRating,
        rankDivisionIndex: getRankDivisionIndex(user.competitiveRating),
        rank,
      };
    }
  }

  throw new Error('Authentication required');
}

async function chooseMatchmakingRankBand(input: {
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
  const [rooms, capacity] = await Promise.all([
    matchMaker.query({ name: 'lobby_room' }),
    collectInGameCapacitySnapshot(matchMaker),
  ]);
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
    if (roomRequiredPlayers > 0 && queuedHumanCount >= roomRequiredPlayers && metadata.capacityBlocked !== true) continue;

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
    capacity,
  };
}

function getCachedQueueStatus(mode: MatchMode): Promise<MatchmakingQueueStatus> {
  const now = Date.now();
  const cached = queueStatusCache.get(mode);
  if (cached?.value && cached.expiresAt > now) {
    return Promise.resolve(cached.value);
  }
  if (cached?.inFlight) {
    return cached.inFlight;
  }

  const inFlight = getQueueStatus(mode)
    .then((value) => {
      queueStatusCache.set(mode, {
        value,
        expiresAt: Date.now() + QUEUE_STATUS_CACHE_TTL_MS,
      });
      return value;
    })
    .catch((error) => {
      const current = queueStatusCache.get(mode);
      if (current?.inFlight === inFlight) {
        if (current.value) {
          queueStatusCache.set(mode, {
            value: current.value,
            expiresAt: current.expiresAt,
          });
        } else {
          queueStatusCache.delete(mode);
        }
      }
      throw error;
    });

  queueStatusCache.set(mode, {
    value: cached?.value,
    expiresAt: cached?.expiresAt ?? 0,
    inFlight,
  });
  return inFlight;
}

router.get('/queue-status', async (req: Request, res: Response) => {
  if (!enforceMatchmakingRateLimit(req, res, 'matchmaking:queue-status', MATCHMAKING_RATE_LIMITS.queueStatus)) return;

  try {
    const requestedMode = req.query.mode === 'ranked' ? 'ranked' : 'quick_play';
    res.set('Cache-Control', 'private, max-age=1');
    res.json(await getCachedQueueStatus(requestedMode));
  } catch (error) {
    console.error('[matchmaking] Failed to get queue status:', error);
    res.status(500).json({ error: 'Failed to get queue status' });
  }
});

router.get('/running-game/:roomId', async (req: Request, res: Response) => {
  if (!enforceMatchmakingRateLimit(req, res, 'matchmaking:running-game-status', MATCHMAKING_RATE_LIMITS.runningGameStatus)) return;

  try {
    const roomId = readRoomIdParam(req);
    if (!roomId) {
      res.status(400).json({ error: 'Invalid room id' });
      return;
    }

    const context = await getMatchmakingUserContext(req);
    if (!enforceMatchmakingIdentityRateLimit(res, 'matchmaking:running-game-status:user', MATCHMAKING_RATE_LIMITS.runningGameStatus, context.userId)) return;

    const rooms = await matchMaker.query({ name: 'game_room' });
    const room = (rooms as any[]).find((candidate) => candidate.roomId === roomId);
    const metadata = room?.metadata ?? {};
    const reconnectIdentityKeys = Array.isArray(metadata.reconnectIdentityKeys)
      ? metadata.reconnectIdentityKeys
      : [];
    const status = typeof metadata.status === 'string' ? metadata.status : '';
    const canReconnect = Boolean(
      room
      && RUNNING_GAME_PHASES.has(status)
      && reconnectIdentityKeys.includes(context.userId)
    );

    res.json({
      available: canReconnect,
      reason: canReconnect ? undefined : 'unavailable',
      roomId: canReconnect ? roomId : undefined,
      status: canReconnect ? status : undefined,
      matchMode: canReconnect ? metadata.matchMode : undefined,
      mapSeed: canReconnect ? metadata.mapSeed : undefined,
      mapThemeId: canReconnect ? metadata.mapThemeId : undefined,
    });
  } catch (error) {
    console.error('[matchmaking] Failed to check running game:', error);
    sendRouteError(res, error, 'Failed to check running game');
  }
});

router.get('/quick-play-ticket', async (req: Request, res: Response) => {
  if (!enforceMatchmakingRateLimit(req, res, 'matchmaking:quick-play-ticket', MATCHMAKING_RATE_LIMITS.ticket)) return;

  try {
    const context = await getMatchmakingUserContext(req);
    if (!enforceMatchmakingIdentityRateLimit(res, 'matchmaking:quick-play-ticket:user', MATCHMAKING_RATE_LIMITS.ticket, context.userId)) return;

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
      targetRankDivisionIndex,
      targetRankLabel: getRankDivisionLabel(targetRankDivisionIndex),
    });
  } catch (error) {
    console.error('[matchmaking] Failed to issue quick-play ticket:', error);
    sendRouteError(res, error, 'Failed to issue matchmaking ticket');
  }
});

router.get('/ranked-token-hold-status', async (req: Request, res: Response) => {
  if (!enforceMatchmakingRateLimit(req, res, 'matchmaking:ranked-token-hold-status', MATCHMAKING_RATE_LIMITS.rankedStatus)) return;

  try {
    const context = await getMatchmakingUserContext(req);
    if (!enforceMatchmakingIdentityRateLimit(res, 'matchmaking:ranked-token-hold-status:user', MATCHMAKING_RATE_LIMITS.rankedStatus, context.userId)) return;
    if (!context.walletAddress) {
      throw Object.assign(new Error('A linked Solana wallet is required for ranked'), { statusCode: 400 });
    }

    res.json({ tokenHold: await getRankedTokenHoldingStatus(context.walletAddress) });
  } catch (error) {
    console.error('[matchmaking] Failed to check ranked token holding:', error);
    sendRouteError(res, error, 'Failed to check ranked token holding');
  }
});

router.post('/ranked-ticket', async (req: Request, res: Response) => {
  if (!enforceMatchmakingRateLimit(req, res, 'matchmaking:ranked-ticket', MATCHMAKING_RATE_LIMITS.rankedTicket)) return;

  try {
    const context = await getMatchmakingUserContext(req);
    if (!enforceMatchmakingIdentityRateLimit(res, 'matchmaking:ranked-ticket:user', MATCHMAKING_RATE_LIMITS.rankedTicket, context.userId)) return;
    if (!context.walletAddress) {
      throw Object.assign(new Error('A linked Solana wallet is required for ranked'), { statusCode: 400 });
    }

    const tokenHold = await assertRankedTokenHoldingEligibility(context.walletAddress);
    const targetRankDivisionIndex = await chooseMatchmakingRankBand({
      mode: 'ranked',
      playerRating: context.competitiveRating,
      playerDivisionIndex: context.rankDivisionIndex,
    });
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

    res.json({
      ticket,
      mode: claims.mode,
      expiresAt: claims.expiresAt,
      competitiveRating: context.competitiveRating,
      rankDivisionIndex: context.rankDivisionIndex,
      rank: context.rank,
      targetRankDivisionIndex,
      targetRankLabel: getRankDivisionLabel(targetRankDivisionIndex),
      tokenHold,
    });
  } catch (error) {
    console.error('[matchmaking] Failed to issue ranked ticket:', error);
    sendRouteError(res, error, 'Failed to issue ranked ticket');
  }
});

export default router;
