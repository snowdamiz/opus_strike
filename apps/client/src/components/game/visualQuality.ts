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
  remoteMovementEffectDensityScale: number;
  remoteMovementEffectBotDistanceScale: number;
  maxTerrainImpactRenderDistance: number;
}

export interface RemotePlayerQualityConfig {
  showNameplates: boolean;
  nameplateDistance: number;
  fullBodyDistance: number;
  outlineDistance: number;
  botFullBodyDistanceScale: number;
  botOutlineDistanceScale: number;
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
  adaptiveVisibilityScale: number;
  terrainLodEnabled: boolean;
  cameraFar: number;
  fogDensity: number;
  terrainCullDistance: number;
  terrainLodFullDistance: number;
  terrainLodCoarseDistance: number;
  terrainLodUltraCoarseDistance: number;
  terrainPrebuildFullDistance: number;
  terrainMacroTileSize: number;
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
    mapSize: 2048,
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
    adaptiveVisibilityScale: 1,
    terrainLodEnabled: true,
    cameraFar: 132,
    fogDensity: 0.024,
    terrainCullDistance: 125,
    terrainLodFullDistance: 40,
    terrainLodCoarseDistance: 78,
    terrainLodUltraCoarseDistance: 110,
    terrainPrebuildFullDistance: 44,
    terrainMacroTileSize: 96,
    dressingCullDistance: 54,
    gridFadeDistance: 50,
    remoteMovementEffectDistance: 54,
    terrainImpactDistance: 60,
    farTerrainFogBlend: 0.8,
  },
  competitive: {
    adaptiveVisibilityScale: 1,
    terrainLodEnabled: true,
    cameraFar: 160,
    fogDensity: 0.0205,
    terrainCullDistance: 150,
    terrainLodFullDistance: 48,
    terrainLodCoarseDistance: 96,
    terrainLodUltraCoarseDistance: 135,
    terrainPrebuildFullDistance: 54,
    terrainMacroTileSize: 96,
    dressingCullDistance: 70,
    gridFadeDistance: 62,
    remoteMovementEffectDistance: 70,
    terrainImpactDistance: 76,
    farTerrainFogBlend: 0.74,
  },
  balanced: {
    adaptiveVisibilityScale: 1,
    terrainLodEnabled: true,
    cameraFar: 198,
    fogDensity: 0.0172,
    terrainCullDistance: 185,
    terrainLodFullDistance: 54,
    terrainLodCoarseDistance: 116,
    terrainLodUltraCoarseDistance: 165,
    terrainPrebuildFullDistance: 62,
    terrainMacroTileSize: 96,
    dressingCullDistance: 94,
    gridFadeDistance: 78,
    remoteMovementEffectDistance: 90,
    terrainImpactDistance: 98,
    farTerrainFogBlend: 0.68,
  },
  cinematic: {
    adaptiveVisibilityScale: 1,
    terrainLodEnabled: true,
    cameraFar: 250,
    fogDensity: 0.0134,
    terrainCullDistance: 235,
    terrainLodFullDistance: 72,
    terrainLodCoarseDistance: 148,
    terrainLodUltraCoarseDistance: 210,
    terrainPrebuildFullDistance: 84,
    terrainMacroTileSize: 96,
    dressingCullDistance: 122,
    gridFadeDistance: 98,
    remoteMovementEffectDistance: 118,
    terrainImpactDistance: 126,
    farTerrainFogBlend: 0.6,
  },
};

const BATTLE_ROYAL_FLIGHT_FULL_LOD_MULTIPLIER = 4.6;
const BATTLE_ROYAL_FLIGHT_FULL_LOD_MIN_INCREASE = 130;
const BATTLE_ROYAL_FLIGHT_COARSE_LOD_MULTIPLIER = 4.35;
const BATTLE_ROYAL_FLIGHT_ULTRA_COARSE_LOD_MULTIPLIER = 4.15;
const BATTLE_ROYAL_FLIGHT_CULL_MULTIPLIER = 4.15;
const BATTLE_ROYAL_FLIGHT_CAMERA_FAR_MULTIPLIER = 4.15;
const BATTLE_ROYAL_FLIGHT_COARSE_LOD_PADDING = 70;
const BATTLE_ROYAL_FLIGHT_ULTRA_COARSE_LOD_PADDING = 80;
const BATTLE_ROYAL_FLIGHT_CULL_PADDING = 96;
const BATTLE_ROYAL_FLIGHT_CAMERA_FAR_PADDING = 96;
const BATTLE_ROYAL_FLIGHT_MIN_TERRAIN_CULL_DISTANCE = 760;
const BATTLE_ROYAL_FLIGHT_MIN_CAMERA_FAR = 860;
const BATTLE_ROYAL_FLIGHT_FOG_DENSITY_MULTIPLIER = 0.26;
const BATTLE_ROYAL_FLIGHT_FAR_TERRAIN_FOG_BLEND_MULTIPLIER = 0.42;

export function scaleBattleRoyalVisibilityConfig(
  config: BattleRoyalVisibilityConfig,
  scale: number
): BattleRoyalVisibilityConfig {
  const visibilityScale = THREE.MathUtils.clamp(scale, 0.68, 1);
  const fogBoost = THREE.MathUtils.lerp(1.18, 1, visibilityScale);
  const scaleDistance = (value: number, minimum: number) => Math.max(minimum, value * visibilityScale);
  const scaledFullDistance = scaleDistance(config.terrainLodFullDistance, 24);
  const scaledCoarseDistance = Math.max(
    scaledFullDistance + 14,
    scaleDistance(config.terrainLodCoarseDistance, scaledFullDistance + 14)
  );
  const scaledUltraCoarseDistance = Math.max(
    scaledCoarseDistance + 18,
    scaleDistance(config.terrainLodUltraCoarseDistance, scaledCoarseDistance + 18)
  );
  const scaledCullDistance = Math.max(
    scaledUltraCoarseDistance + 8,
    scaleDistance(config.terrainCullDistance, scaledUltraCoarseDistance + 8)
  );

  return {
    ...config,
    adaptiveVisibilityScale: visibilityScale,
    cameraFar: Math.max(scaledCullDistance + 4, scaleDistance(config.cameraFar, scaledCullDistance + 4)),
    fogDensity: config.fogDensity * fogBoost,
    terrainCullDistance: scaledCullDistance,
    terrainLodFullDistance: scaledFullDistance,
    terrainLodCoarseDistance: scaledCoarseDistance,
    terrainLodUltraCoarseDistance: scaledUltraCoarseDistance,
    terrainPrebuildFullDistance: Math.min(config.terrainPrebuildFullDistance, scaledFullDistance + 8),
    dressingCullDistance: Math.min(config.dressingCullDistance, scaledCoarseDistance),
    gridFadeDistance: Math.min(config.gridFadeDistance, scaledUltraCoarseDistance),
    remoteMovementEffectDistance: Math.min(config.remoteMovementEffectDistance, scaledCoarseDistance),
    terrainImpactDistance: Math.min(config.terrainImpactDistance, scaledCoarseDistance),
    farTerrainFogBlend: THREE.MathUtils.clamp(config.farTerrainFogBlend + (1 - visibilityScale) * 0.18, 0, 0.92),
  };
}

export function createBattleRoyalFlightVisibilityConfig(
  config: BattleRoyalVisibilityConfig,
  blend = 1
): BattleRoyalVisibilityConfig {
  const flightBlend = THREE.MathUtils.clamp(blend, 0, 1);
  if (flightBlend <= 0.001) return config;

  const flightFullDistance = Math.max(
    config.terrainLodFullDistance * BATTLE_ROYAL_FLIGHT_FULL_LOD_MULTIPLIER,
    config.terrainLodFullDistance + BATTLE_ROYAL_FLIGHT_FULL_LOD_MIN_INCREASE
  );
  const flightCoarseDistance = Math.max(
    config.terrainLodCoarseDistance * BATTLE_ROYAL_FLIGHT_COARSE_LOD_MULTIPLIER,
    flightFullDistance + BATTLE_ROYAL_FLIGHT_COARSE_LOD_PADDING
  );
  const flightUltraCoarseDistance = Math.max(
    config.terrainLodUltraCoarseDistance * BATTLE_ROYAL_FLIGHT_ULTRA_COARSE_LOD_MULTIPLIER,
    flightCoarseDistance + BATTLE_ROYAL_FLIGHT_ULTRA_COARSE_LOD_PADDING
  );
  const flightCullDistance = Math.max(
    config.terrainCullDistance * BATTLE_ROYAL_FLIGHT_CULL_MULTIPLIER,
    flightUltraCoarseDistance + BATTLE_ROYAL_FLIGHT_CULL_PADDING,
    BATTLE_ROYAL_FLIGHT_MIN_TERRAIN_CULL_DISTANCE
  );
  const flightCameraFar = Math.max(
    config.cameraFar * BATTLE_ROYAL_FLIGHT_CAMERA_FAR_MULTIPLIER,
    flightCullDistance + BATTLE_ROYAL_FLIGHT_CAMERA_FAR_PADDING,
    BATTLE_ROYAL_FLIGHT_MIN_CAMERA_FAR
  );
  const flightFogDensity = config.fogDensity * BATTLE_ROYAL_FLIGHT_FOG_DENSITY_MULTIPLIER;
  const flightFarTerrainFogBlend = config.farTerrainFogBlend * BATTLE_ROYAL_FLIGHT_FAR_TERRAIN_FOG_BLEND_MULTIPLIER;

  return {
    ...config,
    cameraFar: THREE.MathUtils.lerp(config.cameraFar, flightCameraFar, flightBlend),
    fogDensity: THREE.MathUtils.lerp(config.fogDensity, flightFogDensity, flightBlend),
    terrainCullDistance: THREE.MathUtils.lerp(config.terrainCullDistance, flightCullDistance, flightBlend),
    terrainLodFullDistance: THREE.MathUtils.lerp(config.terrainLodFullDistance, flightFullDistance, flightBlend),
    terrainLodCoarseDistance: THREE.MathUtils.lerp(config.terrainLodCoarseDistance, flightCoarseDistance, flightBlend),
    terrainLodUltraCoarseDistance: THREE.MathUtils.lerp(
      config.terrainLodUltraCoarseDistance,
      flightUltraCoarseDistance,
      flightBlend
    ),
    terrainPrebuildFullDistance: THREE.MathUtils.lerp(
      config.terrainPrebuildFullDistance,
      flightFullDistance,
      flightBlend
    ),
    farTerrainFogBlend: THREE.MathUtils.lerp(
      config.farTerrainFogBlend,
      flightFarTerrainFogBlend,
      flightBlend
    ),
  };
}

const EFFECT_QUALITY_CONFIG: Record<GraphicsPreset, EffectQualityConfig> = {
  potato: {
    maxActiveImpacts: 18,
    maxActiveTrails: 12,
    maxActiveParticles: 96,
    maxVisibleRemoteAbilityEffects: 8,
    enableDecorativeLights: false,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    remoteMovementEffectDensityScale: 1,
    remoteMovementEffectBotDistanceScale: 1,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
  competitive: {
    maxActiveImpacts: 34,
    maxActiveTrails: 24,
    maxActiveParticles: 180,
    maxVisibleRemoteAbilityEffects: 16,
    enableDecorativeLights: true,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    remoteMovementEffectDensityScale: 1,
    remoteMovementEffectBotDistanceScale: 1,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
  balanced: {
    maxActiveImpacts: 44,
    maxActiveTrails: 28,
    maxActiveParticles: 240,
    maxVisibleRemoteAbilityEffects: 22,
    enableDecorativeLights: true,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    remoteMovementEffectDensityScale: 1,
    remoteMovementEffectBotDistanceScale: 1,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
  cinematic: {
    maxActiveImpacts: 72,
    maxActiveTrails: 54,
    maxActiveParticles: 520,
    maxVisibleRemoteAbilityEffects: 42,
    enableDecorativeLights: true,
    maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
    remoteMovementEffectDensityScale: 1,
    remoteMovementEffectBotDistanceScale: 1,
    maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
  },
};

const REMOTE_PLAYER_QUALITY_CONFIG: Record<GraphicsPreset, RemotePlayerQualityConfig> = {
  potato: {
    showNameplates: false,
    nameplateDistance: 0,
    fullBodyDistance: 36,
    outlineDistance: 0,
    botFullBodyDistanceScale: 1,
    botOutlineDistanceScale: 1,
    castShadows: false,
  },
  competitive: {
    showNameplates: true,
    nameplateDistance: 56,
    fullBodyDistance: 52,
    outlineDistance: 0,
    botFullBodyDistanceScale: 1,
    botOutlineDistanceScale: 1,
    castShadows: false,
  },
  balanced: {
    showNameplates: true,
    nameplateDistance: 72,
    fullBodyDistance: 72,
    outlineDistance: 48,
    botFullBodyDistanceScale: 1,
    botOutlineDistanceScale: 1,
    castShadows: true,
  },
  cinematic: {
    showNameplates: true,
    nameplateDistance: Number.POSITIVE_INFINITY,
    fullBodyDistance: Number.POSITIVE_INFINITY,
    outlineDistance: 96,
    botFullBodyDistanceScale: 1,
    botOutlineDistanceScale: 1,
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
    dynamicLights,
  };
}
