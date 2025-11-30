import type { StateCreator } from 'zustand';
import type {
  VoidZoneData,
  DireBallData,
  VoidRayData,
  RocketData,
  BombData,
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

  // Blaze projectiles
  rockets: RocketData[];
  bombs: BombData[];
  bombTargeting: boolean;
  bombTargetValid: boolean;
  airStrikeTargeting: boolean;
  airStrikeTargetValid: boolean;
  jetpackActive: boolean;
  jetpackFuel: number;

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
  clearExpiredDireBalls: () => void;

  // Void ray actions
  addVoidRay: (ray: VoidRayData) => void;
  removeVoidRay: (id: string) => void;
  clearExpiredVoidRays: () => void;
  setVoidRayCharging: (charging: boolean, startTime?: number) => void;

  // Blaze rocket actions
  addRocket: (rocket: RocketData) => void;
  removeRocket: (id: string) => void;
  clearExpiredRockets: () => void;

  // Blaze bomb actions
  addBomb: (bomb: BombData) => void;
  removeBomb: (id: string) => void;
  clearExpiredBombs: () => void;
  setBombTargeting: (targeting: boolean, valid?: boolean) => void;

  // Blaze air strike actions
  setAirStrikeTargeting: (targeting: boolean, valid?: boolean) => void;

  // Blaze jetpack actions
  setJetpackActive: (active: boolean) => void;
  setJetpackFuel: (fuel: number) => void;

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
  rockets: [],
  bombs: [],
  bombTargeting: false,
  bombTargetValid: false,
  airStrikeTargeting: false,
  airStrikeTargetValid: false,
  jetpackActive: false,
  jetpackFuel: 100,
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

export const createProjectileSlice: StateCreator<
  ProjectileSlice,
  [],
  [],
  ProjectileSlice
> = (set) => ({
  ...projectileInitialState,

  // ==================== VOID ZONES ====================
  addVoidZone: (zone) => set((state) => ({
    voidZones: [...state.voidZones, zone]
  })),

  removeVoidZone: (id) => set((state) => ({
    voidZones: state.voidZones.filter(z => z.id !== id)
  })),

  clearExpiredVoidZones: () => set((state) => {
    const now = Date.now();
    return {
      voidZones: state.voidZones.filter(z => (now - z.startTime) / 1000 < z.duration)
    };
  }),

  // ==================== DIRE BALLS ====================
  addDireBall: (ball) => set((state) => ({
    direBalls: [...state.direBalls, ball]
  })),

  removeDireBall: (id) => set((state) => ({
    direBalls: state.direBalls.filter(b => b.id !== id)
  })),

  clearExpiredDireBalls: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 3000;
    return {
      direBalls: state.direBalls.filter(b => now - b.startTime < LIFETIME)
    };
  }),

  // ==================== VOID RAYS ====================
  addVoidRay: (ray) => set((state) => ({
    voidRays: [...state.voidRays, ray]
  })),

  removeVoidRay: (id) => set((state) => ({
    voidRays: state.voidRays.filter(r => r.id !== id)
  })),

  clearExpiredVoidRays: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 500;
    return {
      voidRays: state.voidRays.filter(r => now - r.startTime < LIFETIME)
    };
  }),

  setVoidRayCharging: (charging, startTime = 0) => set({
    voidRayCharging: charging,
    voidRayChargeStart: startTime,
  }),

  // ==================== ROCKETS ====================
  addRocket: (rocket) => set((state) => {
    if (state.rockets.some(r => r.id === rocket.id)) return state;
    return { rockets: [...state.rockets, rocket] };
  }),

  removeRocket: (id) => set((state) => ({
    rockets: state.rockets.filter(r => r.id !== id)
  })),

  clearExpiredRockets: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 5000;
    return {
      rockets: state.rockets.filter(r => now - r.startTime < LIFETIME)
    };
  }),

  // ==================== BOMBS ====================
  addBomb: (bomb) => set((state) => {
    if (state.bombs.some(b => b.id === bomb.id)) return state;
    return { bombs: [...state.bombs, bomb] };
  }),

  removeBomb: (id) => set((state) => ({
    bombs: state.bombs.filter(b => b.id !== id)
  })),

  clearExpiredBombs: () => set((state) => {
    const now = Date.now();
    const TOTAL_LIFETIME = 5000;
    return {
      bombs: state.bombs.filter(b => now - b.startTime < TOTAL_LIFETIME)
    };
  }),

  setBombTargeting: (targeting, valid = false) => set({
    bombTargeting: targeting,
    bombTargetValid: valid
  }),

  // ==================== AIR STRIKE ====================
  setAirStrikeTargeting: (targeting, valid = false) => set({
    airStrikeTargeting: targeting,
    airStrikeTargetValid: valid
  }),

  // ==================== JETPACK ====================
  setJetpackActive: (active) => set({ jetpackActive: active }),
  setJetpackFuel: (fuel) => set({ jetpackFuel: Math.max(0, Math.min(100, fuel)) }),

  // ==================== HOOK PROJECTILES ====================
  addHookProjectile: (hook) => set((state) => {
    if (state.hookProjectiles.some(h => h.id === hook.id)) return state;
    return { hookProjectiles: [...state.hookProjectiles, hook] };
  }),

  updateHookProjectile: (id, updates) => set((state) => ({
    hookProjectiles: state.hookProjectiles.map(h =>
      h.id === id ? { ...h, ...updates } : h
    )
  })),

  removeHookProjectile: (id) => set((state) => ({
    hookProjectiles: state.hookProjectiles.filter(h => h.id !== id)
  })),

  clearExpiredHookProjectiles: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 2000;
    return {
      hookProjectiles: state.hookProjectiles.filter(h => now - h.startTime < LIFETIME)
    };
  }),

  // ==================== DRAG HOOKS ====================
  addDragHook: (hook) => set((state) => {
    if (state.dragHooks.some(h => h.id === hook.id)) return state;
    return { dragHooks: [...state.dragHooks, hook] };
  }),

  updateDragHook: (id, updates) => set((state) => ({
    dragHooks: state.dragHooks.map(h =>
      h.id === id ? { ...h, ...updates } : h
    )
  })),

  removeDragHook: (id) => set((state) => ({
    dragHooks: state.dragHooks.filter(h => h.id !== id)
  })),

  clearExpiredDragHooks: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 5000;
    return {
      dragHooks: state.dragHooks.filter(h => now - h.startTime < LIFETIME)
    };
  }),

  // ==================== GRAPPLE TRAPS ====================
  addGrappleTrap: (trap) => set((state) => {
    if (state.grappleTraps.some(t => t.id === trap.id)) return state;
    return { grappleTraps: [...state.grappleTraps, trap] };
  }),

  updateGrappleTrap: (id, updates) => set((state) => ({
    grappleTraps: state.grappleTraps.map(t =>
      t.id === id ? { ...t, ...updates } : t
    )
  })),

  removeGrappleTrap: (id) => set((state) => ({
    grappleTraps: state.grappleTraps.filter(t => t.id !== id)
  })),

  clearExpiredGrappleTraps: () => set((state) => {
    const now = Date.now();
    return {
      grappleTraps: state.grappleTraps.filter(t => (now - t.startTime) / 1000 < t.duration)
    };
  }),

  setGrappleTrapTargeting: (targeting, valid = false) => set({
    grappleTrapTargeting: targeting,
    grappleTrapTargetValid: valid
  }),

  // ==================== SWING LINES ====================
  addSwingLine: (line) => set((state) => {
    if (state.swingLines.some(l => l.id === line.id)) return state;
    return { swingLines: [...state.swingLines, line] };
  }),

  updateSwingLine: (id, updates) => set((state) => ({
    swingLines: state.swingLines.map(l =>
      l.id === id ? { ...l, ...updates } : l
    )
  })),

  removeSwingLine: (id) => set((state) => ({
    swingLines: state.swingLines.filter(l => l.id !== id)
  })),

  clearExpiredSwingLines: () => set((state) => {
    const now = Date.now();
    return {
      swingLines: state.swingLines.filter(l => (now - l.startTime) / 1000 < l.duration)
    };
  }),

  // ==================== GRAPPLE LINES ====================
  addGrappleLine: (line) => set((state) => {
    if (state.grappleLines.some(l => l.id === line.id)) return state;
    return { grappleLines: [...state.grappleLines, line] };
  }),

  updateGrappleLine: (id, updates) => set((state) => ({
    grappleLines: state.grappleLines.map(l =>
      l.id === id ? { ...l, ...updates } : l
    )
  })),

  removeGrappleLine: (id) => set((state) => ({
    grappleLines: state.grappleLines.filter(l => l.id !== id)
  })),

  clearExpiredGrappleLines: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 6000;
    return {
      grappleLines: state.grappleLines.filter(l => now - l.startTime < LIFETIME)
    };
  }),

  // ==================== EARTH WALLS ====================
  addEarthWall: (wall) => set((state) => {
    if (state.earthWalls.some(w => w.id === wall.id)) return state;
    return { earthWalls: [...state.earthWalls, wall] };
  }),

  updateEarthWall: (id, updates) => set((state) => ({
    earthWalls: state.earthWalls.map(w =>
      w.id === id ? { ...w, ...updates } : w
    )
  })),

  removeEarthWall: (id) => set((state) => ({
    earthWalls: state.earthWalls.filter(w => w.id !== id)
  })),

  clearExpiredEarthWalls: () => set((state) => {
    const now = Date.now();
    return {
      earthWalls: state.earthWalls.filter(w => {
        const elapsed = (now - w.startTime) / 1000;
        return elapsed < w.duration + 1.5;
      })
    };
  }),
});


