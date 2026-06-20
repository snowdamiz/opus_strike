import type { PreparedVoxelMap, VoxelChunkRegion } from './mapPrepCache';

interface MapGeometryWarmupOptions {
  frameBudgetMs?: number;
  label?: string;
}

const BATTLE_ROYAL_BACKGROUND_FULL_DETAIL_DISTANCE = 138;

function getRegionFocusPoint(preparedMap: PreparedVoxelMap): { x: number; y: number; z: number } {
  const { manifest } = preparedMap;
  return {
    x: manifest.origin.x + (manifest.size.x * manifest.voxelSize.x) / 2,
    y: manifest.origin.y + (manifest.size.y * manifest.voxelSize.y) * 0.25,
    z: manifest.origin.z + (manifest.size.z * manifest.voxelSize.z) / 2,
  };
}

function getCentralBattleRoyalRegions(preparedMap: PreparedVoxelMap): VoxelChunkRegion[] {
  const focus = getRegionFocusPoint(preparedMap);
  return preparedMap.renderableRegions.filter((region) => {
    const dx = region.bounds.center.x - focus.x;
    const dy = region.bounds.center.y - focus.y;
    const dz = region.bounds.center.z - focus.z;
    const maxDistance = BATTLE_ROYAL_BACKGROUND_FULL_DETAIL_DISTANCE + region.bounds.radius;
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
          getCentralBattleRoyalRegions(preparedMap),
          { detail: 'full', frameBudgetMs }
        );
        await prebuildVoxelRegionGeometries(
          preparedMap.manifest,
          preparedMap.renderableRegions,
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
