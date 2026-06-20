import * as THREE from 'three';
import type {
  ClientSettings,
  GraphicsFeatureQuality,
  GraphicsPreset,
  GraphicsQuality,
} from '../../store/settingsStore';

export interface RenderQualityConfig {
  dpr: [number, number];
  antialias: boolean;
  exposure: number;
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

export interface MaterialQualityConfig {
  terrainTextureQuality: GraphicsFeatureQuality;
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
  maxGeneratedRegionMeshesPerFrame: number;
  maxVisualPhysicsQueriesPerFrame: number;
}

export interface EffectQualityConfig {
  maxActiveImpacts: number;
  maxActiveTrails: number;
  maxActiveParticles: number;
  maxVisibleRemoteAbilityEffects: number;
  enableDecorativeLights: boolean;
  maxRemoteMovementEffectDistance: number;
  maxTerrainImpactRenderDistance: number;
}

export interface RemotePlayerQualityConfig {
  animateBeacons: boolean;
  showNameplates: boolean;
  showBeacons: boolean;
  fullBodyDistance: number;
  outlineDistance: number;
  castShadows: boolean;
}

export interface RagdollQualityConfig {
  maxHighQuality: number;
  maxTotal: number;
  castShadows: boolean;
}

export interface ViewmodelQualityConfig {
  tier: 'core' | 'standard' | 'full';
  allowDecorativeGlows: boolean;
}

export interface BattleRoyalVisibilityConfig {
  terrainLodEnabled: boolean;
  cameraFar: number;
  fogDensity: number;
  terrainCullDistance: number;
  terrainLodFullDistance: number;
  terrainLodCoarseDistance: number;
  terrainPrebuildFullDistance: number;
  dressingCullDistance: number;
  gridFadeDistance: number;
  remoteMovementEffectDistance: number;
  terrainImpactDistance: number;
  farTerrainFogBlend: number;
}

export interface VisualQualityConfig {
  profile: GraphicsPreset;
  render: RenderQualityConfig;
  shadows: ShadowQualityConfig;
  reflections: ReflectionQualityConfig;
  environment: EnvironmentQualityConfig;
  materials: MaterialQualityConfig;
  effects: EffectQualityConfig;
  remotePlayers: RemotePlayerQualityConfig;
  ragdolls: RagdollQualityConfig;
  viewmodel: ViewmodelQualityConfig;
  budgets: WorldPerformanceBudget;
  battleRoyalVisibility: BattleRoyalVisibilityConfig;
  battleRoyalDeploymentVisibility: BattleRoyalVisibilityConfig;
  dynamicLights: {
    maxDynamicLights: number;
    staticAccentLights: boolean;
  };
}

const DEFAULT_RENDER_EXPOSURE = 1.08;
export const DEFAULT_CAMERA_FAR = 1000;

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
    particleDensity: 0.5,
    dustDevilDensity: 0.55,
    dressingDensity: 0.5,
    skySegments: [32, 16],
    sunSegments: [24, 12],
    maxParticles: 260,
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
    maxDynamicLights: 3,
    staticAccentLights: true,
  },
  cinematic: {
    maxDynamicLights: 8,
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
    maxGeneratedRegionMeshesPerFrame: 2,
    maxVisualPhysicsQueriesPerFrame: 28,
  },
  balanced: {
    frameTargetFps: 60,
    cpuFrameP95Ms: 10,
    gpuFrameP95Ms: 12,
    drawCalls: 560,
    triangles: 540_000,
    textures: 180,
    geometries: 620,
    materials: 360,
    maxAtmosphereParticles: 300,
    maxWorldDressingInstances: 460,
    maxGeneratedRegionMeshesPerFrame: 2,
    maxVisualPhysicsQueriesPerFrame: 36,
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
    maxGeneratedRegionMeshesPerFrame: 4,
    maxVisualPhysicsQueriesPerFrame: 72,
  },
};

export const BATTLE_ROYAL_VISIBILITY_CONFIG: Record<GraphicsPreset, BattleRoyalVisibilityConfig> = {
  potato: {
    terrainLodEnabled: true,
    cameraFar: 115,
    fogDensity: 0.022,
    terrainCullDistance: 82,
    terrainLodFullDistance: 56,
    terrainLodCoarseDistance: 105,
    terrainPrebuildFullDistance: 78,
    dressingCullDistance: 54,
    gridFadeDistance: 50,
    remoteMovementEffectDistance: 54,
    terrainImpactDistance: 60,
    farTerrainFogBlend: 0.76,
  },
  competitive: {
    terrainLodEnabled: true,
    cameraFar: 136,
    fogDensity: 0.0185,
    terrainCullDistance: 104,
    terrainLodFullDistance: 74,
    terrainLodCoarseDistance: 128,
    terrainPrebuildFullDistance: 96,
    dressingCullDistance: 70,
    gridFadeDistance: 62,
    remoteMovementEffectDistance: 70,
    terrainImpactDistance: 76,
    farTerrainFogBlend: 0.7,
  },
  balanced: {
    terrainLodEnabled: true,
    cameraFar: 168,
    fogDensity: 0.0148,
    terrainCullDistance: 132,
    terrainLodFullDistance: 94,
    terrainLodCoarseDistance: 160,
    terrainPrebuildFullDistance: 120,
    dressingCullDistance: 94,
    gridFadeDistance: 78,
    remoteMovementEffectDistance: 90,
    terrainImpactDistance: 98,
    farTerrainFogBlend: 0.64,
  },
  cinematic: {
    terrainLodEnabled: true,
    cameraFar: 210,
    fogDensity: 0.0115,
    terrainCullDistance: 166,
    terrainLodFullDistance: 122,
    terrainLodCoarseDistance: 202,
    terrainPrebuildFullDistance: 148,
    dressingCullDistance: 122,
    gridFadeDistance: 98,
    remoteMovementEffectDistance: 118,
    terrainImpactDistance: 126,
    farTerrainFogBlend: 0.56,
  },
};

export const BATTLE_ROYAL_DEPLOYMENT_VISIBILITY_CONFIG: Record<GraphicsPreset, BattleRoyalVisibilityConfig> = {
  potato: {
    terrainLodEnabled: false,
    cameraFar: DEFAULT_CAMERA_FAR,
    fogDensity: 0.007,
    terrainCullDistance: DEFAULT_CAMERA_FAR,
    terrainLodFullDistance: DEFAULT_CAMERA_FAR,
    terrainLodCoarseDistance: DEFAULT_CAMERA_FAR,
    terrainPrebuildFullDistance: DEFAULT_CAMERA_FAR,
    dressingCullDistance: 150,
    gridFadeDistance: 190,
    remoteMovementEffectDistance: DEFAULT_CAMERA_FAR,
    terrainImpactDistance: DEFAULT_CAMERA_FAR,
    farTerrainFogBlend: 0.36,
  },
  competitive: {
    terrainLodEnabled: false,
    cameraFar: DEFAULT_CAMERA_FAR,
    fogDensity: 0.006,
    terrainCullDistance: DEFAULT_CAMERA_FAR,
    terrainLodFullDistance: DEFAULT_CAMERA_FAR,
    terrainLodCoarseDistance: DEFAULT_CAMERA_FAR,
    terrainPrebuildFullDistance: DEFAULT_CAMERA_FAR,
    dressingCullDistance: 170,
    gridFadeDistance: 215,
    remoteMovementEffectDistance: DEFAULT_CAMERA_FAR,
    terrainImpactDistance: DEFAULT_CAMERA_FAR,
    farTerrainFogBlend: 0.32,
  },
  balanced: {
    terrainLodEnabled: false,
    cameraFar: DEFAULT_CAMERA_FAR,
    fogDensity: 0.0052,
    terrainCullDistance: DEFAULT_CAMERA_FAR,
    terrainLodFullDistance: DEFAULT_CAMERA_FAR,
    terrainLodCoarseDistance: DEFAULT_CAMERA_FAR,
    terrainPrebuildFullDistance: DEFAULT_CAMERA_FAR,
    dressingCullDistance: 190,
    gridFadeDistance: 240,
    remoteMovementEffectDistance: DEFAULT_CAMERA_FAR,
    terrainImpactDistance: DEFAULT_CAMERA_FAR,
    farTerrainFogBlend: 0.28,
  },
  cinematic: {
    terrainLodEnabled: false,
    cameraFar: DEFAULT_CAMERA_FAR,
    fogDensity: 0.0046,
    terrainCullDistance: DEFAULT_CAMERA_FAR,
    terrainLodFullDistance: DEFAULT_CAMERA_FAR,
    terrainLodCoarseDistance: DEFAULT_CAMERA_FAR,
    terrainPrebuildFullDistance: DEFAULT_CAMERA_FAR,
    dressingCullDistance: 220,
    gridFadeDistance: 270,
    remoteMovementEffectDistance: DEFAULT_CAMERA_FAR,
    terrainImpactDistance: DEFAULT_CAMERA_FAR,
    farTerrainFogBlend: 0.24,
  },
};

const EFFECT_QUALITY_CONFIG: Record<GraphicsPreset, EffectQualityConfig> = {
  potato: {
    maxActiveImpacts: 18,
    maxActiveTrails: 12,
    maxActiveParticles: 96,
    maxVisibleRemoteAbilityEffects: 8,
    enableDecorativeLights: false,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
  competitive: {
    maxActiveImpacts: 34,
    maxActiveTrails: 24,
    maxActiveParticles: 180,
    maxVisibleRemoteAbilityEffects: 16,
    enableDecorativeLights: true,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
  balanced: {
    maxActiveImpacts: 44,
    maxActiveTrails: 28,
    maxActiveParticles: 240,
    maxVisibleRemoteAbilityEffects: 22,
    enableDecorativeLights: true,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
  cinematic: {
    maxActiveImpacts: 72,
    maxActiveTrails: 54,
    maxActiveParticles: 520,
    maxVisibleRemoteAbilityEffects: 42,
    enableDecorativeLights: true,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
};

const REMOTE_PLAYER_QUALITY_CONFIG: Record<GraphicsPreset, RemotePlayerQualityConfig> = {
  potato: {
    animateBeacons: false,
    showNameplates: false,
    showBeacons: false,
    fullBodyDistance: 36,
    outlineDistance: 0,
    castShadows: false,
  },
  competitive: {
    animateBeacons: false,
    showNameplates: true,
    showBeacons: false,
    fullBodyDistance: 52,
    outlineDistance: 0,
    castShadows: false,
  },
  balanced: {
    animateBeacons: true,
    showNameplates: true,
    showBeacons: true,
    fullBodyDistance: 72,
    outlineDistance: 48,
    castShadows: true,
  },
  cinematic: {
    animateBeacons: true,
    showNameplates: true,
    showBeacons: true,
    fullBodyDistance: Number.POSITIVE_INFINITY,
    outlineDistance: 96,
    castShadows: true,
  },
};

const RAGDOLL_QUALITY_CONFIG: Record<GraphicsPreset, RagdollQualityConfig> = {
  potato: {
    maxHighQuality: 0,
    maxTotal: 4,
    castShadows: false,
  },
  competitive: {
    maxHighQuality: 3,
    maxTotal: 8,
    castShadows: false,
  },
  balanced: {
    maxHighQuality: 8,
    maxTotal: 16,
    castShadows: true,
  },
  cinematic: {
    maxHighQuality: 8,
    maxTotal: 16,
    castShadows: true,
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
  | 'shadowQuality'
  | 'reflectionQuality'
  | 'environmentQuality'
  | 'materialQuality'
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
    },
    shadows: SHADOW_QUALITY_CONFIG[settings.shadowQuality],
    reflections: REFLECTION_QUALITY_CONFIG[settings.reflectionQuality],
    environment: ENVIRONMENT_QUALITY_CONFIG[settings.environmentQuality],
    materials: {
      terrainTextureQuality: settings.materialQuality,
    },
    effects: EFFECT_QUALITY_CONFIG[profile],
    remotePlayers: REMOTE_PLAYER_QUALITY_CONFIG[profile],
    ragdolls: {
      ...RAGDOLL_QUALITY_CONFIG[profile],
      castShadows: RAGDOLL_QUALITY_CONFIG[profile].castShadows && SHADOW_QUALITY_CONFIG[settings.shadowQuality].enabled,
    },
    viewmodel: VIEWMODEL_QUALITY_CONFIG[profile],
    budgets: WORLD_PERFORMANCE_BUDGETS[profile],
    battleRoyalVisibility: BATTLE_ROYAL_VISIBILITY_CONFIG[profile],
    battleRoyalDeploymentVisibility: BATTLE_ROYAL_DEPLOYMENT_VISIBILITY_CONFIG[profile],
    dynamicLights,
  };
}
