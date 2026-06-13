import type { PredictionCorrectionMetrics } from '@voxel-strike/physics';
import type { SelfMovementAuthority } from '@voxel-strike/shared';

type LocalReactiveUpdateSource = 'vitals' | 'transforms' | 'selfAuthority' | 'localGameplay';

export interface FrameWorkSample {
  label: string;
  durationMs: number;
  endedAtMs: number;
}

export interface FrameWorkAggregate {
  label: string;
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface HitchFrameWorkSample {
  endedAtMs: number;
  frameDeltaMs: number;
  movementSubsteps: number;
  totalMeasuredMs: number;
  work: FrameWorkAggregate[];
}

export interface MovementNetworkDiagnosticsSnapshot {
  commandsGenerated: number;
  commandsSent: number;
  commandPacketsSent: number;
  commandsPerPacket: number[];
  pendingCommandsBeforeFlush: number[];
  framesObserved: number;
  frameDeltaMs: number[];
  movementFrameDeltaMs: number[];
  movementSubstepsPerFrame: number[];
  movementAccumulatorBeforeStepMs: number[];
  movementAccumulatorAfterStepMs: number[];
  movementHitchFrames: number;
  movementCatchupFrames: number;
  authorityAcksReceived: number;
  authorityAcksApplied: number;
  authorityDrainFrames: number;
  authorityAcksAppliedPerFrame: number[];
  authorityPendingBeforeDrain: number[];
  authorityDrainDurationsMs: number[];
  authorityAcksSkippedDuringDrain: number;
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
  frameWorkSamples: FrameWorkSample[];
  hitchFrameWork: HitchFrameWorkSample[];
}

const SAMPLE_LIMIT = 120;
const FRAME_WORK_SAMPLE_LIMIT = 240;
const HITCH_FRAME_WORK_SAMPLE_LIMIT = 40;
const HITCH_FRAME_WORK_LABEL_LIMIT = 12;
const MIN_FRAME_WORK_SAMPLE_MS = 0.02;
const FRAME_HITCH_THRESHOLD_MS = 1000 / 30;

const diagnostics: MovementNetworkDiagnosticsSnapshot = {
  commandsGenerated: 0,
  commandsSent: 0,
  commandPacketsSent: 0,
  commandsPerPacket: [],
  pendingCommandsBeforeFlush: [],
  framesObserved: 0,
  frameDeltaMs: [],
  movementFrameDeltaMs: [],
  movementSubstepsPerFrame: [],
  movementAccumulatorBeforeStepMs: [],
  movementAccumulatorAfterStepMs: [],
  movementHitchFrames: 0,
  movementCatchupFrames: 0,
  authorityAcksReceived: 0,
  authorityAcksApplied: 0,
  authorityDrainFrames: 0,
  authorityAcksAppliedPerFrame: [],
  authorityPendingBeforeDrain: [],
  authorityDrainDurationsMs: [],
  authorityAcksSkippedDuringDrain: 0,
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
  frameWorkSamples: [],
  hitchFrameWork: [],
};

let lastAuthorityAckReceivedAtMs = 0;
let lastFrameWorkMarkAtMs = 0;
let activeFrameWorkStartedAtMs = 0;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_LIMIT) {
    samples.splice(0, samples.length - SAMPLE_LIMIT);
  }
}

function pushWorkSample(sample: FrameWorkSample): void {
  diagnostics.frameWorkSamples.push(sample);
  if (diagnostics.frameWorkSamples.length > FRAME_WORK_SAMPLE_LIMIT) {
    diagnostics.frameWorkSamples.splice(0, diagnostics.frameWorkSamples.length - FRAME_WORK_SAMPLE_LIMIT);
  }
}

function pushHitchFrameWork(sample: HitchFrameWorkSample): void {
  diagnostics.hitchFrameWork.push(sample);
  if (diagnostics.hitchFrameWork.length > HITCH_FRAME_WORK_SAMPLE_LIMIT) {
    diagnostics.hitchFrameWork.splice(0, diagnostics.hitchFrameWork.length - HITCH_FRAME_WORK_SAMPLE_LIMIT);
  }
}

function cloneFrameWorkSample(sample: FrameWorkSample): FrameWorkSample {
  return { ...sample };
}

function cloneHitchFrameWorkSample(sample: HitchFrameWorkSample): HitchFrameWorkSample {
  return {
    ...sample,
    work: sample.work.map((entry) => ({ ...entry })),
  };
}

function aggregateFrameWork(startedAfterMs: number, endedAtMs: number): FrameWorkAggregate[] {
  if (startedAfterMs <= 0) return [];

  const byLabel = new Map<string, FrameWorkAggregate>();
  for (const sample of diagnostics.frameWorkSamples) {
    if (sample.endedAtMs <= startedAfterMs || sample.endedAtMs > endedAtMs) continue;

    const current = byLabel.get(sample.label);
    if (current) {
      current.count++;
      current.totalMs += sample.durationMs;
      current.maxMs = Math.max(current.maxMs, sample.durationMs);
      continue;
    }

    byLabel.set(sample.label, {
      label: sample.label,
      count: 1,
      totalMs: sample.durationMs,
      maxMs: sample.durationMs,
    });
  }

  return Array.from(byLabel.values())
    .sort((a, b) => b.totalMs - a.totalMs || b.maxMs - a.maxMs)
    .slice(0, HITCH_FRAME_WORK_LABEL_LIMIT);
}

function cloneDiagnostics(): MovementNetworkDiagnosticsSnapshot {
  return {
    ...diagnostics,
    commandsPerPacket: [...diagnostics.commandsPerPacket],
    pendingCommandsBeforeFlush: [...diagnostics.pendingCommandsBeforeFlush],
    frameDeltaMs: [...diagnostics.frameDeltaMs],
    movementFrameDeltaMs: [...diagnostics.movementFrameDeltaMs],
    movementSubstepsPerFrame: [...diagnostics.movementSubstepsPerFrame],
    movementAccumulatorBeforeStepMs: [...diagnostics.movementAccumulatorBeforeStepMs],
    movementAccumulatorAfterStepMs: [...diagnostics.movementAccumulatorAfterStepMs],
    authorityAcksAppliedPerFrame: [...diagnostics.authorityAcksAppliedPerFrame],
    authorityPendingBeforeDrain: [...diagnostics.authorityPendingBeforeDrain],
    authorityDrainDurationsMs: [...diagnostics.authorityDrainDurationsMs],
    authorityAckIntervalsMs: [...diagnostics.authorityAckIntervalsMs],
    positionErrors: [...diagnostics.positionErrors],
    velocityErrors: [...diagnostics.velocityErrors],
    replayedCommands: [...diagnostics.replayedCommands],
    visualCorrectionMagnitudes: [...diagnostics.visualCorrectionMagnitudes],
    visualCorrectionDurationsMs: [...diagnostics.visualCorrectionDurationsMs],
    localReactiveUpdates: { ...diagnostics.localReactiveUpdates },
    frameWorkSamples: diagnostics.frameWorkSamples.map(cloneFrameWorkSample),
    hitchFrameWork: diagnostics.hitchFrameWork.map(cloneHitchFrameWorkSample),
  };
}

export function resetMovementNetworkDiagnostics(): void {
  diagnostics.commandsGenerated = 0;
  diagnostics.commandsSent = 0;
  diagnostics.commandPacketsSent = 0;
  diagnostics.commandsPerPacket.length = 0;
  diagnostics.pendingCommandsBeforeFlush.length = 0;
  diagnostics.framesObserved = 0;
  diagnostics.frameDeltaMs.length = 0;
  diagnostics.movementFrameDeltaMs.length = 0;
  diagnostics.movementSubstepsPerFrame.length = 0;
  diagnostics.movementAccumulatorBeforeStepMs.length = 0;
  diagnostics.movementAccumulatorAfterStepMs.length = 0;
  diagnostics.movementHitchFrames = 0;
  diagnostics.movementCatchupFrames = 0;
  diagnostics.authorityAcksReceived = 0;
  diagnostics.authorityAcksApplied = 0;
  diagnostics.authorityDrainFrames = 0;
  diagnostics.authorityAcksAppliedPerFrame.length = 0;
  diagnostics.authorityPendingBeforeDrain.length = 0;
  diagnostics.authorityDrainDurationsMs.length = 0;
  diagnostics.authorityAcksSkippedDuringDrain = 0;
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
  diagnostics.frameWorkSamples.length = 0;
  diagnostics.hitchFrameWork.length = 0;
  lastAuthorityAckReceivedAtMs = 0;
  lastFrameWorkMarkAtMs = 0;
  activeFrameWorkStartedAtMs = 0;
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

export function recordMovementFrameTiming(input: {
  frameDeltaSeconds: number;
  movementDeltaSeconds: number;
  substepsThisFrame: number;
  accumulatorBeforeStepSeconds: number;
  accumulatorAfterStepSeconds: number;
  catchup: boolean;
}): void {
  const recordedAtMs = nowMs();
  const intervalStartedAtMs = lastFrameWorkMarkAtMs;
  lastFrameWorkMarkAtMs = recordedAtMs;
  const frameDeltaMs = Math.max(0, input.frameDeltaSeconds * 1000);
  diagnostics.framesObserved++;
  pushSample(diagnostics.frameDeltaMs, frameDeltaMs);
  pushSample(diagnostics.movementFrameDeltaMs, Math.max(0, input.movementDeltaSeconds * 1000));
  pushSample(diagnostics.movementSubstepsPerFrame, input.substepsThisFrame);
  pushSample(diagnostics.movementAccumulatorBeforeStepMs, Math.max(0, input.accumulatorBeforeStepSeconds * 1000));
  pushSample(diagnostics.movementAccumulatorAfterStepMs, Math.max(0, input.accumulatorAfterStepSeconds * 1000));
  if (frameDeltaMs >= FRAME_HITCH_THRESHOLD_MS) {
    diagnostics.movementHitchFrames++;
    const work = aggregateFrameWork(intervalStartedAtMs, recordedAtMs);
    pushHitchFrameWork({
      endedAtMs: recordedAtMs,
      frameDeltaMs,
      movementSubsteps: input.substepsThisFrame,
      totalMeasuredMs: work.reduce((total, entry) => total + entry.totalMs, 0),
      work,
    });
  }
  if (input.catchup) {
    diagnostics.movementCatchupFrames++;
  }
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

export function recordAuthorityDrainFrame(input: {
  pendingBeforeDrain: number;
  appliedCount: number;
  durationMs: number;
}): void {
  diagnostics.authorityDrainFrames++;
  pushSample(diagnostics.authorityPendingBeforeDrain, input.pendingBeforeDrain);
  pushSample(diagnostics.authorityDrainDurationsMs, input.durationMs);
  diagnostics.authorityAcksSkippedDuringDrain += Math.max(0, input.pendingBeforeDrain - input.appliedCount);
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

export function recordFrameWorkDuration(label: string, startedAtMs: number, endedAtMs = nowMs()): void {
  if (!import.meta.env.DEV) return;

  const durationMs = Math.max(0, endedAtMs - startedAtMs);
  if (!Number.isFinite(durationMs) || durationMs < MIN_FRAME_WORK_SAMPLE_MS) return;

  pushWorkSample({
    label,
    durationMs,
    endedAtMs,
  });
}

export function measureFrameWork<T>(label: string, work: () => T): T {
  if (!import.meta.env.DEV) return work();

  const startedAtMs = nowMs();
  try {
    return work();
  } finally {
    recordFrameWorkDuration(label, startedAtMs);
  }
}

export function beginFrameWorkTiming(): void {
  if (!import.meta.env.DEV) return;
  activeFrameWorkStartedAtMs = nowMs();
}

export function finishFrameWorkTiming(label: string): void {
  if (!import.meta.env.DEV || activeFrameWorkStartedAtMs <= 0) return;

  recordFrameWorkDuration(label, activeFrameWorkStartedAtMs);
  activeFrameWorkStartedAtMs = 0;
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
