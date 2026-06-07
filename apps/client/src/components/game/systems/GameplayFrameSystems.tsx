import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { ICE_WALL_DURATION } from '@voxel-strike/shared';
import { cleanupExpiredTemporaryWallColliders } from '../../../hooks/usePhysics';
import { useGameStore } from '../../../store/gameStore';
import { updateFrameClock } from '../../../utils/frameClock';
import { recordFrameSample, registerFrameSystem } from '../../../utils/perfMarks';

const CLEANUP_INTERVAL_MS = 100;

export function GameplayFrameSystems() {
  const cleanupAccumulatorRef = useRef(0);

  useEffect(() => registerFrameSystem('gameplay-cleanup'), []);

  useFrame((state, delta) => {
    const clock = updateFrameClock(state.clock.elapsedTime, delta);
    recordFrameSample(delta);

    cleanupAccumulatorRef.current += clock.clampedDeltaSeconds * 1000;
    if (cleanupAccumulatorRef.current < CLEANUP_INTERVAL_MS) return;
    cleanupAccumulatorRef.current = 0;

    const store = useGameStore.getState();
    store.clearExpiredRockets();
    store.clearExpiredBombs();
    store.clearExpiredDireBalls();
    store.clearExpiredVoidRays();
    store.clearExpiredVoidZones();
    store.clearExpiredHookProjectiles();
    store.clearExpiredDragHooks();
    store.clearExpiredGrappleTraps();
    store.clearExpiredSwingLines();
    store.clearExpiredGrappleLines();
    store.clearExpiredEarthWalls();
    store.clearExpiredIceMalletSwings();
    store.clearExpiredIceWallRushes();
    cleanupExpiredTemporaryWallColliders(6500, 'anchorwall_');
    cleanupExpiredTemporaryWallColliders(ICE_WALL_DURATION * 1000, 'icewall_');
  });

  return null;
}
