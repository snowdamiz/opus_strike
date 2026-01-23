import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { OrbitControls, Grid } from '@react-three/drei';
import { VoxelWorld } from './VoxelWorld';
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
import { useGameStore } from '../../store/gameStore';

export function GameCanvas() {
  const { gamePhase, voidZones, direBalls, voidRays } = useGameStore();
  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';

  return (
    <Canvas
      shadows
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
      style={{
        position: 'absolute',
        inset: 0,
        background: '#1e2a4a',
      }}
    >
      <Suspense fallback={null}>
        {/* Lighting - dark neon Tron aesthetic */}
        <ambientLight intensity={0.3} color="#1a1a3a" />
        <directionalLight
          position={[50, 100, 50]}
          intensity={2.0}
          color="#4488ff"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={200}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
        />
        <hemisphereLight args={['#0d0d1a', '#0a0a15', 0.3]} />
        <pointLight position={[-40, 10, 0]} intensity={50} color="#ff6666" distance={30} />
        <pointLight position={[40, 10, 0]} intensity={50} color="#6666ff" distance={30} />

        {/* Performance monitor */}
        <PerfMonitor />


        {/* World */}
        <VoxelWorld />

        {/* Grid helper for visibility */}
        <Grid 
          args={[100, 100]} 
          position={[0, 0.01, 0]}
          cellSize={2}
          cellThickness={0.5}
          cellColor="#3a3a5a"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#5a5a8a"
          fadeDistance={100}
          fadeStrength={1}
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
          </>
        )}

        {/* Orbit controls when not playing for looking around */}
        {!isPlaying && <OrbitControls target={[0, 0, 0]} enablePan={false} />}

        {/* Background color - lighter for Tron sky */}
        <color attach="background" args={['#1e2a4a']} />
      </Suspense>
    </Canvas>
  );
}

