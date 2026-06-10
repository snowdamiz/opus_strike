ALTER TABLE "User"
  ADD COLUMN "totalAssists" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalDraws" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalFlagReturns" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalLosses" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalScore" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "GameMatch" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "lobbyId" TEXT,
  "mapSeed" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3) NOT NULL,
  "redScore" INTEGER NOT NULL,
  "blueScore" INTEGER NOT NULL,
  "winningTeam" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GameMatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameMatchParticipant" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "playerSessionId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "team" TEXT NOT NULL,
  "heroId" TEXT,
  "kills" INTEGER NOT NULL DEFAULT 0,
  "deaths" INTEGER NOT NULL DEFAULT 0,
  "assists" INTEGER NOT NULL DEFAULT 0,
  "flagCaptures" INTEGER NOT NULL DEFAULT 0,
  "flagReturns" INTEGER NOT NULL DEFAULT 0,
  "score" INTEGER NOT NULL DEFAULT 0,
  "outcome" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL,
  "leftAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GameMatchParticipant_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameMatch_roomId_idx" ON "GameMatch"("roomId");
CREATE INDEX "GameMatch_lobbyId_idx" ON "GameMatch"("lobbyId");
CREATE INDEX "GameMatch_startedAt_idx" ON "GameMatch"("startedAt");
CREATE INDEX "GameMatch_winningTeam_idx" ON "GameMatch"("winningTeam");

CREATE UNIQUE INDEX "GameMatchParticipant_matchId_userId_key"
  ON "GameMatchParticipant"("matchId", "userId");
CREATE INDEX "GameMatchParticipant_matchId_idx" ON "GameMatchParticipant"("matchId");
CREATE INDEX "GameMatchParticipant_userId_joinedAt_idx"
  ON "GameMatchParticipant"("userId", "joinedAt");
CREATE INDEX "GameMatchParticipant_outcome_idx" ON "GameMatchParticipant"("outcome");

ALTER TABLE "GameMatchParticipant"
  ADD CONSTRAINT "GameMatchParticipant_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "GameMatch"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GameMatchParticipant"
  ADD CONSTRAINT "GameMatchParticipant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
