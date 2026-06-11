import Redis from 'ioredis';
import { getColyseusRuntimeConfig, type ColyseusRuntimeConfig } from './colyseus';
import { loggers } from '../utils/logger';

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

export async function pingRedis(client: Redis | null): Promise<{ ok: boolean; status: string; error?: string }> {
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
