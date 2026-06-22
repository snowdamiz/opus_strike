import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import { retainVoxelTerrainTextures, type VoxelTerrainTextures } from './terrainTextures';
import type { GraphicsFeatureQuality } from '../../../store/settingsStore';

type ShaderParameters = Parameters<THREE.Material['onBeforeCompile']>[0];

const TERRAIN_TEXTURE_SHADER_KEY = 'voxel-terrain-array-diffuse-texture-v5';
const TERRAIN_TEXTURE_MIP_FOOTPRINT_SCALE = 2.05;

const TERRAIN_VERTEX_PARS = `
attribute float voxelTextureLayer;
varying vec2 vVoxelTileUv;
varying float vVoxelTextureLayer;
`;

const TERRAIN_VERTEX_ASSIGN = `
vVoxelTileUv = uv;
vVoxelTextureLayer = voxelTextureLayer;
`;

const TERRAIN_FRAGMENT_PARS = `
uniform sampler2DArray voxelTerrainColorTexture;
uniform sampler2DArray voxelTerrainEmissiveTexture;
varying vec2 vVoxelTileUv;
varying float vVoxelTextureLayer;

vec2 voxelTerrainLocalUv(vec2 tileUv) {
  vec2 mirroredUv = mod(tileUv, 2.0);
  return 1.0 - abs(mirroredUv - 1.0);
}

float voxelTerrainLayer() {
  return floor(vVoxelTextureLayer + 0.5);
}

vec4 voxelTerrainTextureSample(sampler2DArray textureMap, vec2 tileUv) {
  vec2 textureUv = voxelTerrainLocalUv(tileUv);
  vec2 stableDx = dFdx(tileUv) * ${TERRAIN_TEXTURE_MIP_FOOTPRINT_SCALE};
  vec2 stableDy = dFdy(tileUv) * ${TERRAIN_TEXTURE_MIP_FOOTPRINT_SCALE};

  return textureGrad(textureMap, vec3(textureUv, voxelTerrainLayer()), stableDx, stableDy);
}
`;

function replaceShaderChunk(source: string, chunk: string, replacement: string): string {
  return source.replace(`#include <${chunk}>`, replacement);
}

function patchTerrainTextureShader(
  shader: ShaderParameters,
  textures: VoxelTerrainTextures
): void {
  shader.uniforms.voxelTerrainColorTexture = { value: textures.color };
  shader.uniforms.voxelTerrainEmissiveTexture = { value: textures.emissive };

  shader.vertexShader = replaceShaderChunk(
    shader.vertexShader,
    'uv_pars_vertex',
    `#include <uv_pars_vertex>\n${TERRAIN_VERTEX_PARS}`
  );
  shader.vertexShader = replaceShaderChunk(
    shader.vertexShader,
    'uv_vertex',
    `#include <uv_vertex>\n${TERRAIN_VERTEX_ASSIGN}`
  );

  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'uv_pars_fragment',
    `#include <uv_pars_fragment>\n${TERRAIN_FRAGMENT_PARS}`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'map_pars_fragment',
    ''
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'emissivemap_pars_fragment',
    ''
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'map_fragment',
`
  vec4 sampledDiffuseColor = voxelTerrainTextureSample(voxelTerrainColorTexture, vVoxelTileUv);
  diffuseColor *= sampledDiffuseColor;
`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'emissivemap_fragment',
`
  vec4 emissiveColor = voxelTerrainTextureSample(voxelTerrainEmissiveTexture, vVoxelTileUv);
  totalEmissiveRadiance *= emissiveColor.rgb;
`
  );
}

export function useVoxelMaterial(
  theme: VoxelMapTheme,
  materialQuality: GraphicsFeatureQuality
): THREE.Material {
  const retainedMaterial = useMemo(() => {
    const { textures, release } = retainVoxelTerrainTextures(theme, materialQuality);
    const material = new THREE.MeshLambertMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveIntensity: 0.72,
    });

    material.name = 'procedural-voxel-diffuse-terrain-material';
    material.onBeforeCompile = (shader) => patchTerrainTextureShader(shader, textures);
    material.customProgramCacheKey = () => (
      `${TERRAIN_TEXTURE_SHADER_KEY}:${material.type}:${textures.tileSize}:${materialQuality}`
    );
    return { material, release };
  }, [materialQuality, theme]);

  useEffect(
    () => () => {
      retainedMaterial.material.dispose();
      retainedMaterial.release();
    },
    [retainedMaterial]
  );

  return retainedMaterial.material;
}

export function useVoxelFarMaterial(
  theme: VoxelMapTheme,
  fogBlend: number
): THREE.Material {
  const material = useMemo(() => {
    const color = new THREE.Color(theme.ground.side).lerp(
      new THREE.Color(theme.fogColor),
      THREE.MathUtils.clamp(fogBlend, 0, 1)
    );
    const farMaterial = new THREE.MeshBasicMaterial({
      color,
      fog: true,
    });
    farMaterial.name = 'procedural-voxel-far-unlit-terrain-material';
    return farMaterial;
  }, [fogBlend, theme]);

  useEffect(() => () => material.dispose(), [material]);

  return material;
}
