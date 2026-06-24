import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import {
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  HERO_DEFINITIONS,
  MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS,
  MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  TICK_INTERVAL_MS,
  doesSegmentHitVerticalCapsule,
  type HeroId,
  type Player,
  type PlayerMovementState,
  type Team,
  type Vec3,
} from '@voxel-strike/shared';
import { recordHotStoreCommit } from '../movement/networkDiagnostics';

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

  /** Player look pitch for high-frequency local aiming effects (playerId -> pitch in radians). */
  playerLookPitches: Map<string, number>;

  /** Last rendered remote player positions for non-reactive attachments like labels/beacons. */
  renderedPlayerPositions: Map<string, { x: number; y: number; z: number }>;

  /** Last rendered remote player rotations for non-reactive attachments like labels/beacons. */
  renderedPlayerRotations: Map<string, number>;

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
  chronosAegisStates: Map<string, { active: boolean; activatedAtMs: number; updatedAtMs: number; durabilityRatio: number }>;

  /** Short-lived attack pose state for remote player bodies. */
  remotePlayerAttackStates: Map<string, RemotePlayerAttackState>;

  /** Short-lived client-only corpse visuals keyed by death visual id. */
  deathVisuals: Map<string, DeathVisualSnapshot>;

  /** Low-frequency version that changes only when death visuals are added/removed. */
  deathVisualRevision: number;

  /** Current local movement snapshot for viewmodel-only animation. */
  localViewmodelMovement: {
    hasMovementInput: boolean;
    isSprinting: boolean;
    horizontalSpeed: number;
    updatedAtMs: number;
  };

  /** High-frequency local movement used by first-person effects. */
  localMovement: PlayerMovementState;

  /** Temporary BR first-person drop reveal for the local full-body model. */
  battleRoyalFirstPersonDropBodyVisibleUntilMs: number;

  /** High-frequency slide intensity for UI and viewmodel effects. */
  slideIntensity: number;

  /** Latest local slide velocity for first-person directional motion effects. */
  localSlideVelocity: Vec3;

  /** Latest local camera yaw used to orient first-person directional motion effects. */
  localViewYaw: number;

  /** Server-authoritative local velocity impulses to consume in PlayerController. */
  localPlayerImpulses: LocalPlayerImpulse[];

  /** Shared per-frame player candidates for visual-only combat effects. */
  combatFrameCache: CombatVisualFrameCache;

  /** Active player indexes for visual-only gameplay effects. Mutated outside React. */
  activeBlazeFlamethrowerPlayerIds: string[];
  activeBlazeFlamethrowerPlayerIdSet: Set<string>;
  activeBlazeBurningPlayerIds: string[];
  activeBlazeBurningPlayerIdSet: Set<string>;
  activeChronosAegisPlayerIds: string[];
  activeChronosAegisPlayerIdSet: Set<string>;
  activeChronosAscendantPlayerIds: string[];
  activeChronosAscendantPlayerIdSet: Set<string>;
}

export interface LocalPlayerImpulse {
  x: number;
  y: number;
  z: number;
  mode?: 'add' | 'set';
}

const EMPTY_LOCAL_PLAYER_IMPULSES = Object.freeze([]) as unknown as LocalPlayerImpulse[];

export interface RemotePlayerAttackState {
  abilityId: string;
  startedAtMs: number;
  side: -1 | 1;
}

export interface DeathVisualSnapshot {
  id: string;
  playerId: string;
  heroId: HeroId | null;
  skinId?: Player['skinId'];
  team: Team;
  isBot: boolean;
  name: string;
  position: Vec3;
  velocity: Vec3;
  lookYaw: number;
  lookPitch: number;
  movement: PlayerMovementState;
  killerId: string | null;
  sourceDirection: Vec3 | null;
  startedAtMs: number;
  expiresAtMs: number;
  local: boolean;
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
  interpolationDelayMs: number;
  arrivalJitterMs: number;
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
  hitboxRadius: number;
  hitboxSegmentHalfHeight: number;
}

export interface CombatVisualFrameCache {
  frameKey: number;
  builtAtMs: number;
  sourceSize: number;
  alivePlayers: CombatVisualPlayer[];
  buckets: Map<number, CombatVisualPlayer[]>;
  activeBuckets: CombatVisualPlayer[][];
  entryPool: CombatVisualPlayer[];
  cellSize: number;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface Vec2Like {
  x: number;
  z: number;
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
const COMBAT_VISUAL_BUCKET_KEY_CELL_OFFSET = 1 << 20;
const COMBAT_VISUAL_BUCKET_KEY_CELL_STRIDE = COMBAT_VISUAL_BUCKET_KEY_CELL_OFFSET * 2;
const CHRONOS_ASCENDANT_ABILITY_ID = 'chronos_ascendant_paradox';

function createCombatVisualHitboxMetrics(size: { width: number; height: number; depth: number }): {
  radius: number;
  segmentHalfHeight: number;
} {
  const radius = Math.max(size.width, size.depth) / 2 + PLAYER_COMBAT_HITBOX_PADDING;
  return {
    radius,
    segmentHalfHeight: Math.max(0, size.height / 2 + PLAYER_COMBAT_HITBOX_PADDING - radius),
  };
}

const DEFAULT_COMBAT_VISUAL_HITBOX = createCombatVisualHitboxMetrics({
  width: PLAYER_RADIUS * 2,
  height: PLAYER_HEIGHT,
  depth: PLAYER_RADIUS * 2,
});

const HERO_COMBAT_VISUAL_HITBOXES = Object.fromEntries(
  (Object.keys(HERO_DEFINITIONS) as HeroId[]).map((heroId) => [
    heroId,
    createCombatVisualHitboxMetrics(HERO_DEFINITIONS[heroId].stats.size),
  ])
) as Record<HeroId, typeof DEFAULT_COMBAT_VISUAL_HITBOX>;

function getCombatVisualHitboxMetrics(heroId: HeroId | string | null | undefined): typeof DEFAULT_COMBAT_VISUAL_HITBOX {
  return typeof heroId === 'string'
    ? HERO_COMBAT_VISUAL_HITBOXES[heroId as HeroId] ?? DEFAULT_COMBAT_VISUAL_HITBOX
    : DEFAULT_COMBAT_VISUAL_HITBOX;
}

const createCombatFrameCache = (): CombatVisualFrameCache => ({
  frameKey: -1,
  builtAtMs: 0,
  sourceSize: 0,
  alivePlayers: [],
  buckets: new Map(),
  activeBuckets: [],
  entryPool: [],
  cellSize: COMBAT_VISUAL_CELL_SIZE,
});

const initialVisualState: VisualState = {
  playerPositions: new Map(),
  playerRotations: new Map(),
  playerLookPitches: new Map(),
  renderedPlayerPositions: new Map(),
  renderedPlayerRotations: new Map(),
  cameraShake: { intensity: 0, time: 0 },
  slideFov: 0,
  interpolationTargets: new Map(),
  remoteTransformHistories: new Map(),
  flamethrowerOrigin: null,
  flamethrowerDirection: { x: 0, y: 0, z: -1 },
  chronosAegisStates: new Map(),
  remotePlayerAttackStates: new Map(),
  deathVisuals: new Map(),
  deathVisualRevision: 0,
  localViewmodelMovement: {
    hasMovementInput: false,
    isSprinting: false,
    horizontalSpeed: 0,
    updatedAtMs: 0,
  },
  localMovement: { ...DEFAULT_LOCAL_MOVEMENT },
  battleRoyalFirstPersonDropBodyVisibleUntilMs: 0,
  slideIntensity: 0,
  localSlideVelocity: { x: 0, y: 0, z: 0 },
  localViewYaw: 0,
  localPlayerImpulses: [],
  combatFrameCache: createCombatFrameCache(),
  activeBlazeFlamethrowerPlayerIds: [],
  activeBlazeFlamethrowerPlayerIdSet: new Set(),
  activeBlazeBurningPlayerIds: [],
  activeBlazeBurningPlayerIdSet: new Set(),
  activeChronosAegisPlayerIds: [],
  activeChronosAegisPlayerIdSet: new Set(),
  activeChronosAscendantPlayerIds: [],
  activeChronosAscendantPlayerIdSet: new Set(),
};

const REMOTE_HISTORY_LIMIT = 32;
const REMOTE_TRANSFORM_EXPECTED_CADENCE_MS = TICK_INTERVAL_MS;
const REMOTE_INTERPOLATION_MAX_DELAY_MS =
  MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS + MOVEMENT_REMOTE_EXTRAPOLATION_CAP_MS;
const REMOTE_TRANSFORM_TAIL_FAST_PATH_SEGMENTS = Math.max(
  1,
  Math.ceil(MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS / REMOTE_TRANSFORM_EXPECTED_CADENCE_MS)
);
const REMOTE_INTERPOLATION_JITTER_DECAY_ALPHA = 0.12;
const REMOTE_INTERPOLATION_JITTER_GAIN = 0.75;

export const DEATH_VISUAL_LIFETIME_MS = 5600;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpYaw(a: number, b: number, t: number): number {
  const twoPi = Math.PI * 2;
  const delta = ((b - a + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return a + delta * t;
}

function createRemoteTransformHistory(serverTime: number, receivedAtMs: number): RemoteTransformHistory {
  return {
    snapshots: [],
    latestServerTime: serverTime,
    latestReceivedAtMs: receivedAtMs,
    interpolationDelayMs: MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
    arrivalJitterMs: 0,
  };
}

function updateRemoteTransformTiming(
  history: RemoteTransformHistory,
  previousLatest: RemoteTransformSnapshot,
  nextLatest: RemoteTransformSnapshot
): void {
  const serverGapMs = Math.max(0, nextLatest.serverTime - previousLatest.serverTime);
  const receiveGapMs = Math.max(0, nextLatest.receivedAtMs - previousLatest.receivedAtMs);
  const observedGapMs = Math.max(serverGapMs, receiveGapMs);
  const excessGapMs = Math.max(0, observedGapMs - REMOTE_TRANSFORM_EXPECTED_CADENCE_MS);

  history.arrivalJitterMs = excessGapMs >= history.arrivalJitterMs
    ? excessGapMs
    : lerp(history.arrivalJitterMs, excessGapMs, REMOTE_INTERPOLATION_JITTER_DECAY_ALPHA);
  history.interpolationDelayMs = clamp(
    MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS + history.arrivalJitterMs * REMOTE_INTERPOLATION_JITTER_GAIN,
    MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
    REMOTE_INTERPOLATION_MAX_DELAY_MS
  );
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
export const setPlayerVisualRotation = (
  playerId: string,
  rotation: number,
  lookPitch?: number
): void => {
  const state = visualStore.getState();
  state.playerRotations.set(playerId, rotation);
  if (typeof lookPitch === 'number') {
    state.playerLookPitches.set(playerId, lookPitch);
  }
};

export const setPlayerVisualTransform = (
  playerId: string,
  position: { x: number; y: number; z: number },
  rotation: number,
  lookPitch?: number
): void => {
  const state = visualStore.getState();
  const current = state.playerPositions.get(playerId);
  if (current) {
    if (current.x !== position.x) current.x = position.x;
    if (current.y !== position.y) current.y = position.y;
    if (current.z !== position.z) current.z = position.z;
  } else {
    state.playerPositions.set(playerId, { x: position.x, y: position.y, z: position.z });
  }

  if (state.playerRotations.get(playerId) !== rotation) {
    state.playerRotations.set(playerId, rotation);
  }
  if (typeof lookPitch === 'number' && state.playerLookPitches.get(playerId) !== lookPitch) {
    state.playerLookPitches.set(playerId, lookPitch);
  }
};

export function getPlayerVisualLookPitch(
  state: Pick<VisualState, 'playerLookPitches'>,
  player: Pick<Player, 'id' | 'lookPitch'>
): number {
  return state.playerLookPitches.get(player.id) ?? player.lookPitch ?? 0;
}

export const setRenderedPlayerVisualTransform = (
  playerId: string,
  position: { x: number; y: number; z: number },
  rotation: number
): void => {
  const state = visualStore.getState();
  const current = state.renderedPlayerPositions.get(playerId);
  if (current) {
    current.x = position.x;
    current.y = position.y;
    current.z = position.z;
  } else {
    state.renderedPlayerPositions.set(playerId, { x: position.x, y: position.y, z: position.z });
  }

  state.renderedPlayerRotations.set(playerId, rotation);
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

export const setBattleRoyalFirstPersonDropBodyVisibleUntil = (untilMs: number): void => {
  const nextUntilMs = Number.isFinite(untilMs) ? Math.max(0, untilMs) : 0;
  const currentUntilMs = visualStore.getState().battleRoyalFirstPersonDropBodyVisibleUntilMs;
  const effectiveUntilMs = nextUntilMs > 0 ? Math.max(currentUntilMs, nextUntilMs) : 0;
  if (currentUntilMs === effectiveUntilMs) return;

  recordHotStoreCommit('visual.battleRoyalFirstPersonDropBody');
  visualStore.setState({ battleRoyalFirstPersonDropBodyVisibleUntilMs: effectiveUntilMs });
};

export const setLocalSlideIntensity = (intensity: number, velocity?: Vec3, viewYaw?: number): void => {
  const state = visualStore.getState();
  const nextIntensity = Math.max(0, Math.min(1, intensity));
  if (state.slideIntensity !== nextIntensity) {
    state.slideIntensity = nextIntensity;
  }

  if (typeof viewYaw === 'number') {
    state.localViewYaw = viewYaw;
  }

  if (velocity && nextIntensity > 0) {
    state.localSlideVelocity.x = velocity.x;
    state.localSlideVelocity.y = velocity.y;
    state.localSlideVelocity.z = velocity.z;
  } else {
    state.localSlideVelocity.x = 0;
    state.localSlideVelocity.y = 0;
    state.localSlideVelocity.z = 0;
  }
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
  if (impulses.length === 0) return EMPTY_LOCAL_PLAYER_IMPULSES;

  recordHotStoreCommit('visual.localPlayerImpulses');
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
  recordHotStoreCommit('visual.cameraShake');
  visualStore.setState({ cameraShake: { intensity, time } });
};

/**
 * Set FOV adjustment during slide ability.
 *
 * @param fov - FOV offset from default (0 = no adjustment)
 */
export const setSlideFov = (fov: number): void => {
  recordHotStoreCommit('visual.slideFov');
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
  snapshot: Omit<RemoteTransformSnapshot, 'receivedAtMs'>,
  receivedAtMs = Date.now()
): void => {
  const histories = visualStore.getState().remoteTransformHistories;
  let history = histories.get(playerId);
  const last = history?.snapshots[history.snapshots.length - 1] ?? null;
  if (!history || (last && last.movementEpoch !== snapshot.movementEpoch)) {
    history = createRemoteTransformHistory(snapshot.serverTime, receivedAtMs);
    histories.set(playerId, history);
  }

  const fullSnapshot = { ...snapshot, receivedAtMs };
  const snapshots = history.snapshots;
  const latest = snapshots[snapshots.length - 1];
  const isNewestSnapshot = !latest || fullSnapshot.serverTime >= latest.serverTime;
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
  if (isNewestSnapshot) {
    if (latest) {
      updateRemoteTransformTiming(history, latest, fullSnapshot);
    }
    history.latestServerTime = snapshot.serverTime;
    history.latestReceivedAtMs = receivedAtMs;
  }
};

export const pruneRemoteTransformHistories = (activePlayerIds: ReadonlySet<string>): void => {
  const state = visualStore.getState();
  for (const playerId of state.remoteTransformHistories.keys()) {
    if (!activePlayerIds.has(playerId)) {
      state.remoteTransformHistories.delete(playerId);
      state.interpolationTargets.delete(playerId);
      state.playerPositions.delete(playerId);
      state.playerRotations.delete(playerId);
      state.playerLookPitches.delete(playerId);
      state.renderedPlayerPositions.delete(playerId);
      state.renderedPlayerRotations.delete(playerId);
    }
  }
};

function writeInterpolatedRemoteTransform(
  target: SampledRemoteTransform,
  previous: RemoteTransformSnapshot,
  next: RemoteTransformSnapshot,
  renderServerTime: number
): void {
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
}

function writeExtrapolatedRemoteTransform(
  target: SampledRemoteTransform,
  latest: RemoteTransformSnapshot,
  renderServerTime: number
): void {
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
}

export const sampleRemoteTransformHistoryInto = (
  history: RemoteTransformHistory | null | undefined,
  target: SampledRemoteTransform,
  nowMs = Date.now()
): boolean => {
  if (!history || history.snapshots.length === 0) return false;

  const snapshots = history.snapshots;
  const latest = snapshots[snapshots.length - 1];
  const estimatedServerTime = latest.serverTime + Math.max(0, nowMs - latest.receivedAtMs);
  const interpolationDelayMs = Number.isFinite(history.interpolationDelayMs)
    ? history.interpolationDelayMs
    : MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS;
  const renderServerTime = estimatedServerTime - interpolationDelayMs;
  if (renderServerTime >= latest.serverTime) {
    writeExtrapolatedRemoteTransform(target, latest, renderServerTime);
    return true;
  }

  const latestIndex = snapshots.length - 1;
  const fastPathSegments = Math.min(REMOTE_TRANSFORM_TAIL_FAST_PATH_SEGMENTS, latestIndex);
  for (let offset = 1; offset <= fastPathSegments; offset++) {
    const next = snapshots[latestIndex - offset + 1];
    const previous = snapshots[latestIndex - offset];
    if (renderServerTime >= previous.serverTime) {
      writeInterpolatedRemoteTransform(target, previous, next, renderServerTime);
      return true;
    }
  }

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
    writeInterpolatedRemoteTransform(target, previous, next, renderServerTime);
    return true;
  }

  writeExtrapolatedRemoteTransform(target, latest, renderServerTime);
  return true;
};

export const sampleRemoteTransformInto = (
  playerId: string,
  target: SampledRemoteTransform,
  nowMs = Date.now()
): boolean => {
  return sampleRemoteTransformHistoryInto(
    visualStore.getState().remoteTransformHistories.get(playerId),
    target,
    nowMs
  );
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

function clearActiveCombatBuckets(cache: CombatVisualFrameCache): void {
  for (let i = 0; i < cache.activeBuckets.length; i++) {
    cache.activeBuckets[i].length = 0;
  }
  cache.activeBuckets.length = 0;
}

function getCombatBucket(
  cache: CombatVisualFrameCache,
  cellX: number,
  cellZ: number
): CombatVisualPlayer[] {
  const key = getCombatBucketKeyForCell(cellX, cellZ);
  let bucket = cache.buckets.get(key);
  if (!bucket) {
    bucket = [];
    cache.buckets.set(key, bucket);
  }
  if (bucket.length === 0) {
    cache.activeBuckets.push(bucket);
  }
  return bucket;
}

function getCombatBucketKeyForCell(cellX: number, cellZ: number): number {
  return (cellX + COMBAT_VISUAL_BUCKET_KEY_CELL_OFFSET) * COMBAT_VISUAL_BUCKET_KEY_CELL_STRIDE +
    (cellZ + COMBAT_VISUAL_BUCKET_KEY_CELL_OFFSET);
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
  clearActiveCombatBuckets(cache);

  let entryIndex = 0;
  for (const player of players) {
    if (player.state !== 'alive' && player.state !== 'downed') continue;
    if (player.visibility === 'hidden' || player.visibility === 'last_known' || player.visibility === 'audible') continue;
    const hitbox = getCombatVisualHitboxMetrics(player.heroId);
    let visualPlayer = cache.entryPool[entryIndex];
    if (!visualPlayer) {
      visualPlayer = {
        player,
        id: player.id,
        team: player.team,
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        hitboxRadius: hitbox.radius,
        hitboxSegmentHalfHeight: hitbox.segmentHalfHeight,
      };
      cache.entryPool[entryIndex] = visualPlayer;
    } else {
      visualPlayer.player = player;
      visualPlayer.id = player.id;
      visualPlayer.team = player.team;
      visualPlayer.x = player.position.x;
      visualPlayer.y = player.position.y;
      visualPlayer.z = player.position.z;
      visualPlayer.hitboxRadius = hitbox.radius;
      visualPlayer.hitboxSegmentHalfHeight = hitbox.segmentHalfHeight;
    }
    entryIndex++;
    cache.alivePlayers.push(visualPlayer);

    const bucket = getCombatBucket(
      cache,
      Math.floor(visualPlayer.x / cache.cellSize),
      Math.floor(visualPlayer.z / cache.cellSize)
    );
    bucket.push(visualPlayer);
  }

  return cache;
};

function isEnemyCombatVisualPlayer(
  visualPlayer: CombatVisualPlayer,
  ownerTeam: Team | null | undefined,
  ownerId: string
): boolean {
  return visualPlayer.id !== ownerId && (!ownerTeam || visualPlayer.team !== ownerTeam);
}

export type CombatVisualTargetTeam = 'enemy' | 'any';

function isCombatVisualTargetPlayer(
  visualPlayer: CombatVisualPlayer,
  ownerTeam: Team | null | undefined,
  ownerId: string,
  targetTeam: CombatVisualTargetTeam
): boolean {
  if (visualPlayer.id === ownerId) return false;
  return targetTeam === 'any' || !ownerTeam || visualPlayer.team !== ownerTeam;
}

function doesCombatVisualPlayerPassRadius(
  visualPlayer: CombatVisualPlayer,
  center: Vec2Like,
  radiusSq: number
): boolean {
  const dx = visualPlayer.x - center.x;
  const dz = visualPlayer.z - center.z;
  return dx * dx + dz * dz <= radiusSq;
}

function shouldScanActiveCombatBuckets(
  cache: CombatVisualFrameCache,
  minCellX: number,
  maxCellX: number,
  minCellZ: number,
  maxCellZ: number
): boolean {
  const queryCellCount = (maxCellX - minCellX + 1) * (maxCellZ - minCellZ + 1);
  return cache.activeBuckets.length > 0 && cache.activeBuckets.length < queryCellCount;
}

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

    if (shouldScanActiveCombatBuckets(cache, minCellX, maxCellX, minCellZ, maxCellZ)) {
      for (let bucketIndex = 0; bucketIndex < cache.activeBuckets.length; bucketIndex++) {
        const bucket = cache.activeBuckets[bucketIndex];
        for (let i = 0; i < bucket.length; i++) {
          const visualPlayer = bucket[i];
          if (!isEnemyCombatVisualPlayer(visualPlayer, ownerTeam, ownerId)) continue;
          if (doesCombatVisualPlayerPassRadius(visualPlayer, center, radiusSq)) {
            target.push(visualPlayer.player);
          }
        }
      }
      return target;
    }

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = cache.buckets.get(getCombatBucketKeyForCell(cellX, cellZ));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const visualPlayer = bucket[i];
          if (!isEnemyCombatVisualPlayer(visualPlayer, ownerTeam, ownerId)) continue;
          if (doesCombatVisualPlayerPassRadius(visualPlayer, center, radiusSq)) {
            target.push(visualPlayer.player);
          }
        }
      }
    }
    return target;
  }

  for (let i = 0; i < cache.alivePlayers.length; i++) {
    const visualPlayer = cache.alivePlayers[i];
    if (isEnemyCombatVisualPlayer(visualPlayer, ownerTeam, ownerId)) {
      target.push(visualPlayer.player);
    }
  }

  return target;
};

export const findCombatVisualPlayerHit = (
  cache: CombatVisualFrameCache,
  ownerTeam: Team | null | undefined,
  ownerId: string,
  start: Vec3Like,
  direction: Vec3Like,
  distance: number,
  extraRadius = 0,
  center?: Vec2Like,
  radius?: number,
  targetTeam: CombatVisualTargetTeam = 'enemy'
): Player | null => {
  if (center && typeof radius === 'number') {
    const minCellX = Math.floor((center.x - radius) / cache.cellSize);
    const maxCellX = Math.floor((center.x + radius) / cache.cellSize);
    const minCellZ = Math.floor((center.z - radius) / cache.cellSize);
    const maxCellZ = Math.floor((center.z + radius) / cache.cellSize);
    const radiusSq = radius * radius;

    if (shouldScanActiveCombatBuckets(cache, minCellX, maxCellX, minCellZ, maxCellZ)) {
      for (let bucketIndex = 0; bucketIndex < cache.activeBuckets.length; bucketIndex++) {
        const bucket = cache.activeBuckets[bucketIndex];
        for (let i = 0; i < bucket.length; i++) {
          const visualPlayer = bucket[i];
          if (!isCombatVisualTargetPlayer(visualPlayer, ownerTeam, ownerId, targetTeam)) continue;
          if (!doesCombatVisualPlayerPassRadius(visualPlayer, center, radiusSq)) continue;
          if (
            doesSegmentHitVerticalCapsule(
              start,
              direction,
              distance,
              visualPlayer,
              visualPlayer.hitboxRadius + extraRadius,
              visualPlayer.hitboxSegmentHalfHeight
            )
          ) {
            return visualPlayer.player;
          }
        }
      }

      return null;
    }

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = cache.buckets.get(getCombatBucketKeyForCell(cellX, cellZ));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const visualPlayer = bucket[i];
          if (!isCombatVisualTargetPlayer(visualPlayer, ownerTeam, ownerId, targetTeam)) continue;
          if (!doesCombatVisualPlayerPassRadius(visualPlayer, center, radiusSq)) continue;
          if (
            doesSegmentHitVerticalCapsule(
              start,
              direction,
              distance,
              visualPlayer,
              visualPlayer.hitboxRadius + extraRadius,
              visualPlayer.hitboxSegmentHalfHeight
            )
          ) {
            return visualPlayer.player;
          }
        }
      }
    }

    return null;
  }

  for (let i = 0; i < cache.alivePlayers.length; i++) {
    const visualPlayer = cache.alivePlayers[i];
    if (!isCombatVisualTargetPlayer(visualPlayer, ownerTeam, ownerId, targetTeam)) continue;
    if (
      doesSegmentHitVerticalCapsule(
        start,
        direction,
        distance,
        visualPlayer,
        visualPlayer.hitboxRadius + extraRadius,
        visualPlayer.hitboxSegmentHalfHeight
      )
    ) {
      return visualPlayer.player;
    }
  }

  return null;
};

export const findCombatVisualEnemyPlayerHit = (
  cache: CombatVisualFrameCache,
  ownerTeam: Team | null | undefined,
  ownerId: string,
  start: Vec3Like,
  direction: Vec3Like,
  distance: number,
  extraRadius = 0,
  center?: Vec2Like,
  radius?: number
): Player | null => findCombatVisualPlayerHit(
  cache,
  ownerTeam,
  ownerId,
  start,
  direction,
  distance,
  extraRadius,
  center,
  radius,
  'enemy'
);

export const clearCombatVisualFrameCache = (): void => {
  const cache = visualStore.getState().combatFrameCache;
  cache.frameKey = -1;
  cache.builtAtMs = 0;
  cache.sourceSize = 0;
  cache.alivePlayers.length = 0;
  cache.activeBuckets.length = 0;
  cache.buckets.clear();
};

function removeIndexedPlayerId(ids: string[], idSet: Set<string>, playerId: string): boolean {
  if (!idSet.delete(playerId)) return false;
  const index = ids.indexOf(playerId);
  if (index >= 0) {
    ids.splice(index, 1);
  }
  return true;
}

function setIndexedPlayerId(ids: string[], idSet: Set<string>, playerId: string, active: boolean): boolean {
  if (active) {
    if (idSet.has(playerId)) return false;
    idSet.add(playerId);
    ids.push(playerId);
    return true;
  }

  return removeIndexedPlayerId(ids, idSet, playerId);
}

function isVisibleLiveEffectPlayer(player: Player): boolean {
  return (
    player.state === 'alive' &&
    player.visibility !== 'hidden' &&
    player.visibility !== 'last_known' &&
    player.visibility !== 'audible'
  );
}

function hasActiveChronosAscendant(player: Player, nowMs: number): boolean {
  if (player.heroId !== 'chronos' || !isVisibleLiveEffectPlayer(player)) return false;

  const ability = player.abilities?.[CHRONOS_ASCENDANT_ABILITY_ID];
  if (!ability?.isActive) return false;

  const activatedAt = ability.activatedAt ?? nowMs;
  return nowMs - activatedAt < CHRONOS_ASCENDANT_PARADOX_DURATION_MS;
}

export const syncPlayerVisualEffectIndexes = (
  player: Player,
  options: { localPlayerId?: string | null; nowMs?: number } = {}
): void => {
  const state = visualStore.getState();
  const localPlayerId = options.localPlayerId ?? null;
  const nowMs = options.nowMs ?? Date.now();
  const isLocalPlayer = player.id === localPlayerId;
  const visibleAlive = isVisibleLiveEffectPlayer(player);

  setIndexedPlayerId(
    state.activeBlazeFlamethrowerPlayerIds,
    state.activeBlazeFlamethrowerPlayerIdSet,
    player.id,
    !isLocalPlayer && visibleAlive && player.heroId === 'blaze' && player.movement.isJetpacking
  );
  setIndexedPlayerId(
    state.activeBlazeBurningPlayerIds,
    state.activeBlazeBurningPlayerIdSet,
    player.id,
    visibleAlive && (player.onFireUntil ?? 0) > nowMs
  );
  setIndexedPlayerId(
    state.activeChronosAscendantPlayerIds,
    state.activeChronosAscendantPlayerIdSet,
    player.id,
    hasActiveChronosAscendant(player, nowMs)
  );
};

/**
 * Remove a player from all visual state maps.
 * Call this when a player disconnects or is removed from the game.
 *
 * @param playerId - The player's unique ID to remove
 */
export const removePlayerLiveVisualState = (playerId: string): void => {
  const state = visualStore.getState();
  state.playerPositions.delete(playerId);
  state.playerRotations.delete(playerId);
  state.playerLookPitches.delete(playerId);
  state.renderedPlayerPositions.delete(playerId);
  state.renderedPlayerRotations.delete(playerId);
  state.interpolationTargets.delete(playerId);
  state.remoteTransformHistories.delete(playerId);
  state.chronosAegisStates.delete(playerId);
  state.remotePlayerAttackStates.delete(playerId);
  removeIndexedPlayerId(state.activeBlazeFlamethrowerPlayerIds, state.activeBlazeFlamethrowerPlayerIdSet, playerId);
  removeIndexedPlayerId(state.activeBlazeBurningPlayerIds, state.activeBlazeBurningPlayerIdSet, playerId);
  removeIndexedPlayerId(state.activeChronosAegisPlayerIds, state.activeChronosAegisPlayerIdSet, playerId);
  removeIndexedPlayerId(state.activeChronosAscendantPlayerIds, state.activeChronosAscendantPlayerIdSet, playerId);
};

export const removePlayerVisualState = (playerId: string): void => {
  removePlayerLiveVisualState(playerId);
  clearDeathVisualsForPlayer(playerId);
};

export const setChronosAegisVisualState = (
  playerId: string,
  active: boolean,
  timestampMs = Date.now(),
  durabilityRatio?: number,
  options: { renderWorldEffect?: boolean } = {}
): void => {
  const state = visualStore.getState();
  const states = state.chronosAegisStates;
  const current = states.get(playerId);
  const nextDurabilityRatio = durabilityRatio === undefined
    ? current?.durabilityRatio ?? 1
    : Math.max(0, Math.min(1, durabilityRatio));
  setIndexedPlayerId(
    state.activeChronosAegisPlayerIds,
    state.activeChronosAegisPlayerIdSet,
    playerId,
    active && options.renderWorldEffect === true
  );

  if (current) {
    if (active && !current.active) {
      current.activatedAtMs = timestampMs;
    }
    current.active = active;
    current.updatedAtMs = timestampMs;
    current.durabilityRatio = nextDurabilityRatio;
    return;
  }

  states.set(playerId, {
    active,
    activatedAtMs: active ? timestampMs : 0,
    updatedAtMs: timestampMs,
    durabilityRatio: nextDurabilityRatio,
  });
};

export const triggerRemotePlayerAttack = (
  playerId: string,
  abilityId: string,
  options: { side?: -1 | 1; startedAtMs?: number } = {}
): void => {
  const attacks = visualStore.getState().remotePlayerAttackStates;
  const current = attacks.get(playerId);
  const startedAtMs = options.startedAtMs ?? Date.now();
  const side = options.side ?? 1;
  if (current) {
    current.abilityId = abilityId;
    current.startedAtMs = startedAtMs;
    current.side = side;
    return;
  }

  attacks.set(playerId, { abilityId, startedAtMs, side });
};

function cloneMovementState(movement: PlayerMovementState): PlayerMovementState {
  return {
    ...movement,
    grapplePoint: movement.grapplePoint ? { ...movement.grapplePoint } : null,
  };
}

function cloneDeathVisualSnapshot(snapshot: DeathVisualSnapshot): DeathVisualSnapshot {
  return {
    ...snapshot,
    position: { ...snapshot.position },
    velocity: { ...snapshot.velocity },
    sourceDirection: snapshot.sourceDirection ? { ...snapshot.sourceDirection } : null,
    movement: cloneMovementState(snapshot.movement),
  };
}

function bumpDeathVisualRevision(state = visualStore.getState()): void {
  recordHotStoreCommit('visual.deathVisuals');
  visualStore.setState({ deathVisualRevision: state.deathVisualRevision + 1 });
}

export const addDeathVisual = (snapshot: DeathVisualSnapshot): boolean => {
  const state = visualStore.getState();
  const visuals = state.deathVisuals;
  const existingSameId = visuals.get(snapshot.id);

  if (existingSameId) {
    return false;
  }

  for (const [id, existing] of visuals) {
    if (existing.playerId === snapshot.playerId) {
      visuals.delete(id);
    }
  }

  visuals.set(snapshot.id, cloneDeathVisualSnapshot(snapshot));
  bumpDeathVisualRevision(state);
  return true;
};

export const removeDeathVisual = (id: string): boolean => {
  const state = visualStore.getState();
  if (!state.deathVisuals.delete(id)) return false;
  bumpDeathVisualRevision(state);
  return true;
};

export const clearDeathVisualsForPlayer = (playerId: string): number => {
  const state = visualStore.getState();
  let removed = 0;

  for (const [id, snapshot] of state.deathVisuals) {
    if (snapshot.playerId === playerId) {
      state.deathVisuals.delete(id);
      removed++;
    }
  }

  if (removed > 0) {
    bumpDeathVisualRevision(state);
  }

  return removed;
};

export const clearAllDeathVisuals = (): number => {
  const state = visualStore.getState();
  const removed = state.deathVisuals.size;
  if (removed === 0) return 0;

  state.deathVisuals.clear();
  bumpDeathVisualRevision(state);
  return removed;
};

export const updateDeathVisualExpirationForPlayer = (
  playerId: string,
  expiresAtMs: number | null | undefined
): boolean => {
  if (!Number.isFinite(expiresAtMs)) return false;

  const state = visualStore.getState();
  let changed = false;

  for (const [id, snapshot] of state.deathVisuals) {
    if (snapshot.playerId !== playerId) continue;

    const nextExpiresAtMs = Math.max(snapshot.startedAtMs + 1, expiresAtMs as number);
    if (Math.abs(snapshot.expiresAtMs - nextExpiresAtMs) <= 1) continue;

    state.deathVisuals.set(id, {
      ...snapshot,
      expiresAtMs: nextExpiresAtMs,
    });
    changed = true;
  }

  if (changed) {
    bumpDeathVisualRevision(state);
  }

  return changed;
};

export const clearExpiredDeathVisuals = (nowMs = Date.now()): number => {
  const state = visualStore.getState();
  let removed = 0;

  for (const [id, snapshot] of state.deathVisuals) {
    if (snapshot.expiresAtMs <= nowMs) {
      state.deathVisuals.delete(id);
      removed++;
    }
  }

  if (removed > 0) {
    bumpDeathVisualRevision(state);
  }

  return removed;
};

export const getDeathVisualForPlayer = (
  playerId: string,
  nowMs = Date.now()
): DeathVisualSnapshot | null => {
  let newest: DeathVisualSnapshot | null = null;

  for (const snapshot of visualStore.getState().deathVisuals.values()) {
    if (snapshot.playerId !== playerId || snapshot.expiresAtMs <= nowMs) continue;
    if (!newest || snapshot.startedAtMs > newest.startedAtMs) {
      newest = snapshot;
    }
  }

  return newest;
};

export const getActiveDeathVisuals = (nowMs = Date.now()): DeathVisualSnapshot[] => {
  const snapshots: DeathVisualSnapshot[] = [];

  for (const snapshot of visualStore.getState().deathVisuals.values()) {
    if (snapshot.expiresAtMs > nowMs) {
      snapshots.push(snapshot);
    }
  }

  snapshots.sort((a, b) => b.startedAtMs - a.startedAtMs);
  return snapshots;
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
  recordHotStoreCommit('visual.clear');
  visualStore.setState((state) => ({
    playerPositions: new Map(),
    playerRotations: new Map(),
    playerLookPitches: new Map(),
    renderedPlayerPositions: new Map(),
    renderedPlayerRotations: new Map(),
    cameraShake: { intensity: 0, time: 0 },
    slideFov: 0,
    interpolationTargets: new Map(),
    remoteTransformHistories: new Map(),
    flamethrowerOrigin: null,
    flamethrowerDirection: { x: 0, y: 0, z: -1 },
    chronosAegisStates: new Map(),
    remotePlayerAttackStates: new Map(),
    deathVisuals: new Map(),
    deathVisualRevision: state.deathVisualRevision + 1,
    localViewmodelMovement: {
      hasMovementInput: false,
      isSprinting: false,
      horizontalSpeed: 0,
      updatedAtMs: 0,
    },
    localMovement: { ...DEFAULT_LOCAL_MOVEMENT },
    battleRoyalFirstPersonDropBodyVisibleUntilMs: 0,
    slideIntensity: 0,
    localSlideVelocity: { x: 0, y: 0, z: 0 },
    localViewYaw: 0,
    localPlayerImpulses: [],
    combatFrameCache: createCombatFrameCache(),
    activeBlazeFlamethrowerPlayerIds: [],
    activeBlazeFlamethrowerPlayerIdSet: new Set(),
    activeBlazeBurningPlayerIds: [],
    activeBlazeBurningPlayerIdSet: new Set(),
    activeChronosAegisPlayerIds: [],
    activeChronosAegisPlayerIdSet: new Set(),
    activeChronosAscendantPlayerIds: [],
    activeChronosAscendantPlayerIdSet: new Set(),
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
