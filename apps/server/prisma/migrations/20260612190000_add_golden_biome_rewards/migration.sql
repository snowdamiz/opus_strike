CREATE TYPE "GoldenBiomeRewardStatus" AS ENUM ('pending', 'processing', 'complete', 'failed');

CREATE TYPE "GoldenBiomeRewardTransferStatus" AS ENUM ('pending', 'submitted', 'confirmed', 'failed');

CREATE TABLE "GoldenBiomeReward" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "lobbyId" TEXT,
  "mapSeed" INTEGER NOT NULL,
  "mapThemeId" TEXT NOT NULL DEFAULT 'golden',
  "winningTeam" TEXT NOT NULL,
  "treasuryWallet" TEXT NOT NULL,
  "rewardUsdCents" INTEGER NOT NULL,
  "solUsdPriceMicroUsd" BIGINT NOT NULL,
  "rewardLamports" BIGINT NOT NULL,
  "totalRewardLamports" BIGINT NOT NULL,
  "paidPlayerCount" INTEGER NOT NULL,
  "treasuryBalanceLamports" BIGINT NOT NULL,
  "status" "GoldenBiomeRewardStatus" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "GoldenBiomeReward_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GoldenBiomeRewardTransfer" (
  "id" TEXT NOT NULL,
  "rewardId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playerSessionId" TEXT NOT NULL,
  "recipientWallet" TEXT NOT NULL,
  "amountLamports" BIGINT NOT NULL,
  "signature" TEXT,
  "status" "GoldenBiomeRewardTransferStatus" NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  CONSTRAINT "GoldenBiomeRewardTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GoldenBiomeReward_matchId_key" ON "GoldenBiomeReward"("matchId");
CREATE INDEX "GoldenBiomeReward_roomId_idx" ON "GoldenBiomeReward"("roomId");
CREATE INDEX "GoldenBiomeReward_lobbyId_idx" ON "GoldenBiomeReward"("lobbyId");
CREATE INDEX "GoldenBiomeReward_status_idx" ON "GoldenBiomeReward"("status");
CREATE INDEX "GoldenBiomeReward_createdAt_idx" ON "GoldenBiomeReward"("createdAt");

CREATE UNIQUE INDEX "GoldenBiomeRewardTransfer_idempotencyKey_key" ON "GoldenBiomeRewardTransfer"("idempotencyKey");
CREATE UNIQUE INDEX "GoldenBiomeRewardTransfer_signature_key" ON "GoldenBiomeRewardTransfer"("signature");
CREATE UNIQUE INDEX "GoldenBiomeRewardTransfer_rewardId_recipientWallet_key" ON "GoldenBiomeRewardTransfer"("rewardId", "recipientWallet");
CREATE INDEX "GoldenBiomeRewardTransfer_rewardId_idx" ON "GoldenBiomeRewardTransfer"("rewardId");
CREATE INDEX "GoldenBiomeRewardTransfer_userId_idx" ON "GoldenBiomeRewardTransfer"("userId");
CREATE INDEX "GoldenBiomeRewardTransfer_recipientWallet_idx" ON "GoldenBiomeRewardTransfer"("recipientWallet");
CREATE INDEX "GoldenBiomeRewardTransfer_status_idx" ON "GoldenBiomeRewardTransfer"("status");

ALTER TABLE "GoldenBiomeRewardTransfer"
  ADD CONSTRAINT "GoldenBiomeRewardTransfer_rewardId_fkey"
  FOREIGN KEY ("rewardId") REFERENCES "GoldenBiomeReward"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
