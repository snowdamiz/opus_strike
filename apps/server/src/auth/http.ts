import type { Request, Response } from 'express';
import { consumeRateLimit } from './rateLimit';
import { parseCookies } from './session';

export interface JsonRateLimitOptions {
  limit: number;
  windowMs: number;
}

export function enforceJsonRateLimit(
  req: Request,
  res: Response,
  keyPrefix: string,
  options: JsonRateLimitOptions
): boolean {
  const result = consumeRateLimit(req, { keyPrefix, ...options });
  if (result.ok) return true;

  res.setHeader('Retry-After', result.retryAfterSeconds.toString());
  res.status(429).json({ error: 'Too many requests' });
  return false;
}

export function getRequestAuthToken(req: Request, options: { allowBearer?: boolean } = {}): string | null {
  if (options.allowBearer) {
    const authorization = req.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice('Bearer '.length).trim() || null;
    }
  }

  const cookieToken = req.cookies?.auth_token;
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;

  const cookies = parseCookies(req.headers.cookie);
  return cookies.auth_token || null;
}
