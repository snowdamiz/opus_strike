import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Environment, OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { getVoxelMapTheme } from '@voxel-strike/shared';
import { VoxelWorld } from './VoxelWorld';
import { WorldAtmosphere } from './WorldAtmosphere';
import { PlayerController } from './PlayerController';
import { OtherPlayers } from './OtherPlayers';
import { PerfMonitor } from './PerfMonitor';
import { Flags } from './Flags';
import { Effects } from './Effects';
import { SlideSpeedLines } from './SlideSpeedLines';
import { HeroViewmodel } from './HeroViewmodel';
import { VoidZonesManager, DireBallsManager, VoidRaysManager, PhantomPersonalShieldsManager } from './phantom';
import { PhantomEffectsManager } from './PhantomEffects';
import { BlazeEffectsManager } from './BlazeEffects';
import { HookshotEffectsManager } from './HookshotEffects';
import { TerrainImpactEffectsManager } from './TerrainImpactEffects';
import { ChronosAegisManager, ChronosPulsesManager } from './chronos';
import { prewarmBlazeEffects, prewarmPhantomEffects } from './effectResources';
import { GameplayFrameSystems } from './systems/GameplayFrameSystems';
import { BudgetedPointLight, DynamicLightBudgetSystem } from './systems/DynamicLightBudget';
import { useGameStore } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import { getClientPerfSnapshot, setActiveLightCount } from '../../utils/perfMarks';
import {
  getVisualQualityConfig,
  type ReflectionQualityConfig,
  type ShadowQualityConfig,
} from './visualQuality';

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

function SceneReadySignal({ onReady }: { onReady?: () => void }) {
  const didSignalRef = useRef(false);

  useEffect(() => {
    if (!onReady || didSignalRef.current) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        didSignalRef.current = true;
        onReady();
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [onReady]);

  return null;
}

function SceneLightCounter() {
  const { scene } = useThree();
  const accumulatorRef = useRef(0);

  useFrame((_, delta) => {
    accumulatorRef.current += delta;
    if (accumulatorRef.current < 0.5) return;
    accumulatorRef.current = 0;

    let lights = 0;
    scene.traverse((object) => {
      if ((object as THREE.Light).isLight) lights++;
    });
    setActiveLightCount(lights);
  });

  return null;
}

const FEATURE_QUALITY_STEPS = ['off', 'low', 'medium', 'high', 'ultra'] as const;
const RESOLUTION_QUALITY_STEPS = ['low', 'medium', 'high', 'ultra'] as const;

function stepDown<T extends string>(value: T, steps: readonly T[]): T {
  const index = steps.indexOf(value);
  return steps[Math.max(0, index - 1)] ?? value;
}

function AdaptiveQualityController() {
  const settings = useSettingsStore(state => state.settings);
  const accumulatorRef = useRef(0);
  const overBudgetSecondsRef = useRef(0);

  useFrame((_, delta) => {
    if (!settings.adaptiveQuality) return;

    accumulatorRef.current += delta;
    if (accumulatorRef.current < 2) return;
    accumulatorRef.current = 0;

    const p95 = getClientPerfSnapshot().frame.frameMsP95;
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
    };

    if (
      nextSettings.reflectionQuality !== settings.reflectionQuality ||
      nextSettings.environmentQuality !== settings.environmentQuality ||
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
}

export function GameCanvas({ onReady }: GameCanvasProps) {
  const gamePhase = useGameStore((state) => state.gamePhase);
  const mapSeed = useGameStore((state) => state.mapSeed);
  const debugMode = useGameStore((state) => state.debugMode);
  const settings = useSettingsStore(state => state.settings);
  const qualityConfig = getVisualQualityConfig(settings);
  const mapTheme = useMemo(() => getVoxelMapTheme(mapSeed), [mapSeed]);
  const gridCellColor = useMemo(
    () => new THREE.Color(mapTheme.ground.stone).lerp(new THREE.Color(mapTheme.fogColor), 0.28).getStyle(),
    [mapTheme]
  );
  const gridSectionColor = useMemo(
    () => new THREE.Color(mapTheme.structures.accent).lerp(new THREE.Color('#ffffff'), 0.18).getStyle(),
    [mapTheme]
  );
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  const showFullPerfOverlay = debugMode || settings.showFPS === 'full';

  return (
    <Canvas
      key={`${settings.resolutionScale}:${settings.antialiasing}`}
      shadows={qualityConfig.shadows.enabled}
      dpr={qualityConfig.render.dpr}
      camera={{ 
        fov: settings.fov,
        near: 0.1, 
        far: 1000,
        position: [0, 2, 10], // Start at a reasonable height
      }}
      gl={{ 
        antialias: qualityConfig.render.antialias,
        powerPreference: 'high-performance',
      }}
      onCreated={({ gl }) => {
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
      }}
    >
      <Suspense fallback={null}>
        <CameraSettingsApplier fov={settings.fov} />
        <RendererSettingsApplier exposure={qualityConfig.render.exposure} shadows={qualityConfig.shadows} />
        <GameplayFrameSystems />
        <DynamicLightBudgetSystem maxLights={qualityConfig.dynamicLights.maxDynamicLights} />
        {showFullPerfOverlay && <SceneLightCounter />}
        <AdaptiveQualityController />
        <ReflectionEnvironment theme={mapTheme} config={qualityConfig.reflections} />
        <WorldAtmosphere theme={mapTheme} seed={mapSeed} config={qualityConfig.environment} />

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
        {qualityConfig.dynamicLights.staticAccentLights && (
          <>
            <BudgetedPointLight budgetPriority={0.35} position={[0, 12, 0]} intensity={42} color={mapTheme.structures.accent} distance={72} decay={2} />
            <BudgetedPointLight budgetPriority={0.3} position={[-40, 10, 0]} intensity={38} color="#ff5f46" distance={30} decay={2} />
            <BudgetedPointLight budgetPriority={0.3} position={[40, 10, 0]} intensity={38} color="#4a9cff" distance={30} decay={2} />
          </>
        )}

        {/* Performance monitor */}
        <PerfMonitor />


        {/* World */}
        <VoxelWorld
          shadowsEnabled={qualityConfig.shadows.enabled}
          dressingShadows={qualityConfig.shadows.dressingShadows}
          dressingDensity={qualityConfig.environment.dressingDensity}
          reflectionIntensity={qualityConfig.reflections.materialIntensity}
          materialDetail={qualityConfig.render.materialDetail}
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

        {/* Player controller - always active when connected */}
        <PlayerController />
        
        {/* Other players - always rendered so players can see each other in lobby */}
        <OtherPlayers />
        
        {/* Game objects only during gameplay */}
        {isPlaying && (
          <>
            <Flags />
            <Effects />
            <SlideSpeedLines />
            <HeroViewmodel />
            <VoidZonesManager />
            <DireBallsManager />
            <PhantomPersonalShieldsManager />
            <VoidRaysManager />
            <PhantomEffectsManager />
            <BlazeEffectsManager />
            <HookshotEffectsManager />
            <ChronosAegisManager />
            <ChronosPulsesManager />
            <TerrainImpactEffectsManager />
          </>
        )}

        {/* Orbit controls when not playing for looking around */}
        {!isPlaying && <OrbitControls target={[0, 0, 0]} enablePan={false} />}

        <fogExp2 attach="fog" args={[mapTheme.fogColor, 0.0062]} />
        <color attach="background" args={[mapTheme.skyColor]} />
        <SceneReadySignal onReady={onReady} />
      </Suspense>
    </Canvas>
  );
}
