ALTER TYPE "PlayerRewardKind" ADD VALUE 'daily_mission';

CREATE TYPE "MissionRewardType" AS ENUM ('sol', 'game_token', 'skin');
CREATE TYPE "MissionRewardGrantStatus" AS ENUM ('pending', 'processing', 'granted', 'failed', 'canceled');
CREATE TYPE "GameTokenPayoutStatus" AS ENUM ('pending', 'processing', 'submitted', 'granted', 'failed', 'canceled');

ALTER TABLE "GameMatch"
  ADD COLUMN "gameplayMode" TEXT NOT NULL DEFAULT 'capture_the_flag';

CREATE TABLE "GameMatchKillEvent" (
  "id" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "killerUserId" TEXT,
  "killerPlayerSessionId" TEXT,
  "victimUserId" TEXT,
  "victimPlayerSessionId" TEXT NOT NULL,
  "killerHeroId" TEXT,
  "victimHeroId" TEXT,
  "abilityId" TEXT,
  "damageType" TEXT,
  "victimHadFlag" BOOLEAN NOT NULL DEFAULT false,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "GameMatchKillEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DailyMissionDefinition" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "activeStartsAt" TIMESTAMP(3),
  "activeEndsAt" TIMESTAMP(3),
  "resetPolicy" TEXT NOT NULL DEFAULT 'utc',
  "criteria" JSONB NOT NULL,
  "rewards" JSONB NOT NULL,
  "eligibility" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "updatedByUserId" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "DailyMissionDefinition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserDailyMissionProgress" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "progress" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3),
  "grantedAt" TIMESTAMP(3),
  "lastContributingMatchId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "UserDailyMissionProgress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserDailyMissionContribution" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "matchId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "UserDailyMissionContribution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MissionRewardGrant" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "missionId" TEXT NOT NULL,
  "dayKey" TEXT NOT NULL,
  "rewardType" "MissionRewardType" NOT NULL,
  "amountBaseUnits" BIGINT,
  "skinId" TEXT,
  "status" "MissionRewardGrantStatus" NOT NULL DEFAULT 'pending',
  "idempotencyKey" TEXT NOT NULL,
  "playerRewardId" TEXT,
  "tokenPayoutId" TEXT,
  "metadata" JSONB,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "grantedAt" TIMESTAMP(3),

  CONSTRAINT "MissionRewardGrant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameTokenPayout" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "walletAddress" TEXT,
  "tokenMintAddress" TEXT NOT NULL,
  "tokenSymbol" TEXT NOT NULL,
  "tokenAmountBaseUnits" BIGINT NOT NULL,
  "tokenDecimals" INTEGER,
  "treasuryTokenAccount" TEXT,
  "recipientTokenAccount" TEXT,
  "status" "GameTokenPayoutStatus" NOT NULL DEFAULT 'pending',
  "signature" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "submittedAt" TIMESTAMP(3),
  "grantedAt" TIMESTAMP(3),
  "failedAt" TIMESTAMP(3),

  CONSTRAINT "GameTokenPayout_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GameMatch_gameplayMode_idx" ON "GameMatch"("gameplayMode");
CREATE INDEX "GameMatchKillEvent_matchId_occurredAt_idx" ON "GameMatchKillEvent"("matchId", "occurredAt");
CREATE INDEX "GameMatchKillEvent_killerUserId_occurredAt_idx" ON "GameMatchKillEvent"("killerUserId", "occurredAt");
CREATE INDEX "GameMatchKillEvent_victimUserId_occurredAt_idx" ON "GameMatchKillEvent"("victimUserId", "occurredAt");
CREATE INDEX "GameMatchKillEvent_killerHeroId_occurredAt_idx" ON "GameMatchKillEvent"("killerHeroId", "occurredAt");
CREATE INDEX "GameMatchKillEvent_victimHeroId_occurredAt_idx" ON "GameMatchKillEvent"("victimHeroId", "occurredAt");
CREATE INDEX "GameMatchKillEvent_abilityId_occurredAt_idx" ON "GameMatchKillEvent"("abilityId", "occurredAt");
CREATE INDEX "GameMatchKillEvent_victimHadFlag_occurredAt_idx" ON "GameMatchKillEvent"("victimHadFlag", "occurredAt");

CREATE INDEX "DailyMissionDefinition_enabled_archivedAt_sortOrder_idx" ON "DailyMissionDefinition"("enabled", "archivedAt", "sortOrder");
CREATE INDEX "DailyMissionDefinition_activeStartsAt_activeEndsAt_idx" ON "DailyMissionDefinition"("activeStartsAt", "activeEndsAt");
CREATE INDEX "DailyMissionDefinition_archivedAt_updatedAt_idx" ON "DailyMissionDefinition"("archivedAt", "updatedAt");

CREATE UNIQUE INDEX "UserDailyMissionProgress_userId_missionId_dayKey_key" ON "UserDailyMissionProgress"("userId", "missionId", "dayKey");
CREATE INDEX "UserDailyMissionProgress_userId_dayKey_idx" ON "UserDailyMissionProgress"("userId", "dayKey");
CREATE INDEX "UserDailyMissionProgress_missionId_dayKey_idx" ON "UserDailyMissionProgress"("missionId", "dayKey");
CREATE INDEX "UserDailyMissionProgress_completedAt_idx" ON "UserDailyMissionProgress"("completedAt");
CREATE INDEX "UserDailyMissionProgress_grantedAt_idx" ON "UserDailyMissionProgress"("grantedAt");
CREATE UNIQUE INDEX "UserDailyMissionContribution_userId_missionId_dayKey_matchId_key" ON "UserDailyMissionContribution"("userId", "missionId", "dayKey", "matchId");
CREATE INDEX "UserDailyMissionContribution_matchId_idx" ON "UserDailyMissionContribution"("matchId");
CREATE INDEX "UserDailyMissionContribution_missionId_dayKey_idx" ON "UserDailyMissionContribution"("missionId", "dayKey");

CREATE UNIQUE INDEX "MissionRewardGrant_idempotencyKey_key" ON "MissionRewardGrant"("idempotencyKey");
CREATE UNIQUE INDEX "MissionRewardGrant_tokenPayoutId_key" ON "MissionRewardGrant"("tokenPayoutId");
CREATE INDEX "MissionRewardGrant_userId_dayKey_idx" ON "MissionRewardGrant"("userId", "dayKey");
CREATE INDEX "MissionRewardGrant_missionId_dayKey_idx" ON "MissionRewardGrant"("missionId", "dayKey");
CREATE INDEX "MissionRewardGrant_rewardType_status_idx" ON "MissionRewardGrant"("rewardType", "status");
CREATE INDEX "MissionRewardGrant_status_createdAt_idx" ON "MissionRewardGrant"("status", "createdAt");

CREATE UNIQUE INDEX "GameTokenPayout_signature_key" ON "GameTokenPayout"("signature");
CREATE UNIQUE INDEX "GameTokenPayout_idempotencyKey_key" ON "GameTokenPayout"("idempotencyKey");
CREATE INDEX "GameTokenPayout_userId_status_createdAt_idx" ON "GameTokenPayout"("userId", "status", "createdAt");
CREATE INDEX "GameTokenPayout_status_createdAt_idx" ON "GameTokenPayout"("status", "createdAt");
CREATE INDEX "GameTokenPayout_tokenMintAddress_idx" ON "GameTokenPayout"("tokenMintAddress");

ALTER TABLE "GameMatchKillEvent"
  ADD CONSTRAINT "GameMatchKillEvent_matchId_fkey"
  FOREIGN KEY ("matchId") REFERENCES "GameMatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserDailyMissionProgress"
  ADD CONSTRAINT "UserDailyMissionProgress_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserDailyMissionProgress"
  ADD CONSTRAINT "UserDailyMissionProgress_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "DailyMissionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserDailyMissionContribution"
  ADD CONSTRAINT "UserDailyMissionContribution_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserDailyMissionContribution"
  ADD CONSTRAINT "UserDailyMissionContribution_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "DailyMissionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MissionRewardGrant"
  ADD CONSTRAINT "MissionRewardGrant_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MissionRewardGrant"
  ADD CONSTRAINT "MissionRewardGrant_missionId_fkey"
  FOREIGN KEY ("missionId") REFERENCES "DailyMissionDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MissionRewardGrant"
  ADD CONSTRAINT "MissionRewardGrant_playerRewardId_fkey"
  FOREIGN KEY ("playerRewardId") REFERENCES "PlayerReward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MissionRewardGrant"
  ADD CONSTRAINT "MissionRewardGrant_tokenPayoutId_fkey"
  FOREIGN KEY ("tokenPayoutId") REFERENCES "GameTokenPayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "GameTokenPayout"
  ADD CONSTRAINT "GameTokenPayout_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
