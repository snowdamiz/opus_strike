-- Raw game-token drops are a separate crate outcome with their own chance and
-- lower-biased amount range. Existing intents retain their original skin-only
-- versus duplicate-only contract by snapshotting a zero direct-drop chance.
ALTER TABLE "LootboxSettings"
ADD COLUMN "directTokenRewardChanceBps" INTEGER NOT NULL DEFAULT 6000,
ADD COLUMN "directTokenRewardMinTokens" TEXT NOT NULL DEFAULT '5000',
ADD COLUMN "directTokenRewardMaxTokens" TEXT NOT NULL DEFAULT '75000';

ALTER TABLE "LootboxOpenIntent"
ADD COLUMN "quotedDirectTokenRewardChanceBps" INTEGER,
ADD COLUMN "quotedDirectTokenRewardMinTokens" TEXT,
ADD COLUMN "quotedDirectTokenRewardMaxTokens" TEXT;

UPDATE "LootboxOpenIntent"
SET
  "quotedDirectTokenRewardChanceBps" = 0,
  "quotedDirectTokenRewardMinTokens" = '5000',
  "quotedDirectTokenRewardMaxTokens" = '75000';

ALTER TABLE "LootboxOpenIntent"
ALTER COLUMN "quotedDirectTokenRewardChanceBps" SET NOT NULL,
ALTER COLUMN "quotedDirectTokenRewardMinTokens" SET NOT NULL,
ALTER COLUMN "quotedDirectTokenRewardMaxTokens" SET NOT NULL;
