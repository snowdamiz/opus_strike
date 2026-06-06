import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'http';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';
import { LobbyRoom } from './rooms/LobbyRoom';
import authRoutes from './auth/routes';

const app = express();
const httpServer = createServer(app);

// Create Colyseus server
const gameServer = new Server({
  transport: new WebSocketTransport({
    server: httpServer,
    pingInterval: 5000,
    pingMaxRetries: 3,
  }),
});

// Register rooms
gameServer.define('game_room', GameRoom);
gameServer.define('lobby_room', LobbyRoom).enableRealtimeListing();

// CORS configuration - MUST be before routes
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

app.use((_req, res, next) => {
  const origin = _req.headers.origin;
  
  // Allow configured origins or all in development
  if (origin && (ALLOWED_ORIGINS.includes(origin) || process.env.NODE_ENV !== 'production')) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

interface LobbySummary {
  roomId: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  humanCount: number;
  botCount: number;
  participantCount: number;
  maxParticipants: number;
  status: string;
}

async function getPublicLobbies(): Promise<LobbySummary[]> {
  const rooms = await matchMaker.query({ name: 'lobby_room' });
  return rooms
    .filter((room: any) => room.metadata?.isPublic !== false)
    .map((room: any) => ({
      roomId: room.roomId,
      name: room.metadata?.name || `Lobby ${room.roomId.slice(0, 6)}`,
      playerCount: room.metadata?.humanCount ?? room.clients,
      maxPlayers: room.metadata?.maxPlayers ?? room.maxClients,
      humanCount: room.metadata?.humanCount ?? room.clients,
      botCount: room.metadata?.botCount ?? 0,
      participantCount: room.metadata?.participantCount ?? room.clients,
      maxParticipants: room.metadata?.maxParticipants ?? room.maxClients,
      status: room.metadata?.status || 'waiting',
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

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                     SLOP HEROES SERVER                     ║
╠═══════════════════════════════════════════════════════════╣
║  WebSocket:  ws://localhost:${PORT}                          ║
║  Health:     http://localhost:${PORT}/health                 ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  gameServer.gracefullyShutdown();
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  gameServer.gracefullyShutdown();
});
