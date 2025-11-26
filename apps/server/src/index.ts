import express from 'express';
import { createServer } from 'http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { GameRoom } from './rooms/GameRoom';

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

// Register game room
gameServer.define('game_room', GameRoom);

// Health check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// CORS for development
app.use((_req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
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

