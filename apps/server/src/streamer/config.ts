const DEFAULT_STREAMER_OBSERVER_SEATS = 2;
const BOT_DEATHMATCH_MAP_ROTATION_MS = 5 * 60 * 1000;

export function getStreamerObserverSeatCount(): number {
  const raw = process.env.STREAMER_OBSERVER_SEATS;
  const parsed = raw ? Number(raw) : DEFAULT_STREAMER_OBSERVER_SEATS;
  if (!Number.isFinite(parsed)) return DEFAULT_STREAMER_OBSERVER_SEATS;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}

export function getStreamerBotDeathmatchMapRotationMs(): number {
  return BOT_DEATHMATCH_MAP_ROTATION_MS;
}
