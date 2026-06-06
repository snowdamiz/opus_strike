import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import { OrbitControls, Grid } from '@react-three/drei';
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
import { VoidZones, DireBalls, VoidRays } from './phantom';
import { PhantomEffectsManager } from './PhantomEffects';
import { BlazeEffectsManager } from './BlazeEffects';
import { HookshotEffectsManager } from './HookshotEffects';
import { GlacierEffectsManager } from './GlacierEffects';
import { TerrainImpactEffectsManager } from './TerrainImpactEffects';
import { useGameStore } from '../../store/gameStore';

export function GameCanvas() {
  const { gamePhase, voidZones, direBalls, voidRays, mapSeed } = useGameStore();
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

  return (
    <Canvas
      shadows
      dpr={[1, 1.75]}
      camera={{ 
        fov: 90, 
        near: 0.1, 
        far: 1000,
        position: [0, 2, 10], // Start at a reasonable height
      }}
      gl={{ 
        antialias: true,
        powerPreference: 'high-performance',
      }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.08;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
      }}
      style={{
        position: 'absolute',
        inset: 0,
        background: mapTheme.skyColor,
      }}
    >
      <Suspense fallback={null}>
        <WorldAtmosphere theme={mapTheme} seed={mapSeed} />

        {/* Lighting follows the generated map theme. */}
        <ambientLight intensity={0.42} color={mapTheme.ambientColor} />
        <hemisphereLight args={[mapTheme.skyColor, mapTheme.ground.side, 1.65]} />
        <directionalLight
          position={[58, 105, 34]}
          intensity={4.85}
          color={mapTheme.sunColor}
          castShadow
          shadow-mapSize={[4096, 4096]}
          shadow-camera-far={200}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
          shadow-bias={-0.00018}
          shadow-normalBias={0.045}
        />
        <directionalLight
          position={[-60, 36, -70]}
          intensity={0.75}
          color={mapTheme.structures.glass}
        />
        <pointLight position={[0, 12, 0]} intensity={65} color={mapTheme.structures.accent} distance={80} decay={2} />
        <pointLight position={[-40, 10, 0]} intensity={72} color="#ff5f46" distance={34} decay={2} />
        <pointLight position={[40, 10, 0]} intensity={72} color="#4a9cff" distance={34} decay={2} />

        {/* Performance monitor */}
        <PerfMonitor />


        {/* World */}
        <VoxelWorld />

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
            <VoidZones zones={voidZones} />
            <DireBalls balls={direBalls} />
            <VoidRays rays={voidRays} />
            <PhantomEffectsManager />
            <BlazeEffectsManager />
            <HookshotEffectsManager />
            <GlacierEffectsManager />
            <TerrainImpactEffectsManager />
          </>
        )}

        {/* Orbit controls when not playing for looking around */}
        {!isPlaying && <OrbitControls target={[0, 0, 0]} enablePan={false} />}

        <fogExp2 attach="fog" args={[mapTheme.fogColor, 0.0062]} />
        <color attach="background" args={[mapTheme.skyColor]} />
      </Suspense>
    </Canvas>
  );
}
