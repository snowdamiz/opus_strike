import { create } from 'zustand';
import { DEFAULT_KEYBINDINGS, type InputState } from '@voxel-strike/shared';
import { loggers } from '../utils/logger';

export type GraphicsQuality = 'minimum' | 'low' | 'medium' | 'high' | 'ultra';
export type GraphicsFeatureQuality = 'off' | GraphicsQuality;
export type CrosshairStyle = 'default' | 'dot' | 'circle' | 'cross';
export type GraphicsPreset = 'potato' | 'competitive' | 'balanced' | 'cinematic';
export type FpsDisplayMode = 'off' | 'fps';
export type DevTutorialOverride = 'account' | 'bypass' | 'force';
export type StreamerFeedMode = 'random' | 'bot_deathmatch';
export type KeybindAction = keyof InputState | 'scoreboard' | 'pushToTalk';
export type Keybindings = Record<KeybindAction, string>;

export const keybindActionKeys = [
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'jump',
  'crouch',
  'sprint',
  'primaryFire',
  'secondaryFire',
  'reload',
  'ability1',
  'ability2',
  'ultimate',
  'interact',
  'scoreboard',
  'pushToTalk',
] as const satisfies readonly KeybindAction[];

export const defaultKeybindings: Keybindings = {
  ...DEFAULT_KEYBINDINGS,
  scoreboard: 'Tab',
  pushToTalk: 'KeyV',
};

export interface ClientSettings {
  graphicsPreset: GraphicsPreset;
  resolutionScale: GraphicsQuality;
  antialiasing: boolean;
  shadowQuality: GraphicsFeatureQuality;
  reflectionQuality: GraphicsFeatureQuality;
  environmentQuality: GraphicsFeatureQuality;
  materialQuality: GraphicsFeatureQuality;
  adaptiveQuality: boolean;
  fov: number;
  showFPS: FpsDisplayMode;
  showHUD: boolean;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  voiceEnabled: boolean;
  voiceVolume: number;
  micVolume: number;
  voiceInputDeviceId: string;
  voiceOutputDeviceId: string;
  noiseSuppressionEnabled: boolean;
  echoCancellationEnabled: boolean;
  autoGainControlEnabled: boolean;
  voiceActivationThreshold: number;
  sensitivity: number;
  invertY: boolean;
  toggleCrouch: boolean;
  toggleSprint: boolean;
  showDamageNumbers: boolean;
  showKillFeed: boolean;
  streamerModeEnabled: boolean;
  streamerFeedMode: StreamerFeedMode;
  crosshairStyle: CrosshairStyle;
  crosshairColor: string;
  devTutorialOverride: DevTutorialOverride;
  keybindings: Keybindings;
}

export const SETTINGS_STORAGE_KEY = 'voxel-strike-settings';

export const graphicsPresetSettings: Record<GraphicsPreset, Pick<
  ClientSettings,
  | 'resolutionScale'
  | 'antialiasing'
  | 'shadowQuality'
  | 'reflectionQuality'
  | 'environmentQuality'
  | 'materialQuality'
  | 'adaptiveQuality'
>> = {
  potato: {
    resolutionScale: 'minimum',
    antialiasing: false,
    shadowQuality: 'off',
    reflectionQuality: 'off',
    environmentQuality: 'off',
    materialQuality: 'off',
    adaptiveQuality: true,
  },
  competitive: {
    resolutionScale: 'low',
    antialiasing: false,
    shadowQuality: 'off',
    reflectionQuality: 'off',
    environmentQuality: 'low',
    materialQuality: 'low',
    adaptiveQuality: true,
  },
  balanced: {
    resolutionScale: 'medium',
    antialiasing: true,
    shadowQuality: 'medium',
    reflectionQuality: 'medium',
    environmentQuality: 'medium',
    materialQuality: 'medium',
    adaptiveQuality: true,
  },
  cinematic: {
    resolutionScale: 'high',
    antialiasing: true,
    shadowQuality: 'high',
    reflectionQuality: 'high',
    environmentQuality: 'high',
    materialQuality: 'high',
    adaptiveQuality: false,
  },
};

export const defaultSettings: ClientSettings = {
  graphicsPreset: 'balanced',
  ...graphicsPresetSettings.balanced,
  fov: 90,
  showFPS: 'off',
  showHUD: true,
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 50,
  voiceEnabled: true,
  voiceVolume: 90,
  micVolume: 100,
  voiceInputDeviceId: '',
  voiceOutputDeviceId: '',
  noiseSuppressionEnabled: true,
  echoCancellationEnabled: true,
  autoGainControlEnabled: true,
  voiceActivationThreshold: 0.08,
  sensitivity: 50,
  invertY: false,
  toggleCrouch: false,
  toggleSprint: false,
  showDamageNumbers: true,
  showKillFeed: true,
  streamerModeEnabled: false,
  streamerFeedMode: 'random',
  crosshairStyle: 'default',
  crosshairColor: '#ffffff',
  devTutorialOverride: 'account',
  keybindings: { ...defaultKeybindings },
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

function pickOption<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function pickDeviceId(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed.length <= 256 ? trimmed : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickFpsDisplayMode(value: unknown, fallback: FpsDisplayMode): FpsDisplayMode {
  if (value === true || value === 'full') return 'fps';
  if (value === false) return 'off';
  return pickOption(value, ['off', 'fps'] as const, fallback);
}

function pickKeybindingCode(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;

  const code = value.trim();
  return code.length > 0 && code.length <= 64 ? code : fallback;
}

function sanitizeKeybindings(value: unknown, legacyPushToTalkKey?: unknown): Keybindings {
  const raw = typeof value === 'object' && value !== null
    ? value as Partial<Record<KeybindAction, unknown>>
    : {};
  const next = { ...defaultKeybindings };
  const usedCodes = new Set<string>();

  for (const action of keybindActionKeys) {
    const rawCode = action === 'pushToTalk' && raw[action] === undefined
      ? legacyPushToTalkKey
      : raw[action];
    const preferredCode = pickKeybindingCode(rawCode, defaultKeybindings[action]);

    if (!usedCodes.has(preferredCode)) {
      next[action] = preferredCode;
      usedCodes.add(preferredCode);
      continue;
    }

    const defaultCode = defaultKeybindings[action];
    if (!usedCodes.has(defaultCode)) {
      next[action] = defaultCode;
      usedCodes.add(defaultCode);
      continue;
    }

    const unusedDefaultCode = keybindActionKeys
      .map((key) => defaultKeybindings[key])
      .find((code) => !usedCodes.has(code));

    if (unusedDefaultCode) {
      next[action] = unusedDefaultCode;
      usedCodes.add(unusedDefaultCode);
    }
  }

  return next;
}

export function sanitizeSettings(value: unknown): ClientSettings {
  const raw = typeof value === 'object' && value !== null
    ? value as Partial<ClientSettings> & { quality?: unknown; pushToTalkKey?: unknown }
    : {};
  const qualityOptions = ['minimum', 'low', 'medium', 'high', 'ultra'] as const;
  const featureQualityOptions = ['off', 'minimum', 'low', 'medium', 'high', 'ultra'] as const;
  const legacyQuality = pickOption(raw.quality, qualityOptions, defaultSettings.resolutionScale);
  const graphicsPreset = pickOption(raw.graphicsPreset, ['potato', 'competitive', 'balanced', 'cinematic'] as const, defaultSettings.graphicsPreset);
  const preset = graphicsPresetSettings[graphicsPreset];

  const keybindings = sanitizeKeybindings(raw.keybindings, raw.pushToTalkKey);

  return {
    graphicsPreset,
    resolutionScale: pickOption(raw.resolutionScale, qualityOptions, raw.quality ? legacyQuality : preset.resolutionScale),
    antialiasing: pickBoolean(raw.antialiasing, raw.quality ? legacyQuality === 'high' || legacyQuality === 'ultra' : preset.antialiasing),
    shadowQuality: pickOption(raw.shadowQuality, featureQualityOptions, preset.shadowQuality),
    reflectionQuality: pickOption(raw.reflectionQuality, featureQualityOptions, preset.reflectionQuality),
    environmentQuality: pickOption(raw.environmentQuality, featureQualityOptions, preset.environmentQuality),
    materialQuality: pickOption(raw.materialQuality, featureQualityOptions, preset.materialQuality),
    adaptiveQuality: pickBoolean(raw.adaptiveQuality, preset.adaptiveQuality),
    fov: clamp(raw.fov, 60, 120, defaultSettings.fov),
    showFPS: pickFpsDisplayMode(raw.showFPS, defaultSettings.showFPS),
    showHUD: pickBoolean(raw.showHUD, defaultSettings.showHUD),
    masterVolume: clamp(raw.masterVolume, 0, 100, defaultSettings.masterVolume),
    sfxVolume: clamp(raw.sfxVolume, 0, 100, defaultSettings.sfxVolume),
    musicVolume: clamp(raw.musicVolume, 0, 100, defaultSettings.musicVolume),
    voiceEnabled: pickBoolean(raw.voiceEnabled, defaultSettings.voiceEnabled),
    voiceVolume: clamp(raw.voiceVolume, 0, 100, defaultSettings.voiceVolume),
    micVolume: clamp(raw.micVolume, 0, 100, defaultSettings.micVolume),
    voiceInputDeviceId: pickDeviceId(raw.voiceInputDeviceId, defaultSettings.voiceInputDeviceId),
    voiceOutputDeviceId: pickDeviceId(raw.voiceOutputDeviceId, defaultSettings.voiceOutputDeviceId),
    noiseSuppressionEnabled: pickBoolean(raw.noiseSuppressionEnabled, defaultSettings.noiseSuppressionEnabled),
    echoCancellationEnabled: pickBoolean(raw.echoCancellationEnabled, defaultSettings.echoCancellationEnabled),
    autoGainControlEnabled: pickBoolean(raw.autoGainControlEnabled, defaultSettings.autoGainControlEnabled),
    voiceActivationThreshold: clamp(raw.voiceActivationThreshold, 0, 1, defaultSettings.voiceActivationThreshold),
    sensitivity: clamp(raw.sensitivity, 1, 100, defaultSettings.sensitivity),
    invertY: pickBoolean(raw.invertY, defaultSettings.invertY),
    toggleCrouch: pickBoolean(raw.toggleCrouch, defaultSettings.toggleCrouch),
    toggleSprint: pickBoolean(raw.toggleSprint, defaultSettings.toggleSprint),
    showDamageNumbers: pickBoolean(raw.showDamageNumbers, defaultSettings.showDamageNumbers),
    showKillFeed: pickBoolean(raw.showKillFeed, defaultSettings.showKillFeed),
    streamerModeEnabled: pickBoolean(raw.streamerModeEnabled, defaultSettings.streamerModeEnabled),
    streamerFeedMode: pickOption(raw.streamerFeedMode, ['random', 'bot_deathmatch'] as const, defaultSettings.streamerFeedMode),
    crosshairStyle: pickOption(raw.crosshairStyle, ['default', 'dot', 'circle', 'cross'] as const, defaultSettings.crosshairStyle),
    crosshairColor: normalizeHexColor(raw.crosshairColor, defaultSettings.crosshairColor),
    devTutorialOverride: pickOption(raw.devTutorialOverride, ['account', 'bypass', 'force'] as const, defaultSettings.devTutorialOverride),
    keybindings,
  };
}

export function loadSettings(): ClientSettings {
  if (typeof window === 'undefined') return defaultSettings;

  try {
    const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return withRuntimeOnlySettingsReset(saved ? sanitizeSettings(JSON.parse(saved)) : defaultSettings);
  } catch (error) {
    loggers.room.warn('failed to load settings', error);
    return withRuntimeOnlySettingsReset(defaultSettings);
  }
}

function withRuntimeOnlySettingsReset(settings: ClientSettings): ClientSettings {
  return {
    ...settings,
    streamerModeEnabled: false,
  };
}

function persistSettings(settings: ClientSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(withRuntimeOnlySettingsReset(settings)));
}

interface SettingsStore {
  settings: ClientSettings;
  applySettings: (settings: ClientSettings) => void;
  applyGraphicsPreset: (preset: GraphicsPreset) => void;
  resetSettings: () => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: loadSettings(),
  applySettings: (settings) => {
    const nextSettings = sanitizeSettings(settings);
    persistSettings(nextSettings);
    set({ settings: nextSettings });
  },
  applyGraphicsPreset: (preset) => set((state) => {
    const nextSettings = sanitizeSettings({
      ...state.settings,
      graphicsPreset: preset,
      ...graphicsPresetSettings[preset],
    });
    persistSettings(nextSettings);
    return { settings: nextSettings };
  }),
  resetSettings: () => {
    persistSettings(defaultSettings);
    set({ settings: defaultSettings });
  },
}));
