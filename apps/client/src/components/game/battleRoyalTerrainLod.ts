import type { VoxelMapManifest } from '@voxel-strike/shared';
import type { VoxelChunkRegionBounds } from '../../utils/mapWarmup/mapPrepCache';
import type { BattleRoyalVisibilityConfig } from './visualQuality';
import type { VoxelRegionGeometryDetail } from './procedural/meshGeometryData';

export interface BattleRoyalTerrainLodDistances {
  full: number;
  coarse: number;
  ultraCoarse: number;
  cull: number;
}

interface BattleRoyalTerrainDetailInput {
  manifest: VoxelMapManifest;
  visibility: BattleRoyalVisibilityConfig;
  cameraPosition: { x: number; y: number; z: number };
  regionBounds: VoxelChunkRegionBounds;
  distanceSq: number;
  previousDetail?: VoxelRegionGeometryDetail;
  viewportHeight?: number;
  cameraFovDegrees?: number;
}

const MIN_FULL_LOD_DISTANCE = 22;
const MIN_COARSE_LOD_DISTANCE = 38;
const MIN_ULTRA_COARSE_LOD_DISTANCE = 56;
const MIN_CULL_DISTANCE = 72;
const DETAIL_HYSTERESIS = 8;
const HIGH_ALTITUDE_LOW_ROWS = 20;
const HIGH_ALTITUDE_HIGH_ROWS = 40;
const SMALL_PROJECTED_REGION_PIXELS = 12;
const TINY_PROJECTED_REGION_PIXELS = 6;

function clampDistance(value: number, min: number, max = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, value));
}

export function getBattleRoyalGroundY(
  manifest: VoxelMapManifest,
  worldX: number,
  worldZ: number
): number | null {
  const { heightfield } = manifest;
  if (!heightfield?.topSolidRows.length) return null;

  const x = Math.floor((worldX - heightfield.origin.x) / heightfield.voxelSize.x);
  const z = Math.floor((worldZ - heightfield.origin.z) / heightfield.voxelSize.z);
  if (x < 0 || z < 0 || x >= heightfield.size.x || z >= heightfield.size.z) return null;

  const topRow = heightfield.topSolidRows[x + z * heightfield.size.x] ?? 0;
  if (topRow <= 0) return null;
  return heightfield.origin.y + topRow * heightfield.voxelSize.y;
}

export function getBattleRoyalCameraAltitudeRows(
  manifest: VoxelMapManifest,
  cameraPosition: { x: number; y: number; z: number }
): number {
  const groundY = getBattleRoyalGroundY(manifest, cameraPosition.x, cameraPosition.z);
  if (groundY === null) {
    return Math.max(0, (cameraPosition.y - manifest.origin.y) / manifest.voxelSize.y);
  }
  return Math.max(0, (cameraPosition.y - groundY) / manifest.voxelSize.y);
}

export function getBattleRoyalTerrainLodDistances(input: {
  manifest: VoxelMapManifest;
  visibility: BattleRoyalVisibilityConfig;
  cameraPosition: { x: number; y: number; z: number };
}): BattleRoyalTerrainLodDistances {
  const altitudeRows = getBattleRoyalCameraAltitudeRows(input.manifest, input.cameraPosition);
  let fullScale = 1;
  let coarseScale = 1;
  let ultraScale = 1;

  if (altitudeRows >= HIGH_ALTITUDE_HIGH_ROWS) {
    fullScale = 0.5;
    coarseScale = 0.84;
    ultraScale = 0.96;
  } else if (altitudeRows >= HIGH_ALTITUDE_LOW_ROWS) {
    fullScale = 0.68;
    coarseScale = 0.92;
    ultraScale = 1;
  }

  const full = clampDistance(
    input.visibility.terrainLodFullDistance * fullScale,
    MIN_FULL_LOD_DISTANCE,
    input.visibility.terrainLodCoarseDistance - 4
  );
  const coarse = clampDistance(
    input.visibility.terrainLodCoarseDistance * coarseScale,
    Math.max(MIN_COARSE_LOD_DISTANCE, full + 10),
    input.visibility.terrainLodUltraCoarseDistance - 4
  );
  const ultraCoarse = clampDistance(
    input.visibility.terrainLodUltraCoarseDistance * ultraScale,
    Math.max(MIN_ULTRA_COARSE_LOD_DISTANCE, coarse + 12),
    input.visibility.terrainCullDistance - 2
  );
  const cull = clampDistance(
    input.visibility.terrainCullDistance,
    Math.max(MIN_CULL_DISTANCE, ultraCoarse + 2)
  );

  return { full, coarse, ultraCoarse, cull };
}

export function estimateProjectedRegionPixels(input: {
  regionRadius: number;
  distance: number;
  viewportHeight?: number;
  cameraFovDegrees?: number;
}): number {
  const viewportHeight = input.viewportHeight ?? 720;
  const fovRadians = ((input.cameraFovDegrees ?? 75) * Math.PI) / 180;
  const distance = Math.max(0.001, input.distance);
  const projectedRadius = (input.regionRadius / distance) * (viewportHeight / (2 * Math.tan(fovRadians / 2)));
  return projectedRadius * 2;
}

export function selectBattleRoyalTerrainDetail(input: BattleRoyalTerrainDetailInput): VoxelRegionGeometryDetail {
  const distance = Math.sqrt(Math.max(0, input.distanceSq));
  const distances = getBattleRoyalTerrainLodDistances(input);
  const radius = input.regionBounds.radius;
  const previousDetail = input.previousDetail ?? 'ultraCoarse';
  const fullLimit = distances.full + radius + (previousDetail === 'full' ? DETAIL_HYSTERESIS : 0);
  if (distance <= fullLimit) return 'full';

  const projectedPixels = estimateProjectedRegionPixels({
    regionRadius: radius,
    distance,
    viewportHeight: input.viewportHeight,
    cameraFovDegrees: input.cameraFovDegrees,
  });
  if (
    projectedPixels <= TINY_PROJECTED_REGION_PIXELS ||
    (projectedPixels <= SMALL_PROJECTED_REGION_PIXELS && distance > distances.coarse * 0.82)
  ) {
    return 'ultraCoarse';
  }

  const coarseLimit = distances.coarse + radius + (previousDetail === 'coarse' ? DETAIL_HYSTERESIS : 0);
  if (distance <= coarseLimit) return 'coarse';

  return 'ultraCoarse';
}

export function isBattleRoyalRegionInsideCullDistance(input: {
  manifest: VoxelMapManifest;
  visibility: BattleRoyalVisibilityConfig;
  cameraPosition: { x: number; y: number; z: number };
  regionBounds: VoxelChunkRegionBounds;
  distanceSq: number;
  wasVisible?: boolean;
}): boolean {
  const distances = getBattleRoyalTerrainLodDistances(input);
  const maxDistance = distances.cull +
    input.regionBounds.radius +
    (input.wasVisible ? DETAIL_HYSTERESIS : 0);
  return input.distanceSq <= maxDistance * maxDistance;
}
