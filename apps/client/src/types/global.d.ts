/// <reference types="vite/client" />

import { Buffer } from 'buffer';

declare global {
  interface Window {
    Buffer: typeof Buffer;
    __voxelRecording?: {
      ready: Promise<void>;
      durationMs: number;
      fps: number;
      stepTo: (recordingTimeMs: number) => Promise<void>;
      play: () => void;
      pause: () => void;
    };
  }
}

export {};
