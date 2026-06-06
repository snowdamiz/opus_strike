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
    const material = new THREE.MeshStandardMaterial({
      map: atlas.color,
      bumpMap: useFineDetailMaps ? atlas.bump : undefined,
      bumpScale: useFineDetailMaps ? 0.08 : 0,
      roughness: detail === 'low' ? 0.92 : 0.96,
      roughnessMap: useSurfaceResponseMaps ? atlas.roughness : undefined,
      metalness: detail === 'low' ? 0.35 : 1,
      metalnessMap: useSurfaceResponseMaps ? atlas.metalness : undefined,
      emissive: '#ffffff',
      emissiveMap: atlas.emissive,
      emissiveIntensity: detail === 'low' ? 0.92 : 1.08,
      aoMap: useFineDetailMaps ? atlas.ao : undefined,
      aoMapIntensity: useFineDetailMaps ? 0.82 : 0,
      color: '#ffffff',
    });

    material.envMapIntensity = reflectionIntensity;
    material.name = 'procedural-voxel-atlas-material';
    return material;
  }, [detail, reflectionIntensity, theme]);

  useEffect(
    () => () => {
      [
        material.map,
        material.bumpMap,
        material.roughnessMap,
        material.metalnessMap,
        material.emissiveMap,
        material.aoMap,
      ].forEach((texture) => texture?.dispose());
      material.dispose();
    },
    [material]
  );

  return material;
}
