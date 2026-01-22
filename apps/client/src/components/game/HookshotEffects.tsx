import { useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
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
  const {
    hookProjectiles,
    dragHooks,
    grappleTraps,
    swingLines,
    grappleLines,
    earthWalls,
  } = useGameStore(useShallow(state => ({
    hookProjectiles: state.hookProjectiles,
    dragHooks: state.dragHooks,
    grappleTraps: state.grappleTraps,
    swingLines: state.swingLines,
    grappleLines: state.grappleLines,
    earthWalls: state.earthWalls,
  })));
  
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
