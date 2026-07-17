import assert from 'node:assert/strict';
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  type ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import bs58 from 'bs58';
import { getLootboxEligibleSkins, type HeroSkinId } from '@voxel-strike/shared';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

type LootboxSettingsRow = {
  id: string;
  enabled: boolean;
  priceTokens: string;
  directTokenRewardChanceBps: number;
  directTokenRewardMinTokens: string;
  directTokenRewardMaxTokens: string;
  commonWeightBps: number;
  epicWeightBps: number;
  uniqueWeightBps: number;
  legendaryWeightBps: number;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type DuplicateRewardRow = {
  skinId: string;
  minTokenAmountTokens: string;
  maxTokenAmountTokens: string;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type OwnershipRow = {
  id: string;
  userId: string;
  skinId: string;
  source: string;
  purchaseId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
};

type IntentRow = Record<string, any>;

type FreeOpenRow = {
  userId: string;
  balance: number;
  totalGranted: number;
  lastGrantedById: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function validSignature(seed: number): string {
  return bs58.encode(Buffer.alloc(64, seed));
}

function createFakePrisma() {
  const now = () => new Date();
  let settings: LootboxSettingsRow | null = null;
  const users = [
    { id: 'user-a', name: 'User A' },
    { id: 'user-b', name: 'User B' },
    { id: 'user-c', name: 'User C' },
    { id: 'user-d', name: 'User D' },
  ];
  const ownerships: OwnershipRow[] = [];
  const duplicateRewards = new Map<string, DuplicateRewardRow>();
  const intents = new Map<string, IntentRow>();
  const tokenPayouts = new Map<string, IntentRow>();
  const freeOpenBalances = new Map<string, FreeOpenRow>();
  let ownershipIdCounter = 0;

  const matchesOwnershipWhere = (row: OwnershipRow, where: any): boolean => {
    if (typeof where?.userId === 'string' && row.userId !== where.userId) return false;
    if (where?.revokedAt === null && row.revokedAt !== null) return false;
    return true;
  };

  const matchesIntentWhere = (row: IntentRow, where: any): boolean => {
    if (!where) return true;
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (where.id?.not && row.id === where.id.not) return false;
    if (where.status) {
      if (typeof where.status === 'string' && row.status !== where.status) return false;
      if (Array.isArray(where.status.in) && !where.status.in.includes(row.status)) return false;
    }
    if (where.transactionSignature === null && row.transactionSignature != null) return false;
    if (
      typeof where.transactionSignature === 'string'
      && row.transactionSignature !== where.transactionSignature
    ) return false;
    if (where.transactionSignature?.not === null && row.transactionSignature == null) return false;
    if (typeof where.lastError === 'string' && row.lastError !== where.lastError) return false;
    if (Array.isArray(where.OR) && !where.OR.some((clause: any) => matchesIntentWhere(row, clause))) {
      return false;
    }
    return true;
  };

  const applyNumericUpdate = (row: Record<string, any>, data: any) => {
    for (const [key, value] of Object.entries(data ?? {})) {
      if (value && typeof value === 'object' && 'increment' in (value as any)) {
        row[key] += (value as any).increment;
      } else if (value && typeof value === 'object' && 'decrement' in (value as any)) {
        row[key] -= (value as any).decrement;
      } else {
        row[key] = value;
      }
    }
  };

  const positiveFreeOpenRows = (where: any) => Array.from(freeOpenBalances.values())
    .filter((row) => (where?.balance?.gt !== undefined ? row.balance > where.balance.gt : true));

  const client = {
    user: {
      findUnique: async ({ where }: any) => {
        const user = users.find((entry) => entry.id === where.id);
        return user ? { ...user, walletAddress: null } : null;
      },
      findMany: async ({ where }: any = {}) => users
        .filter((user) => (where?.id?.in ? where.id.in.includes(user.id) : true))
        .map((user) => ({ ...user })),
    },
    lootboxFreeOpenBalance: {
      findUnique: async ({ where }: any) => {
        const row = freeOpenBalances.get(where.userId);
        return row ? { ...row } : null;
      },
      findMany: async ({ where, take }: any = {}) => positiveFreeOpenRows(where)
        .slice(0, take ?? undefined)
        .map((row) => ({
          ...row,
          user: { name: users.find((user) => user.id === row.userId)?.name ?? null },
        })),
      aggregate: async ({ where }: any = {}) => ({
        _sum: {
          balance: positiveFreeOpenRows(where).reduce((sum, row) => sum + row.balance, 0) || null,
        },
      }),
      upsert: async ({ where, create, update }: any) => {
        const existing = freeOpenBalances.get(where.userId);
        if (existing) {
          applyNumericUpdate(existing, update);
          existing.updatedAt = now();
          return { ...existing };
        }
        const created: FreeOpenRow = {
          lastGrantedById: null,
          ...create,
          createdAt: now(),
          updatedAt: now(),
        };
        freeOpenBalances.set(where.userId, created);
        return { ...created };
      },
      update: async ({ where, data }: any) => {
        const row = freeOpenBalances.get(where.userId);
        if (!row) throw new Error('free open balance missing');
        applyNumericUpdate(row, data);
        row.updatedAt = now();
        return { ...row };
      },
    },
    lootboxSettings: {
      createMany: async ({ data }: any) => {
        for (const entry of Array.isArray(data) ? data : [data]) {
          if (!settings) {
            settings = {
              id: entry.id ?? 'default',
              enabled: entry.enabled ?? false,
              priceTokens: entry.priceTokens ?? '75000',
              directTokenRewardChanceBps: entry.directTokenRewardChanceBps ?? 6000,
              directTokenRewardMinTokens: entry.directTokenRewardMinTokens ?? '5000',
              directTokenRewardMaxTokens: entry.directTokenRewardMaxTokens ?? '75000',
              commonWeightBps: entry.commonWeightBps ?? 0,
              epicWeightBps: entry.epicWeightBps ?? 7900,
              uniqueWeightBps: entry.uniqueWeightBps ?? 1800,
              legendaryWeightBps: entry.legendaryWeightBps ?? 300,
              updatedByUserId: null,
              createdAt: now(),
              updatedAt: now(),
            };
          }
        }
        return { count: settings ? 1 : 0 };
      },
      findUnique: async () => (settings ? { ...settings } : null),
      update: async ({ data }: any) => {
        if (!settings) throw new Error('settings missing');
        Object.assign(settings, data, { updatedAt: now() });
        return { ...settings };
      },
    },
    lootboxDuplicateRewardSetting: {
      createMany: async ({ data }: any) => {
        let count = 0;
        for (const entry of Array.isArray(data) ? data : [data]) {
          if (duplicateRewards.has(entry.skinId)) continue;
          duplicateRewards.set(entry.skinId, {
            skinId: entry.skinId,
            minTokenAmountTokens: entry.minTokenAmountTokens,
            maxTokenAmountTokens: entry.maxTokenAmountTokens,
            updatedByUserId: entry.updatedByUserId ?? null,
            createdAt: now(),
            updatedAt: now(),
          });
          count += 1;
        }
        return { count };
      },
      findMany: async () => Array.from(duplicateRewards.values())
        .sort((left, right) => left.skinId.localeCompare(right.skinId))
        .map((row) => ({ ...row })),
      update: async ({ where, data }: any) => {
        const row = duplicateRewards.get(where.skinId);
        if (!row) throw new Error('duplicate reward setting missing');
        Object.assign(row, data, { updatedAt: now() });
        return { ...row };
      },
    },
    userSkinOwnership: {
      findMany: async ({ where }: any = {}) => ownerships
        .filter((row) => matchesOwnershipWhere(row, where))
        .map((row) => ({ ...row })),
      upsert: async ({ where, create, update }: any) => {
        const { userId, skinId } = where.userId_skinId;
        const existing = ownerships.find((row) => row.userId === userId && row.skinId === skinId);
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        ownershipIdCounter += 1;
        const created: OwnershipRow = {
          id: `own-${ownershipIdCounter}`,
          purchaseId: null,
          revokedAt: null,
          ...create,
        };
        ownerships.push(created);
        return { ...created };
      },
    },
    lootboxOpenIntent: {
      create: async ({ data }: any) => {
        const row = {
          transactionSignature: null,
          lastValidBlockHeight: null,
          ...data,
          createdAt: now(),
          updatedAt: now(),
        };
        intents.set(row.id, row);
        return { ...row };
      },
      findUnique: async ({ where }: any) => {
        const row = intents.get(where.id);
        return row ? { ...row } : null;
      },
      findFirst: async ({ where }: any) => {
        for (const row of intents.values()) {
          if (matchesIntentWhere(row, where)) return { ...row };
        }
        return null;
      },
      update: async ({ where, data }: any) => {
        const row = intents.get(where.id);
        if (!row) throw new Error('intent missing');
        Object.assign(row, data, { updatedAt: now() });
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of intents.values()) {
          if (!matchesIntentWhere(row, where)) continue;
          Object.assign(row, data, { updatedAt: now() });
          count += 1;
        }
        return { count };
      },
      count: async ({ where }: any = {}) => Array.from(intents.values())
        .filter((row) => (where?.status ? row.status === where.status : true)).length,
      findMany: async ({ where, take }: any = {}) => Array.from(intents.values())
        .filter((row) => matchesIntentWhere(row, where))
        .slice(0, take ?? undefined)
        .map((row) => ({ ...row })),
    },
    marketplacePurchaseIntent: {
      findMany: async () => [],
    },
    gameTokenPayout: {
      create: async ({ data }: any) => {
        const id = `token-payout-${tokenPayouts.size + 1}`;
        const row = {
          id,
          status: 'pending',
          attemptCount: 0,
          ...data,
          createdAt: now(),
          updatedAt: now(),
        };
        tokenPayouts.set(id, row);
        return { ...row };
      },
    },
    $transaction: async (arg: Array<Promise<unknown>> | ((tx: unknown) => Promise<unknown>)) =>
      (Array.isArray(arg) ? Promise.all(arg) : arg(client)),
  };

  return { prisma: client, ownerships, intents, tokenPayouts, freeOpenBalances, duplicateRewards };
}

async function expectServiceError(operation: () => Promise<unknown>, message: RegExp, statusCode?: number) {
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
          uiAmount: 1,
          uiAmountString: '1',
        },
      },
    },
  };
}

function paymentTransactionFixture(intent: {
  walletAddress: string;
  tokenMintAddress: string;
  treasuryTokenAccount: string;
  tokenAmountBaseUnits: bigint;
  memo: string;
  createdAt: Date;
}, overrides: { amount?: string } = {}): ParsedTransactionWithMeta {
  return {
    slot: 1,
    blockTime: Math.floor(intent.createdAt.getTime() / 1000) + 5,
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
            amount: overrides.amount ?? intent.tokenAmountBaseUnits.toString(),
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

async function runLootboxServiceTests() {
  const previousEnv = {
    treasury: process.env.WAGER_TREASURY_WALLET,
    rpc: process.env.SOLANA_RPC_URL,
    mint: process.env.GAME_TOKEN_MINT,
    symbol: process.env.GAME_TOKEN_SYMBOL,
    settlementSecret: process.env.WAGER_SETTLEMENT_SECRET_KEY,
    legacyMint: process.env.SKIN_SHOP_TOKEN_MINT,
    legacySymbol: process.env.SKIN_SHOP_TOKEN_SYMBOL,
  };

  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  const {
    LootboxServiceError,
    buildLootboxOpenTransaction,
    clearLootboxSettingsCache,
    createLootboxOpenIntent,
    directTokenDropWins,
    getLootboxAdminOverview,
    getLootboxOpenIntent,
    getLootboxStateForUser,
    grantLootboxFreeOpens,
    openLootboxWithFreeCredit,
    reconcilePendingLootboxOpens,
    resolveLootboxRewardForSkin,
    rollLootboxReward,
    rollLootboxSkin,
    setLootboxConnectionFactoryForTests,
    submitSignedLootboxOpenTransaction,
    submitLootboxOpenSignature,
    tokenAmountFromSlidingScaleRolls,
    updateLootboxSettings,
  } = await import('../lootbox/service');

  // Set env AFTER the import: pulling in Prisma loads the developer's .env and
  // would otherwise clobber the hermetic values below.
  const treasurySigner = Keypair.generate();
  const treasuryWallet = treasurySigner.publicKey.toBase58();
  const buyer = Keypair.generate();
  const wrongBuyer = Keypair.generate();
  const buyerWallet = buyer.publicKey.toBase58();
  const mintAddress = 'So11111111111111111111111111111111111111112';
  process.env.WAGER_TREASURY_WALLET = treasuryWallet;
  process.env.SOLANA_RPC_URL = 'https://example.invalid/rpc';
  process.env.GAME_TOKEN_MINT = mintAddress;
  process.env.GAME_TOKEN_SYMBOL = 'STRIKE';
  process.env.WAGER_SETTLEMENT_SECRET_KEY = bs58.encode(treasurySigner.secretKey);
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;

  const parsedTransactions = new Map<string, ParsedTransactionWithMeta | null>();
  const latestBlockhash = Keypair.generate().publicKey.toBase58();
  let broadcastSignature = validSignature(90);
  let broadcastShouldThrow = false;
  const broadcastPayloads: Buffer[] = [];
  setLootboxConnectionFactoryForTests(() => ({
    getAccountInfo: async () => ({ owner: TOKEN_PROGRAM_ID }),
    getTokenSupply: async () => ({ value: { decimals: 6 } }),
    getLatestBlockhash: async () => ({ blockhash: latestBlockhash, lastValidBlockHeight: 12345 }),
    getParsedTransaction: async (signature: string) => parsedTransactions.get(signature) ?? null,
    sendRawTransaction: async (payload: Buffer) => {
      broadcastPayloads.push(Buffer.from(payload));
      if (broadcastShouldThrow) throw new Error('simulated RPC handoff failure');
      return broadcastSignature;
    },
  }) as never);

  const pool = getLootboxEligibleSkins();
  assert.ok(pool.length >= 30, `expected a large lootbox pool, got ${pool.length}`);
  assert.ok(pool.every((skin) => skin.availability !== 'free'), 'free defaults must not be pullable');
  const defaultDuplicateRanges = Object.fromEntries(pool.map((skin) => [
    skin.id,
    (() => {
      const amount = skin.rarity === 'legendary'
        ? '2500'
        : skin.rarity === 'unique'
          ? '1000'
          : skin.rarity === 'epic'
            ? '500'
            : '250';
      return { minTokens: amount, maxTokens: amount };
    })(),
  ])) as Record<HeroSkinId, { minTokens: string; maxTokens: string }>;

  try {
    // --- settings ------------------------------------------------------
    const defaults = await getLootboxAdminOverview();
    assert.equal(defaults.settings.enabled, false);
    assert.equal(defaults.settings.priceTokens, '75000');
    assert.deepEqual(defaults.settings.directTokenReward, {
      chanceBps: 6000,
      range: { minTokens: '5000', maxTokens: '75000' },
    });
    assert.deepEqual(defaults.settings.weights, { common: 0, epic: 7900, unique: 1800, legendary: 300 });
    assert.deepEqual(defaults.settings.duplicateReward, {
      skinTokenRanges: defaultDuplicateRanges,
    });
    assert.equal(defaults.tokenPayoutsReady, true);

    await expectServiceError(
      () => updateLootboxSettings({ priceTokens: '0', updatedByUserId: 'admin' }),
      /greater than zero/
    );
    await expectServiceError(
      () => updateLootboxSettings({ priceTokens: 'abc', updatedByUserId: 'admin' }),
      /whole game-token amount/
    );
    await expectServiceError(
      () => updateLootboxSettings({ priceTokens: '1.5', updatedByUserId: 'admin' }),
      /whole game-token amount/
    );
    await expectServiceError(
      () => updateLootboxSettings({ priceTokens: '1000000000001', updatedByUserId: 'admin' }),
      /cannot exceed/
    );
    await expectServiceError(
      () => updateLootboxSettings({ weights: null, updatedByUserId: 'admin' }),
      /must be an object/
    );
    await expectServiceError(
      () => updateLootboxSettings({
        weights: { common: 0, epic: 0, unique: 0, legendary: 0 },
        updatedByUserId: 'admin',
      }),
      /At least one rarity weight/
    );
    await expectServiceError(
      () => updateLootboxSettings({ weights: { epic: -5 }, updatedByUserId: 'admin' }),
      /epic weight/
    );
    await expectServiceError(
      () => updateLootboxSettings({ directTokenReward: null, updatedByUserId: 'admin' }),
      /Direct token reward settings must be an object/
    );
    await expectServiceError(
      () => updateLootboxSettings({
        directTokenReward: { chanceBps: 10_001 },
        updatedByUserId: 'admin',
      }),
      /Direct token chance/
    );
    await expectServiceError(
      () => updateLootboxSettings({
        directTokenReward: {
          chanceBps: 6000,
          range: { minTokens: '75001', maxTokens: '75000' },
        },
        updatedByUserId: 'admin',
      }),
      /minimum cannot exceed/
    );
    await expectServiceError(
      () => updateLootboxSettings({ duplicateReward: null, updatedByUserId: 'admin' }),
      /must be an object/
    );
    await expectServiceError(
      () => updateLootboxSettings({
        duplicateReward: {
          skinTokenRanges: { [pool[0].id]: { minTokens: '0', maxTokens: '100' } },
        },
        updatedByUserId: 'admin',
      }),
      /greater than zero/
    );
    await expectServiceError(
      () => updateLootboxSettings({
        duplicateReward: {
          skinTokenRanges: { [pool[0].id]: { minTokens: '101', maxTokens: '100' } },
        },
        updatedByUserId: 'admin',
      }),
      /minimum cannot exceed/
    );
    await expectServiceError(
      () => updateLootboxSettings({
        duplicateReward: {
          skinTokenRanges: { unknown_skin: { minTokens: '100', maxTokens: '200' } },
        },
        updatedByUserId: 'admin',
      }),
      /Unknown lootbox skin/
    );

    const updated = await updateLootboxSettings({
      enabled: true,
      priceTokens: '75000',
      directTokenReward: {
        chanceBps: 0,
        range: { minTokens: '5000', maxTokens: '75000' },
      },
      updatedByUserId: 'admin',
    });
    assert.equal(updated.enabled, true);
    assert.equal(updated.priceTokens, '75000');
    assert.equal(updated.directTokenReward.chanceBps, 0);
    clearLootboxSettingsCache();

    // --- state ----------------------------------------------------------
    const state = await getLootboxStateForUser('user-a');
    assert.equal(state.enabled, true);
    assert.equal(state.openDisabledReason, null);
    assert.equal(state.priceTokenBaseUnits, (75_000n * 10n ** 6n).toString());
    assert.equal(state.poolSize, pool.length);
    assert.equal(state.remainingForUser, pool.length);
    const chanceTotal = state.odds.reduce((sum, odds) => sum + odds.chanceBps, 0);
    assert.ok(Math.abs(chanceTotal - 10_000) <= 2, `odds should sum to ~10000 bps, got ${chanceTotal}`);
    const epicOdds = state.odds.find((odds) => odds.rarity === 'epic');
    assert.equal(epicOdds?.chanceBps, 7900);
    assert.equal(state.duplicateChanceBps, 0);

    await updateLootboxSettings({
      directTokenReward: {
        chanceBps: 6000,
        range: { minTokens: '5000', maxTokens: '75000' },
      },
      updatedByUserId: 'admin',
    });
    const directSplitState = await getLootboxStateForUser('user-a');
    assert.equal(directSplitState.directTokenReward.chanceBps, 6000);
    assert.ok(
      Math.abs(directSplitState.odds.reduce((sum, odds) => sum + odds.chanceBps, 0) - 4000) <= 2,
      'skin rarity odds should share the 40% left after a 60% raw-token chance'
    );
    assert.equal(directSplitState.odds.find((odds) => odds.rarity === 'epic')?.chanceBps, 3160);
    await updateLootboxSettings({
      directTokenReward: {
        chanceBps: 0,
        range: { minTokens: '5000', maxTokens: '75000' },
      },
      updatedByUserId: 'admin',
    });

    delete process.env.GAME_TOKEN_MINT;
    const missingMintState = await getLootboxStateForUser('user-a');
    assert.equal(missingMintState.openDisabledReason, 'Game token mint is not configured');
    assert.equal(missingMintState.priceTokenBaseUnits, null);
    assert.equal(missingMintState.tokenSymbol, '');
    process.env.GAME_TOKEN_MINT = mintAddress;

    delete process.env.WAGER_TREASURY_WALLET;
    const missingTreasuryState = await getLootboxStateForUser('user-a');
    assert.equal(missingTreasuryState.openDisabledReason, 'WAGER_TREASURY_WALLET is not configured');
    process.env.WAGER_TREASURY_WALLET = treasuryWallet;

    delete process.env.SOLANA_RPC_URL;
    const missingRpcState = await getLootboxStateForUser('user-a');
    assert.equal(missingRpcState.openDisabledReason, 'SOLANA_RPC_URL is not configured');
    assert.equal(missingRpcState.rpcConfigured, false);
    assert.equal(missingRpcState.priceTokenBaseUnits, null);
    process.env.SOLANA_RPC_URL = 'https://example.invalid/rpc';

    // --- roll mechanics --------------------------------------------------
    const weights = { common: 0, epic: 7900, unique: 1800, legendary: 300 };
    const everything = new Set(pool.map((skin) => skin.id));
    assert.equal(rollLootboxSkin(everything, weights), null, 'complete collection rolls nothing');

    const allButLegendaries = new Set(
      pool.filter((skin) => skin.rarity !== 'legendary').map((skin) => skin.id)
    );
    for (let i = 0; i < 50; i += 1) {
      const rolled = rollLootboxSkin(allButLegendaries, weights);
      assert.ok(rolled, 'roll should land while legendaries remain');
      assert.equal(rolled!.rarity, 'legendary', 'only unowned rarities are rollable');
      assert.ok(!allButLegendaries.has(rolled!.id));
    }

    const uniformRoll = rollLootboxSkin(new Set(), { common: 0, epic: 0, unique: 0, legendary: 0 });
    assert.ok(uniformRoll, 'all-zero weights fall back to a uniform pick');
    const fixedDuplicateSkin = pool.find((skin) => skin.rarity === 'epic')!;
    const fixedDuplicateReward = {
      skinTokenRanges: {
        ...defaultDuplicateRanges,
        [fixedDuplicateSkin.id]: { minTokens: '777', maxTokens: '777' },
      },
    };
    assert.deepEqual(
      resolveLootboxRewardForSkin(fixedDuplicateSkin, new Set(), fixedDuplicateReward),
      { kind: 'skin', skin: fixedDuplicateSkin },
      'ownership must not affect which skin was selected'
    );
    assert.deepEqual(resolveLootboxRewardForSkin(
      fixedDuplicateSkin,
      new Set([fixedDuplicateSkin.id]),
      fixedDuplicateReward
    ), {
      kind: 'game_token',
      source: 'duplicate',
      skin: fixedDuplicateSkin,
      amountTokens: '777',
    });
    assert.equal(directTokenDropWins(0, 0), false, '0% direct drops never win');
    assert.equal(directTokenDropWins(6000, 5999), true, 'rolls below the configured chance win');
    assert.equal(directTokenDropWins(6000, 6000), false, 'the chance boundary is exclusive');
    assert.equal(directTokenDropWins(10_000, 9999), true, '100% direct drops always win');
    assert.deepEqual(
      rollLootboxReward(new Set(), weights, fixedDuplicateReward, {
        chanceBps: 10_000,
        range: { minTokens: '4321', maxTokens: '4321' },
      }),
      { kind: 'game_token', source: 'direct', amountTokens: '4321' },
      'a direct token outcome bypasses the skin pool'
    );

    assert.equal(
      tokenAmountFromSlidingScaleRolls({ minTokens: '5000', maxTokens: '75000' }, 0, 10_000),
      '5000',
      'a minimum roll returns the configured minimum'
    );
    assert.equal(
      tokenAmountFromSlidingScaleRolls({ minTokens: '5000', maxTokens: '75000' }, 10_000, 10_000),
      '75000',
      'the maximum remains reachable'
    );
    let lowerHalfOutcomes = 0;
    let upperHalfOutcomes = 0;
    for (let first = 0; first <= 100; first += 1) {
      for (let second = 0; second <= 100; second += 1) {
        const amount = BigInt(tokenAmountFromSlidingScaleRolls(
          { minTokens: '1', maxTokens: '10001' },
          first * 100,
          second * 100
        ));
        if (amount < 5001n) lowerHalfOutcomes += 1;
        else upperHalfOutcomes += 1;
      }
    }
    const lowerHalfShare = lowerHalfOutcomes / (lowerHalfOutcomes + upperHalfOutcomes);
    assert.ok(
      lowerHalfShare > 0.74 && lowerHalfShare < 0.76,
      `lower half should receive about 75% of the sliding scale (${lowerHalfShare})`
    );

    for (const onlyMissing of pool) {
      const owned = new Set(pool.filter((skin) => skin.id !== onlyMissing.id).map((skin) => skin.id));
      assert.equal(
        rollLootboxSkin(owned, weights)?.id,
        onlyMissing.id,
        `the sole unowned skin ${onlyMissing.id} must be selected`
      );
    }

    const remainingEpic = pool.find((skin) => skin.rarity === 'epic')!;
    const remainingUnique = pool.find((skin) => skin.rarity === 'unique')!;
    const ownedExceptWeightedPair = new Set(
      pool
        .filter((skin) => skin.id !== remainingEpic.id && skin.id !== remainingUnique.id)
        .map((skin) => skin.id)
    );
    for (let i = 0; i < 250; i += 1) {
      assert.equal(
        rollLootboxSkin(ownedExceptWeightedPair, { common: 0, epic: 1, unique: 0, legendary: 0 })?.id,
        remainingEpic.id,
        'zero-weight rarities must not win while a positive-weight rarity remains'
      );
    }

    // --- intent creation --------------------------------------------------
    await expectServiceError(
      () => createLootboxOpenIntent({ userId: 'user-a', walletAddress: '' }),
      /connected Solana wallet/
    );
    await expectServiceError(
      () => createLootboxOpenIntent({ userId: 'missing-user', walletAddress: buyerWallet }),
      /Sign in/,
      401
    );
    await expectServiceError(
      () => createLootboxOpenIntent({ userId: 'user-a', walletAddress: treasuryWallet }),
      /different from WAGER_TREASURY_WALLET/
    );

    await updateLootboxSettings({
      weights: { common: 0, epic: 1, unique: 0, legendary: 0 },
      updatedByUserId: 'admin',
    });
    const intent = await createLootboxOpenIntent({ userId: 'user-a', walletAddress: buyerWallet });
    assert.equal(intent.status, 'intent_created');
    assert.ok(intent.memo.startsWith('opus-lootbox:'), 'memo carries the lootbox prefix');
    assert.equal(intent.tokenAmountBaseUnits, (75_000n * 10n ** 6n).toString());
    assert.equal(intent.priceTokens, '75000');
    assert.equal(intent.tokenSymbol, 'STRIKE');
    assert.deepEqual(intent.quotedWeights, { common: 0, epic: 1, unique: 0, legendary: 0 });
    assert.deepEqual(intent.quotedDirectTokenReward, {
      chanceBps: 0,
      range: { minTokens: '5000', maxTokens: '75000' },
    });
    assert.deepEqual(intent.quotedDuplicateReward, {
      skinTokenRanges: defaultDuplicateRanges,
    });
    assert.deepEqual(
      fake.intents.get(intent.intentId)?.quotedSkinIds,
      pool.map((skin) => skin.id),
      'paid intents snapshot the exact eligible skin pool'
    );
    assert.deepEqual({
      common: fake.intents.get(intent.intentId)?.quotedCommonWeightBps,
      epic: fake.intents.get(intent.intentId)?.quotedEpicWeightBps,
      unique: fake.intents.get(intent.intentId)?.quotedUniqueWeightBps,
      legendary: fake.intents.get(intent.intentId)?.quotedLegendaryWeightBps,
    }, intent.quotedWeights);

    // Admin changes after intent creation must not alter the paid open's odds.
    await updateLootboxSettings({
      weights: { common: 0, epic: 0, unique: 1, legendary: 0 },
      directTokenReward: {
        chanceBps: 10_000,
        range: { minTokens: '8888', maxTokens: '8888' },
      },
      updatedByUserId: 'admin',
    });

    // --- transaction construction, signed payload validation + credit ------
    const storedIntent = fake.intents.get(intent.intentId)!;
    await expectServiceError(
      () => getLootboxOpenIntent({ userId: 'user-b', intentId: intent.intentId }),
      /not found/,
      404
    );

    const built = await buildLootboxOpenTransaction({ userId: 'user-a', intentId: intent.intentId });
    const builtTransaction = Transaction.from(Buffer.from(built.transactionBase64, 'base64'));
    assert.equal(built.lastValidBlockHeight, 12345);
    assert.equal(builtTransaction.feePayer?.toBase58(), buyerWallet);
    assert.equal(builtTransaction.recentBlockhash, latestBlockhash);
    assert.equal(builtTransaction.instructions.length, 3);
    assert.equal(builtTransaction.instructions[1].programId.toBase58(), TOKEN_PROGRAM_ID.toBase58());
    assert.equal(builtTransaction.instructions[1].data.readBigUInt64LE(1).toString(), storedIntent.tokenAmountBaseUnits.toString());
    assert.equal(builtTransaction.instructions[2].programId.toBase58(), MEMO_PROGRAM_ID.toBase58());
    assert.equal(Buffer.from(builtTransaction.instructions[2].data).toString('utf8'), intent.memo);
    assert.equal(fake.intents.get(intent.intentId)?.status, 'transaction_built');
    assert.equal(fake.intents.get(intent.intentId)?.lastValidBlockHeight, 12345n);

    await expectServiceError(
      () => submitSignedLootboxOpenTransaction({
        userId: 'user-a',
        intentId: intent.intentId,
        signedTransactionBase64: 'not a transaction',
      }),
      /decoded/
    );
    await expectServiceError(
      () => submitSignedLootboxOpenTransaction({
        userId: 'user-a',
        intentId: intent.intentId,
        signedTransactionBase64: signedTransactionPayload({
          feePayer: wrongBuyer.publicKey,
          memo: storedIntent.memo,
          signWith: wrongBuyer,
        }),
      }),
      /fee payer/
    );
    await expectServiceError(
      () => submitSignedLootboxOpenTransaction({
        userId: 'user-a',
        intentId: intent.intentId,
        signedTransactionBase64: signedTransactionPayload({
          feePayer: buyer.publicKey,
          memo: 'wrong memo',
          signWith: buyer,
        }),
      }),
      /memo/
    );
    await expectServiceError(
      () => submitSignedLootboxOpenTransaction({
        userId: 'user-a',
        intentId: intent.intentId,
        signedTransactionBase64: signedTransactionPayload({
          feePayer: buyer.publicKey,
          memo: storedIntent.memo,
        }),
      }),
      /missing the wallet signature/
    );
    assert.equal(broadcastPayloads.length, 0, 'invalid signed payloads must never be broadcast');

    builtTransaction.sign(buyer);
    const signature = bs58.encode(builtTransaction.signature!);
    broadcastSignature = signature;
    parsedTransactions.set(signature, paymentTransactionFixture({
      walletAddress: storedIntent.walletAddress,
      tokenMintAddress: storedIntent.tokenMintAddress,
      treasuryTokenAccount: storedIntent.treasuryTokenAccount,
      tokenAmountBaseUnits: storedIntent.tokenAmountBaseUnits,
      memo: storedIntent.memo,
      createdAt: storedIntent.createdAt,
    }));
    const credited = await submitSignedLootboxOpenTransaction({
      userId: 'user-a',
      intentId: intent.intentId,
      signedTransactionBase64: builtTransaction.serialize().toString('base64'),
    });
    assert.equal(broadcastPayloads.length, 1, 'a valid signed transaction is broadcast exactly once');
    assert.equal(credited.status, 'credited');
    assert.ok(credited.resultSkinId, 'credited open must reveal a skin');
    assert.equal(credited.resultRarity, 'epic', 'crediting uses the immutable intent weights');
    const grantedSkinId = credited.resultSkinId!;
    const ownership = fake.ownerships.find((row) => row.userId === 'user-a' && row.skinId === grantedSkinId);
    assert.ok(ownership && ownership.revokedAt === null, 'skin ownership is granted');
    assert.equal(ownership!.source, 'lootbox');
    const grantedSkin = pool.find((skin) => skin.id === grantedSkinId);
    assert.ok(grantedSkin, 'granted skin comes from the pool');
    assert.equal(credited.resultRarity, grantedSkin!.rarity);

    await updateLootboxSettings({
      weights: { common: 0, epic: 7900, unique: 1800, legendary: 300 },
      directTokenReward: {
        chanceBps: 0,
        range: { minTokens: '5000', maxTokens: '75000' },
      },
      updatedByUserId: 'admin',
    });

    const recoveryIntent = await createLootboxOpenIntent({ userId: 'user-d', walletAddress: buyerWallet });
    const recoveryStored = fake.intents.get(recoveryIntent.intentId)!;
    const recoveryBuilt = await buildLootboxOpenTransaction({
      userId: 'user-d',
      intentId: recoveryIntent.intentId,
    });
    const recoveryTransaction = Transaction.from(Buffer.from(recoveryBuilt.transactionBase64, 'base64'));
    recoveryTransaction.sign(buyer);
    const recoverySignature = bs58.encode(recoveryTransaction.signature!);
    broadcastSignature = recoverySignature;
    broadcastShouldThrow = true;
    const awaitingRecovery = await submitSignedLootboxOpenTransaction({
      userId: 'user-d',
      intentId: recoveryIntent.intentId,
      signedTransactionBase64: recoveryTransaction.serialize().toString('base64'),
    });
    broadcastShouldThrow = false;
    assert.equal(awaitingRecovery.status, 'submitted');
    assert.equal(
      fake.intents.get(recoveryIntent.intentId)?.transactionSignature,
      recoverySignature,
      'the deterministic signature is durable before broadcast returns'
    );
    parsedTransactions.set(recoverySignature, paymentTransactionFixture({
      walletAddress: recoveryStored.walletAddress,
      tokenMintAddress: recoveryStored.tokenMintAddress,
      treasuryTokenAccount: recoveryStored.treasuryTokenAccount,
      tokenAmountBaseUnits: recoveryStored.tokenAmountBaseUnits,
      memo: recoveryStored.memo,
      createdAt: recoveryStored.createdAt,
    }));
    const recovered = await reconcilePendingLootboxOpens();
    assert.equal(recovered.credited, 1);
    assert.equal(fake.intents.get(recoveryIntent.intentId)?.status, 'credited');

    // Idempotent: re-reading the intent never re-rolls.
    const reread = await getLootboxOpenIntent({ userId: 'user-a', intentId: intent.intentId });
    assert.equal(reread.status, 'credited');
    assert.equal(reread.resultSkinId, grantedSkinId);

    // --- ownership does not exclude skins from the pull pool ----------------
    const missingSkin = pool.find((skin) => skin.id !== grantedSkinId)!;
    for (const skin of pool) {
      if (skin.id === missingSkin.id) continue;
      const existing = fake.ownerships.find((row) => row.userId === 'user-a' && row.skinId === skin.id);
      if (!existing) {
        fake.ownerships.push({
          id: `seed-${skin.id}`,
          userId: 'user-a',
          skinId: skin.id,
          source: 'admin_grant',
          purchaseId: null,
          grantedAt: new Date(),
          revokedAt: null,
        });
      }
    }
    const almostDone = await getLootboxStateForUser('user-a');
    assert.equal(almostDone.remainingForUser, 1);
    assert.ok(almostDone.duplicateChanceBps > 0 && almostDone.duplicateChanceBps < 10_000);
    assert.deepEqual(
      almostDone.odds.map(({ rarity, chanceBps }) => ({ rarity, chanceBps })),
      state.odds.map(({ rarity, chanceBps }) => ({ rarity, chanceBps })),
      'ownership must not alter the rarity pull rates'
    );
    const ownedBeforeSecond = new Set(
      fake.ownerships
        .filter((row) => row.userId === 'user-a' && row.revokedAt === null)
        .map((row) => row.skinId)
    );

    const secondIntent = await createLootboxOpenIntent({ userId: 'user-a', walletAddress: buyerWallet });
    const secondStored = fake.intents.get(secondIntent.intentId)!;
    const secondSignature = validSignature(2);
    parsedTransactions.set(secondSignature, paymentTransactionFixture({
      walletAddress: secondStored.walletAddress,
      tokenMintAddress: secondStored.tokenMintAddress,
      treasuryTokenAccount: secondStored.treasuryTokenAccount,
      tokenAmountBaseUnits: secondStored.tokenAmountBaseUnits,
      memo: secondStored.memo,
      createdAt: secondStored.createdAt,
    }));
    const secondCredited = await submitLootboxOpenSignature({
      userId: 'user-a',
      intentId: secondIntent.intentId,
      signature: secondSignature,
    });
    assert.equal(secondCredited.status, 'credited');
    assert.ok(secondCredited.resultSkinId && pool.some((skin) => skin.id === secondCredited.resultSkinId));
    if (secondCredited.resultKind === 'game_token') {
      assert.equal(ownedBeforeSecond.has(secondCredited.resultSkinId!), true);
      assert.ok(secondCredited.tokenPayoutId, 'an owned pull queues its conversion payout');
    } else {
      assert.equal(secondCredited.resultSkinId, missingSkin.id, 'an unowned result grants the selected skin');
    }

    // Completed collections keep opening and convert every selected skin.
    if (!fake.ownerships.some((row) => row.userId === 'user-a' && row.skinId === missingSkin.id)) {
      fake.ownerships.push({
        id: `seed-${missingSkin.id}`,
        userId: 'user-a',
        skinId: missingSkin.id,
        source: 'admin_grant',
        purchaseId: null,
        grantedAt: new Date(),
        revokedAt: null,
      });
    }
    const collectionCompleteState = await getLootboxStateForUser('user-a');
    assert.equal(collectionCompleteState.remainingForUser, 0);
    assert.equal(collectionCompleteState.duplicateChanceBps, 10_000);
    assert.equal(collectionCompleteState.openDisabledReason, null);

    // --- underpayment fails, never grants ----------------------------------
    const freshIntent = await createLootboxOpenIntent({ userId: 'user-b', walletAddress: buyerWallet });
    await expectServiceError(
      () => submitLootboxOpenSignature({
        userId: 'user-b',
        intentId: freshIntent.intentId,
        signature,
      }),
      /already been used/,
      409
    );
    await expectServiceError(
      () => submitLootboxOpenSignature({
        userId: 'user-b',
        intentId: freshIntent.intentId,
        signature: 'not-a-signature',
      }),
      /Invalid Solana transaction signature/
    );
    const freshStored = fake.intents.get(freshIntent.intentId)!;
    const badSignature = validSignature(3);
    parsedTransactions.set(badSignature, paymentTransactionFixture({
      walletAddress: freshStored.walletAddress,
      tokenMintAddress: freshStored.tokenMintAddress,
      treasuryTokenAccount: freshStored.treasuryTokenAccount,
      tokenAmountBaseUnits: freshStored.tokenAmountBaseUnits,
      memo: freshStored.memo,
      createdAt: freshStored.createdAt,
    }, { amount: '1' }));
    const failed = await submitLootboxOpenSignature({
      userId: 'user-b',
      intentId: freshIntent.intentId,
      signature: badSignature,
    });
    assert.equal(failed.status, 'failed');
    assert.equal(failed.lastError, 'underpayment');
    assert.equal(failed.resultSkinId, null);
    assert.equal(
      fake.ownerships.filter((row) => row.userId === 'user-b').length,
      0,
      'failed payments never grant skins'
    );

    // --- confirmation delay + polling retry -------------------------------
    const delayedIntent = await createLootboxOpenIntent({ userId: 'user-c', walletAddress: buyerWallet });
    const delayedStored = fake.intents.get(delayedIntent.intentId)!;
    const delayedSignature = validSignature(4);
    const pending = await submitLootboxOpenSignature({
      userId: 'user-c',
      intentId: delayedIntent.intentId,
      signature: delayedSignature,
    });
    assert.equal(pending.status, 'submitted');
    assert.equal(pending.lastError, 'transaction_not_found');
    assert.equal(fake.ownerships.some((row) => row.userId === 'user-c'), false);

    const pendingReconciliation = await reconcilePendingLootboxOpens();
    assert.deepEqual(pendingReconciliation, {
      scanned: 1,
      credited: 0,
      pending: 1,
      terminal: 0,
      failures: [],
    });

    parsedTransactions.set(delayedSignature, paymentTransactionFixture({
      walletAddress: delayedStored.walletAddress,
      tokenMintAddress: delayedStored.tokenMintAddress,
      treasuryTokenAccount: delayedStored.treasuryTokenAccount,
      tokenAmountBaseUnits: delayedStored.tokenAmountBaseUnits,
      memo: delayedStored.memo,
      createdAt: delayedStored.createdAt,
    }));
    const creditedReconciliation = await reconcilePendingLootboxOpens();
    assert.deepEqual(creditedReconciliation, {
      scanned: 1,
      credited: 1,
      pending: 0,
      terminal: 0,
      failures: [],
    });
    const delayedCredited = await getLootboxOpenIntent({
      userId: 'user-c',
      intentId: delayedIntent.intentId,
    });
    assert.equal(delayedCredited.status, 'credited');
    assert.ok(delayedCredited.resultSkinId);

    const staleSubmittedIntent = await createLootboxOpenIntent({
      userId: 'user-c',
      walletAddress: buyerWallet,
    });
    await submitLootboxOpenSignature({
      userId: 'user-c',
      intentId: staleSubmittedIntent.intentId,
      signature: validSignature(5),
    });
    fake.intents.get(staleSubmittedIntent.intentId)!.intentExpiresAt = new Date(Date.now() - 5 * 60 * 1000);
    const expiredReconciliation = await reconcilePendingLootboxOpens();
    assert.equal(expiredReconciliation.scanned, 1);
    assert.equal(expiredReconciliation.terminal, 1);
    const staleExpired = await getLootboxOpenIntent({
      userId: 'user-c',
      intentId: staleSubmittedIntent.intentId,
    });
    assert.equal(staleExpired.status, 'expired');
    assert.equal(staleExpired.lastError, 'expired_intent');

    const expiringIntent = await createLootboxOpenIntent({ userId: 'user-c', walletAddress: buyerWallet });
    fake.intents.get(expiringIntent.intentId)!.intentExpiresAt = new Date(Date.now() - 1_000);
    const expired = await getLootboxOpenIntent({ userId: 'user-c', intentId: expiringIntent.intentId });
    assert.equal(expired.status, 'expired');
    assert.equal(expired.lastError, 'intent_expired');
    await expectServiceError(
      () => buildLootboxOpenTransaction({ userId: 'user-c', intentId: expiringIntent.intentId }),
      /expired/,
      409
    );

    // --- admin overview ------------------------------------------------------
    const overview = await getLootboxAdminOverview();
    assert.equal(overview.totalOpens, 4);
    assert.equal(overview.recentResults.length, 4);
    assert.equal(overview.freeOpens.totalOutstanding, 0);

    // --- free opens ------------------------------------------------------------
    await expectServiceError(
      () => grantLootboxFreeOpens({ userIds: [], count: 1, grantedByUserId: 'admin' }),
      /at least one user id/
    );
    await expectServiceError(
      () => grantLootboxFreeOpens({ userIds: ['user-b'], count: 0, grantedByUserId: 'admin' }),
      /between 1 and/
    );
    await expectServiceError(
      () => openLootboxWithFreeCredit({ userId: 'user-b', walletAddress: buyerWallet }),
      /No free crate opens/
    );
    await expectServiceError(
      () => openLootboxWithFreeCredit({ userId: 'missing-user' }),
      /Sign in/,
      401
    );
    await expectServiceError(
      () => grantLootboxFreeOpens({ userIds: ['user-b'], count: 1001, grantedByUserId: 'admin' }),
      /between 1 and/
    );

    const grant = await grantLootboxFreeOpens({
      userIds: [' user-b ', 'user-b', 'ghost-user'],
      count: '2',
      grantedByUserId: 'admin',
    });
    assert.equal(grant.granted.length, 1);
    assert.equal(grant.granted[0].userId, 'user-b');
    assert.equal(grant.granted[0].balance, 2);
    assert.deepEqual(grant.skippedUserIds, ['ghost-user']);

    // Free opens survive the paid-open gate: disable lootboxes entirely.
    await updateLootboxSettings({ enabled: false, updatedByUserId: 'admin' });
    clearLootboxSettingsCache();
    await expectServiceError(
      () => createLootboxOpenIntent({ userId: 'user-b', walletAddress: buyerWallet }),
      /currently disabled/
    );
    delete process.env.WAGER_TREASURY_WALLET;
    delete process.env.SOLANA_RPC_URL;
    delete process.env.GAME_TOKEN_MINT;
    const disabledState = await getLootboxStateForUser('user-b');
    assert.ok(disabledState.openDisabledReason, 'paid opens are disabled');
    assert.equal(disabledState.freeOpensAvailable, 2);

    const freeOpen = await openLootboxWithFreeCredit({ userId: 'user-b' });
    assert.equal(freeOpen.status, 'credited');
    assert.ok(freeOpen.resultSkinId, 'free open reveals a skin');
    assert.ok(freeOpen.memo.startsWith('opus-lootbox-free:'), 'free opens use their own memo prefix');
    assert.equal(freeOpen.walletAddress, 'free-open');
    assert.equal(freeOpen.tokenMintAddress, 'free-open');
    assert.equal(freeOpen.tokenSymbol, '');
    assert.equal(freeOpen.tokenAmountBaseUnits, '0');
    assert.equal(freeOpen.priceTokens, '0');
    const freeOwnership = fake.ownerships.find(
      (row) => row.userId === 'user-b' && row.skinId === freeOpen.resultSkinId
    );
    assert.ok(freeOwnership && freeOwnership.revokedAt === null, 'free open grants the skin');
    assert.equal(freeOwnership!.source, 'lootbox');

    const afterOne = await getLootboxStateForUser('user-b');
    assert.equal(afterOne.freeOpensAvailable, 1);
    assert.equal(afterOne.freeOpenDisabledReason, 'Game token mint is not configured');

    process.env.WAGER_TREASURY_WALLET = treasuryWallet;
    process.env.SOLANA_RPC_URL = 'https://example.invalid/rpc';
    process.env.GAME_TOKEN_MINT = mintAddress;
    const ownedBeforeSecondFree = new Set(
      fake.ownerships
        .filter((row) => row.userId === 'user-b' && row.revokedAt === null)
        .map((row) => row.skinId)
    );
    const secondFree = await openLootboxWithFreeCredit({ userId: 'user-b', walletAddress: buyerWallet });
    assert.equal(secondFree.status, 'credited');
    if (secondFree.resultKind === 'game_token') {
      assert.equal(ownedBeforeSecondFree.has(secondFree.resultSkinId!), true);
      assert.ok(secondFree.tokenPayoutId);
    } else {
      assert.equal(ownedBeforeSecondFree.has(secondFree.resultSkinId!), false);
    }

    await expectServiceError(
      () => openLootboxWithFreeCredit({ userId: 'user-b', walletAddress: buyerWallet }),
      /No free crate opens/
    );
    assert.equal((await getLootboxStateForUser('user-b')).freeOpensAvailable, 0);

    // A complete collection can free-open and always converts the selected skin.
    await grantLootboxFreeOpens({ userIds: ['user-a'], count: 1, grantedByUserId: 'admin' });
    const completedFreeOpen = await openLootboxWithFreeCredit({
      userId: 'user-a',
      walletAddress: buyerWallet,
    });
    assert.equal(completedFreeOpen.resultKind, 'game_token');
    assert.ok(completedFreeOpen.tokenPayoutId);
    assert.equal(fake.freeOpenBalances.get('user-a')?.balance, 0);

    const freeOverview = await getLootboxAdminOverview();
    assert.equal(freeOverview.totalOpens, 7, 'free opens count as credited opens');
    assert.equal(freeOverview.freeOpens.totalOutstanding, 0);
    assert.equal(freeOverview.freeOpens.balances.length, 0);

    // Seed a complete collection to verify that every full-pool selection
    // converts while preserving each skin's normal pull rate.
    for (const skin of pool) {
      fake.ownerships.push({
        id: `full-${skin.id}`,
        userId: 'user-d',
        skinId: skin.id,
        source: 'admin_grant',
        purchaseId: null,
        grantedAt: new Date(),
        revokedAt: null,
      });
    }
    await grantLootboxFreeOpens({
      userIds: ['user-d'],
      count: 1,
      grantedByUserId: 'admin',
    });
    const fullCollection = new Set(pool.map((skin) => skin.id));
    const completedState = await getLootboxStateForUser('user-d');
    assert.equal(completedState.remainingForUser, 0);
    assert.equal(completedState.freeOpensAvailable, 1);
    assert.equal(completedState.duplicateChanceBps, 10_000);

    // --- game-token outcomes -----------------------------------------------
    process.env.WAGER_TREASURY_WALLET = treasuryWallet;
    process.env.SOLANA_RPC_URL = 'https://example.invalid/rpc';
    process.env.GAME_TOKEN_MINT = mintAddress;
    const paidDuplicateRanges = Object.fromEntries(pool.map((skin) => [skin.id, {
      minTokens: '1234',
      maxTokens: '1234',
    }]));
    await updateLootboxSettings({
      enabled: true,
      duplicateReward: { skinTokenRanges: paidDuplicateRanges },
      updatedByUserId: 'admin',
    });

    for (const skin of pool) {
      if (fake.ownerships.some((row) => row.userId === 'user-b' && row.skinId === skin.id)) continue;
      fake.ownerships.push({
        id: `paid-duplicate-${skin.id}`,
        userId: 'user-b',
        skinId: skin.id,
        source: 'admin_grant',
        purchaseId: null,
        grantedAt: new Date(),
        revokedAt: null,
      });
    }
    const ownedBeforePaidDuplicate = new Set(
      fake.ownerships
        .filter((row) => row.userId === 'user-b' && row.revokedAt === null)
        .map((row) => row.skinId)
    );
    assert.equal(ownedBeforePaidDuplicate.size, pool.length, 'paid duplicate test requires a complete collection');
    const tokenIntent = await createLootboxOpenIntent({ userId: 'user-b', walletAddress: buyerWallet });
    assert.deepEqual(tokenIntent.quotedDuplicateReward, {
      skinTokenRanges: paidDuplicateRanges,
    });
    await updateLootboxSettings({
      duplicateReward: {
        skinTokenRanges: Object.fromEntries(pool.map((skin) => [skin.id, {
          minTokens: '9999',
          maxTokens: '9999',
        }])),
      },
      updatedByUserId: 'admin',
    });
    const tokenStored = fake.intents.get(tokenIntent.intentId)!;
    const tokenSignature = validSignature(6);
    parsedTransactions.set(tokenSignature, paymentTransactionFixture({
      walletAddress: tokenStored.walletAddress,
      tokenMintAddress: tokenStored.tokenMintAddress,
      treasuryTokenAccount: tokenStored.treasuryTokenAccount,
      tokenAmountBaseUnits: tokenStored.tokenAmountBaseUnits,
      memo: tokenStored.memo,
      createdAt: tokenStored.createdAt,
    }));
    const paidTokenDrop = await submitLootboxOpenSignature({
      userId: 'user-b',
      intentId: tokenIntent.intentId,
      signature: tokenSignature,
    });
    assert.equal(paidTokenDrop.resultKind, 'game_token');
    assert.ok(paidTokenDrop.resultSkinId);
    assert.equal(ownedBeforePaidDuplicate.has(paidTokenDrop.resultSkinId!), true);
    assert.equal(paidTokenDrop.resultTokenAmount, '1234');
    assert.equal(
      fake.ownerships.filter((row) => row.userId === 'user-b' && row.revokedAt === null).length,
      ownedBeforePaidDuplicate.size,
      'duplicate conversion must not create another ownership row'
    );
    assert.ok(paidTokenDrop.tokenPayoutId);
    assert.equal(
      fake.tokenPayouts.get(paidTokenDrop.tokenPayoutId!)?.tokenAmountBaseUnits,
      1234n * 10n ** 6n,
      'whole-token drop is scaled using the snapshotted mint decimals'
    );

    // Raw token drops bypass the skin pool and queue the same automatic wallet
    // payout without attaching a skin or rarity to the result.
    await updateLootboxSettings({
      directTokenReward: {
        chanceBps: 10_000,
        range: { minTokens: '4321', maxTokens: '4321' },
      },
      updatedByUserId: 'admin',
    });
    await grantLootboxFreeOpens({ userIds: ['user-c'], count: 1, grantedByUserId: 'admin' });
    const directDropState = await getLootboxStateForUser('user-c');
    assert.deepEqual(directDropState.directTokenReward, {
      chanceBps: 10_000,
      range: { minTokens: '4321', maxTokens: '4321' },
    });
    assert.equal(directDropState.odds.reduce((sum, odds) => sum + odds.chanceBps, 0), 0);
    assert.equal(directDropState.duplicateChanceBps, 0);
    const directTokenDrop = await openLootboxWithFreeCredit({
      userId: 'user-c',
      walletAddress: buyerWallet,
    });
    assert.equal(directTokenDrop.resultKind, 'game_token');
    assert.equal(directTokenDrop.resultSkinId, null);
    assert.equal(directTokenDrop.resultRarity, null);
    assert.equal(directTokenDrop.resultTokenAmount, '4321');
    assert.ok(directTokenDrop.tokenPayoutId);
    assert.equal(
      fake.tokenPayouts.get(directTokenDrop.tokenPayoutId!)?.tokenAmountBaseUnits,
      4321n * 10n ** 6n
    );
    assert.equal(fake.tokenPayouts.get(directTokenDrop.tokenPayoutId!)?.walletAddress, buyerWallet);

    // Completed collections always convert the selected full-pool skin.
    const completedDuplicateRanges = Object.fromEntries(pool.map((skin) => [skin.id, {
      minTokens: '777',
      maxTokens: '777',
    }]));
    await updateLootboxSettings({
      directTokenReward: {
        chanceBps: 0,
        range: { minTokens: '5000', maxTokens: '75000' },
      },
      duplicateReward: { skinTokenRanges: completedDuplicateRanges },
      updatedByUserId: 'admin',
    });
    const completedTokenState = await getLootboxStateForUser('user-d');
    assert.equal(completedTokenState.remainingForUser, 0);
    assert.equal(completedTokenState.duplicateChanceBps, 10_000);
    assert.equal(completedTokenState.openDisabledReason, null);
    assert.equal(completedTokenState.freeOpenDisabledReason, null);
    const freeTokenDrop = await openLootboxWithFreeCredit({
      userId: 'user-d',
      walletAddress: buyerWallet,
    });
    assert.equal(freeTokenDrop.resultKind, 'game_token');
    assert.ok(freeTokenDrop.resultSkinId);
    assert.equal(fullCollection.has(freeTokenDrop.resultSkinId!), true);
    assert.equal(freeTokenDrop.resultTokenAmount, '777');
    assert.ok(freeTokenDrop.tokenPayoutId);
    assert.equal(fake.freeOpenBalances.get('user-d')?.balance, 0);

    assert.ok(LootboxServiceError, 'error class is exported');
  } finally {
    setLootboxConnectionFactoryForTests(null);
    for (const [key, value] of Object.entries({
      WAGER_TREASURY_WALLET: previousEnv.treasury,
      SOLANA_RPC_URL: previousEnv.rpc,
      GAME_TOKEN_MINT: previousEnv.mint,
      GAME_TOKEN_SYMBOL: previousEnv.symbol,
      WAGER_SETTLEMENT_SECRET_KEY: previousEnv.settlementSecret,
      SKIN_SHOP_TOKEN_MINT: previousEnv.legacyMint,
      SKIN_SHOP_TOKEN_SYMBOL: previousEnv.legacySymbol,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log('lootbox-service tests passed');
}

runLootboxServiceTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
