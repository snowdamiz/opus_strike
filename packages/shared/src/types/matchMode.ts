export const MATCH_MODES = ['quick_play', 'ranked', 'custom', 'custom_wager'] as const;

export type MatchMode = typeof MATCH_MODES[number];

export function isMatchMode(value: unknown): value is MatchMode {
  return typeof value === 'string' && (MATCH_MODES as readonly string[]).includes(value);
}

export function isMatchmakingMode(value: MatchMode): boolean {
  return value === 'quick_play' || value === 'ranked';
}
