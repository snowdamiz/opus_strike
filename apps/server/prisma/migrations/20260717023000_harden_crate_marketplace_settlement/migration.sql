-- Snapshot the exact skin pool quoted for every new crate payment. Existing
-- in-flight intents retain [] and are handled as legacy snapshots by the app.
ALTER TABLE "LootboxOpenIntent"
ADD COLUMN "quotedSkinIds" JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Persist blockhash validity alongside deterministic transaction signatures
-- so payout recovery can prove a transaction can no longer land before retrying.
ALTER TABLE "GameTokenPayout"
ADD COLUMN "lastValidBlockHeight" BIGINT,
ADD COLUMN "conversionLastValidBlockHeight" BIGINT;

-- A listing now escrows the exact entitlement row while it is active.
ALTER TABLE "MarketplaceListing"
ADD COLUMN "escrowedOwnershipId" TEXT,
ADD COLUMN "escrowedAt" TIMESTAMP(3);

CREATE INDEX "MarketplaceListing_escrowedOwnershipId_idx"
ON "MarketplaceListing"("escrowedOwnershipId");

ALTER TABLE "MarketplaceListing"
ADD CONSTRAINT "MarketplaceListing_escrowedOwnershipId_fkey"
FOREIGN KEY ("escrowedOwnershipId") REFERENCES "UserSkinOwnership"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

-- Safely escrow valid listings already present at deploy time.
UPDATE "MarketplaceListing" AS listing
SET
  "escrowedOwnershipId" = ownership."id",
  "escrowedAt" = CURRENT_TIMESTAMP
FROM "UserSkinOwnership" AS ownership
WHERE listing."status" IN ('active', 'pending_sale')
  AND listing."sellerUserId" = ownership."userId"
  AND listing."skinId" = ownership."skinId"
  AND ownership."revokedAt" IS NULL;

UPDATE "UserSkinOwnership" AS ownership
SET "revokedAt" = listing."escrowedAt"
FROM "MarketplaceListing" AS listing
WHERE listing."escrowedOwnershipId" = ownership."id"
  AND listing."status" IN ('active', 'pending_sale')
  AND ownership."revokedAt" IS NULL;

-- An invalid unreserved listing cannot be sold safely. Cancel it without
-- deleting either the listing or any audit/history data.
UPDATE "MarketplaceListing"
SET
  "status" = 'canceled',
  "canceledAt" = COALESCE("canceledAt", CURRENT_TIMESTAMP)
WHERE "status" = 'active'
  AND "escrowedOwnershipId" IS NULL;

-- Nullable unique lock for one nonterminal purchase per buyer/skin. Existing
-- duplicates are left unlocked for reconciliation instead of being discarded.
ALTER TABLE "MarketplacePurchaseIntent"
ADD COLUMN "activeBuyerSkinKey" TEXT;

WITH candidates AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "buyerUserId", "skinId"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS position
  FROM "MarketplacePurchaseIntent"
  WHERE "status" IN ('intent_created', 'transaction_built', 'submitted', 'confirmed')
)
UPDATE "MarketplacePurchaseIntent" AS intent
SET "activeBuyerSkinKey" = intent."buyerUserId" || ':' || intent."skinId"
FROM candidates
WHERE intent."id" = candidates."id"
  AND candidates.position = 1;

CREATE UNIQUE INDEX "MarketplacePurchaseIntent_activeBuyerSkinKey_key"
ON "MarketplacePurchaseIntent"("activeBuyerSkinKey");
