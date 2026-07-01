ALTER TABLE "PlayerRewardSettings"
  DROP COLUMN IF EXISTS "weeklyEnabled",
  DROP COLUMN IF EXISTS "weeklyPoolLamports",
  DROP COLUMN IF EXISTS "weeklyTopPlayers";

DELETE FROM "PlayerReward"
WHERE "kind"::text = 'weekly_leaderboard';

ALTER TYPE "PlayerRewardKind" RENAME TO "PlayerRewardKind_old";

CREATE TYPE "PlayerRewardKind" AS ENUM (
  'daily_ranked_drip',
  'objective_bounty',
  'season_top_10',
  'daily_mission'
);

ALTER TABLE "PlayerReward"
  ALTER COLUMN "kind" TYPE "PlayerRewardKind"
  USING "kind"::text::"PlayerRewardKind";

DROP TYPE "PlayerRewardKind_old";
