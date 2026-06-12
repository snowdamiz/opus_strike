import type { AbilityCastOriginHint, MovementCommand, Player, SelfMovementAuthority, Vec3 } from '@voxel-strike/shared';
import {
  MOVEMENT_PROTOCOL_VERSION,
  ABILITY_DEFINITIONS,
  CHRONOS_ASCENDANT_PARADOX_DURATION_MS,
  CHRONOS_ASCENDANT_PARADOX_LIFT_FORWARD_FORCE,
  CHRONOS_ASCENDANT_PARADOX_LIFT_POSITION_BOOST,
  CHRONOS_ASCENDANT_PARADOX_LIFT_VERTICAL_FORCE,
  CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER,
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  PHANTOM_BLINK_DISTANCE,
  PHANTOM_SHADOWSTEP_DISTANCE,
  inputStateToMovementButtons,
  isMovementSeqAfter,
  nextMovementSeq,
  createProceduralTerrainLookup,
  getHeroStats,
  sanitizeMovementCommand,
} from '@voxel-strike/shared';
import type { InputState } from '@voxel-strike/shared';
import {
  MovementPredictionController,
  canCapsuleOccupy,
  computeAnchorWallAabbs,
  createVoxelCollisionWorld,
  sweepCapsulePathClear,
  type MovementCollisionWorld,
  type MovementPredictionContext,
  type MovementSimulationState,
} from '@voxel-strike/physics';
import type { MovementTerrainAdapter } from '@voxel-strike/physics';
import { getActiveProceduralMap } from '../hooks/usePhysics';
import { useGameStore } from '../store/gameStore';
import { setPlayerVisualTransform } from '../store/visualStore';

export const localMovementPrediction = new MovementPredictionController();

let nextCommandSeq = 1;
let predictedPlayerId: string | null = null;
let cachedMapId: string | null = null;
let cachedTerrainLookup: ReturnType<typeof createProceduralTerrainLookup> | null = null;
let cachedCollisionWorld: { mapId: string | null; revision: number; world: MovementCollisionWorld } | null = null;
let latestServerCollisionRevision = 0;

const fallbackTerrain: MovementTerrainAdapter = {
  getGroundY: () => 0,
  clampPosition: (position) => ({ ...position }),
};

export function resetLocalMovementPrediction(
  state?: MovementSimulationState,
  movementEpoch = 0,
  playerId: string | null = null
): void {
  nextCommandSeq = 1;
  predictedPlayerId = playerId;
  cachedMapId = null;
  cachedTerrainLookup = null;
  cachedCollisionWorld = null;
  latestServerCollisionRevision = 0;
  if (state) {
    localMovementPrediction.initialize(state, movementEpoch, 0);
  } else {
    localMovementPrediction.reset();
  }
}

export function movementStateFromPlayer(player: Player): MovementSimulationState {
  return {
    position: { ...player.position },
    velocity: { ...player.velocity },
    movement: {
      ...player.movement,
      grapplePoint: player.movement.grapplePoint ? { ...player.movement.grapplePoint } : null,
    },
  };
}

export function ensureLocalPredictionInitialized(player: Player): void {
  if (localMovementPrediction.hasState() && predictedPlayerId === player.id) return;
  nextCommandSeq = 1;
  predictedPlayerId = player.id;
  localMovementPrediction.initialize(movementStateFromPlayer(player), 0, 0);
}

function getClientProceduralTerrainLookup(): ReturnType<typeof createProceduralTerrainLookup> | null {
  const activeMap = getActiveProceduralMap();
  if (!activeMap) return null;

  if (cachedMapId !== activeMap.id || !cachedTerrainLookup) {
    cachedMapId = activeMap.id;
    cachedTerrainLookup = createProceduralTerrainLookup(activeMap);
  }

  return cachedTerrainLookup;
}

function getClientTerrainAdapter(): MovementTerrainAdapter {
  const lookup = getClientProceduralTerrainLookup();
  if (!lookup) return fallbackTerrain;

  return {
    getGroundY: (position) => lookup.getGroundY(position),
    clampPosition: (position) => lookup.clampToPlayableMap(position),
    getBlockAtWorld: (position) => lookup.getBlockAtWorld(position),
    origin: lookup.origin,
    voxelSize: lookup.voxelSize,
    collisionRevision: latestServerCollisionRevision,
    cacheStaticAabbs: true,
    getCollisionAabbs: (bounds) => computeAnchorWallAabbs(
      useGameStore.getState().earthWalls,
      Date.now(),
      bounds
    ),
  };
}

function getClientCollisionWorld(): MovementCollisionWorld {
  const terrain = getClientTerrainAdapter();
  const mapId = cachedMapId;
  const revision = latestServerCollisionRevision;
  if (cachedCollisionWorld && cachedCollisionWorld.mapId === mapId && cachedCollisionWorld.revision === revision) {
    return cachedCollisionWorld.world;
  }

  const world = createVoxelCollisionWorld(terrain);
  cachedCollisionWorld = { mapId, revision, world };
  return world;
}

export function getLocalPredictionContext(player: Player): MovementPredictionContext {
  let activeSpeedMultiplier = 1;
  const phantomVeil = player.heroId === 'phantom' ? player.abilities?.['phantom_veil'] : undefined;
  if (phantomVeil?.isActive) {
    const activatedAt = phantomVeil.activatedAt ?? Date.now();
    const durationMs = (ABILITY_DEFINITIONS['phantom_veil']?.duration ?? 0) * 1000;
    if (durationMs <= 0 || Date.now() - activatedAt < durationMs) {
      activeSpeedMultiplier *= 1.3;
    }
  }

  const chronosAscendantActive = isChronosAscendantActive(player);
  if (chronosAscendantActive) {
    activeSpeedMultiplier *= CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER;
  }

  return {
    heroStats: getHeroStats(player.heroId ?? 'phantom'),
    terrain: getClientTerrainAdapter(),
    collisionWorld: getClientCollisionWorld(),
    flagCarrier: player.hasFlag,
    activeSpeedMultiplier,
    chronosAscendantActive,
  };
}

export function createLocalMovementCommand(input: InputState, options: {
  lookYaw: number;
  lookPitch: number;
  clientTimeMs: number;
  movementEpoch?: number;
  unstuck?: boolean;
  crouchPressed?: boolean;
  abilityCastHints?: AbilityCastOriginHint[];
}): MovementCommand {
  const command = sanitizeMovementCommand({
    seq: nextCommandSeq,
    buttons: inputStateToMovementButtons(input, {
      unstuck: options.unstuck,
      crouchPressed: options.crouchPressed,
    }),
    lookYaw: options.lookYaw,
    lookPitch: options.lookPitch,
    clientTimeMs: options.clientTimeMs,
    movementEpoch: options.movementEpoch ?? localMovementPrediction.getMovementEpoch(),
    collisionRevision: latestServerCollisionRevision,
    abilityCastHints: options.abilityCastHints,
  });
  nextCommandSeq = nextMovementSeq(nextCommandSeq);
  return command;
}

export function createMovementCommandPacket(commands: MovementCommand[]) {
  return {
    protocolVersion: MOVEMENT_PROTOCOL_VERSION,
    firstSeq: commands[0]?.seq ?? 0,
    commands,
  };
}

function horizontalForwardFromYaw(yaw: number): { x: number; z: number } {
  return {
    x: -Math.sin(yaw),
    z: -Math.cos(yaw),
  };
}

function isChronosAscendantActive(player: Player, now = Date.now()): boolean {
  if (player.heroId !== 'chronos') return false;

  const ascendant = player.abilities?.['chronos_ascendant_paradox'];
  if (!ascendant?.isActive) return false;

  const activatedAt = ascendant.activatedAt ?? now;
  return now - activatedAt < CHRONOS_ASCENDANT_PARADOX_DURATION_MS;
}

function resolveLocalPhantomBlinkDestination(
  state: MovementSimulationState,
  yaw: number,
  pitch: number,
  distance: number
): Vec3 {
  const lookup = getClientProceduralTerrainLookup();
  const world = getClientCollisionWorld();
  const forward = horizontalForwardFromYaw(yaw);
  const start = state.position;
  const verticalOffset = pitch < -0.3 ? 2 : 0;

  for (let testDistance = distance; testDistance >= 2; testDistance -= 0.5) {
    const rawCandidate = {
      x: start.x + forward.x * testDistance,
      y: start.y + verticalOffset,
      z: start.z + forward.z * testDistance,
    };
    const candidate = lookup ? lookup.clampToPlayableMap(rawCandidate) : rawCandidate;

    if (!sweepCapsulePathClear(world, start, candidate)) continue;
    if (!canCapsuleOccupy(world, candidate)) continue;
    return candidate;
  }

  return { ...start };
}

function applyLocalPredictedState(playerId: string, state: MovementSimulationState, lookYaw: number): MovementSimulationState {
  localMovementPrediction.overwriteState(state, { updateLatestCommandRecord: false });
  setPredictedVisuals(playerId, state.position, lookYaw);
  return state;
}

export function predictLocalPhantomBlink(player: Player, lookYaw: number, lookPitch: number): MovementSimulationState {
  ensureLocalPredictionInitialized(player);
  const current = localMovementPrediction.getState() ?? movementStateFromPlayer(player);
  const forward = horizontalForwardFromYaw(lookYaw);
  const position = resolveLocalPhantomBlinkDestination(
    current,
    lookYaw,
    lookPitch,
    PHANTOM_BLINK_DISTANCE
  );

  return applyLocalPredictedState(player.id, {
    position,
    velocity: {
      ...current.velocity,
      x: forward.x * 2,
      z: forward.z * 2,
    },
    movement: {
      ...current.movement,
      isGrounded: false,
      isSliding: false,
      slideTimeRemaining: 0,
    },
  }, lookYaw);
}

export function predictLocalPhantomShadowStep(player: Player, lookYaw: number): MovementSimulationState {
  ensureLocalPredictionInitialized(player);
  const current = localMovementPrediction.getState() ?? movementStateFromPlayer(player);
  const forward = horizontalForwardFromYaw(lookYaw);
  const lookup = getClientProceduralTerrainLookup();
  const world = getClientCollisionWorld();
  const rawPosition = {
    x: current.position.x + forward.x * PHANTOM_SHADOWSTEP_DISTANCE,
    y: current.position.y,
    z: current.position.z + forward.z * PHANTOM_SHADOWSTEP_DISTANCE,
  };
  const position = lookup ? lookup.clampToPlayableMap(rawPosition) : rawPosition;
  const validatedPosition = sweepCapsulePathClear(world, current.position, position) && canCapsuleOccupy(world, position)
    ? position
    : current.position;

  return applyLocalPredictedState(player.id, {
    position: validatedPosition,
    velocity: { ...current.velocity },
    movement: {
      ...current.movement,
      isSliding: false,
      slideTimeRemaining: 0,
    },
  }, lookYaw);
}

export function addLocalMovementImpulse(impulse: Vec3, mode: 'add' | 'set' = 'add'): MovementSimulationState | null {
  const current = localMovementPrediction.getState();
  if (!current) return null;

  const next: MovementSimulationState = {
    position: { ...current.position },
    velocity: mode === 'set'
      ? { ...impulse }
      : {
        x: current.velocity.x + impulse.x,
        y: current.velocity.y + impulse.y,
        z: current.velocity.z + impulse.z,
      },
    movement: {
      ...current.movement,
      grapplePoint: current.movement.grapplePoint ? { ...current.movement.grapplePoint } : null,
    },
  };

  if (impulse.y > 0) {
    next.movement.isGrounded = false;
  }
  if (impulse.x !== 0 || impulse.z !== 0) {
    next.movement.isSliding = false;
    next.movement.slideTimeRemaining = 0;
  }

  localMovementPrediction.overwriteState(next, { updateLatestCommandRecord: true });
  return next;
}

export function predictLocalBlazeRocketJump(player: Player, lookYaw: number): MovementSimulationState {
  ensureLocalPredictionInitialized(player);
  const current = localMovementPrediction.getState() ?? movementStateFromPlayer(player);
  const forward = horizontalForwardFromYaw(lookYaw);

  return applyLocalPredictedState(player.id, {
    position: {
      ...current.position,
      y: current.position.y + 0.5,
    },
    velocity: {
      x: current.velocity.x + forward.x * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
      y: BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
      z: current.velocity.z + forward.z * BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
    },
    movement: {
      ...current.movement,
      isGrounded: false,
      isSliding: false,
      slideTimeRemaining: 0,
    },
  }, lookYaw);
}

export function predictLocalChronosAscendantParadox(player: Player, lookYaw: number): MovementSimulationState {
  ensureLocalPredictionInitialized(player);
  const current = localMovementPrediction.getState() ?? movementStateFromPlayer(player);
  const forward = horizontalForwardFromYaw(lookYaw);

  return applyLocalPredictedState(player.id, {
    position: {
      ...current.position,
      y: current.position.y + CHRONOS_ASCENDANT_PARADOX_LIFT_POSITION_BOOST,
    },
    velocity: {
      x: current.velocity.x + forward.x * CHRONOS_ASCENDANT_PARADOX_LIFT_FORWARD_FORCE,
      y: Math.max(current.velocity.y, CHRONOS_ASCENDANT_PARADOX_LIFT_VERTICAL_FORCE),
      z: current.velocity.z + forward.z * CHRONOS_ASCENDANT_PARADOX_LIFT_FORWARD_FORCE,
    },
    movement: {
      ...current.movement,
      isGrounded: false,
      isSliding: false,
      slideTimeRemaining: 0,
      isJetpacking: true,
      isGliding: true,
      chronosAscendantStartY: current.position.y,
    },
  }, lookYaw);
}

export function confirmLocalMovementTransform(
  player: Player,
  transform: {
    position?: Vec3;
    velocity?: Vec3;
    movement?: Partial<MovementSimulationState['movement']>;
  },
  lookYaw: number
): MovementSimulationState {
  ensureLocalPredictionInitialized(player);
  const current = localMovementPrediction.getState() ?? movementStateFromPlayer(player);
  const hasGrapplePoint = Boolean(
    transform.movement &&
    Object.prototype.hasOwnProperty.call(transform.movement, 'grapplePoint')
  );

  return applyLocalPredictedState(player.id, {
    position: transform.position ? { ...transform.position } : current.position,
    velocity: transform.velocity ? { ...transform.velocity } : current.velocity,
    movement: {
      ...current.movement,
      ...transform.movement,
      grapplePoint: hasGrapplePoint && transform.movement?.grapplePoint
        ? { ...transform.movement.grapplePoint }
        : hasGrapplePoint
          ? null
          : current.movement.grapplePoint,
    },
  }, lookYaw);
}

function advanceNextCommandSeqPastAck(ackSeq: number): void {
  if (!isMovementSeqAfter(nextCommandSeq, ackSeq)) {
    nextCommandSeq = nextMovementSeq(ackSeq);
  }
}

export function applySelfMovementAuthority(player: Player, authority: SelfMovementAuthority) {
  ensureLocalPredictionInitialized(player);
  const nextCollisionRevision = authority.collisionRevision ?? latestServerCollisionRevision;
  if (nextCollisionRevision !== latestServerCollisionRevision) {
    cachedCollisionWorld = null;
  }
  latestServerCollisionRevision = nextCollisionRevision;
  const result = localMovementPrediction.reconcile(
    authority,
    getLocalPredictionContext(player),
    Date.now()
  );
  advanceNextCommandSeqPastAck(authority.ackSeq);
  const state = localMovementPrediction.getState() ?? movementStateFromPlayer(player);
  setPredictedVisuals(player.id, state.position, authority.lookYaw);
  return { result, state };
}

export function stepLocalMovementPrediction(player: Player, command: MovementCommand): MovementSimulationState {
  ensureLocalPredictionInitialized(player);
  return localMovementPrediction.step(command, getLocalPredictionContext(player));
}

export function getLocalMovementCollisionRevision(): number {
  return latestServerCollisionRevision;
}

export function getCurrentPredictedVelocity(fallback: Vec3): Vec3 {
  const state = localMovementPrediction.getState();
  return state?.velocity ?? fallback;
}

export function getCurrentPredictedState(fallback: MovementSimulationState): MovementSimulationState {
  return localMovementPrediction.getState() ?? fallback;
}

export function setPredictedVisuals(playerId: string, position: Vec3, lookYaw: number): void {
  const visualPosition = localMovementPrediction.getVisualPosition(Date.now());
  setPlayerVisualTransform(playerId, {
    x: visualPosition.x,
    y: visualPosition.y,
    z: visualPosition.z,
  }, lookYaw);
}

export function getCurrentPredictedPosition(fallback: Vec3): Vec3 {
  const state = localMovementPrediction.getState();
  return state?.position ?? fallback;
}

export function getCurrentPredictedVisualPosition(fallback: Vec3, nowMs = Date.now()): Vec3 {
  return localMovementPrediction.hasState()
    ? localMovementPrediction.getVisualPosition(nowMs)
    : fallback;
}
