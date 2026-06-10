import type { Request } from 'express';

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  keyPrefix: string;
  limit: number;
  windowMs: number;
}

const buckets = new Map<string, RateLimitBucket>();

function getRequestIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.length > 0) {
    return forwardedFor.split(',')[0]?.trim() || req.ip || 'unknown';
  }

  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function consumeRateLimit(req: Request, options: RateLimitOptions): {
  ok: true;
} | {
  ok: false;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const key = `${options.keyPrefix}:${getRequestIp(req)}`;
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return { ok: true };
  }

  if (bucket.count >= options.limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  bucket.count += 1;
  return { ok: true };
}

export function clearRateLimitBucketsForTests(): void {
  buckets.clear();
}
