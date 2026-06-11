import { randomUUID } from 'node:crypto';

export interface RedisOwnerLockClient {
  set(
    key: string,
    value: string,
    ttlMode: 'PX',
    ttlMs: number,
    condition: 'NX'
  ): Promise<'OK' | null>;
  eval(script: string, numKeys: number, key: string, ownerToken: string, ttlMs?: number): Promise<unknown>;
}

export interface RedisOwnerLockOptions {
  key: string;
  ttlMs: number;
  heartbeatMs?: number;
  ownerToken?: string;
  onAcquired?: (ownerToken: string) => void;
  onSkipped?: () => void;
  onExtended?: () => void;
  onExtendFailed?: () => void;
  onReleased?: () => void;
}

const RELEASE_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

const EXTEND_IF_OWNER_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`;

export class RedisOwnerLockLease {
  constructor(
    private readonly client: RedisOwnerLockClient,
    private readonly key: string,
    readonly ownerToken: string,
    private readonly ttlMs: number
  ) {}

  async extend(): Promise<boolean> {
    const result = await this.client.eval(EXTEND_IF_OWNER_SCRIPT, 1, this.key, this.ownerToken, this.ttlMs);
    return result === 1;
  }

  async release(): Promise<boolean> {
    const result = await this.client.eval(RELEASE_IF_OWNER_SCRIPT, 1, this.key, this.ownerToken);
    return result === 1;
  }
}

export async function acquireRedisOwnerLock(
  client: RedisOwnerLockClient,
  options: RedisOwnerLockOptions
): Promise<RedisOwnerLockLease | null> {
  const ownerToken = options.ownerToken ?? `${process.pid}:${randomUUID()}`;
  const result = await client.set(options.key, ownerToken, 'PX', options.ttlMs, 'NX');
  if (result !== 'OK') {
    options.onSkipped?.();
    return null;
  }

  options.onAcquired?.(ownerToken);
  return new RedisOwnerLockLease(client, options.key, ownerToken, options.ttlMs);
}

export async function runWithRedisOwnerLock<T>(
  client: RedisOwnerLockClient,
  options: RedisOwnerLockOptions,
  fn: () => Promise<T>
): Promise<{ acquired: true; result: T } | { acquired: false }> {
  const lease = await acquireRedisOwnerLock(client, options);
  if (!lease) return { acquired: false };

  const heartbeatMs = Math.max(1000, Math.min(options.heartbeatMs ?? Math.floor(options.ttlMs / 3), options.ttlMs - 1));
  const heartbeat = setInterval(() => {
    lease.extend()
      .then((extended) => {
        if (extended) {
          options.onExtended?.();
        } else {
          options.onExtendFailed?.();
        }
      })
      .catch(() => {
        options.onExtendFailed?.();
      });
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    return { acquired: true, result: await fn() };
  } finally {
    clearInterval(heartbeat);
    await lease.release().catch(() => false);
    options.onReleased?.();
  }
}
