import { performance } from 'node:perf_hooks';
import type { GraphicsPreset } from '../store/settingsStore';
import { prepareVoxelMapCpu, type VoxelChunkRegion } from '../utils/mapWarmup/mapPrepCache';
import {
  getBattleRoyalWarmupFullDetailDistance,
  getCentralBattleRoyalRegions,
} from '../utils/mapWarmup/mapGeometryWarmup';
import { buildVoxelRegionGeometryData, type VoxelRegionGeometryDetail } from '../components/game/procedural/meshGeometryData';
import {
  BATTLE_ROYAL_VISIBILITY_CONFIG,
  WORLD_PERFORMANCE_BUDGETS,
  type BattleRoyalVisibilityConfig,
} from '../components/game/visualQuality';

const DEFAULT_BENCHMARK_SEED = 20260611;
const seed = Number.parseInt(process.env.BR_MAP_BENCH_SEED ?? `${DEFAULT_BENCHMARK_SEED}`, 10) >>> 0;

interface GeometrySummary {
  buildMs: number;
  bytes: number;
  vertices: number;
  triangles: number;
}

interface RegionGeometrySummary {
  bytes: number;
  vertices: number;
  triangles: number;
}

interface GeometryBuildSummary {
  summary: GeometrySummary;
  byRegion: Map<string, RegionGeometrySummary>;
}

function geometryBytes(data: ReturnType<typeof buildVoxelRegionGeometryData>): number {
  return data.positions.byteLength +
    data.normals.byteLength +
    data.uvs.byteLength +
    data.textureLayers.byteLength +
    data.indices.byteLength;
}

function summarizeGeometry(
  regions: VoxelChunkRegion[],
  detail: VoxelRegionGeometryDetail,
  manifest: ReturnType<typeof prepareVoxelMapCpu>['manifest']
): GeometryBuildSummary {
  const startedAt = performance.now();
  const byRegion = new Map<string, RegionGeometrySummary>();
  let bytes = 0;
  let vertices = 0;
  let triangles = 0;

  for (const region of regions) {
    const data = buildVoxelRegionGeometryData(manifest, region.chunks, detail);
    const regionBytes = geometryBytes(data);
    const regionVertices = data.positions.length / 3;
    const regionTriangles = data.indices.length / 3;
    byRegion.set(region.id, {
      bytes: regionBytes,
      vertices: regionVertices,
      triangles: regionTriangles,
    });
    bytes += regionBytes;
    vertices += regionVertices;
    triangles += regionTriangles;
  }

  return {
    summary: {
      buildMs: performance.now() - startedAt,
      bytes,
      vertices,
      triangles,
    },
    byRegion,
  };
}

function isRegionWithinDistance(
  region: VoxelChunkRegion,
  maxDistance: number,
  focus: { x: number; y: number; z: number }
): boolean {
  const dx = region.bounds.center.x - focus.x;
  const dy = region.bounds.center.y - focus.y;
  const dz = region.bounds.center.z - focus.z;
  const radiusAdjustedDistance = maxDistance + region.bounds.radius;
  return dx * dx + dy * dy + dz * dz <= radiusAdjustedDistance * radiusAdjustedDistance;
}

function summarizeVisibilityBudget(
  profile: GraphicsPreset,
  config: BattleRoyalVisibilityConfig,
  regions: VoxelChunkRegion[],
  fullByRegion: Map<string, RegionGeometrySummary>,
  coarseByRegion: Map<string, RegionGeometrySummary>,
  focus: { x: number; y: number; z: number },
  preparedMap: ReturnType<typeof prepareVoxelMapCpu>
): Record<string, number | boolean> {
  let visibleRegions = 0;
  let fullDetailRegions = 0;
  let bytes = 0;
  let vertices = 0;
  let triangles = 0;

  for (const region of regions) {
    if (!isRegionWithinDistance(region, config.terrainCullDistance, focus)) continue;

    visibleRegions++;
    const fullDetail = isRegionWithinDistance(region, config.terrainLodFullDistance, focus);
    if (fullDetail) fullDetailRegions++;

    const stats = (fullDetail ? fullByRegion : coarseByRegion).get(region.id);
    if (!stats) continue;
    bytes += stats.bytes;
    vertices += stats.vertices;
    triangles += stats.triangles;
  }

  const triangleBudget = WORLD_PERFORMANCE_BUDGETS[profile].triangles;
  const warmupRegions = getCentralBattleRoyalRegions(preparedMap, { graphicsPreset: profile });

  return {
    cameraFar: config.cameraFar,
    terrainCullDistance: config.terrainCullDistance,
    terrainLodFullDistance: config.terrainLodFullDistance,
    terrainPrebuildFullDistance: getBattleRoyalWarmupFullDetailDistance({ graphicsPreset: profile }),
    visibleRegions,
    fullDetailRegions,
    warmupFullDetailRegions: warmupRegions.length,
    terrainBytes: bytes,
    terrainVertices: vertices,
    terrainTriangles: triangles,
    triangleBudget,
    terrainTriangleBudgetRatio: Number((triangles / Math.max(1, triangleBudget)).toFixed(4)),
    terrainTriangleBudgetExceeded: triangles > triangleBudget,
  };
}

const preparedMap = prepareVoxelMapCpu({
  seed,
  mapSize: 'large',
  mapProfileId: 'battle_royal_large',
  source: 'test',
});
const { manifest, renderableRegions } = preparedMap;
const focus = {
  x: manifest.origin.x + (manifest.size.x * manifest.voxelSize.x) / 2,
  y: manifest.origin.y + (manifest.size.y * manifest.voxelSize.y) * 0.25,
  z: manifest.origin.z + (manifest.size.z * manifest.voxelSize.z) / 2,
};

const fullBuild = summarizeGeometry(renderableRegions, 'full', manifest);
const coarseBuild = summarizeGeometry(renderableRegions, 'coarse', manifest);
const full = fullBuild.summary;
const coarse = coarseBuild.summary;
const byteRatio = coarse.bytes / Math.max(1, full.bytes);
const triangleRatio = coarse.triangles / Math.max(1, full.triangles);

const visibility = Object.fromEntries(
  Object.entries(BATTLE_ROYAL_VISIBILITY_CONFIG).map(([profile, config]) => [
    profile,
    summarizeVisibilityBudget(
      profile as GraphicsPreset,
      config,
      renderableRegions,
      fullBuild.byRegion,
      coarseBuild.byRegion,
      focus,
      preparedMap
    ),
  ])
);

console.log(JSON.stringify({
  seed,
  manifestId: manifest.id,
  worldMeters: {
    x: manifest.size.x * manifest.voxelSize.x,
    y: manifest.size.y * manifest.voxelSize.y,
    z: manifest.size.z * manifest.voxelSize.z,
  },
  renderableRegions: renderableRegions.length,
  renderableChunks: preparedMap.renderableChunkCount,
  full,
  coarse,
  ratios: {
    bytes: Number(byteRatio.toFixed(4)),
    triangles: Number(triangleRatio.toFixed(4)),
  },
  visibility,
}, null, 2));

if (byteRatio > 0.18 || triangleRatio > 0.18) {
  throw new Error(`Coarse BR terrain LOD is too heavy: bytes=${byteRatio.toFixed(3)} triangles=${triangleRatio.toFixed(3)}`);
}

for (const [profile, summary] of Object.entries(visibility)) {
  if (summary.terrainTriangleBudgetExceeded) {
    throw new Error(
      `${profile} BR terrain exceeds triangle budget: ${summary.terrainTriangles} > ${summary.triangleBudget}`
    );
  }
}
