import { useCallback, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
} from '@voxel-strike/shared';
import type { Player } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import { playSharedLoop, setSharedLoopPosition, stopSharedLoop } from '../../hooks/useAudio';
import {
  RocketsManager,
  RocketJumpExplosions,
  AirStrikeEffects,
  BombEffect,
  FlamethrowerEffect,
  type FlamethrowerPose,
} from './blaze';

// Re-export trigger functions and targeting indicators for external use
export { 
  triggerRocketJumpExplosion,
  triggerAirStrike,
  BombTargetingIndicator,
  AirStrikeTargetingIndicator,
} from './blaze';

// ============================================================================
// BLAZE EFFECTS MANAGER
// ============================================================================

function resolveRemoteFlamethrowerPose(player: Player | undefined): FlamethrowerPose | null {
  if (!player || player.state !== 'alive' || player.heroId !== 'blaze' || !player.movement.isJetpacking) {
    return null;
  }

  const yaw = player.lookYaw;
  const pitch = player.lookPitch;
  const cosPitch = Math.cos(pitch);
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  return {
    origin: {
      x: player.position.x + forwardX * BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET + rightX * BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
      y: player.position.y + BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
      z: player.position.z + forwardZ * BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET + rightZ * BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
    },
    direction: {
      x: forwardX * cosPitch,
      y: Math.sin(pitch),
      z: forwardZ * cosPitch,
    },
  };
}

function RemoteBlazeFlamethrower({ playerId }: { playerId: string }) {
  const loopId = useMemo(() => `remote-blaze-flamethrower:${playerId}`, [playerId]);
  const poseProvider = useCallback(() => (
    resolveRemoteFlamethrowerPose(useGameStore.getState().players.get(playerId))
  ), [playerId]);

  useEffect(() => {
    const pose = poseProvider();
    void playSharedLoop(loopId, 'blazeFlamethrower', {
      position: pose?.origin,
      fadeInMs: 100,
    });

    return () => {
      stopSharedLoop(loopId, 150);
    };
  }, [loopId, poseProvider]);

  useFrame(() => {
    const pose = poseProvider();
    if (pose) {
      setSharedLoopPosition(loopId, pose.origin);
    }
  });

  return <FlamethrowerEffect isActive poseProvider={poseProvider} />;
}

export function BlazeEffectsManager() {
  const bombs = useGameStore(state => state.bombs);
  const flamethrowerActive = useGameStore(state => state.flamethrowerActive);
  const remoteFlamethrowerPlayerIds = useGameStore(
    useShallow(state => Array.from(state.players.values())
      .filter(player => (
        player.id !== (state.localPlayer?.id ?? state.playerId) &&
        player.heroId === 'blaze' &&
        player.state === 'alive' &&
        player.movement.isJetpacking
      ))
      .map(player => player.id)
    )
  );
  
  return (
    <group>
      {/* Fireballs with shared light */}
      <RocketsManager />
      
      {bombs.map(bomb => (
        <BombEffect key={bomb.id} bomb={bomb} />
      ))}
      
      {/* Rocket jump explosions */}
      <RocketJumpExplosions />
      
      {/* Infernal Gearstorm ultimate */}
      <AirStrikeEffects />
      
      <FlamethrowerEffect isActive={flamethrowerActive} />
      {remoteFlamethrowerPlayerIds.map(playerId => (
        <RemoteBlazeFlamethrower key={playerId} playerId={playerId} />
      ))}
    </group>
  );
}
