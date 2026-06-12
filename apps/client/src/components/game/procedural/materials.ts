import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import { createVoxelTerrainTextures } from './terrainTextures';
import type { VoxelMaterialDetail } from '../visualQuality';

interface VoxelMaterialOptions {
  detail: VoxelMaterialDetail;
}

type ShaderParameters = Parameters<THREE.Material['onBeforeCompile']>[0];

const VOXEL_TERRAIN_SHADER_KEY = 'voxel-texture-array-v2';

const VOXEL_TERRAIN_VERTEX_PARS = `
attribute float voxelTileLayer;
varying vec2 vVoxelTileUv;
varying float vVoxelTileLayer;
`;

const VOXEL_TERRAIN_VERTEX_ASSIGN = `
vVoxelTileUv = uv;
vVoxelTileLayer = voxelTileLayer;
`;

const VOXEL_TERRAIN_FRAGMENT_PARS = `
varying vec2 vVoxelTileUv;
varying float vVoxelTileLayer;

vec4 voxelTerrainTexture(sampler2DArray terrainMap, vec2 tileUv) {
  vec2 safeDx = dFdx(tileUv) * 2.25;
  vec2 safeDy = dFdy(tileUv) * 2.25;
  return textureGrad(terrainMap, vec3(tileUv, vVoxelTileLayer), vec3(safeDx, 0.0), vec3(safeDy, 0.0));
}
`;

const VOXEL_TERRAIN_MAP_PARS = `
#ifdef USE_MAP
  uniform sampler2DArray map;
#endif
`;

const VOXEL_TERRAIN_EMISSIVE_MAP_PARS = `
#ifdef USE_EMISSIVEMAP
  uniform sampler2DArray emissiveMap;
#endif
`;

function replaceShaderChunk(source: string, chunk: string, replacement: string): string {
  return source.replace(`#include <${chunk}>`, replacement);
}

function patchVoxelTerrainShader(shader: ShaderParameters): void {
  shader.vertexShader = replaceShaderChunk(
    shader.vertexShader,
    'uv_pars_vertex',
    `#include <uv_pars_vertex>\n${VOXEL_TERRAIN_VERTEX_PARS}`
  );
  shader.vertexShader = replaceShaderChunk(
    shader.vertexShader,
    'uv_vertex',
    `#include <uv_vertex>\n${VOXEL_TERRAIN_VERTEX_ASSIGN}`
  );

  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'uv_pars_fragment',
    `#include <uv_pars_fragment>\n${VOXEL_TERRAIN_FRAGMENT_PARS}`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'map_pars_fragment',
    VOXEL_TERRAIN_MAP_PARS
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'map_fragment',
    `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = voxelTerrainTexture(map, vVoxelTileUv);
  diffuseColor *= sampledDiffuseColor;
#endif
`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'emissivemap_pars_fragment',
    VOXEL_TERRAIN_EMISSIVE_MAP_PARS
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'emissivemap_fragment',
    `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = voxelTerrainTexture(emissiveMap, vVoxelTileUv);
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif
`
  );
}

export function useVoxelMaterial(
  theme: VoxelMapTheme,
  { detail }: VoxelMaterialOptions
): THREE.Material {
  const material = useMemo(() => {
    const textures = createVoxelTerrainTextures(theme, { detail });
    const material = new THREE.MeshLambertMaterial({
      map: textures.color,
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveMap: textures.emissive,
      emissiveIntensity: detail === 'low' ? 0.72 : detail === 'medium' ? 0.92 : 1,
    });

    material.name = 'procedural-voxel-terrain-array-lambert-material';
    material.onBeforeCompile = patchVoxelTerrainShader;
    material.customProgramCacheKey = () => `${VOXEL_TERRAIN_SHADER_KEY}:${material.type}:${detail}:${textures.tileSize}:${textures.layerCount}`;
    return material;
  }, [detail, theme]);

  useEffect(
    () => () => {
      material.dispose();
    },
    [material]
  );

  return material;
}
