import assert from 'node:assert/strict';
import type { LootboxOpenIntentSnapshot } from '@voxel-strike/shared';
import {
  LOOTBOX_OPEN_POLL_MS,
  LOOTBOX_SUBMISSION_HANDOFF_GRACE_MS,
  PENDING_LOOTBOX_OPEN_STORAGE_KEY,
  clearPendingLootboxOpen,
  loadPendingLootboxOpen,
  resolvePendingLootboxOpen,
  savePendingLootboxOpen,
} from './pendingLootboxOpen';

const values = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => values.set(key, value),
  removeItem: (key: string) => values.delete(key),
};
(globalThis as any).window = { localStorage };

const intentId = '11111111-1111-4111-8111-111111111111';

function intent(status: LootboxOpenIntentSnapshot['status']): LootboxOpenIntentSnapshot {
  return {
    intentId,
    status,
    walletAddress: 'wallet',
    tokenMintAddress: 'mint',
    tokenSymbol: 'STRIKE',
    tokenAmountBaseUnits: '75000000000',
    priceTokens: '75000',
    quotedWeights: { common: 0, epic: 7900, unique: 1800, legendary: 300 },
    quotedDirectTokenReward: {
      chanceBps: 6000,
      range: { minTokens: '5000', maxTokens: '75000' },
    },
    quotedDuplicateReward: { skinTokenRanges: {} },
    treasuryTokenAccount: 'treasury',
    memo: `opus-lootbox:${intentId}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    cluster: 'localnet',
    transactionSignature: null,
    resultSkinId: null,
    resultRarity: null,
    resultKind: null,
    resultTokenAmount: null,
    tokenPayoutId: null,
    creditedAt: null,
    lastError: null,
  };
}

{
  const saved = savePendingLootboxOpen(intentId, 1234);
  assert.deepEqual(saved, { intentId, savedAt: 1234 });
  assert.deepEqual(loadPendingLootboxOpen(), saved);

  clearPendingLootboxOpen('22222222-2222-4222-8222-222222222222');
  assert.deepEqual(loadPendingLootboxOpen(), saved, 'a different intent cannot clear the pending record');
  clearPendingLootboxOpen(intentId);
  assert.equal(loadPendingLootboxOpen(), null);

  assert.equal(savePendingLootboxOpen('invalid'), null);
  values.set(PENDING_LOOTBOX_OPEN_STORAGE_KEY, '{broken');
  assert.equal(loadPendingLootboxOpen(), null);

  const originalSetItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new Error('storage disabled');
  };
  assert.deepEqual(
    savePendingLootboxOpen(intentId, 5678),
    { intentId, savedAt: 5678 },
    'in-memory recovery remains available when persistence is blocked'
  );
  localStorage.setItem = originalSetItem;
}

{
  let now = 10_000;
  const pending = { intentId, savedAt: now };
  const statuses: LootboxOpenIntentSnapshot['status'][] = ['submitted', 'credited'];
  const waits: number[] = [];
  const resolved = await resolvePendingLootboxOpen({
    pending,
    initialIntent: intent('transaction_built'),
    loadIntent: async () => intent(statuses.shift()!),
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    now: () => now,
  });
  assert.equal(resolved?.status, 'credited');
  assert.deepEqual(waits, [LOOTBOX_OPEN_POLL_MS, LOOTBOX_OPEN_POLL_MS]);
}

{
  const savedAt = 5_000;
  let loadCalls = 0;
  const unresolved = await resolvePendingLootboxOpen({
    pending: { intentId, savedAt },
    initialIntent: intent('transaction_built'),
    loadIntent: async () => {
      loadCalls += 1;
      return intent('submitted');
    },
    now: () => savedAt + LOOTBOX_SUBMISSION_HANDOFF_GRACE_MS + 1,
  });
  assert.equal(unresolved?.status, 'transaction_built');
  assert.equal(loadCalls, 0, 'stale unsigned handoffs do not poll forever');
}

{
  const resolved = await resolvePendingLootboxOpen({
    pending: { intentId, savedAt: Date.now() },
    initialIntent: intent('expired'),
    loadIntent: async () => {
      throw new Error('terminal intents must not poll');
    },
  });
  assert.equal(resolved?.status, 'expired');
}

console.log('pending lootbox open tests passed');
