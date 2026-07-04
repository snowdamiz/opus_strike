import {
  AddressLookupTableAccount,
  PublicKey,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type AccountInfo,
  type Connection,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';

export const WAGER_NATIVE_SOL_MINT = 'So11111111111111111111111111111111111111112';

const MAX_U64_SLOT = BigInt('18446744073709551615');
const MAX_JUPITER_ERROR_BODY_LENGTH = 500;

export interface WagerGameTokenRuntime {
  mint: PublicKey;
  tokenProgramId: PublicKey;
  decimals: number;
  treasuryTokenAccount: PublicKey;
}

interface JupiterInstructionAccount {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface JupiterApiInstruction {
  programId: string;
  accounts: JupiterInstructionAccount[];
  data: string;
}

export interface JupiterSwapBuildResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number | string;
  computeBudgetInstructions: JupiterApiInstruction[];
  setupInstructions: JupiterApiInstruction[];
  swapInstruction: JupiterApiInstruction;
  cleanupInstruction: JupiterApiInstruction | null;
  otherInstructions: JupiterApiInstruction[];
  tipInstruction: JupiterApiInstruction | null;
  addressesByLookupTableAddress: Record<string, string[]> | null;
  blockhashWithMetadata: {
    blockhash: number[];
    lastValidBlockHeight: number;
  };
}

export interface FetchJupiterSwapBuildInput {
  apiBaseUrl: string;
  apiKey: string;
  inputMint: string;
  outputMint: string;
  amountLamports: bigint;
  taker: string;
  payer?: string;
  destinationTokenAccount: string;
  slippageBps: number;
}

export interface BuiltJupiterSwapTransaction {
  transaction: VersionedTransaction;
  blockhash: string;
  lastValidBlockHeight: number;
}

function readTokenProgramId(accountInfo: AccountInfo<Buffer> | null): PublicKey {
  if (!accountInfo) {
    throw new Error('GAME_TOKEN_MINT account was not found');
  }
  const owner = accountInfo.owner.toBase58();
  if (owner === TOKEN_PROGRAM_ID.toBase58()) return TOKEN_PROGRAM_ID;
  if (owner === TOKEN_2022_PROGRAM_ID.toBase58()) return TOKEN_2022_PROGRAM_ID;
  throw new Error('GAME_TOKEN_MINT must be owned by the SPL Token or Token-2022 program');
}

export async function getWagerGameTokenRuntime(
  connection: Connection,
  mintAddress: string,
  treasuryWalletAddress: string
): Promise<WagerGameTokenRuntime> {
  if (mintAddress === WAGER_NATIVE_SOL_MINT) {
    throw new Error('GAME_TOKEN_MINT must be an SPL token mint, not native SOL');
  }

  const mint = new PublicKey(mintAddress);
  const treasuryWallet = new PublicKey(treasuryWalletAddress);
  const [accountInfo, supply] = await Promise.all([
    connection.getAccountInfo(mint, 'confirmed'),
    connection.getTokenSupply(mint, 'confirmed'),
  ]);
  const tokenProgramId = readTokenProgramId(accountInfo);
  const treasuryTokenAccount = await getAssociatedTokenAddress(
    mint,
    treasuryWallet,
    false,
    tokenProgramId
  );

  return {
    mint,
    tokenProgramId,
    decimals: supply.value.decimals,
    treasuryTokenAccount,
  };
}

function assertObject(value: unknown, fieldName: string): Record<string, unknown> {
  if (typeof value === 'object' && value !== null) return value as Record<string, unknown>;
  throw new Error(`Jupiter ${fieldName} was not an object`);
}

function readString(value: Record<string, unknown>, fieldName: string): string {
  const raw = value[fieldName];
  if (typeof raw === 'string' && raw.trim() !== '') return raw;
  throw new Error(`Jupiter ${fieldName} was missing`);
}

function readInstruction(value: unknown, fieldName: string): JupiterApiInstruction {
  const raw = assertObject(value, fieldName);
  const accounts = raw.accounts;
  if (!Array.isArray(accounts)) {
    throw new Error(`Jupiter ${fieldName}.accounts was not an array`);
  }
  return {
    programId: readString(raw, 'programId'),
    data: readString(raw, 'data'),
    accounts: accounts.map((account, index) => {
      const rawAccount = assertObject(account, `${fieldName}.accounts[${index}]`);
      return {
        pubkey: readString(rawAccount, 'pubkey'),
        isSigner: rawAccount.isSigner === true,
        isWritable: rawAccount.isWritable === true,
      };
    }),
  };
}

function readInstructionArray(value: unknown, fieldName: string): JupiterApiInstruction[] {
  if (!Array.isArray(value)) {
    throw new Error(`Jupiter ${fieldName} was not an array`);
  }
  return value.map((instruction, index) => readInstruction(instruction, `${fieldName}[${index}]`));
}

function readOptionalInstruction(value: unknown, fieldName: string): JupiterApiInstruction | null {
  if (value === null || value === undefined) return null;
  return readInstruction(value, fieldName);
}

function readBlockhashWithMetadata(value: unknown): JupiterSwapBuildResponse['blockhashWithMetadata'] {
  const raw = assertObject(value, 'blockhashWithMetadata');
  const blockhash = raw.blockhash;
  const lastValidBlockHeight = raw.lastValidBlockHeight;
  if (
    !Array.isArray(blockhash)
    || blockhash.length !== 32
    || !blockhash.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
  ) {
    throw new Error('Jupiter blockhashWithMetadata.blockhash was invalid');
  }
  if (
    typeof lastValidBlockHeight !== 'number'
    || !Number.isSafeInteger(lastValidBlockHeight)
    || lastValidBlockHeight <= 0
  ) {
    throw new Error('Jupiter blockhashWithMetadata.lastValidBlockHeight was invalid');
  }
  return { blockhash: blockhash as number[], lastValidBlockHeight };
}

function readLookupTables(value: unknown): Record<string, string[]> | null {
  if (value === null || value === undefined) return null;
  const raw = assertObject(value, 'addressesByLookupTableAddress');
  const entries = Object.entries(raw).map(([key, addresses]) => {
    if (!Array.isArray(addresses) || !addresses.every((address) => typeof address === 'string')) {
      throw new Error('Jupiter addressesByLookupTableAddress contained invalid addresses');
    }
    return [key, addresses as string[]] as const;
  });
  return Object.fromEntries(entries);
}

function parseJupiterSwapBuildResponse(payload: unknown): JupiterSwapBuildResponse {
  const raw = assertObject(payload, 'build response');
  const slippageBps = raw.slippageBps;
  if (typeof slippageBps !== 'number' && typeof slippageBps !== 'string') {
    throw new Error('Jupiter slippageBps was missing');
  }
  return {
    inputMint: readString(raw, 'inputMint'),
    outputMint: readString(raw, 'outputMint'),
    inAmount: readString(raw, 'inAmount'),
    outAmount: readString(raw, 'outAmount'),
    otherAmountThreshold: readString(raw, 'otherAmountThreshold'),
    swapMode: readString(raw, 'swapMode'),
    slippageBps,
    computeBudgetInstructions: readInstructionArray(raw.computeBudgetInstructions, 'computeBudgetInstructions'),
    setupInstructions: readInstructionArray(raw.setupInstructions, 'setupInstructions'),
    swapInstruction: readInstruction(raw.swapInstruction, 'swapInstruction'),
    cleanupInstruction: readOptionalInstruction(raw.cleanupInstruction, 'cleanupInstruction'),
    otherInstructions: readInstructionArray(raw.otherInstructions, 'otherInstructions'),
    tipInstruction: readOptionalInstruction(raw.tipInstruction, 'tipInstruction'),
    addressesByLookupTableAddress: readLookupTables(raw.addressesByLookupTableAddress),
    blockhashWithMetadata: readBlockhashWithMetadata(raw.blockhashWithMetadata),
  };
}

function normalizeJupiterBaseUrl(apiBaseUrl: string): string {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(baseUrl)) {
    throw new Error('Jupiter swap base URL must start with http:// or https://');
  }
  return baseUrl;
}

export async function fetchJupiterSwapBuild(input: FetchJupiterSwapBuildInput): Promise<JupiterSwapBuildResponse> {
  if (!input.apiKey.trim()) {
    throw new Error('JUPITER_API_KEY is required for wager token conversion');
  }
  if (input.amountLamports <= 0n) {
    throw new Error('Jupiter swap amount must be greater than zero');
  }

  const params = new URLSearchParams({
    inputMint: input.inputMint,
    outputMint: input.outputMint,
    amount: input.amountLamports.toString(10),
    taker: input.taker,
    payer: input.payer ?? input.taker,
    destinationTokenAccount: input.destinationTokenAccount,
    slippageBps: input.slippageBps.toString(10),
    wrapAndUnwrapSol: 'true',
  });
  const response = await fetch(`${normalizeJupiterBaseUrl(input.apiBaseUrl)}/build?${params.toString()}`, {
    headers: {
      accept: 'application/json',
      'x-api-key': input.apiKey,
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_JUPITER_ERROR_BODY_LENGTH);
    throw new Error(`Jupiter swap build failed with HTTP ${response.status}: ${body}`);
  }

  return parseJupiterSwapBuildResponse(await response.json() as unknown);
}

function toTransactionInstruction(instruction: JupiterApiInstruction): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(instruction.programId),
    keys: instruction.accounts.map((account) => ({
      pubkey: new PublicKey(account.pubkey),
      isSigner: account.isSigner,
      isWritable: account.isWritable,
    })),
    data: Buffer.from(instruction.data, 'base64'),
  });
}

function toLookupTableAccounts(raw: Record<string, string[]> | null): AddressLookupTableAccount[] {
  if (!raw) return [];
  return Object.entries(raw).map(([lookupTableAddress, addresses]) => new AddressLookupTableAccount({
    key: new PublicKey(lookupTableAddress),
    state: {
      deactivationSlot: MAX_U64_SLOT,
      lastExtendedSlot: 0,
      lastExtendedSlotStartIndex: 0,
      authority: undefined,
      addresses: addresses.map((address) => new PublicKey(address)),
    },
  }));
}

export function buildJupiterSwapTransaction(input: {
  build: JupiterSwapBuildResponse;
  feePayer: PublicKey;
  outputTokenAccount: PublicKey;
  outputMint: PublicKey;
  outputOwner: PublicKey;
  outputTokenProgramId: PublicKey;
}): BuiltJupiterSwapTransaction {
  const blockhash = bs58.encode(Uint8Array.from(input.build.blockhashWithMetadata.blockhash));
  const instructions = [
    createAssociatedTokenAccountIdempotentInstruction(
      input.feePayer,
      input.outputTokenAccount,
      input.outputOwner,
      input.outputMint,
      input.outputTokenProgramId
    ),
    ...input.build.computeBudgetInstructions.map(toTransactionInstruction),
    ...input.build.setupInstructions.map(toTransactionInstruction),
    toTransactionInstruction(input.build.swapInstruction),
    ...(input.build.cleanupInstruction ? [toTransactionInstruction(input.build.cleanupInstruction)] : []),
    ...input.build.otherInstructions.map(toTransactionInstruction),
    ...(input.build.tipInstruction ? [toTransactionInstruction(input.build.tipInstruction)] : []),
  ];

  const message = new TransactionMessage({
    payerKey: input.feePayer,
    recentBlockhash: blockhash,
    instructions,
  }).compileToV0Message(toLookupTableAccounts(input.build.addressesByLookupTableAddress));

  return {
    transaction: new VersionedTransaction(message),
    blockhash,
    lastValidBlockHeight: input.build.blockhashWithMetadata.lastValidBlockHeight,
  };
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

function readTokenBalanceAmount(
  balances: NonNullable<ParsedTransactionWithMeta['meta']>['postTokenBalances'],
  accountIndex: number,
  mintAddress: string
): bigint {
  const balance = balances?.find((entry) => entry.accountIndex === accountIndex && entry.mint === mintAddress);
  const amount = balance?.uiTokenAmount.amount;
  return typeof amount === 'string' && /^[0-9]+$/.test(amount) ? BigInt(amount) : 0n;
}

export function extractTokenAccountMintDelta(
  transaction: ParsedTransactionWithMeta | null,
  tokenAccountAddress: string,
  mintAddress: string
): bigint {
  if (!transaction?.meta) return 0n;
  const accountIndex = transaction.transaction.message.accountKeys.findIndex((accountKey) => (
    accountKeyToString(accountKey) === tokenAccountAddress
  ));
  if (accountIndex < 0) return 0n;
  return readTokenBalanceAmount(transaction.meta.postTokenBalances, accountIndex, mintAddress)
    - readTokenBalanceAmount(transaction.meta.preTokenBalances, accountIndex, mintAddress);
}

export function buildBurnCheckedTransaction(input: {
  feePayer: PublicKey;
  tokenAccount: PublicKey;
  mint: PublicKey;
  authority: PublicKey;
  amountBaseUnits: bigint;
  decimals: number;
  tokenProgramId: PublicKey;
  blockhash: string;
  lastValidBlockHeight: number;
}): Transaction {
  return new Transaction({
    feePayer: input.feePayer,
    blockhash: input.blockhash,
    lastValidBlockHeight: input.lastValidBlockHeight,
  }).add(createBurnCheckedInstruction(
    input.tokenAccount,
    input.mint,
    input.authority,
    input.amountBaseUnits,
    input.decimals,
    [],
    input.tokenProgramId
  ));
}
