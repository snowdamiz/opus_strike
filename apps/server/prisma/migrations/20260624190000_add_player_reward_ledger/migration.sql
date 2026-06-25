CREATE TYPE "PlayerRewardKind" AS ENUM ('daily_ranked_drip', 'objective_bounty', 'weekly_leaderboard');

CREATE TYPE "PlayerRewardStatus" AS ENUM ('pending', 'processing', 'paid', 'failed', 'canceled');

CREATE TYPE "PlayerRewardPayoutStatus" AS ENUM ('pending', 'submitted', 'confirmed', 'failed');

CREATE TABLE "PlayerRewardPayout" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "amountLamports" BIGINT NOT NULL,
  "status" "PlayerRewardPayoutStatus" NOT NULL DEFAULT 'pending',
  "signature" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),
  CONSTRAINT "PlayerRewardPayout_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerReward" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "matchId" TEXT,
  "playerSessionId" TEXT,
  "kind" "PlayerRewardKind" NOT NULL,
  "status" "PlayerRewardStatus" NOT NULL DEFAULT 'pending',
  "amountLamports" BIGINT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "metadata" JSONB,
  "payoutId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "paidAt" TIMESTAMP(3),
  CONSTRAINT "PlayerReward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerRewardPayout_signature_key" ON "PlayerRewardPayout"("signature");
CREATE INDEX "PlayerRewardPayout_userId_status_createdAt_idx" ON "PlayerRewardPayout"("userId", "status", "createdAt");
CREATE INDEX "PlayerRewardPayout_walletAddress_idx" ON "PlayerRewardPayout"("walletAddress");
CREATE INDEX "PlayerRewardPayout_status_createdAt_idx" ON "PlayerRewardPayout"("status", "createdAt");

CREATE UNIQUE INDEX "PlayerReward_idempotencyKey_key" ON "PlayerReward"("idempotencyKey");
CREATE INDEX "PlayerReward_userId_status_createdAt_idx" ON "PlayerReward"("userId", "status", "createdAt");
CREATE INDEX "PlayerReward_kind_createdAt_idx" ON "PlayerReward"("kind", "createdAt");
CREATE INDEX "PlayerReward_matchId_idx" ON "PlayerReward"("matchId");
CREATE INDEX "PlayerReward_payoutId_idx" ON "PlayerReward"("payoutId");
CREATE INDEX "PlayerReward_status_createdAt_idx" ON "PlayerReward"("status", "createdAt");

ALTER TABLE "PlayerRewardPayout"
  ADD CONSTRAINT "PlayerRewardPayout_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerReward"
  ADD CONSTRAINT "PlayerReward_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerReward"
  ADD CONSTRAINT "PlayerReward_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "GameMatch"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PlayerReward"
  ADD CONSTRAINT "PlayerReward_payoutId_fkey"
  FOREIGN KEY ("payoutId") REFERENCES "PlayerRewardPayout"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
