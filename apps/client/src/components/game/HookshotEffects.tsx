import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import { useFrame } from '@react-three/fiber';
import { 
  HookProjectile,
  DragHookEffect,
  GroundHooksEffect,
  EarthWallEffect,
  GrappleLineEffect,
} from './hookshot';
import { runHookshotFrameUpdaters } from './hookshot/hookshotFrameRegistry';

// ============================================================================
// HOOKSHOT EFFECTS MANAGER
// ============================================================================

export function HookshotEffectsManager() {
  const {
    hookProjectiles,
    dragHooks,
    hookshotGroundHooks,
    grappleLines,
    earthWalls,
  } = useGameStore(useShallow(state => ({
    hookProjectiles: state.hookProjectiles,
    dragHooks: state.dragHooks,
    hookshotGroundHooks: state.hookshotGroundHooks,
    grappleLines: state.grappleLines,
    earthWalls: state.earthWalls,
  })));

  useFrame(runHookshotFrameUpdaters);
  
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
      
      {/* Ground Hooks ultimate roots */}
      {hookshotGroundHooks.map(effect => (
        <GroundHooksEffect key={effect.id} effect={effect} />
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
