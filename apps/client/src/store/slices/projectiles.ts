import type { StateCreator } from 'zustand';
import {
  BLAZE_PRIMARY_MAGAZINE_SIZE,
  BLAZE_PRIMARY_RELOAD_MS,
  CHRONOS_PRIMARY_MAGAZINE_SIZE,
  CHRONOS_PRIMARY_RELOAD_MS,
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
} from '@voxel-strike/shared';
import type {
  VoidZoneData,
  DireBallData,
  VoidRayData,
  RocketData,
  BombData,
  PhosphorFlareData,
  ChronosPulseData,
  HookProjectileData,
  DragHookData,
  HookshotGroundHooksData,
  GrappleLineData,
  EarthWallData,
} from '../types';

// ============================================================================
// PROJECTILE STATE INTERFACE
// ============================================================================

export interface ProjectileState {
  // Phantom projectiles
  voidZones: VoidZoneData[];
  direBalls: DireBallData[];
  voidRays: VoidRayData[];
  voidRayCharging: boolean;
  voidRayChargeStart: number;
  phantomPrimaryAmmo: number;
  phantomPrimaryReloading: boolean;
  phantomPrimaryReloadStart: number;
  phantomPrimaryReloadEnd: number;

  // Blaze projectiles
  rockets: RocketData[];
  blazePrimaryAmmo: number;
  blazePrimaryReloading: boolean;
  blazePrimaryReloadStart: number;
  blazePrimaryReloadEnd: number;
  bombs: BombData[];
  phosphorFlares: PhosphorFlareData[];
  bombTargeting: boolean;
  bombTargetValid: boolean;
  flamethrowerActive: boolean;
  flamethrowerFuel: number;

  // Chronos projectiles
  chronosPulses: ChronosPulseData[];
  chronosPrimaryAmmo: number;
  chronosPrimaryReloading: boolean;
  chronosPrimaryReloadStart: number;
  chronosPrimaryReloadEnd: number;

  // Hookshot projectiles
  hookProjectiles: HookProjectileData[];
  dragHooks: DragHookData[];
  hookshotGroundHooks: HookshotGroundHooksData[];
  grappleLines: GrappleLineData[];
  earthWalls: EarthWallData[];
}

export interface ProjectileActions {
  // Void zone actions
  addVoidZone: (zone: VoidZoneData) => void;
  removeVoidZone: (id: string) => void;
  clearExpiredVoidZones: () => void;

  // Dire ball actions
  addDireBall: (ball: DireBallData) => void;
  removeDireBall: (id: string) => void;
  removeDireBalls: (ids: readonly string[]) => void;
  clearExpiredDireBalls: () => void;
  setPhantomPrimaryAmmo: (ammo: number) => void;
  setPhantomPrimaryReload: (reloading: boolean, startTime?: number, endTime?: number) => void;
  resetPhantomPrimaryMagazine: () => void;

  // Void ray actions
  addVoidRay: (ray: VoidRayData) => void;
  removeVoidRay: (id: string) => void;
  clearExpiredVoidRays: () => void;
  setVoidRayCharging: (charging: boolean, startTime?: number) => void;

  // Blaze rocket actions
  addRocket: (rocket: RocketData) => void;
  removeRocket: (id: string) => void;
  removeRockets: (ids: readonly string[]) => void;
  clearExpiredRockets: () => void;
  setBlazePrimaryAmmo: (ammo: number) => void;
  setBlazePrimaryReload: (reloading: boolean, startTime?: number, endTime?: number) => void;
  resetBlazePrimaryMagazine: (magazineSize?: number) => void;

  // Blaze bomb actions
  addBomb: (bomb: BombData) => void;
  removeBomb: (id: string) => void;
  clearExpiredBombs: () => void;
  setBombTargeting: (targeting: boolean, valid?: boolean) => void;

  // Blaze phosphor flare actions
  addPhosphorFlare: (flare: PhosphorFlareData) => void;
  removePhosphorFlare: (id: string) => void;
  clearExpiredPhosphorFlares: () => void;

  // Blaze flamethrower actions
  setFlamethrowerActive: (active: boolean) => void;
  setFlamethrowerFuel: (fuel: number) => void;

  // Chronos pulse actions
  addChronosPulse: (pulse: ChronosPulseData) => void;
  removeChronosPulse: (id: string) => void;
  removeChronosPulses: (ids: readonly string[]) => void;
  clearExpiredChronosPulses: () => void;
  setChronosPrimaryAmmo: (ammo: number) => void;
  setChronosPrimaryReload: (reloading: boolean, startTime?: number, endTime?: number) => void;
  resetChronosPrimaryMagazine: () => void;

  // Hook projectile actions
  addHookProjectile: (hook: HookProjectileData) => void;
  updateHookProjectile: (id: string, updates: Partial<HookProjectileData>) => void;
  removeHookProjectile: (id: string) => void;
  clearExpiredHookProjectiles: () => void;

  // Drag hook actions
  addDragHook: (hook: DragHookData) => void;
  updateDragHook: (id: string, updates: Partial<DragHookData>) => void;
  removeDragHook: (id: string) => void;
  clearExpiredDragHooks: () => void;

  // Ground hook root actions
  addHookshotGroundHooks: (effect: HookshotGroundHooksData) => void;
  updateHookshotGroundHooks: (id: string, updates: Partial<HookshotGroundHooksData>) => void;
  removeHookshotGroundHooks: (id: string) => void;
  clearExpiredHookshotGroundHooks: () => void;

  // Grapple line actions
  addGrappleLine: (line: GrappleLineData) => void;
  updateGrappleLine: (id: string, updates: Partial<GrappleLineData>) => void;
  removeGrappleLine: (id: string) => void;
  clearExpiredGrappleLines: () => void;

  // Earth wall actions
  addEarthWall: (wall: EarthWallData) => void;
  updateEarthWall: (id: string, updates: Partial<EarthWallData>) => void;
  removeEarthWall: (id: string) => void;
  clearExpiredEarthWalls: () => void;

  // Batched per-frame cleanup
  clearExpiredProjectiles: () => void;
}

export type ProjectileSlice = ProjectileState & ProjectileActions;

// ============================================================================
// INITIAL STATE
// ============================================================================

export const projectileInitialState: ProjectileState = {
  voidZones: [],
  direBalls: [],
  voidRays: [],
  voidRayCharging: false,
  voidRayChargeStart: 0,
  phantomPrimaryAmmo: PHANTOM_PRIMARY_MAGAZINE_SIZE,
  phantomPrimaryReloading: false,
  phantomPrimaryReloadStart: 0,
  phantomPrimaryReloadEnd: 0,
  rockets: [],
  blazePrimaryAmmo: BLAZE_PRIMARY_MAGAZINE_SIZE,
  blazePrimaryReloading: false,
  blazePrimaryReloadStart: 0,
  blazePrimaryReloadEnd: 0,
  bombs: [],
  phosphorFlares: [],
  bombTargeting: false,
  bombTargetValid: false,
  flamethrowerActive: false,
  flamethrowerFuel: 100,
  chronosPulses: [],
  chronosPrimaryAmmo: CHRONOS_PRIMARY_MAGAZINE_SIZE,
  chronosPrimaryReloading: false,
  chronosPrimaryReloadStart: 0,
  chronosPrimaryReloadEnd: 0,
  hookProjectiles: [],
  dragHooks: [],
  hookshotGroundHooks: [],
  grappleLines: [],
  earthWalls: [],
};

// ============================================================================
// SLICE CREATOR
// ============================================================================

const PROJECTILE_LIMITS = {
  voidZones: 24,
  direBalls: 96,
  voidRays: 32,
  rockets: 96,
  bombs: 32,
  phosphorFlares: 32,
  chronosPulses: 96,
  hookProjectiles: 64,
  dragHooks: 32,
  hookshotGroundHooks: 24,
  grappleLines: 48,
  earthWalls: 48,
} as const;

const VOID_RAY_VISUAL_RETENTION_MS = 1200;
const DIRE_BALL_VISUAL_LIFETIME_MS = 3000;
const ROCKET_VISUAL_LIFETIME_MS = 3000;
const BOMB_VISUAL_FALLBACK_LIFETIME_MS = 5000;
const CHRONOS_PULSE_VISUAL_LIFETIME_MS = 3000;
const HOOK_PROJECTILE_VISUAL_LIFETIME_MS = 2000;
const DRAG_HOOK_VISUAL_LIFETIME_MS = 5000;
const GRAPPLE_LINE_VISUAL_LIFETIME_MS = 6000;
const EARTH_WALL_COLLAPSE_RETENTION_MS = 1500;

function getVoidZoneExpiresAt(zone: VoidZoneData): number {
  return zone.startTime + zone.duration * 1000;
}

function getDireBallExpiresAt(ball: DireBallData): number {
  return ball.startTime + DIRE_BALL_VISUAL_LIFETIME_MS;
}

function getVoidRayExpiresAt(ray: VoidRayData): number {
  return ray.startTime + VOID_RAY_VISUAL_RETENTION_MS;
}

function getRocketExpiresAt(rocket: RocketData): number {
  return rocket.startTime + ROCKET_VISUAL_LIFETIME_MS;
}

function getBombExpiresAt(bomb: BombData): number {
  return bomb.startTime + BOMB_VISUAL_FALLBACK_LIFETIME_MS;
}

function getPhosphorFlareExpiresAt(flare: PhosphorFlareData): number {
  return flare.poolEndsAt + 750;
}

function getChronosPulseExpiresAt(pulse: ChronosPulseData): number {
  return pulse.startTime + CHRONOS_PULSE_VISUAL_LIFETIME_MS;
}

function getHookProjectileExpiresAt(hook: HookProjectileData): number {
  return hook.startTime + HOOK_PROJECTILE_VISUAL_LIFETIME_MS;
}

function getDragHookExpiresAt(hook: DragHookData): number {
  return hook.startTime + DRAG_HOOK_VISUAL_LIFETIME_MS;
}

function getHookshotGroundHooksExpiresAt(effect: HookshotGroundHooksData): number {
  return effect.startTime + effect.duration * 1000 + 500;
}

function getGrappleLineExpiresAt(line: GrappleLineData): number {
  return line.startTime + GRAPPLE_LINE_VISUAL_LIFETIME_MS;
}

function getEarthWallExpiresAt(wall: EarthWallData): number {
  return wall.startTime + wall.duration * 1000 + EARTH_WALL_COLLAPSE_RETENTION_MS;
}

const projectileIdIndexCache = new WeakMap<readonly { id: string }[], Map<string, number>>();

function getIdIndexMap<T extends { id: string }>(items: readonly T[]): Map<string, number> {
  const cached = projectileIdIndexCache.get(items);
  if (cached) return cached;

  const indexById = new Map<string, number>();
  for (let index = 0; index < items.length; index++) {
    indexById.set(items[index].id, index);
  }
  projectileIdIndexCache.set(items, indexById);
  return indexById;
}

function hasId<T extends { id: string }>(items: readonly T[], id: string): boolean {
  return getIdIndexMap(items).has(id);
}

function appendUnique<T extends { id: string }>(items: T[], item: T, limit: number): T[] {
  if (hasId(items, item.id)) return items;

  if (items.length >= limit) {
    const next = items.slice(items.length - limit + 1);
    next.push(item);
    return next;
  }

  const next = items.slice();
  next.push(item);
  return next;
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  const index = findIdIndex(items, id);
  if (index < 0) return items;

  const next = items.slice();
  next.splice(index, 1);
  return next;
}

function removeByIds<T extends { id: string }>(items: T[], ids: readonly string[]): T[] {
  if (ids.length === 0) return items;

  const idSet = ids.length > 4 ? new Set(ids) : null;
  let next: T[] | null = null;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const remove = idSet ? idSet.has(item.id) : ids.includes(item.id);
    if (remove) {
      if (!next) next = items.slice(0, index);
      continue;
    }

    if (next) next.push(item);
  }

  return next ?? items;
}

function updateById<T extends { id: string }>(items: T[], id: string, updates: Partial<T>): T[] {
  const index = findIdIndex(items, id);
  if (index < 0) return items;

  const current = items[index];
  let changed = false;
  for (const rawKey in updates) {
    if (!Object.prototype.hasOwnProperty.call(updates, rawKey)) continue;
    const key = rawKey as keyof T;
    if (current[key] !== updates[key]) {
      changed = true;
      break;
    }
  }
  if (!changed) return items;

  const next = items.slice();
  next[index] = { ...current, ...updates };
  return next;
}

function findIdIndex<T extends { id: string }>(items: T[], id: string): number {
  return getIdIndexMap(items).get(id) ?? -1;
}

function filterExpiredByExpiry<T>(items: T[], expiresAt: (item: T) => number): T[] {
  return filterExpiredByExpiryAt(items, Date.now(), expiresAt);
}

function filterExpiredByExpiryAt<T>(items: T[], now: number, expiresAt: (item: T) => number): T[] {
  if (items.length === 0) return items;

  // Projectile arrays append in event order, so the oldest entry tells us when a category needs a real scan.
  if (expiresAt(items[0]) > now) return items;

  return filterExpiredAt(items, now, (item) => expiresAt(item) > now);
}

function filterExpiredAt<T>(items: T[], now: number, keep: (item: T, now: number) => boolean): T[] {
  let firstExpiredIndex = -1;
  for (let index = 0; index < items.length; index++) {
    if (!keep(items[index], now)) {
      firstExpiredIndex = index;
      break;
    }
  }
  if (firstExpiredIndex < 0) return items;

  const next = items.slice(0, firstExpiredIndex);
  for (let index = firstExpiredIndex + 1; index < items.length; index++) {
    if (keep(items[index], now)) next.push(items[index]);
  }
  return next;
}

export const createProjectileSlice: StateCreator<
  ProjectileSlice,
  [],
  [],
  ProjectileSlice
> = (set) => ({
  ...projectileInitialState,

  // ==================== VOID ZONES ====================
  addVoidZone: (zone) => set((state) => {
    const voidZones = appendUnique(state.voidZones, zone, PROJECTILE_LIMITS.voidZones);
    return voidZones === state.voidZones ? state : { voidZones };
  }),

  removeVoidZone: (id) => set((state) => {
    const voidZones = removeById(state.voidZones, id);
    return voidZones === state.voidZones ? state : { voidZones };
  }),

  clearExpiredVoidZones: () => set((state) => {
    const voidZones = filterExpiredByExpiry(state.voidZones, getVoidZoneExpiresAt);
    return voidZones === state.voidZones ? state : { voidZones };
  }),

  // ==================== DIRE BALLS ====================
  addDireBall: (ball) => set((state) => {
    const direBalls = appendUnique(state.direBalls, ball, PROJECTILE_LIMITS.direBalls);
    return direBalls === state.direBalls ? state : { direBalls };
  }),

  removeDireBall: (id) => set((state) => {
    const direBalls = removeById(state.direBalls, id);
    return direBalls === state.direBalls ? state : { direBalls };
  }),

  removeDireBalls: (ids) => set((state) => {
    const direBalls = removeByIds(state.direBalls, ids);
    return direBalls === state.direBalls ? state : { direBalls };
  }),

  clearExpiredDireBalls: () => set((state) => {
    const direBalls = filterExpiredByExpiry(state.direBalls, getDireBallExpiresAt);
    return direBalls === state.direBalls ? state : { direBalls };
  }),

  setPhantomPrimaryAmmo: (ammo) => set((state) => {
    const nextAmmo = Math.max(0, Math.min(PHANTOM_PRIMARY_MAGAZINE_SIZE, ammo));
    return state.phantomPrimaryAmmo === nextAmmo ? state : { phantomPrimaryAmmo: nextAmmo };
  }),

  setPhantomPrimaryReload: (reloading, startTime = 0, endTime = startTime + PHANTOM_PRIMARY_RELOAD_MS) => set((state) => {
    if (
      state.phantomPrimaryReloading === reloading &&
      state.phantomPrimaryReloadStart === startTime &&
      state.phantomPrimaryReloadEnd === endTime
    ) {
      return state;
    }

    return {
      phantomPrimaryReloading: reloading,
      phantomPrimaryReloadStart: reloading ? startTime : 0,
      phantomPrimaryReloadEnd: reloading ? endTime : 0,
    };
  }),

  resetPhantomPrimaryMagazine: () => set((state) => {
    if (
      state.phantomPrimaryAmmo === PHANTOM_PRIMARY_MAGAZINE_SIZE &&
      !state.phantomPrimaryReloading &&
      state.phantomPrimaryReloadStart === 0 &&
      state.phantomPrimaryReloadEnd === 0
    ) {
      return state;
    }

    return {
      phantomPrimaryAmmo: PHANTOM_PRIMARY_MAGAZINE_SIZE,
      phantomPrimaryReloading: false,
      phantomPrimaryReloadStart: 0,
      phantomPrimaryReloadEnd: 0,
    };
  }),

  // ==================== VOID RAYS ====================
  addVoidRay: (ray) => set((state) => {
    const voidRays = appendUnique(state.voidRays, ray, PROJECTILE_LIMITS.voidRays);
    return voidRays === state.voidRays ? state : { voidRays };
  }),

  removeVoidRay: (id) => set((state) => {
    const voidRays = removeById(state.voidRays, id);
    return voidRays === state.voidRays ? state : { voidRays };
  }),

  clearExpiredVoidRays: () => set((state) => {
    const voidRays = filterExpiredByExpiry(state.voidRays, getVoidRayExpiresAt);
    return voidRays === state.voidRays ? state : { voidRays };
  }),

  setVoidRayCharging: (charging, startTime = 0) => set((state) => {
    if (state.voidRayCharging === charging && state.voidRayChargeStart === startTime) return state;
    return {
      voidRayCharging: charging,
      voidRayChargeStart: startTime,
    };
  }),

  // ==================== ROCKETS ====================
  addRocket: (rocket) => set((state) => {
    const rockets = appendUnique(state.rockets, rocket, PROJECTILE_LIMITS.rockets);
    return rockets === state.rockets ? state : { rockets };
  }),

  removeRocket: (id) => set((state) => {
    const rockets = removeById(state.rockets, id);
    return rockets === state.rockets ? state : { rockets };
  }),

  removeRockets: (ids) => set((state) => {
    const rockets = removeByIds(state.rockets, ids);
    return rockets === state.rockets ? state : { rockets };
  }),

  clearExpiredRockets: () => set((state) => {
    const rockets = filterExpiredByExpiry(state.rockets, getRocketExpiresAt);
    return rockets === state.rockets ? state : { rockets };
  }),

  setBlazePrimaryAmmo: (ammo) => set((state) => {
    const nextAmmo = Math.max(0, Math.min(BLAZE_PRIMARY_MAGAZINE_SIZE, ammo));
    return state.blazePrimaryAmmo === nextAmmo ? state : { blazePrimaryAmmo: nextAmmo };
  }),

  setBlazePrimaryReload: (reloading, startTime = 0, endTime = startTime + BLAZE_PRIMARY_RELOAD_MS) => set((state) => {
    if (
      state.blazePrimaryReloading === reloading &&
      state.blazePrimaryReloadStart === startTime &&
      state.blazePrimaryReloadEnd === endTime
    ) {
      return state;
    }

    return {
      blazePrimaryReloading: reloading,
      blazePrimaryReloadStart: reloading ? startTime : 0,
      blazePrimaryReloadEnd: reloading ? endTime : 0,
    };
  }),

  resetBlazePrimaryMagazine: (magazineSize = BLAZE_PRIMARY_MAGAZINE_SIZE) => set((state) => {
    const nextMagazineSize = Math.max(1, Math.min(BLAZE_PRIMARY_MAGAZINE_SIZE, Math.floor(magazineSize)));
    if (
      state.blazePrimaryAmmo === nextMagazineSize &&
      !state.blazePrimaryReloading &&
      state.blazePrimaryReloadStart === 0 &&
      state.blazePrimaryReloadEnd === 0
    ) {
      return state;
    }

    return {
      blazePrimaryAmmo: nextMagazineSize,
      blazePrimaryReloading: false,
      blazePrimaryReloadStart: 0,
      blazePrimaryReloadEnd: 0,
    };
  }),

  // ==================== BOMBS ====================
  addBomb: (bomb) => set((state) => {
    const bombs = appendUnique(state.bombs, bomb, PROJECTILE_LIMITS.bombs);
    return bombs === state.bombs ? state : { bombs };
  }),

  removeBomb: (id) => set((state) => {
    const bombs = removeById(state.bombs, id);
    return bombs === state.bombs ? state : { bombs };
  }),

  clearExpiredBombs: () => set((state) => {
    const bombs = filterExpiredByExpiry(state.bombs, getBombExpiresAt);
    return bombs === state.bombs ? state : { bombs };
  }),

  setBombTargeting: (targeting, valid = false) => set((state) => {
    if (state.bombTargeting === targeting && state.bombTargetValid === valid) return state;
    return {
      bombTargeting: targeting,
      bombTargetValid: valid,
    };
  }),

  // ==================== PHOSPHOR FLARES ====================
  addPhosphorFlare: (flare) => set((state) => {
    const phosphorFlares = appendUnique(state.phosphorFlares, flare, PROJECTILE_LIMITS.phosphorFlares);
    return phosphorFlares === state.phosphorFlares ? state : { phosphorFlares };
  }),

  removePhosphorFlare: (id) => set((state) => {
    const phosphorFlares = removeById(state.phosphorFlares, id);
    return phosphorFlares === state.phosphorFlares ? state : { phosphorFlares };
  }),

  clearExpiredPhosphorFlares: () => set((state) => {
    const phosphorFlares = filterExpiredByExpiry(state.phosphorFlares, getPhosphorFlareExpiresAt);
    return phosphorFlares === state.phosphorFlares ? state : { phosphorFlares };
  }),

  // ==================== FLAMETHROWER ====================
  setFlamethrowerActive: (active) => set((state) => (
    state.flamethrowerActive === active ? state : { flamethrowerActive: active }
  )),
  setFlamethrowerFuel: (fuel) => set((state) => {
    const nextFuel = Math.max(0, Math.min(100, fuel));
    return state.flamethrowerFuel === nextFuel ? state : { flamethrowerFuel: nextFuel };
  }),

  // ==================== CHRONOS PULSES ====================
  addChronosPulse: (pulse) => set((state) => {
    const chronosPulses = appendUnique(state.chronosPulses, pulse, PROJECTILE_LIMITS.chronosPulses);
    return chronosPulses === state.chronosPulses ? state : { chronosPulses };
  }),

  removeChronosPulse: (id) => set((state) => {
    const chronosPulses = removeById(state.chronosPulses, id);
    return chronosPulses === state.chronosPulses ? state : { chronosPulses };
  }),

  removeChronosPulses: (ids) => set((state) => {
    const chronosPulses = removeByIds(state.chronosPulses, ids);
    return chronosPulses === state.chronosPulses ? state : { chronosPulses };
  }),

  clearExpiredChronosPulses: () => set((state) => {
    const chronosPulses = filterExpiredByExpiry(state.chronosPulses, getChronosPulseExpiresAt);
    return chronosPulses === state.chronosPulses ? state : { chronosPulses };
  }),

  setChronosPrimaryAmmo: (ammo) => set((state) => {
    const nextAmmo = Math.max(0, Math.min(CHRONOS_PRIMARY_MAGAZINE_SIZE, ammo));
    return state.chronosPrimaryAmmo === nextAmmo ? state : { chronosPrimaryAmmo: nextAmmo };
  }),

  setChronosPrimaryReload: (reloading, startTime = 0, endTime = startTime + CHRONOS_PRIMARY_RELOAD_MS) => set((state) => {
    if (
      state.chronosPrimaryReloading === reloading &&
      state.chronosPrimaryReloadStart === startTime &&
      state.chronosPrimaryReloadEnd === endTime
    ) {
      return state;
    }

    return {
      chronosPrimaryReloading: reloading,
      chronosPrimaryReloadStart: reloading ? startTime : 0,
      chronosPrimaryReloadEnd: reloading ? endTime : 0,
    };
  }),

  resetChronosPrimaryMagazine: () => set((state) => {
    if (
      state.chronosPrimaryAmmo === CHRONOS_PRIMARY_MAGAZINE_SIZE &&
      !state.chronosPrimaryReloading &&
      state.chronosPrimaryReloadStart === 0 &&
      state.chronosPrimaryReloadEnd === 0
    ) {
      return state;
    }

    return {
      chronosPrimaryAmmo: CHRONOS_PRIMARY_MAGAZINE_SIZE,
      chronosPrimaryReloading: false,
      chronosPrimaryReloadStart: 0,
      chronosPrimaryReloadEnd: 0,
    };
  }),

  // ==================== HOOK PROJECTILES ====================
  addHookProjectile: (hook) => set((state) => {
    const hookProjectiles = appendUnique(state.hookProjectiles, hook, PROJECTILE_LIMITS.hookProjectiles);
    return hookProjectiles === state.hookProjectiles ? state : { hookProjectiles };
  }),

  updateHookProjectile: (id, updates) => set((state) => {
    const hookProjectiles = updateById(state.hookProjectiles, id, updates);
    return hookProjectiles === state.hookProjectiles ? state : { hookProjectiles };
  }),

  removeHookProjectile: (id) => set((state) => {
    const hookProjectiles = removeById(state.hookProjectiles, id);
    return hookProjectiles === state.hookProjectiles ? state : { hookProjectiles };
  }),

  clearExpiredHookProjectiles: () => set((state) => {
    const hookProjectiles = filterExpiredByExpiry(state.hookProjectiles, getHookProjectileExpiresAt);
    return hookProjectiles === state.hookProjectiles ? state : { hookProjectiles };
  }),

  // ==================== DRAG HOOKS ====================
  addDragHook: (hook) => set((state) => {
    const dragHooks = appendUnique(state.dragHooks, hook, PROJECTILE_LIMITS.dragHooks);
    return dragHooks === state.dragHooks ? state : { dragHooks };
  }),

  updateDragHook: (id, updates) => set((state) => {
    const dragHooks = updateById(state.dragHooks, id, updates);
    return dragHooks === state.dragHooks ? state : { dragHooks };
  }),

  removeDragHook: (id) => set((state) => {
    const dragHooks = removeById(state.dragHooks, id);
    return dragHooks === state.dragHooks ? state : { dragHooks };
  }),

  clearExpiredDragHooks: () => set((state) => {
    const dragHooks = filterExpiredByExpiry(state.dragHooks, getDragHookExpiresAt);
    return dragHooks === state.dragHooks ? state : { dragHooks };
  }),

  // ==================== GROUND HOOK ROOTS ====================
  addHookshotGroundHooks: (effect) => set((state) => {
    const hookshotGroundHooks = appendUnique(state.hookshotGroundHooks, effect, PROJECTILE_LIMITS.hookshotGroundHooks);
    return hookshotGroundHooks === state.hookshotGroundHooks ? state : { hookshotGroundHooks };
  }),

  updateHookshotGroundHooks: (id, updates) => set((state) => {
    const hookshotGroundHooks = updateById(state.hookshotGroundHooks, id, updates);
    return hookshotGroundHooks === state.hookshotGroundHooks ? state : { hookshotGroundHooks };
  }),

  removeHookshotGroundHooks: (id) => set((state) => {
    const hookshotGroundHooks = removeById(state.hookshotGroundHooks, id);
    return hookshotGroundHooks === state.hookshotGroundHooks ? state : { hookshotGroundHooks };
  }),

  clearExpiredHookshotGroundHooks: () => set((state) => {
    const hookshotGroundHooks = filterExpiredByExpiry(state.hookshotGroundHooks, getHookshotGroundHooksExpiresAt);
    return hookshotGroundHooks === state.hookshotGroundHooks ? state : { hookshotGroundHooks };
  }),

  // ==================== GRAPPLE LINES ====================
  addGrappleLine: (line) => set((state) => {
    const grappleLines = appendUnique(state.grappleLines, line, PROJECTILE_LIMITS.grappleLines);
    return grappleLines === state.grappleLines ? state : { grappleLines };
  }),

  updateGrappleLine: (id, updates) => set((state) => {
    const grappleLines = updateById(state.grappleLines, id, updates);
    return grappleLines === state.grappleLines ? state : { grappleLines };
  }),

  removeGrappleLine: (id) => set((state) => {
    const grappleLines = removeById(state.grappleLines, id);
    return grappleLines === state.grappleLines ? state : { grappleLines };
  }),

  clearExpiredGrappleLines: () => set((state) => {
    const grappleLines = filterExpiredByExpiry(state.grappleLines, getGrappleLineExpiresAt);
    return grappleLines === state.grappleLines ? state : { grappleLines };
  }),

  // ==================== EARTH WALLS ====================
  addEarthWall: (wall) => set((state) => {
    const earthWalls = appendUnique(state.earthWalls, wall, PROJECTILE_LIMITS.earthWalls);
    return earthWalls === state.earthWalls ? state : { earthWalls };
  }),

  updateEarthWall: (id, updates) => set((state) => {
    const earthWalls = updateById(state.earthWalls, id, updates);
    return earthWalls === state.earthWalls ? state : { earthWalls };
  }),

  removeEarthWall: (id) => set((state) => {
    const earthWalls = removeById(state.earthWalls, id);
    return earthWalls === state.earthWalls ? state : { earthWalls };
  }),

  clearExpiredEarthWalls: () => set((state) => {
    const earthWalls = filterExpiredByExpiry(state.earthWalls, getEarthWallExpiresAt);
    return earthWalls === state.earthWalls ? state : { earthWalls };
  }),

  clearExpiredProjectiles: () => set((state) => {
    const now = Date.now();
    let next: Partial<ProjectileState> | null = null;

    const voidZones = filterExpiredByExpiryAt(state.voidZones, now, getVoidZoneExpiresAt);
    if (voidZones !== state.voidZones) {
      next ??= {};
      next.voidZones = voidZones;
    }

    const direBalls = filterExpiredByExpiryAt(state.direBalls, now, getDireBallExpiresAt);
    if (direBalls !== state.direBalls) {
      next ??= {};
      next.direBalls = direBalls;
    }

    const voidRays = filterExpiredByExpiryAt(state.voidRays, now, getVoidRayExpiresAt);
    if (voidRays !== state.voidRays) {
      next ??= {};
      next.voidRays = voidRays;
    }

    const rockets = filterExpiredByExpiryAt(state.rockets, now, getRocketExpiresAt);
    if (rockets !== state.rockets) {
      next ??= {};
      next.rockets = rockets;
    }

    const bombs = filterExpiredByExpiryAt(state.bombs, now, getBombExpiresAt);
    if (bombs !== state.bombs) {
      next ??= {};
      next.bombs = bombs;
    }

    const phosphorFlares = filterExpiredByExpiryAt(state.phosphorFlares, now, getPhosphorFlareExpiresAt);
    if (phosphorFlares !== state.phosphorFlares) {
      next ??= {};
      next.phosphorFlares = phosphorFlares;
    }

    const chronosPulses = filterExpiredByExpiryAt(state.chronosPulses, now, getChronosPulseExpiresAt);
    if (chronosPulses !== state.chronosPulses) {
      next ??= {};
      next.chronosPulses = chronosPulses;
    }

    const hookProjectiles = filterExpiredByExpiryAt(state.hookProjectiles, now, getHookProjectileExpiresAt);
    if (hookProjectiles !== state.hookProjectiles) {
      next ??= {};
      next.hookProjectiles = hookProjectiles;
    }

    const dragHooks = filterExpiredByExpiryAt(state.dragHooks, now, getDragHookExpiresAt);
    if (dragHooks !== state.dragHooks) {
      next ??= {};
      next.dragHooks = dragHooks;
    }

    const hookshotGroundHooks = filterExpiredByExpiryAt(state.hookshotGroundHooks, now, getHookshotGroundHooksExpiresAt);
    if (hookshotGroundHooks !== state.hookshotGroundHooks) {
      next ??= {};
      next.hookshotGroundHooks = hookshotGroundHooks;
    }

    const grappleLines = filterExpiredByExpiryAt(state.grappleLines, now, getGrappleLineExpiresAt);
    if (grappleLines !== state.grappleLines) {
      next ??= {};
      next.grappleLines = grappleLines;
    }

    const earthWalls = filterExpiredByExpiryAt(state.earthWalls, now, getEarthWallExpiresAt);
    if (earthWalls !== state.earthWalls) {
      next ??= {};
      next.earthWalls = earthWalls;
    }

    return next ?? state;
  }),
});
