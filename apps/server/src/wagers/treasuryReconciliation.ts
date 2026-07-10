import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { findWagerMemoInParsedTransaction, WAGER_MEMO_PREFIX } from './solana';

const WAGER_TREASURY_SIGNATURE_SCAN_LIMIT = 1_000;
const WAGER_TREASURY_TRANSACTION_LOOKUP_LIMIT = 25;
const SOLANA_BLOCK_TIME_EARLY_TOLERANCE_MS = 1_000;

export interface RecoverableWagerPayment {
  id: string;
  memo: string;
  createdAt: Date;
}

export interface WagerTreasurySignatureInfo {
  signature: string;
  blockTime?: number | null;
  err: unknown;
  memo: string | null;
}

export interface WagerTreasuryReconciliationDependencies {
  findRecoverablePayments(input: {
    expiresAfter: Date;
  }): Promise<RecoverableWagerPayment[]>;
  getLastScannedSignature(input: {
    cluster: string;
    treasuryWallet: string;
  }): Promise<string | null>;
  listSignatures(input: {
    treasuryWallet: string;
    until: string | null;
    limit: number;
  }): Promise<WagerTreasurySignatureInfo[]>;
  loadParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null>;
  claimRecoveredPayment(input: {
    paymentId: string;
    signature: string;
  }): Promise<boolean>;
  setLastScannedSignature(input: {
    cluster: string;
    treasuryWallet: string;
    signature: string;
  }): Promise<void>;
}

export interface WagerTreasuryReconciliationInput {
  cluster: string;
  treasuryWallet: string;
  now: Date;
  intentExpiryGraceMs: number;
}

export interface WagerTreasuryReconciliationResult {
  recoverablePaymentCount: number;
  scannedSignatureCount: number;
  loadedTransactionCount: number;
  recoveredPaymentIds: string[];
}

export function isMonthlyRpcCapacityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b429\b/.test(message) && /monthly capacity limit exceeded/i.test(message);
}

function wagerMemoFromSignatureInfo(memo: string | null): string | null {
  if (!memo) return null;
  const start = memo.indexOf(WAGER_MEMO_PREFIX);
  if (start < 0) return null;
  return memo.slice(start).match(new RegExp(`^${WAGER_MEMO_PREFIX}[A-Za-z0-9_-]+`))?.[0] ?? null;
}

export async function reconcileWagerTreasuryDeposits(
  input: WagerTreasuryReconciliationInput,
  dependencies: WagerTreasuryReconciliationDependencies
): Promise<WagerTreasuryReconciliationResult> {
  const recoverablePayments = await dependencies.findRecoverablePayments({
    expiresAfter: new Date(input.now.getTime() - input.intentExpiryGraceMs),
  });

  if (recoverablePayments.length === 0) {
    return {
      recoverablePaymentCount: 0,
      scannedSignatureCount: 0,
      loadedTransactionCount: 0,
      recoveredPaymentIds: [],
    };
  }

  const lastScannedSignature = await dependencies.getLastScannedSignature({
    cluster: input.cluster,
    treasuryWallet: input.treasuryWallet,
  });
  const signatures = await dependencies.listSignatures({
    treasuryWallet: input.treasuryWallet,
    until: lastScannedSignature,
    limit: WAGER_TREASURY_SIGNATURE_SCAN_LIMIT,
  });
  if (signatures.length === 0) {
    return {
      recoverablePaymentCount: recoverablePayments.length,
      scannedSignatureCount: 0,
      loadedTransactionCount: 0,
      recoveredPaymentIds: [],
    };
  }

  const paymentsByMemo = new Map(recoverablePayments.map((payment) => [payment.memo, payment]));
  const earliestPaymentCreatedAtMs = Math.min(...recoverablePayments.map((payment) => payment.createdAt.getTime()));
  const oldestSignature = signatures[signatures.length - 1];
  if (
    signatures.length === WAGER_TREASURY_SIGNATURE_SCAN_LIMIT
    && (
      oldestSignature.blockTime == null
      || oldestSignature.blockTime * 1_000 + SOLANA_BLOCK_TIME_EARLY_TOLERANCE_MS >= earliestPaymentCreatedAtMs
    )
  ) {
    throw new Error(
      `Treasury reconciliation signature scan limit exceeded before reaching the recoverable payment window (${WAGER_TREASURY_SIGNATURE_SCAN_LIMIT})`
    );
  }

  const signaturesToLoad = signatures.filter((signatureInfo) => {
    if (signatureInfo.err) return false;
    if (
      signatureInfo.blockTime != null
      && signatureInfo.blockTime * 1_000 + SOLANA_BLOCK_TIME_EARLY_TOLERANCE_MS < earliestPaymentCreatedAtMs
    ) {
      return false;
    }
    const hintedMemo = wagerMemoFromSignatureInfo(signatureInfo.memo);
    return Boolean(hintedMemo && paymentsByMemo.has(hintedMemo));
  });
  if (signaturesToLoad.length > WAGER_TREASURY_TRANSACTION_LOOKUP_LIMIT) {
    throw new Error(
      `Treasury reconciliation transaction lookup limit exceeded (${signaturesToLoad.length}/${WAGER_TREASURY_TRANSACTION_LOOKUP_LIMIT})`
    );
  }

  const recoveredPaymentIds: string[] = [];
  let loadedTransactionCount = 0;

  for (const signatureInfo of signaturesToLoad) {
    loadedTransactionCount += 1;
    const transaction = await dependencies.loadParsedTransaction(signatureInfo.signature);
    if (!transaction) {
      throw new Error(`Treasury transaction ${signatureInfo.signature} is not available yet`);
    }
    const parsedMemo = findWagerMemoInParsedTransaction(transaction);
    const payment = parsedMemo ? paymentsByMemo.get(parsedMemo) : null;
    if (!payment) continue;

    const claimed = await dependencies.claimRecoveredPayment({
      paymentId: payment.id,
      signature: signatureInfo.signature,
    });
    if (claimed) recoveredPaymentIds.push(payment.id);
  }

  await dependencies.setLastScannedSignature({
    cluster: input.cluster,
    treasuryWallet: input.treasuryWallet,
    signature: signatures[0].signature,
  });

  return {
    recoverablePaymentCount: recoverablePayments.length,
    scannedSignatureCount: signatures.length,
    loadedTransactionCount,
    recoveredPaymentIds,
  };
}
