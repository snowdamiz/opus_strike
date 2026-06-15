import { useEffect, useRef } from 'react';
import type { RootState } from '@react-three/fiber';
import { createFrameUpdaterRegistry } from '../systems/frameUpdaterRegistry';

type HookshotFrameUpdater = (state: RootState, delta: number) => void;
const hookshotFrameUpdaters = createFrameUpdaterRegistry<RootState>();

function runHookshotFrameUpdaterEntries(state: RootState, delta: number): void {
  hookshotFrameUpdaters.run(state, delta);
}

export function useHookshotFrameUpdater(effectId: string, updater: HookshotFrameUpdater): void {
  const updaterRef = useRef(updater);
  updaterRef.current = updater;

  useEffect(() => {
    const registeredUpdater: HookshotFrameUpdater = (state, delta) => updaterRef.current(state, delta);
    return hookshotFrameUpdaters.register(effectId, registeredUpdater);
  }, [effectId]);
}

export function runHookshotFrameUpdaters(state: RootState, delta: number): void {
  runHookshotFrameUpdaterEntries(state, delta);
}
