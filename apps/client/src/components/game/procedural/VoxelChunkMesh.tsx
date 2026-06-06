import { memo, useMemo } from 'react';
import type { MeshStandardMaterial } from 'three';
import type { VoxelChunk, VoxelMapManifest } from '@voxel-strike/shared';
import { buildVoxelChunkGeometry } from './meshBuilder';

interface VoxelChunkMeshProps {
  chunk: VoxelChunk;
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
