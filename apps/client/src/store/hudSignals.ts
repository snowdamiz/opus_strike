import { useEffect } from 'react';
import { signal } from '@preact/signals-react';
import { useSignals } from '@preact/signals-react/runtime';

const HUD_CLOCK_INTERVAL_MS = 100;

export const hudNowSignal = signal(Date.now());

let hudClockConsumers = 0;
let hudClockIntervalId: number | null = null;

function publishHudNow(): void {
  hudNowSignal.value = Date.now();
}

export function retainHudClock(): () => void {
  if (typeof window === 'undefined') return () => {};

  hudClockConsumers++;
  if (hudClockIntervalId === null) {
    publishHudNow();
    hudClockIntervalId = window.setInterval(publishHudNow, HUD_CLOCK_INTERVAL_MS);
  }

  return () => {
    hudClockConsumers = Math.max(0, hudClockConsumers - 1);
    if (hudClockConsumers === 0 && hudClockIntervalId !== null) {
      window.clearInterval(hudClockIntervalId);
      hudClockIntervalId = null;
    }
  };
}

export function useHudNow(): number {
  useSignals();
  useEffect(() => retainHudClock(), []);
  return hudNowSignal.value;
}
