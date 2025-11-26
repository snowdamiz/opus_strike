import { useRef, useEffect } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

// Map configuration - switch between maps here
const CURRENT_MAP = '/maps/Inferno_World_free.glb';
// Alternative: '/maps/One_file_assets.glb'

// Map scale and position adjustments (tweak these as needed)
const MAP_CONFIG = {
  scale: 1,
  position: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0] as [number, number, number],
};

// Fallback floor size (invisible, catches players who fall through)
const FALLBACK_FLOOR_SIZE = 500;

export function VoxelWorld() {
  return (
    <group>
      {/* Load the GLB map */}
      <GLBMap />
      
      {/* Ground plane as fallback/extension */}
      <Ground />
      
      {/* Boundaries */}
      <ArenaBoundaries />
    </group>
  );
}

function GLBMap() {
  const { scene } = useGLTF(CURRENT_MAP);
  const mapRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (scene) {
      // Enable shadows on all meshes in the loaded scene
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, [scene]);

  return (
    <primitive
      ref={mapRef}
      object={scene}
      scale={MAP_CONFIG.scale}
      position={MAP_CONFIG.position}
      rotation={MAP_CONFIG.rotation}
    />
  );
}

// Preload the map for better performance
useGLTF.preload(CURRENT_MAP);

function Ground() {
  // Fallback floor positioned far below the map - invisible death pit catcher
  return (
    <mesh 
      rotation={[-Math.PI / 2, 0, 0]} 
      position={[0, -50, 0]}
    >
      <planeGeometry args={[FALLBACK_FLOOR_SIZE, FALLBACK_FLOOR_SIZE]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  );
}

function ArenaBoundaries() {
  const boundaryHeight = 50;
  const mapSize = 200; // Larger boundaries for the new map
  
  return (
    <group>
      {/* Invisible collision walls */}
      <mesh position={[0, boundaryHeight / 2, -mapSize / 2]} visible={false}>
        <boxGeometry args={[mapSize, boundaryHeight, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[0, boundaryHeight / 2, mapSize / 2]} visible={false}>
        <boxGeometry args={[mapSize, boundaryHeight, 1]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[-mapSize / 2, boundaryHeight / 2, 0]} visible={false}>
        <boxGeometry args={[1, boundaryHeight, mapSize]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
      <mesh position={[mapSize / 2, boundaryHeight / 2, 0]} visible={false}>
        <boxGeometry args={[1, boundaryHeight, mapSize]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
    </group>
  );
}

