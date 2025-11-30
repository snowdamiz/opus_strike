import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
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
  const bombs = useGameStore(state => state.bombs);
  const localPlayer = useGameStore(state => state.localPlayer);
  const jetpackActive = useGameStore(state => state.jetpackActive);
  
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
