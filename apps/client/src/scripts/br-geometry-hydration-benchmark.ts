import { performance } from 'node:perf_hooks';
import type { BufferGeometry } from 'three';
import { prepareVoxelMapCpu, type VoxelChunkRegion } from '../utils/mapWarmup/mapPrepCache';
import {
  buildVoxelRegionGeometry,
  clearVoxelGeometryCache,
} from '../components/game/procedural/meshBuilder';
import type { VoxelRegionGeometryDetail } from '../components/game/procedural/meshGeometryData';

const DEFAULT_BENCHMARK_SEED = 20260611;
const seed = Number.parseInt(process.env.BR_MAP_BENCH_SEED ?? `${DEFAULT_BENCHMARK_SEED}`, 10) >>> 0;

interface HydrationSummary {
  detail: VoxelRegionGeometryDetail;
  buildMs: number;
  regions: number;
  bytes: number;
  vertices: number;
  triangles: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * value) - 1));
  return sorted[index] ?? 0;
}

function geometryBytes(geometry: BufferGeometry): number {
  let bytes = 0;
  for (const attribute of Object.values(geometry.attributes)) {
    bytes += attribute.array.byteLength;
  }
  if (geometry.index) bytes += geometry.index.array.byteLength;
  return bytes;
}

function summarizeHydration(
  manifest: ReturnType<typeof prepareVoxelMapCpu>['manifest'],
  regions: VoxelChunkRegion[],
  detail: VoxelRegionGeometryDetail
): HydrationSummary {
  clearVoxelGeometryCache(manifest.id);

  const regionTimes: number[] = [];
  let bytes = 0;
  let vertices = 0;
  let triangles = 0;
  const startedAt = performance.now();

  for (const region of regions) {
    const regionStartedAt = performance.now();
    const geometry = buildVoxelRegionGeometry(manifest, region.id, region.chunks, detail);
    regionTimes.push(performance.now() - regionStartedAt);
    bytes += geometryBytes(geometry);
    vertices += geometry.getAttribute('position').count;
    triangles += geometry.index ? geometry.index.count / 3 : 0;
  }

  const buildMs = performance.now() - startedAt;
  regionTimes.sort((a, b) => a - b);

  return {
    detail,
    buildMs,
    regions: regions.length,
    bytes,
    vertices,
    triangles,
    p50Ms: percentile(regionTimes, 0.5),
    p95Ms: percentile(regionTimes, 0.95),
    p99Ms: percentile(regionTimes, 0.99),
    maxMs: regionTimes.at(-1) ?? 0,
  };
}

const preparedMap = prepareVoxelMapCpu({
  seed,
  mapSize: 'large',
  mapProfileId: 'battle_royal_large',
  source: 'test',
});

const { manifest, renderableRegions } = preparedMap;
const full = summarizeHydration(manifest, renderableRegions, 'full');
const coarse = summarizeHydration(manifest, renderableRegions, 'coarse');
const ultraCoarse = summarizeHydration(manifest, renderableRegions, 'ultraCoarse');
clearVoxelGeometryCache(manifest.id);

console.log(JSON.stringify({
  seed,
  manifestId: manifest.id,
  renderableRegions: renderableRegions.length,
  full,
  coarse,
  ultraCoarse,
}, null, 2));
