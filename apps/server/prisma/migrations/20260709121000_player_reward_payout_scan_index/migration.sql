-- Automatic payouts filter and age-order pending rewards by eligible kind.
-- Cover the scan so the background worker does not walk the full reward table.
CREATE INDEX "PlayerReward_status_kind_createdAt_userId_idx"
ON "PlayerReward"("status", "kind", "createdAt", "userId");
