import { randomUUID } from 'node:crypto';
import { createLogger } from '../utils/logger';
import {
  runWithRedisOwnerLock,
  type RedisOwnerLockClient,
} from '../wagers/workerLock';
import { reconcilePendingMarketplacePurchases } from './service';

const logger = createLogger('marketplace');
const DEFAULT_INTERVAL_MS = 15_000;
const LOCK_KEY = 'marketplace:reconcile-submitted-purchases';
const LOCK_TTL_MS = 45_000;
const LOCK_HEARTBEAT_MS = 15_000;

export interface MarketplaceReconciliationWorkerHandle {
  close(): Promise<void>;
}

export function startMarketplaceReconciliationWorker(options: {
  redis?: RedisOwnerLockClient | null;
  intervalMs?: number;
} = {}): MarketplaceReconciliationWorkerHandle {
  const intervalMs = Math.max(1_000, Math.trunc(options.intervalMs ?? DEFAULT_INTERVAL_MS));
  let closed = false;
  let currentRun: Promise<void> | null = null;

  const reconcileAndLog = async () => {
    const result = await reconcilePendingMarketplacePurchases();
    if (result.credited > 0 || result.terminal > 0) {
      logger.info('Reconciled submitted marketplace purchases', result);
    }
    if (result.failures.length > 0) {
      logger.warn('Some submitted marketplace purchases could not be reconciled', result);
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
      logger.error('Marketplace payment reconciliation failed', {
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
