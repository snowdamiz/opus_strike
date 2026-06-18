import {
  GAMEPLAY_MODES,
  createDefaultPartyBotFillSettings,
  type GameplayMode,
  type PartyBotFillSettings,
  type PartyMode,
} from '@voxel-strike/shared';

export type PlayMenuMode = Exclude<PartyMode, 'custom'> | 'team_deathmatch' | 'battle_royal';

export interface PlayMenuPreferences {
  selectedPlayMode: PlayMenuMode;
  botFillEnabledByMode: PartyBotFillSettings;
}

export const PLAY_MODE_OPTIONS: PlayMenuMode[] = ['ranked', 'quick_play', 'team_deathmatch', 'battle_royal', 'practice'];
export const PLAY_MENU_PREFERENCES_STORAGE_KEY = 'voxel_strike_play_menu_preferences:v1';

export function isPlayMenuMode(value: unknown): value is PlayMenuMode {
  return typeof value === 'string' && (PLAY_MODE_OPTIONS as readonly string[]).includes(value);
}

export function sanitizeBotFillSettings(value: unknown): PartyBotFillSettings {
  const next = createDefaultPartyBotFillSettings();
  if (!value || typeof value !== 'object') return next;

  const raw = value as Partial<Record<GameplayMode, unknown>>;
  for (const mode of GAMEPLAY_MODES) {
    next[mode] = raw[mode] === true;
  }
  return next;
}

export function createDefaultPlayMenuPreferences(): PlayMenuPreferences {
  return {
    selectedPlayMode: 'quick_play',
    botFillEnabledByMode: createDefaultPartyBotFillSettings(),
  };
}

export function sanitizePlayMenuPreferences(value: unknown): PlayMenuPreferences {
  const defaults = createDefaultPlayMenuPreferences();
  const raw = value && typeof value === 'object'
    ? value as Partial<PlayMenuPreferences>
    : {};
  const selectedPlayMode = isPlayMenuMode(raw.selectedPlayMode)
    ? raw.selectedPlayMode
    : defaults.selectedPlayMode;
  const botFillEnabledByMode = sanitizeBotFillSettings(raw.botFillEnabledByMode);

  return {
    selectedPlayMode,
    botFillEnabledByMode,
  };
}

export function loadPlayMenuPreferences(): PlayMenuPreferences {
  if (typeof window === 'undefined') return createDefaultPlayMenuPreferences();

  try {
    const saved = window.localStorage.getItem(PLAY_MENU_PREFERENCES_STORAGE_KEY);
    return saved ? sanitizePlayMenuPreferences(JSON.parse(saved)) : createDefaultPlayMenuPreferences();
  } catch {
    return createDefaultPlayMenuPreferences();
  }
}

export function savePlayMenuPreferences(input: PlayMenuPreferences): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(
      PLAY_MENU_PREFERENCES_STORAGE_KEY,
      JSON.stringify(sanitizePlayMenuPreferences(input))
    );
  } catch {
    // Storage can be disabled or quota-limited; the in-memory UI state still works.
  }
}
