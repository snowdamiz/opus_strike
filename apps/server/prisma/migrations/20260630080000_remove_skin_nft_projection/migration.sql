-- Remove legacy NFT-backed skin projection after the feature was removed.

DROP TABLE IF EXISTS "SkinNftWalletSync";
DROP TABLE IF EXISTS "SkinNftAsset";

DROP INDEX IF EXISTS "SkinPurchaseIntent_nftMintStatus_updatedAt_idx";
DROP INDEX IF EXISTS "SkinPurchaseIntent_nftMintSignature_key";
DROP INDEX IF EXISTS "SkinPurchaseIntent_mintedAssetAddress_key";

ALTER TABLE "SkinPurchaseIntent"
  DROP COLUMN IF EXISTS "nftMintStatus",
  DROP COLUMN IF EXISTS "mintedAssetAddress",
  DROP COLUMN IF EXISTS "nftCollectionAddress",
  DROP COLUMN IF EXISTS "nftMetadataUri",
  DROP COLUMN IF EXISTS "nftMintSignature",
  DROP COLUMN IF EXISTS "nftMintAttemptCount",
  DROP COLUMN IF EXISTS "nftMintAttemptedAt",
  DROP COLUMN IF EXISTS "nftMintError";

ALTER TABLE "SkinShopItemSettings"
  DROP COLUMN IF EXISTS "nftMetadataUriOverride";

ALTER TABLE "SkinShopItemAudit"
  DROP COLUMN IF EXISTS "oldNftMetadataUriOverride",
  DROP COLUMN IF EXISTS "newNftMetadataUriOverride";

DROP TYPE IF EXISTS "NftMintStatus";
