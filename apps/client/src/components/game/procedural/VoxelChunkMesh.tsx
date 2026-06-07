import { memo, useMemo } from 'react';
import type { MeshStandardMaterial } from 'three';
import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import { buildVoxelChunkGeometry, buildVoxelRegionGeometry } from './meshBuilder';

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
}

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
}: VoxelRegionMeshProps) {
  const geometry = useMemo(
    () => buildVoxelRegionGeometry(manifest, region.id, region.chunks),
    [manifest, region]
  );

  return (
    <mesh
      geometry={geometry}
      material={material}
      receiveShadow={shadowsEnabled}
      castShadow={shadowsEnabled && region.castShadow}
    />
  );
});
