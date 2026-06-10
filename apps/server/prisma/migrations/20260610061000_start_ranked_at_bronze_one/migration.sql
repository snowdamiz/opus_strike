-- Launch tuning: ranked progression starts at Bronze 1 with no placement gate.
-- This also normalizes local databases that may have applied an earlier draft.
UPDATE "User"
SET
  "competitiveRating" = 800,
  "rankedGames" = 0,
  "rankedWins" = 0,
  "rankedLosses" = 0,
  "rankedDraws" = 0,
  "rankedPlacementsRemaining" = 0,
  "rankedPeakRating" = 800,
  "rankedLastMatchAt" = NULL;
