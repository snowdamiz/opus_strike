import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { Client, type Room } from 'colyseus.js';
import { DEFAULT_GAME_CONFIG } from '@voxel-strike/shared';

interface ManagedServer {
  name: string;
  port: number;
  child: ChildProcess;
  killed: boolean;
}

interface HealthPayload {
  status: string;
  process: {
    pid: number;
    colyseusProcessId: string;
    publicAddress: string | null;
  };
  colyseus: {
    localRoomCount: number;
    visibleLobbyRoomCount: number;
  };
}

interface QuickPlayTicketResponse {
  ticket: string;
}

interface QueueStatusResponse {
  totalPlayersInQueue: number;
  queueCount: number;
  requiredPlayers?: number;
}

interface GameStartingMessage {
  gameRoomId: string;
  entryTicket: string;
}

const repoRoot = resolve(__dirname, '../../../..');
const serverDir = resolve(repoRoot, 'apps/server');
const redisUrl = process.env.COLYSEUS_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';
const portA = Number(process.env.HARNESS_PORT_A || 2567);
const portB = Number(process.env.HARNESS_PORT_B || 2568);
const playerCount = Number(process.env.HARNESS_PLAYER_COUNT || DEFAULT_GAME_CONFIG.maxPlayers);

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function startServer(name: string, port: number): ManagedServer {
  const child = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
    cwd: serverDir,
    env: {
      ...process.env,
      PORT: String(port),
      COLYSEUS_DISTRIBUTED: '1',
      COLYSEUS_REDIS_URL: redisUrl,
      COLYSEUS_PUBLIC_ADDRESS: `localhost:${port}`,
      JWT_SECRET: process.env.JWT_SECRET || 'cross-process-harness-jwt-secret',
      ENTRY_TICKET_SECRET: process.env.ENTRY_TICKET_SECRET || 'cross-process-harness-entry-secret',
      ENABLE_DEV_TOOLS: 'true',
      ALLOW_GUEST_PLAY: 'true',
      WAGER_SOL_ENABLED: 'false',
      LOG_LEVEL: process.env.LOG_LEVEL || 'warn',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[server ${name}] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[server ${name}] ${chunk}`);
  });

  return { name, port, child, killed: false };
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function waitFor<T>(label: string, timeoutMs: number, poll: () => Promise<T | null>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const value = await poll();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }

  throw new Error(`${label} timed out${lastError instanceof Error ? `: ${lastError.message}` : ''}`);
}

async function waitForHealth(server: ManagedServer): Promise<HealthPayload> {
  return waitFor(`server ${server.name} health`, 30_000, async () => {
    const health = await requestJson<HealthPayload>(`http://localhost:${server.port}/health`);
    return health.status === 'ok' ? health : null;
  });
}

function waitForMessage<T>(room: Room, type: string, timeoutMs: number): Promise<T> {
  return new Promise((resolveMessage, reject) => {
    const remove = room.onMessage<T>(type, (message) => {
      clearTimeout(timer);
      remove?.();
      resolveMessage(message);
    }) as (() => void) | undefined;

    const timer = setTimeout(() => {
      remove?.();
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
  });
}

function waitForLeave(room: Room, timeoutMs: number): Promise<void> {
  return new Promise((resolveLeave, reject) => {
    const timer = setTimeout(() => {
      room.onLeave.remove(onLeave);
      reject(new Error(`Timed out waiting for room ${room.roomId} to close`));
    }, timeoutMs);
    const onLeave = () => {
      clearTimeout(timer);
      resolveLeave();
    };
    room.onLeave.once(onLeave);
  });
}

async function killServer(server: ManagedServer, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
  if (server.killed || server.child.exitCode !== null) return;
  server.killed = true;
  server.child.kill(signal);

  await Promise.race([
    new Promise<void>((resolveExit) => server.child.once('exit', () => resolveExit())),
    delay(8_000).then(() => {
      if (server.child.exitCode === null) {
        server.child.kill('SIGKILL');
      }
    }),
  ]);
}

function inputPayload(tick: number): Record<string, unknown> {
  return {
    tick,
    timestamp: Date.now(),
    moveForward: tick % 2 === 0,
    moveBackward: false,
    moveLeft: false,
    moveRight: tick % 2 === 1,
    jump: false,
    crouch: false,
    sprint: false,
    primaryFire: false,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
    interact: false,
    lookYaw: 0,
    lookPitch: 0,
  };
}

async function issueQuickPlayTicket(port: number): Promise<string> {
  const response = await requestJson<QuickPlayTicketResponse>(`http://localhost:${port}/matchmaking/quick-play-ticket`);
  assert.ok(response.ticket, `expected quick-play ticket from ${port}`);
  return response.ticket;
}

async function assertQueueVisibleFromBothServers(minPlayers: number): Promise<void> {
  const [statusA, statusB] = await Promise.all([
    requestJson<QueueStatusResponse>(`http://localhost:${portA}/matchmaking/queue-status?mode=quick_play`),
    requestJson<QueueStatusResponse>(`http://localhost:${portB}/matchmaking/queue-status?mode=quick_play`),
  ]);
  assert.ok(statusA.queueCount >= 1, 'server A should see the shared quick-play queue');
  assert.ok(statusB.queueCount >= 1, 'server B should see the shared quick-play queue');
  assert.ok(statusA.totalPlayersInQueue >= minPlayers, 'server A should see queued players');
  assert.ok(statusB.totalPlayersInQueue >= minPlayers, 'server B should see queued players');
}

async function findSingleGameOwner(serverA: ManagedServer, serverB: ManagedServer): Promise<ManagedServer> {
  return waitFor('single game-room owner', 10_000, async () => {
    const [healthA, healthB] = await Promise.all([
      requestJson<HealthPayload>(`http://localhost:${serverA.port}/health`),
      requestJson<HealthPayload>(`http://localhost:${serverB.port}/health`),
    ]);

    if (healthA.colyseus.localRoomCount === 1 && healthB.colyseus.localRoomCount === 0) return serverA;
    if (healthB.colyseus.localRoomCount === 1 && healthA.colyseus.localRoomCount === 0) return serverB;
    return null;
  });
}

async function main(): Promise<void> {
  assert.notEqual(portA, portB, 'HARNESS_PORT_A and HARNESS_PORT_B must be different');
  assert.ok(Number.isInteger(playerCount) && playerCount > 1, 'HARNESS_PLAYER_COUNT must be an integer greater than 1');

  const serverA = startServer('A', portA);
  const serverB = startServer('B', portB);
  const servers = [serverA, serverB];
  const lobbyRooms: Room[] = [];
  const gameRooms: Room[] = [];
  const mapVoteStartedMessages: Array<Promise<unknown>> = [];

  try {
    await Promise.all(servers.map(waitForHealth));

    const endpoints = Array.from({ length: playerCount }, (_, index) => {
      const port = index % 2 === 0 ? portA : portB;
      return { port, client: new Client(`ws://localhost:${port}`) };
    });

    for (let index = 0; index < endpoints.length; index++) {
      const entry = endpoints[index];
      const ticket = await issueQuickPlayTicket(entry.port);
      const room = await entry.client.joinOrCreate('lobby_room', {
        playerName: `Harness ${index + 1}`,
        matchmakingMode: true,
        matchMode: 'quick_play',
        matchmakingTicket: ticket,
        clientId: `cross-process-harness-${index + 1}`,
      });
      room.onMessage('*', () => undefined);
      lobbyRooms.push(room);
      mapVoteStartedMessages.push(waitForMessage(room, 'mapVoteStarted', 20_000).catch(() => null));
      if (index === 0) {
        await assertQueueVisibleFromBothServers(1);
      }
    }

    const lobbyRoomIds = new Set(lobbyRooms.map((room) => room.roomId));
    assert.equal(lobbyRoomIds.size, 1, `expected one shared lobby, got ${Array.from(lobbyRoomIds).join(', ')}`);
    const lobbyRoomId = lobbyRooms[0].roomId;

    assert.ok(await Promise.race(mapVoteStartedMessages), 'expected at least one client to receive mapVoteStarted');

    const gameStartingMessages = lobbyRooms.map((room) => waitForMessage<GameStartingMessage>(room, 'gameStarting', 15_000));
    const timerStarted = waitForMessage(lobbyRooms[0], 'mapVoteTimerStarted', 5_000);
    for (const room of lobbyRooms) {
      room.send('mapVotePreviewsReady');
    }
    await timerStarted;
    lobbyRooms[0].send('finalizeMapVote');

    const starts = await Promise.all(gameStartingMessages);
    const gameRoomIds = new Set(starts.map((message) => message.gameRoomId));
    assert.equal(gameRoomIds.size, 1, `expected one game room, got ${Array.from(gameRoomIds).join(', ')}`);
    const gameRoomId = starts[0].gameRoomId;

    for (let index = 0; index < endpoints.length; index++) {
      const room = await endpoints[index].client.joinById(gameRoomId, {
        playerName: `Harness ${index + 1}`,
        clientId: `cross-process-harness-game-${index + 1}`,
        entryTicket: starts[index].entryTicket,
      });
      room.onMessage('*', () => undefined);
      gameRooms.push(room);
    }

    await delay(500);
    for (let tick = 1; tick <= 5; tick++) {
      for (const room of gameRooms) {
        room.send('input', inputPayload(tick));
      }
      await delay(50);
    }

    const owner = await findSingleGameOwner(serverA, serverB);
    const nonOwner = owner === serverA ? serverB : serverA;
    await killServer(nonOwner);

    for (let tick = 6; tick <= 8; tick++) {
      for (const room of gameRooms) {
        assert.equal(room.connection.isOpen, true, 'game connection should remain open after non-owner shutdown');
        room.send('input', inputPayload(tick));
      }
      await delay(50);
    }

    const leavePromises = gameRooms.map((room) => waitForLeave(room, 10_000));
    await killServer(owner);
    await Promise.all(leavePromises);

    console.log(JSON.stringify({
      ok: true,
      lobbyRoomId,
      gameRoomId,
      gameOwnerPort: owner.port,
      nonOwnerPort: nonOwner.port,
    }, null, 2));
  } finally {
    await Promise.all(servers.map((server) => killServer(server).catch(() => undefined)));
    await Promise.all(lobbyRooms.map((room) => room.leave(true).catch(() => undefined)));
    await Promise.all(gameRooms.map((room) => room.leave(true).catch(() => undefined)));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
