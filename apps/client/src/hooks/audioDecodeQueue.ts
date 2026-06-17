const MAX_CONCURRENT_AUDIO_DECODES = 2;

let activeAudioDecodes = 0;
const queuedAudioDecodeJobs: Array<() => void> = [];

export interface AudioDecodeQueueSnapshot {
  activeDecodes: number;
  queuedDecodes: number;
}

export function getAudioDecodeQueueSnapshot(): AudioDecodeQueueSnapshot {
  return {
    activeDecodes: activeAudioDecodes,
    queuedDecodes: queuedAudioDecodeJobs.length,
  };
}

function pumpAudioDecodeQueue(onStateChange: () => void): void {
  while (activeAudioDecodes < MAX_CONCURRENT_AUDIO_DECODES) {
    const next = queuedAudioDecodeJobs.shift();
    if (!next) return;
    activeAudioDecodes++;
    onStateChange();
    next();
  }
  onStateChange();
}

export function decodeAudioDataLimited(
  ctx: AudioContext,
  arrayBuffer: ArrayBuffer,
  onStateChange: () => void
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    queuedAudioDecodeJobs.push(() => {
      ctx.decodeAudioData(arrayBuffer)
        .then(resolve, reject)
        .finally(() => {
          activeAudioDecodes = Math.max(0, activeAudioDecodes - 1);
          onStateChange();
          pumpAudioDecodeQueue(onStateChange);
        });
    });
    onStateChange();
    pumpAudioDecodeQueue(onStateChange);
  });
}
