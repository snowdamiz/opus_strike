import type { PreparedVoxelMap } from './mapPrepCache';
import { loggers } from '../logger';

interface MapGeometryWarmupOptions {
  frameBudgetMs?: number;
  label?: string;
}

export function prebuildPreparedMapGeometryDeferred(
  preparedMap: PreparedVoxelMap,
  options: MapGeometryWarmupOptions
): void {
  void import('./mapGeometryWarmup')
    .then(({ prebuildPreparedVoxelMapGeometry }) => {
      prebuildPreparedVoxelMapGeometry(preparedMap, options);
    })
    .catch((error) => {
      loggers.network.warn('map geometry warmup import failed', error);
    });
}
