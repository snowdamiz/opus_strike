import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { VoxelMapTheme } from '@voxel-strike/shared';
import {
  ATLAS_COLUMNS,
  ATLAS_ROWS,
  createVoxelAtlasTextures,
  type VoxelAtlasTextures,
} from './textureAtlas';
import type { VoxelMaterialDetail } from '../visualQuality';

interface VoxelMaterialOptions {
  reflectionIntensity: number;
  detail: VoxelMaterialDetail;
}

type ShaderParameters = Parameters<THREE.Material['onBeforeCompile']>[0];

const VOXEL_ATLAS_SHADER_KEY = 'voxel-atlas-tile-repeat-v2';

const VOXEL_ATLAS_VERTEX_PARS = `
attribute vec2 voxelTileOrigin;
varying vec2 vVoxelTileUv;
varying vec2 vVoxelTileOrigin;
`;

const VOXEL_ATLAS_VERTEX_ASSIGN = `
vVoxelTileUv = uv;
vVoxelTileOrigin = voxelTileOrigin;
`;

const VOXEL_ATLAS_FRAGMENT_PARS = `
uniform vec2 voxelAtlasTileSize;
uniform vec2 voxelAtlasRepeatInset;
varying vec2 vVoxelTileUv;
varying vec2 vVoxelTileOrigin;

vec2 voxelAtlasLocalUv(vec2 tileUv) {
  vec2 mirroredUv = mod(tileUv, 2.0);
  return 1.0 - abs(mirroredUv - 1.0);
}

vec2 voxelAtlasInnerSize() {
  return voxelAtlasTileSize - voxelAtlasRepeatInset * 2.0;
}

vec2 voxelAtlasUv(vec2 tileUv) {
  return vVoxelTileOrigin + voxelAtlasRepeatInset + voxelAtlasLocalUv(tileUv) * voxelAtlasInnerSize();
}

vec4 voxelAtlasTexture2D(sampler2D atlasMap, vec2 tileUv) {
  vec2 atlasUv = voxelAtlasUv(tileUv);
  vec2 atlasDx = dFdx(tileUv) * voxelAtlasInnerSize();
  vec2 atlasDy = dFdy(tileUv) * voxelAtlasInnerSize();

  #ifdef texture2DGradEXT
    return texture2DGradEXT(atlasMap, atlasUv, atlasDx, atlasDy);
  #else
    return texture2D(atlasMap, atlasUv);
  #endif
}
`;

function replaceShaderChunk(source: string, chunk: string, replacement: string): string {
  return source.replace(`#include <${chunk}>`, replacement);
}

function patchVoxelAtlasShader(shader: ShaderParameters, atlas: VoxelAtlasTextures): void {
  shader.uniforms.voxelAtlasTileSize = { value: new THREE.Vector2(1 / ATLAS_COLUMNS, 1 / ATLAS_ROWS) };
  shader.uniforms.voxelAtlasRepeatInset = {
    value: new THREE.Vector2(
      Math.max(atlas.uvPadding, atlas.repeatEdgeCropPixels / (ATLAS_COLUMNS * atlas.tileSize)),
      Math.max(atlas.uvPadding, atlas.repeatEdgeCropPixels / (ATLAS_ROWS * atlas.tileSize))
    ),
  };

  shader.vertexShader = replaceShaderChunk(
    shader.vertexShader,
    'uv_pars_vertex',
    `#include <uv_pars_vertex>\n${VOXEL_ATLAS_VERTEX_PARS}`
  );
  shader.vertexShader = replaceShaderChunk(
    shader.vertexShader,
    'uv_vertex',
    `#include <uv_vertex>\n${VOXEL_ATLAS_VERTEX_ASSIGN}`
  );

  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'uv_pars_fragment',
    `#include <uv_pars_fragment>\n${VOXEL_ATLAS_FRAGMENT_PARS}`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'map_fragment',
    `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = voxelAtlasTexture2D(map, vVoxelTileUv);
  diffuseColor *= sampledDiffuseColor;
#endif
`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'emissivemap_fragment',
    `
#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = voxelAtlasTexture2D(emissiveMap, vVoxelTileUv);
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif
`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'roughnessmap_fragment',
    `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = voxelAtlasTexture2D(roughnessMap, vVoxelTileUv);
  roughnessFactor *= texelRoughness.g;
#endif
`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'metalnessmap_fragment',
    `
float metalnessFactor = metalness;
#ifdef USE_METALNESSMAP
  vec4 texelMetalness = voxelAtlasTexture2D(metalnessMap, vVoxelTileUv);
  metalnessFactor *= texelMetalness.b;
#endif
`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'bumpmap_pars_fragment',
    `
#ifdef USE_BUMPMAP
  uniform sampler2D bumpMap;
  uniform float bumpScale;
  vec2 dHdxy_fwd() {
    vec2 dTileUvDx = dFdx(vVoxelTileUv);
    vec2 dTileUvDy = dFdy(vVoxelTileUv);
    float Hll = bumpScale * voxelAtlasTexture2D(bumpMap, vVoxelTileUv).x;
    float dBx = bumpScale * voxelAtlasTexture2D(bumpMap, vVoxelTileUv + dTileUvDx).x - Hll;
    float dBy = bumpScale * voxelAtlasTexture2D(bumpMap, vVoxelTileUv + dTileUvDy).x - Hll;
    return vec2(dBx, dBy);
  }
  vec3 perturbNormalArb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection) {
    vec3 vSigmaX = normalize(dFdx(surf_pos.xyz));
    vec3 vSigmaY = normalize(dFdy(surf_pos.xyz));
    vec3 vN = surf_norm;
    vec3 R1 = cross(vSigmaY, vN);
    vec3 R2 = cross(vN, vSigmaX);
    float fDet = dot(vSigmaX, R1) * faceDirection;
    vec3 vGrad = sign(fDet) * (dHdxy.x * R1 + dHdxy.y * R2);
    return normalize(abs(fDet) * surf_norm - vGrad);
  }
#endif
`
  );
  shader.fragmentShader = replaceShaderChunk(
    shader.fragmentShader,
    'aomap_fragment',
    `
#ifdef USE_AOMAP
  float ambientOcclusion = (voxelAtlasTexture2D(aoMap, vVoxelTileUv).r - 1.0) * aoMapIntensity + 1.0;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined(USE_CLEARCOAT)
    clearcoatSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined(USE_SHEEN)
    sheenSpecularIndirect *= ambientOcclusion;
  #endif
  #if defined(USE_ENVMAP) && defined(STANDARD)
    float dotNV = saturate(dot(geometryNormal, geometryViewDir));
    reflectedLight.indirectSpecular *= computeSpecularOcclusion(dotNV, ambientOcclusion, material.roughness);
  #endif
#endif
`
  );
}

export function useVoxelMaterial(
  theme: VoxelMapTheme,
  { reflectionIntensity, detail }: VoxelMaterialOptions
): THREE.Material {
  const material = useMemo(() => {
    const atlas = createVoxelAtlasTextures(theme, { detail });
    const useSurfaceResponseMaps = Boolean(atlas.roughness && atlas.metalness);
    const useFineDetailMaps = Boolean(atlas.bump && atlas.ao);

    if (detail !== 'high') {
      const material = new THREE.MeshLambertMaterial({
        map: atlas.color,
        color: '#ffffff',
        emissive: '#ffffff',
        emissiveMap: atlas.emissive,
        emissiveIntensity: detail === 'low' ? 0.72 : 0.92,
      });

      material.name = 'procedural-voxel-atlas-lambert-material';
      material.onBeforeCompile = (shader) => patchVoxelAtlasShader(shader, atlas);
      material.customProgramCacheKey = () => `${VOXEL_ATLAS_SHADER_KEY}:${material.type}:${detail}:${atlas.tileSize}`;
      return material;
    }

    const parameters: THREE.MeshStandardMaterialParameters = {
      map: atlas.color,
      bumpScale: useFineDetailMaps ? 0.08 : 0,
      roughness: 0.96,
      metalness: 1,
      emissive: '#ffffff',
      emissiveMap: atlas.emissive,
      emissiveIntensity: 1.08,
      aoMapIntensity: useFineDetailMaps ? 0.82 : 0,
      color: '#ffffff',
    };

    if (useSurfaceResponseMaps && atlas.roughness && atlas.metalness) {
      parameters.roughnessMap = atlas.roughness;
      parameters.metalnessMap = atlas.metalness;
    }

    if (useFineDetailMaps && atlas.bump && atlas.ao) {
      parameters.bumpMap = atlas.bump;
      parameters.aoMap = atlas.ao;
    }

    const material = new THREE.MeshStandardMaterial(parameters);

    material.envMapIntensity = reflectionIntensity;
    material.name = 'procedural-voxel-atlas-material';
    material.onBeforeCompile = (shader) => patchVoxelAtlasShader(shader, atlas);
    material.customProgramCacheKey = () => `${VOXEL_ATLAS_SHADER_KEY}:${material.type}:${detail}:${atlas.tileSize}`;
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
