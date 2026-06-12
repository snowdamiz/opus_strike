import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { getVoxelMapTheme } from '@voxel-strike/shared';
import { VoxelWorld } from './VoxelWorld';
import type { VoxelMapWarmupStatus } from './procedural/VoxelMap';
import { WorldAtmosphere } from './WorldAtmosphere';
import { PlayerController } from './PlayerController';
import { OtherPlayers } from './OtherPlayers';
import { Flags } from './Flags';
import { Effects } from './Effects';
import { SlideSpeedLines } from './SlideSpeedLines';
import { HeroViewmodel } from './HeroViewmodel';
import { VoidZonesManager, DireBallsManager, VoidRaysManager, PhantomPersonalShieldsManager } from './phantom';
import { PhantomEffectsManager } from './PhantomEffects';
import { ObservedAbilityCastEffectsManager } from './ObservedAbilityCastEffects';
import { BlazeEffectsManager } from './BlazeEffects';
import { HookshotEffectsManager } from './HookshotEffects';
import { TerrainImpactEffectsManager } from './TerrainImpactEffects';
import { ChronosAegisManager, ChronosAscendantManager, ChronosPulsesManager, ChronosTimebreakManager } from './chronos';
import { prewarmBlazeEffects, prewarmPhantomEffects } from './effectResources';
import { GameplayFrameSystems } from './systems/GameplayFrameSystems';
import { BudgetedPointLight, DynamicLightBudgetSystem } from './systems/DynamicLightBudget';
import { useGameStore } from '../../store/gameStore';
import { graphicsPresetSettings, useSettingsStore } from '../../store/settingsStore';
import {
  getMapPrepCacheKey,
} from '../../utils/mapWarmup/mapPrepCache';
import {
  createMapWarmupSnapshot,
  reduceMapWarmup,
  type MapWarmupSnapshot,
  type MapWarmupStageId,
} from '../../utils/mapWarmup/mapWarmupCoordinator';
import {
  getVisualQualityConfig,
  type ReflectionQualityConfig,
  type ShadowQualityConfig,
} from './visualQuality';
import { FrameTimeHistogram } from './adaptiveQualityHistogram';
import { configureVisualPhysicsQueryBudget } from '../../hooks/usePhysics';

function CameraSettingsApplier({ fov }: { fov: number }) {
  const { camera } = useThree();

  useEffect(() => {
    if ('fov' in camera) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  }, [camera, fov]);

  return null;
}

function RendererSettingsApplier({
  exposure,
  shadows,
}: {
  exposure: number;
  shadows: ShadowQualityConfig;
}) {
  const { gl } = useThree();

  useEffect(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = exposure;
    gl.shadowMap.enabled = shadows.enabled;
    gl.shadowMap.type = shadows.type;
    gl.shadowMap.needsUpdate = true;
  }, [exposure, gl, shadows.enabled, shadows.type]);

  return null;
}

function PhysicsBudgetApplier({ maxVisualQueriesPerFrame }: { maxVisualQueriesPerFrame: number }) {
  useEffect(() => {
    configureVisualPhysicsQueryBudget(maxVisualQueriesPerFrame);
  }, [maxVisualQueriesPerFrame]);

  return null;
}

function SceneReadySignal({
  onReady,
  ready,
  readyKey,
}: {
  onReady?: () => void;
  ready: boolean;
  readyKey: string;
}) {
  const didSignalRef = useRef<string | null>(null);

  useEffect(() => {
    if (!onReady || !ready || didSignalRef.current === readyKey) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        didSignalRef.current = readyKey;
        onReady();
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [onReady, ready, readyKey]);

  return null;
}

const GPU_WARMUP_RENDER_FRAMES = 4;
const GPU_WARMUP_TIMEOUT_MS = 2200;

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function collectMaterialTextures(material: THREE.Material): THREE.Texture[] {
  const textures: THREE.Texture[] = [];
  const materialRecord = material as unknown as Record<string, unknown>;

  for (const value of Object.values(materialRecord)) {
    if (value && typeof value === 'object' && 'isTexture' in value && (value as THREE.Texture).isTexture) {
      textures.push(value as THREE.Texture);
    }
  }

  return textures;
}

function collectSceneTextures(scene: THREE.Scene): THREE.Texture[] {
  const textures = new Set<THREE.Texture>();

  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    for (const material of materials) {
      for (const texture of collectMaterialTextures(material)) {
        textures.add(texture);
      }
    }
  });

  return Array.from(textures);
}

function SceneGpuWarmup({
  enabled,
  warmupKey,
  shadowsEnabled,
  reflectionsEnabled,
  onStageDone,
  onComplete,
  onFallback,
}: {
  enabled: boolean;
  warmupKey: string;
  shadowsEnabled: boolean;
  reflectionsEnabled: boolean;
  onStageDone: (stage: MapWarmupStageId, durationMs: number) => void;
  onComplete: () => void;
  onFallback: (reason: string) => void;
}) {
  const { gl, scene, camera } = useThree();
  const completedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || completedKeyRef.current === warmupKey) return;

    let cancelled = false;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      completedKeyRef.current = warmupKey;
      onFallback('gpu-warmup-timeout');
    }, GPU_WARMUP_TIMEOUT_MS);

    const runWarmup = async () => {
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      if (cancelled || timedOut) return;

      const textureUploadStart = performance.now();
      const rendererWithTextureInit = gl as THREE.WebGLRenderer & {
        initTexture?: (texture: THREE.Texture) => void;
      };
      for (const texture of collectSceneTextures(scene)) {
        try {
          rendererWithTextureInit.initTexture?.(texture);
        } catch {
          texture.needsUpdate = true;
        }
      }
      const textureUploadMs = performance.now() - textureUploadStart;
      onStageDone('textures', textureUploadMs);

      const compileStart = performance.now();
      gl.compile(scene, camera);
      const compileMs = performance.now() - compileStart;
      onStageDone('shaders', compileMs);

      const shadowReflectionStart = performance.now();
      if (shadowsEnabled) {
        gl.shadowMap.needsUpdate = true;
      }
      if (shadowsEnabled || reflectionsEnabled) {
        gl.render(scene, camera);
      }
      const shadowReflectionMs = performance.now() - shadowReflectionStart;
      onStageDone('shadowsReflections', shadowReflectionMs);

      const gameplayObjectStart = performance.now();
      await waitForAnimationFrame();
      const gameplayObjectMs = performance.now() - gameplayObjectStart;
      onStageDone('gameplayObjects', gameplayObjectMs);

      for (let frame = 0; frame < GPU_WARMUP_RENDER_FRAMES; frame++) {
        await waitForAnimationFrame();
        if (cancelled || timedOut) return;
        gl.render(scene, camera);
      }

      if (cancelled || timedOut) return;
      completedKeyRef.current = warmupKey;
      onComplete();
    };

    runWarmup().catch((error) => {
      if (!cancelled && !timedOut) {
        console.warn('[MapWarmup] GPU warmup failed', error);
        completedKeyRef.current = warmupKey;
        onFallback('gpu-warmup-error');
      }
    }).finally(() => {
      window.clearTimeout(timeoutId);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    camera,
    enabled,
    gl,
    onComplete,
    onFallback,
    onStageDone,
    reflectionsEnabled,
    scene,
    shadowsEnabled,
    warmupKey,
  ]);

  return null;
}

function WarmupSettlingFrames({
  enabled,
  onFrame,
}: {
  enabled: boolean;
  onFrame: () => void;
}) {
  useFrame(() => {
    if (enabled) onFrame();
  });

  return null;
}

const FEATURE_QUALITY_STEPS = ['off', 'minimum', 'low', 'medium', 'high', 'ultra'] as const;
const RESOLUTION_QUALITY_STEPS = ['minimum', 'low', 'medium', 'high', 'ultra'] as const;
const MATERIAL_QUALITY_STEPS = ['low', 'medium', 'high'] as const;

function stepDown<T extends string>(value: T, steps: readonly T[]): T {
  const index = steps.indexOf(value);
  return steps[Math.max(0, index - 1)] ?? value;
}

function AdaptiveQualityController() {
  const settings = useSettingsStore(state => state.settings);
  const accumulatorRef = useRef(0);
  const overBudgetSecondsRef = useRef(0);
  const frameHistogramRef = useRef(new FrameTimeHistogram());

  useFrame((_, delta) => {
    if (!settings.adaptiveQuality) {
      accumulatorRef.current = 0;
      overBudgetSecondsRef.current = 0;
      frameHistogramRef.current.reset();
      return;
    }

    frameHistogramRef.current.record(delta * 1000);

    accumulatorRef.current += delta;
    if (accumulatorRef.current < 2) return;
    accumulatorRef.current = 0;

    const p95 = frameHistogramRef.current.percentile(0.95);
    frameHistogramRef.current.reset();
    if (p95 < 22) {
      overBudgetSecondsRef.current = Math.max(0, overBudgetSecondsRef.current - 2);
      return;
    }

    overBudgetSecondsRef.current += 2;
    if (overBudgetSecondsRef.current < 6) return;
    overBudgetSecondsRef.current = 0;

    const nextSettings = {
      ...settings,
      reflectionQuality: stepDown(settings.reflectionQuality, FEATURE_QUALITY_STEPS),
      environmentQuality: stepDown(settings.environmentQuality, FEATURE_QUALITY_STEPS),
      shadowQuality: stepDown(settings.shadowQuality, FEATURE_QUALITY_STEPS),
      resolutionScale: stepDown(settings.resolutionScale, RESOLUTION_QUALITY_STEPS),
      materialQuality: stepDown(settings.materialQuality, MATERIAL_QUALITY_STEPS),
    };

    const shouldEnterPotato =
      nextSettings.reflectionQuality === 'off' &&
      nextSettings.environmentQuality === 'off' &&
      nextSettings.shadowQuality === 'off' &&
      nextSettings.resolutionScale === 'minimum' &&
      nextSettings.materialQuality === 'low' &&
      settings.graphicsPreset !== 'potato';

    if (shouldEnterPotato) {
      useSettingsStore.getState().applySettings({
        ...settings,
        graphicsPreset: 'potato',
        ...graphicsPresetSettings.potato,
      });
      return;
    }

    if (
      nextSettings.reflectionQuality !== settings.reflectionQuality ||
      nextSettings.environmentQuality !== settings.environmentQuality ||
      nextSettings.shadowQuality !== settings.shadowQuality ||
      nextSettings.resolutionScale !== settings.resolutionScale ||
      nextSettings.materialQuality !== settings.materialQuality
    ) {
      useSettingsStore.getState().applySettings(nextSettings);
    }
  });

  return null;
}

function ReflectionEnvironment({
  theme,
  config,
}: {
  theme: ReturnType<typeof getVoxelMapTheme>;
  config: ReflectionQualityConfig;
}) {
  const sunColor = useMemo(
    () => new THREE.Color(theme.sunColor).lerp(new THREE.Color('#ffffff'), theme.id === 'basalt' ? 0.25 : 0.1),
    [theme]
  );
  const groundColor = useMemo(
    () => new THREE.Color(theme.ground.stone).lerp(new THREE.Color(theme.structures.accent), 0.18),
    [theme]
  );

  if (!config.enabled) return null;

  return (
    <Environment
      background={false}
      frames={1}
      resolution={config.resolution}
      environmentIntensity={config.sceneIntensity}
    >
      <color attach="background" args={[theme.skyColor]} />
      <mesh frustumCulled={false}>
        <sphereGeometry args={[80, 32, 16]} />
        <meshBasicMaterial color={theme.skyColor} side={THREE.BackSide} />
      </mesh>
      <mesh position={[18, 24, -20]} frustumCulled={false}>
        <sphereGeometry args={[4, 24, 12]} />
        <meshBasicMaterial color={sunColor} toneMapped={false} />
      </mesh>
      <mesh position={[0, -18, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
        <circleGeometry args={[80, 32]} />
        <meshBasicMaterial color={groundColor} />
      </mesh>
    </Environment>
  );
}

interface GameCanvasProps {
  onReady?: () => void;
  onWarmupUpdate?: (snapshot: MapWarmupSnapshot) => void;
  startupRampActive?: boolean;
}

export function GameCanvas({
  onReady,
  onWarmupUpdate,
  startupRampActive = false,
}: GameCanvasProps) {
  const gamePhase = useGameStore((state) => state.gamePhase);
  const isPracticeMode = useGameStore((state) => state.isPracticeMode);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const settings = useSettingsStore(state => state.settings);
  const qualityConfig = getVisualQualityConfig(settings);
  const canvasAntialiasRef = useRef(qualityConfig.render.antialias);
  const warmupKey = useMemo(() => getMapPrepCacheKey({ seed: mapSeed }), [mapSeed]);
  const [warmupSnapshot, dispatchWarmup] = useReducer(
    reduceMapWarmup,
    createMapWarmupSnapshot(warmupKey, mapSeed)
  );
  const completedWarmupStagesRef = useRef<Set<MapWarmupStageId>>(new Set());
  const didStartGpuRef = useRef<string | null>(null);
  const mapTheme = useMemo(() => getVoxelMapTheme(mapSeed), [mapSeed]);
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  const isWorldReady = warmupSnapshot.key === warmupKey && warmupSnapshot.canAcceptInput;
  const shouldMountGameplayObjects = isPlaying || warmupSnapshot.canShowGameplayObjects;
  const effectiveEnvironmentConfig = startupRampActive
    ? {
      ...qualityConfig.environment,
      particleDensity: Math.min(qualityConfig.environment.particleDensity, 0.35),
      dustDevilDensity: 0,
      dressingDensity: Math.min(qualityConfig.environment.dressingDensity, 0.55),
      maxParticles: Math.min(qualityConfig.environment.maxParticles, 120),
    }
    : qualityConfig.environment;
  const effectiveEffectsConfig = startupRampActive
    ? {
      ...qualityConfig.effects,
      enableDecorativeLights: false,
      maxActiveParticles: Math.min(qualityConfig.effects.maxActiveParticles, 80),
      maxActiveTrails: Math.min(qualityConfig.effects.maxActiveTrails, 8),
    }
    : qualityConfig.effects;
  const effectiveDynamicLights = startupRampActive
    ? {
      maxDynamicLights: Math.min(qualityConfig.dynamicLights.maxDynamicLights, 2),
      staticAccentLights: false,
    }
    : qualityConfig.dynamicLights;
  const effectiveDressingShadows = startupRampActive ? false : qualityConfig.shadows.dressingShadows;

  const markWarmupStageDone = useCallback((stage: MapWarmupStageId, durationMs?: number) => {
    if (completedWarmupStagesRef.current.has(stage)) return;
    completedWarmupStagesRef.current.add(stage);
    dispatchWarmup({ type: 'stageDone', stage, durationMs });
  }, []);

  useEffect(() => {
    completedWarmupStagesRef.current = new Set();
    didStartGpuRef.current = null;
    dispatchWarmup({ type: 'startCpu', key: warmupKey, mapSeed });
    markWarmupStageDone('resources', 0);
  }, [mapSeed, markWarmupStageDone, warmupKey]);

  useEffect(() => {
    onWarmupUpdate?.(warmupSnapshot);
  }, [
    onWarmupUpdate,
    warmupSnapshot,
  ]);

  const handleVoxelWarmupStatus = useCallback((status: VoxelMapWarmupStatus) => {
    markWarmupStageDone('map', status.preparedMap.source === 'match' ? undefined : 0);

    if (status.collidersReady) {
      markWarmupStageDone('colliders');
    }

    if (status.terrainReady) {
      markWarmupStageDone('meshes');
    }

    if (status.ready && didStartGpuRef.current !== warmupKey) {
      didStartGpuRef.current = warmupKey;
      dispatchWarmup({ type: 'startGpu' });
    }
  }, [markWarmupStageDone, warmupKey]);

  const handleGpuStageDone = useCallback((stage: MapWarmupStageId, durationMs: number) => {
    markWarmupStageDone(stage, durationMs);
  }, [markWarmupStageDone]);

  const handleGpuWarmupComplete = useCallback(() => {
    dispatchWarmup({ type: 'gpuReady' });
  }, []);

  const handleGpuWarmupFallback = useCallback((reason: string) => {
    dispatchWarmup({ type: 'fallback', reason });
  }, []);

  const handleSettlingFrame = useCallback(() => {
    dispatchWarmup({ type: 'settlingFrame' });
  }, []);

  return (
    <Canvas
      shadows={qualityConfig.shadows.enabled}
      dpr={qualityConfig.render.dpr}
      camera={{ 
        fov: settings.fov,
        near: 0.1, 
        far: 1000,
        position: [0, 2, 10], // Start at a reasonable height
      }}
      gl={{ 
        antialias: canvasAntialiasRef.current,
        powerPreference: 'high-performance',
      }}
      onCreated={({ gl }) => {
        gl.setClearColor(new THREE.Color(mapTheme.skyColor), 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = qualityConfig.render.exposure;
        gl.shadowMap.enabled = qualityConfig.shadows.enabled;
        gl.shadowMap.type = qualityConfig.shadows.type;
        Promise.all([
          prewarmPhantomEffects(gl),
          prewarmBlazeEffects(gl),
        ]).catch((error) => {
          console.warn('[Effects] Prewarm failed', error);
        });
      }}
      style={{
        position: 'absolute',
        inset: 0,
        background: mapTheme.skyColor,
        display: 'block',
      }}
    >
      <Suspense fallback={null}>
        <CameraSettingsApplier fov={settings.fov} />
        <RendererSettingsApplier exposure={qualityConfig.render.exposure} shadows={qualityConfig.shadows} />
        <PhysicsBudgetApplier maxVisualQueriesPerFrame={qualityConfig.budgets.maxVisualPhysicsQueriesPerFrame} />
        <GameplayFrameSystems />
        <DynamicLightBudgetSystem maxLights={effectiveDynamicLights.maxDynamicLights} />
        <AdaptiveQualityController />
        <ReflectionEnvironment theme={mapTheme} config={qualityConfig.reflections} />
        <WorldAtmosphere theme={mapTheme} seed={mapSeed} config={effectiveEnvironmentConfig} />

        {/* Lighting follows the generated map theme. */}
        <ambientLight intensity={0.42} color={mapTheme.ambientColor} />
        <hemisphereLight args={[mapTheme.skyColor, mapTheme.ground.side, 1.65]} />
        <directionalLight
          position={[58, 105, 34]}
          intensity={4.85}
          color={mapTheme.sunColor}
          castShadow={qualityConfig.shadows.enabled}
          shadow-mapSize={[qualityConfig.shadows.mapSize, qualityConfig.shadows.mapSize]}
          shadow-camera-far={qualityConfig.shadows.far}
          shadow-camera-left={-qualityConfig.shadows.volume}
          shadow-camera-right={qualityConfig.shadows.volume}
          shadow-camera-top={qualityConfig.shadows.volume}
          shadow-camera-bottom={-qualityConfig.shadows.volume}
          shadow-bias={-0.00018}
          shadow-normalBias={0.045}
        />
        <directionalLight
          position={[-60, 36, -70]}
          intensity={0.75}
          color={mapTheme.structures.glass}
        />
        {effectiveDynamicLights.staticAccentLights && (
          <>
            <BudgetedPointLight budgetPriority={0.35} position={[0, 12, 0]} intensity={42} color={mapTheme.structures.accent} distance={72} decay={2} />
            <BudgetedPointLight budgetPriority={0.3} position={[-40, 10, 0]} intensity={38} color="#ff5f46" distance={30} decay={2} />
            <BudgetedPointLight budgetPriority={0.3} position={[40, 10, 0]} intensity={38} color="#4a9cff" distance={30} decay={2} />
          </>
        )}

        {/* World */}
        <VoxelWorld
          shadowsEnabled={qualityConfig.shadows.enabled}
          dressingShadows={effectiveDressingShadows}
          dressingDensity={effectiveEnvironmentConfig.dressingDensity}
          reflectionIntensity={qualityConfig.reflections.materialIntensity}
          materialDetail={qualityConfig.render.materialDetail}
          performanceBudget={qualityConfig.budgets}
          prebuildRegions
          onWarmupStatus={handleVoxelWarmupStatus}
        />

        {/* Physics boots immediately; player input/simulation waits for terrain readiness. */}
        <PlayerController enabled={isWorldReady} />
        
        {/* Other players - always rendered so players can see each other in lobby */}
        <OtherPlayers config={qualityConfig.remotePlayers} />
        
        {/* Gameplay objects mount during warmup so first-use shaders and buffers are paid before input. */}
        {shouldMountGameplayObjects && (
          <>
            {!isPracticeMode && <Flags />}
            <Effects />
            <SlideSpeedLines config={effectiveEffectsConfig} />
            <HeroViewmodel config={qualityConfig.viewmodel} />
            <VoidZonesManager />
            <DireBallsManager />
            <PhantomPersonalShieldsManager />
            <VoidRaysManager />
            <PhantomEffectsManager />
            <ObservedAbilityCastEffectsManager />
            <BlazeEffectsManager />
            <HookshotEffectsManager />
            <ChronosAscendantManager />
            <ChronosAegisManager />
            <ChronosPulsesManager />
            <ChronosTimebreakManager />
            <TerrainImpactEffectsManager config={effectiveEffectsConfig} />
          </>
        )}

        <SceneGpuWarmup
          enabled={warmupSnapshot.state === 'preparingGpu'}
          warmupKey={warmupKey}
          shadowsEnabled={qualityConfig.shadows.enabled}
          reflectionsEnabled={qualityConfig.reflections.enabled}
          onStageDone={handleGpuStageDone}
          onComplete={handleGpuWarmupComplete}
          onFallback={handleGpuWarmupFallback}
        />
        <WarmupSettlingFrames
          enabled={warmupSnapshot.state === 'settling'}
          onFrame={handleSettlingFrame}
        />

        {/* Orbit controls when not playing for looking around */}
        {!isPlaying && <OrbitControls target={[0, 0, 0]} enablePan={false} />}

        <fogExp2 attach="fog" args={[mapTheme.fogColor, 0.0062]} />
        <color attach="background" args={[mapTheme.skyColor]} />
        <SceneReadySignal onReady={onReady} ready={isWorldReady} readyKey={warmupKey} />
      </Suspense>
    </Canvas>
  );
}
