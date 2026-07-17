-- CreateTable
CREATE TABLE "LootboxFreeOpenBalance" (
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "totalGranted" INTEGER NOT NULL DEFAULT 0,
    "lastGrantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LootboxFreeOpenBalance_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "LootboxFreeOpenBalance_balance_idx" ON "LootboxFreeOpenBalance"("balance");

-- AddForeignKey
ALTER TABLE "LootboxFreeOpenBalance" ADD CONSTRAINT "LootboxFreeOpenBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
