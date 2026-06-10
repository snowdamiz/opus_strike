CREATE TYPE "MatchMode" AS ENUM ('quick_play', 'ranked', 'custom', 'custom_wager');

ALTER TABLE "GameMatch"
  ADD COLUMN "matchMode" "MatchMode" NOT NULL DEFAULT 'custom';

UPDATE "GameMatch"
SET "matchMode" = 'quick_play'
WHERE "rankedEligible" = true;

CREATE TABLE "RankedEntryQuote" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "usdCents" INTEGER NOT NULL,
  "solUsdPriceMicroUsd" BIGINT NOT NULL,
  "coverChargeLamports" BIGINT NOT NULL,
  "priceSource" TEXT NOT NULL,
  "cluster" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RankedEntryQuote_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "WageredLobby"
  ADD COLUMN "matchMode" "MatchMode" NOT NULL DEFAULT 'custom_wager',
  ADD COLUMN "rankedEntryQuoteId" TEXT;

ALTER TABLE "WagerPayment"
  ADD COLUMN "rankedEntryQuoteId" TEXT,
  ADD COLUMN "refundReason" TEXT,
  ADD COLUMN "refundGrossLamports" BIGINT,
  ADD COLUMN "refundOutboundFeeLamports" BIGINT,
  ADD COLUMN "refundNetLamports" BIGINT,
  ADD COLUMN "refundFeeSource" TEXT;

ALTER TABLE "WagerSettlementTransfer"
  ADD COLUMN "refundReason" TEXT,
  ADD COLUMN "refundGrossLamports" BIGINT,
  ADD COLUMN "refundOutboundFeeLamports" BIGINT,
  ADD COLUMN "refundNetLamports" BIGINT,
  ADD COLUMN "refundFeeSource" TEXT;

CREATE INDEX "GameMatch_matchMode_idx" ON "GameMatch"("matchMode");

CREATE INDEX "RankedEntryQuote_userId_createdAt_idx" ON "RankedEntryQuote"("userId", "createdAt");
CREATE INDEX "RankedEntryQuote_expiresAt_idx" ON "RankedEntryQuote"("expiresAt");
CREATE INDEX "RankedEntryQuote_coverChargeLamports_idx" ON "RankedEntryQuote"("coverChargeLamports");

CREATE INDEX "WageredLobby_matchMode_idx" ON "WageredLobby"("matchMode");
CREATE INDEX "WageredLobby_rankedEntryQuoteId_idx" ON "WageredLobby"("rankedEntryQuoteId");

CREATE INDEX "WagerPayment_rankedEntryQuoteId_idx" ON "WagerPayment"("rankedEntryQuoteId");

ALTER TABLE "RankedEntryQuote"
  ADD CONSTRAINT "RankedEntryQuote_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WageredLobby"
  ADD CONSTRAINT "WageredLobby_rankedEntryQuoteId_fkey"
  FOREIGN KEY ("rankedEntryQuoteId") REFERENCES "RankedEntryQuote"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WagerPayment"
  ADD CONSTRAINT "WagerPayment_rankedEntryQuoteId_fkey"
  FOREIGN KEY ("rankedEntryQuoteId") REFERENCES "RankedEntryQuote"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
