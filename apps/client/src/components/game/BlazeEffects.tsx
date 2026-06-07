import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import {
  RocketsManager,
  RocketJumpExplosions,
  AirStrikeEffects,
  BombEffect,
  FlamethrowerEffect,
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
  const { bombs, flamethrowerActive } = useGameStore(
    useShallow(state => ({
      bombs: state.bombs,
      flamethrowerActive: state.flamethrowerActive,
    }))
  );
  
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
      
      <FlamethrowerEffect isActive={flamethrowerActive} />
    </group>
  );
}
