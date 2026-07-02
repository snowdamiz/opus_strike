import assert from 'node:assert/strict';
import {
  Keypair,
  PublicKey,
  Transaction,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {
  MEMO_PROGRAM_ID,
  buildSplTokenPaymentTransaction,
  createSkinPaymentMemo,
  getSplTokenMintRuntime,
  verifyParsedSplTokenPayment,
  type VerifySplTokenPaymentReason,
} from '../cosmetics/tokenPayments';

const wallet = Keypair.generate().publicKey;
const mint = Keypair.generate().publicKey;
const treasuryWallet = Keypair.generate().publicKey;
const treasuryTokenAccount = Keypair.generate().publicKey;
const memo = createSkinPaymentMemo('intent-a');
const createdAt = new Date('2026-06-24T12:00:00.000Z');
const expiresAt = new Date('2026-06-24T12:15:00.000Z');
const tokenAmountBaseUnits = '1000';

function parsedMemoInstruction(value = memo) {
  return {
    program: 'spl-memo',
    programId: MEMO_PROGRAM_ID,
    parsed: { memo: value },
  };
}

function encodedMemoInstruction(value = memo) {
  return {
    programId: MEMO_PROGRAM_ID,
    data: bs58.encode(Buffer.from(value, 'utf8')),
    accounts: [],
  };
}

function transferCheckedInstruction(overrides: Partial<{
  mint: string;
  destination: string;
  authority: string;
  amount: string;
}> = {}) {
  return {
    program: 'spl-token',
    programId: TOKEN_PROGRAM_ID,
    parsed: {
      type: 'transferChecked',
      info: {
        mint: overrides.mint ?? mint.toBase58(),
        destination: overrides.destination ?? treasuryTokenAccount.toBase58(),
        authority: overrides.authority ?? wallet.toBase58(),
        tokenAmount: {
          amount: overrides.amount ?? tokenAmountBaseUnits,
          decimals: 6,
          uiAmount: 0.001,
          uiAmountString: '0.001',
        },
      },
    },
  };
}

function transactionFixture(overrides: {
  signer?: boolean;
  memo?: ReturnType<typeof parsedMemoInstruction> | ReturnType<typeof encodedMemoInstruction> | null;
  transfer?: ReturnType<typeof transferCheckedInstruction> | null;
  metaErr?: unknown;
  blockTime?: number | null;
} = {}): ParsedTransactionWithMeta {
  const instructions = [
    ...(overrides.memo === null ? [] : [overrides.memo ?? parsedMemoInstruction()]),
    ...(overrides.transfer === null ? [] : [overrides.transfer ?? transferCheckedInstruction()]),
  ];
  return {
    slot: 1,
    blockTime: overrides.blockTime === undefined ? Math.floor(createdAt.getTime() / 1000) : overrides.blockTime,
    meta: {
      err: overrides.metaErr ?? null,
      fee: 5000,
      innerInstructions: [],
      loadedAddresses: { readonly: [], writable: [] },
      logMessages: [],
      postBalances: [],
      postTokenBalances: [],
      preBalances: [],
      preTokenBalances: [],
      rewards: [],
    },
    transaction: {
      signatures: ['sig'],
      message: {
        accountKeys: [
          {
            pubkey: wallet,
            signer: overrides.signer ?? true,
            writable: true,
            source: 'transaction',
          },
        ],
        instructions,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
      },
    },
  } as ParsedTransactionWithMeta;
}

function verify(transaction: ParsedTransactionWithMeta | null = transactionFixture()) {
  return verifyParsedSplTokenPayment({
    transaction,
    walletAddress: wallet.toBase58(),
    tokenMintAddress: mint.toBase58(),
    treasuryTokenAccount: treasuryTokenAccount.toBase58(),
    tokenAmountBaseUnits,
    memo,
    createdAt,
    expiresAt,
    expiryGraceMs: 120_000,
  });
}

function assertReason(
  transaction: ParsedTransactionWithMeta | null,
  reason: VerifySplTokenPaymentReason
) {
  assert.deepEqual(verify(transaction), { ok: false, reason });
}

{
  assert.deepEqual(verify(), {
    ok: true,
    amountBaseUnits: tokenAmountBaseUnits,
    blockTime: createdAt,
  });
}

{
  assert.deepEqual(verify(transactionFixture({ memo: encodedMemoInstruction() })), {
    ok: true,
    amountBaseUnits: tokenAmountBaseUnits,
    blockTime: createdAt,
  });
}

{
  assertReason(null, 'transaction_not_found');
  assertReason(transactionFixture({ metaErr: { InstructionError: [1, 'Custom'] } }), 'transaction_failed');
  assertReason(transactionFixture({ signer: false }), 'missing_sender_signature');
  assertReason(transactionFixture({ memo: null }), 'missing_memo');
  assertReason(transactionFixture({ memo: parsedMemoInstruction('wrong') }), 'wrong_memo');
  assertReason(transactionFixture({ transfer: null }), 'missing_transfer');
  assertReason(transactionFixture({ transfer: transferCheckedInstruction({ mint: Keypair.generate().publicKey.toBase58() }) }), 'wrong_mint');
  assertReason(transactionFixture({ transfer: transferCheckedInstruction({ destination: Keypair.generate().publicKey.toBase58() }) }), 'wrong_recipient');
  assertReason(transactionFixture({ transfer: transferCheckedInstruction({ authority: Keypair.generate().publicKey.toBase58() }) }), 'wrong_authority');
  assertReason(transactionFixture({ transfer: transferCheckedInstruction({ amount: '999' }) }), 'underpayment');
  assertReason(
    transactionFixture({ blockTime: Math.floor(new Date('2026-06-24T11:59:00.000Z').getTime() / 1000) }),
    'transaction_before_intent'
  );
  assertReason(
    transactionFixture({ blockTime: Math.floor(new Date('2026-06-24T12:18:00.000Z').getTime() / 1000) }),
    'expired_intent'
  );
}

async function runTransactionBuilderTest() {
  const latestBlockhash = Keypair.generate().publicKey.toBase58();
  const connection = {
    getLatestBlockhash: async () => ({
      blockhash: latestBlockhash,
      lastValidBlockHeight: 12345,
    }),
  };
  const built = await buildSplTokenPaymentTransaction({
    connection: connection as never,
    walletAddress: wallet.toBase58(),
    tokenMintAddress: mint.toBase58(),
    treasuryWallet: treasuryWallet.toBase58(),
    tokenAmountBaseUnits,
    tokenDecimals: 6,
    memo,
  });

  const expectedTreasuryTokenAccount = await getAssociatedTokenAddress(mint, treasuryWallet, false, TOKEN_PROGRAM_ID);
  const transaction = Transaction.from(Buffer.from(built.transactionBase64, 'base64'));

  assert.equal(built.lastValidBlockHeight, 12345);
  assert.equal(built.treasuryTokenAccount, expectedTreasuryTokenAccount.toBase58());
  assert.equal(transaction.feePayer?.toBase58(), wallet.toBase58());
  assert.equal(transaction.recentBlockhash, latestBlockhash);
  assert.equal(transaction.instructions.length, 3);
  assert.equal(transaction.instructions[0].programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  assert.equal(transaction.instructions[1].programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
  assert.equal(transaction.instructions[2].programId.toBase58(), MEMO_PROGRAM_ID.toBase58());
  assert.equal(Buffer.from(transaction.instructions[2].data).toString('utf8'), memo);

  const token2022Built = await buildSplTokenPaymentTransaction({
    connection: connection as never,
    walletAddress: wallet.toBase58(),
    tokenMintAddress: mint.toBase58(),
    treasuryWallet: treasuryWallet.toBase58(),
    tokenAmountBaseUnits,
    tokenDecimals: 6,
    tokenProgramId: TOKEN_2022_PROGRAM_ID.toBase58(),
    memo,
  });
  const expectedTreasuryToken2022Account = await getAssociatedTokenAddress(
    mint,
    treasuryWallet,
    false,
    TOKEN_2022_PROGRAM_ID
  );
  const token2022Transaction = Transaction.from(Buffer.from(token2022Built.transactionBase64, 'base64'));

  assert.equal(token2022Built.treasuryTokenAccount, expectedTreasuryToken2022Account.toBase58());
  assert.equal(token2022Transaction.instructions[0].programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58());
  assert.equal(token2022Transaction.instructions[1].programId.toBase58(), TOKEN_2022_PROGRAM_ID.toBase58());
}

async function runMintRuntimeTest() {
  const connection = {
    getAccountInfo: async (tokenMint: PublicKey) => {
      assert.equal(tokenMint.toBase58(), mint.toBase58());
      return { owner: TOKEN_2022_PROGRAM_ID };
    },
    getTokenSupply: async (tokenMint: PublicKey) => {
      assert.equal(tokenMint.toBase58(), mint.toBase58());
      return { value: { decimals: 6 } };
    },
  };
  assert.deepEqual(await getSplTokenMintRuntime(connection as never, mint.toBase58()), {
    decimals: 6,
    tokenProgramId: TOKEN_2022_PROGRAM_ID.toBase58(),
  });
}

Promise.all([
  runTransactionBuilderTest(),
  runMintRuntimeTest(),
])
  .then(() => {
    console.log('skin token payment tests passed');
  });
