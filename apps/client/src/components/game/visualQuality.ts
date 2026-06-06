import * as THREE from 'three';
import type {
  ClientSettings,
  GraphicsFeatureQuality,
  GraphicsQuality,
  MaterialQuality,
} from '../../store/settingsStore';

export type VoxelMaterialDetail = MaterialQuality;

export interface RenderQualityConfig {
  dpr: [number, number];
  antialias: boolean;
  exposure: number;
  materialDetail: VoxelMaterialDetail;
}

export interface ShadowQualityConfig {
  enabled: boolean;
  mapSize: number;
  type: THREE.ShadowMapType;
  volume: number;
  far: number;
  dressingShadows: boolean;
}

export interface ReflectionQualityConfig {
  enabled: boolean;
  resolution: number;
  sceneIntensity: number;
  materialIntensity: number;
}

export interface EnvironmentQualityConfig {
  particleDensity: number;
  dustDevilDensity: number;
  dressingDensity: number;
  skySegments: [number, number];
  sunSegments: [number, number];
}

export interface VisualQualityConfig {
  render: RenderQualityConfig;
  shadows: ShadowQualityConfig;
  reflections: ReflectionQualityConfig;
  environment: EnvironmentQualityConfig;
}

const DEFAULT_RENDER_EXPOSURE = 1.08;

const RESOLUTION_SCALE_CONFIG: Record<GraphicsQuality, Pick<RenderQualityConfig, 'dpr'>> = {
  low: {
    dpr: [0.75, 1],
  },
  medium: {
    dpr: [1, 1.25],
  },
  high: {
    dpr: [1, 1.75],
  },
  ultra: {
    dpr: [1.25, 2],
  },
};

const SHADOW_QUALITY_CONFIG: Record<GraphicsFeatureQuality, ShadowQualityConfig> = {
  off: {
    enabled: false,
    mapSize: 512,
    type: THREE.BasicShadowMap,
    volume: 80,
    far: 160,
    dressingShadows: false,
  },
  low: {
    enabled: true,
    mapSize: 1024,
    type: THREE.BasicShadowMap,
    volume: 80,
    far: 160,
    dressingShadows: false,
  },
  medium: {
    enabled: true,
    mapSize: 2048,
    type: THREE.PCFShadowMap,
    volume: 90,
    far: 180,
    dressingShadows: false,
  },
  high: {
    enabled: true,
    mapSize: 4096,
    type: THREE.PCFSoftShadowMap,
    volume: 100,
    far: 200,
    dressingShadows: false,
  },
  ultra: {
    enabled: true,
    mapSize: 4096,
    type: THREE.PCFSoftShadowMap,
    volume: 110,
    far: 220,
    dressingShadows: true,
  },
};

const REFLECTION_QUALITY_CONFIG: Record<GraphicsFeatureQuality, ReflectionQualityConfig> = {
  off: {
    enabled: false,
    resolution: 16,
    sceneIntensity: 0,
    materialIntensity: 0,
  },
  low: {
    enabled: true,
    resolution: 32,
    sceneIntensity: 0.35,
    materialIntensity: 0.35,
  },
  medium: {
    enabled: true,
    resolution: 64,
    sceneIntensity: 0.58,
    materialIntensity: 0.55,
  },
  high: {
    enabled: true,
    resolution: 128,
    sceneIntensity: 0.82,
    materialIntensity: 0.85,
  },
  ultra: {
    enabled: true,
    resolution: 256,
    sceneIntensity: 1,
    materialIntensity: 1.05,
  },
};

const ENVIRONMENT_QUALITY_CONFIG: Record<GraphicsFeatureQuality, EnvironmentQualityConfig> = {
  off: {
    particleDensity: 0,
    dustDevilDensity: 0,
    dressingDensity: 0,
    skySegments: [24, 12],
    sunSegments: [16, 8],
  },
  low: {
    particleDensity: 0.35,
    dustDevilDensity: 0.5,
    dressingDensity: 0.35,
    skySegments: [24, 12],
    sunSegments: [16, 8],
  },
  medium: {
    particleDensity: 0.65,
    dustDevilDensity: 0.75,
    dressingDensity: 0.7,
    skySegments: [32, 16],
    sunSegments: [24, 12],
  },
  high: {
    particleDensity: 1,
    dustDevilDensity: 1,
    dressingDensity: 1,
    skySegments: [48, 32],
    sunSegments: [32, 16],
  },
  ultra: {
    particleDensity: 1.25,
    dustDevilDensity: 1.25,
    dressingDensity: 1.15,
    skySegments: [64, 32],
    sunSegments: [48, 24],
  },
};

export function getVisualQualityConfig(settings: Pick<
  ClientSettings,
  | 'resolutionScale'
  | 'antialiasing'
  | 'materialQuality'
  | 'shadowQuality'
  | 'reflectionQuality'
  | 'environmentQuality'
>): VisualQualityConfig {
  const renderConfig = RESOLUTION_SCALE_CONFIG[settings.resolutionScale];

  return {
    render: {
      ...renderConfig,
      antialias: settings.antialiasing,
      exposure: DEFAULT_RENDER_EXPOSURE,
      materialDetail: settings.materialQuality,
    },
    shadows: SHADOW_QUALITY_CONFIG[settings.shadowQuality],
    reflections: REFLECTION_QUALITY_CONFIG[settings.reflectionQuality],
    environment: ENVIRONMENT_QUALITY_CONFIG[settings.environmentQuality],
  };
}
