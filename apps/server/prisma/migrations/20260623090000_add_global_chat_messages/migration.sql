CREATE TABLE "GlobalChatMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "playerName" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GlobalChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GlobalChatMessage_createdAt_idx" ON "GlobalChatMessage"("createdAt" DESC);
CREATE INDEX "GlobalChatMessage_userId_createdAt_idx" ON "GlobalChatMessage"("userId", "createdAt");
