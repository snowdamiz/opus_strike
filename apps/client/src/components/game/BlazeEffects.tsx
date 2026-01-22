import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import {
  RocketsManager,
  RocketJumpExplosions,
  AirStrikeEffects,
  BombEffect,
  JetpackEffect,
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

export function BlazeEffectsManager() {
  const { bombs, localPlayer, jetpackActive } = useGameStore(
    useShallow(state => ({
      bombs: state.bombs,
      localPlayer: state.localPlayer,
      jetpackActive: state.jetpackActive,
    }))
  );
  
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredRockets();
      useGameStore.getState().clearExpiredBombs();
    }, 150);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {/* Rockets with shared light */}
      <RocketsManager />
      
      {bombs.map(bomb => (
        <BombEffect key={bomb.id} bomb={bomb} />
      ))}
      
      {/* Rocket jump explosions */}
      <RocketJumpExplosions />
      
      {/* Air strikes */}
      <AirStrikeEffects />
      
      {localPlayer && jetpackActive && (
        <JetpackEffect isActive={true} playerPosition={localPlayer.position} />
      )}
    </group>
  );
}
