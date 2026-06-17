export interface AudioConfig {
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  muted: boolean;
}

export interface SoundEffect {
  buffer: AudioBuffer | null;
  volume: number;
  playbackDurationRatio?: number;
}

export interface SoundDefinition {
  path: string;
  volume: number;
  playbackDurationRatio?: number;
}

export interface PlaySoundOptions {
  volume?: number;
  pitch?: number;
  position?: { x: number; y: number; z: number };
  stretchToDurationMs?: boolean;
  startOffsetMs?: number;
  durationMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  signal?: AbortSignal;
}

export interface SoundPlayback {
  stop: () => void;
}
