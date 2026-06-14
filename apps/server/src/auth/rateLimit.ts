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

const MAX_RATE_LIMIT_BUCKETS = 25_000;
const buckets = new Map<string, RateLimitBucket>();
let lastCleanupAt = 0;

function cleanupBuckets(now: number): void {
  if (now - lastCleanupAt < 30_000 && buckets.size <= MAX_RATE_LIMIT_BUCKETS) return;
  lastCleanupAt = now;

  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }

  while (buckets.size > MAX_RATE_LIMIT_BUCKETS) {
    const oldestKey = buckets.keys().next().value;
    if (!oldestKey) break;
    buckets.delete(oldestKey);
  }
}

function cleanKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9:._@-]/g, '_').slice(0, 256) || 'unknown';
}

export function getRequestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function consumeRateLimitForKey(identity: string, options: RateLimitOptions): {
  ok: true;
} | {
  ok: false;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  cleanupBuckets(now);

  const key = `${options.keyPrefix}:${cleanKeyPart(identity)}`;
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

export function consumeRateLimit(req: Request, options: RateLimitOptions): {
  ok: true;
} | {
  ok: false;
  retryAfterSeconds: number;
} {
  return consumeRateLimitForKey(`ip:${getRequestIp(req)}`, options);
}

export function clearRateLimitBucketsForTests(): void {
  buckets.clear();
  lastCleanupAt = 0;
}
