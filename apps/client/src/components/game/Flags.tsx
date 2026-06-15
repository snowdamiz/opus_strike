import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useShallow } from 'zustand/shallow';
import { useGameStore } from '../../store/gameStore';
import type { Team } from '@voxel-strike/shared';

export function Flags() {
  const { redFlag, blueFlag } = useGameStore(
    useShallow((state) => ({
      redFlag: state.redFlag,
      blueFlag: state.blueFlag,
    }))
  );

  return (
    <group>
      {redFlag && !redFlag.carrierId && (
        <Flag 
          position={[redFlag.position.x, redFlag.position.y, redFlag.position.z]}
          team="red"
          isAtBase={redFlag.isAtBase}
        />
      )}
      {blueFlag && !blueFlag.carrierId && (
        <Flag 
          position={[blueFlag.position.x, blueFlag.position.y, blueFlag.position.z]}
          team="blue"
          isAtBase={blueFlag.isAtBase}
        />
      )}
    </group>
  );
}

interface FlagProps {
  position: [number, number, number];
  team: Team;
  isAtBase: boolean;
}

function Flag({ position, team, isAtBase }: FlagProps) {
  const groupRef = useRef<THREE.Group>(null);
  const clothRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);

  const flagColor = team === 'red' ? '#ef4444' : '#4444ff';
  const glowColor = team === 'red' ? '#f87171' : '#6666ff';

  useFrame((state) => {
    if (!groupRef.current) return;

    // Gentle floating animation when at base
    if (isAtBase) {
      groupRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 2) * 0.1;
    }

    // Wave the flag cloth
    if (clothRef.current) {
      const geometry = clothRef.current.geometry as THREE.PlaneGeometry;
      const posAttr = geometry.getAttribute('position');
      const time = state.clock.elapsedTime;

      for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i);
        const wave = Math.sin(x * 3 + time * 4) * 0.05;
        posAttr.setZ(i, wave);
      }
      posAttr.needsUpdate = true;
    }

    // Animate the glow
    if (glowRef.current) {
      const scale = 1 + Math.sin(state.clock.elapsedTime * 3) * 0.1;
      glowRef.current.scale.set(scale, scale, scale);
    }
  });

  return (
    <group ref={groupRef} position={position}>
      {/* Flag pole */}
      <mesh position={[0, 1, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.05, 2]} />
        <meshStandardMaterial color="#888888" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Flag cloth */}
      <mesh ref={clothRef} position={[0.4, 1.6, 0]} castShadow>
        <planeGeometry args={[0.8, 0.5, 8, 4]} />
        <meshStandardMaterial 
          color={flagColor}
          emissive={flagColor}
          emissiveIntensity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Base glow effect */}
      <mesh ref={glowRef} position={[0, 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1, 32]} />
        <meshBasicMaterial 
          color={glowColor}
          transparent
          opacity={0.3}
        />
      </mesh>

      {/* Pickup indicator ring */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[1.5, 1.7, 32]} />
        <meshBasicMaterial 
          color={flagColor}
          transparent
          opacity={0.5}
        />
      </mesh>

      {/* Vertical beam when dropped */}
      {!isAtBase && (
        <mesh position={[0, 10, 0]}>
          <cylinderGeometry args={[0.1, 0.1, 20]} />
          <meshBasicMaterial 
            color={flagColor}
            transparent
            opacity={0.3}
          />
        </mesh>
      )}
    </group>
  );
}
