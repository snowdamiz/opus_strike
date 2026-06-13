import type { StateCreator } from 'zustand';
import {
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
} from '@voxel-strike/shared';
import type {
  VoidZoneData,
  DireBallData,
  VoidRayData,
  RocketData,
  BombData,
  ChronosPulseData,
  HookProjectileData,
  DragHookData,
  GrappleTrapData,
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
  bombs: BombData[];
  bombTargeting: boolean;
  bombTargetValid: boolean;
  airStrikeTargeting: boolean;
  airStrikeTargetValid: boolean;
  flamethrowerActive: boolean;
  flamethrowerFuel: number;
  flamethrowerOrigin: { x: number; y: number; z: number } | null;
  flamethrowerDirection: { x: number; y: number; z: number };

  // Chronos projectiles
  chronosPulses: ChronosPulseData[];

  // Hookshot projectiles
  hookProjectiles: HookProjectileData[];
  dragHooks: DragHookData[];
  grappleTraps: GrappleTrapData[];
  grappleLines: GrappleLineData[];
  earthWalls: EarthWallData[];
  grappleTrapTargeting: boolean;
  grappleTrapTargetValid: boolean;
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

  // Blaze bomb actions
  addBomb: (bomb: BombData) => void;
  removeBomb: (id: string) => void;
  clearExpiredBombs: () => void;
  setBombTargeting: (targeting: boolean, valid?: boolean) => void;

  // Blaze ultimate targeting actions
  setAirStrikeTargeting: (targeting: boolean, valid?: boolean) => void;

  // Blaze flamethrower actions
  setFlamethrowerActive: (active: boolean) => void;
  setFlamethrowerFuel: (fuel: number) => void;
  setFlamethrowerPose: (
    origin: { x: number; y: number; z: number },
    direction: { x: number; y: number; z: number }
  ) => void;

  // Chronos pulse actions
  addChronosPulse: (pulse: ChronosPulseData) => void;
  removeChronosPulse: (id: string) => void;
  removeChronosPulses: (ids: readonly string[]) => void;
  clearExpiredChronosPulses: () => void;

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

  // Grapple trap actions
  addGrappleTrap: (trap: GrappleTrapData) => void;
  updateGrappleTrap: (id: string, updates: Partial<GrappleTrapData>) => void;
  removeGrappleTrap: (id: string) => void;
  clearExpiredGrappleTraps: () => void;
  setGrappleTrapTargeting: (targeting: boolean, valid?: boolean) => void;

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
  bombs: [],
  bombTargeting: false,
  bombTargetValid: false,
  airStrikeTargeting: false,
  airStrikeTargetValid: false,
  flamethrowerActive: false,
  flamethrowerFuel: 100,
  flamethrowerOrigin: null,
  flamethrowerDirection: { x: 0, y: 0, z: -1 },
  chronosPulses: [],
  hookProjectiles: [],
  dragHooks: [],
  grappleTraps: [],
  grappleLines: [],
  earthWalls: [],
  grappleTrapTargeting: false,
  grappleTrapTargetValid: false,
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
  chronosPulses: 96,
  hookProjectiles: 64,
  dragHooks: 32,
  grappleTraps: 32,
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

function appendUnique<T extends { id: string }>(items: T[], item: T, limit: number): T[] {
  for (const existing of items) {
    if (existing.id === item.id) return items;
  }

  if (items.length >= limit) {
    return [...items.slice(items.length - limit + 1), item];
  }

  return [...items, item];
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;

  const next = items.slice();
  next.splice(index, 1);
  return next;
}

function removeByIds<T extends { id: string }>(items: T[], ids: readonly string[]): T[] {
  if (ids.length === 0) return items;

  let changed = false;
  for (const item of items) {
    if (ids.includes(item.id)) {
      changed = true;
      break;
    }
  }
  if (!changed) return items;

  const idSet = ids.length > 4 ? new Set(ids) : null;
  const next: T[] = [];
  for (const item of items) {
    const remove = idSet ? idSet.has(item.id) : ids.includes(item.id);
    if (!remove) next.push(item);
  }
  return next;
}

function updateById<T extends { id: string }>(items: T[], id: string, updates: Partial<T>): T[] {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return items;

  const next = items.slice();
  next[index] = { ...items[index], ...updates };
  return next;
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

function sameVec3(
  a: { x: number; y: number; z: number } | null,
  b: { x: number; y: number; z: number } | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.z === b.z;
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
    const voidZones = filterExpiredByExpiry(state.voidZones, (z) => z.startTime + z.duration * 1000);
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
    const direBalls = filterExpiredByExpiry(
      state.direBalls,
      (b) => b.startTime + DIRE_BALL_VISUAL_LIFETIME_MS
    );
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
    const voidRays = filterExpiredByExpiry(
      state.voidRays,
      (r) => r.startTime + VOID_RAY_VISUAL_RETENTION_MS
    );
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
    const rockets = filterExpiredByExpiry(
      state.rockets,
      (r) => r.startTime + ROCKET_VISUAL_LIFETIME_MS
    );
    return rockets === state.rockets ? state : { rockets };
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
    const bombs = filterExpiredByExpiry(
      state.bombs,
      (b) => b.startTime + BOMB_VISUAL_FALLBACK_LIFETIME_MS
    );
    return bombs === state.bombs ? state : { bombs };
  }),

  setBombTargeting: (targeting, valid = false) => set((state) => {
    if (state.bombTargeting === targeting && state.bombTargetValid === valid) return state;
    return {
      bombTargeting: targeting,
      bombTargetValid: valid,
    };
  }),

  // ==================== AIR STRIKE ====================
  setAirStrikeTargeting: (targeting, valid = false) => set((state) => {
    if (state.airStrikeTargeting === targeting && state.airStrikeTargetValid === valid) return state;
    return {
      airStrikeTargeting: targeting,
      airStrikeTargetValid: valid,
    };
  }),

  // ==================== FLAMETHROWER ====================
  setFlamethrowerActive: (active) => set((state) => (
    state.flamethrowerActive === active ? state : { flamethrowerActive: active }
  )),
  setFlamethrowerFuel: (fuel) => set((state) => {
    const nextFuel = Math.max(0, Math.min(100, fuel));
    return state.flamethrowerFuel === nextFuel ? state : { flamethrowerFuel: nextFuel };
  }),
  setFlamethrowerPose: (origin, direction) => set((state) => {
    if (sameVec3(state.flamethrowerOrigin, origin) && sameVec3(state.flamethrowerDirection, direction)) {
      return state;
    }
    return {
      flamethrowerOrigin: { ...origin },
      flamethrowerDirection: { ...direction },
    };
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
    const chronosPulses = filterExpiredByExpiry(
      state.chronosPulses,
      (pulse) => pulse.startTime + CHRONOS_PULSE_VISUAL_LIFETIME_MS
    );
    return chronosPulses === state.chronosPulses ? state : { chronosPulses };
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
    const hookProjectiles = filterExpiredByExpiry(
      state.hookProjectiles,
      (h) => h.startTime + HOOK_PROJECTILE_VISUAL_LIFETIME_MS
    );
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
    const dragHooks = filterExpiredByExpiry(
      state.dragHooks,
      (h) => h.startTime + DRAG_HOOK_VISUAL_LIFETIME_MS
    );
    return dragHooks === state.dragHooks ? state : { dragHooks };
  }),

  // ==================== GRAPPLE TRAPS ====================
  addGrappleTrap: (trap) => set((state) => {
    const grappleTraps = appendUnique(state.grappleTraps, trap, PROJECTILE_LIMITS.grappleTraps);
    return grappleTraps === state.grappleTraps ? state : { grappleTraps };
  }),

  updateGrappleTrap: (id, updates) => set((state) => {
    const grappleTraps = updateById(state.grappleTraps, id, updates);
    return grappleTraps === state.grappleTraps ? state : { grappleTraps };
  }),

  removeGrappleTrap: (id) => set((state) => {
    const grappleTraps = removeById(state.grappleTraps, id);
    return grappleTraps === state.grappleTraps ? state : { grappleTraps };
  }),

  clearExpiredGrappleTraps: () => set((state) => {
    const grappleTraps = filterExpiredByExpiry(
      state.grappleTraps,
      (t) => t.startTime + t.duration * 1000
    );
    return grappleTraps === state.grappleTraps ? state : { grappleTraps };
  }),

  setGrappleTrapTargeting: (targeting, valid = false) => set((state) => {
    if (state.grappleTrapTargeting === targeting && state.grappleTrapTargetValid === valid) return state;
    return {
      grappleTrapTargeting: targeting,
      grappleTrapTargetValid: valid,
    };
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
    const grappleLines = filterExpiredByExpiry(
      state.grappleLines,
      (l) => l.startTime + GRAPPLE_LINE_VISUAL_LIFETIME_MS
    );
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
    const earthWalls = filterExpiredByExpiry(
      state.earthWalls,
      (w) => w.startTime + w.duration * 1000 + EARTH_WALL_COLLAPSE_RETENTION_MS
    );
    return earthWalls === state.earthWalls ? state : { earthWalls };
  }),

  clearExpiredProjectiles: () => set((state) => {
    const now = Date.now();
    let changed = false;
    const next: Partial<ProjectileState> = {};

    const voidZones = filterExpiredByExpiryAt(
      state.voidZones,
      now,
      (z) => z.startTime + z.duration * 1000
    );
    if (voidZones !== state.voidZones) {
      next.voidZones = voidZones;
      changed = true;
    }

    const direBalls = filterExpiredByExpiryAt(
      state.direBalls,
      now,
      (b) => b.startTime + DIRE_BALL_VISUAL_LIFETIME_MS
    );
    if (direBalls !== state.direBalls) {
      next.direBalls = direBalls;
      changed = true;
    }

    const voidRays = filterExpiredByExpiryAt(
      state.voidRays,
      now,
      (r) => r.startTime + VOID_RAY_VISUAL_RETENTION_MS
    );
    if (voidRays !== state.voidRays) {
      next.voidRays = voidRays;
      changed = true;
    }

    const rockets = filterExpiredByExpiryAt(
      state.rockets,
      now,
      (r) => r.startTime + ROCKET_VISUAL_LIFETIME_MS
    );
    if (rockets !== state.rockets) {
      next.rockets = rockets;
      changed = true;
    }

    const bombs = filterExpiredByExpiryAt(
      state.bombs,
      now,
      (b) => b.startTime + BOMB_VISUAL_FALLBACK_LIFETIME_MS
    );
    if (bombs !== state.bombs) {
      next.bombs = bombs;
      changed = true;
    }

    const chronosPulses = filterExpiredByExpiryAt(
      state.chronosPulses,
      now,
      (pulse) => pulse.startTime + CHRONOS_PULSE_VISUAL_LIFETIME_MS
    );
    if (chronosPulses !== state.chronosPulses) {
      next.chronosPulses = chronosPulses;
      changed = true;
    }

    const hookProjectiles = filterExpiredByExpiryAt(
      state.hookProjectiles,
      now,
      (h) => h.startTime + HOOK_PROJECTILE_VISUAL_LIFETIME_MS
    );
    if (hookProjectiles !== state.hookProjectiles) {
      next.hookProjectiles = hookProjectiles;
      changed = true;
    }

    const dragHooks = filterExpiredByExpiryAt(
      state.dragHooks,
      now,
      (h) => h.startTime + DRAG_HOOK_VISUAL_LIFETIME_MS
    );
    if (dragHooks !== state.dragHooks) {
      next.dragHooks = dragHooks;
      changed = true;
    }

    const grappleTraps = filterExpiredByExpiryAt(
      state.grappleTraps,
      now,
      (t) => t.startTime + t.duration * 1000
    );
    if (grappleTraps !== state.grappleTraps) {
      next.grappleTraps = grappleTraps;
      changed = true;
    }

    const grappleLines = filterExpiredByExpiryAt(
      state.grappleLines,
      now,
      (l) => l.startTime + GRAPPLE_LINE_VISUAL_LIFETIME_MS
    );
    if (grappleLines !== state.grappleLines) {
      next.grappleLines = grappleLines;
      changed = true;
    }

    const earthWalls = filterExpiredByExpiryAt(
      state.earthWalls,
      now,
      (w) => w.startTime + w.duration * 1000 + EARTH_WALL_COLLAPSE_RETENTION_MS
    );
    if (earthWalls !== state.earthWalls) {
      next.earthWalls = earthWalls;
      changed = true;
    }

    return changed ? next : state;
  }),
});
