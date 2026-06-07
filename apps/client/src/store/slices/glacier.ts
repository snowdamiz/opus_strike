import type { StateCreator } from 'zustand';
import type { IceMalletSwingData, IceWallRushData } from '../types';

// ============================================================================
// GLACIER STATE INTERFACE
// ============================================================================

export interface GlacierState {
  // Ice mallet (basic attack)
  iceMalletSwings: IceMalletSwingData[];
  glacierSwingHeld: boolean;
  glacierShieldActive: boolean;
  glacierShieldStartTime: number;

  // Ice Wall Rush (E ability)
  iceWallRushes: IceWallRushData[];
  iceWallRushActive: boolean;
  iceWallRushFuel: number;

  // Frost Storm Shield (Q ability)
  frostStormActive: boolean;
  frostStormShield: number;
  frostStormStartTime: number;
}

export interface GlacierActions {
  // Ice mallet swing actions
  addIceMalletSwing: (swing: IceMalletSwingData) => void;
  updateIceMalletSwing: (id: string, updates: Partial<IceMalletSwingData>) => void;
  removeIceMalletSwing: (id: string) => void;
  clearExpiredIceMalletSwings: () => void;
  setGlacierSwingHeld: (held: boolean) => void;
  setGlacierShieldActive: (active: boolean) => void;

  // Ice Wall Rush actions
  addIceWallRush: (rush: IceWallRushData) => void;
  updateIceWallRush: (id: string, updates: Partial<IceWallRushData>) => void;
  removeIceWallRush: (id: string) => void;
  clearExpiredIceWallRushes: () => void;
  setIceWallRushActive: (active: boolean) => void;
  setIceWallRushFuel: (fuel: number) => void;

  // Frost Storm Shield actions
  setFrostStormActive: (active: boolean) => void;
  setFrostStormShield: (shield: number) => void;
  damageFrostStormShield: (damage: number) => number;
}

export type GlacierSlice = GlacierState & GlacierActions;

// ============================================================================
// INITIAL STATE
// ============================================================================

export const glacierInitialState: GlacierState = {
  iceMalletSwings: [],
  glacierSwingHeld: false,
  glacierShieldActive: false,
  glacierShieldStartTime: 0,
  iceWallRushes: [],
  iceWallRushActive: false,
  iceWallRushFuel: 100,
  frostStormActive: false,
  frostStormShield: 0,
  frostStormStartTime: 0,
};

// ============================================================================
// SLICE CREATOR
// ============================================================================

function appendUnique<T extends { id: string }>(items: T[], item: T): T[] {
  for (const existing of items) {
    if (existing.id === item.id) return items;
  }
  return [...items, item];
}

function updateById<T extends { id: string }>(items: T[], id: string, updates: Partial<T>): T[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.id !== id) return item;
    changed = true;
    return { ...item, ...updates };
  });
  return changed ? next : items;
}

function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  let changed = false;
  const next = items.filter((item) => {
    const keep = item.id !== id;
    if (!keep) changed = true;
    return keep;
  });
  return changed ? next : items;
}

function filterExpired<T>(items: T[], keep: (item: T, now: number) => boolean): T[] {
  if (items.length === 0) return items;

  const now = Date.now();
  let changed = false;
  const next = items.filter((item) => {
    const shouldKeep = keep(item, now);
    if (!shouldKeep) changed = true;
    return shouldKeep;
  });
  return changed ? next : items;
}

export const createGlacierSlice: StateCreator<
  GlacierSlice,
  [],
  [],
  GlacierSlice
> = (set, get) => ({
  ...glacierInitialState,

  // ==================== ICE MALLET SWINGS ====================
  addIceMalletSwing: (swing) => set((state) => {
    const iceMalletSwings = appendUnique(state.iceMalletSwings, swing);
    return iceMalletSwings === state.iceMalletSwings ? state : { iceMalletSwings };
  }),

  updateIceMalletSwing: (id, updates) => set((state) => {
    const iceMalletSwings = updateById(state.iceMalletSwings, id, updates);
    return iceMalletSwings === state.iceMalletSwings ? state : { iceMalletSwings };
  }),

  removeIceMalletSwing: (id) => set((state) => {
    const iceMalletSwings = removeById(state.iceMalletSwings, id);
    return iceMalletSwings === state.iceMalletSwings ? state : { iceMalletSwings };
  }),

  clearExpiredIceMalletSwings: () => set((state) => {
    const SWING_DURATION_MS = 400;
    const iceMalletSwings = filterExpired(state.iceMalletSwings, (s, now) => now - s.startTime < SWING_DURATION_MS);
    return iceMalletSwings === state.iceMalletSwings ? state : { iceMalletSwings };
  }),

  setGlacierSwingHeld: (held) => set((state) => (
    state.glacierSwingHeld === held ? state : { glacierSwingHeld: held }
  )),

  setGlacierShieldActive: (active) => set((state) => {
    if (state.glacierShieldActive === active) return state;
    return {
      glacierShieldActive: active,
      glacierShieldStartTime: active ? Date.now() : state.glacierShieldStartTime,
    };
  }),

  // ==================== ICE WALL RUSH ====================
  addIceWallRush: (rush) => set((state) => {
    const iceWallRushes = appendUnique(state.iceWallRushes, rush);
    return iceWallRushes === state.iceWallRushes ? state : { iceWallRushes };
  }),

  updateIceWallRush: (id, updates) => set((state) => {
    const iceWallRushes = updateById(state.iceWallRushes, id, updates);
    return iceWallRushes === state.iceWallRushes ? state : { iceWallRushes };
  }),

  removeIceWallRush: (id) => set((state) => {
    const iceWallRushes = removeById(state.iceWallRushes, id);
    return iceWallRushes === state.iceWallRushes ? state : { iceWallRushes };
  }),

  clearExpiredIceWallRushes: () => set((state) => {
    const WALL_LIFETIME = 5000;
    const iceWallRushes = filterExpired(state.iceWallRushes, (r, now) => {
      if (r.isActive) return true;
      const lastSegment = r.segments[r.segments.length - 1];
      if (!lastSegment) return false;
      return now - lastSegment.createdAt < WALL_LIFETIME;
    });
    return iceWallRushes === state.iceWallRushes ? state : { iceWallRushes };
  }),

  setIceWallRushActive: (active) => set((state) => (
    state.iceWallRushActive === active ? state : { iceWallRushActive: active }
  )),
  setIceWallRushFuel: (fuel) => set((state) => {
    const nextFuel = Math.max(0, Math.min(100, fuel));
    return state.iceWallRushFuel === nextFuel ? state : { iceWallRushFuel: nextFuel };
  }),

  // ==================== FROST STORM SHIELD ====================
  setFrostStormActive: (active) => set((state) => {
    const nextStartTime = active && !state.frostStormActive ? Date.now() : state.frostStormStartTime;
    const nextShield = active ? 75 : 0;
    if (
      state.frostStormActive === active &&
      state.frostStormStartTime === nextStartTime &&
      state.frostStormShield === nextShield
    ) {
      return state;
    }
    return {
      frostStormActive: active,
      frostStormStartTime: nextStartTime,
      frostStormShield: nextShield,
    };
  }),

  setFrostStormShield: (shield) => set((state) => {
    const nextShield = Math.max(0, Math.min(75, shield));
    return state.frostStormShield === nextShield ? state : { frostStormShield: nextShield };
  }),

  damageFrostStormShield: (damage) => {
    const state = get();
    if (!state.frostStormActive || state.frostStormShield <= 0) {
      return damage;
    }

    const shieldDamage = Math.min(state.frostStormShield, damage);
    const newShield = state.frostStormShield - shieldDamage;
    const overflow = damage - shieldDamage;

    set({
      frostStormShield: newShield,
      frostStormActive: newShield > 0,
    });

    return overflow;
  },
});

