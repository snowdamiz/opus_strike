import type { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import prisma from '../db';
import { isGuestPlayAllowed } from '../config/security';
import type { AuthProviderName, PendingRegistrationIdentity } from './types';
import { isAuthProvider } from './types';

export interface AuthTokenPayload {
  userId: string;
  sessionVersion: number;
  provider?: AuthProviderName;
  walletAddress?: string | null;
  pending?: false;
}

export interface PendingAuthTokenPayload extends PendingRegistrationIdentity {
  pending: true;
}

export interface RoomAuthContext {
  kind: 'authenticated' | 'guest';
  userId: string;
  walletAddress?: string;
  displayName: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'voxel-strike-secret-key-change-in-production';

export function createAuthToken(options: {
  userId: string;
  provider?: AuthProviderName;
  walletAddress?: string | null;
  expiresIn?: SignOptions['expiresIn'];
}): string {
  const payload: AuthTokenPayload = {
    userId: options.userId,
    sessionVersion: 1,
    provider: options.provider,
    walletAddress: options.walletAddress ?? undefined,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: options.expiresIn ?? '30d' });
}

export function createPendingAuthToken(identity: PendingRegistrationIdentity): string {
  const payload: PendingAuthTokenPayload = {
    ...identity,
    pending: true,
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Partial<AuthTokenPayload> & Partial<PendingAuthTokenPayload>;
    if (!payload || payload.pending || typeof payload.userId !== 'string' || !payload.userId) return null;

    return {
      userId: payload.userId,
      sessionVersion: typeof payload.sessionVersion === 'number' ? payload.sessionVersion : 0,
      provider: isAuthProvider(payload.provider) ? payload.provider : undefined,
      walletAddress: typeof payload.walletAddress === 'string' ? payload.walletAddress : undefined,
      pending: false,
    };
  } catch {
    return null;
  }
}

export function verifyPendingAuthToken(token: string): PendingAuthTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as Partial<PendingAuthTokenPayload>;
    if (!payload || !payload.pending) return null;

    if (isAuthProvider(payload.provider) && typeof payload.providerAccountId === 'string' && payload.providerAccountId) {
      return {
        pending: true,
        provider: payload.provider,
        providerAccountId: payload.providerAccountId,
        displayName: typeof payload.displayName === 'string' ? payload.displayName : null,
        avatarUrl: typeof payload.avatarUrl === 'string' ? payload.avatarUrl : null,
        emailHash: typeof payload.emailHash === 'string' ? payload.emailHash : null,
        walletAddress: typeof payload.walletAddress === 'string' ? payload.walletAddress : null,
      };
    }

    if (typeof payload.walletAddress === 'string' && payload.walletAddress) {
      return {
        pending: true,
        provider: 'phantom',
        providerAccountId: payload.walletAddress,
        walletAddress: payload.walletAddress,
        displayName: payload.walletAddress,
        avatarUrl: null,
        emailHash: null,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | string[] | undefined): Record<string, string> {
  const header = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;
  if (!header) return {};

  const cookies: Record<string, string> = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!key) continue;
    cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

function sanitizeDisplayName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim().replace(/\s+/g, ' ').slice(0, 24);
  return trimmed || fallback;
}

export async function resolveRoomAuthContext(
  sessionId: string,
  options: Record<string, unknown> | undefined,
  request?: IncomingMessage
): Promise<RoomAuthContext> {
  const cookies = parseCookies(request?.headers.cookie);
  const token = typeof options?.authToken === 'string'
    ? options.authToken
    : cookies.auth_token;
  const payload = token ? verifyAuthToken(token) : null;

  if (payload) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { id: payload.userId },
          ...(payload.walletAddress ? [{ walletAddress: payload.walletAddress }] : []),
        ],
      },
      select: { id: true, walletAddress: true, name: true },
    });

    if (user && (!payload.walletAddress || user.walletAddress === payload.walletAddress)) {
      return {
        kind: 'authenticated',
        userId: user.id,
        walletAddress: user.walletAddress ?? undefined,
        displayName: sanitizeDisplayName(user.name, 'Player'),
      };
    }
  }

  if (!isGuestPlayAllowed()) {
    throw new Error('Authentication required');
  }

  return {
    kind: 'guest',
    userId: `guest:${sessionId}`,
    displayName: sanitizeDisplayName(options?.playerName, 'Guest'),
  };
}
