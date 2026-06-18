import 'dotenv/config';
import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
import { LobbyRoom } from './rooms/LobbyRoom';
import { PartyRoom } from './rooms/PartyRoom';
import authRoutes from './auth/routes';
import createAdminRouter from './admin/routes';
import matchmakingRoutes from './matchmaking/routes';
import socialRoutes from './social/routes';
import wagerRoutes from './wagers/routes';
import { voiceService } from './voice/VoiceService';
import { wagerService } from './wagers/service';
import {
  createDistributedColyseusOptions,
  getColyseusRuntimeConfig,
  validateColyseusRuntimeConfig,
} from './config/colyseus';
import { closeSharedRedisClient, getSharedRedisClient, pingRedis } from './config/redis';
import { getAllowedClientOrigins, isCorsOriginAllowed } from './config/clientOrigins';
import { envFlag } from './config/security';
import {
  installFlyReplayUpgradeRouter,
  registerFlyReplayProcessRoute,
  type FlyReplayProcessRouteHandle,
} from './runtime/flyReplayRouting';
import {
  collectAutoscalerMetricSnapshot,
  PROMETHEUS_CONTENT_TYPE,
  renderPrometheusMetrics,
} from './metrics/autoscalerMetrics';
import {
  startAdminMachineHeartbeat,
  type AdminMachineHeartbeatHandle,
} from './admin/machineRegistry';
import { getCachedGlobalNotification } from './notifications/globalNotificationService';
import { loggers } from './utils/logger';

const app = express();
const httpServer = createServer(app);
const colyseusRuntime = getColyseusRuntimeConfig();
validateColyseusRuntimeConfig(colyseusRuntime);
const sharedRedisClient = colyseusRuntime.distributed ? getSharedRedisClient(colyseusRuntime) : null;
let flyReplayRouteHandle: FlyReplayProcessRouteHandle | null = null;
let adminMachineHeartbeatHandle: AdminMachineHeartbeatHandle | null = null;

function getAutoscalerMetricLabels() {
  return {
    colyseusProcessId: matchMaker.processId,
    flyMachineId: colyseusRuntime.flyReplay.machineId,
    flyRegion: colyseusRuntime.flyReplay.region,
  };
}

function configureTrustProxy(): void {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw) return;

  if (raw === '1' || raw.toLowerCase() === 'true') {
    app.set('trust proxy', 1);
    return;
  }
  if (raw === '0' || raw.toLowerCase() === 'false') {
    app.set('trust proxy', false);
    return;
  }

  const hops = Number(raw);
  app.set('trust proxy', Number.isInteger(hops) && hops >= 0 ? hops : raw);
}

configureTrustProxy();

// Create Colyseus server
const gameServer = new Server({
  ...createDistributedColyseusOptions(colyseusRuntime),
  selectProcessIdToCreateRoom: colyseusRuntime.roomCreateStrategy === 'local'
    ? async () => matchMaker.processId
    : undefined,
  gracefullyShutdown: false,
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 5000,
    pingMaxRetries: 3,
  }),
});

// Register rooms
gameServer.define('game_room', GameRoom);
gameServer
  .define('party_room', PartyRoom)
  .enableRealtimeListing();
gameServer
  .define('lobby_room', LobbyRoom)
  .filterBy(['isPrivate', 'matchmakingMode', 'matchMode', 'rankBandId'])
  .sortBy({ clients: -1 })
  .enableRealtimeListing();

installFlyReplayUpgradeRouter({
  server: httpServer,
  config: colyseusRuntime,
  redis: sharedRedisClient,
  getLocalProcessId: () => matchMaker.processId,
});

// CORS configuration - MUST be before routes
const ALLOWED_ORIGINS = getAllowedClientOrigins();

app.use((_req, res, next) => {
  const origin = typeof _req.headers.origin === 'string' ? _req.headers.origin : undefined;
  res.vary('Origin');

  // Allow configured origins or all in development
  if (isCorsOriginAllowed(origin, ALLOWED_ORIGINS)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-CSRF-Token, X-Internal-Status-Token, X-Wager-Admin-Token');
  res.header('Access-Control-Allow-Credentials', 'true');

  // Handle preflight requests
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// Cookie parser middleware
app.use(cookieParser());

// JSON body parser
app.use(express.json());

// Auth routes
app.use('/auth', authRoutes);
app.use('/matchmaking', matchmakingRoutes);
app.use('/social', socialRoutes);
app.use('/wagers', wagerRoutes);
app.use('/admin', createAdminRouter({
  config: colyseusRuntime,
  matchMaker,
  redis: sharedRedisClient,
  flyReplayRegistered: () => Boolean(flyReplayRouteHandle),
}));

app.get('/notifications/global', async (req, res) => {
  try {
    const { notification, etag } = await getCachedGlobalNotification();
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.json({ notification });
  } catch (error) {
    loggers.room.error('Failed to load global notification', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to load global notification' });
  }
});

function configuredStatusToken(): string {
  return process.env.INTERNAL_STATUS_TOKEN
    || process.env.METRICS_TOKEN
    || process.env.STATUS_TOKEN
    || '';
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function readStatusAuthToken(req: Request): string {
  const header = req.headers['x-internal-status-token'];
  if (typeof header === 'string' && header.trim()) return header.trim();

  const authorization = req.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  return '';
}

function canReadDetailedStatus(req: Request): boolean {
  if (envFlag('PUBLIC_STATUS_ENDPOINTS', process.env.NODE_ENV !== 'production')) return true;
  const expected = configuredStatusToken();
  const actual = readStatusAuthToken(req);
  return Boolean(expected && actual && timingSafeStringEqual(actual, expected));
}

function hideStatusEndpoint(res: Response): void {
  res.status(404).type('text').send('Not found');
}

async function collectDetailedHealth() {
  const redis = await pingRedis(sharedRedisClient);
  const autoscalerMetrics = await collectAutoscalerMetricSnapshot({
    matchMaker,
    redisStatus: redis,
    flyReplayRegistered: Boolean(flyReplayRouteHandle),
    labels: getAutoscalerMetricLabels(),
  });
  const matchmakerQueryHealthy = autoscalerMetrics.matchmakerQueryUp === 1;

  const healthy = (!colyseusRuntime.distributed || redis.ok) && matchmakerQueryHealthy;

  return {
    healthy,
    body: {
    status: healthy ? 'ok' : 'degraded',
    process: {
      pid: process.pid,
      colyseusProcessId: matchMaker.processId,
      publicAddress: colyseusRuntime.publicAddress ?? null,
      flyMachineId: colyseusRuntime.flyReplay.machineId ?? null,
      flyRegion: colyseusRuntime.flyReplay.region ?? null,
    },
    distributed: {
      enabled: colyseusRuntime.distributed,
      redisConfigured: Boolean(colyseusRuntime.redisUrl),
      requirePublicAddress: colyseusRuntime.requirePublicAddress,
      redis,
    },
    routing: {
      strategy: colyseusRuntime.routingStrategy,
      roomCreateStrategy: colyseusRuntime.roomCreateStrategy,
      flyReplay: {
        enabled: colyseusRuntime.flyReplay.enabled,
        appName: colyseusRuntime.flyReplay.appName ?? null,
        machineId: colyseusRuntime.flyReplay.machineId ?? null,
        region: colyseusRuntime.flyReplay.region ?? null,
        registered: Boolean(flyReplayRouteHandle),
        processRegistryTtlMs: colyseusRuntime.flyReplay.processRegistryTtlMs,
        processRegistryHeartbeatMs: colyseusRuntime.flyReplay.processRegistryHeartbeatMs,
        replayTimeout: colyseusRuntime.flyReplay.replayTimeout,
        replayFallback: colyseusRuntime.flyReplay.replayFallback,
      },
    },
    colyseus: {
      localRoomCount: autoscalerMetrics.localRoomCount,
      localCcu: autoscalerMetrics.localCcu,
      visibleLobbyRoomCount: autoscalerMetrics.visibleLobbyCount,
      lobbyParticipants: autoscalerMetrics.lobbyParticipants,
      matchmakerQueryHealthy,
      matchmakerError: autoscalerMetrics.matchmakerError,
    },
    },
  };
}

// Public liveness endpoint. Detailed internals require an internal status token in production.
app.get('/health', async (req, res) => {
  if (!canReadDetailedStatus(req)) {
    res.json({ status: 'ok' });
    return;
  }

  const health = await collectDetailedHealth();
  res.status(health.healthy ? 200 : 503).json(health.body);
});

app.get('/metrics', async (req, res) => {
  if (!canReadDetailedStatus(req)) {
    hideStatusEndpoint(res);
    return;
  }

  const redis = await pingRedis(sharedRedisClient);
  const autoscalerMetrics = await collectAutoscalerMetricSnapshot({
    matchMaker,
    redisStatus: redis,
    flyReplayRegistered: Boolean(flyReplayRouteHandle),
    labels: getAutoscalerMetricLabels(),
  });

  res.header('Content-Type', PROMETHEUS_CONTENT_TYPE);
  res.send(renderPrometheusMetrics(autoscalerMetrics));
});

app.get('/voice/status', (req, res) => {
  if (!canReadDetailedStatus(req)) {
    hideStatusEndpoint(res);
    return;
  }

  res.json(voiceService.getStatus());
});

interface LobbySummary {
  roomId: string;
  name: string;
  matchMode?: string;
  playerCount: number;
  maxPlayers: number;
  humanCount: number;
  botCount: number;
  participantCount: number;
  maxParticipants: number;
  status: string;
  queuedHumanCount?: number;
  requiredPlayers?: number;
  wager?: {
    enabled: boolean;
    matchMode?: string;
    rankedEntryQuoteId?: string | null;
    status?: string;
    token?: string;
    coverChargeLamports?: string;
    potLamports?: string;
    paidPlayerCount?: number;
    treasuryWallet?: string;
  };
}

async function getPublicLobbies(): Promise<LobbySummary[]> {
  const rooms = await matchMaker.query({ name: 'lobby_room' });
  return rooms
    .filter((room: any) => room.metadata?.isPublic !== false)
    .map((room: any) => ({
      roomId: room.roomId,
      name: room.metadata?.name || `Lobby ${room.roomId.slice(0, 6)}`,
      matchMode: room.metadata?.matchMode,
      playerCount: room.metadata?.humanCount ?? room.clients,
      maxPlayers: room.metadata?.maxPlayers ?? room.maxClients,
      humanCount: room.metadata?.humanCount ?? room.clients,
      botCount: room.metadata?.botCount ?? 0,
      participantCount: room.metadata?.participantCount ?? room.clients,
      maxParticipants: room.metadata?.maxParticipants ?? room.maxClients,
      status: room.metadata?.status || 'waiting',
      queuedHumanCount: room.metadata?.queuedHumanCount,
      requiredPlayers: room.metadata?.requiredPlayers,
      wager: {
        enabled: room.metadata?.wagerEnabled === true,
        matchMode: room.metadata?.matchMode,
        rankedEntryQuoteId: room.metadata?.rankedEntryQuoteId,
        status: room.metadata?.wagerStatus,
        token: room.metadata?.wagerToken,
        coverChargeLamports: room.metadata?.wagerCoverChargeLamports,
        potLamports: room.metadata?.wagerPotLamports,
        paidPlayerCount: room.metadata?.wagerPaidPlayerCount,
        treasuryWallet: room.metadata?.wagerTreasuryWallet,
      },
    }));
}

// List available lobbies
app.get('/lobbies', async (_req, res) => {
  try {
    res.json({ lobbies: await getPublicLobbies() });
  } catch (error) {
    console.error('Failed to list lobbies:', error);
    res.status(500).json({ error: 'Failed to list lobbies' });
  }
});

// Push lobby list changes to clients so the browser does not need manual refreshes.
app.get('/lobbies/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let lastPayload = '';

  const pushIfChanged = async () => {
    try {
      const payload = JSON.stringify({ lobbies: await getPublicLobbies() });
      if (payload !== lastPayload) {
        lastPayload = payload;
        res.write(`event: lobbies\ndata: ${payload}\n\n`);
      }
    } catch (error) {
      console.error('Failed to stream lobbies:', error);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to list lobbies' })}\n\n`);
    }
  };

  await pushIfChanged();
  const interval = setInterval(pushIfChanged, 1000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

const PORT = parseInt(process.env.PORT || '2567', 10);

async function startServer(): Promise<void> {
  try {
    if (colyseusRuntime.flyReplay.enabled) {
      if (!sharedRedisClient) throw new Error('Fly replay routing requires Redis');
      flyReplayRouteHandle = await registerFlyReplayProcessRoute(
        sharedRedisClient,
        colyseusRuntime,
        matchMaker.processId
      );
    }

    if (sharedRedisClient) {
      adminMachineHeartbeatHandle = startAdminMachineHeartbeat({
        redis: sharedRedisClient,
        config: colyseusRuntime,
        matchMaker,
        flyReplayRegistered: () => Boolean(flyReplayRouteHandle),
      });
    }

    await gameServer.listen(PORT);
  } catch (error) {
    await adminMachineHeartbeatHandle?.close();
    adminMachineHeartbeatHandle = null;
    await flyReplayRouteHandle?.close();
    flyReplayRouteHandle = null;
    throw error;
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                     SLOP HEROES SERVER                     ║
╠═══════════════════════════════════════════════════════════╣
║  WebSocket:  ws://localhost:${PORT}                          ║
║  Health:     http://localhost:${PORT}/health                 ║
║  Distributed:${colyseusRuntime.distributed ? ' enabled ' : ' disabled'}                              ║
╚═══════════════════════════════════════════════════════════╝
  `);

  if (colyseusRuntime.distributed) {
    loggers.room.info('Colyseus distributed runtime enabled', {
      publicAddress: colyseusRuntime.publicAddress ?? null,
      redisUrlConfigured: Boolean(colyseusRuntime.redisUrl),
      routingStrategy: colyseusRuntime.routingStrategy,
      roomCreateStrategy: colyseusRuntime.roomCreateStrategy,
      flyMachineId: colyseusRuntime.flyReplay.machineId ?? null,
      processId: matchMaker.processId,
      pid: process.pid,
    });
  }

  wagerService.startBackgroundJobs();
}

let shutdownStarted = false;

async function shutdown(signal: string): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;

  loggers.room.info('Graceful shutdown starting', {
    signal,
    processId: matchMaker.processId,
    pid: process.pid,
  });

  try {
    wagerService.stopBackgroundJobs();
    await adminMachineHeartbeatHandle?.close();
    adminMachineHeartbeatHandle = null;
    await flyReplayRouteHandle?.close();
    flyReplayRouteHandle = null;
    await gameServer.gracefullyShutdown(false);
    await closeSharedRedisClient();
    loggers.room.info('Graceful shutdown finished', {
      signal,
      processId: matchMaker.processId,
      pid: process.pid,
    });
    process.exit(0);
  } catch (error) {
    loggers.room.error('Graceful shutdown failed', {
      signal,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

startServer().catch((error) => {
  loggers.room.error('Failed to start server', error);
  process.exit(1);
});
