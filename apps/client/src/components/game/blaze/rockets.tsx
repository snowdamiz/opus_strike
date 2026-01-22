import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import { useGameStore, type RocketData } from '../../../store/gameStore';
import { SHARED_GEOMETRIES } from '../effectResources';
import {
  getRocketBodyMaterial,
  getRocketNoseMaterial,
  getRocketFireCoreMaterial,
  getRocketFireInnerMaterial,
  getRocketFireOuterMaterial,
  getRocketSmokeMaterial,
} from './materials';

// ============================================================================
// ROCKET EFFECT - Individual rockets with good visuals
// Optimized by using shared geometries and minimal state
// ============================================================================

const MAX_ROCKETS = 30;
const ROCKET_LIFETIME = 5000;

// Pre-allocated vectors for rockets (local to avoid conflicts)
const _rocketPos = new THREE.Vector3();
const _rocketDir = new THREE.Vector3();
const _rocketLookAt = new THREE.Vector3();

interface RocketEffectProps {
  rocket: RocketData;
}

const RocketEffect = React.memo(({ rocket }: RocketEffectProps) => {
  const groupRef = useRef<THREE.Group>(null);
  
  // Get pre-cached materials once
  const materials = useMemo(() => ({
    body: getRocketBodyMaterial(),
    nose: getRocketNoseMaterial(),
    fireCore: getRocketFireCoreMaterial(),
    fireInner: getRocketFireInnerMaterial(),
    fireOuter: getRocketFireOuterMaterial(),
    smoke: getRocketSmokeMaterial(),
  }), []);
  
  useFrame(() => {
    if (!groupRef.current) return;
    
    const elapsed = (Date.now() - rocket.startTime) / 1000;
    
    // Update position with gravity
    _rocketPos.set(
      rocket.position.x + rocket.velocity.x * elapsed,
      rocket.position.y + rocket.velocity.y * elapsed - elapsed * elapsed,
      rocket.position.z + rocket.velocity.z * elapsed
    );
    groupRef.current.position.copy(_rocketPos);
    
    // Rotate to face velocity direction
    _rocketDir.set(rocket.velocity.x, rocket.velocity.y - 2 * elapsed, rocket.velocity.z).normalize();
    _rocketLookAt.copy(_rocketPos).add(_rocketDir);
    groupRef.current.lookAt(_rocketLookAt);
  });
  
  return (
    <group ref={groupRef}>
      {/* Rocket body - dark metallic */}
      <mesh rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.35, 0.08]} material={materials.body} />
      
      {/* Rocket nose - glowing orange */}
      <mesh position={[0, 0, -0.2]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.04, 0.08, 0.04]} material={materials.nose} />
      
      {/* Fire core - bright white/yellow */}
      <mesh position={[0, 0, 0.22]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.05, 0.35, 0.05]} material={materials.fireCore} />
      
      {/* Fire inner - bright orange */}
      <mesh position={[0, 0, 0.32]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.08, 0.45, 0.08]} material={materials.fireInner} />
      
      {/* Fire outer - red/orange */}
      <mesh position={[0, 0, 0.4]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone8} scale={[0.12, 0.5, 0.12]} material={materials.fireOuter} />
      
      {/* Smoke trail hint */}
      <mesh position={[0, 0, 0.55]} rotation={[Math.PI / 2, 0, 0]} geometry={SHARED_GEOMETRIES.cone6} scale={[0.15, 0.4, 0.15]} material={materials.smoke} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (rocket)
  return (
    prev.rocket.id === next.rocket.id &&
    prev.rocket.position.x === next.rocket.position.x &&
    prev.rocket.position.y === next.rocket.position.y &&
    prev.rocket.position.z === next.rocket.position.z &&
    prev.rocket.velocity.x === next.rocket.velocity.x &&
    prev.rocket.velocity.y === next.rocket.velocity.y &&
    prev.rocket.velocity.z === next.rocket.velocity.z &&
    prev.rocket.startTime === next.rocket.startTime
  );
});

// Rocket manager - renders rockets without individual lights for performance
export function RocketsManager() {
  const rockets = useGameStore(state => state.rockets);
  const lightRef = useRef<THREE.PointLight>(null);
  
  // Update single shared light position
  useFrame(() => {
    if (!lightRef.current || rockets.length === 0) {
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }
    
    const now = Date.now();
    let avgX = 0, avgY = 0, avgZ = 0;
    let count = 0;
    
    for (const rocket of rockets) {
      if (now - rocket.startTime < ROCKET_LIFETIME) {
        const elapsed = (now - rocket.startTime) / 1000;
        avgX += rocket.position.x + rocket.velocity.x * elapsed;
        avgY += rocket.position.y + rocket.velocity.y * elapsed - elapsed * elapsed;
        avgZ += rocket.position.z + rocket.velocity.z * elapsed;
        count++;
      }
    }
    
    if (count > 0) {
      lightRef.current.position.set(avgX / count, avgY / count, avgZ / count);
      lightRef.current.intensity = Math.min(count * 2, 10);
    } else {
      lightRef.current.intensity = 0;
    }
  });
  
  return (
    <group>
      {rockets.slice(0, MAX_ROCKETS).map(rocket => (
        <RocketEffect key={rocket.id} rocket={rocket} />
      ))}
      {/* Single shared light for all rockets */}
      <pointLight ref={lightRef} color={0xff6600} intensity={0} distance={12} decay={2} />
    </group>
  );
}

// ============================================================================
// ROCKET JUMP EXPLOSION - Optimized
// ============================================================================

interface RocketJumpExplosionData {
  id: string;
  position: { x: number; y: number; z: number };
  startTime: number;
}

const rocketJumpExplosions: RocketJumpExplosionData[] = [];
let explosionIdCounter = 0;

export function triggerRocketJumpExplosion(position: { x: number; y: number; z: number }) {
  rocketJumpExplosions.push({
    id: `rj_${explosionIdCounter++}`,
    position: { ...position },
    startTime: Date.now(),
  });
}

export const ROCKET_JUMP_DURATION = 900; // Longer for more dramatic effect

// Pre-generate spark directions for rocket jump
const ROCKET_JUMP_SPARKS = Array.from({ length: 12 }, (_, i) => ({
  angle: (i / 12) * Math.PI * 2 + Math.random() * 0.5,
  speed: 4 + Math.random() * 6,
  ySpeed: 6 + Math.random() * 8,
  size: 0.04 + Math.random() * 0.06,
}));

const RocketJumpExplosion = React.memo(({ explosion }: { explosion: RocketJumpExplosionData }) => {
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const midRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const sparkRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  
  useFrame(() => {
    const elapsed = Date.now() - explosion.startTime;
    if (elapsed > ROCKET_JUMP_DURATION) return;
    
    const progress = elapsed / ROCKET_JUMP_DURATION;
    const easeOut = 1 - Math.pow(1 - progress, 2);
    const easeOutQuart = 1 - Math.pow(1 - progress, 4);
    const fadeOut = Math.max(0, 1 - progress * 1.2);
    const fadeOutSlow = Math.max(0, 1 - progress);
    
    // Initial flash (very quick)
    if (flashRef.current) {
      const flashProgress = Math.min(1, elapsed / 80);
      const flashScale = 0.5 + flashProgress * 2;
      flashRef.current.scale.setScalar(flashScale);
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashProgress * 2);
    }
    
    // Core explosion
    if (coreRef.current) {
      const s = 0.4 + easeOut * 2.5;
      coreRef.current.scale.setScalar(s);
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.95;
    }
    if (midRef.current) {
      const s = 0.6 + easeOut * 3;
      midRef.current.scale.setScalar(s);
      (midRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.8;
    }
    if (outerRef.current) {
      const s = 0.8 + easeOut * 3.5;
      outerRef.current.scale.setScalar(s);
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
    }
    
    // Shockwave rings
    if (ringRef.current) {
      const s = 0.5 + easeOutQuart * 5;
      ringRef.current.scale.set(s, s, 1);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.7;
    }
    if (ring2Ref.current) {
      const s = 0.3 + easeOutQuart * 4;
      ring2Ref.current.scale.set(s, s, 1);
      (ring2Ref.current.material as THREE.MeshBasicMaterial).opacity = fadeOut * 0.5;
    }
    
    // Rising smoke puffs
    smokeRefs.current.forEach((smoke, i) => {
      if (smoke) {
        const smokeDelay = i * 50;
        const smokeElapsed = Math.max(0, elapsed - smokeDelay);
        const smokeProgress = Math.min(1, smokeElapsed / 600);
        const y = smokeProgress * (2 + i * 0.5);
        const smokeScale = 0.3 + smokeProgress * (0.8 + i * 0.2);
        smoke.position.y = y;
        smoke.scale.setScalar(smokeScale);
        (smoke.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.5 - smokeProgress * 0.5);
      }
    });
    
    // Flying sparks
    const t = elapsed / 1000;
    sparkRefs.current.forEach((spark, i) => {
      if (spark && i < ROCKET_JUMP_SPARKS.length) {
        const s = ROCKET_JUMP_SPARKS[i];
        const sparkX = Math.cos(s.angle) * s.speed * t;
        const sparkY = s.ySpeed * t - 15 * t * t;
        const sparkZ = Math.sin(s.angle) * s.speed * t;
        spark.position.set(sparkX, Math.max(-0.3, sparkY), sparkZ);
        spark.scale.setScalar(s.size * fadeOutSlow);
        (spark.material as THREE.MeshBasicMaterial).opacity = sparkY > 0 ? fadeOutSlow : 0;
      }
    });
    
    // Light
    if (lightRef.current) {
      lightRef.current.intensity = fadeOut * 25;
    }
  });
  
  const elapsed = Date.now() - explosion.startTime;
  if (elapsed > ROCKET_JUMP_DURATION) return null;
  
  return (
    <group ref={groupRef} position={[explosion.position.x, explosion.position.y - 0.3, explosion.position.z]}>
      {/* Initial bright flash */}
      <mesh ref={flashRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffff} transparent opacity={1} />
      </mesh>
      
      {/* Core - white hot */}
      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xffffcc} transparent opacity={0.95} />
      </mesh>
      
      {/* Mid - orange fire */}
      <mesh ref={midRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff8800} transparent opacity={0.8} />
      </mesh>
      
      {/* Outer - red fire */}
      <mesh ref={outerRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={0xff3300} transparent opacity={0.5} />
      </mesh>
      
      {/* Primary shockwave ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.1} geometry={SHARED_GEOMETRIES.ring24}>
        <meshBasicMaterial color={0xff6600} transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Secondary inner ring */}
      <mesh ref={ring2Ref} rotation-x={-Math.PI / 2} position-y={0.15} geometry={SHARED_GEOMETRIES.ring16}>
        <meshBasicMaterial color={0xffaa00} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Rising smoke puffs */}
      {[0, 1, 2, 3].map(i => (
        <mesh 
          key={`smoke-${i}`}
          ref={el => smokeRefs.current[i] = el}
          position={[Math.sin(i * 1.5) * 0.3, 0, Math.cos(i * 1.5) * 0.3]}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0x555555} transparent opacity={0.4} />
        </mesh>
      ))}
      
      {/* Flying sparks */}
      {ROCKET_JUMP_SPARKS.map((_, i) => (
        <mesh 
          key={`spark-${i}`}
          ref={el => sparkRefs.current[i] = el}
          geometry={SHARED_GEOMETRIES.sphere8}
        >
          <meshBasicMaterial color={0xffcc00} transparent opacity={1} />
        </mesh>
      ))}
      
      {/* Ground scorch */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.02} geometry={SHARED_GEOMETRIES.circle16} scale={[1.5, 1.5, 1]}>
        <meshBasicMaterial color={0x331100} transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      
      <pointLight ref={lightRef} color={0xff5500} intensity={25} distance={15} decay={2} />
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (explosion)
  return (
    prev.explosion.id === next.explosion.id &&
    prev.explosion.position.x === next.explosion.position.x &&
    prev.explosion.position.y === next.explosion.position.y &&
    prev.explosion.position.z === next.explosion.position.z &&
    prev.explosion.startTime === next.explosion.startTime
  );
});

// Hook to manage rocket jump explosions
export function useRocketJumpExplosions() {
  const [activeExplosions, setActiveExplosions] = useState<RocketJumpExplosionData[]>([]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const active = rocketJumpExplosions.filter(e => now - e.startTime < ROCKET_JUMP_DURATION);
      rocketJumpExplosions.length = 0;
      rocketJumpExplosions.push(...active);
      setActiveExplosions([...active]);
    }, 150);
    
    return () => clearInterval(interval);
  }, []);
  
  return activeExplosions;
}

export function RocketJumpExplosions() {
  const activeExplosions = useRocketJumpExplosions();
  
  return (
    <>
      {activeExplosions.map(explosion => (
        <RocketJumpExplosion key={explosion.id} explosion={explosion} />
      ))}
    </>
  );
}

