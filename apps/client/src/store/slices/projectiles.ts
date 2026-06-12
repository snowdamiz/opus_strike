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
  ChronosTimebreakData,
  HookProjectileData,
  DragHookData,
  GrappleTrapData,
  SwingLineData,
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
  chronosTimebreaks: ChronosTimebreakData[];

  // Hookshot projectiles
  hookProjectiles: HookProjectileData[];
  dragHooks: DragHookData[];
  grappleTraps: GrappleTrapData[];
  swingLines: SwingLineData[];
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

  // Legacy Blaze ultimate targeting actions
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
  addChronosTimebreak: (timebreak: ChronosTimebreakData) => void;
  removeChronosTimebreak: (id: string) => void;
  clearExpiredChronosTimebreaks: () => void;

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

  // Swing line actions
  addSwingLine: (line: SwingLineData) => void;
  updateSwingLine: (id: string, updates: Partial<SwingLineData>) => void;
  removeSwingLine: (id: string) => void;
  clearExpiredSwingLines: () => void;

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
  chronosTimebreaks: [],
  hookProjectiles: [],
  dragHooks: [],
  grappleTraps: [],
  swingLines: [],
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
  chronosTimebreaks: 24,
  hookProjectiles: 64,
  dragHooks: 32,
  grappleTraps: 32,
  swingLines: 32,
  grappleLines: 48,
  earthWalls: 48,
} as const;

const VOID_RAY_VISUAL_RETENTION_MS = 1200;
const CHRONOS_TIMEBREAK_VISUAL_LIFETIME_MS = 1400;

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

function filterExpired<T>(items: T[], keep: (item: T, now: number) => boolean): T[] {
  return filterExpiredAt(items, Date.now(), keep);
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
    const voidZones = filterExpired(state.voidZones, (z, now) => (now - z.startTime) / 1000 < z.duration);
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
    const LIFETIME = 3000;
    const direBalls = filterExpired(state.direBalls, (b, now) => now - b.startTime < LIFETIME);
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
    const voidRays = filterExpired(state.voidRays, (r, now) => now - r.startTime < VOID_RAY_VISUAL_RETENTION_MS);
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
    const LIFETIME = 3000;
    const rockets = filterExpired(state.rockets, (r, now) => now - r.startTime < LIFETIME);
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
    const TOTAL_LIFETIME = 5000;
    const bombs = filterExpired(state.bombs, (b, now) => now - b.startTime < TOTAL_LIFETIME);
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
    const LIFETIME = 3000;
    const chronosPulses = filterExpired(state.chronosPulses, (pulse, now) => now - pulse.startTime < LIFETIME);
    return chronosPulses === state.chronosPulses ? state : { chronosPulses };
  }),

  addChronosTimebreak: (timebreak) => set((state) => {
    const chronosTimebreaks = appendUnique(
      state.chronosTimebreaks,
      timebreak,
      PROJECTILE_LIMITS.chronosTimebreaks
    );
    return chronosTimebreaks === state.chronosTimebreaks ? state : { chronosTimebreaks };
  }),

  removeChronosTimebreak: (id) => set((state) => {
    const chronosTimebreaks = removeById(state.chronosTimebreaks, id);
    return chronosTimebreaks === state.chronosTimebreaks ? state : { chronosTimebreaks };
  }),

  clearExpiredChronosTimebreaks: () => set((state) => {
    const chronosTimebreaks = filterExpired(
      state.chronosTimebreaks,
      (timebreak, now) => now - timebreak.releaseTime < CHRONOS_TIMEBREAK_VISUAL_LIFETIME_MS
    );
    return chronosTimebreaks === state.chronosTimebreaks ? state : { chronosTimebreaks };
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
    const LIFETIME = 2000;
    const hookProjectiles = filterExpired(state.hookProjectiles, (h, now) => now - h.startTime < LIFETIME);
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
    const LIFETIME = 5000;
    const dragHooks = filterExpired(state.dragHooks, (h, now) => now - h.startTime < LIFETIME);
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
    const grappleTraps = filterExpired(state.grappleTraps, (t, now) => (now - t.startTime) / 1000 < t.duration);
    return grappleTraps === state.grappleTraps ? state : { grappleTraps };
  }),

  setGrappleTrapTargeting: (targeting, valid = false) => set((state) => {
    if (state.grappleTrapTargeting === targeting && state.grappleTrapTargetValid === valid) return state;
    return {
      grappleTrapTargeting: targeting,
      grappleTrapTargetValid: valid,
    };
  }),

  // ==================== SWING LINES ====================
  addSwingLine: (line) => set((state) => {
    const swingLines = appendUnique(state.swingLines, line, PROJECTILE_LIMITS.swingLines);
    return swingLines === state.swingLines ? state : { swingLines };
  }),

  updateSwingLine: (id, updates) => set((state) => {
    const swingLines = updateById(state.swingLines, id, updates);
    return swingLines === state.swingLines ? state : { swingLines };
  }),

  removeSwingLine: (id) => set((state) => {
    const swingLines = removeById(state.swingLines, id);
    return swingLines === state.swingLines ? state : { swingLines };
  }),

  clearExpiredSwingLines: () => set((state) => {
    const swingLines = filterExpired(state.swingLines, (l, now) => (now - l.startTime) / 1000 < l.duration);
    return swingLines === state.swingLines ? state : { swingLines };
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
    const LIFETIME = 6000;
    const grappleLines = filterExpired(state.grappleLines, (l, now) => now - l.startTime < LIFETIME);
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
    const earthWalls = filterExpired(state.earthWalls, (w, now) => {
      const elapsed = (now - w.startTime) / 1000;
      return elapsed < w.duration + 1.5;
    });
    return earthWalls === state.earthWalls ? state : { earthWalls };
  }),

  clearExpiredProjectiles: () => set((state) => {
    const now = Date.now();
    let changed = false;
    const next: Partial<ProjectileState> = {};

    const voidZones = filterExpiredAt(state.voidZones, now, (z) => (now - z.startTime) / 1000 < z.duration);
    if (voidZones !== state.voidZones) {
      next.voidZones = voidZones;
      changed = true;
    }

    const direBalls = filterExpiredAt(state.direBalls, now, (b) => now - b.startTime < 3000);
    if (direBalls !== state.direBalls) {
      next.direBalls = direBalls;
      changed = true;
    }

    const voidRays = filterExpiredAt(state.voidRays, now, (r) => now - r.startTime < VOID_RAY_VISUAL_RETENTION_MS);
    if (voidRays !== state.voidRays) {
      next.voidRays = voidRays;
      changed = true;
    }

    const rockets = filterExpiredAt(state.rockets, now, (r) => now - r.startTime < 3000);
    if (rockets !== state.rockets) {
      next.rockets = rockets;
      changed = true;
    }

    const bombs = filterExpiredAt(state.bombs, now, (b) => now - b.startTime < 5000);
    if (bombs !== state.bombs) {
      next.bombs = bombs;
      changed = true;
    }

    const chronosPulses = filterExpiredAt(state.chronosPulses, now, (pulse) => now - pulse.startTime < 3000);
    if (chronosPulses !== state.chronosPulses) {
      next.chronosPulses = chronosPulses;
      changed = true;
    }

    const chronosTimebreaks = filterExpiredAt(
      state.chronosTimebreaks,
      now,
      (timebreak) => now - timebreak.releaseTime < CHRONOS_TIMEBREAK_VISUAL_LIFETIME_MS
    );
    if (chronosTimebreaks !== state.chronosTimebreaks) {
      next.chronosTimebreaks = chronosTimebreaks;
      changed = true;
    }

    const hookProjectiles = filterExpiredAt(state.hookProjectiles, now, (h) => now - h.startTime < 2000);
    if (hookProjectiles !== state.hookProjectiles) {
      next.hookProjectiles = hookProjectiles;
      changed = true;
    }

    const dragHooks = filterExpiredAt(state.dragHooks, now, (h) => now - h.startTime < 5000);
    if (dragHooks !== state.dragHooks) {
      next.dragHooks = dragHooks;
      changed = true;
    }

    const grappleTraps = filterExpiredAt(state.grappleTraps, now, (t) => (now - t.startTime) / 1000 < t.duration);
    if (grappleTraps !== state.grappleTraps) {
      next.grappleTraps = grappleTraps;
      changed = true;
    }

    const swingLines = filterExpiredAt(state.swingLines, now, (l) => (now - l.startTime) / 1000 < l.duration);
    if (swingLines !== state.swingLines) {
      next.swingLines = swingLines;
      changed = true;
    }

    const grappleLines = filterExpiredAt(state.grappleLines, now, (l) => now - l.startTime < 6000);
    if (grappleLines !== state.grappleLines) {
      next.grappleLines = grappleLines;
      changed = true;
    }

    const earthWalls = filterExpiredAt(state.earthWalls, now, (w) => {
      const elapsed = (now - w.startTime) / 1000;
      return elapsed < w.duration + 1.5;
    });
    if (earthWalls !== state.earthWalls) {
      next.earthWalls = earthWalls;
      changed = true;
    }

    return changed ? next : state;
  }),
});
