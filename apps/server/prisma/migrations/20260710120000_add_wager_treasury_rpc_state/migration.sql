CREATE TABLE "WagerTreasuryRpcState" (
  "id" TEXT NOT NULL,
  "cluster" TEXT NOT NULL,
  "treasuryWallet" TEXT NOT NULL,
  "lastScannedSignature" TEXT,
  "capacityBlockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "WagerTreasuryRpcState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WagerTreasuryRpcState_cluster_treasuryWallet_key"
  ON "WagerTreasuryRpcState"("cluster", "treasuryWallet");

CREATE INDEX "WagerTreasuryRpcState_capacityBlockedUntil_idx"
  ON "WagerTreasuryRpcState"("capacityBlockedUntil");
