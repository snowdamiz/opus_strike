import type Redis from 'ioredis';
import { getSharedRedisClient } from '../config/redis';
import { loggers } from '../utils/logger';

export const WALLET_AUTH_NONCE_TTL_MS = 5 * 60 * 1000;

const MAX_LOCAL_WALLET_AUTH_NONCES = 20_000;
const LOCAL_WALLET_AUTH_NONCE_CLEANUP_INTERVAL_MS = 30_000;
const WALLET_AUTH_NONCE_KEY_PREFIX = 'auth:wallet_nonce';

const localWalletAuthNonces = new Map<string, number>();
let lastLocalCleanupAt = 0;
let redisClientOverrideForTests: Redis | null | undefined;

function getWalletAuthNonceKey(walletAddress: string, nonce: string): string {
  return `${WALLET_AUTH_NONCE_KEY_PREFIX}:${walletAddress}:${nonce}`;
}

function cleanupLocalWalletAuthNonces(now: number): void {
  if (
    now - lastLocalCleanupAt < LOCAL_WALLET_AUTH_NONCE_CLEANUP_INTERVAL_MS &&
    localWalletAuthNonces.size <= MAX_LOCAL_WALLET_AUTH_NONCES
  ) {
    return;
  }

  lastLocalCleanupAt = now;

  for (const [key, expiresAt] of localWalletAuthNonces.entries()) {
    if (expiresAt <= now) {
      localWalletAuthNonces.delete(key);
    }
  }

  while (localWalletAuthNonces.size > MAX_LOCAL_WALLET_AUTH_NONCES) {
    const oldestKey = localWalletAuthNonces.keys().next().value as string | undefined;
    if (!oldestKey) break;
    localWalletAuthNonces.delete(oldestKey);
  }
}

function getWalletAuthNonceRedisClient(): Redis | null {
  return redisClientOverrideForTests === undefined
    ? getSharedRedisClient()
    : redisClientOverrideForTests;
}

async function ensureRedisReady(redis: Redis): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
}

function storeLocalWalletAuthNonce(key: string, expiresAt: number, now: number): void {
  cleanupLocalWalletAuthNonces(now);
  localWalletAuthNonces.set(key, expiresAt);
  cleanupLocalWalletAuthNonces(now);
}

function consumeLocalWalletAuthNonce(key: string, now: number): boolean {
  cleanupLocalWalletAuthNonces(now);

  const expiresAt = localWalletAuthNonces.get(key);
  if (!expiresAt) return false;

  localWalletAuthNonces.delete(key);
  return expiresAt > now;
}

export async function storeWalletAuthNonce(
  walletAddress: string,
  nonce: string,
  now = Date.now()
): Promise<boolean> {
  if (!walletAddress || !nonce) return false;

  const key = getWalletAuthNonceKey(walletAddress, nonce);
  const redis = getWalletAuthNonceRedisClient();

  if (redis) {
    try {
      await ensureRedisReady(redis);
      await redis.set(key, '1', 'PX', WALLET_AUTH_NONCE_TTL_MS);
      return true;
    } catch (error) {
      loggers.auth.error('Wallet auth nonce store failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  storeLocalWalletAuthNonce(key, now + WALLET_AUTH_NONCE_TTL_MS, now);
  return true;
}

export async function consumeWalletAuthNonce(
  walletAddress: string,
  nonce: string,
  now = Date.now()
): Promise<boolean> {
  if (!walletAddress || !nonce) return false;

  const key = getWalletAuthNonceKey(walletAddress, nonce);
  const redis = getWalletAuthNonceRedisClient();

  if (redis) {
    try {
      await ensureRedisReady(redis);
      const deletedCount = await redis.del(key);
      return deletedCount === 1;
    } catch (error) {
      loggers.auth.error('Wallet auth nonce consume failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  return consumeLocalWalletAuthNonce(key, now);
}

export function forceLocalWalletAuthNonceStoreForTests(): void {
  redisClientOverrideForTests = null;
}

export function resetWalletAuthNonceStoreForTests(): void {
  redisClientOverrideForTests = undefined;
  localWalletAuthNonces.clear();
  lastLocalCleanupAt = 0;
}

export function getLocalWalletAuthNonceCountForTests(): number {
  cleanupLocalWalletAuthNonces(Date.now());
  return localWalletAuthNonces.size;
}
