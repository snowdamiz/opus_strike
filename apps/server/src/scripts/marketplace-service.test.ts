import assert from 'node:assert/strict';
import { Keypair, PublicKey, SystemProgram, Transaction, type ParsedTransactionWithMeta } from '@solana/web3.js';
import bs58 from 'bs58';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

type UserRow = { id: string; walletAddress: string | null; name: string };

type OwnershipRow = {
  id: string;
  userId: string;
  skinId: string;
  source: string;
  purchaseId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
};

type ListingRow = Record<string, any>;
type IntentRow = Record<string, any>;

function validSignature(seed: number): string {
  return bs58.encode(Buffer.alloc(64, seed));
}

function createFakePrisma(users: UserRow[], ownerships: OwnershipRow[]) {
  const now = () => new Date();
  let settings: Record<string, any> | null = null;
  const listings = new Map<string, ListingRow>();
  const intents = new Map<string, IntentRow>();
  let listingIdCounter = 0;
  let ownershipIdCounter = 1000;

  const matchesListing = (row: ListingRow, where: any): boolean => {
    if (!where) return true;
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (where.status) {
      if (typeof where.status === 'string' && row.status !== where.status) return false;
      if (Array.isArray(where.status?.in) && !where.status.in.includes(row.status)) return false;
    }
    if (typeof where.sellerUserId === 'string' && row.sellerUserId !== where.sellerUserId) return false;
    if (typeof where.skinId === 'string' && row.skinId !== where.skinId) return false;
    if (typeof where.reservedIntentId === 'string' && row.reservedIntentId !== where.reservedIntentId) return false;
    if (where.reservedUntil?.lt !== undefined) {
      if (!(row.reservedUntil instanceof Date) || !(row.reservedUntil < where.reservedUntil.lt)) return false;
    }
    if (where.updatedAt?.gt !== undefined) {
      if (!(row.updatedAt instanceof Date) || !(row.updatedAt > where.updatedAt.gt)) return false;
    }
    if (Array.isArray(where.OR)) {
      if (!where.OR.some((clause: any) => matchesListing(row, clause))) return false;
    }
    return true;
  };

  const matchesIntent = (row: IntentRow, where: any): boolean => {
    if (!where) return true;
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (where.id?.not && row.id === where.id.not) return false;
    if (typeof where.transactionSignature === 'string' && row.transactionSignature !== where.transactionSignature) return false;
    if (where.transactionSignature?.not === null && row.transactionSignature == null) return false;
    if (typeof where.buyerUserId === 'string' && row.buyerUserId !== where.buyerUserId) return false;
    if (typeof where.skinId === 'string' && row.skinId !== where.skinId) return false;
    if (typeof where.lastError === 'string' && row.lastError !== where.lastError) return false;
    if (where.status) {
      if (typeof where.status === 'string' && row.status !== where.status) return false;
      if (Array.isArray(where.status?.in) && !where.status.in.includes(row.status)) return false;
    }
    if (Array.isArray(where.OR) && !where.OR.some((clause: any) => matchesIntent(row, clause))) return false;
    return true;
  };

  const matchesOwnership = (row: OwnershipRow, where: any): boolean => {
    if (!where) return true;
    if (typeof where.id === 'string' && row.id !== where.id) return false;
    if (typeof where.userId === 'string' && row.userId !== where.userId) return false;
    if (typeof where.skinId === 'string' && row.skinId !== where.skinId) return false;
    if (where.revokedAt === null && row.revokedAt !== null) return false;
    if (where.revokedAt instanceof Date && row.revokedAt?.getTime() !== where.revokedAt.getTime()) return false;
    return true;
  };

  const withSeller = (row: ListingRow, include: any) => {
    const copy = { ...row };
    if (include?.seller) {
      const seller = users.find((user) => user.id === row.sellerUserId);
      copy.seller = seller ? { name: seller.name } : null;
    }
    return copy;
  };

  const client = {
    user: {
      findUnique: async ({ where }: any) => {
        const user = users.find((candidate) => candidate.id === where.id);
        return user ? { ...user } : null;
      },
    },
    marketplaceSettings: {
      createMany: async ({ data }: any) => {
        for (const entry of Array.isArray(data) ? data : [data]) {
          if (!settings) {
            settings = {
              id: entry.id ?? 'default',
              enabled: entry.enabled ?? true,
              listingHoldTokens: entry.listingHoldTokens ?? '200000',
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
    userSkinOwnership: {
      findUnique: async ({ where }: any) => {
        const row = where.userId_skinId
          ? ownerships.find((candidate) => (
            candidate.userId === where.userId_skinId.userId
            && candidate.skinId === where.userId_skinId.skinId
          ))
          : ownerships.find((candidate) => matchesOwnership(candidate, where));
        return row ? { ...row } : null;
      },
      update: async ({ where, data }: any) => {
        const row = ownerships.find((candidate) => candidate.id === where.id);
        if (!row) throw new Error('ownership missing');
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of ownerships) {
          if (!matchesOwnership(row, where)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      upsert: async ({ where, create, update }: any) => {
        const { userId, skinId } = where.userId_skinId;
        const existing = ownerships.find((candidate) => candidate.userId === userId && candidate.skinId === skinId);
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
      findMany: async ({ where }: any = {}) => ownerships
        .filter((row) => (where?.userId ? row.userId === where.userId : true))
        .filter((row) => (where?.revokedAt === null ? row.revokedAt === null : true))
        .map((row) => ({ ...row })),
    },
    marketplaceListing: {
      create: async ({ data, include }: any) => {
        listingIdCounter += 1;
        const row: ListingRow = {
          id: `listing-${listingIdCounter}`,
          reservedIntentId: null,
          reservedUntil: null,
          buyerUserId: null,
          soldAt: null,
          canceledAt: null,
          createdAt: now(),
          updatedAt: now(),
          ...data,
        };
        listings.set(row.id, row);
        return withSeller(row, include);
      },
      findUnique: async ({ where, include }: any) => {
        const row = listings.get(where.id);
        return row ? withSeller(row, include) : null;
      },
      findFirst: async ({ where }: any) => {
        for (const row of listings.values()) {
          if (matchesListing(row, where)) return { ...row };
        }
        return null;
      },
      findMany: async ({ where, orderBy, take, include, select }: any = {}) => {
        let rows = Array.from(listings.values()).filter((row) => matchesListing(row, where));
        if (orderBy?.createdAt === 'desc') {
          rows = rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        }
        if (typeof take === 'number') rows = rows.slice(0, take);
        if (select) {
          return rows.map((row) => {
            const picked: Record<string, unknown> = {};
            for (const key of Object.keys(select)) picked[key] = row[key];
            return picked;
          });
        }
        return rows.map((row) => withSeller(row, include));
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of listings.values()) {
          if (!matchesListing(row, where)) continue;
          Object.assign(row, data, { updatedAt: now() });
          count += 1;
        }
        return { count };
      },
      update: async ({ where, data }: any) => {
        const row = listings.get(where.id);
        if (!row) throw new Error('listing missing');
        Object.assign(row, data, { updatedAt: now() });
        return { ...row };
      },
      count: async ({ where }: any = {}) => Array.from(listings.values())
        .filter((row) => matchesListing(row, where)).length,
      aggregate: async ({ where }: any) => {
        const rows = Array.from(listings.values()).filter((row) => matchesListing(row, where));
        const sum = rows.reduce((total, row) => total + BigInt(row.priceLamports), 0n);
        return { _sum: { priceLamports: rows.length ? sum : null } };
      },
    },
    marketplacePurchaseIntent: {
      create: async ({ data }: any) => {
        const row = {
          transactionSignature: null,
          lastValidBlockHeight: null,
          activeBuyerSkinKey: null,
          creditedAt: null,
          lastError: null,
          ...data,
          createdAt: now(),
          updatedAt: now(),
        };
        intents.set(row.id, row);
        return { ...row };
      },
      findUnique: async ({ where, select }: any) => {
        const row = intents.get(where.id);
        if (!row) return null;
        if (select) {
          const picked: Record<string, unknown> = {};
          for (const key of Object.keys(select)) picked[key] = row[key];
          return picked;
        }
        return { ...row };
      },
      findFirst: async ({ where }: any) => {
        for (const row of intents.values()) {
          if (matchesIntent(row, where)) return { ...row };
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
          if (!matchesIntent(row, where)) continue;
          Object.assign(row, data, { updatedAt: now() });
          count += 1;
        }
        return { count };
      },
      findMany: async ({ where, take, select }: any = {}) => {
        const rows = Array.from(intents.values())
          .filter((row) => matchesIntent(row, where))
          .slice(0, take ?? undefined);
        if (select) {
          return rows.map((row) => {
            const picked: Record<string, unknown> = {};
            for (const key of Object.keys(select)) picked[key] = row[key];
            return picked;
          });
        }
        return rows.map((row) => ({ ...row }));
      },
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(client),
  };

  return { prisma: client, listings, intents };
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

function solTransferInstruction(input: { source: string; destination: string; lamports: string }) {
  return {
    program: 'system',
    programId: SystemProgram.programId,
    parsed: {
      type: 'transfer',
      info: {
        source: input.source,
        destination: input.destination,
        lamports: input.lamports,
      },
    },
  };
}

function solPaymentFixture(intent: {
  buyerWalletAddress: string;
  sellerWalletAddress: string;
  priceLamports: bigint;
  memo: string;
  createdAt: Date;
}, overrides: { lamports?: string } = {}): ParsedTransactionWithMeta {
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
            pubkey: new PublicKey(intent.buyerWalletAddress),
            signer: true,
            writable: true,
            source: 'transaction',
          },
          {
            pubkey: new PublicKey(intent.sellerWalletAddress),
            signer: false,
            writable: true,
            source: 'transaction',
          },
        ],
        instructions: [
          parsedMemoInstruction(intent.memo),
          solTransferInstruction({
            source: intent.buyerWalletAddress,
            destination: intent.sellerWalletAddress,
            lamports: overrides.lamports ?? intent.priceLamports.toString(),
          }),
        ],
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
      },
    },
  } as ParsedTransactionWithMeta;
}

async function runMarketplaceServiceTests() {
  const previousEnv = {
    rpc: process.env.SOLANA_RPC_URL,
    mint: process.env.GAME_TOKEN_MINT,
    symbol: process.env.GAME_TOKEN_SYMBOL,
    legacyMint: process.env.SKIN_SHOP_TOKEN_MINT,
    legacySymbol: process.env.SKIN_SHOP_TOKEN_SYMBOL,
  };

  const sellerWallet = Keypair.generate().publicKey.toBase58();
  const seller2Wallet = Keypair.generate().publicKey.toBase58();
  const seller3Wallet = Keypair.generate().publicKey.toBase58();
  const buyerKeypair = Keypair.generate();
  const buyer2Keypair = Keypair.generate();
  const buyerWallet = buyerKeypair.publicKey.toBase58();
  const buyer2Wallet = buyer2Keypair.publicKey.toBase58();

  const users: UserRow[] = [
    { id: 'seller-1', walletAddress: sellerWallet, name: 'SellerOne' },
    { id: 'seller-2', walletAddress: seller2Wallet, name: 'SellerTwo' },
    { id: 'seller-3', walletAddress: seller3Wallet, name: 'SellerThree' },
    { id: 'buyer-1', walletAddress: buyerWallet, name: 'BuyerOne' },
    { id: 'buyer-2', walletAddress: buyer2Wallet, name: 'BuyerTwo' },
    { id: 'no-wallet', walletAddress: null, name: 'NoWallet' },
  ];
  const ownerships: OwnershipRow[] = [
    {
      id: 'own-1',
      userId: 'seller-1',
      skinId: 'phantom.void-monarch',
      source: 'paid',
      purchaseId: null,
      grantedAt: new Date('2026-07-01T10:00:00.000Z'),
      revokedAt: null,
    },
    {
      id: 'own-2',
      userId: 'seller-1',
      skinId: 'blaze.solar-forge',
      source: 'paid',
      purchaseId: null,
      grantedAt: new Date('2026-07-01T10:00:00.000Z'),
      revokedAt: null,
    },
    {
      id: 'own-3',
      userId: 'seller-2',
      skinId: 'hookshot.tidebreaker',
      source: 'lootbox',
      purchaseId: null,
      grantedAt: new Date('2026-07-01T10:00:00.000Z'),
      revokedAt: null,
    },
    {
      id: 'own-4',
      userId: 'seller-3',
      skinId: 'hookshot.tidebreaker',
      source: 'paid',
      purchaseId: null,
      grantedAt: new Date('2026-07-01T10:00:00.000Z'),
      revokedAt: null,
    },
  ];

  const fake = createFakePrisma(users, ownerships);
  (globalThis as any).prisma = fake.prisma;

  const {
    MarketplaceServiceError,
    clearMarketplaceBalanceCacheForTests,
    clearMarketplaceSettingsCache,
    cancelMarketplaceListing,
    buildMarketplacePurchaseTransaction,
    createMarketplaceListing,
    createMarketplacePurchaseIntent,
    getMarketplaceAdminOverview,
    getMarketplaceListings,
    getMarketplacePurchaseIntent,
    getMarketplaceStateForUser,
    getMyMarketplaceListings,
    releaseStaleListingReservations,
    reconcilePendingMarketplacePurchases,
    setMarketplaceConnectionFactoryForTests,
    submitMarketplacePurchaseSignature,
    submitSignedMarketplacePurchaseTransaction,
    updateMarketplaceSettings,
  } = await import('../marketplace/service');

  // Set env AFTER the import: pulling in Prisma loads the developer's .env and
  // would otherwise clobber the hermetic values below.
  const mintAddress = 'So11111111111111111111111111111111111111112';
  process.env.SOLANA_RPC_URL = 'https://example.invalid/rpc';
  process.env.GAME_TOKEN_MINT = mintAddress;
  process.env.GAME_TOKEN_SYMBOL = 'STRIKE';
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;

  const HOLD_BASE_UNITS = 200_000n * 10n ** 6n;
  const balances = new Map<string, bigint>([
    [sellerWallet, HOLD_BASE_UNITS],
    [seller2Wallet, HOLD_BASE_UNITS + 1n],
    [seller3Wallet, HOLD_BASE_UNITS + 1n],
    [buyerWallet, 0n],
    [buyer2Wallet, 0n],
  ]);
  const parsedTransactions = new Map<string, ParsedTransactionWithMeta | null>();
  const latestBlockhash = Keypair.generate().publicKey.toBase58();
  let broadcastShouldThrow = false;

  setMarketplaceConnectionFactoryForTests(() => ({
    getTokenSupply: async () => ({ value: { decimals: 6 } }),
    getParsedTokenAccountsByOwner: async (owner: PublicKey) => ({
      value: [
        {
          account: {
            data: {
              parsed: {
                info: {
                  mint: mintAddress,
                  tokenAmount: {
                    amount: (balances.get(owner.toBase58()) ?? 0n).toString(),
                    decimals: 6,
                  },
                },
              },
            },
          },
        },
      ],
    }),
    getParsedTransaction: async (signature: string) => parsedTransactions.get(signature) ?? null,
    getLatestBlockhash: async () => ({ blockhash: latestBlockhash, lastValidBlockHeight: 12_345 }),
    getBlockHeight: async () => 12_000,
    sendRawTransaction: async (payload: Buffer) => {
      if (broadcastShouldThrow) throw new Error('simulated RPC handoff failure');
      const transaction = Transaction.from(payload);
      if (!transaction.signature) throw new Error('signed transaction expected');
      return bs58.encode(transaction.signature);
    },
  }) as never);

  const PRICE_LAMPORTS = 500_000_000n; // 0.5 SOL

  try {
    // --- settings ---------------------------------------------------------
    const defaults = await getMarketplaceAdminOverview();
    assert.equal(defaults.settings.enabled, true);
    assert.equal(defaults.settings.listingHoldTokens, '200000');

    await expectServiceError(
      () => updateMarketplaceSettings({ listingHoldTokens: 'abc', updatedByUserId: 'admin' }),
      /whole game-token amount/
    );

    // --- listing gate: disabled marketplace --------------------------------
    await updateMarketplaceSettings({ enabled: false, updatedByUserId: 'admin' });
    clearMarketplaceSettingsCache();
    await expectServiceError(
      () => createMarketplaceListing({
        userId: 'seller-1',
        skinId: 'phantom.void-monarch',
        priceLamports: PRICE_LAMPORTS.toString(),
      }),
      /currently disabled/,
      403
    );

    await updateMarketplaceSettings({ enabled: true, updatedByUserId: 'admin' });
    clearMarketplaceSettingsCache();

    // --- listing validations -----------------------------------------------
    await expectServiceError(
      () => createMarketplaceListing({ userId: 'seller-1', skinId: 'phantom.default', priceLamports: PRICE_LAMPORTS.toString() }),
      /cannot be listed/
    );
    await expectServiceError(
      () => createMarketplaceListing({ userId: 'seller-1', skinId: 'phantom.golden', priceLamports: PRICE_LAMPORTS.toString() }),
      /cannot be listed/
    );
    await expectServiceError(
      () => createMarketplaceListing({ userId: 'seller-1', skinId: 'not-a-skin', priceLamports: PRICE_LAMPORTS.toString() }),
      /cannot be listed/
    );
    await expectServiceError(
      () => createMarketplaceListing({ userId: 'seller-1', skinId: 'phantom.void-monarch', priceLamports: '1000' }),
      /at least 0.001 SOL/
    );
    await expectServiceError(
      () => createMarketplaceListing({ userId: 'buyer-1', skinId: 'phantom.void-monarch', priceLamports: PRICE_LAMPORTS.toString() }),
      /do not own/,
      403
    );
    await expectServiceError(
      () => createMarketplaceListing({ userId: 'no-wallet', skinId: 'phantom.void-monarch', priceLamports: PRICE_LAMPORTS.toString() }),
      /Link a Solana wallet/
    );

    // Insufficient hold: drop the seller below the 200k requirement.
    balances.set(sellerWallet, HOLD_BASE_UNITS - 1n);
    await expectServiceError(
      () => createMarketplaceListing({ userId: 'seller-1', skinId: 'phantom.void-monarch', priceLamports: PRICE_LAMPORTS.toString() }),
      /Hold at least 200,000 \$STRIKE/,
      403
    );

    // Sufficient hold: exactly the requirement passes.
    balances.set(sellerWallet, HOLD_BASE_UNITS);
    const listing = await createMarketplaceListing({
      userId: 'seller-1',
      skinId: 'phantom.void-monarch',
      priceLamports: PRICE_LAMPORTS.toString(),
    });
    assert.equal(listing.status, 'active');
    assert.equal(listing.priceLamports, PRICE_LAMPORTS.toString());
    assert.equal(listing.sellerName, 'SellerOne');

    await expectServiceError(
      () => createMarketplaceListing({ userId: 'seller-1', skinId: 'phantom.void-monarch', priceLamports: PRICE_LAMPORTS.toString() }),
      /already listed/,
      409
    );

    // --- state --------------------------------------------------------------
    clearMarketplaceBalanceCacheForTests();
    const signedOutState = await getMarketplaceStateForUser(null);
    assert.equal(signedOutState.canList, false);
    assert.match(signedOutState.listDisabledReason ?? '', /Sign in/);

    const sellerState = await getMarketplaceStateForUser({ id: 'seller-1', walletAddress: sellerWallet });
    assert.equal(sellerState.canList, true);
    assert.equal(sellerState.listingHoldTokenBaseUnits, HOLD_BASE_UNITS.toString());
    assert.equal(sellerState.holdBalanceTokenBaseUnits, HOLD_BASE_UNITS.toString());

    // --- browse ---------------------------------------------------------------
    const browse = await getMarketplaceListings('buyer-1');
    assert.equal(browse.listings.length, 1);
    assert.equal(browse.listings[0].isOwn, false);
    const sellerBrowse = await getMarketplaceListings('seller-1');
    assert.equal(sellerBrowse.listings[0].isOwn, true);

    // --- purchase intents -------------------------------------------------------
    await expectServiceError(
      () => createMarketplacePurchaseIntent({ userId: 'seller-1', listingId: listing.listingId, walletAddress: sellerWallet }),
      /your own listing/
    );
    await expectServiceError(
      () => createMarketplacePurchaseIntent({ userId: 'buyer-1', listingId: listing.listingId, walletAddress: sellerWallet }),
      /different from the seller wallet/
    );

    const intent = await createMarketplacePurchaseIntent({
      userId: 'buyer-1',
      listingId: listing.listingId,
      walletAddress: buyerWallet,
    });
    assert.equal(intent.status, 'intent_created');
    assert.ok(intent.memo.startsWith('opus-market:'), 'memo carries the marketplace prefix');
    assert.equal(intent.priceLamports, PRICE_LAMPORTS.toString());
    assert.equal(intent.sellerWalletAddress, sellerWallet);
    assert.equal(fake.listings.get(listing.listingId)!.status, 'pending_sale');

    // Claimed listings reject other buyers and seller cancellation.
    await expectServiceError(
      () => createMarketplacePurchaseIntent({ userId: 'buyer-2', listingId: listing.listingId, walletAddress: buyer2Wallet }),
      /no longer available/,
      409
    );
    await expectServiceError(
      () => cancelMarketplaceListing({ userId: 'seller-1', listingId: listing.listingId }),
      /completing this purchase/,
      409
    );

    // --- credit: SOL verified, ownership moves ------------------------------------
    const storedIntent = fake.intents.get(intent.intentId)!;
    const signature = validSignature(11);
    parsedTransactions.set(signature, solPaymentFixture({
      buyerWalletAddress: storedIntent.buyerWalletAddress,
      sellerWalletAddress: storedIntent.sellerWalletAddress,
      priceLamports: storedIntent.priceLamports,
      memo: storedIntent.memo,
      createdAt: storedIntent.createdAt,
    }));

    const credited = await submitMarketplacePurchaseSignature({
      userId: 'buyer-1',
      intentId: intent.intentId,
      signature,
    });
    assert.equal(credited.status, 'credited');

    const sellerOwnership = ownerships.find((row) => row.userId === 'seller-1' && row.skinId === 'phantom.void-monarch');
    assert.ok(sellerOwnership?.revokedAt, 'seller loses the skin');
    const buyerOwnership = ownerships.find((row) => row.userId === 'buyer-1' && row.skinId === 'phantom.void-monarch');
    assert.ok(buyerOwnership && buyerOwnership.revokedAt === null, 'buyer gains the skin');
    assert.equal(buyerOwnership!.source, 'marketplace');

    const soldListing = fake.listings.get(listing.listingId)!;
    assert.equal(soldListing.status, 'sold');
    assert.equal(soldListing.buyerUserId, 'buyer-1');

    // Idempotent: re-reading the intent stays credited.
    const reread = await getMarketplacePurchaseIntent({ userId: 'buyer-1', intentId: intent.intentId });
    assert.equal(reread.status, 'credited');

    const overview = await getMarketplaceAdminOverview();
    assert.equal(overview.soldListings, 1);
    assert.equal(overview.totalVolumeLamports, PRICE_LAMPORTS.toString());

    // --- signed transaction handoff survives an RPC/process boundary -----------
    const recoveryListing = await createMarketplaceListing({
      userId: 'seller-1',
      skinId: 'blaze.solar-forge',
      priceLamports: PRICE_LAMPORTS.toString(),
    });
    const recoveryIntent = await createMarketplacePurchaseIntent({
      userId: 'buyer-2',
      listingId: recoveryListing.listingId,
      walletAddress: buyer2Wallet,
    });
    const recoveryTransactionPayload = await buildMarketplacePurchaseTransaction({
      userId: 'buyer-2',
      intentId: recoveryIntent.intentId,
    });
    const recoveryTransaction = Transaction.from(
      Buffer.from(recoveryTransactionPayload.transactionBase64, 'base64')
    );
    recoveryTransaction.sign(buyer2Keypair);
    broadcastShouldThrow = true;
    const awaitingRecovery = await submitSignedMarketplacePurchaseTransaction({
      userId: 'buyer-2',
      intentId: recoveryIntent.intentId,
      signedTransactionBase64: recoveryTransaction.serialize().toString('base64'),
    });
    broadcastShouldThrow = false;
    assert.equal(awaitingRecovery.status, 'submitted');
    const recoveryStored = fake.intents.get(recoveryIntent.intentId)!;
    assert.equal(
      recoveryStored.transactionSignature,
      bs58.encode(recoveryTransaction.signature!),
      'the deterministic signature is durable before broadcast returns'
    );
    parsedTransactions.set(recoveryStored.transactionSignature, solPaymentFixture({
      buyerWalletAddress: recoveryStored.buyerWalletAddress,
      sellerWalletAddress: recoveryStored.sellerWalletAddress,
      priceLamports: recoveryStored.priceLamports,
      memo: recoveryStored.memo,
      createdAt: recoveryStored.createdAt,
    }));
    const recoveryResult = await reconcilePendingMarketplacePurchases();
    assert.equal(recoveryResult.credited, 1);
    assert.equal(fake.intents.get(recoveryIntent.intentId)!.status, 'credited');

    // --- listing escrow cancellation -------------------------------------------
    const listing2 = await createMarketplaceListing({
      userId: 'seller-2',
      skinId: 'hookshot.tidebreaker',
      priceLamports: PRICE_LAMPORTS.toString(),
    });
    const seller2Ownership = ownerships.find((row) => row.userId === 'seller-2' && row.skinId === 'hookshot.tidebreaker')!;
    assert.equal(seller2Ownership.revokedAt, null, 'listing escrow keeps the entitlement recognized as owned');
    await cancelMarketplaceListing({ userId: 'seller-2', listingId: listing2.listingId });
    assert.equal(seller2Ownership.revokedAt, null, 'canceling leaves the seller entitlement untouched');

    const relisted = await createMarketplaceListing({
      userId: 'seller-2',
      skinId: 'hookshot.tidebreaker',
      priceLamports: PRICE_LAMPORTS.toString(),
    });

    // --- stale reservation release ----------------------------------------------
    const intent3 = await createMarketplacePurchaseIntent({
      userId: 'buyer-1',
      listingId: relisted.listingId,
      walletAddress: buyerWallet,
    });
    const listing2Row = fake.listings.get(relisted.listingId)!;
    const intent3Row = fake.intents.get(intent3.intentId)!;
    intent3Row.intentExpiresAt = new Date(Date.now() - 120_000);
    listing2Row.reservedUntil = new Date(Date.now() - 60_000);
    await releaseStaleListingReservations();
    assert.equal(fake.intents.get(intent3.intentId)!.status, 'expired', 'stale unsigned intents expire');
    assert.equal(listing2Row.status, 'active', 'expired-intent reservations release');

    // --- underpayment fails and releases the claim --------------------------------
    const intent4 = await createMarketplacePurchaseIntent({
      userId: 'buyer-1',
      listingId: relisted.listingId,
      walletAddress: buyerWallet,
    });
    const stored4 = fake.intents.get(intent4.intentId)!;
    const signature4 = validSignature(13);
    parsedTransactions.set(signature4, solPaymentFixture({
      buyerWalletAddress: stored4.buyerWalletAddress,
      sellerWalletAddress: stored4.sellerWalletAddress,
      priceLamports: stored4.priceLamports,
      memo: stored4.memo,
      createdAt: stored4.createdAt,
    }, { lamports: '1' }));
    const underpaid = await submitMarketplacePurchaseSignature({
      userId: 'buyer-1',
      intentId: intent4.intentId,
      signature: signature4,
    });
    assert.equal(underpaid.status, 'failed');
    assert.equal(underpaid.lastError, 'underpayment');
    assert.equal(listing2Row.status, 'active', 'underpaid claims release immediately');

    // A buyer cannot hold two payable intents for the same skin from different sellers.
    const competingListing = await createMarketplaceListing({
      userId: 'seller-3',
      skinId: 'hookshot.tidebreaker',
      priceLamports: PRICE_LAMPORTS.toString(),
    });
    await createMarketplacePurchaseIntent({
      userId: 'buyer-2',
      listingId: relisted.listingId,
      walletAddress: buyer2Wallet,
    });
    await expectServiceError(
      () => createMarketplacePurchaseIntent({
        userId: 'buyer-2',
        listingId: competingListing.listingId,
        walletAddress: buyer2Wallet,
      }),
      /pending purchase for this skin/,
      409
    );

    // Buyer that already owns the skin cannot start a purchase.
    await expectServiceError(
      () => createMarketplacePurchaseIntent({
        userId: 'buyer-1',
        listingId: listing.listingId,
        walletAddress: buyerWallet,
      }),
      /Listing not found|no longer available|already own/,
      undefined
    );

    // My-listings view includes sold history for the seller.
    const mine = await getMyMarketplaceListings('seller-1');
    assert.equal(mine.listings.length, 2);
    assert.ok(mine.listings.every((row) => row.status === 'sold'));

    assert.ok(MarketplaceServiceError, 'error class is exported');
  } finally {
    setMarketplaceConnectionFactoryForTests(null);
    for (const [key, value] of Object.entries({
      SOLANA_RPC_URL: previousEnv.rpc,
      GAME_TOKEN_MINT: previousEnv.mint,
      GAME_TOKEN_SYMBOL: previousEnv.symbol,
      SKIN_SHOP_TOKEN_MINT: previousEnv.legacyMint,
      SKIN_SHOP_TOKEN_SYMBOL: previousEnv.legacySymbol,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  console.log('marketplace-service tests passed');
}

runMarketplaceServiceTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
