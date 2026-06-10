CREATE TYPE "AuthProvider" AS ENUM ('discord', 'phantom');

ALTER TABLE "User"
  ADD COLUMN "lastLoginAt" TIMESTAMP(3),
  ALTER COLUMN "walletAddress" DROP NOT NULL;

CREATE TABLE "AuthAccount" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "provider" "AuthProvider" NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "displayName" TEXT,
  "avatarUrl" TEXT,
  "emailHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthAccount_provider_providerAccountId_key"
  ON "AuthAccount"("provider", "providerAccountId");

CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

ALTER TABLE "AuthAccount"
  ADD CONSTRAINT "AuthAccount_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "AuthAccount" (
  "id",
  "userId",
  "provider",
  "providerAccountId",
  "displayName",
  "createdAt",
  "updatedAt"
)
SELECT
  'phantom_' || md5("walletAddress"),
  "id",
  'phantom'::"AuthProvider",
  "walletAddress",
  "walletAddress",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User"
WHERE "walletAddress" IS NOT NULL
ON CONFLICT ("provider", "providerAccountId") DO NOTHING;
