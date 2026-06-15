import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { Environment, OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { getVoxelMapTheme } from '@voxel-strike/shared';
import { VoxelWorld } from './VoxelWorld';
import type { VoxelMapWarmupStatus } from './procedural/VoxelMap';
import { WorldAtmosphere } from './WorldAtmosphere';
import { PlayerController } from './PlayerController';
import { ObserverCameraController } from './ObserverCameraController';
import { OtherPlayers } from './OtherPlayers';
import { RagdollManager } from './RagdollManager';
import { Flags } from './Flags';
import { Effects } from './Effects';
import { HeroViewmodel } from './HeroViewmodel';
import { VoidZonesManager, DireBallsManager, VoidRaysManager, PhantomPersonalShieldsManager } from './phantom';
import { PhantomEffectsManager } from './PhantomEffects';
import { ObservedAbilityCastEffectsManager } from './ObservedAbilityCastEffects';
import { BlazeEffectsManager } from './BlazeEffects';
import { HookshotEffectsManager } from './HookshotEffects';
import { TerrainImpactEffectsManager } from './TerrainImpactEffects';
import { ChronosAegisManager, ChronosAscendantManager, ChronosPulsesManager, ChronosTimebreakManager } from './chronos';
import { GameplayFrameSystems, GameplayFrameWorkBoundary } from './systems/GameplayFrameSystems';
import { BudgetedPointLight, DynamicLightBudgetSystem } from './systems/DynamicLightBudget';
import { CombatTextLayer } from './CombatText';
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
import { getBlazeGearstormSkyIntensity } from './blaze/airstrike';
import { getPhantomVeilSkyIntensity } from './phantom/veilAtmosphere';
import { suppressExpectedContextLossLog } from './webglLifecycle';

const BLAZE_BACKGROUND_COLOR = new THREE.Color('#4a150c');
const BLAZE_FOG_COLOR = new THREE.Color('#651b0e');
const BLAZE_AMBIENT_COLOR = new THREE.Color('#ff8a35');
const BLAZE_HEMISPHERE_SKY_COLOR = new THREE.Color('#ff6a1f');
const BLAZE_HEMISPHERE_GROUND_COLOR = new THREE.Color('#541108');
const BLAZE_SUN_LIGHT_COLOR = new THREE.Color('#ffb14a');
const BLAZE_RIM_LIGHT_COLOR = new THREE.Color('#ff4020');
const PHANTOM_NIGHT_BACKGROUND_COLOR = new THREE.Color('#03000d');
const PHANTOM_NIGHT_FOG_COLOR = new THREE.Color('#170a2a');
const PHANTOM_NIGHT_AMBIENT_COLOR = new THREE.Color('#3f3751');
const PHANTOM_NIGHT_HEMISPHERE_SKY_COLOR = new THREE.Color('#3b1c64');
const PHANTOM_NIGHT_HEMISPHERE_GROUND_COLOR = new THREE.Color('#171120');
const PHANTOM_NIGHT_SUN_COLOR = new THREE.Color('#8f83c9');
const PHANTOM_NIGHT_RIM_COLOR = new THREE.Color('#a78bfa');

type GameMapTheme = ReturnType<typeof getVoxelMapTheme>;

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

function SceneAtmosphereColors({ theme }: { theme: GameMapTheme }) {
  const { gl, scene } = useThree();
  const fogRef = useRef<THREE.FogExp2>(null);
  const backgroundColorRef = useRef(new THREE.Color(theme.skyColor));
  const baseSkyColor = useMemo(() => new THREE.Color(theme.skyColor), [theme]);
  const baseFogColor = useMemo(() => new THREE.Color(theme.fogColor), [theme]);
  const fireBackgroundColor = useMemo(
    () => new THREE.Color(theme.skyColor).lerp(BLAZE_BACKGROUND_COLOR, 0.82),
    [theme]
  );
  const fireFogColor = useMemo(
    () => new THREE.Color(theme.fogColor).lerp(BLAZE_FOG_COLOR, 0.76),
    [theme]
  );

  useEffect(() => {
    backgroundColorRef.current.copy(baseSkyColor);
    scene.background = backgroundColorRef.current;
    gl.setClearColor(backgroundColorRef.current, 1);

    if (fogRef.current) {
      fogRef.current.color.copy(baseFogColor);
      fogRef.current.density = 0.0062;
    }
  }, [baseFogColor, baseSkyColor, gl, scene]);

  useFrame(({ clock }) => {
    const fireIntensity = getBlazeGearstormSkyIntensity();
    const phantomIntensity = getPhantomVeilSkyIntensity();
    const shimmer = fireIntensity * (0.95 + Math.sin(clock.elapsedTime * 5.2) * 0.05);

    backgroundColorRef.current
      .copy(baseSkyColor)
      .lerp(fireBackgroundColor, shimmer)
      .lerp(PHANTOM_NIGHT_BACKGROUND_COLOR, phantomIntensity);
    scene.background = backgroundColorRef.current;
    gl.setClearColor(backgroundColorRef.current, 1);

    if (fogRef.current) {
      fogRef.current.color
        .copy(baseFogColor)
        .lerp(fireFogColor, fireIntensity)
        .lerp(PHANTOM_NIGHT_FOG_COLOR, phantomIntensity);
      fogRef.current.density = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(0.0062, 0.009, fireIntensity),
        0.0074,
        phantomIntensity
      );
    }
  });

  return <fogExp2 ref={fogRef} attach="fog" args={[theme.fogColor, 0.0062]} />;
}

function ThemedWorldLighting({
  shadows,
  theme,
}: {
  shadows: ShadowQualityConfig;
  theme: GameMapTheme;
}) {
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);
  const baseAmbientColor = useMemo(() => new THREE.Color(theme.ambientColor), [theme]);
  const baseSkyColor = useMemo(() => new THREE.Color(theme.skyColor), [theme]);
  const baseGroundColor = useMemo(() => new THREE.Color(theme.ground.side), [theme]);
  const baseSunColor = useMemo(() => new THREE.Color(theme.sunColor), [theme]);
  const baseRimColor = useMemo(() => new THREE.Color(theme.structures.glass), [theme]);
  const baseLightLevels = useMemo(() => theme.id === 'golden'
    ? { ambient: 0.5, hemisphere: 1.95, sun: 5.7, rim: 1.05 }
    : { ambient: 0.42, hemisphere: 1.65, sun: 4.85, rim: 0.75 },
  [theme.id]);
  const fireAmbientColor = useMemo(
    () => new THREE.Color(theme.ambientColor).lerp(BLAZE_AMBIENT_COLOR, 0.72),
    [theme]
  );
  const fireSkyColor = useMemo(
    () => new THREE.Color(theme.skyColor).lerp(BLAZE_HEMISPHERE_SKY_COLOR, 0.82),
    [theme]
  );
  const fireGroundColor = useMemo(
    () => new THREE.Color(theme.ground.side).lerp(BLAZE_HEMISPHERE_GROUND_COLOR, 0.7),
    [theme]
  );
  const fireSunColor = useMemo(
    () => new THREE.Color(theme.sunColor).lerp(BLAZE_SUN_LIGHT_COLOR, 0.86),
    [theme]
  );
  const fireRimColor = useMemo(
    () => new THREE.Color(theme.structures.glass).lerp(BLAZE_RIM_LIGHT_COLOR, 0.78),
    [theme]
  );

  useFrame(({ clock }) => {
    const fireIntensity = getBlazeGearstormSkyIntensity();
    const phantomIntensity = getPhantomVeilSkyIntensity();
    const pulse = fireIntensity * (0.9 + Math.sin(clock.elapsedTime * 7.1) * 0.1);

    if (ambientRef.current) {
      const fireAmbient = THREE.MathUtils.lerp(baseLightLevels.ambient, Math.max(baseLightLevels.ambient, 0.62), pulse);
      ambientRef.current.intensity = THREE.MathUtils.lerp(fireAmbient, 0.22, phantomIntensity);
      ambientRef.current.color
        .copy(baseAmbientColor)
        .lerp(fireAmbientColor, fireIntensity)
        .lerp(PHANTOM_NIGHT_AMBIENT_COLOR, phantomIntensity);
    }

    if (hemisphereRef.current) {
      const fireHemisphere = THREE.MathUtils.lerp(baseLightLevels.hemisphere, Math.max(baseLightLevels.hemisphere, 2.16), pulse);
      hemisphereRef.current.intensity = THREE.MathUtils.lerp(fireHemisphere, 0.56, phantomIntensity);
      hemisphereRef.current.color
        .copy(baseSkyColor)
        .lerp(fireSkyColor, fireIntensity)
        .lerp(PHANTOM_NIGHT_HEMISPHERE_SKY_COLOR, phantomIntensity);
      hemisphereRef.current.groundColor
        .copy(baseGroundColor)
        .lerp(fireGroundColor, fireIntensity)
        .lerp(PHANTOM_NIGHT_HEMISPHERE_GROUND_COLOR, phantomIntensity);
    }

    if (sunRef.current) {
      const fireSun = THREE.MathUtils.lerp(baseLightLevels.sun, Math.max(baseLightLevels.sun, 6.45), pulse);
      sunRef.current.intensity = THREE.MathUtils.lerp(fireSun, 0.72, phantomIntensity);
      sunRef.current.color
        .copy(baseSunColor)
        .lerp(fireSunColor, fireIntensity)
        .lerp(PHANTOM_NIGHT_SUN_COLOR, phantomIntensity);
    }

    if (rimRef.current) {
      const fireRim = THREE.MathUtils.lerp(baseLightLevels.rim, Math.max(baseLightLevels.rim, 1.25), pulse);
      rimRef.current.intensity = THREE.MathUtils.lerp(fireRim, 0.9, phantomIntensity);
      rimRef.current.color
        .copy(baseRimColor)
        .lerp(fireRimColor, fireIntensity)
        .lerp(PHANTOM_NIGHT_RIM_COLOR, phantomIntensity);
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={baseLightLevels.ambient} color={theme.ambientColor} />
      <hemisphereLight ref={hemisphereRef} args={[theme.skyColor, theme.ground.side, baseLightLevels.hemisphere]} />
      <directionalLight
        ref={sunRef}
        position={[58, 105, 34]}
        intensity={baseLightLevels.sun}
        color={theme.sunColor}
        castShadow={shadows.enabled}
        shadow-mapSize={[shadows.mapSize, shadows.mapSize]}
        shadow-camera-far={shadows.far}
        shadow-camera-left={-shadows.volume}
        shadow-camera-right={shadows.volume}
        shadow-camera-top={shadows.volume}
        shadow-camera-bottom={-shadows.volume}
        shadow-bias={-0.00018}
        shadow-normalBias={0.045}
      />
      <directionalLight
        ref={rimRef}
        position={[-60, 36, -70]}
        intensity={baseLightLevels.rim}
        color={theme.structures.glass}
      />
    </>
  );
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
const GPU_WARMUP_TIMEOUT_MS = 3600;
const WORLD_WARMUP_ROOT_NAME = 'procedural-voxel-map';
const WORLD_WARMUP_MIN_RADIUS = 48;

type AsyncCompileRenderer = THREE.WebGLRenderer & {
  compileAsync?: (
    scene: THREE.Object3D,
    camera: THREE.Camera,
    targetScene?: THREE.Scene | null
  ) => Promise<unknown>;
};

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

async function compileSceneShaders(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): Promise<void> {
  const rendererWithAsyncCompile = renderer as AsyncCompileRenderer;
  if (typeof rendererWithAsyncCompile.compileAsync === 'function') {
    await rendererWithAsyncCompile.compileAsync(scene, camera);
    return;
  }

  renderer.compile(scene, camera);
}

function uploadTextures(renderer: THREE.WebGLRenderer, textures: THREE.Texture[]): void {
  const rendererWithTextureInit = renderer as THREE.WebGLRenderer & {
    initTexture?: (texture: THREE.Texture) => void;
  };

  for (const texture of textures) {
    try {
      rendererWithTextureInit.initTexture?.(texture);
    } catch {
      texture.needsUpdate = true;
    }
  }
}

interface WarmupRenderPass {
  scene: THREE.Scene;
  camera: THREE.Camera;
}

function renderScenesToWarmupTarget(
  renderer: THREE.WebGLRenderer,
  passes: WarmupRenderPass[]
): void {
  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  const warmupTarget = new THREE.WebGLRenderTarget(1, 1, {
    depthBuffer: true,
    stencilBuffer: false,
  });

  try {
    renderer.setRenderTarget(warmupTarget);
    renderer.autoClear = true;

    for (const { scene, camera } of passes) {
      renderer.clear();
      renderer.render(scene, camera);
    }
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    warmupTarget.dispose();
  }
}

function renderSceneToWarmupTarget(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera
): void {
  renderScenesToWarmupTarget(renderer, [{ scene, camera }]);
}

interface WorldWarmupBounds {
  center: THREE.Vector3;
  height: number;
  radius: number;
}

function getWorldWarmupBounds(scene: THREE.Scene): WorldWarmupBounds | null {
  const mapRoot = scene.getObjectByName(WORLD_WARMUP_ROOT_NAME);
  if (!mapRoot) return null;

  mapRoot.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(mapRoot);
  if (box.isEmpty()) return null;

  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);

  return {
    center,
    height: Math.max(24, size.y + 16),
    radius: Math.max(WORLD_WARMUP_MIN_RADIUS, Math.max(size.x, size.z) * 0.58 + 12),
  };
}

function createWorldWarmupCameras(bounds: WorldWarmupBounds): THREE.Camera[] {
  const { center, height, radius } = bounds;
  const far = Math.max(180, radius * 4 + height);
  const topCamera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.1, far);
  topCamera.position.set(center.x, center.y + radius * 1.8 + height, center.z);
  topCamera.up.set(0, 0, -1);
  topCamera.lookAt(center);
  topCamera.updateProjectionMatrix();
  topCamera.updateMatrixWorld();

  const createDiagonalCamera = (xSign: number, zSign: number): THREE.PerspectiveCamera => {
    const camera = new THREE.PerspectiveCamera(72, 1, 0.1, far);
    camera.position.set(
      center.x + radius * 0.95 * xSign,
      center.y + Math.max(28, radius * 0.48),
      center.z + radius * 0.95 * zSign
    );
    camera.lookAt(center.x, center.y + Math.min(10, height * 0.25), center.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return camera;
  };

  return [
    topCamera,
    createDiagonalCamera(1, 1),
    createDiagonalCamera(-1, -1),
  ];
}

function renderWorldWarmupViews(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
  const bounds = getWorldWarmupBounds(scene);
  if (!bounds) return;

  renderScenesToWarmupTarget(
    renderer,
    createWorldWarmupCameras(bounds).map((camera) => ({ scene, camera }))
  );
}

function addTextureValue(value: unknown, textures: Set<THREE.Texture>): void {
  if (value && typeof value === 'object' && 'isTexture' in value && (value as THREE.Texture).isTexture) {
    textures.add(value as THREE.Texture);
  }
}

function collectMaterialTextures(material: THREE.Material): THREE.Texture[] {
  const textures = new Set<THREE.Texture>();
  const materialRecord = material as unknown as Record<string, unknown>;

  for (const value of Object.values(materialRecord)) {
    addTextureValue(value, textures);
  }

  const shaderUniforms = (material as THREE.ShaderMaterial).uniforms;
  if (shaderUniforms) {
    for (const uniform of Object.values(shaderUniforms)) {
      addTextureValue(uniform.value, textures);
    }
  }

  return Array.from(textures);
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

      let gameplayEffectGpuPrewarmBundle: { scene: THREE.Scene; camera: THREE.Camera } | null = null;
      try {
        const {
          getGameplayEffectGpuPrewarmBundle,
          prewarmGameplayEffectResources,
        } = await import('./effectPrewarm');
        await prewarmGameplayEffectResources();
        gameplayEffectGpuPrewarmBundle = getGameplayEffectGpuPrewarmBundle();
      } catch (error) {
        console.warn('[MapWarmup] Gameplay effect prewarm setup failed', error);
      }
      if (cancelled || timedOut) return;

      const textureUploadStart = performance.now();
      uploadTextures(gl, collectSceneTextures(scene));
      if (gameplayEffectGpuPrewarmBundle) {
        uploadTextures(gl, collectSceneTextures(gameplayEffectGpuPrewarmBundle.scene));
      }
      const textureUploadMs = performance.now() - textureUploadStart;
      onStageDone('textures', textureUploadMs);

      const compileStart = performance.now();
      await compileSceneShaders(gl, scene, camera);
      if (gameplayEffectGpuPrewarmBundle) {
        await compileSceneShaders(
          gl,
          gameplayEffectGpuPrewarmBundle.scene,
          gameplayEffectGpuPrewarmBundle.camera
        );
      }
      if (cancelled || timedOut) return;
      const compileMs = performance.now() - compileStart;
      onStageDone('shaders', compileMs);

      const shadowReflectionStart = performance.now();
      if (shadowsEnabled) {
        gl.shadowMap.needsUpdate = true;
      }
      if (shadowsEnabled || reflectionsEnabled) {
        gl.render(scene, camera);
      }
      renderWorldWarmupViews(gl, scene);
      const shadowReflectionMs = performance.now() - shadowReflectionStart;
      onStageDone('shadowsReflections', shadowReflectionMs);

      const gameplayObjectStart = performance.now();
      if (gameplayEffectGpuPrewarmBundle) {
        renderSceneToWarmupTarget(
          gl,
          gameplayEffectGpuPrewarmBundle.scene,
          gameplayEffectGpuPrewarmBundle.camera
        );
      }
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
      materialQuality: stepDown(settings.materialQuality, FEATURE_QUALITY_STEPS),
      shadowQuality: stepDown(settings.shadowQuality, FEATURE_QUALITY_STEPS),
      resolutionScale: stepDown(settings.resolutionScale, RESOLUTION_QUALITY_STEPS),
    };

    const shouldEnterPotato =
      nextSettings.reflectionQuality === 'off' &&
      nextSettings.environmentQuality === 'off' &&
      nextSettings.materialQuality === 'off' &&
      nextSettings.shadowQuality === 'off' &&
      nextSettings.resolutionScale === 'minimum' &&
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
      nextSettings.materialQuality !== settings.materialQuality ||
      nextSettings.shadowQuality !== settings.shadowQuality ||
      nextSettings.resolutionScale !== settings.resolutionScale
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
  const isObserverMode = useGameStore((state) => state.isObserverMode);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const settings = useSettingsStore(state => state.settings);
  const qualityConfig = useMemo(() => getVisualQualityConfig(settings), [settings]);
  const canvasAntialiasRef = useRef(qualityConfig.render.antialias);
  const warmupKey = useMemo(() => getMapPrepCacheKey({ seed: mapSeed, themeId: mapThemeId }), [mapSeed, mapThemeId]);
  const [warmupSnapshot, dispatchWarmup] = useReducer(
    reduceMapWarmup,
    createMapWarmupSnapshot(warmupKey, mapSeed)
  );
  const completedWarmupStagesRef = useRef<Set<MapWarmupStageId>>(new Set());
  const didStartGpuRef = useRef<string | null>(null);
  const mapTheme = useMemo(() => getVoxelMapTheme(mapSeed, mapThemeId), [mapSeed, mapThemeId]);
  const gridCellColor = useMemo(
    () => new THREE.Color(mapTheme.ground.stone).lerp(new THREE.Color(mapTheme.fogColor), 0.28).getStyle(),
    [mapTheme]
  );
  const gridSectionColor = useMemo(
    () => new THREE.Color(mapTheme.structures.accent).lerp(new THREE.Color('#ffffff'), 0.18).getStyle(),
    [mapTheme]
  );
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  const isWorldReady = warmupSnapshot.key === warmupKey && warmupSnapshot.canAcceptInput;
  const shouldMountGameplayObjects = isPlaying || warmupSnapshot.canShowGameplayObjects;
  const effectiveEnvironmentConfig = useMemo(
    () => startupRampActive
      ? {
        ...qualityConfig.environment,
        particleDensity: Math.min(qualityConfig.environment.particleDensity, 0.35),
        dustDevilDensity: 0,
        dressingDensity: Math.min(qualityConfig.environment.dressingDensity, 0.55),
        maxParticles: Math.min(qualityConfig.environment.maxParticles, 120),
      }
      : qualityConfig.environment,
    [qualityConfig.environment, startupRampActive]
  );
  const effectiveEffectsConfig = useMemo(
    () => startupRampActive
      ? {
        ...qualityConfig.effects,
        enableDecorativeLights: false,
        maxActiveParticles: Math.min(qualityConfig.effects.maxActiveParticles, 80),
        maxActiveTrails: Math.min(qualityConfig.effects.maxActiveTrails, 8),
      }
      : qualityConfig.effects,
    [qualityConfig.effects, startupRampActive]
  );
  const effectiveDynamicLights = useMemo(
    () => startupRampActive
      ? {
        maxDynamicLights: Math.min(qualityConfig.dynamicLights.maxDynamicLights, 2),
        staticAccentLights: false,
      }
      : qualityConfig.dynamicLights,
    [qualityConfig.dynamicLights, startupRampActive]
  );
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
        suppressExpectedContextLossLog(gl);
        gl.setClearColor(new THREE.Color(mapTheme.skyColor), 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = qualityConfig.render.exposure;
        gl.shadowMap.enabled = qualityConfig.shadows.enabled;
        gl.shadowMap.type = qualityConfig.shadows.type;
        import('./effectPrewarm').then(({ prewarmGameplayEffectResources }) => (
          prewarmGameplayEffectResources()
        )).catch((error) => {
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

        {/* Lighting follows the generated map theme and leans fiery during Blaze's Gearstorm. */}
        <ThemedWorldLighting theme={mapTheme} shadows={qualityConfig.shadows} />
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
          materialQuality={qualityConfig.materials.terrainTextureQuality}
          performanceBudget={qualityConfig.budgets}
          themeId={mapThemeId}
          prebuildRegions
          onWarmupStatus={handleVoxelWarmupStatus}
        />

        {/* Grid helper for visibility */}
        <Grid
          args={[100, 100]}
          position={[0, 0.01, 0]}
          cellSize={2}
          cellThickness={0.22}
          cellColor={gridCellColor}
          sectionSize={10}
          sectionThickness={0.55}
          sectionColor={gridSectionColor}
          fadeDistance={78}
          fadeStrength={1.45}
          followCamera={false}
        />

        {/* Physics boots immediately; observer camera can fly while player simulation waits for terrain readiness. */}
        {isObserverMode ? (
          <ObserverCameraController enabled />
        ) : (
          <PlayerController enabled={isWorldReady} />
        )}
        
        {/* Other players - always rendered so players can see each other in lobby */}
        <OtherPlayers
          config={qualityConfig.remotePlayers}
          effectConfig={effectiveEffectsConfig}
          theme={mapTheme}
        />
        <RagdollManager config={qualityConfig.ragdolls} />
        
        {/* Gameplay objects mount during warmup so first-use shaders and buffers are paid before input. */}
        {shouldMountGameplayObjects && (
          <>
            {!isPracticeMode && <Flags />}
            <Effects />
            <CombatTextLayer enabled={settings.showDamageNumbers} />
            {!isObserverMode && <HeroViewmodel config={qualityConfig.viewmodel} />}
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
        {!isPlaying && !isObserverMode && <OrbitControls target={[0, 0, 0]} enablePan={false} />}

        <SceneAtmosphereColors theme={mapTheme} />
        <SceneReadySignal onReady={onReady} ready={isWorldReady} readyKey={warmupKey} />
        <GameplayFrameWorkBoundary />
      </Suspense>
    </Canvas>
  );
}
