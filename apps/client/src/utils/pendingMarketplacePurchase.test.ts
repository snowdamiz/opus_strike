import assert from 'node:assert/strict';
import type { MarketplacePurchaseIntentSnapshot } from '@voxel-strike/shared';
import {
  MARKETPLACE_PURCHASE_POLL_MS,
  MARKETPLACE_SUBMISSION_HANDOFF_GRACE_MS,
  PENDING_MARKETPLACE_PURCHASE_STORAGE_KEY,
  clearPendingMarketplacePurchase,
  loadPendingMarketplacePurchase,
  resolvePendingMarketplacePurchase,
  savePendingMarketplacePurchase,
} from './pendingMarketplacePurchase';

const values = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};
(globalThis as any).window = { localStorage };

const intentId = '11111111-1111-4111-8111-111111111111';

function intent(status: MarketplacePurchaseIntentSnapshot['status']): MarketplacePurchaseIntentSnapshot {
  return {
    intentId,
    listingId: 'listing-1',
    skinId: 'phantom.void-monarch',
    status,
    buyerWalletAddress: 'buyer',
    sellerWalletAddress: 'seller',
    priceLamports: '1000000',
    memo: `opus-market:${intentId}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cluster: 'localnet',
    transactionSignature: null,
    creditedAt: null,
    lastError: null,
  };
}

{
  const saved = savePendingMarketplacePurchase(intentId, 1234);
  assert.deepEqual(saved, { intentId, savedAt: 1234 });
  assert.deepEqual(loadPendingMarketplacePurchase(), saved);
  clearPendingMarketplacePurchase('22222222-2222-4222-8222-222222222222');
  assert.deepEqual(loadPendingMarketplacePurchase(), saved);
  clearPendingMarketplacePurchase(intentId);
  assert.equal(loadPendingMarketplacePurchase(), null);
  values.set(PENDING_MARKETPLACE_PURCHASE_STORAGE_KEY, '{broken');
  assert.equal(loadPendingMarketplacePurchase(), null);
}

{
  let now = 10_000;
  const statuses: MarketplacePurchaseIntentSnapshot['status'][] = ['submitted', 'confirmed', 'credited'];
  const waits: number[] = [];
  const resolved = await resolvePendingMarketplacePurchase({
    pending: { intentId, savedAt: now },
    initialIntent: intent('transaction_built'),
    loadIntent: async () => intent(statuses.shift()!),
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    now: () => now,
  });
  assert.equal(resolved?.status, 'credited');
  assert.deepEqual(waits, [
    MARKETPLACE_PURCHASE_POLL_MS,
    MARKETPLACE_PURCHASE_POLL_MS,
    MARKETPLACE_PURCHASE_POLL_MS,
  ]);
}

{
  const savedAt = 5_000;
  const unresolved = await resolvePendingMarketplacePurchase({
    pending: { intentId, savedAt },
    initialIntent: intent('transaction_built'),
    loadIntent: async () => intent('submitted'),
    now: () => savedAt + MARKETPLACE_SUBMISSION_HANDOFF_GRACE_MS + 1,
  });
  assert.equal(unresolved?.status, 'transaction_built');
}

console.log('pending marketplace purchase tests passed');
