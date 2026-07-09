-- Expiry sweeps filter by pending status before the timestamp range. Keep that
-- access path bounded as historical accepted/expired invitations accumulate.
CREATE INDEX "LobbyInvite_status_expiresAt_idx" ON "LobbyInvite"("status", "expiresAt");
CREATE INDEX "PartyInvite_status_expiresAt_idx" ON "PartyInvite"("status", "expiresAt");
