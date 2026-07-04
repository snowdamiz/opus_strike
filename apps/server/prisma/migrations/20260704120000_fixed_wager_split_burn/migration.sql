UPDATE "WagerSettlementTransfer"
SET "kind" = 'treasury_fee'
WHERE "kind" = 'developer_fee';

ALTER TABLE "WagerSettlement"
  RENAME COLUMN "developerFeeLamports" TO "treasuryFeeLamports";

ALTER TABLE "WagerSettlement"
  ADD COLUMN "burnLamports" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "WageredLobby"
  DROP COLUMN "platformFeeBps";

DROP TABLE IF EXISTS "WagerEconomySettings";
