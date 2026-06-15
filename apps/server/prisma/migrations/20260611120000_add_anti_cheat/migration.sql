ALTER TYPE "WageredLobbyStatus" ADD VALUE IF NOT EXISTS 'review_required';

ALTER TABLE "GameMatch"
  ADD COLUMN "antiCheatIntegrityStatus" TEXT NOT NULL DEFAULT 'clean',
  ADD COLUMN "antiCheatReviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "antiCheatIntegrityReason" TEXT,
  ADD COLUMN "rankedOutcomeStatus" TEXT NOT NULL DEFAULT 'not_applicable';

CREATE INDEX "GameMatch_antiCheatIntegrityStatus_idx" ON "GameMatch"("antiCheatIntegrityStatus");
CREATE INDEX "GameMatch_antiCheatReviewRequired_idx" ON "GameMatch"("antiCheatReviewRequired");
CREATE INDEX "GameMatch_rankedOutcomeStatus_idx" ON "GameMatch"("rankedOutcomeStatus");

CREATE TABLE "AntiCheatSignal" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "matchId" TEXT,
  "lobbyId" TEXT,
  "matchMode" "MatchMode",
  "userId" TEXT,
  "playerSessionId" TEXT,
  "team" TEXT,
  "heroId" TEXT,
  "serverTick" INTEGER NOT NULL,
  "serverTime" BIGINT NOT NULL,
  "movementEpoch" INTEGER,
  "movementSequence" INTEGER,
  "severity" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "reason" TEXT,
  "details" JSONB NOT NULL,
  "detailBytes" INTEGER NOT NULL,
  "retentionClass" TEXT NOT NULL,
  "scoreDelta" INTEGER NOT NULL DEFAULT 0,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AntiCheatSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AntiCheatSignal_eventId_key" ON "AntiCheatSignal"("eventId");
CREATE INDEX "AntiCheatSignal_eventType_observedAt_idx" ON "AntiCheatSignal"("eventType", "observedAt");
CREATE INDEX "AntiCheatSignal_category_severity_observedAt_idx" ON "AntiCheatSignal"("category", "severity", "observedAt");
CREATE INDEX "AntiCheatSignal_roomId_observedAt_idx" ON "AntiCheatSignal"("roomId", "observedAt");
CREATE INDEX "AntiCheatSignal_matchId_observedAt_idx" ON "AntiCheatSignal"("matchId", "observedAt");
CREATE INDEX "AntiCheatSignal_lobbyId_observedAt_idx" ON "AntiCheatSignal"("lobbyId", "observedAt");
CREATE INDEX "AntiCheatSignal_userId_observedAt_idx" ON "AntiCheatSignal"("userId", "observedAt");
CREATE INDEX "AntiCheatSignal_playerSessionId_observedAt_idx" ON "AntiCheatSignal"("playerSessionId", "observedAt");
CREATE INDEX "AntiCheatSignal_retentionClass_observedAt_idx" ON "AntiCheatSignal"("retentionClass", "observedAt");

CREATE TABLE "AntiCheatPlayerProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "currentScore" INTEGER NOT NULL DEFAULT 0,
  "maxScore" INTEGER NOT NULL DEFAULT 0,
  "scoreBand" TEXT NOT NULL DEFAULT 'normal_noise',
  "reviewFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "lastSignalAt" TIMESTAMP(3),
  "lastScoredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AntiCheatPlayerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AntiCheatPlayerProfile_userId_key" ON "AntiCheatPlayerProfile"("userId");
CREATE INDEX "AntiCheatPlayerProfile_currentScore_idx" ON "AntiCheatPlayerProfile"("currentScore");
CREATE INDEX "AntiCheatPlayerProfile_scoreBand_idx" ON "AntiCheatPlayerProfile"("scoreBand");
CREATE INDEX "AntiCheatPlayerProfile_lastSignalAt_idx" ON "AntiCheatPlayerProfile"("lastSignalAt");

CREATE TABLE "AntiCheatMatchIntegrity" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "lobbyId" TEXT,
  "matchMode" "MatchMode" NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'clean',
  "reason" TEXT,
  "score" INTEGER NOT NULL DEFAULT 0,
  "affectedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "affectedTeams" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "rankedImpact" TEXT NOT NULL DEFAULT 'none',
  "wagerImpact" TEXT NOT NULL DEFAULT 'none',
  "caseId" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AntiCheatMatchIntegrity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AntiCheatMatchIntegrity_matchId_key" ON "AntiCheatMatchIntegrity"("matchId");
CREATE INDEX "AntiCheatMatchIntegrity_roomId_idx" ON "AntiCheatMatchIntegrity"("roomId");
CREATE INDEX "AntiCheatMatchIntegrity_lobbyId_idx" ON "AntiCheatMatchIntegrity"("lobbyId");
CREATE INDEX "AntiCheatMatchIntegrity_matchMode_status_idx" ON "AntiCheatMatchIntegrity"("matchMode", "status");
CREATE INDEX "AntiCheatMatchIntegrity_caseId_idx" ON "AntiCheatMatchIntegrity"("caseId");

CREATE TABLE "AntiCheatPayoutHold" (
  "id" TEXT NOT NULL,
  "wageredLobbyId" TEXT NOT NULL,
  "matchId" TEXT,
  "winningTeam" TEXT,
  "paymentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "affectedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "amountLamports" BIGINT NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "caseId" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AntiCheatPayoutHold_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AntiCheatPayoutHold_wageredLobbyId_key" ON "AntiCheatPayoutHold"("wageredLobbyId");
CREATE INDEX "AntiCheatPayoutHold_matchId_idx" ON "AntiCheatPayoutHold"("matchId");
CREATE INDEX "AntiCheatPayoutHold_status_createdAt_idx" ON "AntiCheatPayoutHold"("status", "createdAt");
CREATE INDEX "AntiCheatPayoutHold_caseId_idx" ON "AntiCheatPayoutHold"("caseId");

CREATE TABLE "AntiCheatAction" (
  "id" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "roomId" TEXT,
  "matchId" TEXT,
  "caseId" TEXT,
  "userId" TEXT,
  "actorUserId" TEXT,
  "reason" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "observedOnly" BOOLEAN NOT NULL DEFAULT false,
  "evidenceEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "reversedByActionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AntiCheatAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AntiCheatAction_actionType_createdAt_idx" ON "AntiCheatAction"("actionType", "createdAt");
CREATE INDEX "AntiCheatAction_matchId_createdAt_idx" ON "AntiCheatAction"("matchId", "createdAt");
CREATE INDEX "AntiCheatAction_caseId_createdAt_idx" ON "AntiCheatAction"("caseId", "createdAt");
CREATE INDEX "AntiCheatAction_userId_createdAt_idx" ON "AntiCheatAction"("userId", "createdAt");
CREATE INDEX "AntiCheatAction_actorUserId_createdAt_idx" ON "AntiCheatAction"("actorUserId", "createdAt");

CREATE TABLE "AntiCheatAccountAction" (
  "id" TEXT NOT NULL,
  "actionType" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceCaseId" TEXT,
  "evidenceEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expiresAt" TIMESTAMP(3),
  "liftedAt" TIMESTAMP(3),
  "immutableAudit" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AntiCheatAccountAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AntiCheatAccountAction_targetUserId_createdAt_idx" ON "AntiCheatAccountAction"("targetUserId", "createdAt");
CREATE INDEX "AntiCheatAccountAction_actorUserId_createdAt_idx" ON "AntiCheatAccountAction"("actorUserId", "createdAt");
CREATE INDEX "AntiCheatAccountAction_actionType_createdAt_idx" ON "AntiCheatAccountAction"("actionType", "createdAt");
CREATE INDEX "AntiCheatAccountAction_evidenceCaseId_idx" ON "AntiCheatAccountAction"("evidenceCaseId");
CREATE INDEX "AntiCheatAccountAction_expiresAt_idx" ON "AntiCheatAccountAction"("expiresAt");

CREATE TABLE "AntiCheatCase" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "playerSessionId" TEXT,
  "matchId" TEXT,
  "roomId" TEXT,
  "lobbyId" TEXT,
  "matchMode" "MatchMode",
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "reason" TEXT NOT NULL,
  "scoreAtOpen" INTEGER NOT NULL DEFAULT 0,
  "signalCount" INTEGER NOT NULL DEFAULT 0,
  "evidenceEventIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "assignedToUserId" TEXT,
  "notes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "resolution" TEXT,
  "falsePositive" BOOLEAN NOT NULL DEFAULT false,
  "appealMarker" TEXT,
  "resolvedByUserId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AntiCheatCase_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AntiCheatCase_status_priority_updatedAt_idx" ON "AntiCheatCase"("status", "priority", "updatedAt");
CREATE INDEX "AntiCheatCase_userId_updatedAt_idx" ON "AntiCheatCase"("userId", "updatedAt");
CREATE INDEX "AntiCheatCase_matchId_updatedAt_idx" ON "AntiCheatCase"("matchId", "updatedAt");
CREATE INDEX "AntiCheatCase_roomId_updatedAt_idx" ON "AntiCheatCase"("roomId", "updatedAt");
CREATE INDEX "AntiCheatCase_matchMode_updatedAt_idx" ON "AntiCheatCase"("matchMode", "updatedAt");
CREATE INDEX "AntiCheatCase_falsePositive_updatedAt_idx" ON "AntiCheatCase"("falsePositive", "updatedAt");
