-- Marketplace settings created before launch defaulted to disabled. Enable only
-- untouched rows so an explicit administrator choice to disable remains intact.
ALTER TABLE "MarketplaceSettings"
ALTER COLUMN "enabled" SET DEFAULT true;

UPDATE "MarketplaceSettings"
SET
  "enabled" = true,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "enabled" = false
  AND "updatedByUserId" IS NULL;
