import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getRiftMaterial, getTrailMaterial, BLINK_EFFECT_DURATION } from './materials';

// ============================================================================
// PHANTOM BLINK TELEPORT EFFECT
// A dramatic void rift effect that appears during teleportation
// ============================================================================

interface BlinkTeleportEffectProps {
  startPosition: { x: number; y: number; z: number };
  endPosition: { x: number; y: number; z: number };
  startTime: number;
}

export function BlinkTeleportEffect({ startPosition, endPosition, startTime }: BlinkTeleportEffectProps) {
  const startGroupRef = useRef<THREE.Group>(null);
  const endGroupRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Points>(null);
  
  const riftMaterial = useMemo(() => getRiftMaterial().clone(), []);
  const trailMaterial = useMemo(() => getTrailMaterial().clone(), []);
  
  // Create particle geometry for energy trail
  const trailParticles = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const particleCount = 50;
    const positions = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    const randoms = new Float32Array(particleCount);
    
    const start = new THREE.Vector3(startPosition.x, startPosition.y, startPosition.z);
    const end = new THREE.Vector3(endPosition.x, endPosition.y, endPosition.z);
    
    for (let i = 0; i < particleCount; i++) {
      const t = i / particleCount;
      const pos = start.clone().lerp(end, t);
      // Add some random offset for width
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5,
        (Math.random() - 0.5) * 0.5
      );
      pos.add(offset);
      
      positions[i * 3] = pos.x;
      positions[i * 3 + 1] = pos.y;
      positions[i * 3 + 2] = pos.z;
      sizes[i] = Math.random() * 0.15 + 0.05;
      randoms[i] = Math.random();
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    
    return geometry;
  }, [startPosition, endPosition]);
  
  // Burst particles at start and end
  const burstParticles = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const particleCount = 30;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const sizes = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = Math.random() * 3 + 2;
      
      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
      velocities[i * 3 + 1] = Math.cos(phi) * speed;
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
      
      positions[i * 3] = 0;
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = 0;
      
      sizes[i] = Math.random() * 0.2 + 0.1;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    return geometry;
  }, []);
  
  const particleMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0xc084fc,
    size: 0.15,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);
  
  useFrame((_, delta) => {
    const elapsed = (Date.now() - startTime);
    const progress = Math.min(1, elapsed / BLINK_EFFECT_DURATION);
    
    // Update shader uniforms
    if (riftMaterial.uniforms) {
      riftMaterial.uniforms.time.value += delta;
      riftMaterial.uniforms.progress.value = progress;
    }
    if (trailMaterial.uniforms) {
      trailMaterial.uniforms.time.value += delta;
      trailMaterial.uniforms.progress.value = progress;
    }
    
    // Animate start rift - expand then collapse
    if (startGroupRef.current) {
      const startScale = progress < 0.3 
        ? progress / 0.3 
        : 1 - (progress - 0.3) / 0.7;
      startGroupRef.current.scale.setScalar(Math.max(0.01, startScale * 2));
      startGroupRef.current.rotation.z += delta * 5;
    }
    
    // Animate end rift - delayed appearance
    if (endGroupRef.current) {
      const endProgress = Math.max(0, (progress - 0.2) / 0.8);
      const endScale = endProgress < 0.4 
        ? endProgress / 0.4 
        : 1 - (endProgress - 0.4) / 0.6;
      endGroupRef.current.scale.setScalar(Math.max(0.01, endScale * 2));
      endGroupRef.current.rotation.z -= delta * 5;
      endGroupRef.current.visible = progress > 0.1;
    }
    
    // Animate trail particles
    if (trailRef.current) {
      const positions = trailRef.current.geometry.attributes.position;
      const randoms = trailRef.current.geometry.attributes.random;
      const time = Date.now() * 0.001;
      
      for (let i = 0; i < positions.count; i++) {
        const r = (randoms as THREE.BufferAttribute).getX(i);
        // Add some floating motion
        positions.setY(i, positions.getY(i) + Math.sin(time * 5 + r * 10) * 0.01);
      }
      positions.needsUpdate = true;
      
      (trailRef.current.material as THREE.PointsMaterial).opacity = (1 - progress) * 0.8;
    }
  });
  
  if ((Date.now() - startTime) > BLINK_EFFECT_DURATION) return null;
  
  return (
    <group>
      {/* Start position rift */}
      <group ref={startGroupRef} position={[startPosition.x, startPosition.y, startPosition.z]}>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[1.5, 64]} />
          <primitive object={riftMaterial} />
        </mesh>
        {/* Vertical energy pillar */}
        <mesh>
          <cylinderGeometry args={[0.3, 0.5, 3, 16, 1, true]} />
          <meshBasicMaterial 
            color={0x7c3aed}
            transparent
            opacity={0.4}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      
      {/* End position rift */}
      <group ref={endGroupRef} position={[endPosition.x, endPosition.y, endPosition.z]}>
        <mesh rotation-x={-Math.PI / 2}>
          <circleGeometry args={[1.5, 64]} />
          <primitive object={riftMaterial.clone()} />
        </mesh>
        {/* Arrival energy burst */}
        <points geometry={burstParticles}>
          <primitive object={particleMaterial} />
        </points>
      </group>
      
      {/* Trail particles connecting start and end */}
      <points ref={trailRef} geometry={trailParticles}>
        <pointsMaterial 
          color={0xc084fc}
          size={0.1}
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

