-- Skin ownership no longer changes pull rates. These columns only represented
-- the retired owned-skin pool selection step; all player, intent, skin, and
-- payout records remain intact.
ALTER TABLE "LootboxOpenIntent"
DROP COLUMN "quotedDuplicateRewardChanceBps";

ALTER TABLE "LootboxSettings"
DROP COLUMN "duplicateRewardChanceBps";
