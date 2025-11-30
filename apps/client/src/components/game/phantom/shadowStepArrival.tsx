import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getShadowArrivalMaterial, SHADOW_ARRIVAL_DURATION } from './materials';

// ============================================================================
// SHADOW STEP ARRIVAL EFFECT
// Dramatic shadow materialization when teleporting via Shadow Step
// ============================================================================

interface ShadowStepArrivalProps {
  position: { x: number; y: number; z: number };
  startTime: number;
}

export function ShadowStepArrivalEffect({ position, startTime }: ShadowStepArrivalProps) {
  const groupRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const ringsRef = useRef<THREE.Group>(null);
  
  const shadowMaterial = useMemo(() => getShadowArrivalMaterial().clone(), []);
  
  // Create multiple rising shadow tendrils
  const tendrilPositions = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const angle = (i / 8) * Math.PI * 2;
      const r = 0.8 + Math.random() * 0.3;
      return {
        x: Math.cos(angle) * r,
        z: Math.sin(angle) * r,
        rotation: Math.random() * Math.PI * 2,
        scale: 0.7 + Math.random() * 0.6,
      };
    });
  }, []);
  
  useFrame((_, delta) => {
    const elapsed = Date.now() - startTime;
    const progress = Math.min(1, elapsed / SHADOW_ARRIVAL_DURATION);
    
    if (shadowMaterial.uniforms) {
      shadowMaterial.uniforms.time.value += delta;
      shadowMaterial.uniforms.progress.value = progress;
    }
    
    if (groupRef.current) {
      // Fade out at the end
      groupRef.current.visible = progress < 1;
    }
    
    // Animate expanding rings
    if (ringsRef.current) {
      ringsRef.current.children.forEach((ring, i) => {
        const ringProgress = Math.max(0, progress - i * 0.15);
        const scale = 1 + ringProgress * 3;
        ring.scale.setScalar(scale);
        (ring as THREE.Mesh).material = new THREE.MeshBasicMaterial({
          color: 0x7c3aed,
          transparent: true,
          opacity: Math.max(0, 0.5 - ringProgress * 0.5),
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        });
      });
    }
  });
  
  if ((Date.now() - startTime) > SHADOW_ARRIVAL_DURATION) return null;
  
  return (
    <group ref={groupRef} position={[position.x, position.y - 0.9, position.z]}>
      {/* Ground shadow tendrils */}
      {tendrilPositions.map((t, i) => (
        <mesh 
          key={i}
          position={[t.x, 1, t.z]}
          rotation-y={t.rotation}
          scale={[t.scale * 0.5, t.scale * 2, 1]}
        >
          <planeGeometry args={[0.5, 2]} />
          <primitive object={shadowMaterial} />
        </mesh>
      ))}
      
      {/* Central shadow column */}
      <mesh ref={shadowRef}>
        <cylinderGeometry args={[0.5, 0.8, 3, 16, 4, true]} />
        <primitive object={shadowMaterial} />
      </mesh>
      
      {/* Expanding rings */}
      <group ref={ringsRef}>
        {[0, 1, 2].map(i => (
          <mesh key={i} rotation-x={-Math.PI / 2} position-y={0.1 + i * 0.1}>
            <ringGeometry args={[0.5, 0.7, 32]} />
            <meshBasicMaterial 
              color={0x7c3aed}
              transparent
              opacity={0.5}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
      
      {/* Ground impact circle */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
        <circleGeometry args={[1.5, 32]} />
        <meshBasicMaterial 
          color={0x1a0033}
          transparent
          opacity={0.7}
        />
      </mesh>
    </group>
  );
}

