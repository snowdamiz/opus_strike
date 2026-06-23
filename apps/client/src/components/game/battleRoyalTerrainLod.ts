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
const SMALL_PROJECTED_REGION_PIXELS = 12;
const TINY_PROJECTED_REGION_PIXELS = 6;

function clampDistance(value: number, min: number, max = Number.POSITIVE_INFINITY): number {
  if (!Number.isFinite(value)) return max;
  return Math.max(min, Math.min(max, value));
}

export function getBattleRoyalTerrainLodDistances(input: {
  manifest: VoxelMapManifest;
  visibility: BattleRoyalVisibilityConfig;
  cameraPosition: { x: number; y: number; z: number };
}): BattleRoyalTerrainLodDistances {
  const full = clampDistance(
    input.visibility.terrainLodFullDistance,
    MIN_FULL_LOD_DISTANCE,
    input.visibility.terrainLodCoarseDistance - 4
  );
  const coarse = clampDistance(
    input.visibility.terrainLodCoarseDistance,
    Math.max(MIN_COARSE_LOD_DISTANCE, full + 10),
    input.visibility.terrainLodUltraCoarseDistance - 4
  );
  const ultraCoarse = clampDistance(
    input.visibility.terrainLodUltraCoarseDistance,
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
