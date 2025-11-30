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

export const createGlacierSlice: StateCreator<
  GlacierSlice,
  [],
  [],
  GlacierSlice
> = (set, get) => ({
  ...glacierInitialState,

  // ==================== ICE MALLET SWINGS ====================
  addIceMalletSwing: (swing) => set((state) => {
    if (state.iceMalletSwings.some(s => s.id === swing.id)) return state;
    return { iceMalletSwings: [...state.iceMalletSwings, swing] };
  }),

  updateIceMalletSwing: (id, updates) => set((state) => ({
    iceMalletSwings: state.iceMalletSwings.map(s =>
      s.id === id ? { ...s, ...updates } : s
    )
  })),

  removeIceMalletSwing: (id) => set((state) => ({
    iceMalletSwings: state.iceMalletSwings.filter(s => s.id !== id)
  })),

  clearExpiredIceMalletSwings: () => set((state) => {
    const now = Date.now();
    const SWING_DURATION_MS = 400;
    return {
      iceMalletSwings: state.iceMalletSwings.filter(s => {
        const elapsed = now - s.startTime;
        return elapsed < SWING_DURATION_MS;
      })
    };
  }),

  setGlacierSwingHeld: (held) => set({ glacierSwingHeld: held }),

  setGlacierShieldActive: (active) => set((state) => ({
    glacierShieldActive: active,
    glacierShieldStartTime: active && !state.glacierShieldActive ? Date.now() : state.glacierShieldStartTime,
  })),

  // ==================== ICE WALL RUSH ====================
  addIceWallRush: (rush) => set((state) => {
    if (state.iceWallRushes.some(r => r.id === rush.id)) return state;
    return { iceWallRushes: [...state.iceWallRushes, rush] };
  }),

  updateIceWallRush: (id, updates) => set((state) => ({
    iceWallRushes: state.iceWallRushes.map(r =>
      r.id === id ? { ...r, ...updates } : r
    )
  })),

  removeIceWallRush: (id) => set((state) => ({
    iceWallRushes: state.iceWallRushes.filter(r => r.id !== id)
  })),

  clearExpiredIceWallRushes: () => set((state) => {
    const now = Date.now();
    const WALL_LIFETIME = 5000;
    return {
      iceWallRushes: state.iceWallRushes.filter(r => {
        if (r.isActive) return true;
        const lastSegment = r.segments[r.segments.length - 1];
        if (!lastSegment) return false;
        return (now - lastSegment.createdAt) < WALL_LIFETIME;
      })
    };
  }),

  setIceWallRushActive: (active) => set({ iceWallRushActive: active }),
  setIceWallRushFuel: (fuel) => set({ iceWallRushFuel: Math.max(0, Math.min(100, fuel)) }),

  // ==================== FROST STORM SHIELD ====================
  setFrostStormActive: (active) => set((state) => ({
    frostStormActive: active,
    frostStormStartTime: active && !state.frostStormActive ? Date.now() : state.frostStormStartTime,
    frostStormShield: active ? 75 : 0,
  })),

  setFrostStormShield: (shield) => set({ frostStormShield: Math.max(0, Math.min(75, shield)) }),

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


