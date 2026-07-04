UPDATE "WagerSettlementTransfer"
SET "kind" = 'treasury_fee'
WHERE "kind" = 'developer_fee';

ALTER TABLE "WagerSettlementTransfer"
  ADD COLUMN "tokenMintAddress" TEXT,
  ADD COLUMN "tokenProgramId" TEXT,
  ADD COLUMN "tokenDecimals" INTEGER,
  ADD COLUMN "tokenAccountAddress" TEXT,
  ADD COLUMN "convertedTokenBaseUnits" BIGINT,
  ADD COLUMN "conversionSignature" TEXT,
  ADD COLUMN "burnSignature" TEXT;

CREATE UNIQUE INDEX "WagerSettlementTransfer_conversionSignature_key"
  ON "WagerSettlementTransfer"("conversionSignature");

CREATE UNIQUE INDEX "WagerSettlementTransfer_burnSignature_key"
  ON "WagerSettlementTransfer"("burnSignature");

CREATE TYPE "WagerSettlementTransferKind_new" AS ENUM (
  'winner_payout',
  'treasury_fee',
  'burn',
  'refund'
);

ALTER TABLE "WagerSettlementTransfer"
  ALTER COLUMN "kind" TYPE "WagerSettlementTransferKind_new"
  USING ("kind"::text::"WagerSettlementTransferKind_new");

DROP TYPE "WagerSettlementTransferKind";

ALTER TYPE "WagerSettlementTransferKind_new"
  RENAME TO "WagerSettlementTransferKind";
