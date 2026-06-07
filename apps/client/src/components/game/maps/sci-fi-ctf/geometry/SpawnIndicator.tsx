/**
 * Spawn Point Indicator
 *
 * Subtle floor marker showing spawn positions. Uses ring geometry
 * with team-colored emissive glow and gentle pulse animation.
 *
 * Per CONTEXT.md: "subtle spawn indicators (floor texture change or faint glow,
 * noticeable if looking but not dominant)"
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SpawnIndicatorProps {
  position: [number, number, number];
  team: 'red' | 'blue';
}

// Shared materials for performance (single GPU resource per team)
const redIndicatorMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a0a0a,
  emissive: 0xef4444,
  emissiveIntensity: 0.3,
  transparent: true,
  opacity: 0.6,
  side: THREE.DoubleSide,
});

const blueIndicatorMaterial = new THREE.MeshStandardMaterial({
  color: 0x0a0a1a,
  emissive: 0x00ccff,
  emissiveIntensity: 0.3,
  transparent: true,
  opacity: 0.6,
  side: THREE.DoubleSide,
});

export function SpawnIndicator({ position, team }: SpawnIndicatorProps) {
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (ringRef.current) {
      // Subtle pulse animation - vary emissive intensity
      const pulse = 0.3 + Math.sin(state.clock.elapsedTime * 2) * 0.1;
      const mat = ringRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = pulse;
    }
  });

  const material = team === 'red' ? redIndicatorMaterial : blueIndicatorMaterial;

  return (
    <group position={position}>
      {/* Main ring indicator - flat on ground */}
      <mesh
        ref={ringRef}
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      >
        <ringGeometry args={[0.8, 1.2, 32]} />
      </mesh>

      {/* Inner dot for center marking */}
      <mesh
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      >
        <circleGeometry args={[0.2, 16]} />
      </mesh>
    </group>
  );
}
