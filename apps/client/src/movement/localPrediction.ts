import type { MovementCommand, Player, SelfMovementAuthority, Vec3 } from '@voxel-strike/shared';
import {
  MOVEMENT_PROTOCOL_VERSION,
  BLAZE_ROCKET_JUMP_HORIZONTAL_FORCE,
  BLAZE_ROCKET_JUMP_VERTICAL_FORCE,
  PHANTOM_BLINK_DISTANCE,
  PHANTOM_SHADOWSTEP_DISTANCE,
  inputStateToMovementButtons,
  isCollisionBlock,
  isMovementSeqAfter,
  nextMovementSeq,
  createProceduralTerrainLookup,
  getHeroStats,
  sanitizeMovementCommand,
} from '@voxel-strike/shared';
import type { InputState } from '@voxel-strike/shared';
import {
  MovementPredictionController,
  type MovementPredictionContext,
  type MovementSimulationState,
} from '@voxel-strike/physics';
import type { MovementTerrainAdapter } from '@voxel-strike/physics';
import { getActiveProceduralMap } from '../hooks/usePhysics';
import { setPlayerVisualPosition, setPlayerVisualRotation } from '../store/visualStore';

export const localMovementPrediction = new MovementPredictionController();

let nextCommandSeq = 1;
let predictedPlayerId: string | null = null;
let cachedMapId: string | null = null;
let cachedTerrainLookup: ReturnType<typeof createProceduralTerrainLookup> | null = null;

const fallbackTerrain: MovementTerrainAdapter = {
  getGroundY: () => 0,
  clampPosition: (position) => ({ ...position }),
};

const LOCAL_PLAYER_RADIUS = 0.45;
const LOCAL_PLAYER_DIAGONAL_RADIUS = LOCAL_PLAYER_RADIUS * 0.707;
const LOCAL_PLAYER_SPACE_OFFSETS = [
  { x: 0, z: 0 },
  { x: LOCAL_PLAYER_RADIUS, z: 0 },
  { x: -LOCAL_PLAYER_RADIUS, z: 0 },
  { x: 0, z: LOCAL_PLAYER_RADIUS },
  { x: 0, z: -LOCAL_PLAYER_RADIUS },
  { x: LOCAL_PLAYER_DIAGONAL_RADIUS, z: LOCAL_PLAYER_DIAGONAL_RADIUS },
  { x: LOCAL_PLAYER_DIAGONAL_RADIUS, z: -LOCAL_PLAYER_DIAGONAL_RADIUS },
  { x: -LOCAL_PLAYER_DIAGONAL_RADIUS, z: LOCAL_PLAYER_DIAGONAL_RADIUS },
  { x: -LOCAL_PLAYER_DIAGONAL_RADIUS, z: -LOCAL_PLAYER_DIAGONAL_RADIUS },
] as const;
const LOCAL_PLAYER_SPACE_Y_SAMPLES = [-0.35, 0.15, 0.65] as const;

export function resetLocalMovementPrediction(
  state?: MovementSimulationState,
  movementEpoch = 0,
  playerId: string | null = null
): void {
  nextCommandSeq = 1;
  predictedPlayerId = playerId;
  cachedMapId = null;
  cachedTerrainLookup = null;
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
  };
}

export function getLocalPredictionContext(player: Player): MovementPredictionContext {
  return {
    heroStats: getHeroStats(player.heroId ?? 'phantom'),
    terrain: getClientTerrainAdapter(),
    flagCarrier: player.hasFlag,
    activeSpeedMultiplier: 1,
  };
}

export function createLocalMovementCommand(input: InputState, options: {
  lookYaw: number;
  lookPitch: number;
  clientTimeMs: number;
  movementEpoch?: number;
  unstuck?: boolean;
  crouchPressed?: boolean;
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
    collisionRevision: 0,
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

function isLocalPlayerSpaceBlocked(position: Vec3): boolean {
  const lookup = getClientProceduralTerrainLookup();
  if (!lookup) return false;

  for (const yOffset of LOCAL_PLAYER_SPACE_Y_SAMPLES) {
    for (const offset of LOCAL_PLAYER_SPACE_OFFSETS) {
      if (isCollisionBlock(lookup.getBlockAtWorld({
        x: position.x + offset.x,
        y: position.y + yOffset,
        z: position.z + offset.z,
      }))) {
        return true;
      }
    }
  }

  return false;
}

function isLocalPlayerPathBlocked(previous: Vec3, next: Vec3): boolean {
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  const dz = next.z - previous.z;
  const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
  const steps = Math.max(1, Math.ceil(horizontalDistance / 0.25));

  for (let index = 1; index <= steps; index++) {
    const t = index / steps;
    if (isLocalPlayerSpaceBlocked({
      x: previous.x + dx * t,
      y: previous.y + dy * t,
      z: previous.z + dz * t,
    })) {
      return true;
    }
  }

  return false;
}

function resolveLocalPhantomBlinkDestination(
  state: MovementSimulationState,
  yaw: number,
  pitch: number,
  distance: number
): Vec3 {
  const lookup = getClientProceduralTerrainLookup();
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

    if (isLocalPlayerPathBlocked(start, candidate)) continue;
    if (isLocalPlayerSpaceBlocked(candidate)) continue;
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
  const rawPosition = {
    x: current.position.x + forward.x * PHANTOM_SHADOWSTEP_DISTANCE,
    y: current.position.y,
    z: current.position.z + forward.z * PHANTOM_SHADOWSTEP_DISTANCE,
  };
  const position = lookup ? lookup.clampToPlayableMap(rawPosition) : rawPosition;

  return applyLocalPredictedState(player.id, {
    position,
    velocity: { ...current.velocity },
    movement: {
      ...current.movement,
      isSliding: false,
      slideTimeRemaining: 0,
    },
  }, lookYaw);
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

export function getCurrentPredictedVelocity(fallback: Vec3): Vec3 {
  const state = localMovementPrediction.getState();
  return state?.velocity ?? fallback;
}

export function setPredictedVisuals(playerId: string, position: Vec3, lookYaw: number): void {
  const visualPosition = localMovementPrediction.getVisualPosition(Date.now());
  setPlayerVisualPosition(playerId, {
    x: visualPosition.x,
    y: visualPosition.y,
    z: visualPosition.z,
  });
  setPlayerVisualRotation(playerId, lookYaw);
}

export function getCurrentPredictedPosition(fallback: Vec3): Vec3 {
  const state = localMovementPrediction.getState();
  return state?.position ?? fallback;
}
