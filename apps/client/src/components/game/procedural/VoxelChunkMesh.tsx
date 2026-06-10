import { memo, useEffect, useMemo, useState } from 'react';
import type { MeshStandardMaterial } from 'three';
import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import {
  buildVoxelChunkGeometry,
  buildVoxelRegionGeometry,
  buildVoxelRegionGeometryAsync,
  getCachedVoxelGeometry,
  getVoxelRegionGeometryCacheKey,
} from './meshBuilder';

interface VoxelChunkMeshProps {
  chunk: VoxelChunk;
  manifest: VoxelMapManifest;
  material: MeshStandardMaterial;
  shadowsEnabled: boolean;
}

export interface VoxelChunkRegion {
  id: string;
  chunks: VoxelChunk[];
  castShadow: boolean;
}

interface VoxelRegionMeshProps {
  region: VoxelChunkRegion;
  manifest: VoxelMapManifest;
  material: MeshStandardMaterial;
  shadowsEnabled: boolean;
  buildMode?: VoxelMeshBuildMode;
  onGeometryReady?: (regionId: string) => void;
}

export type VoxelMeshBuildMode = 'async' | 'sync';

export const VoxelChunkMesh = memo(function VoxelChunkMesh({
  chunk,
  manifest,
  material,
  shadowsEnabled,
}: VoxelChunkMeshProps) {
  const geometry = useMemo(() => buildVoxelChunkGeometry(manifest, chunk), [chunk, manifest]);

  return (
    <mesh
      geometry={geometry}
      material={material}
      matrixAutoUpdate={false}
      receiveShadow={shadowsEnabled}
      castShadow={shadowsEnabled && chunk.coord.y > 0}
    />
  );
});

export const VoxelRegionMesh = memo(function VoxelRegionMesh({
  region,
  manifest,
  material,
  shadowsEnabled,
  buildMode = 'async',
  onGeometryReady,
}: VoxelRegionMeshProps) {
  const cacheKey = getVoxelRegionGeometryCacheKey(manifest, region.id);
  const [geometry, setGeometry] = useState(() => {
    const cached = getCachedVoxelGeometry(cacheKey);
    if (cached || buildMode === 'async') return cached;
    return buildVoxelRegionGeometry(manifest, region.id, region.chunks);
  });

  useEffect(() => {
    let cancelled = false;
    const cached = getCachedVoxelGeometry(cacheKey);
    if (cached) {
      setGeometry(cached);
      return;
    }

    if (buildMode === 'sync') {
      setGeometry(buildVoxelRegionGeometry(manifest, region.id, region.chunks));
      return;
    }

    setGeometry(null);
    buildVoxelRegionGeometryAsync(manifest, region.id, region.chunks)
      .then((nextGeometry) => {
        if (!cancelled) setGeometry(nextGeometry);
      })
      .catch((error) => {
        console.warn('[VoxelMap] Failed to build region mesh', region.id, error);
      });

    return () => {
      cancelled = true;
    };
  }, [buildMode, cacheKey, manifest, region]);

  useEffect(() => {
    if (geometry) onGeometryReady?.(region.id);
  }, [geometry, onGeometryReady, region.id]);

  if (!geometry) return null;

  return (
    <mesh
      geometry={geometry}
      material={material}
      matrixAutoUpdate={false}
      receiveShadow={shadowsEnabled}
      castShadow={shadowsEnabled && region.castShadow}
    />
  );
});
