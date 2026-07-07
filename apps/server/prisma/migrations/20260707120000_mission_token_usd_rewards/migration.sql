ALTER TABLE "GameTokenPayout"
  ADD COLUMN "recipientAmountBaseUnits" BIGINT,
  ADD COLUMN "burnAmountBaseUnits" BIGINT,
  ADD COLUMN "playerShareBps" INTEGER NOT NULL DEFAULT 10000,
  ADD COLUMN "burnShareBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rewardUsdCents" INTEGER,
  ADD COLUMN "rewardSolLamports" BIGINT,
  ADD COLUMN "solUsdPriceMicroUsd" BIGINT,
  ADD COLUMN "priceSource" TEXT,
  ADD COLUMN "priceObservedAt" TIMESTAMP(3),
  ADD COLUMN "tokenProgramId" TEXT,
  ADD COLUMN "conversionSignature" TEXT,
  ADD COLUMN "convertedTokenBaseUnits" BIGINT,
  ADD COLUMN "burnSignature" TEXT;

UPDATE "GameTokenPayout"
SET "recipientAmountBaseUnits" = "tokenAmountBaseUnits"
WHERE "recipientAmountBaseUnits" IS NULL;

UPDATE "GameTokenPayout"
SET "burnAmountBaseUnits" = 0
WHERE "burnAmountBaseUnits" IS NULL;

CREATE UNIQUE INDEX "GameTokenPayout_conversionSignature_key" ON "GameTokenPayout"("conversionSignature");
CREATE UNIQUE INDEX "GameTokenPayout_burnSignature_key" ON "GameTokenPayout"("burnSignature");
