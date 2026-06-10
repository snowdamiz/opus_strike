import type { IncomingMessage } from 'http';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import prisma from '../db';
import { isGuestPlayAllowed } from '../config/security';

export interface AuthTokenPayload {
  walletAddress: string;
  userId: string;
  pending?: boolean;
}

export interface RoomAuthContext {
  kind: 'authenticated' | 'guest';
  userId: string;
  walletAddress?: string;
  displayName: string;
}

const JWT_SECRET = process.env.JWT_SECRET || 'voxel-strike-secret-key-change-in-production';

export function createAuthToken(
  walletAddress: string,
  userId: string,
  expiresIn: SignOptions['expiresIn'] = '30d'
): string {
  return jwt.sign({ walletAddress, userId } as AuthTokenPayload, JWT_SECRET, { expiresIn });
}

export function createPendingAuthToken(walletAddress: string): string {
  return jwt.sign({ walletAddress, pending: true }, JWT_SECRET, { expiresIn: '1h' });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    if (!payload || payload.pending || !payload.walletAddress || !payload.userId) return null;
    return payload;
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
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, walletAddress: true, name: true },
    });

    if (user && user.walletAddress === payload.walletAddress) {
      return {
        kind: 'authenticated',
        userId: user.id,
        walletAddress: user.walletAddress,
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
