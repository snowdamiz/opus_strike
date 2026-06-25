-- Keep Prisma-managed updatedAt columns free of database defaults.
ALTER TABLE "SkinPurchaseIntent" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "SkinShopItemSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "SkinShopSettings" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "UserHeroLoadout" ALTER COLUMN "updatedAt" DROP DEFAULT;
