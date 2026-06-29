-- NFT-backed paid skin delivery and wallet asset projection.

ALTER TYPE "SkinEntitlementSource" ADD VALUE IF NOT EXISTS 'nft';

DO $$
BEGIN
  CREATE TYPE "NftMintStatus" AS ENUM (
    'not_applicable',
    'pending',
    'minting',
    'minted',
    'failed'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "SkinPurchaseIntent"
  ADD COLUMN IF NOT EXISTS "nftMintStatus" "NftMintStatus" NOT NULL DEFAULT 'not_applicable',
  ADD COLUMN IF NOT EXISTS "mintedAssetAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "nftCollectionAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "nftMetadataUri" TEXT,
  ADD COLUMN IF NOT EXISTS "nftMintSignature" TEXT,
  ADD COLUMN IF NOT EXISTS "nftMintAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nftMintAttemptedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "nftMintError" TEXT;

ALTER TABLE "SkinShopItemSettings"
  ADD COLUMN IF NOT EXISTS "nftMetadataUriOverride" TEXT;

ALTER TABLE "SkinShopItemAudit"
  ADD COLUMN IF NOT EXISTS "oldNftMetadataUriOverride" TEXT,
  ADD COLUMN IF NOT EXISTS "newNftMetadataUriOverride" TEXT;

CREATE TABLE IF NOT EXISTS "SkinNftAsset" (
  "assetAddress" TEXT NOT NULL,
  "collectionAddress" TEXT NOT NULL,
  "ownerWalletAddress" TEXT NOT NULL,
  "ownerUserId" TEXT,
  "skinId" TEXT NOT NULL,
  "heroId" TEXT,
  "rarity" TEXT,
  "metadataUri" TEXT,
  "name" TEXT,
  "edition" TEXT,
  "serial" TEXT,
  "source" TEXT,
  "sourcePurchaseId" TEXT,
  "mintSignature" TEXT,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkinNftAsset_pkey" PRIMARY KEY ("assetAddress")
);

CREATE TABLE IF NOT EXISTS "SkinNftWalletSync" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "collectionAddress" TEXT NOT NULL,
  "assetCount" INTEGER NOT NULL DEFAULT 0,
  "activeEntitlementCount" INTEGER NOT NULL DEFAULT 0,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkinNftWalletSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SkinPurchaseIntent_mintedAssetAddress_key"
  ON "SkinPurchaseIntent"("mintedAssetAddress");
CREATE UNIQUE INDEX IF NOT EXISTS "SkinPurchaseIntent_nftMintSignature_key"
  ON "SkinPurchaseIntent"("nftMintSignature");
CREATE INDEX IF NOT EXISTS "SkinPurchaseIntent_nftMintStatus_updatedAt_idx"
  ON "SkinPurchaseIntent"("nftMintStatus", "updatedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "SkinNftAsset_sourcePurchaseId_key"
  ON "SkinNftAsset"("sourcePurchaseId");
CREATE UNIQUE INDEX IF NOT EXISTS "SkinNftAsset_mintSignature_key"
  ON "SkinNftAsset"("mintSignature");
CREATE INDEX IF NOT EXISTS "SkinNftAsset_ownerWalletAddress_revokedAt_idx"
  ON "SkinNftAsset"("ownerWalletAddress", "revokedAt");
CREATE INDEX IF NOT EXISTS "SkinNftAsset_ownerUserId_revokedAt_idx"
  ON "SkinNftAsset"("ownerUserId", "revokedAt");
CREATE INDEX IF NOT EXISTS "SkinNftAsset_collectionAddress_skinId_idx"
  ON "SkinNftAsset"("collectionAddress", "skinId");
CREATE INDEX IF NOT EXISTS "SkinNftAsset_skinId_revokedAt_idx"
  ON "SkinNftAsset"("skinId", "revokedAt");
CREATE INDEX IF NOT EXISTS "SkinNftAsset_lastSyncedAt_idx"
  ON "SkinNftAsset"("lastSyncedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "SkinNftWalletSync_userId_walletAddress_collectionAddress_key"
  ON "SkinNftWalletSync"("userId", "walletAddress", "collectionAddress");
CREATE INDEX IF NOT EXISTS "SkinNftWalletSync_walletAddress_collectionAddress_idx"
  ON "SkinNftWalletSync"("walletAddress", "collectionAddress");
CREATE INDEX IF NOT EXISTS "SkinNftWalletSync_lastSyncedAt_idx"
  ON "SkinNftWalletSync"("lastSyncedAt");

ALTER TABLE "SkinNftAsset"
  ADD CONSTRAINT "SkinNftAsset_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SkinNftAsset"
  ADD CONSTRAINT "SkinNftAsset_sourcePurchaseId_fkey"
  FOREIGN KEY ("sourcePurchaseId") REFERENCES "SkinPurchaseIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SkinNftWalletSync"
  ADD CONSTRAINT "SkinNftWalletSync_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
