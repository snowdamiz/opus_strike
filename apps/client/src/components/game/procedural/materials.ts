import { useMemo } from 'react';
import * as THREE from 'three';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import { createVoxelAtlasTextures } from './textureAtlas';

export function useVoxelMaterial(theme: VoxelMapTheme): THREE.MeshStandardMaterial {
  return useMemo(() => {
    const atlas = createVoxelAtlasTextures(theme);
    const material = new THREE.MeshStandardMaterial({
      map: atlas.color,
      bumpMap: atlas.bump,
      bumpScale: 0.08,
      roughness: 0.96,
      roughnessMap: atlas.roughness,
      metalness: 1,
      metalnessMap: atlas.metalness,
      emissive: '#ffffff',
      emissiveMap: atlas.emissive,
      emissiveIntensity: 1.08,
      aoMap: atlas.ao,
      aoMapIntensity: 0.82,
      color: '#ffffff',
    });

    material.envMapIntensity = 0.9;
    material.name = 'procedural-voxel-atlas-material';
    return material;
  }, [theme]);
}
