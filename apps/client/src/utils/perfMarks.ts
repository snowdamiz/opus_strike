import { useGameStore } from '../store/gameStore';

export interface FrameMetricSummary {
  frameMsP50: number;
  frameMsP95: number;
  frameMsP99: number;
  sampleCount: number;
}

export interface NetworkMetricSummary {
  messagesPerSecond: Record<string, number>;
  bytesPerSecond: Record<string, number>;
}

export interface SystemMetricSummary {
  name: string;
  lastMs: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
}

export interface SpawnMetricSummary {
  name: string;
  count: number;
}

export interface VoxelWorldMetricSummary {
  generationMs: number;
  meshBuildMsP95: number;
  meshBuildCount: number;
  totalChunkSlots: number;
  renderableChunks: number;
  renderableRegions: number;
  emptyChunkSlots: number;
  colliders: number;
}

export interface PhysicsQueryMetricSummary {
  countPerSecond: number;
  msPerSecond: number;
  byFeature: Record<string, {
    countPerSecond: number;
    msPerSecond: number;
    droppedPerSecond: number;
  }>;
}

export interface RendererMetricSummary {
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  materials: number;
  shaderPrograms: number;
}

export interface WorldVisualMetricSummary {
  atmosphereParticles: number;
  worldDressingInstances: number;
  fullRemoteBodies: number;
}

export interface StartupStageMetricSummary {
  name: string;
  lastMs: number;
  p95Ms: number;
  p99Ms: number;
  sampleCount: number;
}

export interface StartupWarmupMetricSummary {
  key: string | null;
  mapSeed: number | null;
  graphicsProfile: string | null;
  heroId: string | null;
  state: string;
  label: string;
  progress: number;
  fallbackReason: string | null;
  totalMs: number;
  topStage: StartupStageMetricSummary | null;
  stages: StartupStageMetricSummary[];
  firstFiveSecondsFrame: FrameMetricSummary & {
    active: boolean;
    elapsedMs: number;
  };
}

export interface GameStoreMutationMetricSummary {
  mutationsPerSecond: number;
}

export interface ClientPerfSnapshot {
  frame: FrameMetricSummary;
  network: NetworkMetricSummary;
  systems: SystemMetricSummary[];
  recentSpawns: SpawnMetricSummary[];
  renderer: RendererMetricSummary;
  worldVisuals: WorldVisualMetricSummary;
  voxelWorld: VoxelWorldMetricSummary;
  physicsQueries: PhysicsQueryMetricSummary;
  activeEffects: number;
  projectileCounts: Record<string, number>;
  temporaryColliders: number;
  activeFrameSystems: number;
  activeLights: number;
  startup: StartupWarmupMetricSummary;
  gameStoreMutations: GameStoreMutationMetricSummary;
}

const FRAME_SAMPLE_LIMIT = 240;
const SYSTEM_SAMPLE_LIMIT = 180;
const STARTUP_STAGE_SAMPLE_LIMIT = 48;
const SPAWN_WINDOW_MS = 3000;
const NETWORK_WINDOW_MS = 1000;
const STARTUP_REVEAL_SAMPLE_WINDOW_MS = 5000;
const frameSamples: number[] = [];
const voxelMeshBuildSamples: number[] = [];
const frameSystems = new Set<string>();
let activeLights = 0;
let voxelWorldMetrics: VoxelWorldMetricSummary = {
  generationMs: 0,
  meshBuildMsP95: 0,
  meshBuildCount: 0,
  totalChunkSlots: 0,
  renderableChunks: 0,
  renderableRegions: 0,
  emptyChunkSlots: 0,
  colliders: 0,
};
let physicsQueryWindowStartedAt = 0;
let physicsQueryWindowCount = 0;
let physicsQueryWindowMs = 0;
let physicsQueryMetrics: PhysicsQueryMetricSummary = {
  countPerSecond: 0,
  msPerSecond: 0,
  byFeature: {},
};
let temporaryColliderCountProvider: () => number = () => 0;
let rendererMetrics: RendererMetricSummary = {
  drawCalls: 0,
  triangles: 0,
  textures: 0,
  geometries: 0,
  materials: 0,
  shaderPrograms: 0,
};
let worldVisualMetrics: WorldVisualMetricSummary = {
  atmosphereParticles: 0,
  worldDressingInstances: 0,
  fullRemoteBodies: 0,
};
let startupWarmupMetrics: StartupWarmupMetricSummary = {
  key: null,
  mapSeed: null,
  graphicsProfile: null,
  heroId: null,
  state: 'idle',
  label: 'Resources',
  progress: 0,
  fallbackReason: null,
  totalMs: 0,
  topStage: null,
  stages: [],
  firstFiveSecondsFrame: {
    frameMsP50: 0,
    frameMsP95: 0,
    frameMsP99: 0,
    sampleCount: 0,
    active: false,
    elapsedMs: 0,
  },
};
let startupWarmupStartedAt = 0;
let startupRevealStartedAt = 0;
const startupStageSamples = new Map<string, SystemSamples>();
const startupRevealFrameSamples: number[] = [];

interface SystemSamples {
  samples: number[];
  lastMs: number;
}

interface NetworkSample {
  type: string;
  bytes: number;
  time: number;
}

interface SpawnMarker {
  name: string;
  time: number;
}

interface PhysicsFeatureWindow {
  count: number;
  ms: number;
  dropped: number;
}

const networkSamples: NetworkSample[] = [];
const systemSamples = new Map<string, SystemSamples>();
const spawnMarkers: SpawnMarker[] = [];
const physicsFeatureWindow = new Map<string, PhysicsFeatureWindow>();
const gameStoreMutationSamples: number[] = [];
let gameStoreMutationObserverStarted = false;

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index];
}

function approxBytes(payload: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).length;
  } catch {
    return 0;
  }
}

function pruneNetwork(now: number): void {
  while (networkSamples.length > 0 && now - networkSamples[0].time > NETWORK_WINDOW_MS) {
    networkSamples.shift();
  }
}

function pruneSpawnMarkers(now: number): void {
  while (spawnMarkers.length > 0 && now - spawnMarkers[0].time > SPAWN_WINDOW_MS) {
    spawnMarkers.shift();
  }
}

function pruneGameStoreMutationSamples(now: number): void {
  while (gameStoreMutationSamples.length > 0 && now - gameStoreMutationSamples[0] > NETWORK_WINDOW_MS) {
    gameStoreMutationSamples.shift();
  }
}

function ensureGameStoreMutationObserver(): void {
  if (gameStoreMutationObserverStarted) return;
  gameStoreMutationObserverStarted = true;
  useGameStore.subscribe(() => {
    gameStoreMutationSamples.push(performance.now());
  });
}

export function recordFrameSample(deltaSeconds: number): void {
  const frameMs = deltaSeconds * 1000;
  frameSamples.push(frameMs);
  if (frameSamples.length > FRAME_SAMPLE_LIMIT) {
    frameSamples.shift();
  }

  if (startupRevealStartedAt > 0) {
    const now = performance.now();
    const elapsedMs = now - startupRevealStartedAt;
    if (elapsedMs <= STARTUP_REVEAL_SAMPLE_WINDOW_MS) {
      startupRevealFrameSamples.push(frameMs);
    }
  }
}

export function recordSystemTime(name: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;

  let entry = systemSamples.get(name);
  if (!entry) {
    entry = { samples: [], lastMs: 0 };
    systemSamples.set(name, entry);
  }

  entry.lastMs = ms;
  entry.samples.push(ms);
  if (entry.samples.length > SYSTEM_SAMPLE_LIMIT) {
    entry.samples.shift();
  }
}

export function recordStartupStageTime(name: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;

  let entry = startupStageSamples.get(name);
  if (!entry) {
    entry = { samples: [], lastMs: 0 };
    startupStageSamples.set(name, entry);
  }

  entry.lastMs = ms;
  entry.samples.push(ms);
  if (entry.samples.length > STARTUP_STAGE_SAMPLE_LIMIT) {
    entry.samples.shift();
  }
}

export function recordSpawnMarker(name: string): void {
  const now = performance.now();
  spawnMarkers.push({ name, time: now });
  pruneSpawnMarkers(now);
}

export function recordVoxelMapGenerated(metrics: {
  generationMs: number;
  totalChunkSlots: number;
  renderableChunks: number;
  emptyChunkSlots: number;
  colliders: number;
}): void {
  voxelMeshBuildSamples.length = 0;
  voxelWorldMetrics = {
    ...voxelWorldMetrics,
    ...metrics,
    renderableRegions: 0,
    meshBuildMsP95: 0,
    meshBuildCount: 0,
  };
}

export function recordVoxelWorldRegions(renderableRegions: number): void {
  if (!Number.isFinite(renderableRegions) || renderableRegions < 0) return;

  voxelWorldMetrics = {
    ...voxelWorldMetrics,
    renderableRegions,
  };
}

export function recordVoxelMeshBuild(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;

  voxelMeshBuildSamples.push(ms);
  if (voxelMeshBuildSamples.length > SYSTEM_SAMPLE_LIMIT) {
    voxelMeshBuildSamples.shift();
  }

  voxelWorldMetrics = {
    ...voxelWorldMetrics,
    meshBuildMsP95: percentile(voxelMeshBuildSamples, 0.95),
    meshBuildCount: voxelWorldMetrics.meshBuildCount + 1,
  };
}

function resetPhysicsWindow(now: number): void {
  physicsQueryWindowStartedAt = now;
  physicsQueryWindowCount = 0;
  physicsQueryWindowMs = 0;
  physicsFeatureWindow.clear();
}

export function recordPhysicsQueryTime(ms: number, feature = 'global'): void {
  if (!Number.isFinite(ms) || ms < 0) return;

  const now = performance.now();
  if (physicsQueryWindowStartedAt === 0) {
    physicsQueryWindowStartedAt = now;
  }

  physicsQueryWindowCount++;
  physicsQueryWindowMs += ms;
  const featureEntry = physicsFeatureWindow.get(feature) ?? { count: 0, ms: 0, dropped: 0 };
  featureEntry.count++;
  featureEntry.ms += ms;
  physicsFeatureWindow.set(feature, featureEntry);

  const elapsed = now - physicsQueryWindowStartedAt;
  if (elapsed < NETWORK_WINDOW_MS) return;

  const seconds = elapsed / 1000;
  const byFeature: PhysicsQueryMetricSummary['byFeature'] = {};
  for (const [name, entry] of physicsFeatureWindow) {
    byFeature[name] = {
      countPerSecond: entry.count / seconds,
      msPerSecond: entry.ms / seconds,
      droppedPerSecond: entry.dropped / seconds,
    };
  }

  physicsQueryMetrics = {
    countPerSecond: physicsQueryWindowCount / seconds,
    msPerSecond: physicsQueryWindowMs / seconds,
    byFeature,
  };
  resetPhysicsWindow(now);
}

export function recordPhysicsQueryDropped(feature: string): void {
  const now = performance.now();
  if (physicsQueryWindowStartedAt === 0) {
    physicsQueryWindowStartedAt = now;
  }

  const featureEntry = physicsFeatureWindow.get(feature) ?? { count: 0, ms: 0, dropped: 0 };
  featureEntry.dropped++;
  physicsFeatureWindow.set(feature, featureEntry);
}

export function registerFrameSystem(name: string): () => void {
  frameSystems.add(name);
  return () => {
    frameSystems.delete(name);
  };
}

export function recordNetworkMessage(type: string, payload: unknown): void {
  const now = performance.now();
  networkSamples.push({ type, bytes: approxBytes(payload), time: now });
  pruneNetwork(now);
}

export function setActiveLightCount(count: number): void {
  activeLights = Math.max(0, count);
}

export function setRendererMetricSummary(metrics: Partial<RendererMetricSummary>): void {
  rendererMetrics = {
    ...rendererMetrics,
    ...metrics,
  };
}

export function setAtmosphereParticleCount(count: number): void {
  worldVisualMetrics.atmosphereParticles = Math.max(0, Math.round(count));
}

export function setWorldDressingInstanceCount(count: number): void {
  worldVisualMetrics.worldDressingInstances = Math.max(0, Math.round(count));
}

export function setFullRemoteBodyCount(count: number): void {
  worldVisualMetrics.fullRemoteBodies = Math.max(0, Math.round(count));
}

export function setTemporaryColliderCountProvider(provider: () => number): void {
  temporaryColliderCountProvider = provider;
}

function getStartupStageSummaries(): StartupStageMetricSummary[] {
  return Array.from(startupStageSamples.entries())
    .map(([name, entry]) => ({
      name,
      lastMs: entry.lastMs,
      p95Ms: percentile(entry.samples, 0.95),
      p99Ms: percentile(entry.samples, 0.99),
      sampleCount: entry.samples.length,
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms);
}

function getStartupRevealFrameSummary(now: number): StartupWarmupMetricSummary['firstFiveSecondsFrame'] {
  if (startupRevealStartedAt === 0) {
    return {
      frameMsP50: 0,
      frameMsP95: 0,
      frameMsP99: 0,
      sampleCount: 0,
      active: false,
      elapsedMs: 0,
    };
  }

  const elapsedMs = now - startupRevealStartedAt;
  return {
    frameMsP50: percentile(startupRevealFrameSamples, 0.5),
    frameMsP95: percentile(startupRevealFrameSamples, 0.95),
    frameMsP99: percentile(startupRevealFrameSamples, 0.99),
    sampleCount: startupRevealFrameSamples.length,
    active: elapsedMs <= STARTUP_REVEAL_SAMPLE_WINDOW_MS,
    elapsedMs: Math.min(elapsedMs, STARTUP_REVEAL_SAMPLE_WINDOW_MS),
  };
}

export function beginStartupWarmupSession(input: {
  key: string;
  mapSeed: number;
  graphicsProfile: string;
  heroId: string | null;
}): void {
  startupWarmupStartedAt = performance.now();
  startupRevealStartedAt = 0;
  startupRevealFrameSamples.length = 0;
  startupStageSamples.clear();
  startupWarmupMetrics = {
    key: input.key,
    mapSeed: input.mapSeed >>> 0,
    graphicsProfile: input.graphicsProfile,
    heroId: input.heroId,
    state: 'preparingCpu',
    label: 'Resources',
    progress: 0.08,
    fallbackReason: null,
    totalMs: 0,
    topStage: null,
    stages: [],
    firstFiveSecondsFrame: {
      frameMsP50: 0,
      frameMsP95: 0,
      frameMsP99: 0,
      sampleCount: 0,
      active: false,
      elapsedMs: 0,
    },
  };
}

export function updateStartupWarmupMetrics(input: {
  state: string;
  label: string;
  progress: number;
  fallbackReason?: string | null;
}): void {
  const now = performance.now();
  const stages = getStartupStageSummaries();
  startupWarmupMetrics = {
    ...startupWarmupMetrics,
    state: input.state,
    label: input.label,
    progress: Math.min(1, Math.max(0, input.progress)),
    fallbackReason: input.fallbackReason ?? null,
    totalMs: startupWarmupStartedAt > 0 ? now - startupWarmupStartedAt : 0,
    stages,
    topStage: stages[0] ?? null,
    firstFiveSecondsFrame: getStartupRevealFrameSummary(now),
  };
}

export function markStartupRevealStart(key: string): void {
  if (startupWarmupMetrics.key !== key) return;
  if (startupRevealStartedAt > 0) return;

  startupRevealStartedAt = performance.now();
  startupRevealFrameSamples.length = 0;
}

export function getClientPerfSnapshot(): ClientPerfSnapshot {
  ensureGameStoreMutationObserver();
  const now = performance.now();
  pruneNetwork(now);
  pruneSpawnMarkers(now);
  pruneGameStoreMutationSamples(now);
  updateStartupWarmupMetrics({
    state: startupWarmupMetrics.state,
    label: startupWarmupMetrics.label,
    progress: startupWarmupMetrics.progress,
    fallbackReason: startupWarmupMetrics.fallbackReason,
  });

  const messagesPerSecond: Record<string, number> = {};
  const bytesPerSecond: Record<string, number> = {};
  for (const sample of networkSamples) {
    messagesPerSecond[sample.type] = (messagesPerSecond[sample.type] ?? 0) + 1;
    bytesPerSecond[sample.type] = (bytesPerSecond[sample.type] ?? 0) + sample.bytes;
  }

  const systems = Array.from(systemSamples.entries())
    .map(([name, entry]) => ({
      name,
      lastMs: entry.lastMs,
      p95Ms: percentile(entry.samples, 0.95),
      p99Ms: percentile(entry.samples, 0.99),
      sampleCount: entry.samples.length,
    }))
    .sort((a, b) => b.p95Ms - a.p95Ms)
    .slice(0, 3);

  const spawnCounts = new Map<string, number>();
  for (const marker of spawnMarkers) {
    spawnCounts.set(marker.name, (spawnCounts.get(marker.name) ?? 0) + 1);
  }
  const recentSpawns = Array.from(spawnCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const state = useGameStore.getState();
  const projectileCounts = {
    rockets: state.rockets.length,
    bombs: state.bombs.length,
    direBalls: state.direBalls.length,
    voidRays: state.voidRays.length,
    voidZones: state.voidZones.length,
    hookProjectiles: state.hookProjectiles.length,
    dragHooks: state.dragHooks.length,
    grappleTraps: state.grappleTraps.length,
    earthWalls: state.earthWalls.length,
  };

  return {
    frame: {
      frameMsP50: percentile(frameSamples, 0.5),
      frameMsP95: percentile(frameSamples, 0.95),
      frameMsP99: percentile(frameSamples, 0.99),
      sampleCount: frameSamples.length,
    },
    network: {
      messagesPerSecond,
      bytesPerSecond,
    },
    systems,
    recentSpawns,
    renderer: rendererMetrics,
    worldVisuals: worldVisualMetrics,
    voxelWorld: voxelWorldMetrics,
    physicsQueries: physicsQueryMetrics,
    activeEffects: Object.values(projectileCounts).reduce((sum, count) => sum + count, 0),
    projectileCounts,
    temporaryColliders: temporaryColliderCountProvider(),
    activeFrameSystems: frameSystems.size,
    activeLights,
    startup: startupWarmupMetrics,
    gameStoreMutations: {
      mutationsPerSecond: gameStoreMutationSamples.length,
    },
  };
}
