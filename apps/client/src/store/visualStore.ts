import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS,
  MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
  type Player,
  type PlayerMovementState,
  type Team,
} from '@voxel-strike/shared';

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

  /** Remote transform histories sampled slightly in the past for smooth remote rendering. */
  remoteTransformHistories: Map<string, RemoteTransformHistory>;

  /** High-frequency Blaze flamethrower pose for the held flame effect */
  flamethrowerOrigin: { x: number; y: number; z: number } | null;
  flamethrowerDirection: { x: number; y: number; z: number };

  /** High-frequency Chronos RMB shield state for local and remote view effects. */
  chronosAegisStates: Map<string, { active: boolean; activatedAtMs: number; updatedAtMs: number }>;

  /** Short-lived attack pose state for remote player bodies. */
  remotePlayerAttackStates: Map<string, RemotePlayerAttackState>;

  /** Current local movement snapshot for viewmodel-only animation. */
  localViewmodelMovement: {
    hasMovementInput: boolean;
    isSprinting: boolean;
    horizontalSpeed: number;
    updatedAtMs: number;
  };

  /** High-frequency local movement used by first-person effects. */
  localMovement: PlayerMovementState;

  /** High-frequency slide intensity for UI and viewmodel effects. */
  slideIntensity: number;

  /** Server-authoritative local velocity impulses to consume in PlayerController. */
  localPlayerImpulses: LocalPlayerImpulse[];

  /** Shared per-frame player candidates for visual-only combat effects. */
  combatFrameCache: CombatVisualFrameCache;
}

export interface LocalPlayerImpulse {
  x: number;
  y: number;
  z: number;
  mode?: 'add' | 'set';
}

export interface RemotePlayerAttackState {
  abilityId: string;
  startedAtMs: number;
  side: -1 | 1;
}

export interface RemoteTransformSnapshot {
  serverTick: number;
  serverTime: number;
  receivedAtMs: number;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  lookYaw: number;
  lookPitch: number;
  movementBits: number;
  wallRunSide: -1 | 0 | 1;
  movementEpoch: number;
}

export interface RemoteTransformHistory {
  snapshots: RemoteTransformSnapshot[];
  latestServerTime: number;
  latestReceivedAtMs: number;
}

export interface SampledRemoteTransform {
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  lookYaw: number;
  lookPitch: number;
  movementBits: number;
  wallRunSide: -1 | 0 | 1;
  movementEpoch: number;
  extrapolatedMs: number;
  stale: boolean;
}

export interface CombatVisualPlayer {
  player: Player;
  id: string;
  team: Team;
  x: number;
  y: number;
  z: number;
}

export interface CombatVisualFrameCache {
  frameKey: number;
  builtAtMs: number;
  sourceSize: number;
  alivePlayers: CombatVisualPlayer[];
  byTeam: Record<Team, CombatVisualPlayer[]>;
  buckets: Map<string, CombatVisualPlayer[]>;
  entryPool: CombatVisualPlayer[];
  cellSize: number;
}

// ============================================================================
// INITIAL STATE
// ============================================================================

const DEFAULT_LOCAL_MOVEMENT: PlayerMovementState = {
  isGrounded: true,
  isSprinting: false,
  isCrouching: false,
  isSliding: false,
  slideTimeRemaining: 0,
  isWallRunning: false,
  wallRunSide: null,
  isGrappling: false,
  grapplePoint: null,
  isJetpacking: false,
  jetpackFuel: 0,
  isGliding: false,
};

const COMBAT_VISUAL_CELL_SIZE = 8;

const createCombatFrameCache = (): CombatVisualFrameCache => ({
  frameKey: -1,
  builtAtMs: 0,
  sourceSize: 0,
  alivePlayers: [],
  byTeam: {
    red: [],
    blue: [],
  },
  buckets: new Map(),
  entryPool: [],
  cellSize: COMBAT_VISUAL_CELL_SIZE,
});

const initialVisualState: VisualState = {
  playerPositions: new Map(),
  playerRotations: new Map(),
  cameraShake: { intensity: 0, time: 0 },
  slideFov: 0,
  interpolationTargets: new Map(),
  remoteTransformHistories: new Map(),
  flamethrowerOrigin: null,
  flamethrowerDirection: { x: 0, y: 0, z: -1 },
  chronosAegisStates: new Map(),
  remotePlayerAttackStates: new Map(),
  localViewmodelMovement: {
    hasMovementInput: false,
    isSprinting: false,
    horizontalSpeed: 0,
    updatedAtMs: 0,
  },
  localMovement: { ...DEFAULT_LOCAL_MOVEMENT },
  slideIntensity: 0,
  localPlayerImpulses: [],
  combatFrameCache: createCombatFrameCache(),
};

const REMOTE_HISTORY_LIMIT = 32;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpYaw(a: number, b: number, t: number): number {
  const twoPi = Math.PI * 2;
  const delta = ((b - a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return a + delta * t;
}

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

export const setLocalViewmodelMovement = (
  movement: VisualState['localViewmodelMovement']
): void => {
  const current = visualStore.getState().localViewmodelMovement;
  current.hasMovementInput = movement.hasMovementInput;
  current.isSprinting = movement.isSprinting;
  current.horizontalSpeed = movement.horizontalSpeed;
  current.updatedAtMs = movement.updatedAtMs;
};

export const setLocalVisualMovement = (movement: PlayerMovementState): void => {
  const current = visualStore.getState().localMovement;
  current.isGrounded = movement.isGrounded;
  current.isSprinting = movement.isSprinting;
  current.isCrouching = movement.isCrouching;
  current.isSliding = movement.isSliding;
  current.slideTimeRemaining = movement.slideTimeRemaining;
  current.isWallRunning = movement.isWallRunning;
  current.wallRunSide = movement.wallRunSide;
  current.isGrappling = movement.isGrappling;
  current.grapplePoint = movement.grapplePoint;
  current.isJetpacking = movement.isJetpacking;
  current.jetpackFuel = movement.jetpackFuel;
  current.isGliding = movement.isGliding;
  current.chronosAscendantStartY = movement.chronosAscendantStartY;
};

export const setLocalSlideIntensity = (intensity: number): void => {
  visualStore.getState().slideIntensity = intensity;
};

export const pushLocalPlayerImpulse = (impulse: LocalPlayerImpulse): void => {
  visualStore.getState().localPlayerImpulses.push({
    x: impulse.x,
    y: impulse.y,
    z: impulse.z,
    mode: impulse.mode,
  });
};

export const consumeLocalPlayerImpulses = (): VisualState['localPlayerImpulses'] => {
  const impulses = visualStore.getState().localPlayerImpulses;
  if (impulses.length === 0) return [];

  visualStore.setState({ localPlayerImpulses: [] });
  return impulses;
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

export const addRemoteTransformSnapshot = (
  playerId: string,
  snapshot: Omit<RemoteTransformSnapshot, 'receivedAtMs'>
): void => {
  const histories = visualStore.getState().remoteTransformHistories;
  const receivedAtMs = Date.now();
  let history = histories.get(playerId);
  const last = history?.snapshots[history.snapshots.length - 1] ?? null;
  if (!history || (last && last.movementEpoch !== snapshot.movementEpoch)) {
    history = {
      snapshots: [],
      latestServerTime: snapshot.serverTime,
      latestReceivedAtMs: receivedAtMs,
    };
    histories.set(playerId, history);
  }

  const fullSnapshot = { ...snapshot, receivedAtMs };
  const snapshots = history.snapshots;
  const latest = snapshots[snapshots.length - 1];
  if (!latest || fullSnapshot.serverTime >= latest.serverTime) {
    snapshots.push(fullSnapshot);
  } else {
    let low = 0;
    let high = snapshots.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (snapshots[mid].serverTime <= fullSnapshot.serverTime) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    snapshots.splice(low, 0, fullSnapshot);
  }
  if (history.snapshots.length > REMOTE_HISTORY_LIMIT) {
    history.snapshots.splice(0, history.snapshots.length - REMOTE_HISTORY_LIMIT);
  }
  history.latestServerTime = snapshot.serverTime;
  history.latestReceivedAtMs = receivedAtMs;
};

export const pruneRemoteTransformHistories = (activePlayerIds: ReadonlySet<string>): void => {
  const state = visualStore.getState();
  for (const playerId of state.remoteTransformHistories.keys()) {
    if (!activePlayerIds.has(playerId)) {
      state.remoteTransformHistories.delete(playerId);
      state.interpolationTargets.delete(playerId);
      state.playerPositions.delete(playerId);
      state.playerRotations.delete(playerId);
    }
  }
};

export const sampleRemoteTransformInto = (
  playerId: string,
  target: SampledRemoteTransform,
  nowMs = Date.now()
): boolean => {
  const history = visualStore.getState().remoteTransformHistories.get(playerId);
  if (!history || history.snapshots.length === 0) return false;

  const snapshots = history.snapshots;
  const latest = snapshots[snapshots.length - 1];
  const estimatedServerTime = latest.serverTime + Math.max(0, nowMs - latest.receivedAtMs);
  const renderServerTime = estimatedServerTime - MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS;

  let low = 0;
  let high = snapshots.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (snapshots[mid].serverTime <= renderServerTime) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  const previous = snapshots[Math.max(0, low - 1)];
  const next = low < snapshots.length ? snapshots[low] : null;

  if (next) {
    const span = Math.max(1, next.serverTime - previous.serverTime);
    const t = Math.max(0, Math.min(1, (renderServerTime - previous.serverTime) / span));
    target.position.x = lerp(previous.position.x, next.position.x, t);
    target.position.y = lerp(previous.position.y, next.position.y, t);
    target.position.z = lerp(previous.position.z, next.position.z, t);
    target.velocity.x = lerp(previous.velocity.x, next.velocity.x, t);
    target.velocity.y = lerp(previous.velocity.y, next.velocity.y, t);
    target.velocity.z = lerp(previous.velocity.z, next.velocity.z, t);
    target.lookYaw = lerpYaw(previous.lookYaw, next.lookYaw, t);
    target.lookPitch = lerp(previous.lookPitch, next.lookPitch, t);
    target.movementBits = next.movementBits;
    target.wallRunSide = next.wallRunSide;
    target.movementEpoch = next.movementEpoch;
    target.extrapolatedMs = 0;
    target.stale = false;
    return true;
  }

  const extrapolatedMs = Math.max(0, renderServerTime - latest.serverTime);
  const cappedMs = Math.min(extrapolatedMs, MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS);
  const dt = cappedMs / 1000;
  target.position.x = latest.position.x + latest.velocity.x * dt;
  target.position.y = latest.position.y + latest.velocity.y * dt;
  target.position.z = latest.position.z + latest.velocity.z * dt;
  target.velocity.x = latest.velocity.x;
  target.velocity.y = latest.velocity.y;
  target.velocity.z = latest.velocity.z;
  target.lookYaw = latest.lookYaw;
  target.lookPitch = latest.lookPitch;
  target.movementBits = latest.movementBits;
  target.wallRunSide = latest.wallRunSide;
  target.movementEpoch = latest.movementEpoch;
  target.extrapolatedMs = extrapolatedMs;
  target.stale = extrapolatedMs > MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS;
  return true;
};

export const sampleRemoteTransform = (
  playerId: string,
  nowMs = Date.now()
): SampledRemoteTransform | null => {
  const sampled: SampledRemoteTransform = {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    extrapolatedMs: 0,
    stale: false,
  };
  return sampleRemoteTransformInto(playerId, sampled, nowMs) ? sampled : null;
};

function getCombatBucketKey(x: number, z: number, cellSize: number): string {
  return `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
}

export const rebuildCombatVisualFrameCache = (
  players: Iterable<Player>,
  frameKey: number,
  nowMs = Date.now(),
  sourceSize = -1
): CombatVisualFrameCache => {
  const cache = visualStore.getState().combatFrameCache;
  if (cache.frameKey === frameKey && (sourceSize < 0 || cache.sourceSize === sourceSize)) {
    return cache;
  }

  cache.frameKey = frameKey;
  cache.builtAtMs = nowMs;
  cache.sourceSize = sourceSize;
  cache.alivePlayers.length = 0;
  cache.byTeam.red.length = 0;
  cache.byTeam.blue.length = 0;
  cache.buckets.clear();

  let entryIndex = 0;
  for (const player of players) {
    if (player.state !== 'alive') continue;
    let visualPlayer = cache.entryPool[entryIndex];
    if (!visualPlayer) {
      visualPlayer = {
        player,
        id: player.id,
        team: player.team,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      };
      cache.entryPool[entryIndex] = visualPlayer;
    } else {
      visualPlayer.player = player;
      visualPlayer.id = player.id;
      visualPlayer.team = player.team;
      visualPlayer.x = player.position.x;
      visualPlayer.y = player.position.y;
      visualPlayer.z = player.position.z;
    }
    entryIndex++;
    cache.alivePlayers.push(visualPlayer);
    cache.byTeam[player.team].push(visualPlayer);

    const bucketKey = getCombatBucketKey(visualPlayer.x, visualPlayer.z, cache.cellSize);
    let bucket = cache.buckets.get(bucketKey);
    if (!bucket) {
      bucket = [];
      cache.buckets.set(bucketKey, bucket);
    }
    bucket.push(visualPlayer);
  }

  return cache;
};

export const fillCombatVisualEnemyPlayers = (
  cache: CombatVisualFrameCache,
  ownerTeam: Team | null | undefined,
  ownerId: string,
  target: Player[],
  center?: { x: number; z: number },
  radius?: number
): Player[] => {
  target.length = 0;

  if (center && typeof radius === 'number') {
    const minCellX = Math.floor((center.x - radius) / cache.cellSize);
    const maxCellX = Math.floor((center.x + radius) / cache.cellSize);
    const minCellZ = Math.floor((center.z - radius) / cache.cellSize);
    const maxCellZ = Math.floor((center.z + radius) / cache.cellSize);
    const radiusSq = radius * radius;

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = cache.buckets.get(`${cellX}:${cellZ}`);
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const visualPlayer = bucket[i];
          if (visualPlayer.id === ownerId) continue;
          if (ownerTeam && visualPlayer.team === ownerTeam) continue;
          const dx = visualPlayer.x - center.x;
          const dz = visualPlayer.z - center.z;
          if (dx * dx + dz * dz <= radiusSq) {
            target.push(visualPlayer.player);
          }
        }
      }
    }
    return target;
  }

  const source = ownerTeam
    ? (ownerTeam === 'red' ? cache.byTeam.blue : cache.byTeam.red)
    : cache.alivePlayers;

  for (let i = 0; i < source.length; i++) {
    const visualPlayer = source[i];
    if (visualPlayer.id !== ownerId) {
      target.push(visualPlayer.player);
    }
  }

  return target;
};

export const clearCombatVisualFrameCache = (): void => {
  const cache = visualStore.getState().combatFrameCache;
  cache.frameKey = -1;
  cache.builtAtMs = 0;
  cache.sourceSize = 0;
  cache.alivePlayers.length = 0;
  cache.byTeam.red.length = 0;
  cache.byTeam.blue.length = 0;
  cache.buckets.clear();
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
  state.remoteTransformHistories.delete(playerId);
  state.chronosAegisStates.delete(playerId);
  state.remotePlayerAttackStates.delete(playerId);
};

export const setChronosAegisVisualState = (
  playerId: string,
  active: boolean,
  timestampMs = Date.now()
): void => {
  const states = visualStore.getState().chronosAegisStates;
  const current = states.get(playerId);

  if (current) {
    if (active && !current.active) {
      current.activatedAtMs = timestampMs;
    }
    current.active = active;
    current.updatedAtMs = timestampMs;
    return;
  }

  states.set(playerId, {
    active,
    activatedAtMs: active ? timestampMs : 0,
    updatedAtMs: timestampMs,
  });
};

export const triggerRemotePlayerAttack = (
  playerId: string,
  abilityId: string,
  options: { side?: -1 | 1; startedAtMs?: number } = {}
): void => {
  visualStore.getState().remotePlayerAttackStates.set(playerId, {
    abilityId,
    startedAtMs: options.startedAtMs ?? Date.now(),
    side: options.side ?? 1,
  });
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
    remoteTransformHistories: new Map(),
    flamethrowerOrigin: null,
    flamethrowerDirection: { x: 0, y: 0, z: -1 },
    chronosAegisStates: new Map(),
    remotePlayerAttackStates: new Map(),
    localViewmodelMovement: {
      hasMovementInput: false,
      isSprinting: false,
      horizontalSpeed: 0,
      updatedAtMs: 0,
    },
    localMovement: { ...DEFAULT_LOCAL_MOVEMENT },
    slideIntensity: 0,
    localPlayerImpulses: [],
    combatFrameCache: createCombatFrameCache(),
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
