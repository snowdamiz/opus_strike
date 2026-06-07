import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import { createVoxelAtlasTextures } from './textureAtlas';
import type { VoxelMaterialDetail } from '../visualQuality';

interface VoxelMaterialOptions {
  reflectionIntensity: number;
  detail: VoxelMaterialDetail;
}

export function useVoxelMaterial(
  theme: VoxelMapTheme,
  { reflectionIntensity, detail }: VoxelMaterialOptions
): THREE.MeshStandardMaterial {
  const material = useMemo(() => {
    const atlas = createVoxelAtlasTextures(theme);
    const useSurfaceResponseMaps = detail !== 'low';
    const useFineDetailMaps = detail === 'high';

    const parameters: THREE.MeshStandardMaterialParameters = {
      map: atlas.color,
      bumpScale: useFineDetailMaps ? 0.08 : 0,
      roughness: detail === 'low' ? 0.92 : 0.96,
      metalness: detail === 'low' ? 0.35 : 1,
      emissive: '#ffffff',
      emissiveMap: atlas.emissive,
      emissiveIntensity: detail === 'low' ? 0.92 : 1.08,
      aoMapIntensity: useFineDetailMaps ? 0.82 : 0,
      color: '#ffffff',
    };

    if (useSurfaceResponseMaps) {
      parameters.roughnessMap = atlas.roughness;
      parameters.metalnessMap = atlas.metalness;
    }

    if (useFineDetailMaps) {
      parameters.bumpMap = atlas.bump;
      parameters.aoMap = atlas.ao;
    }

    const material = new THREE.MeshStandardMaterial(parameters);

    material.envMapIntensity = reflectionIntensity;
    material.name = 'procedural-voxel-atlas-material';
    return material;
  }, [detail, reflectionIntensity, theme]);

  useEffect(
    () => () => {
      material.dispose();
    },
    [material]
  );

  return material;
}
