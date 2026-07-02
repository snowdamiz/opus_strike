import { Router, type Request, type Response } from 'express';
import {
  createAdminCsrfToken,
  ensureGameAdmin,
  ensureGameAdminMutation,
  noStore,
  type GameAdminUser,
} from '../auth/gameAdmin';
import { consumeRateLimitForKey } from '../auth/rateLimit';
import { loggers } from '../utils/logger';
import {
  getNextStreamerTarget,
  getStreamerSessionStatus,
  stopStreamerSession,
  type StreamerFeedMode,
  type StreamerMatchMaker,
} from './service';

interface StreamerRouterOptions {
  matchMaker: StreamerMatchMaker;
}

const STREAMER_MUTATION_RATE_LIMIT = {
  limit: 30,
  windowMs: 60 * 1000,
};

function readCurrentRoomId(req: Request): string | null {
  const value = req.body?.currentRoomId;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : null;
}

function readClientBuildId(req: Request): string | null {
  const value = req.body?.clientBuildId;
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 128) : null;
}

function readAuthToken(req: Request): string | null {
  const value = req.cookies?.auth_token;
  return typeof value === 'string' && value.trim() ? value : null;
}

function readFeedMode(req: Request): StreamerFeedMode {
  return req.body?.feedMode === 'bot_deathmatch' ? 'bot_deathmatch' : 'random';
}

function enforceStreamerMutationRateLimit(req: Request, res: Response, adminUser: GameAdminUser): boolean {
  const result = consumeRateLimitForKey(`admin:${adminUser.id}`, {
    keyPrefix: `streamer:${req.path}`,
    ...STREAMER_MUTATION_RATE_LIMIT,
  });
  if (result.ok) return true;

  res.setHeader('Retry-After', result.retryAfterSeconds.toString());
  res.status(429).json({ error: 'Too many streamer requests' });
  return false;
}

export function createStreamerRouter(options: StreamerRouterOptions): Router {
  const router = Router();

  router.get('/status', ensureGameAdmin, async (_req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    try {
      const status = await getStreamerSessionStatus({
        adminUserId: adminUser.id,
        matchMaker: options.matchMaker,
      });
      res.json({
        allowed: true,
        currentRoomId: status.currentRoomId,
        fallbackBotGame: status.fallbackBotGame,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.error('Failed to load streamer status', {
        adminUserId: adminUser.id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'Failed to load streamer status' });
    }
  });

  router.post('/next', ensureGameAdmin, ensureGameAdminMutation, async (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    if (!enforceStreamerMutationRateLimit(req, res, adminUser)) return;

    try {
      const target = await getNextStreamerTarget({
        adminUserId: adminUser.id,
        matchMaker: options.matchMaker,
        currentRoomId: readCurrentRoomId(req),
        clientBuildId: readClientBuildId(req),
        authToken: readAuthToken(req),
        feedMode: readFeedMode(req),
      });
      res.json({
        target,
        csrfToken: createAdminCsrfToken(adminUser),
      });
    } catch (error) {
      loggers.room.error('Failed to resolve streamer target', {
        adminUserId: adminUser.id,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(503).json({ error: 'Failed to resolve streamer target' });
    }
  });

  router.post('/stop', ensureGameAdmin, ensureGameAdminMutation, (req, res) => {
    noStore(res);
    const adminUser = res.locals.adminUser as GameAdminUser;
    if (!enforceStreamerMutationRateLimit(req, res, adminUser)) return;

    stopStreamerSession(adminUser.id);
    res.json({
      stopped: true,
      csrfToken: createAdminCsrfToken(adminUser),
    });
  });

  return router;
}
