import assert from 'node:assert/strict';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import {
  isMonthlyRpcCapacityError,
  reconcileWagerTreasuryDeposits,
  type WagerTreasuryReconciliationDependencies,
} from '../wagers/treasuryReconciliation';
import { createWagerMemo } from '../wagers/solana';

const NOW = new Date('2026-07-10T08:00:00.000Z');

function createDependencies(
  overrides: Partial<WagerTreasuryReconciliationDependencies> = {}
): WagerTreasuryReconciliationDependencies {
  return {
    findRecoverablePayments: async () => [],
    getLastScannedSignature: async () => null,
    listSignatures: async () => [],
    loadParsedTransaction: async () => null,
    claimRecoveredPayment: async () => false,
    setLastScannedSignature: async () => undefined,
    ...overrides,
  };
}

async function skipsSolanaWhenNoPaymentCanBeRecovered(): Promise<void> {
  let signatureListCalls = 0;
  let transactionLoadCalls = 0;
  let cursorWriteCalls = 0;
  const dependencies = createDependencies({
    listSignatures: async () => {
      signatureListCalls += 1;
      return [];
    },
    loadParsedTransaction: async () => {
      transactionLoadCalls += 1;
      return null;
    },
    setLastScannedSignature: async () => {
      cursorWriteCalls += 1;
    },
  });

  const result = await reconcileWagerTreasuryDeposits({
    cluster: 'mainnet-beta',
    treasuryWallet: 'Treasury1111111111111111111111111111111111',
    now: NOW,
    intentExpiryGraceMs: 120_000,
  }, dependencies);

  assert.deepEqual(result, {
    recoverablePaymentCount: 0,
    scannedSignatureCount: 0,
    loadedTransactionCount: 0,
    recoveredPaymentIds: [],
  });
  assert.equal(signatureListCalls, 0);
  assert.equal(transactionLoadCalls, 0);
  assert.equal(cursorWriteCalls, 0);
}

function parsedMemoTransaction(memo: string): ParsedTransactionWithMeta {
  return {
    slot: 123,
    blockTime: Math.floor(NOW.getTime() / 1000),
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [],
      postBalances: [],
      innerInstructions: [],
      logMessages: [],
      postTokenBalances: [],
      preTokenBalances: [],
      rewards: [],
    },
    transaction: {
      signatures: ['sig-payment'],
      message: {
        accountKeys: [],
        instructions: [{
          program: 'spl-memo',
          programId: { toBase58: () => 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr' },
          parsed: memo,
        }],
      },
    },
    version: 'legacy',
  } as unknown as ParsedTransactionWithMeta;
}

async function scansEachTreasurySignatureAtMostOnce(): Promise<void> {
  const paymentMemo = createWagerMemo('intent-a');
  let cursor: string | null = null;
  let transactionLoadCalls = 0;
  const signatureRequests: Array<string | null> = [];
  const dependencies = createDependencies({
    findRecoverablePayments: async () => [{
      id: 'intent-a',
      memo: paymentMemo,
      createdAt: new Date(NOW.getTime() - 30_000),
    }],
    getLastScannedSignature: async () => cursor,
    listSignatures: async ({ until }) => {
      signatureRequests.push(until);
      if (until === 'sig-newest') return [];
      return [
        { signature: 'sig-newest', blockTime: Math.floor(NOW.getTime() / 1000), err: null, memo: null },
        { signature: 'sig-payment', blockTime: Math.floor(NOW.getTime() / 1000), err: null, memo: `[${paymentMemo.length}] ${paymentMemo}` },
      ];
    },
    loadParsedTransaction: async (signature) => {
      transactionLoadCalls += 1;
      assert.equal(signature, 'sig-payment');
      return parsedMemoTransaction(paymentMemo);
    },
    claimRecoveredPayment: async ({ paymentId, signature }) => {
      assert.equal(paymentId, 'intent-a');
      assert.equal(signature, 'sig-payment');
      return true;
    },
    setLastScannedSignature: async ({ signature }) => {
      cursor = signature;
    },
  });
  const input = {
    cluster: 'mainnet-beta',
    treasuryWallet: 'Treasury1111111111111111111111111111111111',
    now: NOW,
    intentExpiryGraceMs: 120_000,
  };

  const first = await reconcileWagerTreasuryDeposits(input, dependencies);
  const second = await reconcileWagerTreasuryDeposits(input, dependencies);

  assert.deepEqual(first, {
    recoverablePaymentCount: 1,
    scannedSignatureCount: 2,
    loadedTransactionCount: 1,
    recoveredPaymentIds: ['intent-a'],
  });
  assert.deepEqual(second, {
    recoverablePaymentCount: 1,
    scannedSignatureCount: 0,
    loadedTransactionCount: 0,
    recoveredPaymentIds: [],
  });
  assert.deepEqual(signatureRequests, [null, 'sig-newest']);
  assert.equal(transactionLoadCalls, 1);
}

async function boundsParsedTransactionLookups(): Promise<void> {
  const paymentMemo = createWagerMemo('intent-a');
  let transactionLoadCalls = 0;
  let cursorWriteCalls = 0;
  const dependencies = createDependencies({
    findRecoverablePayments: async () => [{
      id: 'intent-a',
      memo: paymentMemo,
      createdAt: new Date(NOW.getTime() - 30_000),
    }],
    listSignatures: async () => Array.from({ length: 26 }, (_, index) => ({
      signature: `sig-${index}`,
      blockTime: Math.floor(NOW.getTime() / 1000),
      err: null,
      memo: `[${paymentMemo.length}] ${paymentMemo}`,
    })),
    loadParsedTransaction: async () => {
      transactionLoadCalls += 1;
      return parsedMemoTransaction(paymentMemo);
    },
    setLastScannedSignature: async () => {
      cursorWriteCalls += 1;
    },
  });

  await assert.rejects(
    () => reconcileWagerTreasuryDeposits({
      cluster: 'mainnet-beta',
      treasuryWallet: 'Treasury1111111111111111111111111111111111',
      now: NOW,
      intentExpiryGraceMs: 120_000,
    }, dependencies),
    /transaction lookup limit/
  );
  assert.equal(transactionLoadCalls, 0);
  assert.equal(cursorWriteCalls, 0);
}

async function doesNotAdvancePastAnIncompleteSignatureWindow(): Promise<void> {
  const paymentMemo = createWagerMemo('intent-a');
  let cursorWriteCalls = 0;
  const dependencies = createDependencies({
    findRecoverablePayments: async () => [{
      id: 'intent-a',
      memo: paymentMemo,
      createdAt: new Date(NOW.getTime() - 30_000),
    }],
    listSignatures: async () => Array.from({ length: 1_000 }, (_, index) => ({
      signature: `sig-${index}`,
      blockTime: Math.floor(NOW.getTime() / 1000),
      err: null,
      memo: null,
    })),
    setLastScannedSignature: async () => {
      cursorWriteCalls += 1;
    },
  });

  await assert.rejects(
    () => reconcileWagerTreasuryDeposits({
      cluster: 'mainnet-beta',
      treasuryWallet: 'Treasury1111111111111111111111111111111111',
      now: NOW,
      intentExpiryGraceMs: 120_000,
    }, dependencies),
    /signature scan limit/
  );
  assert.equal(cursorWriteCalls, 0);
}

function identifiesOnlyMonthlyCapacityFailures(): void {
  assert.equal(isMonthlyRpcCapacityError(new Error(
    '429 Too Many Requests: Monthly capacity limit exceeded.'
  )), true);
  assert.equal(isMonthlyRpcCapacityError(new Error(
    '429 Too Many Requests: compute units per second capacity exceeded.'
  )), false);
  assert.equal(isMonthlyRpcCapacityError(new Error('connection reset')), false);
}

async function main(): Promise<void> {
  await skipsSolanaWhenNoPaymentCanBeRecovered();
  await scansEachTreasurySignatureAtMostOnce();
  await boundsParsedTransactionLookups();
  await doesNotAdvancePastAnIncompleteSignatureWindow();
  identifiesOnlyMonthlyCapacityFailures();
  console.log('wager treasury reconciliation tests passed');
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
