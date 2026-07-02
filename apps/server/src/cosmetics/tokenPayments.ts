import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type ParsedInstruction,
  type ParsedTransactionWithMeta,
  type PartiallyDecodedInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';

export const SKIN_PAYMENT_MEMO_PREFIX = 'opus-skin:';
export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export interface BuildSplTokenPaymentTransactionInput {
  connection: Connection;
  walletAddress: string;
  tokenMintAddress: string;
  treasuryWallet: string;
  tokenAmountBaseUnits: string;
  tokenDecimals: number;
  tokenProgramId?: string;
  memo: string;
}

export interface BuiltSplTokenPaymentTransaction {
  transactionBase64: string;
  lastValidBlockHeight: number;
  treasuryTokenAccount: string;
}

export interface VerifySplTokenPaymentInput {
  transaction: ParsedTransactionWithMeta | null;
  walletAddress: string;
  tokenMintAddress: string;
  treasuryTokenAccount: string;
  tokenAmountBaseUnits: string;
  memo: string;
  createdAt: Date;
  expiresAt: Date;
  expiryGraceMs: number;
}

export type VerifySplTokenPaymentReason =
  | 'transaction_not_found'
  | 'transaction_failed'
  | 'missing_sender_signature'
  | 'missing_memo'
  | 'wrong_memo'
  | 'missing_transfer'
  | 'wrong_mint'
  | 'wrong_recipient'
  | 'wrong_authority'
  | 'self_transfer'
  | 'underpayment'
  | 'expired_intent'
  | 'transaction_before_intent'
  | 'unparseable_transaction';

export type VerifySplTokenPaymentResult =
  | { ok: true; amountBaseUnits: string; blockTime: Date | null }
  | { ok: false; reason: VerifySplTokenPaymentReason };

export interface SplTokenMintRuntime {
  decimals: number;
  tokenProgramId: string;
}

export function createSkinPaymentMemo(intentId: string): string {
  return `${SKIN_PAYMENT_MEMO_PREFIX}${intentId}`;
}

export function assertSolanaPublicKey(address: string, fieldName: string): PublicKey {
  try {
    const parsed = new PublicKey(address);
    if (parsed.toBase58() !== address) {
      throw new Error('non-canonical');
    }
    return parsed;
  } catch {
    throw Object.assign(new Error(`${fieldName} must be a valid Solana public key`), { statusCode: 400 });
  }
}

export function signatureLooksValid(signature: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{64,96}$/.test(signature);
}

function supportedTokenProgramId(programId: PublicKey, fieldName = 'tokenProgramId'): PublicKey {
  const base58 = programId.toBase58();
  if (base58 === TOKEN_PROGRAM_ID.toBase58() || base58 === TOKEN_2022_PROGRAM_ID.toBase58()) {
    return programId;
  }
  throw Object.assign(new Error(`${fieldName} must be an SPL Token or Token-2022 program id`), { statusCode: 400 });
}

function readTokenProgramId(tokenProgramId?: string): PublicKey {
  if (!tokenProgramId) return TOKEN_PROGRAM_ID;
  return supportedTokenProgramId(assertSolanaPublicKey(tokenProgramId, 'tokenProgramId'));
}

function readMintOwner(accountInfo: AccountInfo<Buffer> | null): PublicKey {
  if (!accountInfo) {
    throw Object.assign(new Error('tokenMintAddress account was not found'), { statusCode: 400 });
  }
  return supportedTokenProgramId(accountInfo.owner, 'tokenMintAddress owner');
}

export async function getAssociatedTokenAccountAddress(input: {
  ownerAddress: string;
  tokenMintAddress: string;
  tokenProgramId?: string;
}): Promise<string> {
  const owner = assertSolanaPublicKey(input.ownerAddress, 'ownerAddress');
  const mint = assertSolanaPublicKey(input.tokenMintAddress, 'tokenMintAddress');
  const tokenProgramId = readTokenProgramId(input.tokenProgramId);
  return (await getAssociatedTokenAddress(mint, owner, false, tokenProgramId)).toBase58();
}

export async function getSplTokenMintRuntime(
  connection: Connection,
  tokenMintAddress: string
): Promise<SplTokenMintRuntime> {
  const mint = assertSolanaPublicKey(tokenMintAddress, 'tokenMintAddress');
  const [accountInfo, supply] = await Promise.all([
    connection.getAccountInfo(mint, 'confirmed'),
    connection.getTokenSupply(mint, 'confirmed'),
  ]);
  return {
    decimals: supply.value.decimals,
    tokenProgramId: readMintOwner(accountInfo).toBase58(),
  };
}

export async function getSplTokenMintDecimals(
  connection: Connection,
  tokenMintAddress: string
): Promise<number> {
  return (await getSplTokenMintRuntime(connection, tokenMintAddress)).decimals;
}

export async function buildSplTokenPaymentTransaction(
  input: BuildSplTokenPaymentTransactionInput
): Promise<BuiltSplTokenPaymentTransaction> {
  const wallet = assertSolanaPublicKey(input.walletAddress, 'walletAddress');
  const mint = assertSolanaPublicKey(input.tokenMintAddress, 'tokenMintAddress');
  const treasuryWallet = assertSolanaPublicKey(input.treasuryWallet, 'treasuryWallet');
  const tokenProgramId = readTokenProgramId(input.tokenProgramId);
  const sourceTokenAccount = await getAssociatedTokenAddress(mint, wallet, false, tokenProgramId);
  const treasuryTokenAccount = await getAssociatedTokenAddress(mint, treasuryWallet, false, tokenProgramId);
  if (sourceTokenAccount.equals(treasuryTokenAccount)) {
    throw Object.assign(new Error('treasuryWallet must be different from walletAddress'), { statusCode: 400 });
  }
  const latest = await input.connection.getLatestBlockhash('confirmed');

  const transaction = new Transaction({
    feePayer: wallet,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  }).add(
    createAssociatedTokenAccountIdempotentInstruction(
      wallet,
      treasuryTokenAccount,
      treasuryWallet,
      mint,
      tokenProgramId
    ),
    createTransferCheckedInstruction(
      sourceTokenAccount,
      mint,
      treasuryTokenAccount,
      wallet,
      BigInt(input.tokenAmountBaseUnits),
      input.tokenDecimals,
      [],
      tokenProgramId
    ),
    new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(input.memo, 'utf8'),
    })
  );

  return {
    transactionBase64: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString('base64'),
    lastValidBlockHeight: latest.lastValidBlockHeight,
    treasuryTokenAccount: treasuryTokenAccount.toBase58(),
  };
}

function instructionProgramId(instruction: ParsedInstruction | PartiallyDecodedInstruction): string {
  return 'programId' in instruction && instruction.programId
    ? instruction.programId.toBase58()
    : '';
}

function getMemo(instruction: ParsedInstruction | PartiallyDecodedInstruction): string | null {
  const program = 'program' in instruction ? instruction.program : undefined;
  const programId = instructionProgramId(instruction);
  if (program !== 'spl-memo' && programId !== MEMO_PROGRAM_ID.toBase58()) return null;
  if ('parsed' in instruction && typeof instruction.parsed === 'string') {
    return instruction.parsed;
  }
  if ('parsed' in instruction && instruction.parsed && typeof instruction.parsed === 'object') {
    const parsed = instruction.parsed as { memo?: unknown };
    if (typeof parsed.memo === 'string') return parsed.memo;
  }
  if ('data' in instruction && typeof instruction.data === 'string') {
    try {
      return Buffer.from(bs58.decode(instruction.data)).toString('utf8');
    } catch {
      try {
        return Buffer.from(instruction.data, 'base64').toString('utf8');
      } catch {
        return null;
      }
    }
  }
  return null;
}

function getAllInstructions(transaction: ParsedTransactionWithMeta): Array<ParsedInstruction | PartiallyDecodedInstruction> {
  const instructions = [...transaction.transaction.message.instructions];
  for (const inner of transaction.meta?.innerInstructions ?? []) {
    instructions.push(...inner.instructions);
  }
  return instructions;
}

function hasSigner(transaction: ParsedTransactionWithMeta, walletAddress: string): boolean {
  return transaction.transaction.message.accountKeys.some((accountKey) => (
    accountKey.pubkey.toBase58() === walletAddress && accountKey.signer
  ));
}

function parsedTransferInfo(instruction: ParsedInstruction | PartiallyDecodedInstruction): {
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amount: string;
} | null {
  if (!('parsed' in instruction) || !instruction.parsed || typeof instruction.parsed !== 'object') return null;
  const parsed = instruction.parsed as { type?: unknown; info?: any };
  if (parsed.type !== 'transferChecked') return null;
  const info = parsed.info;
  if (!info || typeof info !== 'object') return null;
  const amount = info.tokenAmount?.amount ?? info.amount;
  if (
    typeof info.source !== 'string' ||
    typeof info.mint !== 'string' ||
    typeof info.destination !== 'string' ||
    typeof info.authority !== 'string' ||
    typeof amount !== 'string' ||
    !/^[0-9]+$/.test(amount)
  ) {
    return null;
  }
  return {
    source: info.source,
    mint: info.mint,
    destination: info.destination,
    authority: info.authority,
    amount,
  };
}

export function verifyParsedSplTokenPayment(input: VerifySplTokenPaymentInput): VerifySplTokenPaymentResult {
  const transaction = input.transaction;
  if (!transaction) return { ok: false, reason: 'transaction_not_found' };
  if (transaction.meta?.err) return { ok: false, reason: 'transaction_failed' };
  if (!hasSigner(transaction, input.walletAddress)) return { ok: false, reason: 'missing_sender_signature' };

  const instructions = getAllInstructions(transaction);
  const memo = instructions.map(getMemo).find((value): value is string => typeof value === 'string');
  if (!memo) return { ok: false, reason: 'missing_memo' };
  if (memo !== input.memo) return { ok: false, reason: 'wrong_memo' };

  const blockTime = typeof transaction.blockTime === 'number'
    ? new Date(transaction.blockTime * 1000)
    : null;
  if (blockTime) {
    if (blockTime.getTime() < input.createdAt.getTime() - 5_000) {
      return { ok: false, reason: 'transaction_before_intent' };
    }
    if (blockTime.getTime() > input.expiresAt.getTime() + input.expiryGraceMs) {
      return { ok: false, reason: 'expired_intent' };
    }
  }

  const transfer = instructions
    .map(parsedTransferInfo)
    .find((candidate) => candidate !== null);
  if (!transfer) return { ok: false, reason: 'missing_transfer' };
  if (transfer.mint !== input.tokenMintAddress) return { ok: false, reason: 'wrong_mint' };
  if (transfer.destination !== input.treasuryTokenAccount) return { ok: false, reason: 'wrong_recipient' };
  if (transfer.authority !== input.walletAddress) return { ok: false, reason: 'wrong_authority' };
  if (transfer.source === transfer.destination) return { ok: false, reason: 'self_transfer' };
  if (BigInt(transfer.amount) < BigInt(input.tokenAmountBaseUnits)) {
    return { ok: false, reason: 'underpayment' };
  }

  return {
    ok: true,
    amountBaseUnits: transfer.amount,
    blockTime,
  };
}
