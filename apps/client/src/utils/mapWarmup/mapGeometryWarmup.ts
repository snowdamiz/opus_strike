import type { PreparedVoxelMap, VoxelChunkRegion } from './mapPrepCache';
import { useSettingsStore, type GraphicsPreset } from '../../store/settingsStore';
import { BATTLE_ROYAL_VISIBILITY_CONFIG } from '../../components/game/visualQuality';

interface MapGeometryWarmupOptions {
  frameBudgetMs?: number;
  label?: string;
  graphicsPreset?: GraphicsPreset;
  battleRoyalFullDetailDistance?: number;
}

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

export function prebuildPreparedVoxelMapGeometry(
  preparedMap: PreparedVoxelMap,
  options: MapGeometryWarmupOptions = {}
): void {
  if (typeof window === 'undefined') return;

  const frameBudgetMs = options.frameBudgetMs ?? 2;
  void import('../../components/game/procedural/meshBuilder')
    .then(async ({ prebuildVoxelRegionGeometries }) => {
      if (preparedMap.manifest.profileId === 'battle_royal_large') {
        await prebuildVoxelRegionGeometries(
          preparedMap.manifest,
          getCentralBattleRoyalRegions(preparedMap, options),
          { detail: 'full', frameBudgetMs }
        );
        await prebuildVoxelRegionGeometries(
          preparedMap.manifest,
          preparedMap.renderableRegions,
          { detail: 'coarse', frameBudgetMs }
        );
        await prebuildVoxelRegionGeometries(
          preparedMap.manifest,
          preparedMap.renderableRegions,
          { detail: 'ultraCoarse', frameBudgetMs }
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
