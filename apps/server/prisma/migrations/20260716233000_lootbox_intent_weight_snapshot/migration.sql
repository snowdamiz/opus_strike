-- Snapshot the rarity weights on every lootbox intent so an admin settings
-- change cannot alter the odds after a player has started or paid for an open.
ALTER TABLE "LootboxOpenIntent"
ADD COLUMN "quotedCommonWeightBps" INTEGER,
ADD COLUMN "quotedEpicWeightBps" INTEGER,
ADD COLUMN "quotedUniqueWeightBps" INTEGER,
ADD COLUMN "quotedLegendaryWeightBps" INTEGER;

-- Existing intents predate weight snapshots. Backfill them from the current
-- singleton settings row, falling back to the original launch defaults if the
-- settings row has not been initialized yet.
UPDATE "LootboxOpenIntent"
SET
  "quotedCommonWeightBps" = COALESCE(
    (SELECT "commonWeightBps" FROM "LootboxSettings" WHERE "id" = 'default'),
    0
  ),
  "quotedEpicWeightBps" = COALESCE(
    (SELECT "epicWeightBps" FROM "LootboxSettings" WHERE "id" = 'default'),
    7900
  ),
  "quotedUniqueWeightBps" = COALESCE(
    (SELECT "uniqueWeightBps" FROM "LootboxSettings" WHERE "id" = 'default'),
    1800
  ),
  "quotedLegendaryWeightBps" = COALESCE(
    (SELECT "legendaryWeightBps" FROM "LootboxSettings" WHERE "id" = 'default'),
    300
  );

ALTER TABLE "LootboxOpenIntent"
ALTER COLUMN "quotedCommonWeightBps" SET NOT NULL,
ALTER COLUMN "quotedEpicWeightBps" SET NOT NULL,
ALTER COLUMN "quotedUniqueWeightBps" SET NOT NULL,
ALTER COLUMN "quotedLegendaryWeightBps" SET NOT NULL;
