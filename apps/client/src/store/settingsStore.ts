import { create } from 'zustand';

export type GraphicsQuality = 'low' | 'medium' | 'high' | 'ultra';
export type CrosshairStyle = 'default' | 'dot' | 'circle' | 'cross';

export interface ClientSettings {
  quality: GraphicsQuality;
  fov: number;
  showFPS: boolean;
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

export const defaultSettings: ClientSettings = {
  quality: 'high',
  fov: 90,
  showFPS: false,
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

export function sanitizeSettings(value: unknown): ClientSettings {
  const raw = typeof value === 'object' && value !== null ? value as Partial<ClientSettings> : {};

  return {
    quality: pickOption(raw.quality, ['low', 'medium', 'high', 'ultra'] as const, defaultSettings.quality),
    fov: clamp(raw.fov, 60, 120, defaultSettings.fov),
    showFPS: pickBoolean(raw.showFPS, defaultSettings.showFPS),
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
    console.warn('[Settings] Failed to load settings:', error);
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
  resetSettings: () => void;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: loadSettings(),
  applySettings: (settings) => {
    const nextSettings = sanitizeSettings(settings);
    persistSettings(nextSettings);
    set({ settings: nextSettings });
  },
  resetSettings: () => {
    persistSettings(defaultSettings);
    set({ settings: defaultSettings });
  },
}));
