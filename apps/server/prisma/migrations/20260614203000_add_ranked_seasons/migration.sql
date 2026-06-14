CREATE TYPE "RankedSeasonMode" AS ENUM ('preseason', 'season');

CREATE TABLE "RankedSeasonSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "mode" "RankedSeasonMode" NOT NULL DEFAULT 'season',
  "seasonNumber" INTEGER NOT NULL DEFAULT 1,
  "endsAt" TIMESTAMP(3),
  "lastResetAt" TIMESTAMP(3),
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RankedSeasonSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "RankedSeasonSettings" ("id", "mode", "seasonNumber", "updatedAt")
VALUES ('default', 'season', 1, CURRENT_TIMESTAMP);
