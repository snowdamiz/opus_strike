import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { simulateSharedMovement, type MovementTerrainAdapter } from '@voxel-strike/physics';
import {
  ANTI_CHEAT_MOVEMENT_TRACE_VERSION,
  MOVEMENT_SUBSTEP_SECONDS,
  getHeroStats,
  movementButtonsToInputState,
  type AntiCheatMovementParityGateReport,
  type AntiCheatMovementTrace,
  type AntiCheatMovementTraceFrame,
  type AntiCheatMovementTraceReport,
  type AntiCheatMovementTraceReportFrame,
  type MovementCorrectionReason,
  type PlayerMovementState,
  type Vec3,
} from '@voxel-strike/shared';
import { validateMovementProposal } from '../rooms/movementValidation';

export type AntiCheatMovementTraceCorrection =
  | MovementCorrectionReason
  | 'duplicate_command'
  | 'objective_suppression';

export interface MovementParityGateOptions {
  corpus: 'smoke' | 'full' | 'all';
  traceRoot: string;
  outputPath?: string;
}

const MAX_TRACE_FRAMES = 5000;
const DEFAULT_BOUNDS = { minX: -100, maxX: 100, minY: -20, maxY: 120, minZ: -100, maxZ: 100 };
const MOVEMENT_STATE_KEYS: Array<keyof Pick<PlayerMovementState,
  'isGrounded' |
  'isSprinting' |
  'isCrouching' |
  'isSliding' |
  'isWallRunning' |
  'isGrappling' |
  'isJetpacking' |
  'isGliding'
>> = [
  'isGrounded',
  'isSprinting',
  'isCrouching',
  'isSliding',
  'isWallRunning',
  'isGrappling',
  'isJetpacking',
  'isGliding',
];

function assertVec3(value: unknown, label: string): asserts value is Vec3 {
  if (!value || typeof value !== 'object') throw new Error(`${label} must be an object`);
  const candidate = value as Vec3;
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y) || !Number.isFinite(candidate.z)) {
    throw new Error(`${label} must contain finite x/y/z`);
  }
}

function assertFinite(value: unknown, label: string): asserts value is number {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function distance(a: Vec3, b: Vec3): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function cloneVec3(value: Vec3): Vec3 {
  return { x: value.x, y: value.y, z: value.z };
}

function cloneMovement(movement: PlayerMovementState): PlayerMovementState {
  return {
    ...movement,
    grapplePoint: movement.grapplePoint ? cloneVec3(movement.grapplePoint) : null,
  };
}

function isInsideBounds(position: Vec3): boolean {
  return (
    position.x >= DEFAULT_BOUNDS.minX &&
    position.x <= DEFAULT_BOUNDS.maxX &&
    position.y >= DEFAULT_BOUNDS.minY &&
    position.y <= DEFAULT_BOUNDS.maxY &&
    position.z >= DEFAULT_BOUNDS.minZ &&
    position.z <= DEFAULT_BOUNDS.maxZ
  );
}

function isBlockedWallPosition(position: Vec3): boolean {
  return position.x >= 2.9 && position.x <= 3.35 && position.y >= 0 && position.y <= 4 && Math.abs(position.z) <= 2;
}

function createReplayTerrain(
  previousFrame: AntiCheatMovementTraceFrame,
  frame: AntiCheatMovementTraceFrame
): MovementTerrainAdapter {
  const profile = frame.terrainContact.profile;

  return {
    getGroundY: () => frame.terrainContact.groundY ?? previousFrame.terrainContact.groundY ?? null,
    clampPosition: (position) => {
      if (profile !== 'map_boundary') return cloneVec3(position);
      return {
        x: Math.max(DEFAULT_BOUNDS.minX, Math.min(DEFAULT_BOUNDS.maxX, position.x)),
        y: Math.max(DEFAULT_BOUNDS.minY, Math.min(DEFAULT_BOUNDS.maxY, position.y)),
        z: Math.max(DEFAULT_BOUNDS.minZ, Math.min(DEFAULT_BOUNDS.maxZ, position.z)),
      };
    },
    getBlockAtWorld: profile === 'blocked_wall'
      ? (position) => isBlockedWallPosition(position) ? 10 : 0
      : undefined,
  };
}

function movementMismatch(a: PlayerMovementState, b: PlayerMovementState): boolean {
  return MOVEMENT_STATE_KEYS.some((key) => Boolean(a[key]) !== Boolean(b[key])) ||
    a.wallRunSide !== b.wallRunSide;
}

function isAuthorityBarrier(reason: AntiCheatMovementTraceCorrection | null): boolean {
  return reason === 'spawn' ||
    reason === 'respawn' ||
    reason === 'teleport' ||
    reason === 'unstuck' ||
    reason === 'knockback';
}

function validateTrace(value: unknown): AntiCheatMovementTrace {
  if (!value || typeof value !== 'object') throw new Error('trace must be an object');
  const trace = value as AntiCheatMovementTrace;
  if (trace.version !== ANTI_CHEAT_MOVEMENT_TRACE_VERSION) throw new Error(`unsupported trace version ${trace.version}`);
  if (!trace.traceId || typeof trace.traceId !== 'string') throw new Error('traceId is required');
  if (trace.kind !== 'legal' && trace.kind !== 'malicious') throw new Error(`${trace.traceId}: kind must be legal or malicious`);
  if (!trace.privacy?.excludesNames || !trace.privacy.excludesWallets || !trace.privacy.excludesRawNetworkIds || !trace.privacy.excludesSecrets) {
    throw new Error(`${trace.traceId}: trace privacy attestations are required`);
  }
  if (!Array.isArray(trace.frames) || trace.frames.length === 0 || trace.frames.length > MAX_TRACE_FRAMES) {
    throw new Error(`${trace.traceId}: trace frames must be a bounded non-empty array`);
  }
  for (const [index, frame] of trace.frames.entries()) {
    assertFinite(frame.seq, `${trace.traceId} frame ${index} seq`);
    assertFinite(frame.clientTimeMs, `${trace.traceId} frame ${index} clientTimeMs`);
    assertFinite(frame.movementEpoch, `${trace.traceId} frame ${index} movementEpoch`);
    assertVec3(frame.rapierPosition, `${trace.traceId} frame ${frame.seq} rapierPosition`);
    assertVec3(frame.rapierVelocity, `${trace.traceId} frame ${frame.seq} rapierVelocity`);
    if (!frame.command || typeof frame.command !== 'object') throw new Error(`${trace.traceId} frame ${frame.seq}: command is required`);
    assertFinite(frame.command.seq, `${trace.traceId} frame ${frame.seq} command.seq`);
    assertFinite(frame.command.buttons, `${trace.traceId} frame ${frame.seq} command.buttons`);
    assertFinite(frame.command.lookYaw, `${trace.traceId} frame ${frame.seq} command.lookYaw`);
    assertFinite(frame.command.lookPitch, `${trace.traceId} frame ${frame.seq} command.lookPitch`);
    assertFinite(frame.command.clientTimeMs, `${trace.traceId} frame ${frame.seq} command.clientTimeMs`);
    assertFinite(frame.command.movementEpoch, `${trace.traceId} frame ${frame.seq} command.movementEpoch`);
    if (!frame.terrainContact || typeof frame.terrainContact !== 'object') {
      throw new Error(`${trace.traceId} frame ${frame.seq}: terrainContact is required`);
    }
    if (!frame.latestServerAck || typeof frame.latestServerAck !== 'object') {
      throw new Error(`${trace.traceId} frame ${frame.seq}: latestServerAck is required`);
    }
  }
  return trace;
}

export function readMovementTrace(path: string): AntiCheatMovementTrace {
  return validateTrace(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeMovementTrace(path: string, trace: AntiCheatMovementTrace): void {
  const validated = validateTrace(trace);
  writeFileSync(path, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
}

function detectEnvelopeCorrection(
  trace: AntiCheatMovementTrace,
  previousFrame: AntiCheatMovementTraceFrame,
  frame: AntiCheatMovementTraceFrame
): AntiCheatMovementTraceCorrection | null {
  if (frame.objectiveSuppressed) return 'objective_suppression';
  if (frame.command.movementEpoch !== previousFrame.command.movementEpoch) return 'epoch_mismatch';
  if (frame.command.seq <= previousFrame.command.seq) return 'duplicate_command';

  const heroStats = getHeroStats(trace.heroId);
  const result = validateMovementProposal({
    previous: {
      position: previousFrame.rapierPosition,
      velocity: previousFrame.rapierVelocity,
      acceptedAt: previousFrame.clientTimeMs,
      sequence: previousFrame.seq,
    },
    proposedPosition: frame.rapierPosition,
    proposedVelocity: frame.rapierVelocity,
    inputSequence: frame.seq,
    receivedAt: frame.clientTimeMs,
    heroStats,
    movement: {
      isSliding: frame.movement.isSliding,
      isGrappling: frame.movement.isGrappling,
      isJetpacking: frame.movement.isJetpacking,
      isGliding: frame.movement.isGliding,
    },
    activeSpeedMultiplier: frame.activeAbilityState.activeSpeedMultiplier,
    flagCarrier: frame.flagCarrier,
    bounds: DEFAULT_BOUNDS,
    isInsidePlayableArea: isInsideBounds,
    isSpaceBlocked: (position) => frame.terrainContact.profile === 'blocked_wall' && isBlockedWallPosition(position),
    isPathBlocked: (_from, to) => frame.terrainContact.profile === 'blocked_wall' && isBlockedWallPosition(to),
  });

  return result.accepted ? null : result.reason ?? 'invalid_transform';
}

export function replayMovementTrace(trace: AntiCheatMovementTrace): AntiCheatMovementTraceReport {
  const failures: string[] = [];
  const frames: AntiCheatMovementTraceReportFrame[] = [];
  const firstFrame = trace.frames[0];
  let serverPosition = cloneVec3(firstFrame.rapierPosition);
  let serverVelocity = cloneVec3(firstFrame.rapierVelocity);
  let serverMovement = cloneMovement(firstFrame.movement);
  let previousFrame = firstFrame;
  let maxPositionDrift = 0;
  let maxVelocityDrift = 0;
  let movementStateMismatches = 0;
  let unexpectedCorrections = 0;
  let expectedReasonMatched = !trace.expected.maliciousExpectedReason;

  for (const frame of trace.frames.slice(1)) {
    let correctionReason = detectEnvelopeCorrection(trace, previousFrame, frame);
    if (frame.correctionReason) {
      correctionReason = frame.correctionReason;
    }

    const deltaMs = Math.max(1, Math.min(250, frame.command.clientTimeMs - previousFrame.command.clientTimeMs));
    const simulation = simulateSharedMovement({
      position: serverPosition,
      velocity: serverVelocity,
      movement: {
        ...serverMovement,
        isGrappling: frame.movement.isGrappling,
        grapplePoint: frame.movement.grapplePoint ? cloneVec3(frame.movement.grapplePoint) : null,
        isWallRunning: frame.movement.isWallRunning,
        wallRunSide: frame.movement.wallRunSide,
        isJetpacking: frame.movement.isJetpacking,
        isGliding: frame.movement.isGliding,
      },
      heroStats: getHeroStats(trace.heroId),
      input: movementButtonsToInputState(frame.command.buttons),
      lookYaw: frame.command.lookYaw,
      deltaTime: deltaMs > 0 ? deltaMs / 1000 : MOVEMENT_SUBSTEP_SECONDS,
      terrain: createReplayTerrain(previousFrame, frame),
      flagCarrier: frame.flagCarrier,
      activeSpeedMultiplier: frame.activeAbilityState.activeSpeedMultiplier,
    });

    const allowedAuthorityBarrier = trace.kind === 'legal' &&
      isAuthorityBarrier(correctionReason) &&
      trace.expected.allowedCorrectionReasons.includes(correctionReason as MovementCorrectionReason);
    const comparisonPosition = allowedAuthorityBarrier ? frame.rapierPosition : simulation.position;
    const comparisonVelocity = allowedAuthorityBarrier ? frame.rapierVelocity : simulation.velocity;
    const comparisonMovement = allowedAuthorityBarrier ? frame.movement : simulation.movement;
    const positionDrift = distance(comparisonPosition, frame.rapierPosition);
    const velocityDrift = distance(comparisonVelocity, frame.rapierVelocity);
    const didMovementMismatch = movementMismatch(comparisonMovement, frame.movement);
    maxPositionDrift = Math.max(maxPositionDrift, positionDrift);
    maxVelocityDrift = Math.max(maxVelocityDrift, velocityDrift);
    if (didMovementMismatch) movementStateMismatches++;

    if (correctionReason) {
      const expectedCorrection = correctionReason === trace.expected.maliciousExpectedReason;
      if (expectedCorrection) {
        expectedReasonMatched = true;
      }
      if (!expectedCorrection && !trace.expected.allowedCorrectionReasons.includes(correctionReason as MovementCorrectionReason)) {
        unexpectedCorrections++;
      }
    }

    if (trace.kind === 'legal') {
      if (positionDrift > trace.expected.maxPositionDriftMeters) {
        failures.push(`seq ${frame.seq}: position drift ${positionDrift.toFixed(4)}m exceeds ${trace.expected.maxPositionDriftMeters}m`);
      }
      if (velocityDrift > trace.expected.maxVelocityDriftMetersPerSecond) {
        failures.push(`seq ${frame.seq}: velocity drift ${velocityDrift.toFixed(4)}m/s exceeds ${trace.expected.maxVelocityDriftMetersPerSecond}m/s`);
      }
      if (didMovementMismatch && movementStateMismatches > trace.expected.maxMovementStateMismatches) {
        failures.push(`seq ${frame.seq}: movement state mismatch exceeded budget`);
      }
      if (correctionReason && !trace.expected.allowedCorrectionReasons.includes(correctionReason as MovementCorrectionReason)) {
        failures.push(`seq ${frame.seq}: unexpected correction ${correctionReason}`);
      }
    }

    frames.push({
      seq: frame.seq,
      positionDrift,
      velocityDrift,
      movementMismatch: didMovementMismatch,
      correctionReason,
    });

    if (!correctionReason || trace.kind === 'legal') {
      serverPosition = allowedAuthorityBarrier ? cloneVec3(frame.rapierPosition) : simulation.position;
      serverVelocity = allowedAuthorityBarrier ? cloneVec3(frame.rapierVelocity) : simulation.velocity;
      serverMovement = allowedAuthorityBarrier ? cloneMovement(frame.movement) : simulation.movement;
      previousFrame = frame;
    }
  }

  if (trace.kind === 'malicious' && !expectedReasonMatched) {
    failures.push(`expected malicious reason ${trace.expected.maliciousExpectedReason ?? 'none'} was not observed`);
  }
  if (unexpectedCorrections > trace.expected.maxUnexpectedCorrections) {
    failures.push(`unexpected corrections ${unexpectedCorrections} exceeds ${trace.expected.maxUnexpectedCorrections}`);
  }

  return {
    traceId: trace.traceId,
    kind: trace.kind,
    movementClass: trace.movementClass,
    heroId: trace.heroId,
    passed: failures.length === 0,
    frameCount: trace.frames.length,
    maxPositionDrift,
    maxVelocityDrift,
    movementStateMismatches,
    unexpectedCorrections,
    expectedReasonMatched,
    failures,
    frames,
  };
}

export function listMovementTraceFiles(traceRoot: string, corpus: MovementParityGateOptions['corpus']): string[] {
  const roots = corpus === 'all'
    ? [join(traceRoot, 'smoke'), join(traceRoot, 'full'), join(traceRoot, 'malicious')]
    : corpus === 'full'
      ? [join(traceRoot, 'smoke'), join(traceRoot, 'full'), join(traceRoot, 'malicious')]
      : [join(traceRoot, 'smoke'), join(traceRoot, 'malicious')];

  return roots.flatMap((root) => (
    existsSync(root)
      ? readdirSync(root)
          .filter((file) => file.endsWith('.json'))
          .sort()
          .map((file) => join(root, file))
      : []
  )).sort();
}

export function buildMovementParityGateReport(options: MovementParityGateOptions): AntiCheatMovementParityGateReport {
  const traceFiles = listMovementTraceFiles(options.traceRoot, options.corpus);
  if (traceFiles.length === 0) {
    throw new Error(`no movement traces found for corpus ${options.corpus} under ${options.traceRoot}`);
  }

  const traces = traceFiles.map((file) => replayMovementTrace(readMovementTrace(file)));
  const legalTraces = traces.filter((trace) => trace.kind === 'legal');
  const failures = traces.flatMap((trace) => trace.failures.map((failure) => `${trace.traceId}: ${failure}`));
  const report: AntiCheatMovementParityGateReport = {
    version: ANTI_CHEAT_MOVEMENT_TRACE_VERSION,
    generatedAt: new Date().toISOString(),
    corpus: options.corpus,
    traceCount: traces.length,
    legalTraceCount: legalTraces.length,
    maliciousTraceCount: traces.filter((trace) => trace.kind === 'malicious').length,
    passed: traces.every((trace) => trace.passed),
    maxPositionDrift: legalTraces.reduce((max, trace) => Math.max(max, trace.maxPositionDrift), 0),
    maxVelocityDrift: legalTraces.reduce((max, trace) => Math.max(max, trace.maxVelocityDrift), 0),
    movementStateMismatches: legalTraces.reduce((sum, trace) => sum + trace.movementStateMismatches, 0),
    unexpectedCorrections: legalTraces.reduce((sum, trace) => sum + trace.unexpectedCorrections, 0),
    failures,
    traces,
  };

  if (options.outputPath) {
    writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return report;
}
