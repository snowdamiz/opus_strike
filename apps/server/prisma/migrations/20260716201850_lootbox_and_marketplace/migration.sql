-- CreateEnum
CREATE TYPE "LootboxOpenIntentStatus" AS ENUM ('intent_created', 'transaction_built', 'submitted', 'confirmed', 'credited', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "MarketplaceListingStatus" AS ENUM ('active', 'pending_sale', 'sold', 'canceled');

-- CreateEnum
CREATE TYPE "MarketplacePurchaseIntentStatus" AS ENUM ('intent_created', 'transaction_built', 'submitted', 'confirmed', 'credited', 'failed', 'expired');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SkinEntitlementSource" ADD VALUE 'lootbox';
ALTER TYPE "SkinEntitlementSource" ADD VALUE 'marketplace';

-- CreateTable
CREATE TABLE "LootboxSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "priceTokens" TEXT NOT NULL DEFAULT '75000',
    "commonWeightBps" INTEGER NOT NULL DEFAULT 0,
    "epicWeightBps" INTEGER NOT NULL DEFAULT 7900,
    "uniqueWeightBps" INTEGER NOT NULL DEFAULT 1800,
    "legendaryWeightBps" INTEGER NOT NULL DEFAULT 300,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootboxSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LootboxOpenIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "quotedPriceTokens" TEXT NOT NULL,
    "tokenMintAddress" TEXT NOT NULL,
    "tokenSymbol" TEXT NOT NULL,
    "tokenAmountBaseUnits" BIGINT NOT NULL,
    "tokenDecimals" INTEGER,
    "treasuryWallet" TEXT NOT NULL,
    "treasuryTokenAccount" TEXT NOT NULL,
    "cluster" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "status" "LootboxOpenIntentStatus" NOT NULL DEFAULT 'intent_created',
    "transactionSignature" TEXT,
    "intentExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastValidBlockHeight" BIGINT,
    "resultSkinId" TEXT,
    "resultRarity" TEXT,
    "creditedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootboxOpenIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "listingHoldTokens" TEXT NOT NULL DEFAULT '200000',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "sellerWalletAddress" TEXT NOT NULL,
    "skinId" TEXT NOT NULL,
    "priceLamports" BIGINT NOT NULL,
    "status" "MarketplaceListingStatus" NOT NULL DEFAULT 'active',
    "reservedIntentId" TEXT,
    "reservedUntil" TIMESTAMP(3),
    "buyerUserId" TEXT,
    "soldAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplacePurchaseIntent" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "buyerWalletAddress" TEXT NOT NULL,
    "sellerUserId" TEXT NOT NULL,
    "sellerWalletAddress" TEXT NOT NULL,
    "skinId" TEXT NOT NULL,
    "priceLamports" BIGINT NOT NULL,
    "cluster" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "status" "MarketplacePurchaseIntentStatus" NOT NULL DEFAULT 'intent_created',
    "transactionSignature" TEXT,
    "intentExpiresAt" TIMESTAMP(3) NOT NULL,
    "lastValidBlockHeight" BIGINT,
    "creditedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplacePurchaseIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LootboxOpenIntent_memo_key" ON "LootboxOpenIntent"("memo");

-- CreateIndex
CREATE UNIQUE INDEX "LootboxOpenIntent_transactionSignature_key" ON "LootboxOpenIntent"("transactionSignature");

-- CreateIndex
CREATE INDEX "LootboxOpenIntent_userId_status_createdAt_idx" ON "LootboxOpenIntent"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "LootboxOpenIntent_walletAddress_idx" ON "LootboxOpenIntent"("walletAddress");

-- CreateIndex
CREATE INDEX "LootboxOpenIntent_status_intentExpiresAt_idx" ON "LootboxOpenIntent"("status", "intentExpiresAt");

-- CreateIndex
CREATE INDEX "LootboxOpenIntent_resultSkinId_idx" ON "LootboxOpenIntent"("resultSkinId");

-- CreateIndex
CREATE INDEX "MarketplaceListing_status_createdAt_idx" ON "MarketplaceListing"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplaceListing_sellerUserId_status_idx" ON "MarketplaceListing"("sellerUserId", "status");

-- CreateIndex
CREATE INDEX "MarketplaceListing_skinId_status_idx" ON "MarketplaceListing"("skinId", "status");

-- CreateIndex
CREATE INDEX "MarketplaceListing_status_reservedUntil_idx" ON "MarketplaceListing"("status", "reservedUntil");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePurchaseIntent_memo_key" ON "MarketplacePurchaseIntent"("memo");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplacePurchaseIntent_transactionSignature_key" ON "MarketplacePurchaseIntent"("transactionSignature");

-- CreateIndex
CREATE INDEX "MarketplacePurchaseIntent_buyerUserId_status_createdAt_idx" ON "MarketplacePurchaseIntent"("buyerUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MarketplacePurchaseIntent_listingId_status_idx" ON "MarketplacePurchaseIntent"("listingId", "status");

-- CreateIndex
CREATE INDEX "MarketplacePurchaseIntent_status_intentExpiresAt_idx" ON "MarketplacePurchaseIntent"("status", "intentExpiresAt");

-- AddForeignKey
ALTER TABLE "LootboxOpenIntent" ADD CONSTRAINT "LootboxOpenIntent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_sellerUserId_fkey" FOREIGN KEY ("sellerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePurchaseIntent" ADD CONSTRAINT "MarketplacePurchaseIntent_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplacePurchaseIntent" ADD CONSTRAINT "MarketplacePurchaseIntent_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
