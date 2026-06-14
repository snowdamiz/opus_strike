CREATE TABLE "GlobalNotification" (
  "id" TEXT NOT NULL DEFAULT 'active',
  "message" TEXT NOT NULL,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GlobalNotification_pkey" PRIMARY KEY ("id")
);
