import { useSyncExternalStore } from 'react';

const HUD_CLOCK_INTERVAL_MS = 100;

let hudNow = Date.now();
let hudClockConsumers = 0;
let hudClockIntervalId: number | null = null;
const hudClockListeners = new Set<() => void>();

function publishHudNow(): void {
  hudNow = Date.now();
  for (const listener of hudClockListeners) {
    listener();
  }
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

function subscribeHudClock(listener: () => void): () => void {
  hudClockListeners.add(listener);
  const releaseHudClock = retainHudClock();

  return () => {
    hudClockListeners.delete(listener);
    releaseHudClock();
  };
}

function getHudNowSnapshot(): number {
  return hudNow;
}

export function useHudNow(): number {
  return useSyncExternalStore(subscribeHudClock, getHudNowSnapshot, getHudNowSnapshot);
}
