-- CreateTable
CREATE TABLE "PersistentParty" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "leaderUserId" TEXT,
    "allowedUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "snapshot" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersistentParty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersistentParty_roomId_key" ON "PersistentParty"("roomId");

-- CreateIndex
CREATE INDEX "PersistentParty_ownerUserId_updatedAt_idx" ON "PersistentParty"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "PersistentParty_expiresAt_idx" ON "PersistentParty"("expiresAt");

-- CreateIndex
CREATE INDEX "PersistentParty_allowedUserIds_idx" ON "PersistentParty" USING GIN ("allowedUserIds");
