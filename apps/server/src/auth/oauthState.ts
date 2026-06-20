import crypto from 'crypto';
import type { AuthProviderName } from './types';
import { sanitizeReturnTo } from './returnTo';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_OAUTH_STATE_RECORDS = 2_000;

export type OAuthStateMode = 'login' | 'link';

export interface OAuthStateRecord {
  state: string;
  provider: AuthProviderName;
  mode: OAuthStateMode;
  returnTo: string;
  linkUserId?: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
}

export type OAuthStateFailureReason = 'missing' | 'expired' | 'used';

const stateStore = new Map<string, OAuthStateRecord>();

function cleanupOAuthStates(): void {
  const now = Date.now();
  for (const [state, record] of stateStore.entries()) {
    if (record.expiresAt <= now) {
      stateStore.delete(state);
    }
  }
}

function trimOAuthStates(): void {
  cleanupOAuthStates();

  while (stateStore.size >= MAX_OAUTH_STATE_RECORDS) {
    const oldestState = stateStore.keys().next().value as string | undefined;
    if (!oldestState) break;
    stateStore.delete(oldestState);
  }
}

const cleanupOAuthStateInterval = setInterval(cleanupOAuthStates, 60 * 1000);
cleanupOAuthStateInterval.unref?.();

export function createOAuthState(options: {
  provider: AuthProviderName;
  mode: OAuthStateMode;
  returnTo?: unknown;
  linkUserId?: string;
}): OAuthStateRecord {
  trimOAuthStates();

  const state = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const record: OAuthStateRecord = {
    state,
    provider: options.provider,
    mode: options.mode,
    returnTo: sanitizeReturnTo(options.returnTo),
    linkUserId: options.linkUserId,
    createdAt: now,
    expiresAt: now + OAUTH_STATE_TTL_MS,
  };

  stateStore.set(state, record);
  return record;
}

export function consumeOAuthState(state: unknown): {
  ok: true;
  record: OAuthStateRecord;
} | {
  ok: false;
  reason: OAuthStateFailureReason;
} {
  if (typeof state !== 'string' || state.length === 0) {
    return { ok: false, reason: 'missing' };
  }

  const record = stateStore.get(state);
  if (!record) {
    return { ok: false, reason: 'missing' };
  }

  const now = Date.now();
  if (record.expiresAt <= now) {
    stateStore.delete(state);
    return { ok: false, reason: 'expired' };
  }

  if (record.usedAt) {
    return { ok: false, reason: 'used' };
  }

  record.usedAt = now;
  return { ok: true, record };
}

export function clearOAuthStatesForTests(): void {
  stateStore.clear();
}

export function expireOAuthStateForTests(state: string): void {
  const record = stateStore.get(state);
  if (record) {
    record.expiresAt = Date.now() - 1;
  }
}
