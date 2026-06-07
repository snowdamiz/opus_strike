import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import { getFrameClock } from '../../../utils/frameClock';
import { SHARED_GEOMETRIES } from '../effectResources';
import { getShadowArrivalMaterial, SHADOW_ARRIVAL_DURATION } from './materials';

// ============================================================================
// SHADOW STEP ARRIVAL EFFECT
// Dramatic shadow materialization when teleporting via Shadow Step
// ============================================================================

interface ShadowStepArrivalProps {
  position: { x: number; y: number; z: number };
  startTime: number;
}

export const ShadowStepArrivalEffect = React.memo(({ position, startTime }: ShadowStepArrivalProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const shadowRef = useRef<THREE.Mesh>(null);
  const ringsRef = useRef<THREE.Group>(null);
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - startTime));
  
  const shadowMaterial = useMemo(() => getShadowArrivalMaterial().clone(), []);
  const ringMaterials = useMemo(() => (
    Array.from({ length: 3 }, () => new THREE.MeshBasicMaterial({
      color: 0x7c3aed,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }))
  ), []);
  const groundMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x1a0033,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  }), []);

  useEffect(() => () => {
    shadowMaterial.dispose();
    ringMaterials.forEach(material => material.dispose());
    groundMaterial.dispose();
  }, [groundMaterial, ringMaterials, shadowMaterial]);
  
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
    const elapsed = getFrameClock().nowMs - startFrameTimeRef.current;
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
        const material = (ring as THREE.Mesh).material as THREE.MeshBasicMaterial;
        material.opacity = Math.max(0, 0.5 - ringProgress * 0.5);
      });
    }
  });
  
  return (
    <group ref={groupRef} position={[position.x, position.y - 0.9, position.z]}>
      {/* Ground shadow tendrils */}
      {tendrilPositions.map((t, i) => (
        <mesh 
          key={i}
          position={[t.x, 1, t.z]}
          rotation-y={t.rotation}
          scale={[t.scale * 0.25, t.scale * 4, 1]}
          geometry={SHARED_GEOMETRIES.plane}
        >
          <primitive object={shadowMaterial} />
        </mesh>
      ))}
      
      {/* Central shadow column */}
      <mesh ref={shadowRef} geometry={SHARED_GEOMETRIES.cylinderOpen16} scale={[0.65, 3, 0.65]}>
        <primitive object={shadowMaterial} />
      </mesh>
      
      {/* Expanding rings */}
      <group ref={ringsRef}>
        {[0, 1, 2].map(i => (
          <mesh key={i} rotation-x={-Math.PI / 2} position-y={0.1 + i * 0.1} geometry={SHARED_GEOMETRIES.ring32}>
            <primitive object={ringMaterials[i]} />
          </mesh>
        ))}
      </group>
      
      {/* Ground impact circle */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} geometry={SHARED_GEOMETRIES.circle32} scale={[1.5, 1.5, 1]}>
        <primitive object={groundMaterial} />
      </mesh>
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (position)
  return (
    prev.position.x === next.position.x &&
    prev.position.y === next.position.y &&
    prev.position.z === next.position.z &&
    prev.startTime === next.startTime
  );
});
