import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../../store/gameStore';
import type { DragHookData, HookProjectileData } from '../../store/types';
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

type ProjectileSlotSyncScratch<T extends { id: string }> = {
  projectileById: Map<string, T>;
  assignedIds: Set<string>;
};

function createProjectileSlotSyncScratch<T extends { id: string }>(): ProjectileSlotSyncScratch<T> {
  return {
    projectileById: new Map<string, T>(),
    assignedIds: new Set<string>(),
  };
}

function syncProjectileSlots<T extends { id: string }>(
  slots: readonly ProjectileSlot<T>[],
  projectiles: readonly T[],
  scratch: ProjectileSlotSyncScratch<T>
): number {
  scratch.projectileById.clear();
  scratch.assignedIds.clear();

  for (let i = 0; i < projectiles.length; i++) {
    const projectile = projectiles[i];
    scratch.projectileById.set(projectile.id, projectile);
  }

  let activeCount = 0;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.hook) continue;

    const projectile = scratch.projectileById.get(slot.hook.id);
    if (!projectile) {
      slot.hook = null;
      continue;
    }

    slot.hook = projectile;
    scratch.assignedIds.add(projectile.id);
    activeCount++;
  }

  let freeSlotIndex = 0;
  for (let i = 0; i < projectiles.length; i++) {
    const projectile = projectiles[i];
    if (scratch.assignedIds.has(projectile.id)) continue;

    while (freeSlotIndex < slots.length && slots[freeSlotIndex].hook) {
      freeSlotIndex++;
    }
    if (freeSlotIndex >= slots.length) break;

    slots[freeSlotIndex].hook = projectile;
    scratch.assignedIds.add(projectile.id);
    activeCount++;
    freeSlotIndex++;
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
  const hookSlotSyncScratch = useMemo(
    () => createProjectileSlotSyncScratch<HookProjectileData>(),
    []
  );
  const dragSlotSyncScratch = useMemo(
    () => createProjectileSlotSyncScratch<DragHookData>(),
    []
  );

  useFrame((state, delta) => {
    const store = useGameStore.getState();
    const basicActive = syncProjectileSlots<HookProjectileData>(hookProjectileSlots, store.hookProjectiles, hookSlotSyncScratch);
    const dragActive = syncProjectileSlots<DragHookData>(dragHookSlots, store.dragHooks, dragSlotSyncScratch);
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
