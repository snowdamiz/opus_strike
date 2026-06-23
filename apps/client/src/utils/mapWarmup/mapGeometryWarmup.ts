import type { PreparedVoxelMap, VoxelChunkRegion } from './mapPrepCache';
import { useSettingsStore, type GraphicsPreset } from '../../store/settingsStore';
import { BATTLE_ROYAL_VISIBILITY_CONFIG } from '../../components/game/visualQuality';

interface MapGeometryWarmupOptions {
  frameBudgetMs?: number;
  label?: string;
  graphicsPreset?: GraphicsPreset;
  battleRoyalFullDetailDistance?: number;
}

const BATTLE_ROYAL_STARTUP_FULL_DETAIL_DISTANCE_CAP = 92;
const BATTLE_ROYAL_STARTUP_COARSE_DISTANCE_CAP = 150;
const BATTLE_ROYAL_STARTUP_MIN_REGION_COUNT = 18;
const BATTLE_ROYAL_STARTUP_MAX_REGION_COUNT = 96;

function getRegionFocusPoint(preparedMap: PreparedVoxelMap): { x: number; y: number; z: number } {
  const { manifest } = preparedMap;
  return {
    x: manifest.origin.x + (manifest.size.x * manifest.voxelSize.x) / 2,
    y: manifest.origin.y + (manifest.size.y * manifest.voxelSize.y) * 0.25,
    z: manifest.origin.z + (manifest.size.z * manifest.voxelSize.z) / 2,
  };
}

export function getBattleRoyalWarmupFullDetailDistance(options: MapGeometryWarmupOptions = {}): number {
  if (
    typeof options.battleRoyalFullDetailDistance === 'number' &&
    Number.isFinite(options.battleRoyalFullDetailDistance)
  ) {
    return Math.max(0, options.battleRoyalFullDetailDistance);
  }

  const graphicsPreset = options.graphicsPreset ?? useSettingsStore.getState().settings.graphicsPreset;
  return BATTLE_ROYAL_VISIBILITY_CONFIG[graphicsPreset]?.terrainPrebuildFullDistance ??
    BATTLE_ROYAL_VISIBILITY_CONFIG.balanced.terrainPrebuildFullDistance;
}

function getBattleRoyalRegionsNearFocus(
  preparedMap: PreparedVoxelMap,
  maxDistance: number,
  options: {
    minRegions?: number;
    maxRegions?: number;
  } = {}
): VoxelChunkRegion[] {
  const focus = getRegionFocusPoint(preparedMap);
  const maxRegions = Math.max(1, options.maxRegions ?? preparedMap.renderableRegions.length);
  const minRegions = Math.min(
    maxRegions,
    Math.max(0, options.minRegions ?? 0),
    preparedMap.renderableRegions.length
  );
  const regionsByDistance = preparedMap.renderableRegions
    .map((region) => {
      const dx = region.bounds.center.x - focus.x;
      const dy = region.bounds.center.y - focus.y;
      const dz = region.bounds.center.z - focus.z;
      return {
        region,
        distanceSq: dx * dx + dy * dy + dz * dz,
        radiusAdjustedDistanceSq: (maxDistance + region.bounds.radius) * (maxDistance + region.bounds.radius),
      };
    })
    .sort((a, b) => a.distanceSq - b.distanceSq);

  const selected = regionsByDistance
    .filter((entry) => entry.distanceSq <= entry.radiusAdjustedDistanceSq)
    .slice(0, maxRegions);

  if (selected.length >= minRegions) {
    return selected.map((entry) => entry.region);
  }

  return regionsByDistance
    .slice(0, Math.max(minRegions, selected.length))
    .map((entry) => entry.region);
}

export function getCentralBattleRoyalRegions(
  preparedMap: PreparedVoxelMap,
  options: MapGeometryWarmupOptions = {}
): VoxelChunkRegion[] {
  const focus = getRegionFocusPoint(preparedMap);
  const fullDetailDistance = getBattleRoyalWarmupFullDetailDistance(options);
  return preparedMap.renderableRegions.filter((region) => {
    const dx = region.bounds.center.x - focus.x;
    const dy = region.bounds.center.y - focus.y;
    const dz = region.bounds.center.z - focus.z;
    const maxDistance = fullDetailDistance + region.bounds.radius;
    return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
  });
}

export function getBattleRoyalStartupRegions(
  preparedMap: PreparedVoxelMap,
  options: MapGeometryWarmupOptions = {}
): VoxelChunkRegion[] {
  const fullDetailDistance = getBattleRoyalWarmupFullDetailDistance(options);
  return getBattleRoyalRegionsNearFocus(
    preparedMap,
    Math.min(
      BATTLE_ROYAL_STARTUP_COARSE_DISTANCE_CAP,
      Math.max(BATTLE_ROYAL_STARTUP_FULL_DETAIL_DISTANCE_CAP, fullDetailDistance * 1.45)
    ),
    {
      minRegions: BATTLE_ROYAL_STARTUP_MIN_REGION_COUNT,
      maxRegions: BATTLE_ROYAL_STARTUP_MAX_REGION_COUNT,
    }
  );
}

export function getBattleRoyalStartupFullDetailRegions(
  preparedMap: PreparedVoxelMap,
  options: MapGeometryWarmupOptions = {}
): VoxelChunkRegion[] {
  const fullDetailDistance = getBattleRoyalWarmupFullDetailDistance(options);
  return getBattleRoyalRegionsNearFocus(
    preparedMap,
    Math.min(BATTLE_ROYAL_STARTUP_FULL_DETAIL_DISTANCE_CAP, fullDetailDistance),
    {
      minRegions: Math.min(BATTLE_ROYAL_STARTUP_MIN_REGION_COUNT, 24),
      maxRegions: BATTLE_ROYAL_STARTUP_MAX_REGION_COUNT,
    }
  );
}

export function prebuildPreparedVoxelMapGeometry(
  preparedMap: PreparedVoxelMap,
  options: MapGeometryWarmupOptions = {}
): void {
  if (typeof window === 'undefined') return;

  const frameBudgetMs = options.frameBudgetMs ?? 2;
  void import('../../components/game/procedural/meshBuilder')
    .then(async ({ prebuildVoxelRegionGeometries }) => {
      if (preparedMap.manifest.profileId === 'battle_royal_large') {
        const startupRegions = getBattleRoyalStartupRegions(preparedMap, options);
        const startupFullDetailRegions = getBattleRoyalStartupFullDetailRegions(preparedMap, options);

        await prebuildVoxelRegionGeometries(
          preparedMap.manifest,
          startupRegions,
          { detail: 'ultraCoarse', frameBudgetMs }
        );
        await prebuildVoxelRegionGeometries(
          preparedMap.manifest,
          startupFullDetailRegions,
          { detail: 'full', frameBudgetMs }
        );
        await prebuildVoxelRegionGeometries(
          preparedMap.manifest,
          startupRegions,
          { detail: 'coarse', frameBudgetMs }
        );
        return;
      }

      await prebuildVoxelRegionGeometries(
        preparedMap.manifest,
        preparedMap.renderableRegions,
        { detail: 'full', frameBudgetMs }
      );
    })
    .catch((error) => {
      console.warn('[MapWarmup] Voxel geometry prebuild failed', options.label ?? preparedMap.key, error);
    });
}
