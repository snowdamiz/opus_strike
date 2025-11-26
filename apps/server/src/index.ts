import 'dotenv/config';
import express from 'express';
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

// CORS for development - MUST be before routes
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  // Handle preflight requests
  if (_req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  next();
});

// JSON body parser
app.use(express.json());

// Auth routes
app.use('/auth', authRoutes);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// List available lobbies
app.get('/lobbies', async (_req, res) => {
  try {
    const rooms = await matchMaker.query({ name: 'lobby_room' });
    const lobbies = rooms
      .filter((room: any) => room.metadata?.isPublic !== false)
      .map((room: any) => ({
        roomId: room.roomId,
        name: room.metadata?.name || `Lobby ${room.roomId.slice(0, 6)}`,
        playerCount: room.clients,
        maxPlayers: room.maxClients,
        status: room.metadata?.status || 'waiting',
      }));
    res.json({ lobbies });
  } catch (error) {
    console.error('Failed to list lobbies:', error);
    res.status(500).json({ error: 'Failed to list lobbies' });
  }
});

const PORT = parseInt(process.env.PORT || '2567', 10);

httpServer.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                    VOXEL STRIKE SERVER                     ║
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

