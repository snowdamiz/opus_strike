ALTER TABLE "GoldenBiomeRewardSettings"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "chanceBps" INTEGER NOT NULL DEFAULT 200,
  ADD COLUMN "winnerRewardLamports" BIGINT NOT NULL DEFAULT 200000000,
  ADD COLUMN "treasuryMinLamports" BIGINT NOT NULL DEFAULT 1000000000;

CREATE TABLE "WagerEconomySettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "platformFeeBps" INTEGER NOT NULL DEFAULT 500,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WagerEconomySettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlayerRewardSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "dailyRankedDripLamports" BIGINT NOT NULL DEFAULT 20000,
  "dailyRankedDripMaxMatches" INTEGER NOT NULL DEFAULT 5,
  "minMatchDurationMs" INTEGER NOT NULL DEFAULT 180000,
  "objectiveWinLamports" BIGINT NOT NULL DEFAULT 10000,
  "objectiveFlagCaptureLamports" BIGINT NOT NULL DEFAULT 15000,
  "objectiveFlagReturnLamports" BIGINT NOT NULL DEFAULT 5000,
  "objectiveAssistLamports" BIGINT NOT NULL DEFAULT 2000,
  "maxPlayerMatchLamports" BIGINT NOT NULL DEFAULT 50000,
  "maxMatchPayoutLamports" BIGINT NOT NULL DEFAULT 250000,
  "treasuryReserveLamports" BIGINT NOT NULL DEFAULT 1000000000,
  "payoutBatchSize" INTEGER NOT NULL DEFAULT 100,
  "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
  "weeklyPoolLamports" BIGINT NOT NULL DEFAULT 1000000,
  "weeklyTopPlayers" INTEGER NOT NULL DEFAULT 10,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlayerRewardSettings_pkey" PRIMARY KEY ("id")
);
