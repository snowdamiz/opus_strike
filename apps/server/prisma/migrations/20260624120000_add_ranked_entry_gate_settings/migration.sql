CREATE TYPE "RankedEntryGateMode" AS ENUM ('locked', 'token_required');

CREATE TABLE "RankedEntryGateSettings" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "mode" "RankedEntryGateMode" NOT NULL DEFAULT 'locked',
  "tokenMintAddress" TEXT,
  "tokenSymbol" TEXT NOT NULL DEFAULT 'TOKEN',
  "requiredTokenAmount" TEXT NOT NULL DEFAULT '0',
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "RankedEntryGateSettings_pkey" PRIMARY KEY ("id")
);
