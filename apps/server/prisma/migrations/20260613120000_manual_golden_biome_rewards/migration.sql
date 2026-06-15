CREATE TYPE "GoldenBiomeRewardDistributionMode" AS ENUM ('manual', 'auto');

ALTER TABLE "GameMatch"
  ADD COLUMN "mapThemeId" TEXT NOT NULL DEFAULT 'standard';

ALTER TABLE "GoldenBiomeReward"
  ADD COLUMN "distributionMode" "GoldenBiomeRewardDistributionMode" NOT NULL DEFAULT 'manual',
  ADD COLUMN "distributedByUserId" TEXT,
  ADD COLUMN "distributedAt" TIMESTAMP(3);

CREATE TABLE "GoldenBiomeRewardSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "distributionMode" "GoldenBiomeRewardDistributionMode" NOT NULL DEFAULT 'manual',
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GoldenBiomeRewardSettings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameMatch_mapThemeId_idx" ON "GameMatch"("mapThemeId");
CREATE INDEX "GoldenBiomeReward_distributionMode_idx" ON "GoldenBiomeReward"("distributionMode");

INSERT INTO "GoldenBiomeRewardSettings" ("id", "distributionMode", "updatedAt")
VALUES ('default', 'manual', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
