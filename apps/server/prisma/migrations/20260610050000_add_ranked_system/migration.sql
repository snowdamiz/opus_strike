-- Add durable competitive ranked aggregates. Ranked progression starts fresh
-- at Bronze 1 because past matches did not reliably distinguish Quick Play
-- from custom play.
ALTER TABLE "User"
  ADD COLUMN "competitiveRating" INTEGER NOT NULL DEFAULT 800,
  ADD COLUMN "rankedGames" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rankedWins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rankedLosses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rankedDraws" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rankedPlacementsRemaining" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "rankedPeakRating" INTEGER NOT NULL DEFAULT 800,
  ADD COLUMN "rankedLastMatchAt" TIMESTAMP(3);

ALTER TABLE "GameMatch"
  ADD COLUMN "rankedEligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GameMatchParticipant"
  ADD COLUMN "rankedEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ratingBefore" INTEGER,
  ADD COLUMN "ratingAfter" INTEGER,
  ADD COLUMN "ratingDelta" INTEGER,
  ADD COLUMN "visibleRankBefore" TEXT,
  ADD COLUMN "visibleRankAfter" TEXT,
  ADD COLUMN "leaverPenaltyApplied" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" AS u
SET
  "competitiveRating" = 800,
  "rankedGames" = 0,
  "rankedWins" = 0,
  "rankedLosses" = 0,
  "rankedDraws" = 0,
  "rankedPlacementsRemaining" = 0,
  "rankedPeakRating" = 800,
  "rankedLastMatchAt" = NULL;

CREATE INDEX "User_competitiveRating_rankedWins_rankedGames_createdAt_idx"
  ON "User" ("competitiveRating" DESC, "rankedWins" DESC, "rankedGames" ASC, "createdAt" ASC);

CREATE INDEX "User_ranked_leaderboard_idx"
  ON "User" ("competitiveRating" DESC, "rankedWins" DESC, "rankedGames" ASC, "createdAt" ASC)
  WHERE "rankedGames" > 0;

CREATE INDEX "GameMatch_rankedEligible_idx" ON "GameMatch" ("rankedEligible");
CREATE INDEX "GameMatchParticipant_rankedEligible_idx" ON "GameMatchParticipant" ("rankedEligible");
CREATE INDEX "GameMatchParticipant_userId_rankedEligible_joinedAt_idx"
  ON "GameMatchParticipant" ("userId", "rankedEligible", "joinedAt");
