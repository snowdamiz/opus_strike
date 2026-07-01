/*
  Warnings:

  - The values [nft] on the enum `SkinEntitlementSource` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SkinEntitlementSource_new" AS ENUM ('free', 'paid', 'admin_grant', 'event');
ALTER TABLE "UserSkinOwnership" ALTER COLUMN "source" TYPE "SkinEntitlementSource_new" USING ("source"::text::"SkinEntitlementSource_new");
ALTER TYPE "SkinEntitlementSource" RENAME TO "SkinEntitlementSource_old";
ALTER TYPE "SkinEntitlementSource_new" RENAME TO "SkinEntitlementSource";
DROP TYPE "SkinEntitlementSource_old";
COMMIT;

-- RenameIndex
ALTER INDEX "UserDailyMissionContribution_userId_missionId_dayKey_matchId_ke" RENAME TO "UserDailyMissionContribution_userId_missionId_dayKey_matchI_key";
