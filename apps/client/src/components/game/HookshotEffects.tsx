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
      
      {/* Grapple lines (E ability) */}
      {grappleLines.map(line => (
        <GrappleLineEffect key={line.id} line={line} />
      ))}
      
      {/* Anchor Walls (Q ability - ground hook raises a solid barricade) */}
      {earthWalls.map(wall => (
        <EarthWallEffect key={wall.id} wall={wall} />
      ))}
    </group>
  );
}
