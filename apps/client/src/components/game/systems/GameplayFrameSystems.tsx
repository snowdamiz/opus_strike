import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { cleanupExpiredTemporaryWallColliders } from '../../../hooks/usePhysics';
import { useGameStore } from '../../../store/gameStore';
import { updateFrameClock } from '../../../utils/frameClock';

const CLEANUP_INTERVAL_MS = 100;

export function GameplayFrameSystems() {
  const cleanupAccumulatorRef = useRef(0);

  useFrame((state, delta) => {
    const clock = updateFrameClock(state.clock.elapsedTime, delta);

    cleanupAccumulatorRef.current += clock.clampedDeltaSeconds * 1000;
    if (cleanupAccumulatorRef.current < CLEANUP_INTERVAL_MS) return;
    cleanupAccumulatorRef.current = 0;

    const store = useGameStore.getState();
    store.clearExpiredRockets();
    store.clearExpiredBombs();
    store.clearExpiredDireBalls();
    store.clearExpiredVoidRays();
    store.clearExpiredVoidZones();
    store.clearExpiredChronosPulses();
    store.clearExpiredChronosTimebreaks();
    store.clearExpiredHookProjectiles();
    store.clearExpiredDragHooks();
    store.clearExpiredGrappleTraps();
    store.clearExpiredSwingLines();
    store.clearExpiredGrappleLines();
    store.clearExpiredEarthWalls();
    cleanupExpiredTemporaryWallColliders(6500, 'anchorwall_');
  });

  return null;
}
