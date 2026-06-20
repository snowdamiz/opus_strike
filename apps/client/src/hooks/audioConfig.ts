import { loadSettings, type ClientSettings } from '../store/settingsStore';
import type { AudioConfig } from './audioTypes';

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  masterVolume: 80,
  sfxVolume: 100,
  musicVolume: 50,
  muted: false,
};

export function loadAudioSettings(settings: Partial<ClientSettings> = loadSettings()): AudioConfig {
  try {
    return {
      masterVolume: settings.masterVolume ?? DEFAULT_AUDIO_CONFIG.masterVolume,
      sfxVolume: settings.sfxVolume ?? DEFAULT_AUDIO_CONFIG.sfxVolume,
      musicVolume: settings.musicVolume ?? DEFAULT_AUDIO_CONFIG.musicVolume,
      muted: false,
    };
  } catch (e) {
    console.warn('[Audio] Failed to load settings:', e);
  }
  return { ...DEFAULT_AUDIO_CONFIG };
}
