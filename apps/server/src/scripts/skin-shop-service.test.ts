import assert from 'node:assert/strict';

type SkinShopItemRow = {
  skinId: string;
  saleEnabled: boolean;
  tokenAmountBaseUnits: bigint | null;
  displayNote: string | null;
  priceVersion: number;
  updatedByUserId: string | null;
  updatedAt: Date;
};

function createFakePrisma() {
  const item: SkinShopItemRow = {
    skinId: 'phantom.void-monarch',
    saleEnabled: false,
    tokenAmountBaseUnits: null,
    displayNote: 'Game SPL token has not launched yet',
    priceVersion: 1,
    updatedByUserId: null,
    updatedAt: new Date('2026-06-24T12:00:00.000Z'),
  };
  const audits: any[] = [];
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
    prisma: {
      skinShopItemSettings: {
        upsert: async ({ where }: any) => {
          assert.deepEqual(where, { skinId: item.skinId });
          return { ...item };
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
  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  const { updateSkinShopItemSettings } = await import('../cosmetics/skinShopService');

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

  const updated = await updateSkinShopItemSettings({
    skinId: 'phantom.void-monarch',
    saleEnabled: true,
    tokenAmountBaseUnits: '2500000',
    displayNote: '  launch   price  ',
    expectedPriceVersion: 1,
    updatedByUserId: 'admin-a',
  });

  assert.equal(updated.skinId, 'phantom.void-monarch');
  assert.equal(updated.saleEnabled, true);
  assert.equal(updated.tokenAmountBaseUnits, '2500000');
  assert.equal(updated.displayNote, 'launch price');
  assert.equal(updated.priceVersion, 2);
  assert.equal(updated.updatedByUserId, 'admin-a');
  assert.equal(fake.audits.length, 1);
  assert.equal(fake.audits[0].oldTokenAmountBaseUnits, null);
  assert.equal(fake.audits[0].newTokenAmountBaseUnits, 2500000n);
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
}

runSkinShopServiceTests()
  .then(() => {
    console.log('skin shop service tests passed');
  });
