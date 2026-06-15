CREATE TABLE "PlayerReport" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "reason" TEXT NOT NULL,
  "details" TEXT,
  "reporterUserId" TEXT NOT NULL,
  "reporterPlayerSessionId" TEXT NOT NULL,
  "reporterName" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "targetPlayerSessionId" TEXT NOT NULL,
  "targetName" TEXT NOT NULL,
  "targetTeam" TEXT,
  "roomId" TEXT NOT NULL,
  "matchId" TEXT,
  "lobbyId" TEXT,
  "matchMode" "MatchMode",
  "mapSeed" INTEGER,
  "serverTick" INTEGER NOT NULL DEFAULT 0,
  "evidenceEventId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "actionType" TEXT,
  "accountActionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlayerReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerReport_status_updatedAt_idx" ON "PlayerReport"("status", "updatedAt");
CREATE INDEX "PlayerReport_targetUserId_createdAt_idx" ON "PlayerReport"("targetUserId", "createdAt");
CREATE INDEX "PlayerReport_reporterUserId_createdAt_idx" ON "PlayerReport"("reporterUserId", "createdAt");
CREATE INDEX "PlayerReport_roomId_createdAt_idx" ON "PlayerReport"("roomId", "createdAt");
CREATE INDEX "PlayerReport_matchId_createdAt_idx" ON "PlayerReport"("matchId", "createdAt");
CREATE INDEX "PlayerReport_resolvedByUserId_resolvedAt_idx" ON "PlayerReport"("resolvedByUserId", "resolvedAt");
