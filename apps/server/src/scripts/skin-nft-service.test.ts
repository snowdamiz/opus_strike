import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';

type OwnershipRow = {
  userId: string;
  skinId: string;
  source: string;
  purchaseId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
};

type NftAssetRow = {
  assetAddress: string;
  collectionAddress: string;
  ownerWalletAddress: string;
  ownerUserId: string | null;
  skinId: string;
  heroId: string | null;
  rarity: string | null;
  metadataUri: string | null;
  name: string | null;
  edition: string | null;
  serial: string | null;
  source: string | null;
  sourcePurchaseId: string | null;
  mintSignature: string | null;
  firstSeenAt: Date;
  lastSyncedAt: Date;
  revokedAt: Date | null;
};

function createFakePrisma() {
  const ownerships: OwnershipRow[] = [];
  const nftAssets = new Map<string, NftAssetRow>();
  const walletSyncs = new Map<string, any>();
  const heroLoadouts = [
    {
      userId: 'user-a',
      heroId: 'phantom',
      selectedSkinId: 'phantom.void-monarch',
    },
  ];

  const prisma: any = {
    skinNftAsset: {
      upsert: async ({ where, create, update }: any) => {
        const current = nftAssets.get(where.assetAddress);
        if (current) {
          Object.assign(current, update);
          return { ...current };
        }
        const row = { ...create };
        nftAssets.set(where.assetAddress, row);
        return { ...row };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of nftAssets.values()) {
          if (where.ownerUserId !== undefined && row.ownerUserId !== where.ownerUserId) continue;
          if (where.ownerWalletAddress !== undefined && row.ownerWalletAddress !== where.ownerWalletAddress) continue;
          if (where.collectionAddress !== undefined && row.collectionAddress !== where.collectionAddress) continue;
          if (where.revokedAt === null && row.revokedAt !== null) continue;
          if (where.assetAddress?.notIn?.includes(row.assetAddress)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
    },
    skinNftWalletSync: {
      findUnique: async ({ where }: any) => {
        const key = `${where.userId_walletAddress_collectionAddress.userId}:${where.userId_walletAddress_collectionAddress.walletAddress}:${where.userId_walletAddress_collectionAddress.collectionAddress}`;
        const row = walletSyncs.get(key);
        return row ? { ...row } : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const key = `${where.userId_walletAddress_collectionAddress.userId}:${where.userId_walletAddress_collectionAddress.walletAddress}:${where.userId_walletAddress_collectionAddress.collectionAddress}`;
        const current = walletSyncs.get(key);
        if (current) {
          Object.assign(current, update);
          return { ...current };
        }
        const row = { ...create };
        walletSyncs.set(key, row);
        return { ...row };
      },
    },
    userSkinOwnership: {
      findUnique: async ({ where }: any) => {
        const row = ownerships.find((ownership) => (
          ownership.userId === where.userId_skinId.userId &&
          ownership.skinId === where.userId_skinId.skinId
        ));
        return row ? { source: row.source } : null;
      },
      upsert: async ({ where, create, update }: any) => {
        const row = ownerships.find((ownership) => (
          ownership.userId === where.userId_skinId.userId &&
          ownership.skinId === where.userId_skinId.skinId
        ));
        if (row) {
          Object.assign(row, update);
          return { ...row };
        }
        const next = {
          purchaseId: null,
          revokedAt: null,
          ...create,
        };
        ownerships.push(next);
        return { ...next };
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of ownerships) {
          if (where.userId !== undefined && row.userId !== where.userId) continue;
          if (where.source !== undefined && row.source !== where.source) continue;
          if (where.revokedAt === null && row.revokedAt !== null) continue;
          if (where.skinId?.notIn?.includes(row.skinId)) continue;
          Object.assign(row, data);
          count += 1;
        }
        return { count };
      },
      findMany: async ({ where }: any) => ownerships
        .filter((row) => row.userId === where.userId && (where.revokedAt === undefined || row.revokedAt === where.revokedAt))
        .map((row) => ({ ...row })),
    },
    userHeroLoadout: {
      findMany: async ({ where }: any) => heroLoadouts
        .filter((row) => row.userId === where.userId)
        .map((row) => ({ ...row })),
      update: async ({ where, data }: any) => {
        const row = heroLoadouts.find((loadout) => (
          loadout.userId === where.userId_heroId.userId &&
          loadout.heroId === where.userId_heroId.heroId
        ));
        assert.ok(row);
        Object.assign(row, data);
        return { ...row };
      },
    },
    $transaction: async (callback: (transaction: any) => Promise<unknown>) => callback(prisma),
  };

  return { prisma, ownerships, nftAssets, heroLoadouts };
}

function dasAsset(input: {
  assetAddress: string;
  collectionAddress: string;
  ownerAddress: string;
  skinId: string;
}) {
  return {
    id: input.assetAddress,
    ownership: { owner: input.ownerAddress },
    grouping: [{ group_key: 'collection', group_value: input.collectionAddress }],
    content: {
      json_uri: `https://metadata.example/${input.skinId}.json`,
      metadata: {
        name: 'Void Monarch',
        attributes: [
          { trait_type: 'skinId', value: input.skinId },
          { trait_type: 'heroId', value: 'phantom' },
          { trait_type: 'rarity', value: 'epic' },
          { trait_type: 'edition', value: 'genesis' },
          { trait_type: 'serial', value: 'TEST001' },
          { trait_type: 'source', value: 'test' },
        ],
      },
    },
  };
}

async function runSkinNftServiceTests() {
  const previousEnv = {
    SKIN_NFT_ENABLED: process.env.SKIN_NFT_ENABLED,
    SKIN_NFT_COLLECTION_ADDRESS: process.env.SKIN_NFT_COLLECTION_ADDRESS,
    SKIN_NFT_DAS_RPC_URL: process.env.SKIN_NFT_DAS_RPC_URL,
    SKIN_NFT_METADATA_BASE_URI: process.env.SKIN_NFT_METADATA_BASE_URI,
    SOLANA_RPC_URL: process.env.SOLANA_RPC_URL,
  };
  const previousFetch = globalThis.fetch;

  const collectionAddress = Keypair.generate().publicKey.toBase58();
  const ownerAddress = Keypair.generate().publicKey.toBase58();
  const assetAddress = Keypair.generate().publicKey.toBase58();
  const fake = createFakePrisma();
  (globalThis as any).prisma = fake.prisma;

  process.env.SKIN_NFT_ENABLED = 'true';
  process.env.SKIN_NFT_COLLECTION_ADDRESS = collectionAddress;
  process.env.SKIN_NFT_DAS_RPC_URL = 'https://das.example/rpc';
  process.env.SKIN_NFT_METADATA_BASE_URI = 'https://metadata.example';
  process.env.SOLANA_RPC_URL = 'https://solana.example/rpc';

  let dasItems: unknown[] = [
    dasAsset({
      assetAddress,
      collectionAddress,
      ownerAddress,
      skinId: 'phantom.void-monarch',
    }),
    dasAsset({
      assetAddress: Keypair.generate().publicKey.toBase58(),
      collectionAddress: Keypair.generate().publicKey.toBase58(),
      ownerAddress,
      skinId: 'phantom.nightglass-wraith',
    }),
  ];

  (globalThis as any).fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      result: {
        items: dasItems,
        total: dasItems.length,
      },
    }),
  });

  const {
    parseVerifiedSkinNftAsset,
    resolveSkinNftMetadataUri,
    syncWalletNftOwnership,
  } = await import('../cosmetics/skinNftService');

  const parsed = parseVerifiedSkinNftAsset(dasItems[0]);
  assert.equal(parsed?.assetAddress, assetAddress);
  assert.equal(parsed?.skinId, 'phantom.void-monarch');
  assert.equal(parseVerifiedSkinNftAsset(dasItems[1]), null, 'unverified collection assets are ignored');
  assert.equal(
    resolveSkinNftMetadataUri({
      skin: {
        id: 'phantom.void-monarch',
        heroId: 'phantom',
        displayName: 'Void Monarch',
        subtitle: '',
        rarity: 'epic',
        availability: 'paid',
        releaseState: 'live',
        modelDocumentId: 'phantom.void-monarch',
      },
      overrideUri: 'ipfs://skin-json',
    }),
    'ipfs://skin-json'
  );

  const firstSync = await syncWalletNftOwnership({
    userId: 'user-a',
    walletAddress: ownerAddress,
    force: true,
  });
  assert.equal(firstSync.assetCount, 1);
  assert.equal(firstSync.activeEntitlementCount, 1);
  assert.equal(fake.ownerships[0]?.source, 'nft');
  assert.equal(fake.ownerships[0]?.revokedAt, null);
  assert.equal(fake.heroLoadouts[0].selectedSkinId, 'phantom.void-monarch');

  dasItems = [];
  const secondSync = await syncWalletNftOwnership({
    userId: 'user-a',
    walletAddress: ownerAddress,
    force: true,
  });
  assert.equal(secondSync.assetCount, 0);
  assert.ok(fake.ownerships[0]?.revokedAt);
  assert.ok(fake.nftAssets.get(assetAddress)?.revokedAt);
  assert.equal(fake.heroLoadouts[0].selectedSkinId, 'phantom.default');

  if (previousFetch === undefined) {
    delete (globalThis as any).fetch;
  } else {
    globalThis.fetch = previousFetch;
  }
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

runSkinNftServiceTests()
  .then(() => {
    console.log('skin nft service tests passed');
  });
