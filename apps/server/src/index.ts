import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
import { LobbyRoom } from './rooms/LobbyRoom';
import authRoutes from './auth/routes';
import matchmakingRoutes from './matchmaking/routes';
import wagerRoutes from './wagers/routes';
import { voiceService } from './voice/VoiceService';
import { wagerService } from './wagers/service';
import {
  createDistributedColyseusOptions,
  getColyseusRuntimeConfig,
  validateColyseusRuntimeConfig,
} from './config/colyseus';
import { closeSharedRedisClient, getSharedRedisClient, pingRedis } from './config/redis';
import {
  installFlyReplayUpgradeRouter,
  registerFlyReplayProcessRoute,
  type FlyReplayProcessRouteHandle,
} from './runtime/flyReplayRouting';
import { loggers } from './utils/logger';

const app = express();
const httpServer = createServer(app);
const colyseusRuntime = getColyseusRuntimeConfig();
validateColyseusRuntimeConfig(colyseusRuntime);
const sharedRedisClient = colyseusRuntime.distributed ? getSharedRedisClient(colyseusRuntime) : null;
let flyReplayRouteHandle: FlyReplayProcessRouteHandle | null = null;

// Create Colyseus server
const gameServer = new Server({
  ...createDistributedColyseusOptions(colyseusRuntime),
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
  .define('lobby_room', LobbyRoom)
  .filterBy(['isPrivate', 'matchmakingMode', 'matchMode', 'rankBandId', 'rankedCoverChargeLamports'])
  .sortBy({ clients: -1 })
  .enableRealtimeListing();

installFlyReplayUpgradeRouter({
  server: httpServer,
  config: colyseusRuntime,
  redis: sharedRedisClient,
  getLocalProcessId: () => matchMaker.processId,
});

function readOriginList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

// CORS configuration - MUST be before routes
const ALLOWED_ORIGINS = Array.from(new Set([
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
  ...readOriginList(process.env.CLIENT_ORIGIN),
  ...readOriginList(process.env.CLIENT_URL),
  ...readOriginList(process.env.PUBLIC_CLIENT_ORIGIN),
  ...readOriginList(process.env.ALLOWED_ORIGINS),
]));

app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  
  // Allow configured origins or all in development
  if (origin && (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production')) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Wager-Admin-Token');
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
app.use('/wagers', wagerRoutes);

// Health check endpoint
app.get('/health', async (_req, res) => {
  const redis = await pingRedis(sharedRedisClient);
  let matchmakerQueryHealthy = true;
  let visibleLobbyRoomCount = 0;
  let matchmakerError: string | undefined;

  try {
    visibleLobbyRoomCount = (await matchMaker.query({ name: 'lobby_room' })).length;
  } catch (error) {
    matchmakerQueryHealthy = false;
    matchmakerError = error instanceof Error ? error.message : String(error);
  }

  const healthy = (!colyseusRuntime.distributed || redis.ok) && matchmakerQueryHealthy;

  res.status(healthy ? 200 : 503).json({
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
      localRoomCount: matchMaker.stats.local.roomCount,
      localCcu: matchMaker.stats.local.ccu,
      visibleLobbyRoomCount,
      matchmakerQueryHealthy,
      matchmakerError,
    },
  });
});

app.get('/voice/status', (_req, res) => {
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

    await gameServer.listen(PORT);
  } catch (error) {
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
