import { performance } from 'node:perf_hooks';
import * as THREE from 'three';
import type { GraphicsPreset } from '../store/settingsStore';
import { prepareVoxelMapCpu, type VoxelChunkRegion } from '../utils/mapWarmup/mapPrepCache';
import { getCentralBattleRoyalRegions } from '../utils/mapWarmup/mapGeometryWarmup';
import {
  buildVoxelRegionGeometryData,
  type VoxelRegionGeometryDetail,
} from '../components/game/procedural/meshGeometryData';
import {
  BATTLE_ROYAL_DEPLOYMENT_VISIBILITY_CONFIG,
  BATTLE_ROYAL_VISIBILITY_CONFIG,
  WORLD_PERFORMANCE_BUDGETS,
  type BattleRoyalVisibilityConfig,
} from '../components/game/visualQuality';
import {
  isBattleRoyalRegionInsideCullDistance,
  selectBattleRoyalTerrainDetail,
} from '../components/game/battleRoyalTerrainLod';

const DEFAULT_BENCHMARK_SEED = 20260611;
const seed = Number.parseInt(process.env.BR_MAP_BENCH_SEED ?? `${DEFAULT_BENCHMARK_SEED}`, 10) >>> 0;
const MAX_RUNTIME_TERRAIN_TRIANGLE_BUDGET_RATIO = 0.85;
const DEPLOYMENT_TERRAIN_TRIANGLE_BUDGETS: Record<GraphicsPreset, number> = {
  potato: 2_200_000,
  competitive: 2_800_000,
  balanced: 3_500_000,
  cinematic: 4_400_000,
};
const HIGH_VANTAGE_SAMPLE_COUNT = 6;
const HIGH_VANTAGE_MIN_SPACING_METERS = 38;
const HIGH_VANTAGE_DIRECTIONS = [
  { name: 'north', x: 0, z: -1 },
  { name: 'east', x: 1, z: 0 },
  { name: 'south', x: 0, z: 1 },
  { name: 'west', x: -1, z: 0 },
  { name: 'northEast', x: Math.SQRT1_2, z: -Math.SQRT1_2 },
  { name: 'southEast', x: Math.SQRT1_2, z: Math.SQRT1_2 },
  { name: 'southWest', x: -Math.SQRT1_2, z: Math.SQRT1_2 },
  { name: 'northWest', x: -Math.SQRT1_2, z: -Math.SQRT1_2 },
];

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

interface ViewSample {
  name: string;
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface VisibilityEstimate {
  sample: string;
  cameraFar: number;
  terrainCullDistance: number;
  terrainLodFullDistance: number;
  terrainLodCoarseDistance: number;
  terrainLodUltraCoarseDistance: number;
  terrainPrebuildFullDistance: number;
  visibleRegions: number;
  fullDetailRegions: number;
  coarseRegions: number;
  ultraCoarseRegions: number;
  hiddenByDistance: number;
  hiddenByFrustum: number;
  warmupFullDetailRegions: number;
  terrainBytes: number;
  terrainVertices: number;
  terrainTriangles: number;
  triangleBudget: number;
  terrainTriangleBudgetRatio: number;
  terrainTriangleHeadroomRatio: number;
  terrainTriangleBudgetExceeded: boolean;
  terrainTriangleHeadroomExceeded: boolean;
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

function getRegionStats(
  detail: VoxelRegionGeometryDetail,
  regionId: string,
  summaries: Record<VoxelRegionGeometryDetail, Map<string, RegionGeometrySummary>>
): RegionGeometrySummary {
  const stats = summaries[detail].get(regionId);
  if (!stats) throw new Error(`Missing ${detail} geometry stats for region ${regionId}`);
  return stats;
}

function createHighestTerrainViewSamples(
  manifest: ReturnType<typeof prepareVoxelMapCpu>['manifest'],
  mode: 'runtime' | 'deployment'
): ViewSample[] {
  const candidates: Array<{ x: number; y: number; z: number; row: number }> = [];
  const { heightfield } = manifest;

  for (let z = 0; z < heightfield.size.z; z++) {
    for (let x = 0; x < heightfield.size.x; x++) {
      const row = heightfield.topSolidRows[x + z * heightfield.size.x] ?? 0;
      if (row <= 0) continue;
      candidates.push({
        x: heightfield.origin.x + (x + 0.5) * heightfield.voxelSize.x,
        y: heightfield.origin.y + row * heightfield.voxelSize.y,
        z: heightfield.origin.z + (z + 0.5) * heightfield.voxelSize.z,
        row,
      });
    }
  }

  candidates.sort((a, b) => b.row - a.row);

  const selected: typeof candidates = [];
  for (const candidate of candidates) {
    if (selected.some((sample) => Math.hypot(sample.x - candidate.x, sample.z - candidate.z) < HIGH_VANTAGE_MIN_SPACING_METERS)) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= HIGH_VANTAGE_SAMPLE_COUNT) break;
  }

  const cameraHeight = mode === 'deployment' ? 82 : 30;
  const lookDown = mode === 'deployment' ? 28 : 12;
  return selected.flatMap((sample, sampleIndex) => {
    const position = new THREE.Vector3(sample.x, sample.y + cameraHeight, sample.z);
    return HIGH_VANTAGE_DIRECTIONS.map((direction) => ({
      name: `${mode}:high-${sampleIndex + 1}:${direction.name}`,
      position,
      target: new THREE.Vector3(
        sample.x + direction.x * 140,
        sample.y - lookDown,
        sample.z + direction.z * 140
      ),
    }));
  });
}

function createCameraForSample(config: BattleRoyalVisibilityConfig, sample: ViewSample): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, config.cameraFar);
  camera.position.copy(sample.position);
  camera.lookAt(sample.target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

function estimateVisibilityForSample(
  profile: GraphicsPreset,
  config: BattleRoyalVisibilityConfig,
  regions: VoxelChunkRegion[],
  summaries: Record<VoxelRegionGeometryDetail, Map<string, RegionGeometrySummary>>,
  preparedMap: ReturnType<typeof prepareVoxelMapCpu>,
  sample: ViewSample,
  mode: 'runtime' | 'deployment'
): VisibilityEstimate {
  const camera = createCameraForSample(config, sample);
  const matrix = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const frustum = new THREE.Frustum().setFromProjectionMatrix(matrix);
  const sphere = new THREE.Sphere();
  let visibleRegions = 0;
  let fullDetailRegions = 0;
  let coarseRegions = 0;
  let ultraCoarseRegions = 0;
  let hiddenByDistance = 0;
  let hiddenByFrustum = 0;
  let bytes = 0;
  let vertices = 0;
  let triangles = 0;
  const visibleDetails: Array<{
    region: VoxelChunkRegion;
    detail: VoxelRegionGeometryDetail;
    distanceSq: number;
  }> = [];

  for (const region of regions) {
    const dx = region.bounds.center.x - camera.position.x;
    const dy = region.bounds.center.y - camera.position.y;
    const dz = region.bounds.center.z - camera.position.z;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (!isBattleRoyalRegionInsideCullDistance({
      manifest: preparedMap.manifest,
      visibility: config,
      cameraPosition: camera.position,
      regionBounds: region.bounds,
      distanceSq,
    })) {
      hiddenByDistance++;
      continue;
    }

    sphere.center.set(region.bounds.center.x, region.bounds.center.y, region.bounds.center.z);
    sphere.radius = region.bounds.radius;
    if (!frustum.intersectsSphere(sphere)) {
      hiddenByFrustum++;
      continue;
    }

    const detail = selectBattleRoyalTerrainDetail({
      manifest: preparedMap.manifest,
      visibility: config,
      cameraPosition: camera.position,
      regionBounds: region.bounds,
      distanceSq,
      viewportHeight: 1080,
      cameraFovDegrees: camera.fov,
    });
    const stats = getRegionStats(detail, region.id, summaries);
    visibleDetails.push({ region, detail, distanceSq });

    visibleRegions++;
    if (detail === 'full') {
      fullDetailRegions++;
    } else if (detail === 'coarse') {
      coarseRegions++;
    } else {
      ultraCoarseRegions++;
    }
    bytes += stats.bytes;
    vertices += stats.vertices;
    triangles += stats.triangles;
  }

  if (fullDetailRegions === 0 && visibleDetails.length > 0) {
    const closest = visibleDetails.reduce((best, entry) => (
      entry.distanceSq < best.distanceSq ? entry : best
    ));
    const previousStats = getRegionStats(closest.detail, closest.region.id, summaries);
    const fullStats = getRegionStats('full', closest.region.id, summaries);
    bytes += fullStats.bytes - previousStats.bytes;
    vertices += fullStats.vertices - previousStats.vertices;
    triangles += fullStats.triangles - previousStats.triangles;
    fullDetailRegions = 1;
    if (closest.detail === 'coarse') {
      coarseRegions = Math.max(0, coarseRegions - 1);
    } else if (closest.detail === 'ultraCoarse') {
      ultraCoarseRegions = Math.max(0, ultraCoarseRegions - 1);
    }
  }

  const triangleBudget = mode === 'deployment'
    ? DEPLOYMENT_TERRAIN_TRIANGLE_BUDGETS[profile]
    : WORLD_PERFORMANCE_BUDGETS[profile].triangles;
  const terrainTriangleBudgetRatio = triangles / Math.max(1, triangleBudget);
  const warmupRegions = getCentralBattleRoyalRegions(preparedMap, {
    battleRoyalFullDetailDistance: config.terrainPrebuildFullDistance,
  });

  return {
    sample: sample.name,
    cameraFar: config.cameraFar,
    terrainCullDistance: config.terrainCullDistance,
    terrainLodFullDistance: config.terrainLodFullDistance,
    terrainLodCoarseDistance: config.terrainLodCoarseDistance,
    terrainLodUltraCoarseDistance: config.terrainLodUltraCoarseDistance,
    terrainPrebuildFullDistance: config.terrainPrebuildFullDistance,
    visibleRegions,
    fullDetailRegions,
    coarseRegions,
    ultraCoarseRegions,
    hiddenByDistance,
    hiddenByFrustum,
    warmupFullDetailRegions: warmupRegions.length,
    terrainBytes: bytes,
    terrainVertices: vertices,
    terrainTriangles: triangles,
    triangleBudget,
    terrainTriangleBudgetRatio: Number(terrainTriangleBudgetRatio.toFixed(4)),
    terrainTriangleHeadroomRatio: MAX_RUNTIME_TERRAIN_TRIANGLE_BUDGET_RATIO,
    terrainTriangleBudgetExceeded: triangles > triangleBudget,
    terrainTriangleHeadroomExceeded: terrainTriangleBudgetRatio > MAX_RUNTIME_TERRAIN_TRIANGLE_BUDGET_RATIO,
  };
}

function summarizeWorstHighVantageVisibility(
  profile: GraphicsPreset,
  config: BattleRoyalVisibilityConfig,
  regions: VoxelChunkRegion[],
  summaries: Record<VoxelRegionGeometryDetail, Map<string, RegionGeometrySummary>>,
  preparedMap: ReturnType<typeof prepareVoxelMapCpu>,
  mode: 'runtime' | 'deployment'
): VisibilityEstimate {
  const estimates = createHighestTerrainViewSamples(preparedMap.manifest, mode)
    .map((sample) => estimateVisibilityForSample(profile, config, regions, summaries, preparedMap, sample, mode));

  return estimates.reduce((worst, estimate) => (
    estimate.terrainTriangles > worst.terrainTriangles ? estimate : worst
  ));
}

const preparedMap = prepareVoxelMapCpu({
  seed,
  mapSize: 'large',
  mapProfileId: 'battle_royal_large',
  source: 'test',
});
const { manifest, renderableRegions } = preparedMap;
const fullBuild = summarizeGeometry(renderableRegions, 'full', manifest);
const coarseBuild = summarizeGeometry(renderableRegions, 'coarse', manifest);
const ultraCoarseBuild = summarizeGeometry(renderableRegions, 'ultraCoarse', manifest);
const full = fullBuild.summary;
const coarse = coarseBuild.summary;
const ultraCoarse = ultraCoarseBuild.summary;
const coarseByteRatio = coarse.bytes / Math.max(1, full.bytes);
const coarseTriangleRatio = coarse.triangles / Math.max(1, full.triangles);
const ultraCoarseByteRatio = ultraCoarse.bytes / Math.max(1, coarse.bytes);
const ultraCoarseTriangleRatio = ultraCoarse.triangles / Math.max(1, coarse.triangles);
const summaries: Record<VoxelRegionGeometryDetail, Map<string, RegionGeometrySummary>> = {
  full: fullBuild.byRegion,
  coarse: coarseBuild.byRegion,
  ultraCoarse: ultraCoarseBuild.byRegion,
};

const runtimeHighVantage = Object.fromEntries(
  Object.entries(BATTLE_ROYAL_VISIBILITY_CONFIG).map(([profile, config]) => [
    profile,
    summarizeWorstHighVantageVisibility(
      profile as GraphicsPreset,
      config,
      renderableRegions,
      summaries,
      preparedMap,
      'runtime'
    ),
  ])
);

const deploymentHighVantage = Object.fromEntries(
  Object.entries(BATTLE_ROYAL_DEPLOYMENT_VISIBILITY_CONFIG).map(([profile, config]) => [
    profile,
    summarizeWorstHighVantageVisibility(
      profile as GraphicsPreset,
      config,
      renderableRegions,
      summaries,
      preparedMap,
      'deployment'
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
  ultraCoarse,
  ratios: {
    coarseToFullBytes: Number(coarseByteRatio.toFixed(4)),
    coarseToFullTriangles: Number(coarseTriangleRatio.toFixed(4)),
    ultraCoarseToCoarseBytes: Number(ultraCoarseByteRatio.toFixed(4)),
    ultraCoarseToCoarseTriangles: Number(ultraCoarseTriangleRatio.toFixed(4)),
  },
  runtimeHighVantage,
  deploymentHighVantage,
}, null, 2));

if (coarseByteRatio > 0.18 || coarseTriangleRatio > 0.18) {
  throw new Error(`Coarse BR terrain LOD is too heavy: bytes=${coarseByteRatio.toFixed(3)} triangles=${coarseTriangleRatio.toFixed(3)}`);
}

if (ultraCoarseByteRatio > 0.5 || ultraCoarseTriangleRatio > 0.5) {
  throw new Error(`Ultra-coarse BR terrain LOD should be at least 50% cheaper than coarse: bytes=${ultraCoarseByteRatio.toFixed(3)} triangles=${ultraCoarseTriangleRatio.toFixed(3)}`);
}

for (const [profile, summary] of Object.entries(runtimeHighVantage)) {
  if (summary.terrainTriangleBudgetExceeded) {
    throw new Error(
      `${profile} runtime high-vantage terrain exceeds triangle budget: ${summary.terrainTriangles} > ${summary.triangleBudget}`
    );
  }
  if (summary.terrainTriangleHeadroomExceeded) {
    throw new Error(
      `${profile} runtime high-vantage terrain exceeds triangle headroom: ratio=${summary.terrainTriangleBudgetRatio} > ${MAX_RUNTIME_TERRAIN_TRIANGLE_BUDGET_RATIO}`
    );
  }
}

if (runtimeHighVantage.balanced.terrainTriangles > 250_000) {
  throw new Error(`balanced runtime high-vantage terrain exceeds 250k triangles: ${runtimeHighVantage.balanced.terrainTriangles}`);
}
if (runtimeHighVantage.cinematic.terrainTriangles > 400_000) {
  throw new Error(`cinematic runtime high-vantage terrain exceeds 400k triangles: ${runtimeHighVantage.cinematic.terrainTriangles}`);
}
if (deploymentHighVantage.balanced.terrainTriangles > DEPLOYMENT_TERRAIN_TRIANGLE_BUDGETS.balanced) {
  throw new Error(`balanced deployment high-vantage terrain exceeds ${DEPLOYMENT_TERRAIN_TRIANGLE_BUDGETS.balanced} triangles: ${deploymentHighVantage.balanced.terrainTriangles}`);
}
if (deploymentHighVantage.cinematic.terrainTriangles > DEPLOYMENT_TERRAIN_TRIANGLE_BUDGETS.cinematic) {
  throw new Error(`cinematic deployment high-vantage terrain exceeds ${DEPLOYMENT_TERRAIN_TRIANGLE_BUDGETS.cinematic} triangles: ${deploymentHighVantage.cinematic.terrainTriangles}`);
}
