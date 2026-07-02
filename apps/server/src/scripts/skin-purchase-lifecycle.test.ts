import assert from 'node:assert/strict';
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import bs58 from 'bs58';
import {
  MEMO_PROGRAM_ID,
  createSkinPaymentMemo,
} from '../cosmetics/tokenPayments';

type SkinPurchaseIntentRow = {
  id: string;
  userId: string;
  walletAddress: string;
  skinId: string;
  quotedPriceVersion: number;
  tokenMintAddress: string;
  tokenSymbol: string;
  tokenAmountBaseUnits: bigint;
  tokenDecimals: number | null;
  treasuryWallet: string;
  treasuryTokenAccount: string;
  cluster: string;
  memo: string;
  status: string;
  transactionSignature: string | null;
  intentExpiresAt: Date;
  lastValidBlockHeight: bigint | null;
  creditedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type SkinOwnershipRow = {
  userId: string;
  skinId: string;
  source: string;
  purchaseId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
};

const skinId = 'phantom.void-monarch';
const createdAt = new Date('2026-07-01T10:00:00.000Z');

function validSignature(seed: number): string {
  return bs58.encode(Buffer.alloc(64, seed));
}

function parsedMemoInstruction(memo: string) {
  return {
    program: 'spl-memo',
    programId: MEMO_PROGRAM_ID,
    parsed: { memo },
  };
}

function transferCheckedInstruction(input: {
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amount: string;
}) {
  return {
    program: 'spl-token',
    programId: TOKEN_PROGRAM_ID,
    parsed: {
      type: 'transferChecked',
      info: {
        source: input.source,
        mint: input.mint,
        destination: input.destination,
        authority: input.authority,
        tokenAmount: {
          amount: input.amount,
          decimals: 6,
          uiAmount: 2.5,
          uiAmountString: '2.5',
        },
      },
    },
  };
}

function paymentTransactionFixture(intent: SkinPurchaseIntentRow): ParsedTransactionWithMeta {
  return {
    slot: 1,
    blockTime: Math.floor(intent.createdAt.getTime() / 1000),
    meta: {
      err: null,
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
            pubkey: new PublicKey(intent.walletAddress),
            signer: true,
            writable: true,
            source: 'transaction',
          },
        ],
        instructions: [
          parsedMemoInstruction(intent.memo),
          transferCheckedInstruction({
            source: getAssociatedTokenAddressSync(
              new PublicKey(intent.tokenMintAddress),
              new PublicKey(intent.walletAddress),
              false,
              TOKEN_PROGRAM_ID
            ).toBase58(),
            mint: intent.tokenMintAddress,
            destination: intent.treasuryTokenAccount,
            authority: intent.walletAddress,
            amount: intent.tokenAmountBaseUnits.toString(),
          }),
        ],
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
      },
    },
  } as ParsedTransactionWithMeta;
}

function signedTransactionPayload(input: {
  feePayer: PublicKey;
  memo: string;
  signWith?: Keypair;
}): string {
  const transaction = new Transaction({
    feePayer: input.feePayer,
    blockhash: Keypair.generate().publicKey.toBase58(),
    lastValidBlockHeight: 12345,
  }).add(new TransactionInstruction({
    programId: MEMO_PROGRAM_ID,
    keys: [],
    data: Buffer.from(input.memo, 'utf8'),
  }));
  if (input.signWith) transaction.sign(input.signWith);
  return transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }).toString('base64');
}

function createFakePrisma(input: {
  buyerWallet: string;
  tokenMint: string;
  treasuryWallet: string;
  treasuryTokenAccount: string;
}) {
  const shop = {
    id: 'default',
    enabled: true,
    tokenMintAddress: null,
    tokenSymbol: '',
    cluster: 'devnet',
    updatedByUserId: null,
    createdAt,
    updatedAt: createdAt,
  };
  const item: {
    skinId: string;
    saleEnabled: boolean;
    tokenAmountBaseUnits: bigint;
    maxSupply: number | null;
    priceVersion: number;
    updatedByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  } = {
    skinId,
    saleEnabled: true,
    tokenAmountBaseUnits: 2_500_000n,
    maxSupply: 3,
    priceVersion: 7,
    updatedByUserId: 'admin-a',
    createdAt,
    updatedAt: createdAt,
  };
  const users = new Map<string, { id: string; walletAddress: string | null }>([
    ['user-a', { id: 'user-a', walletAddress: input.buyerWallet }],
    ['user-b', { id: 'user-b', walletAddress: input.buyerWallet }],
    ['user-c', { id: 'user-c', walletAddress: input.buyerWallet }],
    ['user-restored', { id: 'user-restored', walletAddress: input.buyerWallet }],
    ['user-no-wallet', { id: 'user-no-wallet', walletAddress: null }],
  ]);
  const intents = new Map<string, SkinPurchaseIntentRow>();
  const ownerships = new Map<string, SkinOwnershipRow>();
  const ownershipKey = (userId: string, ownedSkinId: string) => `${userId}:${ownedSkinId}`;

  function cloneIntent(row: SkinPurchaseIntentRow): SkinPurchaseIntentRow {
    return { ...row };
  }

  function countIntents(where: any): number {
    return Array.from(intents.values()).filter((intent) => {
      if (where.skinId && intent.skinId !== where.skinId) return false;
      if (typeof where.status === 'string' && intent.status !== where.status) return false;
      if (where.OR) {
        return where.OR.some((clause: any) => {
          const statuses: string[] | undefined = clause.status?.in;
          if (statuses && !statuses.includes(intent.status)) return false;
          const expiresAfter: Date | undefined = clause.intentExpiresAt?.gt;
          if (expiresAfter && intent.intentExpiresAt <= expiresAfter) return false;
          return true;
        });
      }
      return true;
    }).length;
  }

  function createIntent(data: any): SkinPurchaseIntentRow {
    const row: SkinPurchaseIntentRow = {
      transactionSignature: null,
      lastValidBlockHeight: null,
      creditedAt: null,
      lastError: null,
      createdAt,
      updatedAt: createdAt,
      ...data,
    };
    intents.set(row.id, row);
    return cloneIntent(row);
  }

  function updateIntent(id: string, data: any): SkinPurchaseIntentRow {
    const row = intents.get(id);
    assert.ok(row, `missing intent ${id}`);
    Object.assign(row, data, { updatedAt: new Date(row.updatedAt.getTime() + 1_000) });
    return cloneIntent(row);
  }

  const skinPurchaseIntent = {
    count: async ({ where }: any) => countIntents(where),
    create: async ({ data }: any) => createIntent(data),
    findUnique: async ({ where }: any) => {
      const row = intents.get(where.id);
      return row ? cloneIntent(row) : null;
    },
    findFirst: async ({ where }: any) => {
      const row = Array.from(intents.values()).find((intent) => (
        intent.transactionSignature === where.transactionSignature &&
        intent.id !== where.id?.not
      ));
      return row ? { id: row.id } : null;
    },
    update: async ({ where, data }: any) => updateIntent(where.id, data),
  };

  const userSkinOwnership = {
    findUnique: async ({ where }: any) => {
      const row = ownerships.get(ownershipKey(where.userId_skinId.userId, where.userId_skinId.skinId));
      return row ? { revokedAt: row.revokedAt } : null;
    },
    upsert: async ({ where, create, update }: any) => {
      const key = ownershipKey(where.userId_skinId.userId, where.userId_skinId.skinId);
      const existing = ownerships.get(key);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      const row: SkinOwnershipRow = {
        purchaseId: null,
        grantedAt: createdAt,
        revokedAt: null,
        ...create,
      };
      ownerships.set(key, row);
      return { ...row };
    },
  };

  const tx = {
    skinShopItemSettings: {
      findUnique: async ({ where }: any) => (where.skinId === skinId ? { ...item } : null),
    },
    skinPurchaseIntent,
    userSkinOwnership,
  };

  return {
    item,
    intents,
    ownerships,
    users,
    ownershipKey,
    prisma: {
      user: {
        findUnique: async ({ where }: any) => users.get(where.id) ?? null,
      },
      skinShopSettings: {
        createMany: async ({ skipDuplicates }: any) => {
          assert.equal(skipDuplicates, true);
          return { count: 0 };
        },
        findUnique: async ({ where }: any) => (where.id === 'default' ? { ...shop } : null),
      },
      skinShopItemSettings: {
        createMany: async ({ skipDuplicates }: any) => {
          assert.equal(skipDuplicates, true);
          return { count: 0 };
        },
        findUnique: async ({ where }: any) => (where.skinId === skinId ? { ...item } : null),
      },
      skinPurchaseIntent,
      userSkinOwnership,
      $transaction: async (operation: any) => operation(tx),
    },
  };
}

async function expectServiceError(
  operation: () => Promise<unknown>,
  message: RegExp,
  statusCode?: number
): Promise<void> {
  await assert.rejects(async () => {
    try {
      await operation();
    } catch (error) {
      if (statusCode !== undefined) {
        assert.equal((error as { statusCode?: number }).statusCode, statusCode);
      }
      throw error;
    }
  }, message);
}

function restoreEnv(previous: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

async function main(): Promise<void> {
  const previousEnv = {
    GAME_TOKEN_MINT: process.env.GAME_TOKEN_MINT,
    GAME_TOKEN_SYMBOL: process.env.GAME_TOKEN_SYMBOL,
    SKIN_SHOP_TOKEN_MINT: process.env.SKIN_SHOP_TOKEN_MINT,
    SKIN_SHOP_TOKEN_SYMBOL: process.env.SKIN_SHOP_TOKEN_SYMBOL,
    SOLANA_CLUSTER: process.env.SOLANA_CLUSTER,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
    WAGER_TREASURY_WALLET: process.env.WAGER_TREASURY_WALLET,
  };

  const buyer = Keypair.generate();
  const payerWallet = Keypair.generate();
  const wrongBuyer = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  const treasuryWallet = Keypair.generate().publicKey;
  const treasuryTokenAccount = await getAssociatedTokenAddress(mint, treasuryWallet, false, TOKEN_PROGRAM_ID);
  const fake = createFakePrisma({
    buyerWallet: buyer.publicKey.toBase58(),
    tokenMint: mint.toBase58(),
    treasuryWallet: treasuryWallet.toBase58(),
    treasuryTokenAccount: treasuryTokenAccount.toBase58(),
  });
  (globalThis as any).prisma = fake.prisma;

  const parsedTransactions = new Map<string, ParsedTransactionWithMeta | null>();
  const skinShop = await import('../cosmetics/skinShopService');
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;
  process.env.GAME_TOKEN_MINT = mint.toBase58();
  process.env.GAME_TOKEN_SYMBOL = 'test';
  process.env.SOLANA_CLUSTER = 'localnet';
  process.env.SOLANA_RPC_URL = 'http://127.0.0.1:8899';
  process.env.WAGER_TREASURY_WALLET = treasuryWallet.toBase58();
  skinShop.setSkinShopConnectionFactoryForTests((rpcUrl) => {
    assert.equal(rpcUrl, 'http://127.0.0.1:8899');
    return {
      getAccountInfo: async (tokenMint: PublicKey) => {
        assert.equal(tokenMint.toBase58(), mint.toBase58());
        return { owner: TOKEN_PROGRAM_ID };
      },
      getTokenSupply: async (tokenMint: PublicKey) => {
        assert.equal(tokenMint.toBase58(), mint.toBase58());
        return { value: { decimals: 6 } };
      },
      getLatestBlockhash: async () => ({
        blockhash: Keypair.generate().publicKey.toBase58(),
        lastValidBlockHeight: 12345,
      }),
      getParsedTransaction: async (signature: string) => parsedTransactions.get(signature) ?? null,
      sendRawTransaction: async () => validSignature(99),
      simulateTransaction: async () => ({ value: { err: null, logs: [] } }),
    } as never;
  });

  try {
    await expectServiceError(
      () => skinShop.createSkinPurchaseIntent({ userId: 'user-no-wallet', skinId, walletAddress: '' }),
      /connected Solana wallet/,
      400
    );
    await expectServiceError(
      () => skinShop.createSkinPurchaseIntent({
        userId: 'user-no-wallet',
        skinId,
        walletAddress: treasuryWallet.toBase58(),
      }),
      /different from WAGER_TREASURY_WALLET/,
      400
    );

    const intent = await skinShop.createSkinPurchaseIntent({
      userId: 'user-no-wallet',
      skinId,
      walletAddress: payerWallet.publicKey.toBase58(),
    });
    const row = fake.intents.get(intent.intentId);
    assert.ok(row);
    assert.equal(intent.status, 'intent_created');
    assert.equal(intent.priceVersion, 7);
    assert.equal(intent.tokenMintAddress, mint.toBase58());
    assert.equal(intent.tokenSymbol, 'TEST');
    assert.equal(intent.tokenAmountBaseUnits, '2500000');
    assert.equal(intent.walletAddress, payerWallet.publicKey.toBase58());
    assert.notEqual(intent.walletAddress, buyer.publicKey.toBase58());
    assert.equal(intent.treasuryTokenAccount, treasuryTokenAccount.toBase58());
    assert.ok(intent.memo.startsWith('opus-skin:'));
    assert.equal(row.memo, createSkinPaymentMemo(intent.intentId));
    assert.equal(row.tokenDecimals, 6);
    assert.equal(row.treasuryWallet, treasuryWallet.toBase58());

    const built = await skinShop.buildSkinPurchaseTransaction({ userId: 'user-no-wallet', intentId: intent.intentId });
    const builtTransaction = Transaction.from(Buffer.from(built.transactionBase64, 'base64'));
    assert.equal(built.lastValidBlockHeight, 12345);
    assert.equal(builtTransaction.feePayer?.toBase58(), payerWallet.publicKey.toBase58());
    assert.equal(built.treasuryTokenAccount, treasuryTokenAccount.toBase58());
    assert.equal(fake.intents.get(intent.intentId)?.status, 'transaction_built');
    assert.equal(fake.intents.get(intent.intentId)?.lastValidBlockHeight, 12345n);

    const expiredIntent = await skinShop.createSkinPurchaseIntent({
      userId: 'user-b',
      skinId,
      walletAddress: payerWallet.publicKey.toBase58(),
    });
    fake.intents.get(expiredIntent.intentId)!.intentExpiresAt = new Date(Date.now() - 1_000);
    const expired = await skinShop.getSkinPurchaseIntent({ userId: 'user-b', intentId: expiredIntent.intentId });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.lastError, 'intent_expired');

    await expectServiceError(
      () => skinShop.submitSignedSkinPurchaseTransaction({
        userId: 'user-no-wallet',
        intentId: intent.intentId,
        signedTransactionBase64: 'not a transaction',
      }),
      /decoded/
    );
    await expectServiceError(
      () => skinShop.submitSignedSkinPurchaseTransaction({
        userId: 'user-no-wallet',
        intentId: intent.intentId,
        signedTransactionBase64: signedTransactionPayload({
          feePayer: wrongBuyer.publicKey,
          memo: row.memo,
        }),
      }),
      /fee payer/
    );
    await expectServiceError(
      () => skinShop.submitSignedSkinPurchaseTransaction({
        userId: 'user-no-wallet',
        intentId: intent.intentId,
        signedTransactionBase64: signedTransactionPayload({
          feePayer: payerWallet.publicKey,
          memo: 'wrong memo',
        }),
      }),
      /memo/
    );
    await expectServiceError(
      () => skinShop.submitSignedSkinPurchaseTransaction({
        userId: 'user-no-wallet',
        intentId: intent.intentId,
        signedTransactionBase64: signedTransactionPayload({
          feePayer: payerWallet.publicKey,
          memo: row.memo,
        }),
      }),
      /missing the wallet signature/
    );

    const signature = validSignature(1);
    parsedTransactions.set(signature, paymentTransactionFixture(row));
    const credited = await skinShop.submitSkinPurchaseSignature({
      userId: 'user-no-wallet',
      intentId: intent.intentId,
      signature,
    });
    assert.equal(credited.status, 'credited');
    const ownership = fake.ownerships.get(fake.ownershipKey('user-no-wallet', skinId));
    assert.ok(ownership);
    assert.equal(ownership.source, 'paid');
    assert.equal(ownership.purchaseId, intent.intentId);
    assert.equal(ownership.revokedAt, null);

    await expectServiceError(
      () => skinShop.buildSkinPurchaseTransaction({ userId: 'user-no-wallet', intentId: intent.intentId }),
      /already credited/,
      409
    );
    await expectServiceError(
      () => skinShop.submitSkinPurchaseSignature({
        userId: 'user-no-wallet',
        intentId: intent.intentId,
        signature: validSignature(2),
      }),
      /already credited/,
      409
    );

    const duplicateIntent = await skinShop.createSkinPurchaseIntent({
      userId: 'user-c',
      skinId,
      walletAddress: payerWallet.publicKey.toBase58(),
    });
    await expectServiceError(
      () => skinShop.submitSkinPurchaseSignature({
        userId: 'user-c',
        intentId: duplicateIntent.intentId,
        signature,
      }),
      /already been used/,
      409
    );

    const selloutIntent = fake.intents.get(duplicateIntent.intentId)!;
    fake.item.maxSupply = 1;
    const selloutSignature = validSignature(3);
    parsedTransactions.set(selloutSignature, paymentTransactionFixture(selloutIntent));
    await expectServiceError(
      () => skinShop.submitSkinPurchaseSignature({
        userId: 'user-c',
        intentId: duplicateIntent.intentId,
        signature: selloutSignature,
      }),
      /Sold out/,
      409
    );
    assert.equal(fake.ownerships.has(fake.ownershipKey('user-c', skinId)), false);

    fake.item.maxSupply = null;
    fake.ownerships.set(fake.ownershipKey('user-restored', skinId), {
      userId: 'user-restored',
      skinId,
      source: 'paid',
      purchaseId: null,
      grantedAt: createdAt,
      revokedAt: new Date('2026-07-01T09:00:00.000Z'),
    });
    const restoreIntent = await skinShop.createSkinPurchaseIntent({
      userId: 'user-restored',
      skinId,
      walletAddress: payerWallet.publicKey.toBase58(),
    });
    const restoreRow = fake.intents.get(restoreIntent.intentId)!;
    const restoreSignature = validSignature(4);
    parsedTransactions.set(restoreSignature, paymentTransactionFixture(restoreRow));
    await skinShop.submitSkinPurchaseSignature({
      userId: 'user-restored',
      intentId: restoreIntent.intentId,
      signature: restoreSignature,
    });
    const restored = fake.ownerships.get(fake.ownershipKey('user-restored', skinId));
    assert.ok(restored);
    assert.equal(restored.revokedAt, null);
    assert.equal(restored.purchaseId, restoreIntent.intentId);
  } finally {
    skinShop.setSkinShopConnectionFactoryForTests(null);
    restoreEnv(previousEnv);
  }

  console.log('skin purchase lifecycle tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
