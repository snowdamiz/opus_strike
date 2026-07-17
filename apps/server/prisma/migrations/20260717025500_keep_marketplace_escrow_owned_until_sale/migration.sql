-- The listing FK is the ownership lock. Keep the seller entitlement active so
-- every other grant/purchase path continues to recognize it as already owned;
-- settlement revokes it atomically when the buyer is credited.
UPDATE "UserSkinOwnership" AS ownership
SET "revokedAt" = NULL
FROM "MarketplaceListing" AS listing
WHERE listing."escrowedOwnershipId" = ownership."id"
  AND listing."status" IN ('active', 'pending_sale')
  AND ownership."revokedAt" = listing."escrowedAt";
