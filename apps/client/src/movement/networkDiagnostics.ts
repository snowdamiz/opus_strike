import type { PredictionCorrectionMetrics } from '@voxel-strike/physics';
import type { SelfMovementAuthority } from '@voxel-strike/shared';
import { config } from '../config/environment';

type LocalReactiveUpdateSource = 'vitals' | 'transforms' | 'selfAuthority' | 'localGameplay';

const CLIENT_DIAGNOSTICS_ENABLED = config.clientDiagnosticsEnabled;

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

export interface LongTaskAttributionSample {
  name: string;
  entryType: string;
  containerType?: string;
  containerName?: string;
  containerSrc?: string;
  containerId?: string;
}

export interface LongTaskSample {
  startedAtMs: number;
  durationMs: number;
  name: string;
  attribution: LongTaskAttributionSample[];
}

export interface HitchFrameWorkSample {
  endedAtMs: number;
  frameDeltaMs: number;
  movementSubsteps: number;
  totalMeasuredMs: number;
  totalLongTaskMs: number;
  work: FrameWorkAggregate[];
  longTasks: LongTaskSample[];
}

export interface FrameSchedulerDiagnostics {
  activeCallbacks: number;
  callbacksBySystem: Record<string, number>;
}

export interface EffectSlotDiagnostics {
  active: number;
  hiddenMounted: number;
  capacity: number;
  pressure: number;
}

export interface DynamicLightDiagnostics {
  registered: number;
  activeCandidates: number;
  enabled: number;
  budget: number;
}

export interface RendererDiagnostics {
  fps: number;
  frameP50Ms: number;
  frameP95Ms: number;
  frameMaxMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

export interface TerrainRendererDiagnostics {
  visibleRegionCount: number;
  fullDetailRegionCount: number;
  coarseRegionCount: number;
  ultraCoarseRegionCount: number;
  macroMeshCount: number;
  macroRegionCount: number;
  hiddenByDistance: number;
  hiddenByFrustum: number;
  hiddenByHorizon: number;
  detailSwapsPerSecond: number;
  geometryBuildsPerSecond: number;
  geometryFinalizationsPerSecond: number;
  pendingRegionBuilds: number;
  pendingRegionFinalizations: number;
  adaptiveVisibilityScale: number;
}

export interface AudioLoadSample {
  name: string;
  ok: boolean;
  startedAtMs: number;
  totalMs: number;
  fetchMs: number;
  decodeMs: number;
  bytes: number;
  error?: string;
}

export interface AudioPlayWaitSample {
  name: string;
  waitedMs: number;
  startedAtMs: number;
}

export interface AudioDiagnostics {
  userActivated: boolean;
  contextState: AudioContextState | 'none' | 'unknown';
  loadedSounds: number;
  pendingLoads: number;
  pendingPreloads: number;
  activeDecodes: number;
  queuedDecodes: number;
  preloadRequests: number;
  preloadFlushes: number;
  preloadFlushSounds: number;
  preloadWaitsForActivation: number;
  loadRequests: number;
  cacheHits: number;
  failedLoads: number;
  playRequests: number;
  playLoadWaits: number;
  maxLoadWaitMs: number;
  maxFetchMs: number;
  maxDecodeMs: number;
  recentLoads: AudioLoadSample[];
  recentPlayWaits: AudioPlayWaitSample[];
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
  longTasks: LongTaskSample[];
  audio: AudioDiagnostics;
  frameScheduler: FrameSchedulerDiagnostics;
  effectSlots: Record<string, EffectSlotDiagnostics>;
  frameAllocations: Record<string, number>;
  hotStoreCommits: Record<string, number>;
  dynamicLights: DynamicLightDiagnostics;
  renderer: RendererDiagnostics;
  terrainRenderer: TerrainRendererDiagnostics;
}

const SAMPLE_LIMIT = 120;
const FRAME_WORK_SAMPLE_LIMIT = 240;
const HITCH_FRAME_WORK_SAMPLE_LIMIT = 40;
const HITCH_FRAME_WORK_LABEL_LIMIT = 12;
const LONG_TASK_SAMPLE_LIMIT = 80;
const RATE_SAMPLE_WINDOW_MS = 1000;
const HITCH_LONG_TASK_LIMIT = 8;
const HITCH_LONG_TASK_WINDOW_PADDING_MS = 8;
const AUDIO_SAMPLE_LIMIT = 80;
const MIN_FRAME_WORK_SAMPLE_MS = 0.02;
const FRAME_HITCH_THRESHOLD_MS = 1000 / 30;

export const MOVEMENT_DIAGNOSTICS_ENABLED = CLIENT_DIAGNOSTICS_ENABLED;

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
  longTasks: [],
  audio: {
    userActivated: false,
    contextState: 'none',
    loadedSounds: 0,
    pendingLoads: 0,
    pendingPreloads: 0,
    activeDecodes: 0,
    queuedDecodes: 0,
    preloadRequests: 0,
    preloadFlushes: 0,
    preloadFlushSounds: 0,
    preloadWaitsForActivation: 0,
    loadRequests: 0,
    cacheHits: 0,
    failedLoads: 0,
    playRequests: 0,
    playLoadWaits: 0,
    maxLoadWaitMs: 0,
    maxFetchMs: 0,
    maxDecodeMs: 0,
    recentLoads: [],
    recentPlayWaits: [],
  },
  frameScheduler: {
    activeCallbacks: 0,
    callbacksBySystem: {},
  },
  effectSlots: {},
  frameAllocations: {},
  hotStoreCommits: {},
  dynamicLights: {
    registered: 0,
    activeCandidates: 0,
    enabled: 0,
    budget: 0,
  },
  renderer: {
    fps: 0,
    frameP50Ms: 0,
    frameP95Ms: 0,
    frameMaxMs: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
  },
  terrainRenderer: {
    visibleRegionCount: 0,
    fullDetailRegionCount: 0,
    coarseRegionCount: 0,
    ultraCoarseRegionCount: 0,
    macroMeshCount: 0,
    macroRegionCount: 0,
    hiddenByDistance: 0,
    hiddenByFrustum: 0,
    hiddenByHorizon: 0,
    detailSwapsPerSecond: 0,
    geometryBuildsPerSecond: 0,
    geometryFinalizationsPerSecond: 0,
    pendingRegionBuilds: 0,
    pendingRegionFinalizations: 0,
    adaptiveVisibilityScale: 1,
  },
};

let lastAuthorityAckReceivedAtMs = 0;
let lastFrameWorkMarkAtMs = 0;
let activeFrameWorkStartedAtMs = 0;
let longTaskObserver: PerformanceObserver | null = null;
const terrainDetailSwapSamples: number[] = [];
const terrainGeometryBuildSamples: number[] = [];
const terrainGeometryFinalizationSamples: number[] = [];

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function pushSample(samples: number[], value: number): void {
  samples.push(value);
  if (samples.length > SAMPLE_LIMIT) {
    samples.splice(0, samples.length - SAMPLE_LIMIT);
  }
}

function pushRateSamples(samples: number[], count: number, recordedAtMs = nowMs()): void {
  const safeCount = Math.max(0, Math.floor(count));
  for (let index = 0; index < safeCount; index++) {
    samples.push(recordedAtMs);
  }
  pruneRateSamples(samples, recordedAtMs);
}

function pruneRateSamples(samples: number[], recordedAtMs = nowMs()): void {
  const oldestIncludedMs = recordedAtMs - RATE_SAMPLE_WINDOW_MS;
  let firstIncludedIndex = 0;
  while (firstIncludedIndex < samples.length && samples[firstIncludedIndex] < oldestIncludedMs) {
    firstIncludedIndex++;
  }
  if (firstIncludedIndex > 0) {
    samples.splice(0, firstIncludedIndex);
  }
}

function ratePerSecond(samples: number[], recordedAtMs = nowMs()): number {
  pruneRateSamples(samples, recordedAtMs);
  return samples.length;
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

function pushLongTaskSample(sample: LongTaskSample): void {
  diagnostics.longTasks.push(sample);
  if (diagnostics.longTasks.length > LONG_TASK_SAMPLE_LIMIT) {
    diagnostics.longTasks.splice(0, diagnostics.longTasks.length - LONG_TASK_SAMPLE_LIMIT);
  }
}

function pushAudioLoadSample(sample: AudioLoadSample): void {
  diagnostics.audio.recentLoads.push(sample);
  if (diagnostics.audio.recentLoads.length > AUDIO_SAMPLE_LIMIT) {
    diagnostics.audio.recentLoads.splice(0, diagnostics.audio.recentLoads.length - AUDIO_SAMPLE_LIMIT);
  }
}

function pushAudioPlayWaitSample(sample: AudioPlayWaitSample): void {
  diagnostics.audio.recentPlayWaits.push(sample);
  if (diagnostics.audio.recentPlayWaits.length > AUDIO_SAMPLE_LIMIT) {
    diagnostics.audio.recentPlayWaits.splice(0, diagnostics.audio.recentPlayWaits.length - AUDIO_SAMPLE_LIMIT);
  }
}

function cloneFrameWorkSample(sample: FrameWorkSample): FrameWorkSample {
  return { ...sample };
}

function cloneLongTaskSample(sample: LongTaskSample): LongTaskSample {
  return {
    ...sample,
    attribution: sample.attribution.map((entry) => ({ ...entry })),
  };
}

function cloneHitchFrameWorkSample(sample: HitchFrameWorkSample): HitchFrameWorkSample {
  return {
    ...sample,
    work: sample.work.map((entry) => ({ ...entry })),
    longTasks: sample.longTasks.map(cloneLongTaskSample),
  };
}

function cloneAudioLoadSample(sample: AudioLoadSample): AudioLoadSample {
  return { ...sample };
}

function cloneAudioPlayWaitSample(sample: AudioPlayWaitSample): AudioPlayWaitSample {
  return { ...sample };
}

function cloneEffectSlotDiagnosticsByType(): Record<string, EffectSlotDiagnostics> {
  const result: Record<string, EffectSlotDiagnostics> = {};
  for (const [type, stats] of Object.entries(diagnostics.effectSlots)) {
    result[type] = { ...stats };
  }
  return result;
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

function getLongTasksInWindow(startedAfterMs: number, endedAtMs: number): LongTaskSample[] {
  if (startedAfterMs <= 0) return [];

  const windowStartMs = startedAfterMs - HITCH_LONG_TASK_WINDOW_PADDING_MS;
  const windowEndMs = endedAtMs + HITCH_LONG_TASK_WINDOW_PADDING_MS;
  const tasks: LongTaskSample[] = [];
  for (const sample of diagnostics.longTasks) {
    const sampleEndMs = sample.startedAtMs + sample.durationMs;
    if (sample.startedAtMs >= windowEndMs || sampleEndMs <= windowStartMs) continue;
    tasks.push(cloneLongTaskSample(sample));
  }

  return tasks
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, HITCH_LONG_TASK_LIMIT);
}

function isSameLongTaskSample(a: LongTaskSample, b: LongTaskSample): boolean {
  return a.startedAtMs === b.startedAtMs && a.durationMs === b.durationMs && a.name === b.name;
}

function backfillRecentHitchesWithLongTask(sample: LongTaskSample): void {
  const sampleEndMs = sample.startedAtMs + sample.durationMs;

  for (const hitch of diagnostics.hitchFrameWork) {
    const windowStartMs = hitch.endedAtMs - hitch.frameDeltaMs - HITCH_LONG_TASK_WINDOW_PADDING_MS;
    const windowEndMs = hitch.endedAtMs + HITCH_LONG_TASK_WINDOW_PADDING_MS;
    if (sample.startedAtMs >= windowEndMs || sampleEndMs <= windowStartMs) continue;
    if (hitch.longTasks.some((existing) => isSameLongTaskSample(existing, sample))) continue;

    hitch.longTasks.push(cloneLongTaskSample(sample));
    hitch.longTasks.sort((a, b) => b.durationMs - a.durationMs);
    if (hitch.longTasks.length > HITCH_LONG_TASK_LIMIT) {
      hitch.longTasks.length = HITCH_LONG_TASK_LIMIT;
    }
    hitch.totalLongTaskMs = hitch.longTasks.reduce((total, entry) => total + entry.durationMs, 0);
  }
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
    longTasks: diagnostics.longTasks.map(cloneLongTaskSample),
    audio: {
      ...diagnostics.audio,
      recentLoads: diagnostics.audio.recentLoads.map(cloneAudioLoadSample),
      recentPlayWaits: diagnostics.audio.recentPlayWaits.map(cloneAudioPlayWaitSample),
    },
    frameScheduler: {
      activeCallbacks: diagnostics.frameScheduler.activeCallbacks,
      callbacksBySystem: { ...diagnostics.frameScheduler.callbacksBySystem },
    },
    effectSlots: cloneEffectSlotDiagnosticsByType(),
    frameAllocations: { ...diagnostics.frameAllocations },
    hotStoreCommits: { ...diagnostics.hotStoreCommits },
    dynamicLights: { ...diagnostics.dynamicLights },
    renderer: { ...diagnostics.renderer },
    terrainRenderer: {
      ...diagnostics.terrainRenderer,
      detailSwapsPerSecond: ratePerSecond(terrainDetailSwapSamples),
      geometryBuildsPerSecond: ratePerSecond(terrainGeometryBuildSamples),
      geometryFinalizationsPerSecond: ratePerSecond(terrainGeometryFinalizationSamples),
    },
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
  diagnostics.longTasks.length = 0;
  diagnostics.audio.userActivated = false;
  diagnostics.audio.contextState = 'none';
  diagnostics.audio.loadedSounds = 0;
  diagnostics.audio.pendingLoads = 0;
  diagnostics.audio.pendingPreloads = 0;
  diagnostics.audio.activeDecodes = 0;
  diagnostics.audio.queuedDecodes = 0;
  diagnostics.audio.preloadRequests = 0;
  diagnostics.audio.preloadFlushes = 0;
  diagnostics.audio.preloadFlushSounds = 0;
  diagnostics.audio.preloadWaitsForActivation = 0;
  diagnostics.audio.loadRequests = 0;
  diagnostics.audio.cacheHits = 0;
  diagnostics.audio.failedLoads = 0;
  diagnostics.audio.playRequests = 0;
  diagnostics.audio.playLoadWaits = 0;
  diagnostics.audio.maxLoadWaitMs = 0;
  diagnostics.audio.maxFetchMs = 0;
  diagnostics.audio.maxDecodeMs = 0;
  diagnostics.audio.recentLoads.length = 0;
  diagnostics.audio.recentPlayWaits.length = 0;
  diagnostics.frameScheduler.activeCallbacks = 0;
  diagnostics.frameScheduler.callbacksBySystem = {};
  diagnostics.effectSlots = {};
  diagnostics.frameAllocations = {};
  diagnostics.hotStoreCommits = {};
  diagnostics.dynamicLights.registered = 0;
  diagnostics.dynamicLights.activeCandidates = 0;
  diagnostics.dynamicLights.enabled = 0;
  diagnostics.dynamicLights.budget = 0;
  diagnostics.renderer.fps = 0;
  diagnostics.renderer.frameP50Ms = 0;
  diagnostics.renderer.frameP95Ms = 0;
  diagnostics.renderer.frameMaxMs = 0;
  diagnostics.renderer.drawCalls = 0;
  diagnostics.renderer.triangles = 0;
  diagnostics.renderer.geometries = 0;
  diagnostics.renderer.textures = 0;
  diagnostics.terrainRenderer.visibleRegionCount = 0;
  diagnostics.terrainRenderer.fullDetailRegionCount = 0;
  diagnostics.terrainRenderer.coarseRegionCount = 0;
  diagnostics.terrainRenderer.ultraCoarseRegionCount = 0;
  diagnostics.terrainRenderer.macroMeshCount = 0;
  diagnostics.terrainRenderer.macroRegionCount = 0;
  diagnostics.terrainRenderer.hiddenByDistance = 0;
  diagnostics.terrainRenderer.hiddenByFrustum = 0;
  diagnostics.terrainRenderer.hiddenByHorizon = 0;
  diagnostics.terrainRenderer.detailSwapsPerSecond = 0;
  diagnostics.terrainRenderer.geometryBuildsPerSecond = 0;
  diagnostics.terrainRenderer.geometryFinalizationsPerSecond = 0;
  diagnostics.terrainRenderer.pendingRegionBuilds = 0;
  diagnostics.terrainRenderer.pendingRegionFinalizations = 0;
  diagnostics.terrainRenderer.adaptiveVisibilityScale = 1;
  terrainDetailSwapSamples.length = 0;
  terrainGeometryBuildSamples.length = 0;
  terrainGeometryFinalizationSamples.length = 0;
  lastAuthorityAckReceivedAtMs = 0;
  lastFrameWorkMarkAtMs = 0;
  activeFrameWorkStartedAtMs = 0;
}

export function getMovementNetworkDiagnosticsSnapshot(): MovementNetworkDiagnosticsSnapshot {
  return cloneDiagnostics();
}

export function recordMovementCommandGenerated(): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.commandsGenerated++;
}

export function recordMovementCommandsSent(commandCount: number, pendingBeforeFlush: number): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

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
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

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
    const longTasks = getLongTasksInWindow(intervalStartedAtMs, recordedAtMs);
    pushHitchFrameWork({
      endedAtMs: recordedAtMs,
      frameDeltaMs,
      movementSubsteps: input.substepsThisFrame,
      totalMeasuredMs: work.reduce((total, entry) => total + entry.totalMs, 0),
      totalLongTaskMs: longTasks.reduce((total, entry) => total + entry.durationMs, 0),
      work,
      longTasks,
    });
  }
  if (input.catchup) {
    diagnostics.movementCatchupFrames++;
  }
}

export function recordAuthorityAckReceived(authority: SelfMovementAuthority): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

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
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.authorityDrainFrames++;
  pushSample(diagnostics.authorityPendingBeforeDrain, input.pendingBeforeDrain);
  pushSample(diagnostics.authorityDrainDurationsMs, input.durationMs);
  diagnostics.authorityAcksSkippedDuringDrain += Math.max(0, input.pendingBeforeDrain - input.appliedCount);
}

export function recordAuthorityFrameApplied(metrics: PredictionCorrectionMetrics[]): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

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
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.localReactiveUpdates[source]++;
}

export function recordHotStoreCommit(slice: string, count = 1): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.hotStoreCommits[slice] = (diagnostics.hotStoreCommits[slice] ?? 0) + Math.max(0, count);
}

export function recordTransformMessage(input: {
  transformCount: number;
  selfTransformCount: number;
  remoteTransformCount: number;
}): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.transformMessagesReceived++;
  if (input.transformCount > 0 && input.selfTransformCount === input.transformCount) {
    diagnostics.selfOnlyTransformMessages++;
  }
  diagnostics.remoteTransformSnapshotsAdded += input.remoteTransformCount;
}

export function recordFrameSchedulerDiagnostics(
  callbacksBySystem: Record<string, number>
): void {
  diagnostics.frameScheduler.callbacksBySystem = { ...callbacksBySystem };
  diagnostics.frameScheduler.activeCallbacks = Object.values(callbacksBySystem).reduce(
    (total, count) => total + count,
    0
  );
}

export function recordEffectSlotDiagnostics(
  type: string,
  stats: Pick<EffectSlotDiagnostics, 'active' | 'hiddenMounted' | 'capacity'>
): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  const capacity = Math.max(0, stats.capacity);
  diagnostics.effectSlots[type] = {
    active: Math.max(0, stats.active),
    hiddenMounted: Math.max(0, stats.hiddenMounted),
    capacity,
    pressure: capacity > 0 ? Math.max(0, stats.active) / capacity : 0,
  };
}

export function recordFrameAllocation(label: string, count = 1): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.frameAllocations[label] = (diagnostics.frameAllocations[label] ?? 0) + Math.max(0, count);
}

export function recordDynamicLightDiagnostics(stats: DynamicLightDiagnostics): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.dynamicLights.registered = Math.max(0, stats.registered);
  diagnostics.dynamicLights.activeCandidates = Math.max(0, stats.activeCandidates);
  diagnostics.dynamicLights.enabled = Math.max(0, stats.enabled);
  diagnostics.dynamicLights.budget = Math.max(0, stats.budget);
}

export function recordRendererDiagnostics(stats: RendererDiagnostics): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.renderer.fps = Math.max(0, stats.fps);
  diagnostics.renderer.frameP50Ms = Math.max(0, stats.frameP50Ms);
  diagnostics.renderer.frameP95Ms = Math.max(0, stats.frameP95Ms);
  diagnostics.renderer.frameMaxMs = Math.max(0, stats.frameMaxMs);
  diagnostics.renderer.drawCalls = Math.max(0, stats.drawCalls);
  diagnostics.renderer.triangles = Math.max(0, stats.triangles);
  diagnostics.renderer.geometries = Math.max(0, stats.geometries);
  diagnostics.renderer.textures = Math.max(0, stats.textures);
}

export function recordTerrainRendererDiagnostics(stats: Omit<
  TerrainRendererDiagnostics,
  'detailSwapsPerSecond' | 'geometryBuildsPerSecond' | 'geometryFinalizationsPerSecond'
> & { detailSwaps?: number }): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  const recordedAtMs = nowMs();
  pushRateSamples(terrainDetailSwapSamples, stats.detailSwaps ?? 0, recordedAtMs);
  diagnostics.terrainRenderer.visibleRegionCount = Math.max(0, stats.visibleRegionCount);
  diagnostics.terrainRenderer.fullDetailRegionCount = Math.max(0, stats.fullDetailRegionCount);
  diagnostics.terrainRenderer.coarseRegionCount = Math.max(0, stats.coarseRegionCount);
  diagnostics.terrainRenderer.ultraCoarseRegionCount = Math.max(0, stats.ultraCoarseRegionCount);
  diagnostics.terrainRenderer.macroMeshCount = Math.max(0, stats.macroMeshCount);
  diagnostics.terrainRenderer.macroRegionCount = Math.max(0, stats.macroRegionCount);
  diagnostics.terrainRenderer.hiddenByDistance = Math.max(0, stats.hiddenByDistance);
  diagnostics.terrainRenderer.hiddenByFrustum = Math.max(0, stats.hiddenByFrustum);
  diagnostics.terrainRenderer.hiddenByHorizon = Math.max(0, stats.hiddenByHorizon);
  diagnostics.terrainRenderer.detailSwapsPerSecond = ratePerSecond(terrainDetailSwapSamples, recordedAtMs);
  diagnostics.terrainRenderer.geometryBuildsPerSecond = ratePerSecond(terrainGeometryBuildSamples, recordedAtMs);
  diagnostics.terrainRenderer.geometryFinalizationsPerSecond = ratePerSecond(
    terrainGeometryFinalizationSamples,
    recordedAtMs
  );
  diagnostics.terrainRenderer.pendingRegionBuilds = Math.max(0, stats.pendingRegionBuilds);
  diagnostics.terrainRenderer.pendingRegionFinalizations = Math.max(0, stats.pendingRegionFinalizations);
  diagnostics.terrainRenderer.adaptiveVisibilityScale = Math.max(0, stats.adaptiveVisibilityScale);
}

export function recordTerrainGeometryBuild(count = 1): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  const recordedAtMs = nowMs();
  pushRateSamples(terrainGeometryBuildSamples, count, recordedAtMs);
  diagnostics.terrainRenderer.geometryBuildsPerSecond = ratePerSecond(terrainGeometryBuildSamples, recordedAtMs);
}

export function recordTerrainGeometryFinalization(count = 1): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  const recordedAtMs = nowMs();
  pushRateSamples(terrainGeometryFinalizationSamples, count, recordedAtMs);
  diagnostics.terrainRenderer.geometryFinalizationsPerSecond = ratePerSecond(
    terrainGeometryFinalizationSamples,
    recordedAtMs
  );
}

export function recordAudioRuntimeState(stats: {
  userActivated: boolean;
  contextState: AudioDiagnostics['contextState'];
  loadedSounds: number;
  pendingLoads: number;
  pendingPreloads: number;
  activeDecodes: number;
  queuedDecodes: number;
}): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.audio.userActivated = stats.userActivated;
  diagnostics.audio.contextState = stats.contextState;
  diagnostics.audio.loadedSounds = Math.max(0, stats.loadedSounds);
  diagnostics.audio.pendingLoads = Math.max(0, stats.pendingLoads);
  diagnostics.audio.pendingPreloads = Math.max(0, stats.pendingPreloads);
  diagnostics.audio.activeDecodes = Math.max(0, stats.activeDecodes);
  diagnostics.audio.queuedDecodes = Math.max(0, stats.queuedDecodes);
}

export function recordAudioPreloadRequest(input: {
  soundCount: number;
  queuedForActivation: boolean;
}): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.audio.preloadRequests++;
  if (input.queuedForActivation && input.soundCount > 0) {
    diagnostics.audio.preloadWaitsForActivation++;
  }
}

export function recordAudioPreloadFlush(input: {
  soundCount: number;
  durationMs: number;
}): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.audio.preloadFlushes++;
  diagnostics.audio.preloadFlushSounds += Math.max(0, input.soundCount);
  diagnostics.audio.maxLoadWaitMs = Math.max(diagnostics.audio.maxLoadWaitMs, Math.max(0, input.durationMs));
}

export function recordAudioLoadRequest(cacheHit: boolean): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.audio.loadRequests++;
  if (cacheHit) diagnostics.audio.cacheHits++;
}

export function recordAudioLoadSample(sample: AudioLoadSample): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  if (!sample.ok) diagnostics.audio.failedLoads++;
  diagnostics.audio.maxFetchMs = Math.max(diagnostics.audio.maxFetchMs, Math.max(0, sample.fetchMs));
  diagnostics.audio.maxDecodeMs = Math.max(diagnostics.audio.maxDecodeMs, Math.max(0, sample.decodeMs));
  pushAudioLoadSample(sample);
}

export function recordAudioPlayRequest(): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.audio.playRequests++;
}

export function recordAudioPlayLoadWait(sample: AudioPlayWaitSample): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  diagnostics.audio.playLoadWaits++;
  diagnostics.audio.maxLoadWaitMs = Math.max(diagnostics.audio.maxLoadWaitMs, Math.max(0, sample.waitedMs));
  pushAudioPlayWaitSample(sample);
}

export function recordFrameWorkDuration(label: string, startedAtMs: number, endedAtMs = nowMs()): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;

  const durationMs = Math.max(0, endedAtMs - startedAtMs);
  if (!Number.isFinite(durationMs) || durationMs < MIN_FRAME_WORK_SAMPLE_MS) return;

  pushWorkSample({
    label,
    durationMs,
    endedAtMs,
  });
}

export function measureFrameWork<T>(label: string, work: () => T): T {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return work();

  const startedAtMs = nowMs();
  try {
    return work();
  } finally {
    recordFrameWorkDuration(label, startedAtMs);
  }
}

export function beginFrameWorkTiming(): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED) return;
  activeFrameWorkStartedAtMs = nowMs();
}

export function finishFrameWorkTiming(label: string): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED || activeFrameWorkStartedAtMs <= 0) return;

  recordFrameWorkDuration(label, activeFrameWorkStartedAtMs);
  activeFrameWorkStartedAtMs = 0;
}

function recordLongTaskEntry(entry: PerformanceEntry): void {
  const longTask = entry as PerformanceEntry & {
    attribution?: Array<{
      name?: string;
      entryType?: string;
      containerType?: string;
      containerName?: string;
      containerSrc?: string;
      containerId?: string;
    }>;
  };

  const sample: LongTaskSample = {
    startedAtMs: entry.startTime,
    durationMs: entry.duration,
    name: entry.name,
    attribution: (longTask.attribution ?? []).slice(0, 4).map((attribution) => ({
      name: attribution.name ?? '',
      entryType: attribution.entryType ?? '',
      containerType: attribution.containerType,
      containerName: attribution.containerName,
      containerSrc: attribution.containerSrc,
      containerId: attribution.containerId,
    })),
  };

  pushLongTaskSample(sample);
  backfillRecentHitchesWithLongTask(sample);
}

function installLongTaskObserver(): void {
  if (!CLIENT_DIAGNOSTICS_ENABLED || longTaskObserver || typeof PerformanceObserver === 'undefined') return;

  const supportedEntryTypes = PerformanceObserver.supportedEntryTypes ?? [];
  if (!supportedEntryTypes.includes('longtask')) return;

  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        recordLongTaskEntry(entry);
      }
    });
    longTaskObserver.observe({ entryTypes: ['longtask'] });
  } catch {
    longTaskObserver = null;
  }
}

if (CLIENT_DIAGNOSTICS_ENABLED && typeof window !== 'undefined') {
  installLongTaskObserver();

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
