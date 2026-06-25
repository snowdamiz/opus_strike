-- Paid hero skin ownership, loadouts, purchase intents, and admin shop settings.

CREATE TYPE "SkinEntitlementSource" AS ENUM ('free', 'paid', 'admin_grant', 'event');

CREATE TYPE "SkinPurchaseIntentStatus" AS ENUM (
  'intent_created',
  'transaction_built',
  'submitted',
  'confirmed',
  'credited',
  'failed',
  'expired'
);

CREATE TABLE "SkinShopSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "tokenMintAddress" TEXT,
  "tokenSymbol" TEXT NOT NULL DEFAULT 'TOKEN',
  "treasuryWallet" TEXT,
  "rpcUrl" TEXT,
  "cluster" TEXT NOT NULL DEFAULT 'devnet',
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkinShopSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkinShopItemSettings" (
  "skinId" TEXT NOT NULL,
  "saleEnabled" BOOLEAN NOT NULL DEFAULT false,
  "tokenAmountBaseUnits" BIGINT,
  "displayNote" TEXT,
  "priceVersion" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkinShopItemSettings_pkey" PRIMARY KEY ("skinId")
);

CREATE TABLE "SkinShopItemAudit" (
  "id" TEXT NOT NULL,
  "skinId" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "oldTokenAmountBaseUnits" BIGINT,
  "newTokenAmountBaseUnits" BIGINT,
  "oldSaleEnabled" BOOLEAN,
  "newSaleEnabled" BOOLEAN,
  "oldDisplayNote" TEXT,
  "newDisplayNote" TEXT,
  "oldPriceVersion" INTEGER,
  "newPriceVersion" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkinShopItemAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserSkinOwnership" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "skinId" TEXT NOT NULL,
  "source" "SkinEntitlementSource" NOT NULL,
  "purchaseId" TEXT,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "UserSkinOwnership_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SkinPurchaseIntent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "skinId" TEXT NOT NULL,
  "quotedPriceVersion" INTEGER NOT NULL,
  "tokenMintAddress" TEXT NOT NULL,
  "tokenSymbol" TEXT NOT NULL,
  "tokenAmountBaseUnits" BIGINT NOT NULL,
  "tokenDecimals" INTEGER,
  "treasuryWallet" TEXT NOT NULL,
  "treasuryTokenAccount" TEXT NOT NULL,
  "cluster" TEXT NOT NULL,
  "memo" TEXT NOT NULL,
  "status" "SkinPurchaseIntentStatus" NOT NULL DEFAULT 'intent_created',
  "transactionSignature" TEXT,
  "intentExpiresAt" TIMESTAMP(3) NOT NULL,
  "lastValidBlockHeight" BIGINT,
  "creditedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SkinPurchaseIntent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserHeroLoadout" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "heroId" TEXT NOT NULL,
  "selectedSkinId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserHeroLoadout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSkinOwnership_purchaseId_key" ON "UserSkinOwnership"("purchaseId");
CREATE UNIQUE INDEX "UserSkinOwnership_userId_skinId_key" ON "UserSkinOwnership"("userId", "skinId");
CREATE INDEX "UserSkinOwnership_userId_revokedAt_idx" ON "UserSkinOwnership"("userId", "revokedAt");
CREATE INDEX "UserSkinOwnership_skinId_grantedAt_idx" ON "UserSkinOwnership"("skinId", "grantedAt");

CREATE UNIQUE INDEX "SkinPurchaseIntent_memo_key" ON "SkinPurchaseIntent"("memo");
CREATE UNIQUE INDEX "SkinPurchaseIntent_transactionSignature_key" ON "SkinPurchaseIntent"("transactionSignature");
CREATE INDEX "SkinPurchaseIntent_userId_status_createdAt_idx" ON "SkinPurchaseIntent"("userId", "status", "createdAt");
CREATE INDEX "SkinPurchaseIntent_walletAddress_idx" ON "SkinPurchaseIntent"("walletAddress");
CREATE INDEX "SkinPurchaseIntent_skinId_status_idx" ON "SkinPurchaseIntent"("skinId", "status");
CREATE INDEX "SkinPurchaseIntent_status_intentExpiresAt_idx" ON "SkinPurchaseIntent"("status", "intentExpiresAt");

CREATE INDEX "SkinShopItemAudit_skinId_createdAt_idx" ON "SkinShopItemAudit"("skinId", "createdAt");
CREATE INDEX "SkinShopItemAudit_updatedByUserId_createdAt_idx" ON "SkinShopItemAudit"("updatedByUserId", "createdAt");

CREATE UNIQUE INDEX "UserHeroLoadout_userId_heroId_key" ON "UserHeroLoadout"("userId", "heroId");
CREATE INDEX "UserHeroLoadout_userId_idx" ON "UserHeroLoadout"("userId");
CREATE INDEX "UserHeroLoadout_selectedSkinId_idx" ON "UserHeroLoadout"("selectedSkinId");

ALTER TABLE "SkinShopItemAudit"
  ADD CONSTRAINT "SkinShopItemAudit_skinId_fkey"
  FOREIGN KEY ("skinId") REFERENCES "SkinShopItemSettings"("skinId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSkinOwnership"
  ADD CONSTRAINT "UserSkinOwnership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserSkinOwnership"
  ADD CONSTRAINT "UserSkinOwnership_purchaseId_fkey"
  FOREIGN KEY ("purchaseId") REFERENCES "SkinPurchaseIntent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SkinPurchaseIntent"
  ADD CONSTRAINT "SkinPurchaseIntent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserHeroLoadout"
  ADD CONSTRAINT "UserHeroLoadout_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
