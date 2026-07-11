import { useGameStore } from '../../store/gameStore';
import type { ViewmodelHeroId } from './heroViewmodelMaterials';

type GameStoreSnapshot = ReturnType<typeof useGameStore.getState>;

export interface ViewmodelActionState {
  active: boolean;
  charging: boolean;
  targeting: boolean;
}

function hasOwnedProjectile<T extends { ownerId: string }>(
  items: readonly T[],
  ownerId: string | null | undefined
): boolean {
  if (!ownerId) return false;
  for (let index = 0; index < items.length; index++) {
    if (items[index].ownerId === ownerId) return true;
  }
  return false;
}

export function hasOwnedProjectileOnSide<T extends { ownerId: string; launchSide?: -1 | 1 }>(
  items: readonly T[],
  ownerId: string | null | undefined,
  side: -1 | 1
): boolean {
  if (!ownerId) return false;
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item.ownerId === ownerId && (item.launchSide ?? 1) === side) return true;
  }
  return false;
}

export function hasOwnedActiveGrappleLineOnSide(
  state: GameStoreSnapshot,
  ownerId: string | null | undefined,
  side: -1 | 1
): boolean {
  if (!ownerId) return false;
  for (let index = 0; index < state.grappleLines.length; index++) {
    const line = state.grappleLines[index];
    if (line.ownerId === ownerId && line.state !== 'done' && (line.launchSide ?? 1) === side) return true;
  }
  return false;
}

function hasOwnedGrappleLine(
  state: GameStoreSnapshot,
  ownerId: string | null | undefined
): boolean {
  return hasOwnedProjectile(state.grappleLines, ownerId);
}

export function isViewmodelActionActive(
  heroId: ViewmodelHeroId | null,
  state: GameStoreSnapshot,
  localPlayerId: string | null | undefined
): boolean {
  switch (heroId) {
    case 'phantom':
      return hasOwnedProjectile(state.voidRays, localPlayerId) ||
        hasOwnedProjectile(state.riftBolts, localPlayerId);
    case 'hookshot':
      return hasOwnedProjectile(state.dragHooks, localPlayerId) ||
        hasOwnedGrappleLine(state, localPlayerId);
    case 'blaze':
      return state.flamethrowerActive || hasOwnedProjectile(state.rockets, localPlayerId);
    case 'chronos':
    case null:
      return false;
  }
}

export function getActionState(heroId: ViewmodelHeroId): ViewmodelActionState {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id;

  switch (heroId) {
    case 'phantom':
      return {
        active: isViewmodelActionActive(heroId, store, localPlayerId),
        charging: store.voidRayCharging,
        targeting: false,
      };
    case 'hookshot':
      return {
        active: isViewmodelActionActive(heroId, store, localPlayerId),
        charging: false,
        targeting: false,
      };
    case 'blaze':
      return {
        active: isViewmodelActionActive(heroId, store, localPlayerId),
        charging: false,
        targeting: store.bombTargeting,
      };
    case 'chronos':
      return {
        active: false,
        charging: false,
        targeting: false,
      };
  }
}
