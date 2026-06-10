import type { ParsedInstruction, ParsedTransactionWithMeta, PartiallyDecodedInstruction } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const WAGER_MEMO_PREFIX = 'opus-wager:';

export type PaymentVerificationFailure =
  | 'transaction_not_found'
  | 'transaction_failed'
  | 'missing_sender_signature'
  | 'missing_memo'
  | 'wrong_memo'
  | 'wrong_sender'
  | 'wrong_recipient'
  | 'underpayment'
  | 'expired_intent'
  | 'transaction_before_intent'
  | 'unparseable_transaction';

export interface ExpectedSolPayment {
  senderWallet: string;
  treasuryWallet: string;
  amountLamports: bigint;
  memo: string;
  createdAt: Date;
  expiresAt: Date;
  expiryGraceMs: number;
}

export interface ParsedSolPayment {
  senderWallet: string;
  recipientWallet: string;
  amountLamports: bigint;
  memo: string;
  blockTime: Date | null;
  slot: number;
  surplusLamports: bigint;
}

export interface SolPaymentVerificationResult {
  ok: boolean;
  payment?: ParsedSolPayment;
  reason?: PaymentVerificationFailure;
  detail?: string;
}

interface ParsedTransfer {
  source: string;
  destination: string;
  lamports: bigint;
}

function accountKeyToString(accountKey: unknown): string {
  if (typeof accountKey === 'string') return accountKey;
  if (accountKey && typeof accountKey === 'object') {
    const key = accountKey as { pubkey?: unknown; toBase58?: () => string; toString?: () => string };
    if (key.pubkey) return accountKeyToString(key.pubkey);
    if (typeof key.toBase58 === 'function') return key.toBase58();
    if (typeof key.toString === 'function') return key.toString();
  }
  return '';
}

function instructionProgramId(instruction: ParsedInstruction | PartiallyDecodedInstruction): string {
  const maybeInstruction = instruction as Partial<ParsedInstruction> & Partial<PartiallyDecodedInstruction>;
  if (maybeInstruction.programId) return accountKeyToString(maybeInstruction.programId);
  return '';
}

function isParsedInstruction(instruction: ParsedInstruction | PartiallyDecodedInstruction): instruction is ParsedInstruction {
  return 'parsed' in instruction;
}

function extractMemoFromInstruction(instruction: ParsedInstruction | PartiallyDecodedInstruction): string | null {
  const programId = instructionProgramId(instruction);
  const program = (instruction as Partial<ParsedInstruction>).program;
  if (program !== 'spl-memo' && programId !== MEMO_PROGRAM_ID.toBase58()) return null;
  if (!isParsedInstruction(instruction)) return null;

  if (typeof instruction.parsed === 'string') return instruction.parsed;
  if (instruction.parsed && typeof instruction.parsed === 'object') {
    const parsed = instruction.parsed as { memo?: unknown };
    return typeof parsed.memo === 'string' ? parsed.memo : null;
  }
  return null;
}

function extractTransferFromInstruction(instruction: ParsedInstruction | PartiallyDecodedInstruction): ParsedTransfer | null {
  if (!isParsedInstruction(instruction)) return null;
  if (instruction.program !== 'system') return null;
  if (!instruction.parsed || typeof instruction.parsed !== 'object') return null;

  const parsed = instruction.parsed as { type?: unknown; info?: Record<string, unknown> };
  if (parsed.type !== 'transfer' || !parsed.info) return null;

  const source = typeof parsed.info.source === 'string' ? parsed.info.source : '';
  const destination = typeof parsed.info.destination === 'string' ? parsed.info.destination : '';
  const rawLamports = parsed.info.lamports;
  const lamports = typeof rawLamports === 'number' && Number.isSafeInteger(rawLamports)
    ? BigInt(rawLamports)
    : typeof rawLamports === 'string' && /^[0-9]+$/.test(rawLamports)
      ? BigInt(rawLamports)
      : null;

  if (!source || !destination || lamports === null) return null;
  return { source, destination, lamports };
}

function getAllInstructions(transaction: ParsedTransactionWithMeta): Array<ParsedInstruction | PartiallyDecodedInstruction> {
  const instructions = [...transaction.transaction.message.instructions];
  for (const inner of transaction.meta?.innerInstructions ?? []) {
    instructions.push(...inner.instructions);
  }
  return instructions;
}

function hasSigner(transaction: ParsedTransactionWithMeta, walletAddress: string): boolean {
  return transaction.transaction.message.accountKeys.some((accountKey) => {
    const key = accountKey as { signer?: boolean };
    return key.signer === true && accountKeyToString(accountKey) === walletAddress;
  });
}

function balanceDeltaForAccount(transaction: ParsedTransactionWithMeta, walletAddress: string): bigint | null {
  const accountIndex = transaction.transaction.message.accountKeys.findIndex((accountKey) => (
    accountKeyToString(accountKey) === walletAddress
  ));
  if (accountIndex < 0) return null;
  const pre = transaction.meta?.preBalances?.[accountIndex];
  const post = transaction.meta?.postBalances?.[accountIndex];
  if (typeof pre !== 'number' || typeof post !== 'number') return null;
  return BigInt(post) - BigInt(pre);
}

export function createWagerMemo(intentId: string): string {
  return `${WAGER_MEMO_PREFIX}${intentId}`;
}

export function findWagerMemoInParsedTransaction(transaction: ParsedTransactionWithMeta | null): string | null {
  if (!transaction) return null;
  return getAllInstructions(transaction)
    .map(extractMemoFromInstruction)
    .find((memo): memo is string => Boolean(memo && memo.startsWith(WAGER_MEMO_PREFIX))) ?? null;
}

export function verifyParsedSolPayment(
  transaction: ParsedTransactionWithMeta | null,
  expected: ExpectedSolPayment
): SolPaymentVerificationResult {
  if (!transaction) {
    return { ok: false, reason: 'transaction_not_found' };
  }
  if (transaction.meta?.err) {
    return { ok: false, reason: 'transaction_failed', detail: JSON.stringify(transaction.meta.err) };
  }
  if (!hasSigner(transaction, expected.senderWallet)) {
    return { ok: false, reason: 'missing_sender_signature' };
  }

  const instructions = getAllInstructions(transaction);
  const memo = instructions.map(extractMemoFromInstruction).find((value): value is string => Boolean(value));
  if (!memo) {
    return { ok: false, reason: 'missing_memo' };
  }
  if (memo !== expected.memo) {
    return { ok: false, reason: 'wrong_memo', detail: memo };
  }

  const blockTime = transaction.blockTime ? new Date(transaction.blockTime * 1000) : null;
  if (blockTime) {
    if (blockTime.getTime() + 1000 < expected.createdAt.getTime()) {
      return { ok: false, reason: 'transaction_before_intent' };
    }
    if (blockTime.getTime() > expected.expiresAt.getTime() + expected.expiryGraceMs) {
      return { ok: false, reason: 'expired_intent' };
    }
  }

  const matchingTransfers = instructions
    .map(extractTransferFromInstruction)
    .filter((transfer): transfer is ParsedTransfer => Boolean(transfer))
    .filter((transfer) => (
      transfer.source === expected.senderWallet &&
      transfer.destination === expected.treasuryWallet
    ));

  const transferredLamports = matchingTransfers.reduce((sum, transfer) => sum + transfer.lamports, 0n);
  const treasuryDelta = balanceDeltaForAccount(transaction, expected.treasuryWallet);
  const receivedLamports = transferredLamports > 0n
    ? transferredLamports
    : treasuryDelta && treasuryDelta > 0n
      ? treasuryDelta
      : 0n;

  if (receivedLamports <= 0n) {
    const sawSenderTransfer = instructions
      .map(extractTransferFromInstruction)
      .filter((transfer): transfer is ParsedTransfer => Boolean(transfer))
      .some((transfer) => transfer.source === expected.senderWallet);
    return { ok: false, reason: sawSenderTransfer ? 'wrong_recipient' : 'wrong_sender' };
  }
  if (receivedLamports < expected.amountLamports) {
    return {
      ok: false,
      reason: 'underpayment',
      detail: `${receivedLamports.toString()}/${expected.amountLamports.toString()}`,
    };
  }

  return {
    ok: true,
    payment: {
      senderWallet: expected.senderWallet,
      recipientWallet: expected.treasuryWallet,
      amountLamports: expected.amountLamports,
      memo,
      blockTime,
      slot: transaction.slot,
      surplusLamports: receivedLamports - expected.amountLamports,
    },
  };
}
