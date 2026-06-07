import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

// ============================================================================
// VISUAL STATE INTERFACE
// ============================================================================

/**
 * High-frequency visual state that can be mutated at 60fps without triggering
 * React re-renders. Accessed via visualStore.getState() in useFrame hooks.
 *
 * This store uses Zustand's vanilla pattern (createStore from 'zustand/vanilla')
 * instead of the default React hook pattern. Mutations to this store do NOT
 * trigger React re-renders, making it ideal for per-frame visual updates.
 *
 * Key principle: Visual state is separate from authoritative game state.
 * - Authoritative state (gameStore): Updated by server, trigger re-renders
 * - Visual state (visualStore): Updated in useFrame, no re-renders
 */
export interface VisualState {
  /** Player positions for smooth interpolation (playerId -> position) */
  playerPositions: Map<string, { x: number; y: number; z: number }>;

  /** Player rotations for lookYaw interpolation (playerId -> rotation in radians) */
  playerRotations: Map<string, number>;

  /** Camera shake effect: intensity (0-1) and remaining time (ms) */
  cameraShake: { intensity: number; time: number };

  /** FOV adjustment during slide (0 = normal, higher = zoomed out) */
  slideFov: number;

  /** Raw server positions before interpolation (for extrapolation/prediction) */
  interpolationTargets: Map<string, { x: number; y: number; z: number }>;

  /** High-frequency Blaze flamethrower pose for the held flame effect */
  flamethrowerOrigin: { x: number; y: number; z: number } | null;
  flamethrowerDirection: { x: number; y: number; z: number };
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const initialVisualState: VisualState = {
  playerPositions: new Map(),
  playerRotations: new Map(),
  cameraShake: { intensity: 0, time: 0 },
  slideFov: 0,
  interpolationTargets: new Map(),
  flamethrowerOrigin: null,
  flamethrowerDirection: { x: 0, y: 0, z: -1 },
};

// ============================================================================
// VANILLA STORE (NON-REACTIVE)
// ============================================================================

/**
 * Vanilla Zustand store for visual state.
 *
 * IMPORTANT: This store does NOT trigger React re-renders when mutated.
 * Access via visualStore.getState() in useFrame hooks for 60fps updates.
 *
 * DO NOT use the default Zustand create() hook - this uses vanilla createStore()
 * to avoid React re-renders on every mutation.
 */
export const visualStore = createStore<VisualState>(() => initialVisualState);

// ============================================================================
// NON-REACTIVE ACCESSOR FUNCTIONS
// ============================================================================

/**
 * Update a player's visual position target for interpolation.
 * Call this when receiving network updates or server position data.
 *
 * @param playerId - The player's unique ID
 * @param position - Target position to interpolate toward
 */
export const setPlayerVisualPosition = (
  playerId: string,
  position: { x: number; y: number; z: number }
): void => {
  const positions = visualStore.getState().playerPositions;
  const current = positions.get(playerId);
  if (current) {
    current.x = position.x;
    current.y = position.y;
    current.z = position.z;
  } else {
    positions.set(playerId, { x: position.x, y: position.y, z: position.z });
  }
};

/**
 * Update a player's visual rotation for lookYaw interpolation.
 *
 * @param playerId - The player's unique ID
 * @param rotation - LookYaw rotation in radians
 */
export const setPlayerVisualRotation = (playerId: string, rotation: number): void => {
  visualStore.getState().playerRotations.set(playerId, rotation);
};

/**
 * Set camera shake effect intensity and duration.
 *
 * @param intensity - Shake intensity (0-1, where 1 is max shake)
 * @param time - Duration of shake in milliseconds
 */
export const setCameraShake = (intensity: number, time: number): void => {
  visualStore.setState({ cameraShake: { intensity, time } });
};

/**
 * Set FOV adjustment during slide ability.
 *
 * @param fov - FOV offset from default (0 = no adjustment)
 */
export const setSlideFov = (fov: number): void => {
  visualStore.setState({ slideFov: fov });
};

/**
 * Set interpolation target for a player (raw server position).
 * Used for client-side prediction and extrapolation.
 *
 * @param playerId - The player's unique ID
 * @param position - Server-reported position
 */
export const setInterpolationTarget = (
  playerId: string,
  position: { x: number; y: number; z: number }
): void => {
  const targets = visualStore.getState().interpolationTargets;
  const current = targets.get(playerId);
  if (current) {
    current.x = position.x;
    current.y = position.y;
    current.z = position.z;
  } else {
    targets.set(playerId, { x: position.x, y: position.y, z: position.z });
  }
};

/**
 * Remove a player from all visual state maps.
 * Call this when a player disconnects or is removed from the game.
 *
 * @param playerId - The player's unique ID to remove
 */
export const removePlayerVisualState = (playerId: string): void => {
  const state = visualStore.getState();
  state.playerPositions.delete(playerId);
  state.playerRotations.delete(playerId);
  state.interpolationTargets.delete(playerId);
};

export const setFlamethrowerVisualPose = (
  origin: { x: number; y: number; z: number } | null,
  direction: { x: number; y: number; z: number }
): void => {
  const state = visualStore.getState();

  if (origin) {
    if (state.flamethrowerOrigin) {
      state.flamethrowerOrigin.x = origin.x;
      state.flamethrowerOrigin.y = origin.y;
      state.flamethrowerOrigin.z = origin.z;
    } else {
      state.flamethrowerOrigin = { x: origin.x, y: origin.y, z: origin.z };
    }
  } else {
    state.flamethrowerOrigin = null;
  }

  state.flamethrowerDirection.x = direction.x;
  state.flamethrowerDirection.y = direction.y;
  state.flamethrowerDirection.z = direction.z;
};

/**
 * Clear all visual state (e.g., on game reset or disconnect).
 */
export const clearVisualState = (): void => {
  visualStore.setState(() => ({
    playerPositions: new Map(),
    playerRotations: new Map(),
    cameraShake: { intensity: 0, time: 0 },
    slideFov: 0,
    interpolationTargets: new Map(),
    flamethrowerOrigin: null,
    flamethrowerDirection: { x: 0, y: 0, z: -1 },
  }));
};

// ============================================================================
// REACTIVE HOOK (OPTIONAL)
// ============================================================================

/**
 * Reactive hook for accessing visual state in React components.
 *
 * WARNING: Using this hook will cause React re-renders when the selected
 * state changes. Only use this for UI components that need to react to
 * visual state changes. For 60fps updates in useFrame, use visualStore.getState()
 * instead.
 *
 * @example
 * // GOOD: Non-reactive access in useFrame (no re-renders)
 * useFrame(() => {
 *   const positions = visualStore.getState().playerPositions;
 *   // Update Three.js objects directly
 * });
 *
 * // BAD: Reactive access in useFrame (60fps re-renders)
 * const positions = useVisualStore(s => s.playerPositions);
 * useFrame(() => { ... });
 *
 * @param selector - Function to select state slice
 * @returns Selected state slice
 */
export const useVisualStore = <T>(selector: (state: VisualState) => T): T => {
  return useStore(visualStore, selector);
};
