import {
  CUSTOM_LOBBY_GAMEPLAY_MODES,
  GAMEPLAY_MODES,
  createDefaultMatchPerspectiveSettings,
  createDefaultPartyBotFillSettings,
  isCustomLobbyGameplayMode,
  type CustomLobbyGameplayMode,
  type GameplayMode,
  type MatchPerspectiveSettings,
  type PartyBotFillSettings,
  type PartyMode,
} from '@voxel-strike/shared';

export type PlayMenuMode = PartyMode | 'team_deathmatch' | 'battle_royal';

export interface PlayMenuPreferences {
  selectedPlayMode: PlayMenuMode;
  customGameplayMode: CustomLobbyGameplayMode;
  botFillEnabledByMode: PartyBotFillSettings;
  perspectiveByMode: MatchPerspectiveSettings;
}

export const DEFAULT_CUSTOM_GAMEPLAY_MODE: CustomLobbyGameplayMode = CUSTOM_LOBBY_GAMEPLAY_MODES[0];
export const PLAY_MODE_OPTIONS: PlayMenuMode[] = [
  'ranked',
  'quick_play',
  'team_deathmatch',
  'battle_royal',
  'practice',
  'custom',
];
export const PLAY_MENU_PREFERENCES_STORAGE_KEY = 'voxel_strike_play_menu_preferences:v1';

export function isPlayMenuMode(value: unknown): value is PlayMenuMode {
  return typeof value === 'string' && (PLAY_MODE_OPTIONS as readonly string[]).includes(value);
}

export function createGlobalBotFillSettings(enabled: boolean): PartyBotFillSettings {
  const next = createDefaultPartyBotFillSettings();
  for (const mode of GAMEPLAY_MODES) {
    next[mode] = enabled;
  }
  return next;
}

export function isGlobalBotFillEnabled(settings: PartyBotFillSettings): boolean {
  return GAMEPLAY_MODES.some((mode) => settings[mode] === true);
}

export function sanitizeBotFillSettings(value: unknown): PartyBotFillSettings {
  if (!value || typeof value !== 'object') return createGlobalBotFillSettings(false);

  const raw = value as Partial<Record<GameplayMode, unknown>>;
  return createGlobalBotFillSettings(GAMEPLAY_MODES.some((mode) => raw[mode] === true));
}

export function sanitizeCustomGameplayMode(value: unknown): CustomLobbyGameplayMode {
  return isCustomLobbyGameplayMode(value) ? value : DEFAULT_CUSTOM_GAMEPLAY_MODE;
}

export function sanitizeMatchPerspectiveSettings(_value: unknown): MatchPerspectiveSettings {
  // Third-person selection is temporarily unavailable in the play menu.
  return createDefaultMatchPerspectiveSettings();
}

export function createDefaultPlayMenuPreferences(): PlayMenuPreferences {
  return {
    selectedPlayMode: 'quick_play',
    customGameplayMode: DEFAULT_CUSTOM_GAMEPLAY_MODE,
    botFillEnabledByMode: createGlobalBotFillSettings(false),
    perspectiveByMode: createDefaultMatchPerspectiveSettings(),
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
  const customGameplayMode = sanitizeCustomGameplayMode(raw.customGameplayMode);
  const botFillEnabledByMode = sanitizeBotFillSettings(raw.botFillEnabledByMode);
  const perspectiveByMode = sanitizeMatchPerspectiveSettings(raw.perspectiveByMode);

  return {
    selectedPlayMode,
    customGameplayMode,
    botFillEnabledByMode,
    perspectiveByMode,
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
