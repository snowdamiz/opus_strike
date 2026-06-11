CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted', 'declined', 'canceled');
CREATE TYPE "LobbyInviteStatus" AS ENUM ('pending', 'accepted', 'declined', 'canceled', 'expired');

CREATE TABLE "Friendship" (
  "id" TEXT NOT NULL,
  "userAId" TEXT NOT NULL,
  "userBId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "status" "FriendshipStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),

  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LobbyInvite" (
  "id" TEXT NOT NULL,
  "lobbyId" TEXT NOT NULL,
  "lobbyName" TEXT NOT NULL,
  "matchMode" "MatchMode",
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "status" "LobbyInviteStatus" NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),

  CONSTRAINT "LobbyInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");
CREATE INDEX "Friendship_userAId_status_idx" ON "Friendship"("userAId", "status");
CREATE INDEX "Friendship_userBId_status_idx" ON "Friendship"("userBId", "status");
CREATE INDEX "Friendship_requestedByUserId_status_idx" ON "Friendship"("requestedByUserId", "status");
CREATE INDEX "Friendship_status_updatedAt_idx" ON "Friendship"("status", "updatedAt");

CREATE INDEX "LobbyInvite_toUserId_status_createdAt_idx" ON "LobbyInvite"("toUserId", "status", "createdAt");
CREATE INDEX "LobbyInvite_fromUserId_createdAt_idx" ON "LobbyInvite"("fromUserId", "createdAt");
CREATE INDEX "LobbyInvite_lobbyId_status_idx" ON "LobbyInvite"("lobbyId", "status");
CREATE INDEX "LobbyInvite_expiresAt_idx" ON "LobbyInvite"("expiresAt");

ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_userAId_fkey"
  FOREIGN KEY ("userAId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_userBId_fkey"
  FOREIGN KEY ("userBId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Friendship"
  ADD CONSTRAINT "Friendship_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LobbyInvite"
  ADD CONSTRAINT "LobbyInvite_fromUserId_fkey"
  FOREIGN KEY ("fromUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LobbyInvite"
  ADD CONSTRAINT "LobbyInvite_toUserId_fkey"
  FOREIGN KEY ("toUserId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
