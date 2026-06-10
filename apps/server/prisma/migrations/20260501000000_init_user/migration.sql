CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "totalGames" INTEGER NOT NULL DEFAULT 0,
  "totalWins" INTEGER NOT NULL DEFAULT 0,
  "totalKills" INTEGER NOT NULL DEFAULT 0,
  "totalDeaths" INTEGER NOT NULL DEFAULT 0,
  "totalCaptures" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");
