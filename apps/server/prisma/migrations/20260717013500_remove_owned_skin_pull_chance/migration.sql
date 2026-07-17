-- Skin ownership no longer changes pull rates. Preserve the retired values in
-- place for auditability while keeping them out of the active application
-- schema. The intent column receives a default so future inserts can omit it.
ALTER TABLE "LootboxOpenIntent"
RENAME COLUMN "quotedDuplicateRewardChanceBps" TO "archivedQuotedOwnedSkinChanceBps";

ALTER TABLE "LootboxOpenIntent"
ALTER COLUMN "archivedQuotedOwnedSkinChanceBps" SET DEFAULT 0;

COMMENT ON COLUMN "LootboxOpenIntent"."archivedQuotedOwnedSkinChanceBps" IS
'Retired owned-skin pull chance snapshot retained without data loss.';

ALTER TABLE "LootboxSettings"
RENAME COLUMN "duplicateRewardChanceBps" TO "archivedOwnedSkinChanceBps";

COMMENT ON COLUMN "LootboxSettings"."archivedOwnedSkinChanceBps" IS
'Retired owned-skin pull chance setting retained without data loss.';
