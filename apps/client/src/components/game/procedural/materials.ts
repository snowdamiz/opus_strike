import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import { createVoxelTerrainTextures } from './terrainTextures';
import type { VoxelMaterialDetail } from '../visualQuality';

interface VoxelMaterialOptions {
  detail: VoxelMaterialDetail;
}

type ShaderParameters = Parameters<THREE.Material['onBeforeCompile']>[0];

const TERRAIN_TEXTURE_SHADER_KEY = 'voxel-terrain-array-diffuse-texture-v3';

const TERRAIN_VERTEX_PARS = `
attribute float voxelTextureLayer;
varying vec2 vVoxelTileUv;
varying float vVoxelTextureLayer;
varying vec3 vVoxelWorldPosition;
`;

const TERRAIN_VERTEX_ASSIGN = `
vVoxelTileUv = uv;
vVoxelTextureLayer = voxelTextureLayer;
vVoxelWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
`;

const TERRAIN_FRAGMENT_PARS = `
uniform sampler2DArray voxelTerrainColorTexture;
uniform sampler2DArray voxelTerrainEmissiveTexture;
uniform float voxelMacroTintStrength;
varying vec2 vVoxelTileUv;
varying float vVoxelTextureLayer;
varying vec3 vVoxelWorldPosition;

vec2 voxelTerrainLocalUv(vec2 tileUv) {
  vec2 mirroredUv = mod(tileUv, 2.0);
  return 1.0 - abs(mirroredUv - 1.0);
}

float voxelTerrainLayer() {
  return floor(vVoxelTextureLayer + 0.5);
}

vec4 voxelTerrainTextureSample(sampler2DArray textureMap, vec2 tileUv) {
  vec2 textureUv = voxelTerrainLocalUv(tileUv);
  vec2 stableDx = dFdx(tileUv) * 1.45;
  vec2 stableDy = dFdy(tileUv) * 1.45;

  return textureGrad(textureMap, vec3(textureUv, voxelTerrainLayer()), stableDx, stableDy);
}

float voxelTerrainHash(vec2 cell, float layer) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031 + vec3(layer * 0.017, layer * 0.071, layer * 0.113));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float voxelTerrainSmoothNoise(vec2 point, float layer) {
  vec2 cell = floor(point);
  vec2 local = fract(point);
  vec2 curve = local * local * (3.0 - 2.0 * local);
  float a = voxelTerrainHash(cell, layer);
  float b = voxelTerrainHash(cell + vec2(1.0, 0.0), layer);
  float c = voxelTerrainHash(cell + vec2(0.0, 1.0), layer);
  float d = voxelTerrainHash(cell + vec2(1.0, 1.0), layer);
  return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

vec3 voxelTerrainMacroTint(vec3 worldPosition) {
  if (voxelMacroTintStrength <= 0.0) {
    return vec3(1.0);
  }

  float layer = voxelTerrainLayer();
  vec2 layerOffset = vec2(layer * 17.13, layer * 9.71);
  vec2 lowFrequencyPoint = worldPosition.xz * 0.048 + layerOffset;
  float broad = voxelTerrainSmoothNoise(lowFrequencyPoint, layer);
  float broader = voxelTerrainSmoothNoise(lowFrequencyPoint * 0.43 + 19.0, layer + 11.0);
  float noiseValue = broad * 0.68 + broader * 0.32;
  vec3 coolTint = vec3(0.965, 0.99, 1.035);
  vec3 warmTint = vec3(1.04, 1.015, 0.965);
  vec3 hueTint = mix(coolTint, warmTint, smoothstep(0.18, 0.82, noiseValue));
  float valueTint = 1.0 + (noiseValue - 0.5) * 0.075;

  return mix(vec3(1.0), hueTint * valueTint, voxelMacroTintStrength);
}
`;

function replaceShaderChunk(source: string, chunk: string, replacement: string): string {
  return source.replace(`#include <${chunk}>`, replacement);
}

function getMacroTintStrength(detail: VoxelMaterialDetail): number {
  if (detail === 'low') return 0;
  if (detail === 'medium') return 0.18;
  return 0.34;
}

function getEmissiveIntensity(detail: VoxelMaterialDetail): number {
  if (detail === 'low') return 0.72;
  if (detail === 'medium') return 0.92;
  return 1.08;
}

function patchTerrainTextureShader(
  shader: ShaderParameters,
  detail: VoxelMaterialDetail,
  textures: ReturnType<typeof createVoxelTerrainTextures>
): void {
  shader.uniforms.voxelTerrainColorTexture = { value: textures.color };
  shader.uniforms.voxelTerrainEmissiveTexture = { value: textures.emissive };
  shader.uniforms.voxelMacroTintStrength = { value: getMacroTintStrength(detail) };

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
  sampledDiffuseColor.rgb *= voxelTerrainMacroTint(vVoxelWorldPosition);
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
  { detail }: VoxelMaterialOptions
): THREE.Material {
  const material = useMemo(() => {
    const textures = createVoxelTerrainTextures(theme, { detail });
    const material = new THREE.MeshLambertMaterial({
      color: '#ffffff',
      emissive: '#ffffff',
      emissiveIntensity: getEmissiveIntensity(detail),
    });

    material.name = 'procedural-voxel-diffuse-terrain-material';
    material.onBeforeCompile = (shader) => patchTerrainTextureShader(shader, detail, textures);
    material.customProgramCacheKey = () => (
      `${TERRAIN_TEXTURE_SHADER_KEY}:${material.type}:${detail}:${textures.tileSize}`
    );
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
