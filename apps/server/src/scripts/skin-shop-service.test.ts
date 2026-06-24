import assert from 'node:assert/strict';

type SkinShopItemRow = {
  skinId: string;
  saleEnabled: boolean;
  tokenAmountBaseUnits: bigint | null;
  maxSupply: number | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: Date;
};

type SkinShopSettingsRow = {
  id: string;
  enabled: boolean;
  tokenMintAddress: string | null;
  tokenSymbol: string;
  cluster: string;
  updatedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

function createFakePrisma() {
  const shop: SkinShopSettingsRow = {
    id: 'default',
    enabled: false,
    tokenMintAddress: null,
    tokenSymbol: '',
    cluster: 'devnet',
    updatedByUserId: null,
    createdAt: new Date('2026-06-24T12:00:00.000Z'),
    updatedAt: new Date('2026-06-24T12:00:00.000Z'),
  };
  const item: SkinShopItemRow = {
    skinId: 'phantom.void-monarch',
    saleEnabled: false,
    tokenAmountBaseUnits: null,
    maxSupply: null,
    priceVersion: 1,
    updatedByUserId: null,
    updatedAt: new Date('2026-06-24T12:00:00.000Z'),
  };
  const audits: any[] = [];
  let itemCreateManyCount = 0;
  let itemFindUniqueCount = 0;
  let lastShopCreate: Record<string, unknown> | null = null;
  let lastShopUpdate: Record<string, unknown> | null = null;
  const tx = {
    skinShopItemSettings: {
      update: async ({ where, data }: any) => {
        assert.deepEqual(where, { skinId: item.skinId });
        Object.assign(item, data);
        item.updatedAt = new Date('2026-06-24T12:05:00.000Z');
        return { ...item };
      },
    },
    skinShopItemAudit: {
      create: async ({ data }: any) => {
        const audit = {
          id: `audit-${audits.length + 1}`,
          createdAt: new Date('2026-06-24T12:05:00.000Z'),
          ...data,
        };
        audits.push(audit);
        return audit;
      },
    },
  };

  return {
    item,
    audits,
    get itemCreateManyCount() {
      return itemCreateManyCount;
    },
    get itemFindUniqueCount() {
      return itemFindUniqueCount;
    },
    get lastShopCreate() {
      return lastShopCreate;
    },
    get lastShopUpdate() {
      return lastShopUpdate;
    },
    prisma: {
      skinShopSettings: {
        upsert: async ({ where, create, update }: any) => {
          assert.deepEqual(where, { id: shop.id });
          lastShopCreate = { ...create };
          lastShopUpdate = { ...update };
          Object.assign(shop, create, update, {
            id: shop.id,
            updatedAt: new Date('2026-06-24T12:10:00.000Z'),
          });
          return { ...shop };
        },
      },
      skinShopItemSettings: {
        createMany: async ({ data, skipDuplicates }: any) => {
          assert.equal(skipDuplicates, true);
          assert.deepEqual(data, [{
            skinId: item.skinId,
            saleEnabled: false,
            tokenAmountBaseUnits: null,
            maxSupply: null,
          }]);
          itemCreateManyCount += 1;
          return { count: 0 };
        },
        findUnique: async ({ where }: any) => {
          assert.deepEqual(where, { skinId: item.skinId });
          itemFindUniqueCount += 1;
          return { ...item };
        },
      },
      skinPurchaseIntent: {
        count: async () => 0,
      },
      $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
    },
  };
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

async function runSkinShopServiceTests() {
  const previousTreasuryWallet = process.env.WAGER_TREASURY_WALLET;
  const previousSolanaRpcUrl = process.env.SOLANA_RPC_URL;
  process.env.WAGER_TREASURY_WALLET = 'Treasury1111111111111111111111111111111111';
  process.env.SOLANA_RPC_URL = 'https://example.invalid/rpc';

  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  const { updateSkinShopItemSettings, updateSkinShopSettings } = await import('../cosmetics/skinShopService');

  const shop = await updateSkinShopSettings({
    enabled: false,
    tokenSymbol: 'TBA',
    updatedByUserId: 'admin-a',
  });
  assert.equal(shop.treasuryWallet, process.env.WAGER_TREASURY_WALLET);
  assert.equal(shop.rpcConfigured, true);
  assert.equal(shop.tokenSymbol, '');
  assert.equal('treasuryWallet' in fake.lastShopCreate!, false);
  assert.equal('treasuryWallet' in fake.lastShopUpdate!, false);
  assert.equal('rpcUrl' in fake.lastShopCreate!, false);
  assert.equal('rpcUrl' in fake.lastShopUpdate!, false);

  await expectServiceError(
    () => updateSkinShopItemSettings({
      skinId: 'phantom.default' as never,
      saleEnabled: true,
      tokenAmountBaseUnits: '1000',
      updatedByUserId: 'admin-a',
    }),
    /Default skins cannot be priced/
  );

  await expectServiceError(
    () => updateSkinShopItemSettings({
      skinId: 'phantom.void-monarch',
      saleEnabled: true,
      expectedPriceVersion: 1,
      updatedByUserId: 'admin-a',
    }),
    /Token amount is required/
  );
  assert.equal(fake.itemCreateManyCount, 1);
  assert.equal(fake.itemFindUniqueCount, 1);

  await expectServiceError(
    () => updateSkinShopItemSettings({
      skinId: 'phantom.void-monarch',
      saleEnabled: true,
      tokenAmountBaseUnits: '0',
      expectedPriceVersion: 1,
      updatedByUserId: 'admin-a',
    }),
    /greater than zero/
  );

  await expectServiceError(
    () => updateSkinShopItemSettings({
      skinId: 'phantom.void-monarch',
      saleEnabled: false,
      expectedPriceVersion: 99,
      updatedByUserId: 'admin-a',
    }),
    /updated by another admin/,
    409
  );

  await expectServiceError(
    () => updateSkinShopItemSettings({
      skinId: 'phantom.void-monarch',
      saleEnabled: false,
      maxSupply: '0',
      expectedPriceVersion: 1,
      updatedByUserId: 'admin-a',
    }),
    /Supply cap must be greater than zero/
  );

  const updated = await updateSkinShopItemSettings({
    skinId: 'phantom.void-monarch',
    saleEnabled: true,
    tokenAmountBaseUnits: '2500000',
    maxSupply: '100',
    expectedPriceVersion: 1,
    updatedByUserId: 'admin-a',
  });

  assert.equal(updated.skinId, 'phantom.void-monarch');
  assert.equal(updated.saleEnabled, true);
  assert.equal(updated.tokenAmountBaseUnits, '2500000');
  assert.equal(updated.maxSupply, 100);
  assert.equal(updated.soldCount, 0);
  assert.equal(updated.reservedCount, 0);
  assert.equal(updated.remainingSupply, 100);
  assert.deepEqual(Object.keys(updated).sort(), [
    'maxSupply',
    'priceVersion',
    'remainingSupply',
    'reservedCount',
    'saleEnabled',
    'skinId',
    'soldCount',
    'tokenAmountBaseUnits',
    'updatedAt',
    'updatedByUserId',
  ]);
  assert.equal(updated.priceVersion, 2);
  assert.equal(updated.updatedByUserId, 'admin-a');
  assert.equal(fake.audits.length, 1);
  assert.equal(fake.audits[0].oldTokenAmountBaseUnits, null);
  assert.equal(fake.audits[0].newTokenAmountBaseUnits, 2500000n);
  assert.equal(fake.audits[0].oldMaxSupply, null);
  assert.equal(fake.audits[0].newMaxSupply, 100);
  assert.equal(fake.audits[0].oldSaleEnabled, false);
  assert.equal(fake.audits[0].newSaleEnabled, true);
  assert.equal(fake.audits[0].oldPriceVersion, 1);
  assert.equal(fake.audits[0].newPriceVersion, 2);

  await expectServiceError(
    () => updateSkinShopItemSettings({
      skinId: 'phantom.void-monarch',
      saleEnabled: false,
      expectedPriceVersion: 1,
      updatedByUserId: 'admin-b',
    }),
    /updated by another admin/,
    409
  );

  if (previousTreasuryWallet === undefined) {
    delete process.env.WAGER_TREASURY_WALLET;
  } else {
    process.env.WAGER_TREASURY_WALLET = previousTreasuryWallet;
  }
  if (previousSolanaRpcUrl === undefined) {
    delete process.env.SOLANA_RPC_URL;
  } else {
    process.env.SOLANA_RPC_URL = previousSolanaRpcUrl;
  }
}

runSkinShopServiceTests()
  .then(() => {
    console.log('skin shop service tests passed');
  });
