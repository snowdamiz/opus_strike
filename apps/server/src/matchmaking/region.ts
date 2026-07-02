const MATCHMAKING_REGION_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

export function normalizeMatchmakingRegion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return MATCHMAKING_REGION_PATTERN.test(normalized) ? normalized : undefined;
}

export function getLocalMatchmakingRegion(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return normalizeMatchmakingRegion(env.MATCHMAKING_REGION ?? env.FLY_REGION);
}

export function doesMatchmakingRegionMatch(metadataRegion: unknown, requestedRegion: unknown): boolean {
  const normalizedRequest = normalizeMatchmakingRegion(requestedRegion);
  if (!normalizedRequest) return true;
  return normalizeMatchmakingRegion(metadataRegion) === normalizedRequest;
}
