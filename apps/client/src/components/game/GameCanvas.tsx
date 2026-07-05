import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Environment, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { createTutorialVoxelMapManifest, getVoxelMapTheme, isTutorialMapSeed } from '@voxel-strike/shared';
import { VoxelWorld } from './VoxelWorld';
import type { VoxelMapWarmupStatus } from './procedural/VoxelMap';
import { WorldAtmosphere } from './WorldAtmosphere';
import { PlayerController } from './PlayerController';
import { BattleRoyalTeamSpectatorCameraController } from './BattleRoyalTeamSpectatorCameraController';
import { StreamerCameraDirector } from './StreamerCameraDirector';
import { BattleRoyalDropDeployment } from './BattleRoyalDropDeployment';
import { BattleRoyalSafeZone } from './BattleRoyalSafeZone';
import { BattleRoyalSouls } from './BattleRoyalSouls';
import { TeamPings } from './TeamPings';
import { OtherPlayers } from './OtherPlayers';
import { RagdollManager } from './RagdollManager';
import { Flags } from './Flags';
import { Powerups } from './Powerups';
import { TutorialWorldPrompts } from './TutorialWorldPrompts';
import { TutorialTargetRange } from './TutorialTargetRange';
import { DevTestingMapRuntime } from './DevTestingMapRuntime';
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
import { useStreamerStore } from '../../store/streamerStore';
import { useRecordingPlaybackStore } from '../../store/recordingPlaybackStore';
import { getMapPrepCacheKey } from '../../utils/mapWarmup/mapPrepCacheKey';
import {
  createMapWarmupSnapshot,
  isMapWarmupReadyForMatchStart,
  reduceMapWarmup,
  type MapWarmupSnapshot,
  type MapWarmupStageId,
} from '../../utils/mapWarmup/mapWarmupCoordinator';
import {
  createBattleRoyalFlightVisibilityConfig,
  getVisualQualityConfig,
  DEFAULT_CAMERA_FAR,
  scaleBattleRoyalVisibilityConfig,
  type BattleRoyalVisibilityConfig,
  type EffectQualityConfig,
  type ReflectionQualityConfig,
  type RemotePlayerQualityConfig,
  type RagdollQualityConfig,
  type ShadowQualityConfig,
} from './visualQuality';
import { FrameTimeHistogram } from './adaptiveQualityHistogram';
import { recordRendererDiagnostics } from '../../movement/networkDiagnostics';
import { configureVisualPhysicsQueryBudget } from '../../hooks/usePhysics';
import { config } from '../../config/environment';
import { prewarmLocalMovementCollisionWorld } from '../../movement/localPrediction';
import { getBlazeGearstormSkyIntensity } from './blaze/airstrike';
import { getPhantomVeilSkyIntensity } from './phantom/veilAtmosphere';
import { suppressExpectedContextLossLog } from './webglLifecycle';
import { disposeSharedEffectResources } from './effectResources';

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
const DEFAULT_SCENE_FOG_DENSITY = 0.0062;
const ATMOSPHERE_FX_IDLE_EPSILON = 1e-4;

type GameMapTheme = ReturnType<typeof getVoxelMapTheme>;
const DEFAULT_REFLECTION_SUN_POSITION: [number, number, number] = [18, 24, -20];
const LATE_DAY_REFLECTION_SUN_POSITION: [number, number, number] = [-52, 13, -36];
const DEFAULT_WORLD_SUN_POSITION: [number, number, number] = [58, 105, 34];
const LATE_DAY_WORLD_SUN_POSITION: [number, number, number] = [-126, 34, -88];
const DEFAULT_WORLD_RIM_POSITION: [number, number, number] = [-60, 36, -70];
const LATE_DAY_WORLD_RIM_POSITION: [number, number, number] = [72, 42, 82];

function isLateDayTheme(theme: GameMapTheme): boolean {
  return theme.skyVariantId === 'late_day';
}

function CameraSettingsApplier({ far, fov }: { far: number; fov: number }) {
  const { camera } = useThree();

  useEffect(() => {
    if ('fov' in camera) {
      (camera as THREE.PerspectiveCamera).fov = fov;
      (camera as THREE.PerspectiveCamera).far = far;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
  }, [camera, far, fov]);

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

function useSmoothedNumber(target: number, smoothing: number): number {
  const [value, setValue] = useState(target);
  const valueRef = useRef(target);

  useEffect(() => {
    if (typeof window === 'undefined') {
      valueRef.current = target;
      setValue(target);
      return undefined;
    }

    let rafId = 0;
    let lastTime = performance.now();
    const tick = (time: number) => {
      const delta = Math.max(0, (time - lastTime) / 1000);
      lastTime = time;
      const current = valueRef.current;
      const alpha = 1 - Math.exp(-smoothing * delta);
      const next = Math.abs(current - target) < 0.001
        ? target
        : THREE.MathUtils.lerp(current, target, alpha);

      valueRef.current = next;
      setValue((previous) => Math.abs(previous - next) < 0.002 ? previous : next);

      if (next !== target) {
        rafId = window.requestAnimationFrame(tick);
      }
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [smoothing, target]);

  return value;
}

function SceneAtmosphereColors({
  fogDensity,
  theme,
}: {
  fogDensity: number;
  theme: GameMapTheme;
}) {
  const { gl, scene } = useThree();
  const fogRef = useRef<THREE.FogExp2>(null);
  const backgroundColorRef = useRef(new THREE.Color(theme.skyColor));
  const wasIdleRef = useRef(false);
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
      fogRef.current.density = fogDensity;
    }
  }, [baseFogColor, baseSkyColor, fogDensity, gl, scene]);

  useFrame(({ clock }) => {
    const fireIntensity = getBlazeGearstormSkyIntensity();
    const phantomIntensity = getPhantomVeilSkyIntensity();
    const isIdle =
      fireIntensity <= ATMOSPHERE_FX_IDLE_EPSILON && phantomIntensity <= ATMOSPHERE_FX_IDLE_EPSILON;
    if (isIdle && wasIdleRef.current) return;
    wasIdleRef.current = isIdle;
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
      const fireFogDensity = Math.max(fogDensity * 1.28, 0.009);
      const phantomFogDensity = Math.max(fogDensity * 1.08, 0.0074);
      fogRef.current.density = THREE.MathUtils.lerp(
        THREE.MathUtils.lerp(fogDensity, fireFogDensity, fireIntensity),
        phantomFogDensity,
        phantomIntensity
      );
    }
  });

  return <fogExp2 ref={fogRef} attach="fog" args={[theme.fogColor, fogDensity]} />;
}

function ThemedWorldLighting({
  shadows,
  theme,
}: {
  shadows: ShadowQualityConfig;
  theme: GameMapTheme;
}) {
  const lateDay = isLateDayTheme(theme);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemisphereRef = useRef<THREE.HemisphereLight>(null);
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const rimRef = useRef<THREE.DirectionalLight>(null);
  const wasIdleRef = useRef(false);
  const sunPosition = lateDay ? LATE_DAY_WORLD_SUN_POSITION : DEFAULT_WORLD_SUN_POSITION;
  const rimPosition = lateDay ? LATE_DAY_WORLD_RIM_POSITION : DEFAULT_WORLD_RIM_POSITION;
  const baseAmbientColor = useMemo(() => new THREE.Color(theme.ambientColor), [theme]);
  const baseSkyColor = useMemo(() => new THREE.Color(theme.skyColor), [theme]);
  const baseGroundColor = useMemo(() => new THREE.Color(theme.ground.side), [theme]);
  const baseSunColor = useMemo(() => new THREE.Color(theme.sunColor), [theme]);
  const baseRimColor = useMemo(() => new THREE.Color(theme.structures.glass), [theme]);
  const baseLightLevels = useMemo(() => {
    if (lateDay) return { ambient: 0.34, hemisphere: 1.42, sun: 5.55, rim: 1.18 };
    if (theme.id === 'golden') return { ambient: 0.5, hemisphere: 1.95, sun: 5.7, rim: 1.05 };
    return { ambient: 0.42, hemisphere: 1.65, sun: 4.85, rim: 0.75 };
  }, [lateDay, theme.id]);
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
    const isIdle =
      fireIntensity <= ATMOSPHERE_FX_IDLE_EPSILON && phantomIntensity <= ATMOSPHERE_FX_IDLE_EPSILON;
    if (isIdle && wasIdleRef.current) return;
    wasIdleRef.current = isIdle;
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
        position={sunPosition}
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
        shadow-normalBias={lateDay ? 0.06 : 0.045}
      />
      <directionalLight
        ref={rimRef}
        position={rimPosition}
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
const GPU_WARMUP_STALL_TIMEOUT_MS = 10_000;
const GPU_SETTLING_STALL_TIMEOUT_MS = 2_500;
const STREAMER_CPU_WARMUP_STALL_TIMEOUT_MS = 12_000;
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
          prewarmGameplayEffectResourcesOnce,
        } = await import('./effectPrewarm');
        await prewarmGameplayEffectResourcesOnce();
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

function formatTerrainWarmupDetail(status: VoxelMapWarmupStatus): string {
  const requiredRegions = Math.max(1, status.warmupRequiredRegionCount);
  const readyRegions = Math.min(requiredRegions, status.readyRegionCount);
  if (requiredRegions >= status.renderableRegionCount) {
    return `${readyRegions}/${requiredRegions} terrain regions`;
  }
  return `${readyRegions}/${requiredRegions} starter terrain regions`;
}

function RendererDiagnosticsRecorder() {
  const frameHistogramRef = useRef(new FrameTimeHistogram());
  const accumulatorRef = useRef(0);
  const sampleCountRef = useRef(0);
  const maxFrameMsRef = useRef(0);

  useFrame(({ gl }, delta) => {
    const frameMs = delta * 1000;
    frameHistogramRef.current.record(frameMs);
    maxFrameMsRef.current = Math.max(maxFrameMsRef.current, frameMs);
    sampleCountRef.current++;
    accumulatorRef.current += delta;

    if (accumulatorRef.current < 0.5) return;

    const sampleSeconds = accumulatorRef.current;
    recordRendererDiagnostics({
      fps: sampleCountRef.current / Math.max(0.001, sampleSeconds),
      frameP50Ms: frameHistogramRef.current.percentile(0.5),
      frameP95Ms: frameHistogramRef.current.percentile(0.95),
      frameMaxMs: maxFrameMsRef.current,
      drawCalls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      geometries: gl.info.memory.geometries,
      textures: gl.info.memory.textures,
    });

    accumulatorRef.current = 0;
    sampleCountRef.current = 0;
    maxFrameMsRef.current = 0;
    frameHistogramRef.current.reset();
  });

  return null;
}

const FEATURE_QUALITY_STEPS = ['off', 'minimum', 'low', 'medium', 'high', 'ultra'] as const;
const RESOLUTION_QUALITY_STEPS = ['minimum', 'low', 'medium', 'high', 'ultra'] as const;
const BR_TERRAIN_PRESSURE_CHECK_SECONDS = 2;
const BR_TERRAIN_PRESSURE_FRAME_P95_MS = 22;
const BR_TERRAIN_PRESSURE_RECOVERY_FRAME_P95_MS = 17;
const BR_TERRAIN_PRESSURE_HIGH_RATIO = 0.74;
const BR_TERRAIN_PRESSURE_RECOVERY_RATIO = 0.54;
const BR_TERRAIN_VISIBILITY_MIN_SCALE = 0.72;
const BR_TERRAIN_VISIBILITY_STEP_DOWN = 0.08;
const BR_TERRAIN_VISIBILITY_STEP_UP = 0.04;
const BR_COMBAT_PRESSURE_FRAME_P95_MS = 20;
const BR_COMBAT_PRESSURE_RECOVERY_FRAME_P95_MS = 16;
const BR_COMBAT_PRESSURE_RECOVERY_RATIO = 0.62;
const BR_COMBAT_PRESSURE_MIN_SCALE = 0.55;
const BR_COMBAT_PRESSURE_STEP_DOWN = 0.15;
const BR_COMBAT_PRESSURE_STEP_UP = 0.05;
const BR_REMOTE_FULL_BODY_COMBAT_CAP = 88;
const BR_REMOTE_OUTLINE_COMBAT_CAP = 112;
const BR_REMOTE_MIN_FULL_BODY_DISTANCE = 32;
const BR_REMOTE_MIN_OUTLINE_DISTANCE = 24;
const BR_RAGDOLL_COMBAT_TOTAL_CAP = 10;
const BR_RAGDOLL_HEAVY_COMBAT_TOTAL_CAP = 6;
const BR_RAGDOLL_COMBAT_HIGH_QUALITY_CAP = 3;
const BR_RAGDOLL_HEAVY_COMBAT_HIGH_QUALITY_CAP = 1;
function finiteDistanceOrCap(value: number, cap: number): number {
  return Number.isFinite(value) ? Math.min(value, cap) : cap;
}

function scaleBattleRoyalRemotePlayersForCombat(
  config: RemotePlayerQualityConfig,
  combatScale: number
): RemotePlayerQualityConfig {
  const scale = THREE.MathUtils.clamp(combatScale, BR_COMBAT_PRESSURE_MIN_SCALE, 1);
  if (scale >= 0.995) return config;

  const distanceScale = THREE.MathUtils.lerp(0.62, 1, scale);
  const scaledOutlineDistance = config.outlineDistance > 0
    ? Math.max(
      BR_REMOTE_MIN_OUTLINE_DISTANCE,
      finiteDistanceOrCap(config.outlineDistance, BR_REMOTE_OUTLINE_COMBAT_CAP) * distanceScale
    )
    : 0;

  return {
    ...config,
    showNameplates: config.showNameplates && scale > 0.68,
    nameplateDistance: config.nameplateDistance > 0
      ? Math.max(
        BR_REMOTE_MIN_FULL_BODY_DISTANCE,
        finiteDistanceOrCap(config.nameplateDistance, BR_REMOTE_FULL_BODY_COMBAT_CAP) * distanceScale
      )
      : 0,
    fullBodyDistance: Math.max(
      BR_REMOTE_MIN_FULL_BODY_DISTANCE,
      finiteDistanceOrCap(config.fullBodyDistance, BR_REMOTE_FULL_BODY_COMBAT_CAP) * distanceScale
    ),
    outlineDistance: scaledOutlineDistance,
    botFullBodyDistanceScale: Math.min(
      config.botFullBodyDistanceScale,
      THREE.MathUtils.lerp(0.48, 1, scale)
    ),
    botOutlineDistanceScale: Math.min(
      config.botOutlineDistanceScale,
      THREE.MathUtils.lerp(0.62, 1, scale)
    ),
    castShadows: config.castShadows && scale > 0.64,
  };
}

function scaleBattleRoyalEffectsForCombat(
  config: EffectQualityConfig,
  combatScale: number
): EffectQualityConfig {
  const scale = THREE.MathUtils.clamp(combatScale, BR_COMBAT_PRESSURE_MIN_SCALE, 1);
  if (scale >= 0.995) return config;

  const particleScale = THREE.MathUtils.lerp(0.45, 1, scale);
  return {
    ...config,
    maxActiveParticles: Math.max(48, Math.floor(config.maxActiveParticles * particleScale)),
    maxActiveTrails: Math.max(6, Math.floor(config.maxActiveTrails * particleScale)),
    maxVisibleRemoteAbilityEffects: Math.max(
      6,
      Math.floor(config.maxVisibleRemoteAbilityEffects * THREE.MathUtils.lerp(0.45, 1, scale))
    ),
    enableDecorativeLights: config.enableDecorativeLights && scale > 0.72,
    remoteMovementEffectDensityScale: Math.min(
      config.remoteMovementEffectDensityScale,
      THREE.MathUtils.lerp(0.35, 1, scale)
    ),
    remoteMovementEffectBotDistanceScale: Math.min(
      config.remoteMovementEffectBotDistanceScale,
      THREE.MathUtils.lerp(0.35, 1, scale)
    ),
  };
}

function scaleBattleRoyalDynamicLightsForCombat(
  config: ReturnType<typeof getVisualQualityConfig>['dynamicLights'],
  combatScale: number
): ReturnType<typeof getVisualQualityConfig>['dynamicLights'] {
  const scale = THREE.MathUtils.clamp(combatScale, BR_COMBAT_PRESSURE_MIN_SCALE, 1);
  if (scale >= 0.995) return config;

  let combatLightLimit = Math.max(2, Math.floor(config.maxDynamicLights * 0.5));
  if (scale <= 0.66) {
    combatLightLimit = 1;
  } else if (scale <= 0.82) {
    combatLightLimit = 2;
  }
  return {
    maxDynamicLights: Math.min(config.maxDynamicLights, combatLightLimit),
    staticAccentLights: config.staticAccentLights && scale > 0.82,
  };
}

function scaleBattleRoyalRagdollsForCombat(
  config: RagdollQualityConfig,
  combatScale: number
): RagdollQualityConfig {
  const scale = THREE.MathUtils.clamp(combatScale, BR_COMBAT_PRESSURE_MIN_SCALE, 1);
  if (scale >= 0.995) return config;

  const maxTotalCap = scale <= 0.66 ? BR_RAGDOLL_HEAVY_COMBAT_TOTAL_CAP : BR_RAGDOLL_COMBAT_TOTAL_CAP;
  const maxHighQualityCap = scale <= 0.66
    ? BR_RAGDOLL_HEAVY_COMBAT_HIGH_QUALITY_CAP
    : BR_RAGDOLL_COMBAT_HIGH_QUALITY_CAP;
  const maxTotal = Math.min(config.maxTotal, maxTotalCap);

  return {
    maxHighQuality: Math.min(config.maxHighQuality, maxHighQualityCap, maxTotal),
    maxTotal,
    castShadows: config.castShadows && scale > 0.74,
  };
}

function stepDown<T extends string>(value: T, steps: readonly T[]): T {
  const index = steps.indexOf(value);
  return steps[Math.max(0, index - 1)] ?? value;
}

function AdaptiveQualityController({
  battleRoyalCombatScale,
  battleRoyalTerrainScale,
  battleRoyalVisibility,
  isBattleRoyal,
  onBattleRoyalCombatScaleChange,
  onBattleRoyalTerrainScaleChange,
  performanceBudget,
}: {
  battleRoyalCombatScale: number;
  battleRoyalTerrainScale: number;
  battleRoyalVisibility?: BattleRoyalVisibilityConfig;
  isBattleRoyal: boolean;
  onBattleRoyalCombatScaleChange: (scale: number) => void;
  onBattleRoyalTerrainScaleChange: (scale: number) => void;
  performanceBudget: ReturnType<typeof getVisualQualityConfig>['budgets'];
}) {
  const settings = useSettingsStore(state => state.settings);
  const accumulatorRef = useRef(0);
  const overBudgetSecondsRef = useRef(0);
  const terrainPressureSecondsRef = useRef(0);
  const terrainRecoverySecondsRef = useRef(0);
  const combatPressureSecondsRef = useRef(0);
  const combatRecoverySecondsRef = useRef(0);
  const battleRoyalTerrainScaleRef = useRef(battleRoyalTerrainScale);
  const battleRoyalCombatScaleRef = useRef(battleRoyalCombatScale);
  const frameHistogramRef = useRef(new FrameTimeHistogram());

  useEffect(() => {
    battleRoyalTerrainScaleRef.current = battleRoyalTerrainScale;
  }, [battleRoyalTerrainScale]);

  useEffect(() => {
    battleRoyalCombatScaleRef.current = battleRoyalCombatScale;
  }, [battleRoyalCombatScale]);

  const setBattleRoyalTerrainScale = useCallback((nextScale: number) => {
    const clampedScale = THREE.MathUtils.clamp(nextScale, BR_TERRAIN_VISIBILITY_MIN_SCALE, 1);
    if (Math.abs(clampedScale - battleRoyalTerrainScaleRef.current) < 0.005) return;
    battleRoyalTerrainScaleRef.current = clampedScale;
    onBattleRoyalTerrainScaleChange(clampedScale);
  }, [onBattleRoyalTerrainScaleChange]);

  const setBattleRoyalCombatScale = useCallback((nextScale: number) => {
    const clampedScale = THREE.MathUtils.clamp(nextScale, BR_COMBAT_PRESSURE_MIN_SCALE, 1);
    if (Math.abs(clampedScale - battleRoyalCombatScaleRef.current) < 0.005) return;
    battleRoyalCombatScaleRef.current = clampedScale;
    onBattleRoyalCombatScaleChange(clampedScale);
  }, [onBattleRoyalCombatScaleChange]);

  useFrame(({ gl }, delta) => {
    if (!settings.adaptiveQuality) {
      accumulatorRef.current = 0;
      overBudgetSecondsRef.current = 0;
      terrainPressureSecondsRef.current = 0;
      terrainRecoverySecondsRef.current = 0;
      combatPressureSecondsRef.current = 0;
      combatRecoverySecondsRef.current = 0;
      frameHistogramRef.current.reset();
      setBattleRoyalTerrainScale(1);
      setBattleRoyalCombatScale(1);
      return;
    }

    frameHistogramRef.current.record(delta * 1000);

    accumulatorRef.current += delta;
    if (accumulatorRef.current < BR_TERRAIN_PRESSURE_CHECK_SECONDS) return;
    const sampleSeconds = accumulatorRef.current;
    accumulatorRef.current = 0;

    const p95 = frameHistogramRef.current.percentile(0.95);
    frameHistogramRef.current.reset();
    const drawCallRatio = gl.info.render.calls / Math.max(1, performanceBudget.drawCalls);
    const triangleRatio = gl.info.render.triangles / Math.max(1, performanceBudget.triangles);
    const renderPressureRatio = Math.max(drawCallRatio, triangleRatio);

    if (isBattleRoyal && battleRoyalVisibility) {
      const pressureHigh = p95 >= BR_TERRAIN_PRESSURE_FRAME_P95_MS &&
        renderPressureRatio >= BR_TERRAIN_PRESSURE_HIGH_RATIO;
      const canRecover = p95 <= BR_TERRAIN_PRESSURE_RECOVERY_FRAME_P95_MS &&
        renderPressureRatio <= BR_TERRAIN_PRESSURE_RECOVERY_RATIO;

      if (pressureHigh) {
        terrainPressureSecondsRef.current += sampleSeconds;
        terrainRecoverySecondsRef.current = 0;
        if (terrainPressureSecondsRef.current >= BR_TERRAIN_PRESSURE_CHECK_SECONDS * 2) {
          terrainPressureSecondsRef.current = 0;
          setBattleRoyalTerrainScale(battleRoyalTerrainScaleRef.current - BR_TERRAIN_VISIBILITY_STEP_DOWN);
        }
      } else if (canRecover) {
        terrainRecoverySecondsRef.current += sampleSeconds;
        terrainPressureSecondsRef.current = Math.max(0, terrainPressureSecondsRef.current - sampleSeconds);
        if (terrainRecoverySecondsRef.current >= BR_TERRAIN_PRESSURE_CHECK_SECONDS * 4) {
          terrainRecoverySecondsRef.current = 0;
          setBattleRoyalTerrainScale(battleRoyalTerrainScaleRef.current + BR_TERRAIN_VISIBILITY_STEP_UP);
        }
      } else {
        terrainPressureSecondsRef.current = Math.max(0, terrainPressureSecondsRef.current - sampleSeconds * 0.5);
        terrainRecoverySecondsRef.current = 0;
      }

      const combatPressureHigh = p95 >= BR_COMBAT_PRESSURE_FRAME_P95_MS;
      const combatCanRecover = p95 <= BR_COMBAT_PRESSURE_RECOVERY_FRAME_P95_MS &&
        renderPressureRatio <= BR_COMBAT_PRESSURE_RECOVERY_RATIO;

      if (combatPressureHigh) {
        combatPressureSecondsRef.current += sampleSeconds;
        combatRecoverySecondsRef.current = 0;
        if (combatPressureSecondsRef.current >= BR_TERRAIN_PRESSURE_CHECK_SECONDS) {
          combatPressureSecondsRef.current = 0;
          setBattleRoyalCombatScale(battleRoyalCombatScaleRef.current - BR_COMBAT_PRESSURE_STEP_DOWN);
        }
      } else if (combatCanRecover) {
        combatRecoverySecondsRef.current += sampleSeconds;
        combatPressureSecondsRef.current = Math.max(0, combatPressureSecondsRef.current - sampleSeconds);
        if (combatRecoverySecondsRef.current >= BR_TERRAIN_PRESSURE_CHECK_SECONDS * 4) {
          combatRecoverySecondsRef.current = 0;
          setBattleRoyalCombatScale(battleRoyalCombatScaleRef.current + BR_COMBAT_PRESSURE_STEP_UP);
        }
      } else {
        combatPressureSecondsRef.current = Math.max(0, combatPressureSecondsRef.current - sampleSeconds * 0.5);
        combatRecoverySecondsRef.current = 0;
      }
    } else {
      terrainPressureSecondsRef.current = 0;
      terrainRecoverySecondsRef.current = 0;
      combatPressureSecondsRef.current = 0;
      combatRecoverySecondsRef.current = 0;
      setBattleRoyalTerrainScale(1);
      setBattleRoyalCombatScale(1);
    }

    if (p95 < 22) {
      overBudgetSecondsRef.current = Math.max(0, overBudgetSecondsRef.current - sampleSeconds);
      return;
    }

    overBudgetSecondsRef.current += sampleSeconds;
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
  const lateDay = isLateDayTheme(theme);
  const reflectionSunPosition = lateDay ? LATE_DAY_REFLECTION_SUN_POSITION : DEFAULT_REFLECTION_SUN_POSITION;
  const sunColor = useMemo(
    () => new THREE.Color(theme.sunColor).lerp(new THREE.Color('#fff7df'), lateDay ? 0.04 : theme.id === 'basalt' ? 0.25 : 0.1),
    [lateDay, theme]
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
      <mesh position={reflectionSunPosition} frustumCulled={false}>
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
  onMatchStartReady?: () => void;
  onReady?: () => void;
  onWarmupUpdate?: (snapshot: MapWarmupSnapshot) => void;
  inputEnabled?: boolean;
  startupRampActive?: boolean;
}

export function GameCanvas({
  onMatchStartReady,
  onReady,
  onWarmupUpdate,
  inputEnabled = true,
  startupRampActive = false,
}: GameCanvasProps) {
  useEffect(() => () => {
    disposeSharedEffectResources();
  }, []);

  const gamePhase = useGameStore((state) => state.gamePhase);
  const isPracticeMode = useGameStore((state) => state.isPracticeMode);
  const isTutorialMode = useGameStore((state) => state.isTutorialMode);
  const gameplayMode = useGameStore((state) => state.gameplayMode);
  const localPlayerState = useGameStore((state) => state.localPlayer?.state ?? null);
  const isObserverMode = useGameStore((state) => state.localPlayer?.role === 'observer');
  const streamerIsActive = useStreamerStore((state) => state.isActive);
  const streamerHiddenPlayerId = useStreamerStore((state) => state.hiddenFirstPersonTargetId);
  const recordingPlaybackIsActive = useRecordingPlaybackStore((state) => state.isActive);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const mapThemeId = useGameStore((state) => state.mapThemeId);
  const mapSize = useGameStore((state) => state.mapSize);
  const mapProfileId = useGameStore((state) => state.mapProfileId);
  const pregeneratedMapId = useGameStore((state) => state.pregeneratedMapId);
  const settings = useSettingsStore(state => state.settings);
  const qualityConfig = useMemo(() => getVisualQualityConfig(settings), [settings]);
  const canvasAntialiasRef = useRef(qualityConfig.render.antialias);
  const warmupKey = useMemo(
    () => getMapPrepCacheKey({ seed: mapSeed, themeId: mapThemeId, mapSize, mapProfileId, pregeneratedMapId }),
    [mapSeed, mapThemeId, mapSize, mapProfileId, pregeneratedMapId]
  );
  const [warmupSnapshot, dispatchWarmup] = useReducer(
    reduceMapWarmup,
    createMapWarmupSnapshot(warmupKey, mapSeed)
  );
  const [battleRoyalTerrainScale, setBattleRoyalTerrainScale] = useState(1);
  const [battleRoyalCombatScale, setBattleRoyalCombatScale] = useState(1);
  const completedWarmupStagesRef = useRef<Set<MapWarmupStageId>>(new Set());
  const didStartGpuRef = useRef<string | null>(null);
  const mapTheme = useMemo(
    () => isTutorialMapSeed(mapSeed) ? createTutorialVoxelMapManifest().theme : getVoxelMapTheme(mapSeed, mapThemeId),
    [mapSeed, mapThemeId]
  );
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown' || gamePhase === 'deployment';
  const isBattleRoyal = gameplayMode === 'battle_royal';
  const isBattleRoyalFlightPhase = isBattleRoyal && (gamePhase === 'countdown' || gamePhase === 'deployment');
  const battleRoyalFlightVisibilityBlend = useSmoothedNumber(isBattleRoyalFlightPhase ? 1 : 0, 4.2);
  const baseBattleRoyalVisibility = useMemo(() => {
    if (!isBattleRoyal) return undefined;
    return createBattleRoyalFlightVisibilityConfig(
      qualityConfig.battleRoyalVisibility,
      battleRoyalFlightVisibilityBlend
    );
  }, [battleRoyalFlightVisibilityBlend, isBattleRoyal, qualityConfig.battleRoyalVisibility]);
  const battleRoyalVisibility = useMemo(() => {
    if (!baseBattleRoyalVisibility) return undefined;
    if (battleRoyalTerrainScale >= 0.995) return baseBattleRoyalVisibility;
    return scaleBattleRoyalVisibilityConfig(baseBattleRoyalVisibility, battleRoyalTerrainScale);
  }, [baseBattleRoyalVisibility, battleRoyalTerrainScale]);
  const effectivePerformanceBudget = qualityConfig.budgets;
  const effectiveCameraFar = battleRoyalVisibility?.cameraFar ?? DEFAULT_CAMERA_FAR;

  useEffect(() => {
    setBattleRoyalTerrainScale(1);
    setBattleRoyalCombatScale(1);
  }, [isBattleRoyal, settings.graphicsPreset]);
  const isBattleRoyalEliminated = isBattleRoyal && localPlayerState === 'dead';
  const isWorldReady = warmupSnapshot.key === warmupKey && warmupSnapshot.canAcceptInput;
  const isReadyForMatchStart = isMapWarmupReadyForMatchStart(warmupSnapshot, warmupKey);
  const shouldMountGameplayObjects = isPlaying || warmupSnapshot.canShowGameplayObjects;
  const effectiveEnvironmentConfig = useMemo(
    () => {
      const environmentConfig = startupRampActive
        ? {
          ...qualityConfig.environment,
          particleDensity: Math.min(qualityConfig.environment.particleDensity, 0.35),
          dustDevilDensity: 0,
          dressingDensity: Math.min(qualityConfig.environment.dressingDensity, 0.55),
          maxParticles: Math.min(qualityConfig.environment.maxParticles, 120),
        }
        : qualityConfig.environment;

      if (!battleRoyalVisibility) return environmentConfig;

      return {
        ...environmentConfig,
        dressingDensity: Math.min(environmentConfig.dressingDensity, 0.62),
        maxParticles: Math.min(environmentConfig.maxParticles, 260),
      };
    },
    [battleRoyalVisibility, qualityConfig.environment, startupRampActive]
  );
  const effectiveRemotePlayerConfig = useMemo(
    () => {
      if (!battleRoyalVisibility) return qualityConfig.remotePlayers;
      return scaleBattleRoyalRemotePlayersForCombat(qualityConfig.remotePlayers, battleRoyalCombatScale);
    },
    [battleRoyalCombatScale, battleRoyalVisibility, qualityConfig.remotePlayers]
  );
  const effectiveEffectsConfig = useMemo(
    () => {
      const effectsConfig = startupRampActive
        ? {
          ...qualityConfig.effects,
          enableDecorativeLights: false,
          maxActiveParticles: Math.min(qualityConfig.effects.maxActiveParticles, 80),
          maxActiveTrails: Math.min(qualityConfig.effects.maxActiveTrails, 8),
        }
        : qualityConfig.effects;

      if (!battleRoyalVisibility) return effectsConfig;

      const battleRoyalEffectsConfig = {
        ...effectsConfig,
        maxActiveParticles: Math.min(effectsConfig.maxActiveParticles, 220),
        maxActiveTrails: Math.min(effectsConfig.maxActiveTrails, 28),
        maxVisibleRemoteAbilityEffects: Math.min(effectsConfig.maxVisibleRemoteAbilityEffects, 18),
        maxRemoteMovementEffectDistance: battleRoyalVisibility.remoteMovementEffectDistance,
        maxTerrainImpactRenderDistance: battleRoyalVisibility.terrainImpactDistance,
      };
      return scaleBattleRoyalEffectsForCombat(battleRoyalEffectsConfig, battleRoyalCombatScale);
    },
    [battleRoyalCombatScale, battleRoyalVisibility, qualityConfig.effects, startupRampActive]
  );
  const effectiveDynamicLights = useMemo(
    () => {
      const dynamicLights = startupRampActive
        ? {
          maxDynamicLights: Math.min(qualityConfig.dynamicLights.maxDynamicLights, 2),
          staticAccentLights: false,
        }
        : qualityConfig.dynamicLights;
      return battleRoyalVisibility
        ? scaleBattleRoyalDynamicLightsForCombat(dynamicLights, battleRoyalCombatScale)
        : dynamicLights;
    },
    [battleRoyalCombatScale, battleRoyalVisibility, qualityConfig.dynamicLights, startupRampActive]
  );
  const effectiveRagdollConfig = useMemo(
    () => {
      if (!battleRoyalVisibility) return qualityConfig.ragdolls;
      return scaleBattleRoyalRagdollsForCombat(qualityConfig.ragdolls, battleRoyalCombatScale);
    },
    [battleRoyalCombatScale, battleRoyalVisibility, qualityConfig.ragdolls]
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
    if (status.preparedMap.key !== warmupKey) return;

    markWarmupStageDone('map', status.preparedMap.source === 'match' ? undefined : 0);

    if (!status.collidersReady) {
      dispatchWarmup({
        type: 'stageProgress',
        stage: 'colliders',
        progress: 0.35,
        detail: 'Loading collision',
      });
    }
    if (status.collidersReady) {
      prewarmLocalMovementCollisionWorld();
      markWarmupStageDone('colliders');
    }

    const requiredRegions = Math.max(1, status.warmupRequiredRegionCount);
    dispatchWarmup({
      type: 'stageProgress',
      stage: 'meshes',
      progress: Math.min(1, status.readyRegionCount / requiredRegions),
      detail: formatTerrainWarmupDetail(status),
    });
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

  useEffect(() => {
    if (warmupSnapshot.key !== warmupKey) return;
    if (
      warmupSnapshot.state !== 'preparingGpu' &&
      warmupSnapshot.state !== 'settling' &&
      !((streamerIsActive || recordingPlaybackIsActive) && warmupSnapshot.state === 'preparingCpu')
    ) {
      return;
    }

    const timeoutMs = warmupSnapshot.state === 'settling'
      ? GPU_SETTLING_STALL_TIMEOUT_MS
      : warmupSnapshot.state === 'preparingCpu'
        ? STREAMER_CPU_WARMUP_STALL_TIMEOUT_MS
        : GPU_WARMUP_STALL_TIMEOUT_MS;
    const timeoutId = window.setTimeout(() => {
      console.warn('[MapWarmup] Warmup stalled; falling back to interactive scene', {
        warmupKey,
        state: warmupSnapshot.state,
        label: warmupSnapshot.label,
        progress: warmupSnapshot.progress,
      });
      dispatchWarmup({ type: 'fallback', reason: `${warmupSnapshot.state}-stall` });
    }, timeoutMs);

    return () => window.clearTimeout(timeoutId);
  }, [
    warmupKey,
    warmupSnapshot.key,
    warmupSnapshot.label,
    warmupSnapshot.progress,
    warmupSnapshot.state,
    streamerIsActive,
    recordingPlaybackIsActive,
  ]);

  return (
    <Canvas
      shadows={qualityConfig.shadows.enabled}
      dpr={qualityConfig.render.dpr}
      camera={{
        fov: settings.fov,
        near: 0.1,
        far: effectiveCameraFar,
        position: [0, 2, 10], // Start at a reasonable height
      }}
      gl={{ 
        antialias: canvasAntialiasRef.current,
        powerPreference: 'high-performance',
        stencil: !isBattleRoyal,
      }}
      onCreated={({ gl }) => {
        suppressExpectedContextLossLog(gl);
        gl.setClearColor(new THREE.Color(mapTheme.skyColor), 1);
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = qualityConfig.render.exposure;
        gl.shadowMap.enabled = qualityConfig.shadows.enabled;
        gl.shadowMap.type = qualityConfig.shadows.type;
        import('./effectPrewarm').then(({ prewarmGameplayEffectResourcesOnce }) => (
          prewarmGameplayEffectResourcesOnce()
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
        <CameraSettingsApplier far={effectiveCameraFar} fov={settings.fov} />
        <RendererSettingsApplier exposure={qualityConfig.render.exposure} shadows={qualityConfig.shadows} />
        <PhysicsBudgetApplier maxVisualQueriesPerFrame={qualityConfig.budgets.maxVisualPhysicsQueriesPerFrame} />
        <GameplayFrameSystems />
        <DynamicLightBudgetSystem maxLights={effectiveDynamicLights.maxDynamicLights} />
        {config.clientDiagnosticsEnabled && <RendererDiagnosticsRecorder />}
        <AdaptiveQualityController
          battleRoyalCombatScale={battleRoyalCombatScale}
          battleRoyalTerrainScale={battleRoyalTerrainScale}
          battleRoyalVisibility={battleRoyalVisibility}
          isBattleRoyal={isBattleRoyal}
          onBattleRoyalCombatScaleChange={setBattleRoyalCombatScale}
          onBattleRoyalTerrainScaleChange={setBattleRoyalTerrainScale}
          performanceBudget={effectivePerformanceBudget}
        />
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
          performanceBudget={effectivePerformanceBudget}
          battleRoyalVisibility={battleRoyalVisibility}
          themeId={mapThemeId}
          mapProfileId={mapProfileId}
          pregeneratedMapId={pregeneratedMapId}
          prebuildRegions
          onWarmupStatus={handleVoxelWarmupStatus}
        />

        <BattleRoyalDropDeployment />
        <BattleRoyalSafeZone />
        <TeamPings />

        {streamerIsActive ? (
          <StreamerCameraDirector enabled />
        ) : isBattleRoyalEliminated ? (
          <BattleRoyalTeamSpectatorCameraController enabled />
        ) : (
          <PlayerController enabled={isWorldReady} inputEnabled={inputEnabled} />
        )}
        
        {/* Other players - always rendered so players can see each other in lobby */}
        <OtherPlayers
          config={effectiveRemotePlayerConfig}
          effectConfig={effectiveEffectsConfig}
          theme={mapTheme}
          hiddenPlayerId={streamerHiddenPlayerId}
        />
        <RagdollManager config={effectiveRagdollConfig} />
        
        {/* Gameplay objects mount during warmup so first-use shaders and buffers are paid before input. */}
        {shouldMountGameplayObjects && (
          <>
            {(!isPracticeMode || isTutorialMode) && <Flags />}
            {(!isPracticeMode || isTutorialMode) && <Powerups />}
            {isBattleRoyal && <BattleRoyalSouls />}
            {isTutorialMode && <TutorialWorldPrompts />}
            {isTutorialMode && <TutorialTargetRange />}
            {isPracticeMode && mapProfileId === 'dev_testing' && <DevTestingMapRuntime />}
            <Effects />
            <CombatTextLayer enabled={settings.showDamageNumbers} />
            {!isObserverMode && <HeroViewmodel config={qualityConfig.viewmodel} />}
            <VoidZonesManager />
            <DireBallsManager />
            <PhantomPersonalShieldsManager />
            <VoidRaysManager />
            <PhantomEffectsManager />
            <ObservedAbilityCastEffectsManager
              maxVisibleEffects={effectiveEffectsConfig.maxVisibleRemoteAbilityEffects}
            />
            <BlazeEffectsManager config={effectiveEffectsConfig} />
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
        {!isPlaying && !streamerIsActive && <OrbitControls target={[0, 0, 0]} enablePan={false} />}

        <SceneAtmosphereColors
          fogDensity={battleRoyalVisibility?.fogDensity ?? DEFAULT_SCENE_FOG_DENSITY}
          theme={mapTheme}
        />
        <SceneReadySignal
          onReady={onMatchStartReady}
          ready={isReadyForMatchStart}
          readyKey={`${warmupKey}:match-start`}
        />
        <SceneReadySignal onReady={onReady} ready={isWorldReady} readyKey={`${warmupKey}:interactive`} />
        <GameplayFrameWorkBoundary />
      </Suspense>
    </Canvas>
  );
}
