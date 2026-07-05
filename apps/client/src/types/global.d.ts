/// <reference types="vite/client" />

import { Buffer } from 'buffer';

declare global {
  interface Window {
    Buffer: typeof Buffer;
    __voxelRecording?: {
      isReady: boolean;
      durationMs: number;
      fps: number;
      currentTimeMs: number;
      progress: number;
      stepTo: (recordingTimeMs: number) => Promise<void>;
      play: () => void;
      pause: () => void;
      waitUntilFinished: () => Promise<void>;
      markSceneReady: () => void;
    };
  }
}

export {};
