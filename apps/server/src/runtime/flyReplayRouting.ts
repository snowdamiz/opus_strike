import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { ColyseusRuntimeConfig } from '../config/colyseus';
import { loggers } from '../utils/logger';

export interface FlyReplayRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
}

export interface FlyReplayProcessRoute {
  processId: string;
  machineId: string;
  appName: string;
  region: string | null;
  publicAddress: string;
  pid: string;
  updatedAtMs: number;
}

export interface FlyReplayProcessRouteHandle {
  processId: string;
  machineId: string;
  close(): Promise<void>;
}

type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

const PROCESS_ROUTE_KEY_PREFIX = 'voxel-strike:colyseus:fly:process:';

const UPSERT_PROCESS_ROUTE_SCRIPT = `
redis.call("HSET", KEYS[1],
  "processId", ARGV[1],
  "machineId", ARGV[2],
  "appName", ARGV[3],
  "region", ARGV[4],
  "publicAddress", ARGV[5],
  "pid", ARGV[6],
  "ownerToken", ARGV[7],
  "updatedAtMs", ARGV[8])
redis.call("PEXPIRE", KEYS[1], ARGV[9])
return 1
`;

const DELETE_PROCESS_ROUTE_IF_OWNER_SCRIPT = `
if redis.call("HGET", KEYS[1], "ownerToken") == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function processRouteKey(processId: string): string {
  return `${PROCESS_ROUTE_KEY_PREFIX}${processId}`;
}

function numericField(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseColyseusProcessIdFromUrl(url: string | undefined): string | null {
  if (!url) return null;

  let parsed: URL;
  try {
    parsed = new URL(url, 'http://colyseus.local');
  } catch {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;

  const [processId, roomId] = segments;
  const idPattern = /^[a-zA-Z0-9_-]+$/;
  if (!idPattern.test(processId) || !idPattern.test(roomId)) return null;

  return processId;
}

export function buildFlyReplayHeader(
  machineId: string,
  config: ColyseusRuntimeConfig
): string {
  return `instance=${machineId};timeout=${config.flyReplay.replayTimeout};fallback=${config.flyReplay.replayFallback}`;
}

export async function lookupFlyReplayProcessRoute(
  redis: FlyReplayRedisClient,
  processId: string
): Promise<FlyReplayProcessRoute | null> {
  const route = await redis.hgetall(processRouteKey(processId));
  if (!route.machineId || !route.processId || route.processId !== processId) return null;

  return {
    processId: route.processId,
    machineId: route.machineId,
    appName: route.appName || '',
    region: route.region || null,
    publicAddress: route.publicAddress || '',
    pid: route.pid || '',
    updatedAtMs: numericField(route.updatedAtMs),
  };
}

export async function registerFlyReplayProcessRoute(
  redis: FlyReplayRedisClient,
  config: ColyseusRuntimeConfig,
  processId: string
): Promise<FlyReplayProcessRouteHandle> {
  if (!config.flyReplay.enabled) {
    throw new Error('registerFlyReplayProcessRoute requires fly_replay routing');
  }

  const machineId = config.flyReplay.machineId;
  const appName = config.flyReplay.appName;
  const publicAddress = config.publicAddress;

  if (!machineId || !appName || !publicAddress) {
    throw new Error('Fly replay process registration requires machine id, app name, and public address');
  }

  const ownerToken = `${process.pid}:${randomUUID()}`;
  const key = processRouteKey(processId);
  const refresh = async () => {
    await redis.eval(
      UPSERT_PROCESS_ROUTE_SCRIPT,
      1,
      key,
      processId,
      machineId,
      appName,
      config.flyReplay.region ?? '',
      publicAddress,
      String(process.pid),
      ownerToken,
      String(Date.now()),
      String(config.flyReplay.processRegistryTtlMs)
    );
  };

  await refresh();

  const heartbeat = setInterval(() => {
    refresh().catch((error) => {
      loggers.room.error('Failed to refresh Fly replay process route', {
        processId,
        machineId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, config.flyReplay.processRegistryHeartbeatMs);
  heartbeat.unref?.();

  loggers.room.info('Registered Colyseus process for Fly replay routing', {
    processId,
    machineId,
    appName,
    region: config.flyReplay.region ?? null,
    publicAddress,
    ttlMs: config.flyReplay.processRegistryTtlMs,
  });

  return {
    processId,
    machineId,
    close: async () => {
      clearInterval(heartbeat);
      await redis.eval(DELETE_PROCESS_ROUTE_IF_OWNER_SCRIPT, 1, key, ownerToken).catch((error) => {
        loggers.room.warn('Failed to remove Fly replay process route', {
          processId,
          machineId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    },
  };
}

function writeRawHttpResponse(
  socket: Duplex,
  statusLine: string,
  headers: Record<string, string>,
  body = ''
): void {
  if (socket.destroyed) return;

  const headerLines = Object.entries({
    ...headers,
    'content-length': String(Buffer.byteLength(body)),
    connection: 'close',
  }).map(([name, value]) => `${name}: ${value}`);

  socket.write(`${statusLine}\r\n${headerLines.join('\r\n')}\r\n\r\n${body}`);
  socket.end();
}

function writeFlyReplayResponse(socket: Duplex, machineId: string, config: ColyseusRuntimeConfig): void {
  writeRawHttpResponse(socket, 'HTTP/1.1 307 Temporary Redirect', {
    'fly-replay': buildFlyReplayHeader(machineId, config),
  });
}

function writeUpgradeError(socket: Duplex, statusCode: number, message: string): void {
  const reason = statusCode === 410 ? 'Gone' : 'Service Unavailable';
  writeRawHttpResponse(socket, `HTTP/1.1 ${statusCode} ${reason}`, {
    'content-type': 'application/json',
  }, JSON.stringify({ error: message }));
}

export async function handleFlyReplayUpgradeRequest(options: {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  config: ColyseusRuntimeConfig;
  redis: FlyReplayRedisClient;
  getLocalProcessId: () => string | undefined;
  passThrough: UpgradeListener;
}): Promise<void> {
  const targetProcessId = parseColyseusProcessIdFromUrl(options.request.url);
  if (!targetProcessId) {
    options.passThrough(options.request, options.socket, options.head);
    return;
  }

  const localProcessId = options.getLocalProcessId();
  if (targetProcessId === localProcessId) {
    options.passThrough(options.request, options.socket, options.head);
    return;
  }

  if (options.request.headers['fly-replay-failed']) {
    writeUpgradeError(options.socket, 503, 'Fly replay failed before reaching the room owner');
    return;
  }

  const route = await lookupFlyReplayProcessRoute(options.redis, targetProcessId);
  if (!route) {
    writeUpgradeError(options.socket, 503, 'Room owner route is not registered');
    return;
  }

  if (route.machineId === options.config.flyReplay.machineId) {
    writeUpgradeError(options.socket, 410, 'Room owner route is stale on this machine');
    return;
  }

  loggers.room.debug('Replaying Colyseus WebSocket upgrade to room-owning Fly Machine', {
    targetProcessId,
    targetMachineId: route.machineId,
    localProcessId,
    localMachineId: options.config.flyReplay.machineId,
  });

  writeFlyReplayResponse(options.socket, route.machineId, options.config);
}

export function installFlyReplayUpgradeRouter(options: {
  server: HttpServer;
  config: ColyseusRuntimeConfig;
  redis: FlyReplayRedisClient | null;
  getLocalProcessId: () => string | undefined;
}): (() => void) | null {
  if (!options.config.flyReplay.enabled) return null;

  if (!options.redis) {
    throw new Error('Fly replay routing requires a Redis client');
  }

  const originalListeners = options.server.listeners('upgrade') as UpgradeListener[];
  if (originalListeners.length === 0) {
    throw new Error('Fly replay routing requires an existing WebSocket upgrade listener');
  }

  const passThrough: UpgradeListener = (request, socket, head) => {
    for (const listener of originalListeners) {
      listener.call(options.server, request, socket, head);
    }
  };

  const router: UpgradeListener = (request, socket, head) => {
    handleFlyReplayUpgradeRequest({
      request,
      socket,
      head,
      config: options.config,
      redis: options.redis!,
      getLocalProcessId: options.getLocalProcessId,
      passThrough,
    }).catch((error) => {
      loggers.room.error('Fly replay upgrade router failed', {
        error: error instanceof Error ? error.message : String(error),
        url: request.url,
      });
      writeUpgradeError(socket, 503, 'Unable to route WebSocket upgrade to room owner');
    });
  };

  options.server.removeAllListeners('upgrade');
  options.server.on('upgrade', router);

  loggers.room.info('Installed Fly replay WebSocket upgrade router', {
    publicAddress: options.config.publicAddress,
    machineId: options.config.flyReplay.machineId,
  });

  return () => {
    options.server.removeListener('upgrade', router);
    for (const listener of originalListeners) {
      options.server.on('upgrade', listener);
    }
  };
}
