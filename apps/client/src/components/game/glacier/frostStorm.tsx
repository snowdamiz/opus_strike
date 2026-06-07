import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../store/gameStore';
import { SHARED_GEOMETRIES } from '../effectResources';
import {
  GLACIER_COLORS,
  getFrostStormMaterials,
} from './materials';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';

// ============================================================================
// FROST STORM EFFECT - Glacier Q ability visual (snow storm around player)
// ============================================================================

const FROST_STORM_PARTICLE_COUNT = 60;
const FROST_STORM_RADIUS = 2.5;
const FROST_STORM_HEIGHT = 3.5;
const FROST_STORM_RING_GEOMETRY = new THREE.RingGeometry(FROST_STORM_RADIUS * 0.8, FROST_STORM_RADIUS * 1.2, 32);
const FROST_STORM_INNER_GEOMETRY = new THREE.SphereGeometry(FROST_STORM_RADIUS * 0.6, 16, 16);
const FROST_STORM_RING_MATERIAL = new THREE.MeshBasicMaterial({
  color: GLACIER_COLORS.iceGlow,
  transparent: true,
  opacity: 0.15,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const FROST_STORM_INNER_MATERIAL = new THREE.MeshBasicMaterial({
  color: GLACIER_COLORS.iceCrystal,
  transparent: true,
  opacity: 0.1,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

// Particle initial positions
interface FrostStormParticle {
  angle: number;
  height: number;
  radius: number;
  speed: number;
  size: number;
  type: 'snow' | 'ice';
}

export const FrostStormEffect = React.memo(function FrostStormEffect() {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const particleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const glowRingRef = useRef<THREE.Mesh>(null);
  const innerGlowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  
  const frostStormStartTime = useGameStore(state => state.frostStormStartTime);
  const frostStormShield = useGameStore(state => state.frostStormShield);
  const localPlayer = useGameStore(state => state.localPlayer);
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - frostStormStartTime));
  
  const { frostStormParticleMaterial, frostStormSnowMaterial } = getFrostStormMaterials();
  
  // Generate particle configs once
  const particleConfigs = useRef<FrostStormParticle[]>([]);
  if (particleConfigs.current.length === 0) {
    for (let i = 0; i < FROST_STORM_PARTICLE_COUNT; i++) {
      particleConfigs.current.push({
        angle: (i / FROST_STORM_PARTICLE_COUNT) * Math.PI * 2,
        height: Math.random() * FROST_STORM_HEIGHT,
        radius: FROST_STORM_RADIUS * (0.5 + Math.random() * 0.5),
        speed: 2 + Math.random() * 3,
        size: 0.04 + Math.random() * 0.06,
        type: Math.random() > 0.4 ? 'snow' : 'ice',
      });
    }
  }
  
  useFrame(() => {
    if (!groupRef.current || !localPlayer) return;
    
    const elapsed = (getFrameClock().nowMs - startFrameTimeRef.current) / 1000;
    
    // Follow player position (first person - use camera position)
    groupRef.current.position.set(
      camera.position.x,
      camera.position.y - 0.9, // Center storm around player body
      camera.position.z
    );
    
    // Calculate intensity based on shield remaining (75 max)
    const shieldIntensity = frostStormShield / 75;
    const fadeIn = Math.min(elapsed * 2, 1); // Fade in over 0.5 seconds
    const intensity = fadeIn * shieldIntensity;
    
    // Update particles - spiral motion
    for (let i = 0; i < particleRefs.current.length; i++) {
      const particle = particleRefs.current[i];
      const config = particleConfigs.current[i];
      if (!particle || !config) continue;
      
      const time = elapsed * config.speed + config.angle;
      const heightOscillation = Math.sin(time * 0.5 + i) * 0.3;
      
      // Spiral outward and upward
      const currentRadius = config.radius * (0.8 + Math.sin(time * 0.3) * 0.2);
      const x = Math.cos(time) * currentRadius;
      const z = Math.sin(time) * currentRadius;
      const y = (config.height + heightOscillation + elapsed * 0.5) % FROST_STORM_HEIGHT;
      
      particle.position.set(x, y, z);
      particle.scale.setScalar(config.size * intensity * (0.8 + Math.sin(time * 2) * 0.2));
      
      // Fade based on height (particles fade as they rise)
      const heightFade = 1 - (y / FROST_STORM_HEIGHT) * 0.5;
      const mat = particle.material as THREE.MeshBasicMaterial;
      mat.opacity = (config.type === 'snow' ? 0.8 : 0.7) * intensity * heightFade;
    }
    
    // Update glow ring
    if (glowRingRef.current) {
      glowRingRef.current.scale.setScalar(1 + Math.sin(elapsed * 3) * 0.1);
      const glowMat = glowRingRef.current.material as THREE.MeshBasicMaterial;
      glowMat.opacity = 0.15 * intensity * (0.8 + Math.sin(elapsed * 2) * 0.2);
    }
    
    // Update inner glow
    if (innerGlowRef.current) {
      innerGlowRef.current.scale.setScalar(0.8 + Math.sin(elapsed * 4) * 0.1);
      const innerMat = innerGlowRef.current.material as THREE.MeshBasicMaterial;
      innerMat.opacity = 0.2 * intensity;
    }
    
    // Update light
    if (lightRef.current) {
      lightRef.current.intensity = 2 * intensity * (0.9 + Math.sin(elapsed * 5) * 0.1);
    }
  });
  
  return (
    <group ref={groupRef}>
      {/* Glow ring around player */}
      <mesh
        ref={glowRingRef}
        geometry={FROST_STORM_RING_GEOMETRY}
        material={FROST_STORM_RING_MATERIAL}
        rotation={[-Math.PI / 2, 0, 0]}
      />
      
      {/* Inner glow sphere */}
      <mesh
        ref={innerGlowRef}
        geometry={FROST_STORM_INNER_GEOMETRY}
        material={FROST_STORM_INNER_MATERIAL}
      />
      
      {/* Storm particles */}
      {particleConfigs.current.map((config, i) => (
        <mesh
          key={i}
          ref={el => particleRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere4}
          material={config.type === 'snow' ? frostStormSnowMaterial! : frostStormParticleMaterial!}
        />
      ))}
      
      {/* Light source */}
      <BudgetedPointLight
        budgetPriority={3}
        ref={lightRef}
        color={GLACIER_COLORS.iceLight}
        intensity={2}
        distance={6}
        decay={2}
        position={[0, 1.5, 0]}
      />
    </group>
  );
});
