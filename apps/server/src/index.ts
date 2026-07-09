import 'dotenv/config';
import crypto from 'node:crypto';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server, matchMaker, type ServerOptions } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
import { GlobalChatRoom } from './rooms/GlobalChatRoom';
import { LobbyRoom } from './rooms/LobbyRoom';
import { PartyRoom } from './rooms/PartyRoom';
import { SocialRoom } from './rooms/SocialRoom';
import authRoutes from './auth/routes';
import createAdminRouter from './admin/routes';
import cosmeticsRoutes from './cosmetics/routes';
import matchmakingRoutes from './matchmaking/routes';
import { createMapRouter } from './maps/routes';
import {
  getPregeneratedMapPoolAutoTopUpConfig,
  startPregeneratedMapPoolAutoTopUp,
  type MapPoolAutoTopUpRedisClient,
  type PregeneratedMapPoolAutoTopUpHandle,
} from './maps/pregeneratedMapPoolAutoTopUp';
import missionsRoutes from './missions/routes';
import rewardsRoutes from './rewards/routes';
import socialRoutes from './social/routes';
import wagersRoutes from './wagers/routes';
import { createStreamerRouter } from './streamer/routes';
import { createRecordingsRouter } from './recordings/routes';
import { dailyMissionService } from './missions/service';
import { playerRewardService } from './rewards/service';
import { wagerService } from './wagers/service';
import type { RedisOwnerLockClient } from './wagers/workerLock';
import { voiceService } from './voice/VoiceService';
import {
  createDistributedColyseusOptions,
  getColyseusRuntimeConfig,
  selectLeastLoadedColyseusProcess,
  shouldCreateRoomOnLocalColyseusProcess,
  validateColyseusRuntimeConfig,
} from './config/colyseus';
import {
  assertRedisAvailableForDistributedRuntime,
  closeSharedRedisClient,
  getSharedRedisClient,
  pingRedis,
} from './config/redis';
import { getAllowedClientOrigins, isCorsOriginAllowed } from './config/clientOrigins';
import { ALLOWED_CORS_HEADER_VALUE, ALLOWED_CORS_METHOD_VALUE } from './config/corsHeaders';
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
let gameServer: Server | null = null;
let flyReplayUpgradeRouterInstalled = false;
let flyReplayRouteHandle: FlyReplayProcessRouteHandle | null = null;
let adminMachineHeartbeatHandle: AdminMachineHeartbeatHandle | null = null;
let pregeneratedMapPoolAutoTopUpHandle: PregeneratedMapPoolAutoTopUpHandle | null = null;

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

const selectProcessIdToCreateRoom: NonNullable<ServerOptions['selectProcessIdToCreateRoom']> = async (
  roomName
) => {
  if (shouldCreateRoomOnLocalColyseusProcess({
    roomName,
    roomCreateStrategy: colyseusRuntime.roomCreateStrategy,
  })) {
    return matchMaker.processId;
  }

  return selectLeastLoadedColyseusProcess(await matchMaker.stats.fetchAll(), matchMaker.processId);
};

function createGameServer(): Server {
  const server = new Server({
    ...createDistributedColyseusOptions(colyseusRuntime),
    selectProcessIdToCreateRoom,
    gracefullyShutdown: false,
    transport: new WebSocketTransport({
      server: httpServer,
      maxPayload: colyseusRuntime.webSocketMaxPayloadBytes,
      pingInterval: 5000,
      pingMaxRetries: 3,
    }),
  });

  server.define('game_room', GameRoom);
  server.define('global_chat_room', GlobalChatRoom);
  server
    .define('party_room', PartyRoom)
    .enableRealtimeListing();
  server.define('social_room', SocialRoom);
  server
    .define('lobby_room', LobbyRoom)
    .filterBy(['isPrivate', 'matchmakingMode', 'matchMode', 'rankBandId', 'gameplayMode', 'matchmakingRegion'])
    .sortBy({ clients: -1 })
    .enableRealtimeListing();

  return server;
}

function getGameServer(): Server {
  if (!gameServer) {
    gameServer = createGameServer();
  }

  return gameServer;
}

function installRuntimeUpgradeRouter(): void {
  if (flyReplayUpgradeRouterInstalled) return;

  installFlyReplayUpgradeRouter({
    server: httpServer,
    config: colyseusRuntime,
    redis: sharedRedisClient,
    getLocalProcessId: () => matchMaker.processId,
  });
  flyReplayUpgradeRouterInstalled = true;
}

// CORS configuration - MUST be before routes
const ALLOWED_ORIGINS = getAllowedClientOrigins();

app.use((_req, res, next) => {
  const origin = typeof _req.headers.origin === 'string' ? _req.headers.origin : undefined;
  res.vary('Origin');

  // Allow configured origins or all in development
  if (isCorsOriginAllowed(origin, ALLOWED_ORIGINS)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Methods', ALLOWED_CORS_METHOD_VALUE);
  res.header('Access-Control-Allow-Headers', ALLOWED_CORS_HEADER_VALUE);
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
app.use('/cosmetics', cosmeticsRoutes);
app.use('/matchmaking', matchmakingRoutes);
app.use('/maps', createMapRouter());
app.use('/missions', missionsRoutes);
app.use('/rewards', rewardsRoutes);
app.use('/social', socialRoutes);
app.use('/wagers', wagersRoutes);
app.use('/streamer', createStreamerRouter({ matchMaker }));
app.use('/recordings', createRecordingsRouter({
  matchMaker,
  showcaseJobStore: { redis: sharedRedisClient },
  config: colyseusRuntime,
}));
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

// Public liveness endpoint. Keep this independent from Redis/matchmaker
// readiness so Fly does not restart a serving process during transient
// dependency lag or when detailed status endpoints are public.
app.get('/health', async (_req, res) => {
  res.json({ status: 'ok' });
});

// Detailed internals require an internal status token in production unless
// PUBLIC_STATUS_ENDPOINTS is explicitly enabled.
app.get('/health/details', async (req, res) => {
  if (!canReadDetailedStatus(req)) {
    hideStatusEndpoint(res);
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
    await assertRedisAvailableForDistributedRuntime(colyseusRuntime);
    const server = getGameServer();
    installRuntimeUpgradeRouter();

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

    await server.listen(PORT);
    wagerService.startBackgroundJobs();
    playerRewardService.startBackgroundJobs(sharedRedisClient as RedisOwnerLockClient | null);
    dailyMissionService.startBackgroundJobs();
    pregeneratedMapPoolAutoTopUpHandle = startPregeneratedMapPoolAutoTopUp({
      config: getPregeneratedMapPoolAutoTopUpConfig(),
      runtime: {
        config: colyseusRuntime,
        matchMaker,
        flyReplayRegistered: () => Boolean(flyReplayRouteHandle),
      },
      redis: sharedRedisClient as MapPoolAutoTopUpRedisClient | null,
    });
  } catch (error) {
    pregeneratedMapPoolAutoTopUpHandle?.close();
    pregeneratedMapPoolAutoTopUpHandle = null;
    dailyMissionService.stopBackgroundJobs();
    playerRewardService.stopBackgroundJobs();
    wagerService.stopBackgroundJobs();
    await adminMachineHeartbeatHandle?.close();
    adminMachineHeartbeatHandle = null;
    await flyReplayRouteHandle?.close();
    flyReplayRouteHandle = null;
    if (gameServer) {
      await gameServer.gracefullyShutdown(false).catch((shutdownError) => {
        loggers.room.warn('Failed to shut down Colyseus after startup error', {
          error: shutdownError instanceof Error ? shutdownError.message : String(shutdownError),
        });
      });
      gameServer = null;
    }
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
      webSocketMaxPayloadBytes: colyseusRuntime.webSocketMaxPayloadBytes,
      flyMachineId: colyseusRuntime.flyReplay.machineId ?? null,
      processId: matchMaker.processId,
      pid: process.pid,
    });
  }

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
    dailyMissionService.stopBackgroundJobs();
    playerRewardService.stopBackgroundJobs();
    wagerService.stopBackgroundJobs();
    pregeneratedMapPoolAutoTopUpHandle?.close();
    pregeneratedMapPoolAutoTopUpHandle = null;
    await adminMachineHeartbeatHandle?.close();
    adminMachineHeartbeatHandle = null;
    await flyReplayRouteHandle?.close();
    flyReplayRouteHandle = null;
    await gameServer?.gracefullyShutdown(false);
    gameServer = null;
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
