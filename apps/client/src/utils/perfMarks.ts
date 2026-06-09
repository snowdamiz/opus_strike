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
}

export interface ClientPerfSnapshot {
  frame: FrameMetricSummary;
  network: NetworkMetricSummary;
  systems: SystemMetricSummary[];
  recentSpawns: SpawnMetricSummary[];
  voxelWorld: VoxelWorldMetricSummary;
  physicsQueries: PhysicsQueryMetricSummary;
  activeEffects: number;
  projectileCounts: Record<string, number>;
  temporaryColliders: number;
  activeFrameSystems: number;
  activeLights: number;
}

const FRAME_SAMPLE_LIMIT = 240;
const SYSTEM_SAMPLE_LIMIT = 180;
const SPAWN_WINDOW_MS = 3000;
const NETWORK_WINDOW_MS = 1000;
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
};
let temporaryColliderCountProvider: () => number = () => 0;

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

const networkSamples: NetworkSample[] = [];
const systemSamples = new Map<string, SystemSamples>();
const spawnMarkers: SpawnMarker[] = [];

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

export function recordFrameSample(deltaSeconds: number): void {
  frameSamples.push(deltaSeconds * 1000);
  if (frameSamples.length > FRAME_SAMPLE_LIMIT) {
    frameSamples.shift();
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

export function recordPhysicsQueryTime(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;

  const now = performance.now();
  if (physicsQueryWindowStartedAt === 0) {
    physicsQueryWindowStartedAt = now;
  }

  physicsQueryWindowCount++;
  physicsQueryWindowMs += ms;

  const elapsed = now - physicsQueryWindowStartedAt;
  if (elapsed < NETWORK_WINDOW_MS) return;

  const seconds = elapsed / 1000;
  physicsQueryMetrics = {
    countPerSecond: physicsQueryWindowCount / seconds,
    msPerSecond: physicsQueryWindowMs / seconds,
  };
  physicsQueryWindowStartedAt = now;
  physicsQueryWindowCount = 0;
  physicsQueryWindowMs = 0;
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

export function setTemporaryColliderCountProvider(provider: () => number): void {
  temporaryColliderCountProvider = provider;
}

export function getClientPerfSnapshot(): ClientPerfSnapshot {
  const now = performance.now();
  pruneNetwork(now);
  pruneSpawnMarkers(now);

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
    voxelWorld: voxelWorldMetrics,
    physicsQueries: physicsQueryMetrics,
    activeEffects: Object.values(projectileCounts).reduce((sum, count) => sum + count, 0),
    projectileCounts,
    temporaryColliders: temporaryColliderCountProvider(),
    activeFrameSystems: frameSystems.size,
    activeLights,
  };
}
