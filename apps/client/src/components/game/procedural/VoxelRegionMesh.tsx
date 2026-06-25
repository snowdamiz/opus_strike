import { memo, useEffect, useState } from 'react';
import type { BufferGeometry, Material } from 'three';
import type { VoxelMapManifest } from '@voxel-strike/shared';
import type { VoxelChunkRegion } from '../../../utils/mapWarmup/mapPrepCache';
import {
  buildVoxelRegionGeometry,
  buildVoxelRegionGeometryAsync,
  cancelVoxelRegionGeometryBuild,
  getCachedVoxelGeometry,
  getVoxelRegionGeometryCacheKey,
  isVoxelMeshRequestCancelledError,
  releaseVoxelGeometryCacheKey,
  retainVoxelGeometryCacheKey,
} from './meshBuilder';
import type { VoxelRegionGeometryDetail } from './meshGeometryData';

interface RegionGeometryState {
  geometry: BufferGeometry | null;
  detail: VoxelRegionGeometryDetail | null;
}

interface VoxelRegionMeshProps {
  region: VoxelChunkRegion;
  manifest: VoxelMapManifest;
  material: Material;
  shadowsEnabled: boolean;
  buildMode?: VoxelMeshBuildMode;
  detail?: VoxelRegionGeometryDetail;
  onGeometryReady?: (regionId: string, detail: VoxelRegionGeometryDetail) => void;
}

export type VoxelMeshBuildMode = 'async' | 'sync';

function getCachedFallbackGeometry(
  manifest: VoxelMapManifest,
  regionId: string,
  requestedDetail: VoxelRegionGeometryDetail
): RegionGeometryState | null {
  const fallbackDetails: VoxelRegionGeometryDetail[] = requestedDetail === 'full'
    ? ['coarse', 'ultraCoarse']
    : requestedDetail === 'coarse'
      ? ['ultraCoarse', 'full']
      : ['coarse', 'full'];

  for (const fallbackDetail of fallbackDetails) {
    const fallback = getCachedVoxelGeometry(getVoxelRegionGeometryCacheKey(manifest, regionId, fallbackDetail));
    if (fallback) return { geometry: fallback, detail: fallbackDetail };
  }

  return null;
}

export const VoxelRegionMesh = memo(function VoxelRegionMesh({
  region,
  manifest,
  material,
  shadowsEnabled,
  buildMode = 'async',
  detail = 'full',
  onGeometryReady,
}: VoxelRegionMeshProps) {
  const cacheKey = getVoxelRegionGeometryCacheKey(manifest, region.id, detail);
  const [geometryState, setGeometryState] = useState<RegionGeometryState>(() => {
    const cached = getCachedVoxelGeometry(cacheKey);
    if (cached) return { geometry: cached, detail };
    const fallback = getCachedFallbackGeometry(manifest, region.id, detail);
    if (fallback || buildMode === 'async') return fallback ?? { geometry: null, detail: null };
    return { geometry: buildVoxelRegionGeometry(manifest, region.id, region.chunks, detail), detail };
  });

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedVoxelGeometry(cacheKey);
    if (cached) {
      setGeometryState({ geometry: cached, detail });
      return;
    }

    if (buildMode === 'sync') {
      setGeometryState({ geometry: buildVoxelRegionGeometry(manifest, region.id, region.chunks, detail), detail });
      return;
    }

    const fallback = getCachedFallbackGeometry(manifest, region.id, detail);
    setGeometryState((previous) => previous.geometry ? previous : fallback ?? previous);
    buildVoxelRegionGeometryAsync(manifest, region.id, region.chunks, detail)
      .then((nextGeometry) => {
        if (!cancelled) setGeometryState({ geometry: nextGeometry, detail });
      })
      .catch((error) => {
        if (!cancelled && !isVoxelMeshRequestCancelledError(error)) {
          console.warn('[VoxelMap] Failed to build region mesh', region.id, detail, error);
        }
      });

    return () => {
      cancelled = true;
      cancelVoxelRegionGeometryBuild(cacheKey);
    };
  }, [buildMode, cacheKey, detail, manifest, region]);

  useEffect(() => {
    if (geometryState.geometry) onGeometryReady?.(region.id, geometryState.detail ?? detail);
  }, [detail, geometryState.detail, geometryState.geometry, onGeometryReady, region.id]);

  useEffect(() => {
    if (!geometryState.geometry || !geometryState.detail) return undefined;
    const retainedCacheKey = getVoxelRegionGeometryCacheKey(manifest, region.id, geometryState.detail);
    retainVoxelGeometryCacheKey(retainedCacheKey);
    return () => releaseVoxelGeometryCacheKey(retainedCacheKey);
  }, [geometryState.detail, geometryState.geometry, manifest, region.id]);

  if (!geometryState.geometry) return null;

  const isExactFullDetail = geometryState.detail === 'full' && detail === 'full';

  return (
    <mesh
      geometry={geometryState.geometry}
      material={material}
      matrixAutoUpdate={false}
      receiveShadow={isExactFullDetail && shadowsEnabled}
      castShadow={isExactFullDetail && shadowsEnabled && region.castShadow}
    />
  );
});
