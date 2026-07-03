-- Golden founder reward: singleton counter for the first 50 ranked BR winners.
CREATE TABLE "RankedFounderReward" (
  "id" TEXT NOT NULL DEFAULT 'ranked_founder_golden',
  "claimedCount" INTEGER NOT NULL DEFAULT 0,
  "maxClaims" INTEGER NOT NULL DEFAULT 50,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RankedFounderReward_pkey" PRIMARY KEY ("id")
);

-- Seed the singleton counter row so the atomic conditional increment has a target.
INSERT INTO "RankedFounderReward" ("id", "claimedCount", "maxClaims", "updatedAt")
VALUES ('ranked_founder_golden', 0, 50, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
