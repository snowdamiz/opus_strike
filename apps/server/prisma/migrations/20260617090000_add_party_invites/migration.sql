-- CreateEnum
CREATE TYPE "PartyInviteStatus" AS ENUM ('pending', 'accepted', 'declined', 'canceled', 'expired');

-- CreateTable
CREATE TABLE "PartyInvite" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "status" "PartyInviteStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "PartyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartyInvite_toUserId_status_createdAt_idx" ON "PartyInvite"("toUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PartyInvite_fromUserId_createdAt_idx" ON "PartyInvite"("fromUserId", "createdAt");

-- CreateIndex
CREATE INDEX "PartyInvite_partyId_status_idx" ON "PartyInvite"("partyId", "status");

-- CreateIndex
CREATE INDEX "PartyInvite_expiresAt_idx" ON "PartyInvite"("expiresAt");

-- AddForeignKey
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyInvite" ADD CONSTRAINT "PartyInvite_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
