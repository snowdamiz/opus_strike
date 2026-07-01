import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import prisma from '../db';
import { getAllowedClientOrigins } from '../config/clientOrigins';
import { getAuthTokenSecret } from '../config/security';
import { getAntiCheatConfig } from '../anticheat';
import { loggers } from '../utils/logger';
import { verifyAuthToken } from './session';

export interface GameAdminUser {
  id: string;
  name: string;
  walletAddress: string;
  elevatedAntiCheatRole: boolean;
}

const ADMIN_CSRF_HEADER = 'x-csrf-token';
const ADMIN_CSRF_WINDOW_MS = 60 * 60 * 1000;

export function configuredGameAdminWallet(): string | null {
  const wallet = process.env.ADMIN_WALLET?.trim();
  return wallet || null;
}

export function isConfiguredGameAdminWallet(walletAddress: string | null | undefined): boolean {
  const configuredWallet = configuredGameAdminWallet();
  return Boolean(configuredWallet && walletAddress && walletAddress === configuredWallet);
}

export function sendNotFound(res: Response): void {
  res.status(404).type('text').send('Not found');
}

export function noStore(res: Response): void {
  res.setHeader('Cache-Control', 'no-store, private, max-age=0');
  res.setHeader('Pragma', 'no-cache');
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer);
}

function adminCsrfSignature(adminUser: GameAdminUser, bucket: number): string {
  return crypto
    .createHmac('sha256', getAuthTokenSecret())
    .update(`${adminUser.id}:${adminUser.walletAddress}:${bucket}`)
    .digest('base64url');
}

export function createAdminCsrfToken(adminUser: GameAdminUser, now = Date.now()): string {
  const bucket = Math.floor(now / ADMIN_CSRF_WINDOW_MS);
  return `${bucket}.${adminCsrfSignature(adminUser, bucket)}`;
}

export function verifyAdminCsrfToken(adminUser: GameAdminUser, token: string, now = Date.now()): boolean {
  const [bucketRaw, signature, ...extra] = token.split('.');
  if (!bucketRaw || !signature || extra.length > 0 || !/^[0-9]+$/.test(bucketRaw)) return false;

  const bucket = Number(bucketRaw);
  if (!Number.isSafeInteger(bucket)) return false;

  const currentBucket = Math.floor(now / ADMIN_CSRF_WINDOW_MS);
  if (bucket < currentBucket - 1 || bucket > currentBucket) return false;

  return timingSafeStringEqual(signature, adminCsrfSignature(adminUser, bucket));
}

export function readHeaderString(req: Request, name: string): string {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? '';
  return typeof value === 'string' ? value : '';
}

function adminAllowedOrigins(): string[] {
  return getAllowedClientOrigins();
}

function isAllowedConfiguredAdminOrigin(source: string): boolean {
  try {
    const sourceOrigin = new URL(source).origin;
    return adminAllowedOrigins().some((origin) => {
      try {
        return new URL(origin).origin === sourceOrigin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

export function hasAllowedAdminOrigin(req: Request): boolean {
  const fetchSite = readHeaderString(req, 'sec-fetch-site').toLowerCase();

  const host = req.headers.host;
  if (!host) return false;

  const origin = readHeaderString(req, 'origin');
  const referer = origin ? '' : readHeaderString(req, 'referer');
  const source = origin || referer;
  if (!source) return fetchSite === 'same-origin' || fetchSite === 'same-site' || fetchSite === 'none';

  try {
    if (fetchSite === 'cross-site') return isAllowedConfiguredAdminOrigin(source);
    return new URL(source).host === host || isAllowedConfiguredAdminOrigin(source);
  } catch {
    return false;
  }
}

export async function resolveGameAdminUser(userId: string): Promise<GameAdminUser | null> {
  const configuredAdminWallet = configuredGameAdminWallet();
  if (!configuredAdminWallet) return null;

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      walletAddress: configuredAdminWallet,
    },
    select: {
      id: true,
      name: true,
      walletAddress: true,
    },
  });

  const walletAddress = user?.walletAddress;
  if (!user || !walletAddress) return null;

  return {
    id: user.id,
    name: user.name,
    walletAddress,
    elevatedAntiCheatRole: getAntiCheatConfig().elevatedAdminWallets.includes(walletAddress),
  };
}

export async function isGameAdminUserId(userId: string): Promise<boolean> {
  return Boolean(await resolveGameAdminUser(userId));
}

export async function ensureGameAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  noStore(res);

  if (!configuredGameAdminWallet()) {
    loggers.auth.warn('Admin route requested without ADMIN_WALLET configured', { path: req.path });
    sendNotFound(res);
    return;
  }

  try {
    const token = req.cookies?.auth_token;
    const payload = typeof token === 'string' ? verifyAuthToken(token) : null;
    if (!payload) {
      loggers.auth.warn('Admin route rejected non-admin session', {
        path: req.path,
        hasSession: false,
      });
      sendNotFound(res);
      return;
    }

    const adminUser = await resolveGameAdminUser(payload.userId);
    if (!adminUser) {
      loggers.auth.warn('Admin route rejected stale admin token', {
        path: req.path,
        userId: payload.userId,
      });
      sendNotFound(res);
      return;
    }

    res.locals.adminUser = adminUser;
    next();
  } catch (error) {
    loggers.auth.error('Admin authorization failed', {
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Admin authorization failed' });
  }
}

export function ensureGameAdminMutation(req: Request, res: Response, next: NextFunction): void {
  noStore(res);

  const adminUser = res.locals.adminUser as GameAdminUser | undefined;
  const token = readHeaderString(req, ADMIN_CSRF_HEADER);

  if (!adminUser || !hasAllowedAdminOrigin(req) || !verifyAdminCsrfToken(adminUser, token)) {
    loggers.auth.warn('Admin mutation rejected by CSRF guard', {
      path: req.path,
      hasAdminUser: Boolean(adminUser),
      hasToken: Boolean(token),
      origin: readHeaderString(req, 'origin') || null,
      fetchSite: readHeaderString(req, 'sec-fetch-site') || null,
    });
    sendNotFound(res);
    return;
  }

  next();
}
