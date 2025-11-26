import { Canvas } from '@react-three/fiber';
import { Suspense } from 'react';
import { OrbitControls, Sky, Grid } from '@react-three/drei';
import { VoxelWorld } from './VoxelWorld';
import { PlayerController } from './PlayerController';
import { OtherPlayers } from './OtherPlayers';
import { Flags } from './Flags';
import { Effects } from './Effects';
import { useGameStore } from '../../store/gameStore';

export function GameCanvas() {
  const { gamePhase } = useGameStore();
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
        background: '#1a1a2e',
      }}
    >
      <Suspense fallback={null}>
        {/* Lighting - brighter for visibility */}
        <ambientLight intensity={0.8} />
        <directionalLight
          position={[50, 100, 50]}
          intensity={1.5}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-far={200}
          shadow-camera-left={-100}
          shadow-camera-right={100}
          shadow-camera-top={100}
          shadow-camera-bottom={-100}
        />
        <hemisphereLight
          args={['#87CEEB', '#445544', 0.6]}
        />
        <pointLight position={[-40, 10, 0]} intensity={50} color="#ff6666" distance={30} />
        <pointLight position={[40, 10, 0]} intensity={50} color="#6666ff" distance={30} />

        {/* Sky */}
        <Sky sunPosition={[100, 50, 100]} />

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
          </>
        )}

        {/* Orbit controls when not playing for looking around */}
        {!isPlaying && <OrbitControls target={[0, 0, 0]} enablePan={false} />}

        {/* Background color */}
        <color attach="background" args={['#1a1a2e']} />
      </Suspense>
    </Canvas>
  );
}

