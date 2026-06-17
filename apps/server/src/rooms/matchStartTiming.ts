const DEFAULT_MATCH_START_CANCEL_TIMEOUT_MS = 60_000;

function readPositiveIntegerEnvMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const MATCH_CANCEL_DISCONNECT_DELAY_MS = 750;

export const MATCH_START_CANCEL_TIMEOUT_MS = readPositiveIntegerEnvMs(
  'MATCH_START_CANCEL_TIMEOUT_MS',
  readPositiveIntegerEnvMs('MATCH_CONNECT_TIMEOUT_MS', DEFAULT_MATCH_START_CANCEL_TIMEOUT_MS)
);
