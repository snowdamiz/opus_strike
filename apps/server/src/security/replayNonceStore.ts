import type Redis from 'ioredis';
import { getSharedRedisClient } from '../config/redis';
import { loggers } from '../utils/logger';

const MAX_LOCAL_NONCES = 20_000;
const MAX_NONCE_TTL_MS = 5 * 60 * 1000;

const localNonces = new Map<string, number>();
let lastLocalCleanupAt = 0;

function cleanupLocalNonces(now: number): void {
  if (now - lastLocalCleanupAt < 30_000 && localNonces.size <= MAX_LOCAL_NONCES) return;
  lastLocalCleanupAt = now;

  for (const [key, expiresAt] of localNonces.entries()) {
    if (expiresAt <= now) localNonces.delete(key);
  }

  while (localNonces.size > MAX_LOCAL_NONCES) {
    const oldestKey = localNonces.keys().next().value;
    if (!oldestKey) break;
    localNonces.delete(oldestKey);
  }
}

function localConsume(key: string, expiresAt: number, now: number): boolean {
  cleanupLocalNonces(now);

  const existingExpiresAt = localNonces.get(key);
  if (existingExpiresAt && existingExpiresAt > now) return false;

  localNonces.set(key, expiresAt);
  return true;
}

async function ensureRedisReady(redis: Redis): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
}

export async function consumeReplayNonce(
  scope: string,
  nonce: string,
  expiresAt: number,
  now = Date.now()
): Promise<boolean> {
  if (!scope || !nonce || !Number.isFinite(expiresAt) || expiresAt <= now) {
    return false;
  }

  const ttlMs = Math.max(1, Math.min(Math.ceil(expiresAt - now), MAX_NONCE_TTL_MS));
  const key = `security:replay:${scope}:${nonce}`;
  const redis = getSharedRedisClient();

  if (redis) {
    try {
      await ensureRedisReady(redis);
      const result = await redis.set(key, '1', 'PX', ttlMs, 'NX');
      return result === 'OK';
    } catch (error) {
      loggers.auth.error('Replay nonce reservation failed', {
        scope,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  return localConsume(key, now + ttlMs, now);
}

export function clearReplayNoncesForTests(): void {
  localNonces.clear();
  lastLocalCleanupAt = 0;
}
