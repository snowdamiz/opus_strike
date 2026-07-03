import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  RANKED_GAMEPLAY_MODE,
  isGameplayMode,
  isMatchPerspective,
  type GameplayMode,
  type MatchMode,
  type MatchPerspective,
} from '@voxel-strike/shared';
import {
  doesMatchmakingRegionMatch,
  normalizeMatchmakingRegion,
} from './region';

export type MatchmakingBotFillMode = 'manual' | 'fill_even';
export const RANKED_BOT_FILL_MODE: MatchmakingBotFillMode = 'fill_even';

export interface MatchmakingSettings {
  matchMode: 'quick_play' | 'ranked';
  gameplayMode: GameplayMode;
  botFillMode: MatchmakingBotFillMode;
  matchPerspective: MatchPerspective;
  matchmakingRegion?: string;
}

export function isMatchmakingBotFillMode(value: unknown): value is MatchmakingBotFillMode {
  return value === 'manual' || value === 'fill_even';
}

export function normalizeMatchmakingBotFillMode(value: unknown): MatchmakingBotFillMode {
  return value === 'fill_even' ? 'fill_even' : 'manual';
}

export function resolveMatchmakingGameplayMode(mode: MatchMode, value: unknown): GameplayMode {
  if (mode === 'ranked') return RANKED_GAMEPLAY_MODE;
  return isGameplayMode(value) ? value : DEFAULT_GAMEPLAY_MODE;
}

export function resolveMatchmakingPerspective(mode: MatchMode, value: unknown): MatchPerspective {
  return mode === 'ranked'
    ? DEFAULT_MATCH_PERSPECTIVE
    : isMatchPerspective(value) ? value : DEFAULT_MATCH_PERSPECTIVE;
}

export function getQueueStatusCacheKey(
  mode: MatchMode,
  gameplayMode: GameplayMode,
  botFillMode: MatchmakingBotFillMode,
  matchPerspective: MatchPerspective,
  matchmakingRegion?: string
): string {
  const regionSuffix = matchmakingRegion ? `:${matchmakingRegion}` : '';
  return mode === 'ranked'
    ? `ranked:${RANKED_GAMEPLAY_MODE}:${RANKED_BOT_FILL_MODE}:${DEFAULT_MATCH_PERSPECTIVE}${regionSuffix}`
    : `quick_play:${gameplayMode}:${botFillMode}:${matchPerspective}${regionSuffix}`;
}

export function createMatchmakingSettings(input: {
  matchMode: MatchMode;
  gameplayMode?: unknown;
  botFillMode?: unknown;
  matchPerspective?: unknown;
  matchmakingRegion?: unknown;
}): MatchmakingSettings {
  const matchMode = input.matchMode === 'ranked' ? 'ranked' : 'quick_play';
  return {
    matchMode,
    gameplayMode: resolveMatchmakingGameplayMode(matchMode, input.gameplayMode),
    botFillMode: matchMode === 'ranked'
      ? RANKED_BOT_FILL_MODE
      : normalizeMatchmakingBotFillMode(input.botFillMode),
    matchPerspective: resolveMatchmakingPerspective(matchMode, input.matchPerspective),
    matchmakingRegion: normalizeMatchmakingRegion(input.matchmakingRegion),
  };
}

export function doesMatchmakingMetadataMatchSettings(
  metadata: Record<string, unknown>,
  settings: MatchmakingSettings
): boolean {
  const roomMode = metadata.matchMode === 'ranked' ? 'ranked' : 'quick_play';
  if (roomMode !== settings.matchMode) return false;
  if (!doesMatchmakingRegionMatch(metadata.matchmakingRegion, settings.matchmakingRegion)) return false;

  if (settings.matchMode === 'ranked') {
    return metadata.gameplayMode === RANKED_GAMEPLAY_MODE
      && normalizeMatchmakingBotFillMode(metadata.botFillMode) === RANKED_BOT_FILL_MODE
      && resolveMatchmakingPerspective('ranked', metadata.matchPerspective) === DEFAULT_MATCH_PERSPECTIVE;
  }

  return metadata.gameplayMode === settings.gameplayMode
    && normalizeMatchmakingBotFillMode(metadata.botFillMode) === settings.botFillMode
    && resolveMatchmakingPerspective('quick_play', metadata.matchPerspective) === settings.matchPerspective;
}
