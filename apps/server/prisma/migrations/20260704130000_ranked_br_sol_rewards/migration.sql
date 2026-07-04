ALTER TYPE "PlayerRewardKind" ADD VALUE 'ranked_br_combat_bounty';

ALTER TABLE "PlayerRewardSettings"
  ADD COLUMN "settingsVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "rankedBrCombatRewardsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rankedBrCombatRewardsShadowMode" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "rankedBrDamageLamportsPerHp" BIGINT NOT NULL DEFAULT 250,
  ADD COLUMN "rankedBrKillLamports" BIGINT NOT NULL DEFAULT 100000,
  ADD COLUMN "rankedBrBotTargetRewardBps" INTEGER NOT NULL DEFAULT 7000,
  ADD COLUMN "rankedBrSourceVictimDamageCapHp" INTEGER NOT NULL DEFAULT 315,
  ADD COLUMN "rankedBrMaxPlayerMatchLamports" BIGINT NOT NULL DEFAULT 750000,
  ADD COLUMN "rankedBrMaxPlayerDailyLamports" BIGINT NOT NULL DEFAULT 2500000,
  ADD COLUMN "rankedBrMaxMatchLamports" BIGINT NOT NULL DEFAULT 5000000,
  ADD COLUMN "rankedBrTreasuryExposureBps" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "rankedBrClientRewardTextMinLamports" BIGINT NOT NULL DEFAULT 1000,
  ADD COLUMN "minPayoutUsdCents" INTEGER NOT NULL DEFAULT 1500,
  ADD COLUMN "payoutPriceQuoteTtlMs" INTEGER NOT NULL DEFAULT 300000;

ALTER TABLE "PlayerRewardPayout"
  ADD COLUMN "priceSource" TEXT,
  ADD COLUMN "solUsdPriceMicroUsd" BIGINT,
  ADD COLUMN "priceObservedAt" TIMESTAMP(3);
