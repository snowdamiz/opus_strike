import type { PreparedVoxelMap } from './mapPrepCache';

interface MapGeometryWarmupOptions {
  frameBudgetMs?: number;
  label?: string;
}

export function prebuildPreparedVoxelMapGeometry(
  preparedMap: PreparedVoxelMap,
  options: MapGeometryWarmupOptions = {}
): void {
  if (typeof window === 'undefined') return;

  const frameBudgetMs = options.frameBudgetMs ?? 2;
  void import('../../components/game/procedural/meshBuilder')
    .then(({ prebuildVoxelRegionGeometries }) => (
      prebuildVoxelRegionGeometries(preparedMap.manifest, preparedMap.renderableRegions, { frameBudgetMs })
    ))
    .catch((error) => {
      console.warn('[MapWarmup] Voxel geometry prebuild failed', options.label ?? preparedMap.key, error);
    });
}
