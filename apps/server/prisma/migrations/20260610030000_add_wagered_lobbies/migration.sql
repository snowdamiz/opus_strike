CREATE TYPE "WageredLobbyStatus" AS ENUM (
  'waiting',
  'locked',
  'in_game',
  'settling',
  'settled',
  'refunding',
  'refunded',
  'failed'
);

CREATE TYPE "WagerPaymentStatus" AS ENUM (
  'intent_created',
  'submitted',
  'confirmed',
  'credited',
  'refunding',
  'refunded',
  'settled',
  'failed',
  'expired'
);

CREATE TYPE "WagerSettlementStatus" AS ENUM (
  'pending',
  'processing',
  'complete',
  'failed'
);

CREATE TYPE "WagerSettlementTransferKind" AS ENUM (
  'winner_payout',
  'developer_fee',
  'refund'
);

CREATE TYPE "WagerSettlementTransferStatus" AS ENUM (
  'pending',
  'submitted',
  'confirmed',
  'failed'
);

CREATE TABLE "WageredLobby" (
  "id" TEXT NOT NULL,
  "lobbyId" TEXT NOT NULL,
  "gameRoomId" TEXT,
  "matchId" TEXT,
  "status" "WageredLobbyStatus" NOT NULL DEFAULT 'waiting',
  "token" TEXT NOT NULL DEFAULT 'SOL',
  "coverChargeLamports" BIGINT NOT NULL,
  "treasuryWallet" TEXT NOT NULL,
  "platformFeeBps" INTEGER NOT NULL DEFAULT 500,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),

  CONSTRAINT "WageredLobby_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WagerPayment" (
  "id" TEXT NOT NULL,
  "wageredLobbyId" TEXT NOT NULL,
  "lobbyPlayerId" TEXT,
  "userId" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "teamAtLock" TEXT,
  "amountLamports" BIGINT NOT NULL,
  "surplusLamports" BIGINT NOT NULL DEFAULT 0,
  "memo" TEXT NOT NULL,
  "intentExpiresAt" TIMESTAMP(3) NOT NULL,
  "status" "WagerPaymentStatus" NOT NULL DEFAULT 'intent_created',
  "depositSignature" TEXT,
  "refundSignature" TEXT,
  "lastError" TEXT,
  "creditedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "settledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "WagerPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WagerSettlement" (
  "id" TEXT NOT NULL,
  "wageredLobbyId" TEXT NOT NULL,
  "matchId" TEXT,
  "winningTeam" TEXT,
  "totalPotLamports" BIGINT NOT NULL DEFAULT 0,
  "developerFeeLamports" BIGINT NOT NULL DEFAULT 0,
  "winnerPoolLamports" BIGINT NOT NULL DEFAULT 0,
  "status" "WagerSettlementStatus" NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "WagerSettlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WagerSettlementTransfer" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "kind" "WagerSettlementTransferKind" NOT NULL,
  "recipientWallet" TEXT NOT NULL,
  "amountLamports" BIGINT NOT NULL,
  "signature" TEXT,
  "status" "WagerSettlementTransferStatus" NOT NULL DEFAULT 'pending',
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedAt" TIMESTAMP(3),

  CONSTRAINT "WagerSettlementTransfer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WageredLobby_lobbyId_key" ON "WageredLobby"("lobbyId");
CREATE INDEX "WageredLobby_lobbyId_idx" ON "WageredLobby"("lobbyId");
CREATE INDEX "WageredLobby_gameRoomId_idx" ON "WageredLobby"("gameRoomId");
CREATE INDEX "WageredLobby_matchId_idx" ON "WageredLobby"("matchId");
CREATE INDEX "WageredLobby_status_idx" ON "WageredLobby"("status");
CREATE INDEX "WageredLobby_createdByUserId_idx" ON "WageredLobby"("createdByUserId");

CREATE UNIQUE INDEX "WagerPayment_memo_key" ON "WagerPayment"("memo");
CREATE UNIQUE INDEX "WagerPayment_depositSignature_key" ON "WagerPayment"("depositSignature");
CREATE UNIQUE INDEX "WagerPayment_refundSignature_key" ON "WagerPayment"("refundSignature");
CREATE UNIQUE INDEX "WagerPayment_wageredLobbyId_userId_key" ON "WagerPayment"("wageredLobbyId", "userId");
CREATE INDEX "WagerPayment_wageredLobbyId_idx" ON "WagerPayment"("wageredLobbyId");
CREATE INDEX "WagerPayment_userId_idx" ON "WagerPayment"("userId");
CREATE INDEX "WagerPayment_walletAddress_idx" ON "WagerPayment"("walletAddress");
CREATE INDEX "WagerPayment_status_idx" ON "WagerPayment"("status");
CREATE INDEX "WagerPayment_intentExpiresAt_idx" ON "WagerPayment"("intentExpiresAt");

CREATE UNIQUE INDEX "WagerSettlement_wageredLobbyId_key" ON "WagerSettlement"("wageredLobbyId");
CREATE INDEX "WagerSettlement_matchId_idx" ON "WagerSettlement"("matchId");
CREATE INDEX "WagerSettlement_status_idx" ON "WagerSettlement"("status");

CREATE UNIQUE INDEX "WagerSettlementTransfer_idempotencyKey_key" ON "WagerSettlementTransfer"("idempotencyKey");
CREATE UNIQUE INDEX "WagerSettlementTransfer_signature_key" ON "WagerSettlementTransfer"("signature");
CREATE UNIQUE INDEX "WagerSettlementTransfer_settlementId_kind_recipientWallet_key"
  ON "WagerSettlementTransfer"("settlementId", "kind", "recipientWallet");
CREATE INDEX "WagerSettlementTransfer_settlementId_idx" ON "WagerSettlementTransfer"("settlementId");
CREATE INDEX "WagerSettlementTransfer_kind_idx" ON "WagerSettlementTransfer"("kind");
CREATE INDEX "WagerSettlementTransfer_status_idx" ON "WagerSettlementTransfer"("status");

ALTER TABLE "WageredLobby"
  ADD CONSTRAINT "WageredLobby_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "WagerPayment"
  ADD CONSTRAINT "WagerPayment_wageredLobbyId_fkey"
  FOREIGN KEY ("wageredLobbyId") REFERENCES "WageredLobby"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WagerPayment"
  ADD CONSTRAINT "WagerPayment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WagerSettlement"
  ADD CONSTRAINT "WagerSettlement_wageredLobbyId_fkey"
  FOREIGN KEY ("wageredLobbyId") REFERENCES "WageredLobby"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WagerSettlementTransfer"
  ADD CONSTRAINT "WagerSettlementTransfer_settlementId_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "WagerSettlement"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
