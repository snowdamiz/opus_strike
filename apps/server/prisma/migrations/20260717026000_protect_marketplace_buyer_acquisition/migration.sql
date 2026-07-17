-- Prevent every entitlement-grant path from activating a skin while that same
-- user/skin pair is reserved by a nonterminal marketplace purchase. Marketplace
-- settlement clears activeBuyerSkinKey inside its serializable transaction
-- immediately before granting the buyer entitlement.
CREATE OR REPLACE FUNCTION "protect_marketplace_buyer_skin_acquisition"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."revokedAt" IS NULL AND EXISTS (
    SELECT 1
    FROM "MarketplacePurchaseIntent" AS intent
    WHERE intent."activeBuyerSkinKey" = NEW."userId" || ':' || NEW."skinId"
  ) THEN
    RAISE EXCEPTION 'skin acquisition is reserved by a marketplace purchase'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "UserSkinOwnership_marketplace_buyer_reservation_guard"
BEFORE INSERT OR UPDATE OF "revokedAt" ON "UserSkinOwnership"
FOR EACH ROW
EXECUTE FUNCTION "protect_marketplace_buyer_skin_acquisition"();
