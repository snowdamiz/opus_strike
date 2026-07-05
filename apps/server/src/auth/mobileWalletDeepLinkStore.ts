import type Redis from 'ioredis';
import { getSharedRedisClient } from '../config/redis';
import { loggers } from '../utils/logger';

export type MobileWalletProviderId = 'phantom' | 'solflare';
export type MobileWalletDeepLinkPhase = 'connect' | 'sign';

export interface MobileWalletDeepLinkState {
  id: string;
  providerId: MobileWalletProviderId;
  phase: MobileWalletDeepLinkPhase;
  returnTo: string;
  dappPublicKey: string;
  dappSecretKey: string;
  createdAt: number;
  authToken: string | null;
  walletEncryptionPublicKey?: string;
  walletAddress?: string;
  walletSession?: string;
  authNonce?: string;
}

export const MOBILE_WALLET_DEEP_LINK_TTL_MS = 10 * 60 * 1000;

const MAX_LOCAL_MOBILE_WALLET_STATES = 20_000;
const LOCAL_MOBILE_WALLET_STATE_CLEANUP_INTERVAL_MS = 30_000;
const MOBILE_WALLET_STATE_KEY_PREFIX = 'auth:mobile_wallet_deeplink';

const localMobileWalletStates = new Map<string, { state: MobileWalletDeepLinkState; expiresAt: number }>();
let lastLocalCleanupAt = 0;
let redisClientOverrideForTests: Redis | null | undefined;

function mobileWalletStateKey(id: string): string {
  return `${MOBILE_WALLET_STATE_KEY_PREFIX}:${id}`;
}

function cleanupLocalMobileWalletStates(now: number): void {
  if (
    now - lastLocalCleanupAt < LOCAL_MOBILE_WALLET_STATE_CLEANUP_INTERVAL_MS &&
    localMobileWalletStates.size <= MAX_LOCAL_MOBILE_WALLET_STATES
  ) {
    return;
  }

  lastLocalCleanupAt = now;

  for (const [id, entry] of localMobileWalletStates.entries()) {
    if (entry.expiresAt <= now) {
      localMobileWalletStates.delete(id);
    }
  }

  while (localMobileWalletStates.size > MAX_LOCAL_MOBILE_WALLET_STATES) {
    const oldestId = localMobileWalletStates.keys().next().value as string | undefined;
    if (!oldestId) break;
    localMobileWalletStates.delete(oldestId);
  }
}

function getMobileWalletStateRedisClient(): Redis | null {
  return redisClientOverrideForTests === undefined
    ? getSharedRedisClient()
    : redisClientOverrideForTests;
}

async function ensureRedisReady(redis: Redis): Promise<void> {
  if (redis.status === 'wait' || redis.status === 'end') {
    await redis.connect();
  }
}

function parseMobileWalletState(raw: string | null): MobileWalletDeepLinkState | null {
  if (!raw) return null;

  try {
    const state = JSON.parse(raw) as Partial<MobileWalletDeepLinkState>;
    if (
      !state ||
      typeof state.id !== 'string' ||
      (state.providerId !== 'phantom' && state.providerId !== 'solflare') ||
      (state.phase !== 'connect' && state.phase !== 'sign') ||
      typeof state.returnTo !== 'string' ||
      typeof state.dappPublicKey !== 'string' ||
      typeof state.dappSecretKey !== 'string' ||
      typeof state.createdAt !== 'number'
    ) {
      return null;
    }

    return {
      id: state.id,
      providerId: state.providerId,
      phase: state.phase,
      returnTo: state.returnTo,
      dappPublicKey: state.dappPublicKey,
      dappSecretKey: state.dappSecretKey,
      createdAt: state.createdAt,
      authToken: typeof state.authToken === 'string' ? state.authToken : null,
      walletEncryptionPublicKey: typeof state.walletEncryptionPublicKey === 'string'
        ? state.walletEncryptionPublicKey
        : undefined,
      walletAddress: typeof state.walletAddress === 'string' ? state.walletAddress : undefined,
      walletSession: typeof state.walletSession === 'string' ? state.walletSession : undefined,
      authNonce: typeof state.authNonce === 'string' ? state.authNonce : undefined,
    };
  } catch {
    return null;
  }
}

export async function storeMobileWalletDeepLinkState(
  state: MobileWalletDeepLinkState,
  now = Date.now()
): Promise<boolean> {
  const redis = getMobileWalletStateRedisClient();

  if (redis) {
    try {
      await ensureRedisReady(redis);
      await redis.set(
        mobileWalletStateKey(state.id),
        JSON.stringify(state),
        'PX',
        MOBILE_WALLET_DEEP_LINK_TTL_MS
      );
      return true;
    } catch (error) {
      loggers.auth.error('Mobile wallet deeplink state store failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  cleanupLocalMobileWalletStates(now);
  localMobileWalletStates.set(state.id, {
    state,
    expiresAt: now + MOBILE_WALLET_DEEP_LINK_TTL_MS,
  });
  cleanupLocalMobileWalletStates(now);
  return true;
}

export async function readMobileWalletDeepLinkState(
  id: string,
  now = Date.now()
): Promise<MobileWalletDeepLinkState | null> {
  const redis = getMobileWalletStateRedisClient();

  if (redis) {
    try {
      await ensureRedisReady(redis);
      return parseMobileWalletState(await redis.get(mobileWalletStateKey(id)));
    } catch (error) {
      loggers.auth.error('Mobile wallet deeplink state read failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  cleanupLocalMobileWalletStates(now);
  const entry = localMobileWalletStates.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    localMobileWalletStates.delete(id);
    return null;
  }
  return entry.state;
}

export async function deleteMobileWalletDeepLinkState(id: string): Promise<void> {
  const redis = getMobileWalletStateRedisClient();

  if (redis) {
    try {
      await ensureRedisReady(redis);
      await redis.del(mobileWalletStateKey(id));
    } catch (error) {
      loggers.auth.error('Mobile wallet deeplink state delete failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  localMobileWalletStates.delete(id);
}

export function forceLocalMobileWalletDeepLinkStoreForTests(): void {
  redisClientOverrideForTests = null;
}

export function resetMobileWalletDeepLinkStoreForTests(): void {
  redisClientOverrideForTests = undefined;
  localMobileWalletStates.clear();
  lastLocalCleanupAt = 0;
}

export function getLocalMobileWalletDeepLinkStateCountForTests(): number {
  cleanupLocalMobileWalletStates(Date.now());
  return localMobileWalletStates.size;
}
