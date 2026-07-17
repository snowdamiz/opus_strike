import { randomUUID } from 'node:crypto';
import { reconcilePendingLootboxOpens } from './service';
import { createLogger } from '../utils/logger';
import {
  runWithRedisOwnerLock,
  type RedisOwnerLockClient,
} from '../wagers/workerLock';

const logger = createLogger('lootbox');
const DEFAULT_INTERVAL_MS = 15_000;
const LOCK_KEY = 'lootbox:reconcile-submitted-opens';
const LOCK_TTL_MS = 45_000;
const LOCK_HEARTBEAT_MS = 15_000;

export interface LootboxReconciliationWorkerHandle {
  close(): Promise<void>;
}

export function startLootboxReconciliationWorker(options: {
  redis?: RedisOwnerLockClient | null;
  intervalMs?: number;
} = {}): LootboxReconciliationWorkerHandle {
  const intervalMs = Math.max(1_000, Math.trunc(options.intervalMs ?? DEFAULT_INTERVAL_MS));
  let closed = false;
  let currentRun: Promise<void> | null = null;

  const reconcileAndLog = async () => {
    const result = await reconcilePendingLootboxOpens();
    if (result.credited > 0 || result.terminal > 0) {
      logger.info('Reconciled submitted lootbox opens', result);
    }
    if (result.failures.length > 0) {
      logger.warn('Some submitted lootbox opens could not be reconciled', result);
    }
  };

  const trigger = () => {
    if (closed || currentRun) return;
    currentRun = (async () => {
      if (options.redis) {
        await runWithRedisOwnerLock(options.redis, {
          key: LOCK_KEY,
          ttlMs: LOCK_TTL_MS,
          heartbeatMs: LOCK_HEARTBEAT_MS,
          ownerToken: `${process.pid}:${randomUUID()}`,
        }, reconcileAndLog);
        return;
      }
      await reconcileAndLog();
    })().catch((error) => {
      logger.error('Lootbox payment reconciliation failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      currentRun = null;
    });
  };

  const timer = setInterval(trigger, intervalMs);
  timer.unref?.();
  trigger();

  return {
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      await currentRun;
    },
  };
}
