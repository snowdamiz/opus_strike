/**
 * Flag Zone Visual Indicator
 *
 * Renders boundary markers around flag capture zones with contested-state
 * feedback. When enemy players are within the contest radius, the zone
 * pulses faster to warn defenders.
 *
 * Per CONTEXT.md: "warning indicators when contested (zone glows or pulses
 * differently when enemies nearby)"
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../../../store/gameStore';

interface FlagZoneProps {
  position: [number, number, number];
  team: 'red' | 'blue';
  /** Radius within which enemy presence triggers contested state */
  contestRadius?: number;
  /** Size of the flag zone visual (half-extent) */
  size?: number;
}

// Shared materials - created once, reused across instances
const redZoneMaterial = new THREE.MeshStandardMaterial({
  color: 0x1a0a0a,
  emissive: 0xef4444,
  emissiveIntensity: 0.5,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
});

const blueZoneMaterial = new THREE.MeshStandardMaterial({
  color: 0x0a0a1a,
  emissive: 0x00ccff,
  emissiveIntensity: 0.5,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
});

export function FlagZone({
  position,
  team,
  contestRadius = 15,
  size = 4,
}: FlagZoneProps) {
  const ringRef = useRef<THREE.Mesh>(null);
  const players = useGameStore((s) => s.players);

  // Check if any enemy player is within contest radius
  const isContested = useMemo(() => {
    const contestRadiusSq = contestRadius * contestRadius;

    for (const player of players.values()) {
      // Enemy is opposite team and alive
      if (player.team !== team && player.state === 'alive') {
        const dx = player.position.x - position[0];
        const dz = player.position.z - position[2];
        const distSq = dx * dx + dz * dz;

        if (distSq < contestRadiusSq) {
          return true;
        }
      }
    }
    return false;
  }, [players, team, position, contestRadius]);

  useFrame((state) => {
    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshStandardMaterial;

      if (isContested) {
        // Fast pulse when contested - urgent warning (6Hz)
        mat.emissiveIntensity = 1.0 + Math.sin(state.clock.elapsedTime * 6) * 0.5;
        mat.opacity = 0.8 + Math.sin(state.clock.elapsedTime * 6) * 0.15;
      } else {
        // Slow gentle pulse when safe (1.5Hz)
        mat.emissiveIntensity = 0.5 + Math.sin(state.clock.elapsedTime * 1.5) * 0.2;
        mat.opacity = 0.7;
      }
    }
  });

  const material = team === 'red' ? redZoneMaterial : blueZoneMaterial;

  return (
    <group position={position}>
      {/* Outer boundary ring - marks capture zone edge */}
      <mesh
        ref={ringRef}
        position={[0, 0.03, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      >
        <ringGeometry args={[size - 0.3, size, 4]} />
      </mesh>

      {/* Corner markers - square shape for zone boundary */}
      {/* Top-left */}
      <mesh
        position={[-size + 0.5, 0.03, -size + 0.5]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      {/* Top-right */}
      <mesh
        position={[size - 0.5, 0.03, -size + 0.5]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      {/* Bottom-left */}
      <mesh
        position={[-size + 0.5, 0.03, size - 0.5]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
      {/* Bottom-right */}
      <mesh
        position={[size - 0.5, 0.03, size - 0.5]}
        rotation={[-Math.PI / 2, 0, 0]}
        material={material}
      >
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
