import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import { SHARED_GEOMETRIES } from '../effectResources';

// ============================================================================
// JETPACK EFFECT - Enhanced Visuals
// ============================================================================

interface JetpackEffectProps {
  isActive: boolean;
  playerPosition: { x: number; y: number; z: number };
}

// Pre-generate smoke particle data
const JETPACK_SMOKE_PARTICLES = Array.from({ length: 8 }, (_, i) => ({
  xOffset: (Math.random() - 0.5) * 0.15,
  zOffset: (Math.random() - 0.5) * 0.15,
  speed: 2 + Math.random() * 2,
  size: 0.06 + Math.random() * 0.04,
  side: i < 4 ? -1 : 1, // Left or right thruster
}));

export const JetpackEffect = React.memo(({ isActive, playerPosition }: JetpackEffectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const leftFlameRef = useRef<THREE.Group>(null);
  const rightFlameRef = useRef<THREE.Group>(null);
  const leftGlowRef = useRef<THREE.Mesh>(null);
  const rightGlowRef = useRef<THREE.Mesh>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const startTimeRef = useRef(Date.now());
  
  useFrame((state) => {
    if (!isActive || !groupRef.current) return;
    
    const time = state.clock.elapsedTime * 25;
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    
    // Main flame flicker - more chaotic for realism
    const flicker1 = 0.8 + Math.sin(time) * 0.12 + Math.sin(time * 2.3) * 0.08 + Math.sin(time * 5.7) * 0.04;
    const flicker2 = 0.8 + Math.sin(time * 1.1 + 1) * 0.12 + Math.sin(time * 2.7 + 0.5) * 0.08 + Math.sin(time * 6.1) * 0.04;
    
    if (leftFlameRef.current) {
      leftFlameRef.current.scale.set(flicker1, flicker1 * 1.3, flicker1);
    }
    if (rightFlameRef.current) {
      rightFlameRef.current.scale.set(flicker2, flicker2 * 1.25, flicker2);
    }
    
    // Glow pulse
    if (leftGlowRef.current) {
      const glowScale = 0.4 + flicker1 * 0.3;
      leftGlowRef.current.scale.setScalar(glowScale);
      (leftGlowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + flicker1 * 0.15;
    }
    if (rightGlowRef.current) {
      const glowScale = 0.4 + flicker2 * 0.3;
      rightGlowRef.current.scale.setScalar(glowScale);
      (rightGlowRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + flicker2 * 0.15;
    }
    
    // Animated smoke particles falling down
    const thrusterOffset = 0.3;
    smokeRefs.current.forEach((smoke, i) => {
      if (smoke && i < JETPACK_SMOKE_PARTICLES.length) {
        const p = JETPACK_SMOKE_PARTICLES[i];
        const cycleTime = (elapsed * p.speed) % 1.5;
        const y = -0.6 - cycleTime * 1.2;
        const spread = cycleTime * 0.3;
        const opacity = Math.max(0, 0.4 - cycleTime * 0.35);
        const scale = p.size + cycleTime * 0.15;
        
        smoke.position.set(
          p.side * thrusterOffset + p.xOffset + spread * (p.xOffset > 0 ? 1 : -1),
          y,
          p.zOffset + spread * (p.zOffset > 0 ? 1 : -1)
        );
        smoke.scale.setScalar(scale);
        (smoke.material as THREE.MeshBasicMaterial).opacity = opacity;
      }
    });
    
    // Sparks shooting down randomly
    sparkRefs.current.forEach((spark, i) => {
      if (spark) {
        const sparkCycle = ((elapsed * 4 + i * 0.3) % 1);
        const sparkY = -0.4 - sparkCycle * 2;
        const sparkX = (i < 3 ? -1 : 1) * thrusterOffset + (Math.sin(elapsed * 20 + i) * 0.1);
        const sparkZ = Math.cos(elapsed * 15 + i * 2) * 0.1;
        spark.position.set(sparkX, sparkY, sparkZ);
        spark.scale.setScalar(sparkCycle < 0.7 ? 0.02 + Math.random() * 0.02 : 0);
        (spark.material as THREE.MeshBasicMaterial).opacity = sparkCycle < 0.7 ? 0.9 : 0;
      }
    });
    
    // Light intensity
    if (lightRef.current) {
      lightRef.current.intensity = (flicker1 + flicker2) * 4;
    }
  });
  
  // Reset start time when becoming active
  if (isActive && Date.now() - startTimeRef.current > 5000) {
    startTimeRef.current = Date.now();
  }
  
  if (!isActive) return null;
  
  const thrusterOffset = 0.3;
  // Fixed position - moved up closer to player feet
  const yOffset = -0.5;
  
  return (
    <group ref={groupRef} position={[playerPosition.x, playerPosition.y + yOffset, playerPosition.z]}>
      {/* Left thruster assembly */}
      <group ref={leftFlameRef} position={[-thrusterOffset, 0, 0.05]}>
        {/* Thruster nozzle */}
        <mesh position={[0, 0.05, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.08, 0.08]}>
          <meshBasicMaterial color={0x333333} />
        </mesh>
        {/* White hot core */}
        <mesh position={[0, -0.15, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.06, 0.35, 0.06]}>
          <meshBasicMaterial color={0xffffff} transparent opacity={0.98} />
        </mesh>
        {/* Bright yellow inner */}
        <mesh position={[0, -0.3, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.5, 0.1]}>
          <meshBasicMaterial color={0xffffaa} transparent opacity={0.92} />
        </mesh>
        {/* Orange mid flame */}
        <mesh position={[0, -0.45, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.14, 0.7, 0.14]}>
          <meshBasicMaterial color={0xffaa00} transparent opacity={0.8} />
        </mesh>
        {/* Red outer flame */}
        <mesh position={[0, -0.6, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.2, 0.9, 0.2]}>
          <meshBasicMaterial color={0xff5500} transparent opacity={0.55} />
        </mesh>
        {/* Dark red tip */}
        <mesh position={[0, -0.75, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.25, 1.0, 0.25]}>
          <meshBasicMaterial color={0xcc2200} transparent opacity={0.3} />
        </mesh>
      </group>
      
      {/* Left glow */}
      <mesh ref={leftGlowRef} position={[-thrusterOffset, -0.3, 0.05]} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.35} />
      </mesh>
      
      {/* Right thruster assembly */}
      <group ref={rightFlameRef} position={[thrusterOffset, 0, 0.05]}>
        {/* Thruster nozzle */}
        <mesh position={[0, 0.05, 0]} geometry={SHARED_GEOMETRIES.cylinder8} scale={[0.08, 0.08, 0.08]}>
          <meshBasicMaterial color={0x333333} />
        </mesh>
        {/* White hot core */}
        <mesh position={[0, -0.15, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.06, 0.35, 0.06]}>
          <meshBasicMaterial color={0xffffff} transparent opacity={0.98} />
        </mesh>
        {/* Bright yellow inner */}
        <mesh position={[0, -0.3, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.1, 0.5, 0.1]}>
          <meshBasicMaterial color={0xffffaa} transparent opacity={0.92} />
        </mesh>
        {/* Orange mid flame */}
        <mesh position={[0, -0.45, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.14, 0.7, 0.14]}>
          <meshBasicMaterial color={0xffaa00} transparent opacity={0.8} />
        </mesh>
        {/* Red outer flame */}
        <mesh position={[0, -0.6, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.2, 0.9, 0.2]}>
          <meshBasicMaterial color={0xff5500} transparent opacity={0.55} />
        </mesh>
        {/* Dark red tip */}
        <mesh position={[0, -0.75, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.25, 1.0, 0.25]}>
          <meshBasicMaterial color={0xcc2200} transparent opacity={0.3} />
        </mesh>
      </group>
      
      {/* Right glow */}
      <mesh ref={rightGlowRef} position={[thrusterOffset, -0.3, 0.05]} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.35} />
      </mesh>
      
      {/* Smoke particles */}
      {JETPACK_SMOKE_PARTICLES.map((_, i) => (
        <mesh 
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x666666} transparent opacity={0.3} />
        </mesh>
      ))}
      
      {/* Sparks */}
      {[0, 1, 2, 3, 4, 5].map(i => (
        <mesh 
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffdd00} transparent opacity={0.9} />
        </mesh>
      ))}
      
      {/* Heat distortion ring at nozzles */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.1, 0.05]} geometry={SHARED_GEOMETRIES.ring16} scale={[0.5, 0.5, 1]}>
        <meshBasicMaterial color={0xff8800} transparent opacity={0.15} side={THREE.DoubleSide} />
      </mesh>
      
      <pointLight ref={lightRef} color={0xff6600} intensity={8} distance={12} decay={2} position={[0, -0.5, 0]} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (playerPosition)
  return (
    prev.isActive === next.isActive &&
    prev.playerPosition.x === next.playerPosition.x &&
    prev.playerPosition.y === next.playerPosition.y &&
    prev.playerPosition.z === next.playerPosition.z
  );
});

