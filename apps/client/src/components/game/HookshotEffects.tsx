import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { 
  HookProjectile,
  DragHookEffect,
  GrappleTrapEffect,
  EarthWallEffect,
  GrappleLineEffect,
  SwingLineEffect,
} from './hookshot';

// Re-export targeting indicator for external use
export { GrappleTrapTargetingIndicator } from './hookshot';

// ============================================================================
// HOOKSHOT EFFECTS MANAGER
// ============================================================================

export function HookshotEffectsManager() {
  const hookProjectiles = useGameStore(state => state.hookProjectiles);
  const dragHooks = useGameStore(state => state.dragHooks);
  const grappleTraps = useGameStore(state => state.grappleTraps);
  const swingLines = useGameStore(state => state.swingLines);
  const grappleLines = useGameStore(state => state.grappleLines);
  const earthWalls = useGameStore(state => state.earthWalls);
  
  // Cleanup interval
  useEffect(() => {
    const interval = setInterval(() => {
      useGameStore.getState().clearExpiredHookProjectiles();
      useGameStore.getState().clearExpiredDragHooks();
      useGameStore.getState().clearExpiredGrappleTraps();
      useGameStore.getState().clearExpiredSwingLines();
      useGameStore.getState().clearExpiredGrappleLines();
      useGameStore.getState().clearExpiredEarthWalls();
    }, 150);
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <group>
      {/* Basic attack hooks */}
      {hookProjectiles.map(hook => (
        <HookProjectile key={hook.id} hook={hook} />
      ))}
      
      {/* Heavy attack drag hooks */}
      {dragHooks.map(hook => (
        <DragHookEffect key={hook.id} hook={hook} />
      ))}
      
      {/* Ultimate grapple traps */}
      {grappleTraps.map(trap => (
        <GrappleTrapEffect key={trap.id} trap={trap} />
      ))}
      
      {/* Swing lines (legacy, kept for compatibility) */}
      {swingLines.map(line => (
        <SwingLineEffect key={line.id} line={line} />
      ))}
      
      {/* Grapple lines (Q ability) */}
      {grappleLines.map(line => (
        <GrappleLineEffect key={line.id} line={line} />
      ))}
      
      {/* Earth Walls (E ability - hook slides on ground, wall rises behind) */}
      {earthWalls.map(wall => (
        <EarthWallEffect key={wall.id} wall={wall} />
      ))}
    </group>
  );
}
