import { performance } from 'node:perf_hooks';
import { prepareVoxelMapCpu, type VoxelChunkRegion } from '../utils/mapWarmup/mapPrepCache';
import { buildVoxelRegionGeometryData, type VoxelRegionGeometryDetail } from '../components/game/procedural/meshGeometryData';
import { BATTLE_ROYAL_VISIBILITY_CONFIG } from '../components/game/visualQuality';

const DEFAULT_BENCHMARK_SEED = 20260611;
const seed = Number.parseInt(process.env.BR_MAP_BENCH_SEED ?? `${DEFAULT_BENCHMARK_SEED}`, 10) >>> 0;

interface GeometrySummary {
  buildMs: number;
  bytes: number;
  vertices: number;
  triangles: number;
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
): GeometrySummary {
  const startedAt = performance.now();
  let bytes = 0;
  let vertices = 0;
  let triangles = 0;

  for (const region of regions) {
    const data = buildVoxelRegionGeometryData(manifest, region.chunks, detail);
    bytes += geometryBytes(data);
    vertices += data.positions.length / 3;
    triangles += data.indices.length / 3;
  }

  return {
    buildMs: performance.now() - startedAt,
    bytes,
    vertices,
    triangles,
  };
}

function countVisibleRegions(
  regions: VoxelChunkRegion[],
  maxDistance: number,
  focus: { x: number; y: number; z: number }
): number {
  let visible = 0;
  for (const region of regions) {
    const dx = region.bounds.center.x - focus.x;
    const dy = region.bounds.center.y - focus.y;
    const dz = region.bounds.center.z - focus.z;
    const radiusAdjustedDistance = maxDistance + region.bounds.radius;
    if (dx * dx + dy * dy + dz * dz <= radiusAdjustedDistance * radiusAdjustedDistance) {
      visible++;
    }
  }
  return visible;
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

const full = summarizeGeometry(renderableRegions, 'full', manifest);
const coarse = summarizeGeometry(renderableRegions, 'coarse', manifest);
const byteRatio = coarse.bytes / Math.max(1, full.bytes);
const triangleRatio = coarse.triangles / Math.max(1, full.triangles);

const visibility = Object.fromEntries(
  Object.entries(BATTLE_ROYAL_VISIBILITY_CONFIG).map(([profile, config]) => [
    profile,
    {
      cameraFar: config.cameraFar,
      terrainCullDistance: config.terrainCullDistance,
      terrainLodFullDistance: config.terrainLodFullDistance,
      visibleRegions: countVisibleRegions(renderableRegions, config.terrainCullDistance, focus),
      fullDetailRegions: countVisibleRegions(renderableRegions, config.terrainLodFullDistance, focus),
    },
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
