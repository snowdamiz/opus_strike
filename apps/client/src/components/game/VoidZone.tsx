import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';
import { damageNpc } from '../ui/GameConsole';

interface VoidZoneProps {
  position: { x: number; y: number; z: number };
  radius: number;
  duration: number;
  startTime: number;
  ownerId: string;
}

// PERFORMANCE: Shared vortex shader material (compiled once)
let sharedVortexMaterial: THREE.ShaderMaterial | null = null;

function getSharedVortexMaterial(): THREE.ShaderMaterial {
  if (!sharedVortexMaterial) {
    sharedVortexMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        opacity: { value: 1 },
        color1: { value: new THREE.Color(0x1a0033) },
        color2: { value: new THREE.Color(0x7c3aed) },
        color3: { value: new THREE.Color(0x0f0f23) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float opacity;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        varying vec2 vUv;
        void main() {
          vec2 center = vec2(0.5, 0.5);
          vec2 uv = vUv - center;
          float dist = length(uv);
          float angle = atan(uv.y, uv.x);
          float swirl = sin(angle * 8.0 + time * 3.0 - dist * 15.0) * 0.5 + 0.5;
          float swirl2 = sin(angle * 5.0 - time * 2.0 + dist * 10.0) * 0.5 + 0.5;
          float radialGrad = smoothstep(0.0, 0.5, dist);
          vec3 color = mix(color3, color1, radialGrad);
          color = mix(color, color2, swirl * swirl2 * (1.0 - dist * 1.5));
          float edgeRing = smoothstep(0.45, 0.48, dist) * smoothstep(0.52, 0.48, dist);
          color += color2 * edgeRing * 2.0;
          float alpha = smoothstep(0.5, 0.3, dist) * opacity;
          float pulse = sin(time * 4.0) * 0.15 + 0.85;
          alpha *= pulse;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  return sharedVortexMaterial;
}

// Pre-compile shader on module load
if (typeof window !== 'undefined') {
  requestAnimationFrame(() => getSharedVortexMaterial());
}

const PARTICLE_COUNT = 20; // Reduced from 50 for performance
const VOID_ZONE_DAMAGE = 15; // Damage per tick
const VOID_ZONE_DAMAGE_INTERVAL = 500; // ms between damage ticks

/**
 * VoidZone - A black hole-like damage zone that appears on the ground
 * Visual style: Purple/void themed, swirling dark vortex effect
 * PERFORMANCE: Shared shader, reduced particles, no point lights
 */
export function VoidZone({ position, radius, duration, startTime, ownerId }: VoidZoneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const innerRingRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  const vortexRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const lastParticleUpdateRef = useRef(0);
  const lastDamageTickRef = useRef<Map<string, number>>(new Map());
  
  // Calculate remaining time for fade out effect
  const getProgress = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    return Math.min(1, elapsed / duration);
  };

  // Get shared material
  const vortexMaterial = getSharedVortexMaterial();

  // Create particle geometry for floating debris - reduced count
  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.9;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.random() * 1.5;
      positions[i * 3 + 2] = Math.sin(angle) * r;
      sizes[i] = Math.random() * 0.1 + 0.05;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    return geometry;
  }, [radius]);

  const particleMaterial = useMemo(() => {
    return new THREE.PointsMaterial({
      color: 0xa855f7,
      size: 0.15,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }, []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const progress = getProgress();
    
    // Hide when duration expired (early exit)
    if (progress >= 1) {
      groupRef.current.visible = false;
      return;
    }
    
    const fadeOut = progress > 0.7 ? 1 - ((progress - 0.7) / 0.3) : 1;
    const fadeIn = Math.min(1, progress * 5);
    const currentOpacity = fadeIn * fadeOut;

    // Update vortex shader
    if (vortexMaterial.uniforms) {
      vortexMaterial.uniforms.time.value += delta;
      vortexMaterial.uniforms.opacity.value = currentOpacity;
    }

    // Rotate inner ring (clockwise)
    if (innerRingRef.current) {
      innerRingRef.current.rotation.z -= delta * 2;
      (innerRingRef.current.material as THREE.MeshBasicMaterial).opacity = currentOpacity * 0.7;
    }

    // Rotate outer ring (counter-clockwise)
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z += delta * 1.5;
      (outerRingRef.current.material as THREE.MeshBasicMaterial).opacity = currentOpacity * 0.5;
    }

    // Check for enemy damage (NPCs and players)
    const now = Date.now();
    const { players, localPlayer } = useGameStore.getState();
    
    for (const [playerId, player] of players) {
      // Skip self
      if (playerId === localPlayer?.id) continue;
      
      // Skip dead players
      if (player.state !== 'alive') continue;
      
      // Skip same team
      if (localPlayer && player.team === localPlayer.team) continue;
      
      // Check if player is in the zone
      const dx = player.position.x - position.x;
      const dz = player.position.z - position.z;
      const distSq = dx * dx + dz * dz;
      
      if (distSq <= radius * radius) {
        // Check damage interval
        const lastDamage = lastDamageTickRef.current.get(playerId) || 0;
        if (now - lastDamage >= VOID_ZONE_DAMAGE_INTERVAL) {
          lastDamageTickRef.current.set(playerId, now);
          
          // Only damage NPCs client-side (real players handled by server)
          if (playerId.startsWith('npc_')) {
            const result = damageNpc(playerId, VOID_ZONE_DAMAGE);
            if (result) {
              console.log(`[VoidZone] Hit ${result.npcName} for ${VOID_ZONE_DAMAGE} damage${result.killed ? ' - ELIMINATED!' : ''}`);
            }
          }
        }
      }
    }

    // PERFORMANCE: Throttle particle animation to every 100ms
    if (particlesRef.current && now - lastParticleUpdateRef.current > 100) {
      lastParticleUpdateRef.current = now;
      const positions = particlesRef.current.geometry.attributes.position;
      const time = now * 0.001;
      const fixedDelta = 0.1; // Fixed timestep for consistency
      
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        const dist = Math.sqrt(x * x + z * z);
        const angle = Math.atan2(z, x);
        
        const newAngle = angle + fixedDelta * (2 + (1 - dist / radius) * 3);
        const newDist = dist - fixedDelta * 0.3;
        const finalDist = newDist < 0.1 ? radius * 0.8 + Math.random() * radius * 0.2 : newDist;
        
        positions.setX(i, Math.cos(newAngle) * finalDist);
        positions.setZ(i, Math.sin(newAngle) * finalDist);
        positions.setY(i, (Math.sin(time + i) * 0.3 + 0.5) * (1 - finalDist / radius));
      }
      positions.needsUpdate = true;
      particleMaterial.opacity = currentOpacity * 0.8;
    }
  });

  return (
    <group ref={groupRef} position={[position.x, position.y + 0.05, position.z]}>
      {/* Main vortex disc */}
      <mesh ref={vortexRef} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[radius, 64]} />
        <primitive object={vortexMaterial} />
      </mesh>

      {/* Inner rotating ring with dashes */}
      <mesh ref={innerRingRef} rotation-x={-Math.PI / 2} position-y={0.02}>
        <ringGeometry args={[radius * 0.3, radius * 0.4, 32]} />
        <meshBasicMaterial 
          color={0x7c3aed} 
          transparent 
          opacity={0.7}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Outer rotating ring */}
      <mesh ref={outerRingRef} rotation-x={-Math.PI / 2} position-y={0.01}>
        <ringGeometry args={[radius * 0.85, radius * 0.95, 48]} />
        <meshBasicMaterial 
          color={0xa855f7} 
          transparent 
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Edge glow ring */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
        <ringGeometry args={[radius * 0.98, radius * 1.02, 64]} />
        <meshBasicMaterial 
          color={0xc084fc} 
          transparent 
          opacity={0.8}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* Floating particles */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <primitive object={particleMaterial} />
      </points>

      {/* Center dark void - reduced geometry */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
        <circleGeometry args={[radius * 0.15, 16]} />
        <meshBasicMaterial 
          color={0x0a0015} 
          transparent 
          opacity={0.95}
        />
      </mesh>

      {/* PERFORMANCE: Removed point light - the shader provides enough glow effect */}
    </group>
  );
}

// Container component to render all active void zones
interface VoidZoneData {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  duration: number;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

interface VoidZonesProps {
  zones: VoidZoneData[];
}

export function VoidZones({ zones }: VoidZonesProps) {
  const clearExpiredVoidZones = useGameStore(state => state.clearExpiredVoidZones);
  
  // Periodically clean up expired zones from the store
  useEffect(() => {
    const interval = setInterval(() => {
      clearExpiredVoidZones();
    }, 1000); // Clean up every second
    
    return () => clearInterval(interval);
  }, [clearExpiredVoidZones]);
  
  // Filter out expired zones for rendering
  const now = Date.now();
  const activeZones = zones.filter(zone => {
    const elapsed = (now - zone.startTime) / 1000;
    return elapsed < zone.duration;
  });

  return (
    <>
      {activeZones.map((zone) => (
        <VoidZone
          key={zone.id}
          position={zone.position}
          radius={zone.radius}
          duration={zone.duration}
          startTime={zone.startTime}
          ownerId={zone.ownerId}
        />
      ))}
    </>
  );
}

