-- Owned-skin pulls convert to game tokens. Each skin has its own whole-token
-- conversion range, and every paid open snapshots all possible ranges before
-- payment so later admin changes cannot alter its reward.
CREATE TYPE "LootboxRewardKind" AS ENUM ('skin', 'game_token');

ALTER TABLE "LootboxSettings"
ADD COLUMN "duplicateRewardChanceBps" INTEGER NOT NULL DEFAULT 6000;

CREATE TABLE "LootboxDuplicateRewardSetting" (
  "skinId" TEXT NOT NULL,
  "minTokenAmountTokens" TEXT NOT NULL,
  "maxTokenAmountTokens" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LootboxDuplicateRewardSetting_pkey" PRIMARY KEY ("skinId")
);

ALTER TABLE "LootboxOpenIntent"
ADD COLUMN "quotedDuplicateRewardChanceBps" INTEGER,
ADD COLUMN "quotedDuplicateTokenRanges" JSONB,
ADD COLUMN "resultKind" "LootboxRewardKind",
ADD COLUMN "resultTokenAmount" TEXT,
ADD COLUMN "tokenPayoutId" TEXT;

-- Preserve the skin-only contract for every intent created before this
-- feature. New intents copy the live settings in application code.
UPDATE "LootboxOpenIntent"
SET
  "quotedDuplicateRewardChanceBps" = 0,
  "quotedDuplicateTokenRanges" = '{}'::JSONB,
  "resultKind" = CASE
    WHEN "status" = 'credited' AND "resultSkinId" IS NOT NULL THEN 'skin'::"LootboxRewardKind"
    ELSE NULL
  END;

ALTER TABLE "LootboxOpenIntent"
ALTER COLUMN "quotedDuplicateRewardChanceBps" SET NOT NULL,
ALTER COLUMN "quotedDuplicateTokenRanges" SET NOT NULL;

CREATE UNIQUE INDEX "LootboxOpenIntent_tokenPayoutId_key"
ON "LootboxOpenIntent"("tokenPayoutId");

ALTER TABLE "LootboxOpenIntent"
ADD CONSTRAINT "LootboxOpenIntent_tokenPayoutId_fkey"
FOREIGN KEY ("tokenPayoutId") REFERENCES "GameTokenPayout"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
