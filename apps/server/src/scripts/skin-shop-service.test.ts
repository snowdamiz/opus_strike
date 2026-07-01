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
  const itemUpdatedAt = new Date('2026-06-24T12:00:00.000Z');
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
  const createItemRow = (skinId: string): SkinShopItemRow => ({
    skinId,
    saleEnabled: false,
    tokenAmountBaseUnits: null,
    maxSupply: null,
    priceVersion: 1,
    updatedByUserId: null,
    updatedAt: itemUpdatedAt,
  });
  const item = createItemRow('phantom.void-monarch');
  const itemRows = new Map<string, SkinShopItemRow>([[item.skinId, item]]);
  const ownerships = [
    {
      userId: 'user-a',
      skinId: 'phantom.void-monarch',
      source: 'paid',
      grantedAt: new Date('2026-06-24T12:15:00.000Z'),
      revokedAt: null,
    },
    {
      userId: 'user-a',
      skinId: 'phantom.nightglass-wraith',
      source: 'paid',
      grantedAt: new Date('2026-06-24T12:16:00.000Z'),
      revokedAt: null,
    },
  ];
  const heroLoadouts = [
    {
      userId: 'user-a',
      heroId: 'phantom',
      selectedSkinId: 'phantom.nightglass-wraith',
    },
  ];
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
        createMany: async ({ data, skipDuplicates }: any) => {
          assert.equal(skipDuplicates, true);
          assert.equal(Array.isArray(data), true);
          return { count: 0 };
        },
        findUnique: async ({ where }: any) => {
          assert.deepEqual(where, { id: shop.id });
          return { ...shop };
        },
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
          for (const row of data) {
            assert.equal(row.saleEnabled, false);
            assert.equal(row.tokenAmountBaseUnits, null);
            assert.equal(row.maxSupply, null);
            if (!itemRows.has(row.skinId)) itemRows.set(row.skinId, createItemRow(row.skinId));
          }
          itemCreateManyCount += 1;
          return { count: 0 };
        },
        findUnique: async ({ where }: any) => {
          assert.equal(typeof where.skinId, 'string');
          itemFindUniqueCount += 1;
          const row = itemRows.get(where.skinId);
          return row ? { ...row } : null;
        },
        findMany: async () => Array.from(itemRows.values()).map((row) => ({ ...row })),
      },
      skinPurchaseIntent: {
        count: async () => 0,
        groupBy: async () => [],
      },
      userSkinOwnership: {
        findMany: async ({ where }: any) => ownerships
          .filter((row) => row.userId === where.userId && row.revokedAt === where.revokedAt)
          .map((row) => ({ ...row })),
        findUnique: async ({ where }: any) => {
          const row = ownerships.find((ownership) => (
            ownership.userId === where.userId_skinId.userId &&
            ownership.skinId === where.userId_skinId.skinId
          ));
          return row ? { revokedAt: row.revokedAt } : null;
        },
      },
      userHeroLoadout: {
        findMany: async ({ where }: any) => heroLoadouts
          .filter((row) => row.userId === where.userId)
          .map((row) => ({ ...row })),
        findUnique: async ({ where }: any) => {
          const row = heroLoadouts.find((loadout) => (
            loadout.userId === where.userId_heroId.userId &&
            loadout.heroId === where.userId_heroId.heroId
          ));
          return row ? { selectedSkinId: row.selectedSkinId } : null;
        },
        upsert: async ({ where, create, update }: any) => {
          const row = heroLoadouts.find((loadout) => (
            loadout.userId === where.userId_heroId.userId &&
            loadout.heroId === where.userId_heroId.heroId
          ));
          if (row) {
            Object.assign(row, update);
            return { ...row };
          }
          const next = { ...create };
          heroLoadouts.push(next);
          return { ...next };
        },
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
  const previousGameTokenMint = process.env.GAME_TOKEN_MINT;
  const previousGameTokenSymbol = process.env.GAME_TOKEN_SYMBOL;
  const previousSkinShopTokenMint = process.env.SKIN_SHOP_TOKEN_MINT;
  const previousSkinShopTokenSymbol = process.env.SKIN_SHOP_TOKEN_SYMBOL;
  process.env.WAGER_TREASURY_WALLET = 'Treasury1111111111111111111111111111111111';
  process.env.SOLANA_RPC_URL = 'https://example.invalid/rpc';

  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  const {
    getSkinCatalogForUser,
    resolveUserLoadoutForHero,
    updateSkinShopItemSettings,
    updateSkinShopSettings,
    updateUserHeroLoadout,
  } = await import('../cosmetics/skinShopService');

  // No game token configured yet — the shop starts without a usable token.
  // Clear these AFTER importing the service: the import pulls in Prisma, which
  // loads the developer's .env into process.env and would otherwise re-populate
  // the token vars. getGameTokenConfig() also honours the legacy SKIN_SHOP_TOKEN_*
  // fallbacks, so clear those too to keep the test hermetic.
  delete process.env.GAME_TOKEN_MINT;
  delete process.env.GAME_TOKEN_SYMBOL;
  delete process.env.SKIN_SHOP_TOKEN_MINT;
  delete process.env.SKIN_SHOP_TOKEN_SYMBOL;

  const shop = await updateSkinShopSettings({
    enabled: false,
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

  const disabledShopCatalog = await getSkinCatalogForUser('user-a');
  assert.deepEqual(
    disabledShopCatalog.skins.filter((skin) => skin.availability === 'paid').map((skin) => skin.id),
    [],
    'paid skins stay out of the public catalog while the shop is disabled'
  );

  // Configure the global game token; the shop now transacts in it.
  process.env.GAME_TOKEN_MINT = 'So11111111111111111111111111111111111111112';
  process.env.GAME_TOKEN_SYMBOL = 'STRIKE';
  await updateSkinShopSettings({
    enabled: true,
    updatedByUserId: 'admin-a',
  });

  const enabledShopCatalog = await getSkinCatalogForUser('user-a');
  const enabledShopSkinIds = enabledShopCatalog.skins.map((skin) => skin.id);
  assert.ok(enabledShopSkinIds.includes('phantom.default'));
  assert.ok(enabledShopSkinIds.includes('phantom.void-monarch'));
  assert.equal(enabledShopCatalog.skins.find((skin) => skin.id === 'phantom.void-monarch')?.owned, true);
  assert.equal(enabledShopSkinIds.includes('phantom.nightglass-wraith'), false);
  assert.equal(
    enabledShopCatalog.loadouts.find((loadout) => loadout.heroId === 'phantom')?.skinId,
    'phantom.default',
    'saved hidden paid loadouts fall back to the default skin'
  );
  assert.equal(await resolveUserLoadoutForHero('user-a', 'phantom'), 'phantom.default');
  assert.equal(await resolveUserLoadoutForHero('user-a', 'phantom', 'phantom.void-monarch'), 'phantom.void-monarch');
  await expectServiceError(
    () => updateUserHeroLoadout({
      userId: 'user-a',
      heroId: 'phantom',
      skinId: 'phantom.nightglass-wraith',
    }),
    /not available in game/
  );
  assert.deepEqual(await updateUserHeroLoadout({
    userId: 'user-a',
    heroId: 'phantom',
    skinId: 'phantom.void-monarch',
  }), {
    heroId: 'phantom',
    skinId: 'phantom.void-monarch',
  });

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
  if (previousGameTokenMint === undefined) {
    delete process.env.GAME_TOKEN_MINT;
  } else {
    process.env.GAME_TOKEN_MINT = previousGameTokenMint;
  }
  if (previousGameTokenSymbol === undefined) {
    delete process.env.GAME_TOKEN_SYMBOL;
  } else {
    process.env.GAME_TOKEN_SYMBOL = previousGameTokenSymbol;
  }
  if (previousSkinShopTokenMint === undefined) {
    delete process.env.SKIN_SHOP_TOKEN_MINT;
  } else {
    process.env.SKIN_SHOP_TOKEN_MINT = previousSkinShopTokenMint;
  }
  if (previousSkinShopTokenSymbol === undefined) {
    delete process.env.SKIN_SHOP_TOKEN_SYMBOL;
  } else {
    process.env.SKIN_SHOP_TOKEN_SYMBOL = previousSkinShopTokenSymbol;
  }
}

runSkinShopServiceTests()
  .then(() => {
    console.log('skin shop service tests passed');
  });
