import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';

// ============================================================================
// PHANTOM VEIL 3D EFFECT
// Ethereal ghost particles around the player during invisibility
// ============================================================================

interface PhantomVeilEffectProps {
  isActive: boolean;
  playerPosition?: { x: number; y: number; z: number };
  playerId?: string;
}

const PHANTOM_VEIL_GROUND_GEOMETRY = new THREE.CircleGeometry(0.8, 32);

export function PhantomVeil3DEffect({ isActive, playerPosition, playerId }: PhantomVeilEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const wisprRef = useRef<THREE.Points>(null);
  
  // Ghost particles swirling around player
  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const particleCount = 100;
    const positions = new Float32Array(particleCount * 3);
    const randoms = new Float32Array(particleCount);
    const offsets = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const height = Math.random() * 2;
      const radius = 0.8 + Math.random() * 0.8;
      
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      randoms[i] = Math.random();
      offsets[i] = Math.random() * Math.PI * 2;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    
    return geometry;
  }, []);
  
  // Wisp trails - longer trailing particles
  const wispGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const count = 30;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 1.2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.5 + Math.random() * 1.5;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      randoms[i] = Math.random();
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    
    return geometry;
  }, []);
  
  useFrame((state, delta) => {
    if (!isActive || !groupRef.current) return;

    const store = useGameStore.getState();
    const trackedPlayer = playerId
      ? (store.localPlayer?.id === playerId ? store.localPlayer : store.players.get(playerId))
      : null;
    const trackedPosition = playerId
      ? (visualStore.getState().playerPositions.get(playerId) ?? trackedPlayer?.position)
      : null;
    const currentPosition = trackedPosition ?? playerPosition;
    if (!currentPosition) {
      groupRef.current.visible = false;
      return;
    }

    groupRef.current.visible = true;
    
    // Follow player position
    groupRef.current.position.set(currentPosition.x, currentPosition.y - 0.9, currentPosition.z);
    
    // Animate particles - spiral motion
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position;
      const offsets = particlesRef.current.geometry.attributes.offset;
      const time = state.clock.elapsedTime;
      
      for (let i = 0; i < positions.count; i++) {
        const offset = (offsets as THREE.BufferAttribute).getX(i);
        const angle = offset + time * 2;
        const baseRadius = 0.8 + Math.sin(time * 3 + offset * 5) * 0.2;
        const height = (positions.getY(i) + delta * 0.5) % 2.5;
        
        positions.setX(i, Math.cos(angle) * baseRadius);
        positions.setY(i, height);
        positions.setZ(i, Math.sin(angle) * baseRadius);
      }
      positions.needsUpdate = true;
    }
    
    // Animate wisps - slower orbital motion
    if (wisprRef.current) {
      wisprRef.current.rotation.y += delta * 0.5;
    }
  });
  
  if (!isActive) return null;
  
  return (
    <group ref={groupRef}>
      {/* Swirling ghost particles */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <pointsMaterial 
          color={0x9333ea}
          size={0.08}
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      
      {/* Wisp trails */}
      <points ref={wisprRef} geometry={wispGeometry}>
        <pointsMaterial 
          color={0xc084fc}
          size={0.12}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      
      {/* Ground shadow */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01} geometry={PHANTOM_VEIL_GROUND_GEOMETRY}>
        <meshBasicMaterial 
          color={0x1a0033}
          transparent
          opacity={0.5}
        />
      </mesh>
    </group>
  );
}
