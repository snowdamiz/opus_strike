const DEFAULT_STREAMER_OBSERVER_SEATS = 2;

export function getStreamerObserverSeatCount(): number {
  const raw = process.env.STREAMER_OBSERVER_SEATS;
  const parsed = raw ? Number(raw) : DEFAULT_STREAMER_OBSERVER_SEATS;
  if (!Number.isFinite(parsed)) return DEFAULT_STREAMER_OBSERVER_SEATS;
  return Math.max(1, Math.min(8, Math.floor(parsed)));
}
