export interface RateLimitRule {
  limit: number;
  intervalMs: number;
}

interface RateLimitBucket {
  windowStartedAt: number;
  count: number;
}

export class MessageRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  consume(scope: string, messageType: string, rule: RateLimitRule, now = Date.now()): boolean {
    const key = `${scope}:${messageType}`;
    const bucket = this.buckets.get(key);
    if (!bucket || now - bucket.windowStartedAt >= rule.intervalMs) {
      this.buckets.set(key, { windowStartedAt: now, count: 1 });
      return true;
    }

    if (bucket.count >= rule.limit) {
      return false;
    }

    bucket.count++;
    return true;
  }

  clearScope(scope: string): void {
    const prefix = `${scope}:`;
    for (const key of this.buckets.keys()) {
      if (key.startsWith(prefix)) {
        this.buckets.delete(key);
      }
    }
  }
}

export const GAME_MESSAGE_RATE_LIMITS = {
  movementCommands: { limit: 35, intervalMs: 1000 },
  chat: { limit: 4, intervalMs: 5000 },
  selection: { limit: 6, intervalMs: 3000 },
  matchSceneReady: { limit: 12, intervalMs: 5000 },
  unstuck: { limit: 2, intervalMs: 15000 },
  playerPingResponse: { limit: 30, intervalMs: 10000 },
  devCommand: { limit: 6, intervalMs: 5000 },
  voiceToken: { limit: 4, intervalMs: 60000 },
  playerReport: { limit: 3, intervalMs: 60000 },
} satisfies Record<string, RateLimitRule>;

export const LOBBY_MESSAGE_RATE_LIMITS = {
  ready: { limit: 8, intervalMs: 5000 },
  team: { limit: 8, intervalMs: 5000 },
  hostAction: { limit: 8, intervalMs: 5000 },
  mapVote: { limit: 8, intervalMs: 5000 },
  chat: { limit: 4, intervalMs: 5000 },
  payment: { limit: 6, intervalMs: 60000 },
  devCommand: { limit: 6, intervalMs: 5000 },
} satisfies Record<string, RateLimitRule>;
