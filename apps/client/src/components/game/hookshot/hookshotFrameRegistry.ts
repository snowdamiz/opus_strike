import { useEffect, useRef } from 'react';
import type { RootState } from '@react-three/fiber';
import {
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../../movement/networkDiagnostics';

type HookshotFrameUpdater = (state: RootState, delta: number) => void;

const hookshotFrameUpdaters = new Map<string, HookshotFrameUpdater>();

export function useHookshotFrameUpdater(effectId: string, updater: HookshotFrameUpdater): void {
  const updaterRef = useRef(updater);
  updaterRef.current = updater;

  useEffect(() => {
    const registeredUpdater: HookshotFrameUpdater = (state, delta) => updaterRef.current(state, delta);
    hookshotFrameUpdaters.set(effectId, registeredUpdater);
    return () => {
      hookshotFrameUpdaters.delete(effectId);
    };
  }, [effectId]);
}

export function runHookshotFrameUpdaters(state: RootState, delta: number): void {
  measureFrameWork('frame.effects.hookshot', () => {
    for (const updater of hookshotFrameUpdaters.values()) {
      updater(state, delta);
    }

    recordEffectSlotDiagnostics('hookshot', {
      active: hookshotFrameUpdaters.size,
      capacity: hookshotFrameUpdaters.size,
      hiddenMounted: 0,
    });
  });
}
