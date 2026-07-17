-- An entitlement held by an active listing must not be deletable underneath
-- the escrow. Terminal listings clear escrowedOwnershipId before normal cleanup.
ALTER TABLE "MarketplaceListing"
DROP CONSTRAINT "MarketplaceListing_escrowedOwnershipId_fkey";

ALTER TABLE "MarketplaceListing"
ADD CONSTRAINT "MarketplaceListing_escrowedOwnershipId_fkey"
FOREIGN KEY ("escrowedOwnershipId") REFERENCES "UserSkinOwnership"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
