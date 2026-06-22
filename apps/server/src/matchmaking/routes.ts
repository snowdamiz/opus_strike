import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { matchMaker } from 'colyseus';
import { enforceJsonRateLimit as enforceMatchmakingRateLimit } from '../auth/http';
import {
  DEV_TUTORIAL_BYPASS_HEADER,
  assertTutorialCompleted,
} from '../auth/tutorialCompletion';
import { consumeRateLimitForKey } from '../auth/rateLimit';
import {
  assertRankedTokenHoldingEligibility,
  getRankedTokenHoldingStatus,
} from './rankedTokenHold';
import { collectInGameCapacitySnapshot, type InGameCapacitySnapshot } from './playerCapacity';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  isGameplayMode,
  isKnownHeroId,
  isMatchPerspective,
  type GameplayMode,
  type HeroId,
  type MatchMode,
  type MatchPerspective,
} from '@voxel-strike/shared';
import {
  chooseMatchmakingRankBand,
  getMatchmakingUserContext,
  issueQuickPlayTicket,
  issueRankedTicket,
} from './service';
import {
  createMatchmakingSettings,
  doesMatchmakingMetadataMatchSettings,
  getQueueStatusCacheKey,
  normalizeMatchmakingBotFillMode,
  type MatchmakingBotFillMode,
} from './matchSettings';

const router: RouterType = Router();

const MATCHMAKING_RATE_LIMITS = {
  queueStatus: { limit: 120, windowMs: 60 * 1000 },
  ticket: { limit: 18, windowMs: 60 * 1000 },
  rankedStatus: { limit: 12, windowMs: 60 * 1000 },
  rankedTicket: { limit: 8, windowMs: 60 * 1000 },
  runningGameStatus: { limit: 60, windowMs: 60 * 1000 },
} as const;

interface MatchmakingQueueStatus {
  mode: MatchMode;
  gameplayMode?: GameplayMode;
  botFillMode?: MatchmakingBotFillMode;
  matchPerspective: MatchPerspective;
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
const queueStatusCache = new Map<string, QueueStatusCacheEntry>();

function sendRouteError(res: Response, error: unknown, fallbackMessage: string): void {
  const statusCode = typeof error === 'object' && error && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode) || 500
    : error instanceof Error && error.message === 'Authentication required'
      ? 401
      : 500;
  const message = error instanceof Error ? error.message : fallbackMessage;
  res.status(statusCode >= 400 && statusCode < 600 ? statusCode : 500).json({ error: message });
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

function readSelectedHero(value: unknown): HeroId | undefined {
  return typeof value === 'string' && isKnownHeroId(value) ? value : undefined;
}

async function getQueueStatus(
  mode: MatchMode,
  gameplayMode: GameplayMode,
  botFillMode: MatchmakingBotFillMode,
  matchPerspective: MatchPerspective
): Promise<MatchmakingQueueStatus> {
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
    const settings = createMatchmakingSettings({
      matchMode: mode,
      gameplayMode,
      botFillMode,
      matchPerspective,
    });
    if (!doesMatchmakingMetadataMatchSettings(metadata, settings)) continue;

    const humanCount = Math.max(0, typeof metadata.humanCount === 'number' ? metadata.humanCount : room.clients ?? 0);
    const participantCount = Math.max(0, typeof metadata.participantCount === 'number'
      ? metadata.participantCount
      : humanCount);
    const queuedHumanCount = Math.max(0, typeof metadata.queuedHumanCount === 'number'
      ? metadata.queuedHumanCount
      : humanCount);
    const roomRequiredPlayers = typeof metadata.requiredPlayers === 'number' ? metadata.requiredPlayers : room.maxClients ?? 0;
    requiredPlayers = roomRequiredPlayers || requiredPlayers;
    if (roomRequiredPlayers > 0 && participantCount >= roomRequiredPlayers && metadata.capacityBlocked !== true) continue;

    totalPlayersInQueue += queuedHumanCount;
    provisionalPlayerCount += Math.max(0, humanCount - queuedHumanCount);
    queueCount++;
  }

  return {
    mode,
    gameplayMode: mode === 'quick_play' ? gameplayMode : undefined,
    botFillMode: mode === 'quick_play' ? botFillMode : undefined,
    matchPerspective: mode === 'ranked' ? DEFAULT_MATCH_PERSPECTIVE : matchPerspective,
    totalPlayersInQueue,
    queueCount,
    provisionalPlayerCount,
    requiredPlayers,
    capacity,
  };
}

function getCachedQueueStatus(
  mode: MatchMode,
  gameplayMode: GameplayMode,
  botFillMode: MatchmakingBotFillMode,
  matchPerspective: MatchPerspective
): Promise<MatchmakingQueueStatus> {
  const now = Date.now();
  const cacheKey = getQueueStatusCacheKey(mode, gameplayMode, botFillMode, matchPerspective);
  const cached = queueStatusCache.get(cacheKey);
  if (cached?.value && cached.expiresAt > now) {
    return Promise.resolve(cached.value);
  }
  if (cached?.inFlight) {
    return cached.inFlight;
  }

  const inFlight = getQueueStatus(mode, gameplayMode, botFillMode, matchPerspective)
    .then((value) => {
      queueStatusCache.set(cacheKey, {
        value,
        expiresAt: Date.now() + QUEUE_STATUS_CACHE_TTL_MS,
      });
      return value;
    })
    .catch((error) => {
      const current = queueStatusCache.get(cacheKey);
      if (current?.inFlight === inFlight) {
        if (current.value) {
          queueStatusCache.set(cacheKey, {
            value: current.value,
            expiresAt: current.expiresAt,
          });
        } else {
          queueStatusCache.delete(cacheKey);
        }
      }
      throw error;
    });

  queueStatusCache.set(cacheKey, {
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
    const requestedGameplayMode = isGameplayMode(req.query.gameplayMode)
      ? req.query.gameplayMode
      : DEFAULT_GAMEPLAY_MODE;
    const requestedBotFillMode = normalizeMatchmakingBotFillMode(req.query.botFillMode);
    const requestedPerspective = isMatchPerspective(req.query.perspective)
      ? req.query.perspective
      : DEFAULT_MATCH_PERSPECTIVE;
    res.set('Cache-Control', 'private, max-age=1');
    res.json(await getCachedQueueStatus(
      requestedMode,
      requestedGameplayMode,
      requestedBotFillMode,
      requestedPerspective
    ));
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
      matchPerspective: canReconnect ? metadata.matchPerspective : undefined,
      mapSeed: canReconnect ? metadata.mapSeed : undefined,
      mapThemeId: canReconnect ? metadata.mapThemeId : undefined,
      mapSize: canReconnect ? metadata.mapSize : undefined,
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
    assertTutorialCompleted(context.tutorialCompletedAt, {
      devBypass: req.headers[DEV_TUTORIAL_BYPASS_HEADER],
    });

    const gameplayMode = isGameplayMode(req.query.gameplayMode)
      ? req.query.gameplayMode
      : DEFAULT_GAMEPLAY_MODE;
    const botFillMode = normalizeMatchmakingBotFillMode(req.query.botFillMode);
    const matchPerspective = isMatchPerspective(req.query.perspective)
      ? req.query.perspective
      : DEFAULT_MATCH_PERSPECTIVE;
    const selectedHero = readSelectedHero(req.query.selectedHero);
    const targetRankDivisionIndex = await chooseMatchmakingRankBand({
      mode: 'quick_play',
      playerRating: context.competitiveRating,
      playerDivisionIndex: context.rankDivisionIndex,
      gameplayMode,
      botFillMode,
      matchPerspective,
      selectedHero,
    });
    res.json(issueQuickPlayTicket(context, targetRankDivisionIndex, {
      gameplayMode,
      botFillMode,
      matchPerspective,
      selectedHero,
    }));
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
    assertTutorialCompleted(context.tutorialCompletedAt, {
      devBypass: req.headers[DEV_TUTORIAL_BYPASS_HEADER],
    });
    if (!context.walletAddress) {
      throw Object.assign(new Error('A linked Solana wallet is required for ranked'), { statusCode: 400 });
    }

    const tokenHold = await assertRankedTokenHoldingEligibility(context.walletAddress);
    const selectedHero = readSelectedHero(req.body?.selectedHero);
    const targetRankDivisionIndex = await chooseMatchmakingRankBand({
      mode: 'ranked',
      playerRating: context.competitiveRating,
      playerDivisionIndex: context.rankDivisionIndex,
      matchPerspective: DEFAULT_MATCH_PERSPECTIVE,
      selectedHero,
    });
    res.json(issueRankedTicket(context, targetRankDivisionIndex, tokenHold, selectedHero));
  } catch (error) {
    console.error('[matchmaking] Failed to issue ranked ticket:', error);
    sendRouteError(res, error, 'Failed to issue ranked ticket');
  }
});

export default router;
