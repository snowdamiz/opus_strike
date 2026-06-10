import * as THREE from 'three';
import type {
  ClientSettings,
  GraphicsFeatureQuality,
  GraphicsPreset,
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
  maxParticles: number;
}

export interface WorldPerformanceBudget {
  frameTargetFps: number;
  cpuFrameP95Ms: number;
  gpuFrameP95Ms: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  materials: number;
  maxAtmosphereParticles: number;
  maxWorldDressingInstances: number;
  maxFullRemoteBodies: number;
  maxGeneratedRegionMeshesPerFrame: number;
  maxVisualPhysicsQueriesPerFrame: number;
}

export interface EffectQualityConfig {
  maxActiveImpacts: number;
  maxActiveTrails: number;
  maxActiveParticles: number;
  maxVisibleRemoteAbilityEffects: number;
  enableDecorativeLights: boolean;
  slideSpeedLineCount: number;
}

export interface RemotePlayerQualityConfig {
  maxFullBodies: number;
  nearDistance: number;
  midDistance: number;
  animateFarMarkers: boolean;
  showNameplates: boolean;
  showBeacons: boolean;
  distantAnimationFps: number;
}

export interface ViewmodelQualityConfig {
  tier: 'core' | 'standard' | 'full';
  allowDecorativeGlows: boolean;
}

export interface VisualQualityConfig {
  profile: GraphicsPreset;
  render: RenderQualityConfig;
  shadows: ShadowQualityConfig;
  reflections: ReflectionQualityConfig;
  environment: EnvironmentQualityConfig;
  effects: EffectQualityConfig;
  remotePlayers: RemotePlayerQualityConfig;
  viewmodel: ViewmodelQualityConfig;
  budgets: WorldPerformanceBudget;
  dynamicLights: {
    maxDynamicLights: number;
    staticAccentLights: boolean;
  };
}

const DEFAULT_RENDER_EXPOSURE = 1.08;

const RESOLUTION_SCALE_CONFIG: Record<GraphicsQuality, Pick<RenderQualityConfig, 'dpr'>> = {
  minimum: {
    dpr: [0.6, 0.85],
  },
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
  minimum: {
    enabled: false,
    mapSize: 512,
    type: THREE.BasicShadowMap,
    volume: 64,
    far: 120,
    dressingShadows: false,
  },
  low: {
    enabled: false,
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
  minimum: {
    enabled: false,
    resolution: 16,
    sceneIntensity: 0,
    materialIntensity: 0,
  },
  low: {
    enabled: false,
    resolution: 32,
    sceneIntensity: 0,
    materialIntensity: 0,
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
    maxParticles: 0,
  },
  minimum: {
    particleDensity: 0,
    dustDevilDensity: 0,
    dressingDensity: 0,
    skySegments: [20, 10],
    sunSegments: [12, 6],
    maxParticles: 50,
  },
  low: {
    particleDensity: 0.12,
    dustDevilDensity: 0.16,
    dressingDensity: 0.16,
    skySegments: [24, 12],
    sunSegments: [16, 8],
    maxParticles: 120,
  },
  medium: {
    particleDensity: 0.65,
    dustDevilDensity: 0.75,
    dressingDensity: 0.7,
    skySegments: [32, 16],
    sunSegments: [24, 12],
    maxParticles: 360,
  },
  high: {
    particleDensity: 1,
    dustDevilDensity: 1,
    dressingDensity: 1,
    skySegments: [48, 32],
    sunSegments: [32, 16],
    maxParticles: 720,
  },
  ultra: {
    particleDensity: 1.25,
    dustDevilDensity: 1.25,
    dressingDensity: 1.15,
    skySegments: [64, 32],
    sunSegments: [48, 24],
    maxParticles: 980,
  },
};

const DYNAMIC_LIGHT_BUDGET: Record<GraphicsFeatureQuality, VisualQualityConfig['dynamicLights']> = {
  off: {
    maxDynamicLights: 0,
    staticAccentLights: false,
  },
  minimum: {
    maxDynamicLights: 0,
    staticAccentLights: false,
  },
  low: {
    maxDynamicLights: 1,
    staticAccentLights: false,
  },
  medium: {
    maxDynamicLights: 4,
    staticAccentLights: true,
  },
  high: {
    maxDynamicLights: 8,
    staticAccentLights: true,
  },
  ultra: {
    maxDynamicLights: 12,
    staticAccentLights: true,
  },
};

const PROFILE_DYNAMIC_LIGHT_BUDGET: Record<GraphicsPreset, VisualQualityConfig['dynamicLights']> = {
  potato: {
    maxDynamicLights: 0,
    staticAccentLights: false,
  },
  competitive: {
    maxDynamicLights: 1,
    staticAccentLights: false,
  },
  balanced: {
    maxDynamicLights: 4,
    staticAccentLights: true,
  },
  cinematic: {
    maxDynamicLights: 10,
    staticAccentLights: true,
  },
};

export const WORLD_PERFORMANCE_BUDGETS: Record<GraphicsPreset, WorldPerformanceBudget> = {
  potato: {
    frameTargetFps: 60,
    cpuFrameP95Ms: 12,
    gpuFrameP95Ms: 10,
    drawCalls: 320,
    triangles: 220_000,
    textures: 80,
    geometries: 260,
    materials: 180,
    maxAtmosphereParticles: 50,
    maxWorldDressingInstances: 100,
    maxFullRemoteBodies: 1,
    maxGeneratedRegionMeshesPerFrame: 1,
    maxVisualPhysicsQueriesPerFrame: 18,
  },
  competitive: {
    frameTargetFps: 60,
    cpuFrameP95Ms: 11,
    gpuFrameP95Ms: 11,
    drawCalls: 450,
    triangles: 360_000,
    textures: 120,
    geometries: 420,
    materials: 260,
    maxAtmosphereParticles: 120,
    maxWorldDressingInstances: 220,
    maxFullRemoteBodies: 2,
    maxGeneratedRegionMeshesPerFrame: 2,
    maxVisualPhysicsQueriesPerFrame: 28,
  },
  balanced: {
    frameTargetFps: 60,
    cpuFrameP95Ms: 10,
    gpuFrameP95Ms: 12,
    drawCalls: 650,
    triangles: 650_000,
    textures: 180,
    geometries: 700,
    materials: 420,
    maxAtmosphereParticles: 480,
    maxWorldDressingInstances: 640,
    maxFullRemoteBodies: 4,
    maxGeneratedRegionMeshesPerFrame: 3,
    maxVisualPhysicsQueriesPerFrame: 44,
  },
  cinematic: {
    frameTargetFps: 60,
    cpuFrameP95Ms: 14,
    gpuFrameP95Ms: 16,
    drawCalls: 950,
    triangles: 1_100_000,
    textures: 260,
    geometries: 1_000,
    materials: 640,
    maxAtmosphereParticles: 980,
    maxWorldDressingInstances: 920,
    maxFullRemoteBodies: 8,
    maxGeneratedRegionMeshesPerFrame: 4,
    maxVisualPhysicsQueriesPerFrame: 72,
  },
};

const EFFECT_QUALITY_CONFIG: Record<GraphicsPreset, EffectQualityConfig> = {
  potato: {
    maxActiveImpacts: 18,
    maxActiveTrails: 12,
    maxActiveParticles: 96,
    maxVisibleRemoteAbilityEffects: 8,
    enableDecorativeLights: false,
    slideSpeedLineCount: 0,
  },
  competitive: {
    maxActiveImpacts: 34,
    maxActiveTrails: 24,
    maxActiveParticles: 180,
    maxVisibleRemoteAbilityEffects: 16,
    enableDecorativeLights: true,
    slideSpeedLineCount: 16,
  },
  balanced: {
    maxActiveImpacts: 58,
    maxActiveTrails: 36,
    maxActiveParticles: 360,
    maxVisibleRemoteAbilityEffects: 28,
    enableDecorativeLights: true,
    slideSpeedLineCount: 28,
  },
  cinematic: {
    maxActiveImpacts: 80,
    maxActiveTrails: 64,
    maxActiveParticles: 620,
    maxVisibleRemoteAbilityEffects: 48,
    enableDecorativeLights: true,
    slideSpeedLineCount: 36,
  },
};

const REMOTE_PLAYER_QUALITY_CONFIG: Record<GraphicsPreset, RemotePlayerQualityConfig> = {
  potato: {
    maxFullBodies: 1,
    nearDistance: 10,
    midDistance: 28,
    animateFarMarkers: false,
    showNameplates: false,
    showBeacons: false,
    distantAnimationFps: 8,
  },
  competitive: {
    maxFullBodies: 2,
    nearDistance: 16,
    midDistance: 34,
    animateFarMarkers: false,
    showNameplates: true,
    showBeacons: false,
    distantAnimationFps: 12,
  },
  balanced: {
    maxFullBodies: 4,
    nearDistance: 18,
    midDistance: 38,
    animateFarMarkers: true,
    showNameplates: true,
    showBeacons: true,
    distantAnimationFps: 18,
  },
  cinematic: {
    maxFullBodies: 8,
    nearDistance: 24,
    midDistance: 52,
    animateFarMarkers: true,
    showNameplates: true,
    showBeacons: true,
    distantAnimationFps: 30,
  },
};

const VIEWMODEL_QUALITY_CONFIG: Record<GraphicsPreset, ViewmodelQualityConfig> = {
  potato: {
    tier: 'core',
    allowDecorativeGlows: false,
  },
  competitive: {
    tier: 'standard',
    allowDecorativeGlows: true,
  },
  balanced: {
    tier: 'standard',
    allowDecorativeGlows: true,
  },
  cinematic: {
    tier: 'full',
    allowDecorativeGlows: true,
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
  | 'graphicsPreset'
>): VisualQualityConfig {
  const renderConfig = RESOLUTION_SCALE_CONFIG[settings.resolutionScale];
  const profile = settings.graphicsPreset;
  const dynamicLights = settings.shadowQuality === 'off'
    ? PROFILE_DYNAMIC_LIGHT_BUDGET[profile]
    : {
      maxDynamicLights: Math.min(
        DYNAMIC_LIGHT_BUDGET[settings.shadowQuality].maxDynamicLights,
        PROFILE_DYNAMIC_LIGHT_BUDGET[profile].maxDynamicLights
      ),
      staticAccentLights:
        DYNAMIC_LIGHT_BUDGET[settings.shadowQuality].staticAccentLights &&
        PROFILE_DYNAMIC_LIGHT_BUDGET[profile].staticAccentLights,
    };

  return {
    profile,
    render: {
      ...renderConfig,
      antialias: settings.antialiasing,
      exposure: DEFAULT_RENDER_EXPOSURE,
      materialDetail: settings.materialQuality,
    },
    shadows: SHADOW_QUALITY_CONFIG[settings.shadowQuality],
    reflections: REFLECTION_QUALITY_CONFIG[settings.reflectionQuality],
    environment: ENVIRONMENT_QUALITY_CONFIG[settings.environmentQuality],
    effects: EFFECT_QUALITY_CONFIG[profile],
    remotePlayers: REMOTE_PLAYER_QUALITY_CONFIG[profile],
    viewmodel: VIEWMODEL_QUALITY_CONFIG[profile],
    budgets: WORLD_PERFORMANCE_BUDGETS[profile],
    dynamicLights,
  };
}
