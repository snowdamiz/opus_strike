import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { cleanupExpiredTemporaryWallColliders } from '../../../hooks/usePhysics';
import { useGameStore } from '../../../store/gameStore';
import { updateFrameClock } from '../../../utils/frameClock';
import {
  beginFrameWorkTiming,
  finishFrameWorkTiming,
  measureFrameWork,
} from '../../../movement/networkDiagnostics';

const CLEANUP_INTERVAL_MS = 100;
const FRAME_CLOCK_PRIORITY = -1000;
const FRAME_WORK_END_PRIORITY = 0;

export function GameplayFrameSystems() {
  const cleanupAccumulatorRef = useRef(0);

  useFrame((state, delta) => {
    const clock = updateFrameClock(state.clock.elapsedTime, delta);
    beginFrameWorkTiming();

    measureFrameWork('frame.gameplayCleanup', () => {
      cleanupAccumulatorRef.current += clock.clampedDeltaSeconds * 1000;
      if (cleanupAccumulatorRef.current < CLEANUP_INTERVAL_MS) return;
      cleanupAccumulatorRef.current = 0;

      const store = useGameStore.getState();
      store.clearExpiredProjectiles();
      cleanupExpiredTemporaryWallColliders(6500, 'anchorwall_');
    });
  }, FRAME_CLOCK_PRIORITY);

  return null;
}

export function GameplayFrameWorkBoundary() {
  useFrame(() => {
    finishFrameWorkTiming('frame.r3fCallbacks');
  }, FRAME_WORK_END_PRIORITY);

  return null;
}
