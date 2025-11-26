import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Simple CTF map layout
const MAP_DATA = {
  width: 100,
  depth: 100,
  // Heights for different areas
  areas: {
    base: { y: 0, color: '#333340' },
    platform: { y: 3, color: '#444450' },
    tower: { y: 8, color: '#555560' },
    wall: { y: 5, color: '#3a3a45' },
  },
};

export function VoxelWorld() {
  return (
    <group>
      {/* Ground plane */}
      <Ground />
      
      {/* Arena structures */}
      <ArenaLayout />
      
      {/* Team bases */}
      <TeamBase position={[-40, 0, 0]} team="red" />
      <TeamBase position={[40, 0, 0]} team="blue" />
      
      {/* Central structures */}
      <CentralArea />
      
      {/* Boundaries */}
      <ArenaBoundaries />
    </group>
  );
}

function Ground() {
  const groundRef = useRef<THREE.Mesh>(null);

  // Create a simple grid texture
  const gridTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    
    ctx.fillStyle = '#2a3a4a';
    ctx.fillRect(0, 0, 64, 64);
    
    ctx.strokeStyle = '#3a4a5a';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 64, 64);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(50, 50);
    
    return texture;
  }, []);

  return (
    <mesh 
      ref={groundRef}
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[0, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[MAP_DATA.width, MAP_DATA.depth]} />
      <meshStandardMaterial 
        map={gridTexture}
        color="#3a4a5a"
        roughness={0.8}
        metalness={0.2}
      />
    </mesh>
  );
}

function ArenaLayout() {
  return (
    <group>
      {/* Side walls - parkour paths */}
      <WallSegment position={[0, 2.5, -45]} size={[80, 5, 3]} />
      <WallSegment position={[0, 2.5, 45]} size={[80, 5, 3]} />
      
      {/* Cover blocks in middle area */}
      {[-20, 0, 20].map((x, i) => (
        <VoxelBlock 
          key={i}
          position={[x, 1, 0]} 
          size={[4, 2, 4]}
          color="#3a3a45"
        />
      ))}
      
      {/* Elevated platforms for grappling */}
      <Platform position={[-25, 6, -20]} size={[8, 1, 8]} />
      <Platform position={[25, 6, -20]} size={[8, 1, 8]} />
      <Platform position={[-25, 6, 20]} size={[8, 1, 8]} />
      <Platform position={[25, 6, 20]} size={[8, 1, 8]} />
      
      {/* Ramps for parkour */}
      <Ramp position={[-30, 1.5, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Ramp position={[30, 1.5, 0]} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

interface TeamBaseProps {
  position: [number, number, number];
  team: 'red' | 'blue';
}

function TeamBase({ position, team }: TeamBaseProps) {
  const baseColor = team === 'red' ? '#5a3030' : '#303050';
  const accentColor = team === 'red' ? '#ff5555' : '#5555ff';
  const flagPos: [number, number, number] = [position[0], position[1] + 0.5, position[2]];

  return (
    <group position={position}>
      {/* Base platform */}
      <VoxelBlock 
        position={[0, 0.5, 0]} 
        size={[12, 1, 12]}
        color={baseColor}
      />
      
      {/* Flag pedestal */}
      <VoxelBlock 
        position={[0, 1.5, 0]} 
        size={[2, 2, 2]}
        color={accentColor}
        emissive={accentColor}
        emissiveIntensity={0.3}
      />
      
      {/* Spawn area markers */}
      {[
        [-4, 0.1, -4],
        [-4, 0.1, 4],
        [4, 0.1, -4],
        [4, 0.1, 4],
      ].map((pos, i) => (
        <SpawnMarker 
          key={i} 
          position={pos as [number, number, number]} 
          color={accentColor} 
        />
      ))}
      
      {/* Defensive walls */}
      <VoxelBlock position={[-6, 2, 0]} size={[1, 4, 8]} color={baseColor} />
      <VoxelBlock position={[6, 2, 0]} size={[1, 4, 8]} color={baseColor} />
      <VoxelBlock position={[0, 2, -6]} size={[8, 4, 1]} color={baseColor} />
    </group>
  );
}

function CentralArea() {
  return (
    <group>
      {/* Central tower */}
      <VoxelBlock 
        position={[0, 5, 0]} 
        size={[6, 10, 6]}
        color="#5a5a6a"
        emissive="#5a5a6a"
        emissiveIntensity={0.15}
      />
      
      {/* Tower top platform */}
      <Platform position={[0, 10.5, 0]} size={[10, 1, 10]} />
      
      {/* Access ramps to tower */}
      <VoxelBlock position={[-5, 2.5, 0]} size={[4, 5, 2]} color="#3a3a45" />
      <VoxelBlock position={[5, 2.5, 0]} size={[4, 5, 2]} color="#3a3a45" />
      
      {/* Grapple points (visual indicators) */}
      {[
        [0, 12, 0],
        [-5, 8, -5],
        [5, 8, -5],
        [-5, 8, 5],
        [5, 8, 5],
      ].map((pos, i) => (
        <GrapplePoint key={i} position={pos as [number, number, number]} />
      ))}
    </group>
  );
}

function ArenaBoundaries() {
  const boundaryHeight = 20;
  
  return (
    <group>
      {/* Invisible collision walls */}
      <mesh position={[0, boundaryHeight / 2, -MAP_DATA.depth / 2]} visible={false}>
        <boxGeometry args={[MAP_DATA.width, boundaryHeight, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[0, boundaryHeight / 2, MAP_DATA.depth / 2]} visible={false}>
        <boxGeometry args={[MAP_DATA.width, boundaryHeight, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[-MAP_DATA.width / 2, boundaryHeight / 2, 0]} visible={false}>
        <boxGeometry args={[1, boundaryHeight, MAP_DATA.depth]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[MAP_DATA.width / 2, boundaryHeight / 2, 0]} visible={false}>
        <boxGeometry args={[1, boundaryHeight, MAP_DATA.depth]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

// Helper components

interface VoxelBlockProps {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  emissive?: string;
  emissiveIntensity?: number;
}

function VoxelBlock({ position, size, color, emissive, emissiveIntensity = 0 }: VoxelBlockProps) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial 
        color={color}
        emissive={emissive || color}
        emissiveIntensity={emissiveIntensity || 0.1}
        roughness={0.7}
        metalness={0.3}
      />
    </mesh>
  );
}

interface WallSegmentProps {
  position: [number, number, number];
  size: [number, number, number];
}

function WallSegment({ position, size }: WallSegmentProps) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <boxGeometry args={size} />
      <meshStandardMaterial 
        color="#4a4a5a"
        emissive="#4a4a5a"
        emissiveIntensity={0.05}
        roughness={0.8}
        metalness={0.2}
      />
    </mesh>
  );
}

interface PlatformProps {
  position: [number, number, number];
  size: [number, number, number];
}

function Platform({ position, size }: PlatformProps) {
  return (
    <group position={position}>
      <mesh castShadow receiveShadow>
        <boxGeometry args={size} />
        <meshStandardMaterial 
          color="#556575"
          emissive="#556575"
          emissiveIntensity={0.1}
          roughness={0.6}
          metalness={0.4}
        />
      </mesh>
      {/* Edge glow */}
      <mesh position={[0, -0.4, 0]}>
        <boxGeometry args={[size[0] + 0.1, 0.2, size[2] + 0.1]} />
        <meshStandardMaterial 
          color="#00ff88"
          emissive="#00ff88"
          emissiveIntensity={1}
          transparent
          opacity={0.8}
        />
      </mesh>
    </group>
  );
}

interface RampProps {
  position: [number, number, number];
  rotation?: [number, number, number];
}

function Ramp({ position, rotation = [0, 0, 0] }: RampProps) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow receiveShadow rotation={[0, 0, Math.PI / 6]}>
        <boxGeometry args={[8, 0.5, 4]} />
        <meshStandardMaterial color="#3a3a45" roughness={0.8} />
      </mesh>
    </group>
  );
}

interface SpawnMarkerProps {
  position: [number, number, number];
  color: string;
}

function SpawnMarker({ position, color }: SpawnMarkerProps) {
  const ref = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (ref.current) {
      ref.current.rotation.y = state.clock.elapsedTime * 0.5;
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <ringGeometry args={[0.8, 1, 4]} />
      <meshStandardMaterial 
        color={color}
        emissive={color}
        emissiveIntensity={0.5}
        side={THREE.DoubleSide}
        transparent
        opacity={0.6}
      />
    </mesh>
  );
}

interface GrapplePointProps {
  position: [number, number, number];
}

function GrapplePoint({ position }: GrapplePointProps) {
  const ref = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (ref.current) {
      ref.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 2) * 0.1);
    }
  });

  return (
    <mesh ref={ref} position={position}>
      <octahedronGeometry args={[0.5]} />
      <meshStandardMaterial 
        color="#00ff88"
        emissive="#00ff88"
        emissiveIntensity={0.8}
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}

