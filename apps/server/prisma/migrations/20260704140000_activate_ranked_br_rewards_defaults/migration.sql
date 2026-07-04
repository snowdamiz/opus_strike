ALTER TABLE "PlayerRewardSettings"
  ALTER COLUMN "treasuryReserveLamports" SET DEFAULT 0,
  ALTER COLUMN "rankedBrCombatRewardsEnabled" SET DEFAULT true,
  ALTER COLUMN "rankedBrCombatRewardsShadowMode" SET DEFAULT false,
  ALTER COLUMN "rankedBrTreasuryExposureBps" SET DEFAULT 10000;

UPDATE "PlayerRewardSettings"
SET
  "settingsVersion" = "settingsVersion" + 1,
  "treasuryReserveLamports" = 0,
  "rankedBrCombatRewardsEnabled" = true,
  "rankedBrCombatRewardsShadowMode" = false,
  "rankedBrTreasuryExposureBps" = 10000,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE
  "id" = 'default'
  AND "settingsVersion" = 1
  AND "enabled" = true
  AND "treasuryReserveLamports" = 1000000000
  AND "rankedBrCombatRewardsEnabled" = false
  AND "rankedBrCombatRewardsShadowMode" = true
  AND "rankedBrTreasuryExposureBps" = 10;
