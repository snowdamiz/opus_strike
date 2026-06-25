import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import { useShallow } from 'zustand/shallow';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  recordEffectSlotDiagnostics,
} from '../../movement/networkDiagnostics';
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

const HOOK_PROJECTILE_VISUAL_SLOT_CAPACITY = 32;
const DRAG_HOOK_VISUAL_SLOT_CAPACITY = 16;

function recordHookshotSlotDiagnostics(basicActive: number, dragActive: number): void {
  if (!MOVEMENT_DIAGNOSTICS_ENABLED) return;

  const active = basicActive + dragActive;
  const capacity = HOOK_PROJECTILE_VISUAL_SLOT_CAPACITY + DRAG_HOOK_VISUAL_SLOT_CAPACITY;

  recordEffectSlotDiagnostics('hookshot', {
    active,
    hiddenMounted: capacity - active,
    capacity,
  });
  recordEffectSlotDiagnostics('hookshotBasic', {
    active: basicActive,
    hiddenMounted: HOOK_PROJECTILE_VISUAL_SLOT_CAPACITY - basicActive,
    capacity: HOOK_PROJECTILE_VISUAL_SLOT_CAPACITY,
  });
  recordEffectSlotDiagnostics('hookshotDrag', {
    active: dragActive,
    hiddenMounted: DRAG_HOOK_VISUAL_SLOT_CAPACITY - dragActive,
    capacity: DRAG_HOOK_VISUAL_SLOT_CAPACITY,
  });
}

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
  const visibleHookProjectiles = useMemo(
    () => hookProjectiles.slice(0, HOOK_PROJECTILE_VISUAL_SLOT_CAPACITY),
    [hookProjectiles]
  );
  const visibleDragHooks = useMemo(
    () => dragHooks.slice(0, DRAG_HOOK_VISUAL_SLOT_CAPACITY),
    [dragHooks]
  );

  useFrame((state, delta) => {
    recordHookshotSlotDiagnostics(visibleHookProjectiles.length, visibleDragHooks.length);
    runHookshotFrameUpdaters(state, delta);
  });
  
  return (
    <group>
      {/* Basic attack hooks */}
      {visibleHookProjectiles.map((hook, slotIndex) => (
        <HookProjectile key={hook.id} hook={hook} slotIndex={slotIndex} />
      ))}
      
      {/* Heavy attack drag hooks */}
      {visibleDragHooks.map((hook, slotIndex) => (
        <DragHookEffect key={hook.id} hook={hook} slotIndex={slotIndex} />
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
