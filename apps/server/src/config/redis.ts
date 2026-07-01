import Redis from 'ioredis';
import { getColyseusRuntimeConfig, type ColyseusRuntimeConfig } from './colyseus';
import { loggers } from '../utils/logger';

export interface RedisHealthStatus {
  ok: boolean;
  status: string;
  error?: string;
}

let sharedRedisClient: Redis | null = null;
let sharedRedisUrl: string | null = null;

export function createRedisClient(redisUrl: string, connectionName: string): Redis {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    connectionName,
    maxRetriesPerRequest: 2,
    enableReadyCheck: true,
  });

  client.on('error', (error) => {
    loggers.room.error('Redis connection error', {
      connectionName,
      error: error instanceof Error ? error.message : String(error),
    });
  });

  return client;
}

export function getSharedRedisClient(config: ColyseusRuntimeConfig = getColyseusRuntimeConfig()): Redis | null {
  if (!config.redisUrl) return null;

  if (!sharedRedisClient || sharedRedisUrl !== config.redisUrl || sharedRedisClient.status === 'end') {
    sharedRedisClient = createRedisClient(config.redisUrl, `voxel-strike:${process.pid}`);
    sharedRedisUrl = config.redisUrl;
  }

  return sharedRedisClient;
}

export async function pingRedis(client: Redis | null): Promise<RedisHealthStatus> {
  if (!client) {
    return { ok: false, status: 'not_configured' };
  }

  try {
    if (client.status === 'wait' || client.status === 'end') {
      await client.connect();
    }

    const response = await client.ping();
    return { ok: response === 'PONG', status: response };
  } catch (error) {
    return {
      ok: false,
      status: client.status,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function probeRedisConnection(redisUrl: string): Promise<RedisHealthStatus> {
  let connectionError: unknown;
  const probe = new Redis(redisUrl, {
    lazyConnect: true,
    connectionName: `voxel-strike:${process.pid}:startup-probe`,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    retryStrategy: () => null,
  });

  probe.on('error', (error) => {
    connectionError = error;
    // The caller reports the probe result. This listener prevents ioredis from
    // printing its own repeated "Unhandled error event" noise during startup.
  });

  try {
    await probe.connect();
    const response = await probe.ping();
    return { ok: response === 'PONG', status: response };
  } catch (error) {
    const reportedError = connectionError ?? error;
    return {
      ok: false,
      status: probe.status,
      error: reportedError instanceof Error ? reportedError.message : String(reportedError),
    };
  } finally {
    probe.disconnect();
  }
}

export async function assertRedisAvailableForDistributedRuntime(
  config: ColyseusRuntimeConfig
): Promise<void> {
  if (!config.distributed) return;
  if (!config.redisUrl) {
    throw new Error('COLYSEUS_DISTRIBUTED=1 requires COLYSEUS_REDIS_URL or REDIS_URL');
  }

  const redis = await probeRedisConnection(config.redisUrl);
  if (redis.ok) return;

  const detail = redis.error ? `${redis.status}: ${redis.error}` : redis.status;
  throw new Error(
    `COLYSEUS_DISTRIBUTED=1 requires a reachable Redis server (${detail}). `
    + 'Start Redis with "pnpm db:up", run "pnpm dev:all", or set COLYSEUS_DISTRIBUTED=0 for single-process dev.'
  );
}

export async function closeSharedRedisClient(): Promise<void> {
  const client = sharedRedisClient;
  sharedRedisClient = null;
  sharedRedisUrl = null;

  if (!client || client.status === 'end') return;

  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
