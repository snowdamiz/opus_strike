ALTER TABLE "GameMatchParticipant"
  ADD COLUMN "placement" INTEGER,
  ADD COLUMN "rankedPlacementPoints" INTEGER,
  ADD COLUMN "rankedCombatPoints" INTEGER,
  ADD COLUMN "rankedEntryCost" INTEGER,
  ADD COLUMN "rankedQualityMultiplier" DOUBLE PRECISION,
  ADD COLUMN "rankedRulesVersion" TEXT,
  ADD COLUMN "rankedBreakdown" JSONB;
