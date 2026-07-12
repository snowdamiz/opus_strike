-- Ranked BR v2 doubles every division from 50 RP to 100 RP while preserving
-- each player's current division and progress within that division.
UPDATE "User"
SET
  "competitiveRating" = GREATEST(0, "competitiveRating" * 2 - 800),
  "rankedPeakRating" = GREATEST(0, "rankedPeakRating" * 2 - 800);

UPDATE "RankedSeasonUserStats"
SET
  "competitiveRating" = GREATEST(0, "competitiveRating" * 2 - 800),
  "rankedPeakRating" = GREATEST(0, "rankedPeakRating" * 2 - 800);
