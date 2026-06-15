import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import type { DragHookData, HookProjectileData } from '../../store/gameStore';
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
  createDragHookSlotHandle,
  createHookProjectileSlotHandle,
  type DragHookSlotHandle,
  type HookProjectileSlotHandle,
} from './hookshot';
import { runHookshotFrameUpdaters } from './hookshot/hookshotFrameRegistry';

// ============================================================================
// HOOKSHOT EFFECTS MANAGER
// ============================================================================

const HOOK_PROJECTILE_VISUAL_SLOT_CAPACITY = 32;
const DRAG_HOOK_VISUAL_SLOT_CAPACITY = 16;

type ProjectileSlot<T extends { id: string }> = {
  hook: T | null;
};

function hasProjectileWithId<T extends { id: string }>(projectiles: readonly T[], id: string): boolean {
  for (let i = 0; i < projectiles.length; i++) {
    if (projectiles[i].id === id) return true;
  }
  return false;
}

function findAssignedSlot<T extends { id: string }>(
  slots: readonly ProjectileSlot<T>[],
  id: string
): ProjectileSlot<T> | null {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.hook?.id === id) return slot;
  }
  return null;
}

function findFreeSlot<T extends { id: string }>(slots: readonly ProjectileSlot<T>[]): ProjectileSlot<T> | null {
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i].hook) return slots[i];
  }
  return null;
}

function syncProjectileSlots<T extends { id: string }>(
  slots: readonly ProjectileSlot<T>[],
  projectiles: readonly T[]
): number {
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.hook && !hasProjectileWithId(projectiles, slot.hook.id)) {
      slot.hook = null;
    }
  }

  for (let i = 0; i < projectiles.length; i++) {
    const projectile = projectiles[i];
    const assignedSlot = findAssignedSlot(slots, projectile.id);
    if (assignedSlot) {
      assignedSlot.hook = projectile;
      continue;
    }

    const freeSlot = findFreeSlot(slots);
    if (freeSlot) {
      freeSlot.hook = projectile;
    }
  }

  let activeCount = 0;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].hook) activeCount++;
  }
  return activeCount;
}

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
    hookshotGroundHooks,
    grappleLines,
    earthWalls,
  } = useGameStore(useShallow(state => ({
    hookshotGroundHooks: state.hookshotGroundHooks,
    grappleLines: state.grappleLines,
    earthWalls: state.earthWalls,
  })));
  const hookProjectileSlots = useMemo<HookProjectileSlotHandle[]>(
    () => Array.from(
      { length: HOOK_PROJECTILE_VISUAL_SLOT_CAPACITY },
      (_, slotIndex) => createHookProjectileSlotHandle(slotIndex)
    ),
    []
  );
  const dragHookSlots = useMemo<DragHookSlotHandle[]>(
    () => Array.from(
      { length: DRAG_HOOK_VISUAL_SLOT_CAPACITY },
      (_, slotIndex) => createDragHookSlotHandle(slotIndex)
    ),
    []
  );

  useFrame((state, delta) => {
    const store = useGameStore.getState();
    const basicActive = syncProjectileSlots<HookProjectileData>(hookProjectileSlots, store.hookProjectiles);
    const dragActive = syncProjectileSlots<DragHookData>(dragHookSlots, store.dragHooks);
    recordHookshotSlotDiagnostics(basicActive, dragActive);
    runHookshotFrameUpdaters(state, delta);
  });
  
  return (
    <group>
      {/* Basic attack hooks */}
      {hookProjectileSlots.map(slot => (
        <HookProjectile key={`hook-projectile-slot-${slot.slotIndex}`} slot={slot} />
      ))}
      
      {/* Heavy attack drag hooks */}
      {dragHookSlots.map(slot => (
        <DragHookEffect key={`drag-hook-slot-${slot.slotIndex}`} slot={slot} />
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
