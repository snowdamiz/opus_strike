CREATE TABLE "RankedSeasonUserStats" (
  "id" TEXT NOT NULL,
  "mode" "RankedSeasonMode" NOT NULL DEFAULT 'season',
  "seasonNumber" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "userName" TEXT NOT NULL,
  "totalGames" INTEGER NOT NULL DEFAULT 0,
  "totalWins" INTEGER NOT NULL DEFAULT 0,
  "totalLosses" INTEGER NOT NULL DEFAULT 0,
  "totalDraws" INTEGER NOT NULL DEFAULT 0,
  "totalKills" INTEGER NOT NULL DEFAULT 0,
  "totalDeaths" INTEGER NOT NULL DEFAULT 0,
  "totalAssists" INTEGER NOT NULL DEFAULT 0,
  "totalCaptures" INTEGER NOT NULL DEFAULT 0,
  "totalFlagReturns" INTEGER NOT NULL DEFAULT 0,
  "totalScore" INTEGER NOT NULL DEFAULT 0,
  "totalExperience" INTEGER NOT NULL DEFAULT 0,
  "competitiveRating" INTEGER NOT NULL DEFAULT 800,
  "rankedGames" INTEGER NOT NULL DEFAULT 0,
  "rankedWins" INTEGER NOT NULL DEFAULT 0,
  "rankedLosses" INTEGER NOT NULL DEFAULT 0,
  "rankedDraws" INTEGER NOT NULL DEFAULT 0,
  "rankedPlacementsRemaining" INTEGER NOT NULL DEFAULT 0,
  "rankedPeakRating" INTEGER NOT NULL DEFAULT 800,
  "rankedLastMatchAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RankedSeasonUserStats_pkey" PRIMARY KEY ("id")
);

INSERT INTO "RankedSeasonUserStats" (
  "id",
  "mode",
  "seasonNumber",
  "userId",
  "userName",
  "totalGames",
  "totalWins",
  "totalLosses",
  "totalDraws",
  "competitiveRating",
  "rankedGames",
  "rankedWins",
  "rankedLosses",
  "rankedDraws",
  "rankedPlacementsRemaining",
  "rankedPeakRating",
  "rankedLastMatchAt",
  "createdAt",
  "updatedAt"
)
SELECT
  concat('ranked-season:', rs."mode"::text, ':', rs."seasonNumber"::text, ':', u."id"),
  rs."mode",
  rs."seasonNumber",
  u."id",
  u."name",
  u."rankedGames",
  u."rankedWins",
  u."rankedLosses",
  u."rankedDraws",
  u."competitiveRating",
  u."rankedGames",
  u."rankedWins",
  u."rankedLosses",
  u."rankedDraws",
  u."rankedPlacementsRemaining",
  u."rankedPeakRating",
  u."rankedLastMatchAt",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
CROSS JOIN "RankedSeasonSettings" rs
WHERE rs."id" = 'default'
  AND u."rankedGames" > 0;

CREATE UNIQUE INDEX "RankedSeasonUserStats_mode_seasonNumber_userId_key"
  ON "RankedSeasonUserStats" ("mode", "seasonNumber", "userId");

CREATE INDEX "RankedSeasonUserStats_mode_seasonNumber_competitiveRating_r_idx"
  ON "RankedSeasonUserStats" ("mode", "seasonNumber", "competitiveRating" DESC, "rankedWins" DESC, "rankedGames" ASC, "updatedAt" ASC);

CREATE INDEX "RankedSeasonUserStats_userId_mode_seasonNumber_idx"
  ON "RankedSeasonUserStats" ("userId", "mode", "seasonNumber");

ALTER TABLE "RankedSeasonUserStats"
  ADD CONSTRAINT "RankedSeasonUserStats_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
