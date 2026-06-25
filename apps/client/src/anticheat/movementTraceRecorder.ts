import {
  ANTI_CHEAT_MOVEMENT_TRACE_VERSION,
  inputStateToMovementButtons,
  normalizeMovementSeq,
  sanitizeMovementCommand,
  type AntiCheatMovementTrace,
  type AntiCheatMovementTraceFrame,
  type AntiCheatTraceAbilityState,
  type AntiCheatTraceTerrainContact,
  type HeroId,
  type InputState,
  type MatchMode,
  type MovementCommand,
  type MovementCorrectionReason,
  type PlayerMovementState,
  type PlayerState,
  type SelfMovementAuthority,
  type SelfMovementAck,
  type Vec3,
} from '@voxel-strike/shared';
import { config } from '../config/environment';

interface TraceMetadata {
  heroId: HeroId;
  matchMode: MatchMode;
  movementClass: string;
  mapSeed: number;
  frameRateBand: string;
  pingBandMs: string;
}

interface MovementTraceFrameInput extends TraceMetadata {
  tick: number;
  inputState: InputState;
  lookYaw: number;
  lookPitch: number;
  timestamp: number;
  position: Vec3;
  velocity: Vec3;
  movement: PlayerMovementState;
  playerState: PlayerState;
  health: number;
  flagCarrier: boolean;
  activeAbilityState: AntiCheatTraceAbilityState;
  terrainContact: AntiCheatTraceTerrainContact;
  crouchPressed?: boolean;
  objectiveSuppressed?: boolean;
  correctionReason?: MovementCorrectionReason;
}

interface MovementTraceWindowApi {
  snapshot: () => AntiCheatMovementTrace | null;
  snapshots: () => AntiCheatMovementTrace[];
  stop: () => AntiCheatMovementTrace | null;
  stopAll: () => AntiCheatMovementTrace[];
  download: () => string[] | null;
  clear: () => void;
}

declare global {
  interface Window {
    __VOXEL_STRIKE_MOVEMENT_TRACE__?: MovementTraceWindowApi;
  }
}

const DEFAULT_EXPECTED = {
  maxPositionDriftMeters: 0.85,
  maxVelocityDriftMetersPerSecond: 3,
  maxMovementStateMismatches: 12,
  maxUnexpectedCorrections: 0,
  allowedCorrectionReasons: ['normal', 'spawn', 'respawn', 'teleport', 'knockback', 'collision_revision'],
} as const;

let activeTrace: AntiCheatMovementTrace | null = null;
let lastCompletedTrace: AntiCheatMovementTrace | null = null;
let completedTraces: AntiCheatMovementTrace[] = [];
let latestAck: { ackSeq: number; movementEpoch: number } = { ackSeq: 0, movementEpoch: 0 };
let skippedBySample = false;

function shouldRecord(): boolean {
  if (!config.clientDiagnosticsEnabled) return false;
  if (!config.antiCheatMovementTraceRecorderEnabled) return false;
  if (config.antiCheatMovementTraceSampleRate <= 0) return false;
  if (skippedBySample) return false;
  return true;
}

export function isMovementTraceRecordingEnabled(): boolean {
  return shouldRecord();
}

function sampledIn(): boolean {
  if (config.antiCheatMovementTraceSampleRate >= 1) return true;
  return Math.random() < config.antiCheatMovementTraceSampleRate;
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function cloneMovement(value: PlayerMovementState): PlayerMovementState {
  return {
    ...value,
    grapplePoint: value.grapplePoint ? cloneVec3(value.grapplePoint) : null,
  };
}

function createTrace(metadata: TraceMetadata): AntiCheatMovementTrace | null {
  if (!sampledIn()) {
    skippedBySample = true;
    return null;
  }

  return {
    version: ANTI_CHEAT_MOVEMENT_TRACE_VERSION,
    traceId: `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    kind: 'legal',
    recordedBy: 'client_rapier',
    heroId: metadata.heroId,
    matchMode: metadata.matchMode,
    movementClass: metadata.movementClass,
    movementClasses: [metadata.movementClass],
    mapSeed: metadata.mapSeed >>> 0,
    frameRateBand: metadata.frameRateBand,
    pingBandMs: metadata.pingBandMs,
    privacy: {
      excludesNames: true,
      excludesWallets: true,
      excludesRawNetworkIds: true,
      excludesSecrets: true,
    },
    frames: [],
    expected: {
      ...DEFAULT_EXPECTED,
      allowedCorrectionReasons: [...DEFAULT_EXPECTED.allowedCorrectionReasons],
    },
  };
}

function makeCommand(input: MovementTraceFrameInput): MovementCommand {
  return sanitizeMovementCommand({
    seq: normalizeMovementSeq(input.tick),
    buttons: inputStateToMovementButtons(input.inputState, {
      crouchPressed: input.crouchPressed,
    }),
    lookYaw: input.lookYaw,
    lookPitch: input.lookPitch,
    clientTimeMs: input.timestamp,
    movementEpoch: latestAck.movementEpoch,
    collisionRevision: input.terrainContact.collisionRevision,
  });
}

function metadataChanged(trace: AntiCheatMovementTrace, input: TraceMetadata): boolean {
  return trace.heroId !== input.heroId ||
    trace.matchMode !== input.matchMode ||
    trace.mapSeed !== (input.mapSeed >>> 0);
}

function recordMovementClass(trace: AntiCheatMovementTrace, movementClass: string): void {
  const movementClasses = trace.movementClasses ?? [trace.movementClass];
  if (!movementClasses.includes(movementClass)) {
    movementClasses.push(movementClass);
    movementClasses.sort();
  }
  trace.movementClasses = movementClasses;
  if (movementClasses.length > 1) {
    trace.movementClass = 'mixed';
  }
}

function completeActiveTrace(): AntiCheatMovementTrace | null {
  if (activeTrace && activeTrace.frames.length > 0) {
    completedTraces.push(activeTrace);
    lastCompletedTrace = activeTrace;
  }
  activeTrace = null;
  return lastCompletedTrace;
}

function getAllMovementTraces(): AntiCheatMovementTrace[] {
  const traces = [...completedTraces];
  if (activeTrace && activeTrace.frames.length > 0) {
    traces.push(activeTrace);
  }
  return traces;
}

export function recordMovementTraceAuthorityAck(authority: SelfMovementAuthority | SelfMovementAck): void {
  if (!config.antiCheatMovementTraceRecorderEnabled) return;

  latestAck = {
    ackSeq: authority.ackSeq,
    movementEpoch: authority.movementEpoch,
  };
}

export function recordMovementTraceFrame(input: MovementTraceFrameInput): void {
  if (!shouldRecord()) return;

  if (!activeTrace || metadataChanged(activeTrace, input)) {
    completeActiveTrace();
    activeTrace = createTrace(input);
    if (!activeTrace) return;
  }

  if (activeTrace.frames.length >= config.antiCheatMovementTraceMaxFrames) {
    completeActiveTrace();
    return;
  }

  recordMovementClass(activeTrace, input.movementClass);
  const command = makeCommand(input);
  const frame: AntiCheatMovementTraceFrame = {
    seq: command.seq,
    command,
    movementClass: input.movementClass,
    clientTimeMs: input.timestamp,
    rapierPosition: cloneVec3(input.position),
    rapierVelocity: cloneVec3(input.velocity),
    movement: cloneMovement(input.movement),
    playerState: input.playerState,
    health: input.health,
    flagCarrier: input.flagCarrier,
    activeAbilityState: {
      activeAbilityIds: [...input.activeAbilityState.activeAbilityIds],
      activeSpeedMultiplier: input.activeAbilityState.activeSpeedMultiplier,
      movementBarrier: input.activeAbilityState.movementBarrier ?? null,
    },
    terrainContact: {
      ...input.terrainContact,
      mapSeed: input.terrainContact.mapSeed ?? input.mapSeed,
    },
    latestServerAck: latestAck,
    movementEpoch: latestAck.movementEpoch,
    objectiveSuppressed: input.objectiveSuppressed ?? false,
    correctionReason: input.correctionReason,
  };

  activeTrace.frames.push(frame);
}

export function finishMovementTrace(): AntiCheatMovementTrace | null {
  completeActiveTrace();
  skippedBySample = false;
  return lastCompletedTrace;
}

export function finishAllMovementTraces(): AntiCheatMovementTrace[] {
  completeActiveTrace();
  skippedBySample = false;
  return getAllMovementTraces();
}

export function getMovementTraceSnapshot(): AntiCheatMovementTrace | null {
  return activeTrace ?? lastCompletedTrace;
}

export function getMovementTraceSnapshots(): AntiCheatMovementTrace[] {
  return getAllMovementTraces();
}

export function clearMovementTrace(): void {
  activeTrace = null;
  lastCompletedTrace = null;
  completedTraces = [];
  skippedBySample = false;
}

function downloadTrace(trace: AntiCheatMovementTrace): string {
  const fileName = `${trace.traceId}.json`;
  const blob = new Blob([`${JSON.stringify(trace, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return fileName;
}

export function downloadMovementTrace(): string[] | null {
  const traces = getAllMovementTraces();
  if (traces.length === 0 || typeof window === 'undefined') return null;
  return traces.map((trace) => downloadTrace(trace));
}

if (config.clientDiagnosticsEnabled && typeof window !== 'undefined' && !window.__VOXEL_STRIKE_MOVEMENT_TRACE__) {
  window.__VOXEL_STRIKE_MOVEMENT_TRACE__ = {
    snapshot: getMovementTraceSnapshot,
    snapshots: getMovementTraceSnapshots,
    stop: finishMovementTrace,
    stopAll: finishAllMovementTraces,
    download: downloadMovementTrace,
    clear: clearMovementTrace,
  };
}
