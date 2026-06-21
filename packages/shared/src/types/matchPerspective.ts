import type { GameplayMode } from './gameplayMode.js';
import type { PartyMode } from './party.js';

export const MATCH_PERSPECTIVES = ['first_person', 'third_person'] as const;

export type MatchPerspective = typeof MATCH_PERSPECTIVES[number];

export const DEFAULT_MATCH_PERSPECTIVE: MatchPerspective = 'first_person';

export const MATCH_PERSPECTIVE_SETTING_MODES = [
  'quick_play',
  'team_deathmatch',
  'battle_royal',
  'custom',
  'practice',
] as const;

export type MatchPerspectiveSettingMode = typeof MATCH_PERSPECTIVE_SETTING_MODES[number];

export type MatchPerspectiveSettings = Record<MatchPerspectiveSettingMode, MatchPerspective>;

export function isMatchPerspective(value: unknown): value is MatchPerspective {
  return typeof value === 'string' && (MATCH_PERSPECTIVES as readonly string[]).includes(value);
}

export function isMatchPerspectiveSettingMode(value: unknown): value is MatchPerspectiveSettingMode {
  return typeof value === 'string' && (MATCH_PERSPECTIVE_SETTING_MODES as readonly string[]).includes(value);
}

export function createDefaultMatchPerspectiveSettings(): MatchPerspectiveSettings {
  return Object.fromEntries(
    MATCH_PERSPECTIVE_SETTING_MODES.map((mode) => [mode, DEFAULT_MATCH_PERSPECTIVE])
  ) as MatchPerspectiveSettings;
}

export function getMatchPerspectiveSettingMode(
  partyMode: PartyMode,
  gameplayMode: GameplayMode
): MatchPerspectiveSettingMode | null {
  if (partyMode === 'practice') return 'practice';
  if (partyMode === 'custom') return 'custom';
  if (partyMode !== 'quick_play') return null;
  if (gameplayMode === 'team_deathmatch') return 'team_deathmatch';
  if (gameplayMode === 'battle_royal') return 'battle_royal';
  return 'quick_play';
}
