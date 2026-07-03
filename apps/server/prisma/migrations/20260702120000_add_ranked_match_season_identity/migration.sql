ALTER TABLE "GameMatch"
  ADD COLUMN "rankedSeasonMode" "RankedSeasonMode",
  ADD COLUMN "rankedSeasonNumber" INTEGER;

UPDATE "GameMatch" AS gm
SET
  "rankedSeasonMode" = rs."mode",
  "rankedSeasonNumber" = rs."seasonNumber"
FROM "RankedSeasonSettings" AS rs
WHERE rs."id" = 'default'
  AND gm."matchMode" = 'ranked'
  AND gm."rankedOutcomeStatus" IN ('applied', 'held')
  AND gm."rankedSeasonMode" IS NULL;

CREATE INDEX "GameMatch_rankedSeasonMode_rankedSeasonNumber_idx"
  ON "GameMatch" ("rankedSeasonMode", "rankedSeasonNumber");
