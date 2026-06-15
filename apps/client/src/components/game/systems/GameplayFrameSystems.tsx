import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { cleanupExpiredTemporaryWallColliders } from '../../../hooks/usePhysics';
import { useGameStore } from '../../../store/gameStore';
import { updateFrameClock } from '../../../utils/frameClock';
import { gameplayFrameScheduler } from './gameplayFrameScheduler';

const CLEANUP_INTERVAL_MS = 100;
const FRAME_CLOCK_PRIORITY = -1000;

export function GameplayFrameSystems() {
  useEffect(() => gameplayFrameScheduler.register({
    system: 'gameplayCleanup',
    label: 'frame.gameplayCleanup',
    cadence: { kind: 'intervalMs', intervalMs: CLEANUP_INTERVAL_MS },
    callback: () => {
      const store = useGameStore.getState();
      store.clearExpiredProjectiles();
      cleanupExpiredTemporaryWallColliders(6500, 'anchorwall_');
    },
  }), []);

  useFrame((state, delta) => {
    const clock = updateFrameClock(state.clock.elapsedTime, delta);
    gameplayFrameScheduler.run({
      deltaSeconds: clock.clampedDeltaSeconds,
      deltaMs: clock.clampedDeltaSeconds * 1000,
      nowMs: clock.epochNowMs,
      elapsedSeconds: clock.elapsedSeconds,
    });
  }, FRAME_CLOCK_PRIORITY);

  return null;
}
