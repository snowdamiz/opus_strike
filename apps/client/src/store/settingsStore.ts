import { create } from 'zustand';
import { loggers } from '../utils/logger';

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';
export type GraphicsFeatureQuality = 'off' | GraphicsQuality;
export type MaterialQuality = 'low' | 'medium' | 'high';
export type CrosshairStyle = 'default' | 'dot' | 'circle' | 'cross';
export type GraphicsPreset = 'competitive' | 'balanced' | 'cinematic';
export type FpsDisplayMode = 'off' | 'fps' | 'full';

export interface ClientSettings {
  graphicsPreset: GraphicsPreset;
  resolutionScale: GraphicsQuality;
  antialiasing: boolean;
  materialQuality: MaterialQuality;
  shadowQuality: GraphicsFeatureQuality;
  reflectionQuality: GraphicsFeatureQuality;
  environmentQuality: GraphicsFeatureQuality;
  adaptiveQuality: boolean;
  fov: number;
  showFPS: FpsDisplayMode;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  sensitivity: number;
  invertY: boolean;
  toggleCrouch: boolean;
  toggleSprint: boolean;
  showDamageNumbers: boolean;
  showKillFeed: boolean;
  crosshairStyle: CrosshairStyle;
  crosshairColor: string;
}

export const SETTINGS_STORAGE_KEY = 'voxel-strike-settings';

export const graphicsPresetSettings: Record<GraphicsPreset, Pick<
  ClientSettings,
  | 'resolutionScale'
  | 'antialiasing'
  | 'materialQuality'
  | 'shadowQuality'
  | 'reflectionQuality'
  | 'environmentQuality'
  | 'adaptiveQuality'
>> = {
  competitive: {
    resolutionScale: 'medium',
    antialiasing: false,
    materialQuality: 'medium',
    shadowQuality: 'low',
    reflectionQuality: 'off',
    environmentQuality: 'low',
    adaptiveQuality: true,
  },
  balanced: {
    resolutionScale: 'medium',
    antialiasing: true,
    materialQuality: 'medium',
    shadowQuality: 'medium',
    reflectionQuality: 'medium',
    environmentQuality: 'medium',
    adaptiveQuality: true,
  },
  cinematic: {
    resolutionScale: 'high',
    antialiasing: true,
    materialQuality: 'high',
    shadowQuality: 'high',
    reflectionQuality: 'high',
    environmentQuality: 'high',
    adaptiveQuality: false,
  },
};

export const defaultSettings: ClientSettings = {
  graphicsPreset: 'balanced',
  ...graphicsPresetSettings.balanced,
  fov: 90,
  showFPS: 'off',
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 50,
  sensitivity: 50,
  invertY: false,
  toggleCrouch: false,
  toggleSprint: false,
  showDamageNumbers: true,
  showKillFeed: true,
  crosshairStyle: 'default',
  crosshairColor: '#ffffff',
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

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickFpsDisplayMode(value: unknown, fallback: FpsDisplayMode): FpsDisplayMode {
  if (value === true) return 'full';
  if (value === false) return 'off';
  return pickOption(value, ['off', 'fps', 'full'] as const, fallback);
}

function materialQualityFromLegacyPreset(quality: GraphicsQuality): MaterialQuality {
  if (quality === 'low') return 'low';
  if (quality === 'medium') return 'medium';
  return 'high';
}

export function sanitizeSettings(value: unknown): ClientSettings {
  const raw = typeof value === 'object' && value !== null
    ? value as Partial<ClientSettings> & { quality?: unknown }
    : {};
  const qualityOptions = ['low', 'medium', 'high', 'ultra'] as const;
  const featureQualityOptions = ['off', 'low', 'medium', 'high', 'ultra'] as const;
  const legacyQuality = pickOption(raw.quality, qualityOptions, defaultSettings.resolutionScale);
  const graphicsPreset = pickOption(raw.graphicsPreset, ['competitive', 'balanced', 'cinematic'] as const, defaultSettings.graphicsPreset);
  const preset = graphicsPresetSettings[graphicsPreset];

  return {
    graphicsPreset,
    resolutionScale: pickOption(raw.resolutionScale, qualityOptions, raw.quality ? legacyQuality : preset.resolutionScale),
    antialiasing: pickBoolean(raw.antialiasing, raw.quality ? legacyQuality === 'high' || legacyQuality === 'ultra' : preset.antialiasing),
    materialQuality: pickOption(
      raw.materialQuality,
      ['low', 'medium', 'high'] as const,
      raw.quality ? materialQualityFromLegacyPreset(legacyQuality) : preset.materialQuality
    ),
    shadowQuality: pickOption(raw.shadowQuality, featureQualityOptions, preset.shadowQuality),
    reflectionQuality: pickOption(raw.reflectionQuality, featureQualityOptions, preset.reflectionQuality),
    environmentQuality: pickOption(raw.environmentQuality, featureQualityOptions, preset.environmentQuality),
    adaptiveQuality: pickBoolean(raw.adaptiveQuality, preset.adaptiveQuality),
    fov: clamp(raw.fov, 60, 120, defaultSettings.fov),
    showFPS: pickFpsDisplayMode(raw.showFPS, defaultSettings.showFPS),
    masterVolume: clamp(raw.masterVolume, 0, 100, defaultSettings.masterVolume),
    sfxVolume: clamp(raw.sfxVolume, 0, 100, defaultSettings.sfxVolume),
    musicVolume: clamp(raw.musicVolume, 0, 100, defaultSettings.musicVolume),
    sensitivity: clamp(raw.sensitivity, 1, 100, defaultSettings.sensitivity),
    invertY: pickBoolean(raw.invertY, defaultSettings.invertY),
    toggleCrouch: pickBoolean(raw.toggleCrouch, defaultSettings.toggleCrouch),
    toggleSprint: pickBoolean(raw.toggleSprint, defaultSettings.toggleSprint),
    showDamageNumbers: pickBoolean(raw.showDamageNumbers, defaultSettings.showDamageNumbers),
    showKillFeed: pickBoolean(raw.showKillFeed, defaultSettings.showKillFeed),
    crosshairStyle: pickOption(raw.crosshairStyle, ['default', 'dot', 'circle', 'cross'] as const, defaultSettings.crosshairStyle),
    crosshairColor: normalizeHexColor(raw.crosshairColor, defaultSettings.crosshairColor),
  };
}

export function loadSettings(): ClientSettings {
  if (typeof window === 'undefined') return defaultSettings;

  try {
    const saved = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return saved ? sanitizeSettings(JSON.parse(saved)) : defaultSettings;
  } catch (error) {
    loggers.perf.warn('failed to load settings', error);
    return defaultSettings;
  }
}

function persistSettings(settings: ClientSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
