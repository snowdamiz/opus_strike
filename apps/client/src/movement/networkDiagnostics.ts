import type { PredictionCorrectionMetrics } from '@voxel-strike/physics';
import type { SelfMovementAuthority } from '@voxel-strike/shared';

type LocalReactiveUpdateSource = 'vitals' | 'transforms' | 'selfAuthority' | 'localGameplay';

export interface MovementNetworkDiagnosticsSnapshot {
  commandsGenerated: number;
  commandsSent: number;
  commandPacketsSent: number;
  commandsPerPacket: number[];
  pendingCommandsBeforeFlush: number[];
  authorityAcksReceived: number;
  authorityAcksApplied: number;
  authorityAcksAppliedPerFrame: number[];
  authorityAckIntervalsMs: number[];
  latestAckSeq: number;
  positionErrors: number[];
  velocityErrors: number[];
  replayedCommands: number[];
  visualCorrectionMagnitudes: number[];
  visualCorrectionDurationsMs: number[];
  localReactiveUpdates: Record<LocalReactiveUpdateSource, number>;
  transformMessagesReceived: number;
  selfOnlyTransformMessages: number;
  remoteTransformSnapshotsAdded: number;
}

const SAMPLE_LIMIT = 120;

const diagnostics: MovementNetworkDiagnosticsSnapshot = {
  commandsGenerated: 0,
  commandsSent: 0,
  commandPacketsSent: 0,
  commandsPerPacket: [],
  pendingCommandsBeforeFlush: [],
  authorityAcksReceived: 0,
  authorityAcksApplied: 0,
  authorityAcksAppliedPerFrame: [],
  authorityAckIntervalsMs: [],
  latestAckSeq: 0,
  positionErrors: [],
  velocityErrors: [],
  replayedCommands: [],
  visualCorrectionMagnitudes: [],
  visualCorrectionDurationsMs: [],
  localReactiveUpdates: {
    vitals: 0,
    transforms: 0,
    selfAuthority: 0,
    localGameplay: 0,
  },
  transformMessagesReceived: 0,
  selfOnlyTransformMessages: 0,
  remoteTransformSnapshotsAdded: 0,
};

let lastAuthorityAckReceivedAtMs = 0;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_LIMIT) {
    samples.splice(0, samples.length - SAMPLE_LIMIT);
  }
}

function cloneDiagnostics(): MovementNetworkDiagnosticsSnapshot {
  return {
    ...diagnostics,
    commandsPerPacket: [...diagnostics.commandsPerPacket],
    pendingCommandsBeforeFlush: [...diagnostics.pendingCommandsBeforeFlush],
    authorityAcksAppliedPerFrame: [...diagnostics.authorityAcksAppliedPerFrame],
    authorityAckIntervalsMs: [...diagnostics.authorityAckIntervalsMs],
    positionErrors: [...diagnostics.positionErrors],
    velocityErrors: [...diagnostics.velocityErrors],
    replayedCommands: [...diagnostics.replayedCommands],
    visualCorrectionMagnitudes: [...diagnostics.visualCorrectionMagnitudes],
    visualCorrectionDurationsMs: [...diagnostics.visualCorrectionDurationsMs],
    localReactiveUpdates: { ...diagnostics.localReactiveUpdates },
  };
}

export function resetMovementNetworkDiagnostics(): void {
  diagnostics.commandsGenerated = 0;
  diagnostics.commandsSent = 0;
  diagnostics.commandPacketsSent = 0;
  diagnostics.commandsPerPacket.length = 0;
  diagnostics.pendingCommandsBeforeFlush.length = 0;
  diagnostics.authorityAcksReceived = 0;
  diagnostics.authorityAcksApplied = 0;
  diagnostics.authorityAcksAppliedPerFrame.length = 0;
  diagnostics.authorityAckIntervalsMs.length = 0;
  diagnostics.latestAckSeq = 0;
  diagnostics.positionErrors.length = 0;
  diagnostics.velocityErrors.length = 0;
  diagnostics.replayedCommands.length = 0;
  diagnostics.visualCorrectionMagnitudes.length = 0;
  diagnostics.visualCorrectionDurationsMs.length = 0;
  diagnostics.localReactiveUpdates.vitals = 0;
  diagnostics.localReactiveUpdates.transforms = 0;
  diagnostics.localReactiveUpdates.selfAuthority = 0;
  diagnostics.localReactiveUpdates.localGameplay = 0;
  diagnostics.transformMessagesReceived = 0;
  diagnostics.selfOnlyTransformMessages = 0;
  diagnostics.remoteTransformSnapshotsAdded = 0;
  lastAuthorityAckReceivedAtMs = 0;
}

export function getMovementNetworkDiagnosticsSnapshot(): MovementNetworkDiagnosticsSnapshot {
  return cloneDiagnostics();
}

export function recordMovementCommandGenerated(): void {
  diagnostics.commandsGenerated++;
}

export function recordMovementCommandsSent(commandCount: number, pendingBeforeFlush: number): void {
  diagnostics.commandsSent += commandCount;
  diagnostics.commandPacketsSent++;
  pushSample(diagnostics.commandsPerPacket, commandCount);
  pushSample(diagnostics.pendingCommandsBeforeFlush, pendingBeforeFlush);
}

export function recordAuthorityAckReceived(authority: SelfMovementAuthority): void {
  const receivedAtMs = nowMs();
  diagnostics.authorityAcksReceived++;
  diagnostics.latestAckSeq = authority.ackSeq;
  if (lastAuthorityAckReceivedAtMs > 0) {
    pushSample(diagnostics.authorityAckIntervalsMs, receivedAtMs - lastAuthorityAckReceivedAtMs);
  }
  lastAuthorityAckReceivedAtMs = receivedAtMs;
}

export function recordAuthorityFrameApplied(metrics: PredictionCorrectionMetrics[]): void {
  diagnostics.authorityAcksApplied += metrics.length;
  pushSample(diagnostics.authorityAcksAppliedPerFrame, metrics.length);
  for (const metric of metrics) {
    diagnostics.latestAckSeq = metric.ackSeq;
    pushSample(diagnostics.positionErrors, metric.positionError);
    pushSample(diagnostics.velocityErrors, metric.velocityError);
    pushSample(diagnostics.replayedCommands, metric.replayedCommands);
    pushSample(diagnostics.visualCorrectionMagnitudes, metric.visualCorrectionMagnitude);
    pushSample(diagnostics.visualCorrectionDurationsMs, metric.visualCorrectionDurationMs);
  }
}

export function recordLocalReactiveUpdate(source: LocalReactiveUpdateSource): void {
  diagnostics.localReactiveUpdates[source]++;
}

export function recordTransformMessage(input: {
  transformCount: number;
  selfTransformCount: number;
  remoteTransformCount: number;
}): void {
  diagnostics.transformMessagesReceived++;
  if (input.transformCount > 0 && input.selfTransformCount === input.transformCount) {
    diagnostics.selfOnlyTransformMessages++;
  }
  diagnostics.remoteTransformSnapshotsAdded += input.remoteTransformCount;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as {
    __voxelMovementDiagnostics?: {
      snapshot: typeof getMovementNetworkDiagnosticsSnapshot;
      reset: typeof resetMovementNetworkDiagnostics;
    };
  }).__voxelMovementDiagnostics = {
    snapshot: getMovementNetworkDiagnosticsSnapshot,
    reset: resetMovementNetworkDiagnostics,
  };
}
