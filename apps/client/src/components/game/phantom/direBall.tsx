import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import { useGameStore } from '../../../store/gameStore';
import { getPhysicsWorld, isPhysicsReady, raycast } from '../../../hooks/usePhysics';
import { damageNpc } from '../../ui/GameConsole';

interface DireBallProps {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
}

// PERFORMANCE: Pre-compiled shared materials (cached across all DireBall instances)
// This prevents shader compilation hitches when spawning new projectiles
let sharedCoreMaterial: THREE.ShaderMaterial | null = null;
let sharedGlowMaterial: THREE.ShaderMaterial | null = null;
let sharedParticleMaterial: THREE.PointsMaterial | null = null;

function getSharedCoreMaterial(): THREE.ShaderMaterial {
  if (!sharedCoreMaterial) {
    sharedCoreMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0x0a0015) }, // Deep void
        color2: { value: new THREE.Color(0x7c3aed) }, // Violet
        color3: { value: new THREE.Color(0xc084fc) }, // Light purple
        color4: { value: new THREE.Color(0x00ffff) }, // Cyan accent
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vUv = uv;
          vPosition = position;
          
          // Subtle distortion
          vec3 pos = position;
          float wave = sin(position.x * 15.0 + time * 10.0) * 0.02;
          pos += normal * wave;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 color4;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
        }
        
        float noise(vec3 p) {
          vec3 i = floor(p);
          vec3 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z
          );
        }
        
        void main() {
          vec3 viewDir = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.5);
          
          // Swirling void patterns
          float swirl1 = sin(vPosition.x * 12.0 + time * 8.0) * 
                        cos(vPosition.y * 10.0 - time * 6.0) * 
                        sin(vPosition.z * 14.0 + time * 5.0);
          swirl1 = swirl1 * 0.5 + 0.5;
          
          float swirl2 = cos(vPosition.x * 8.0 - time * 7.0) * 
                        sin(vPosition.y * 12.0 + time * 4.0);
          swirl2 = swirl2 * 0.5 + 0.5;
          
          // Energy pulses
          float pulse = sin(time * 15.0 + vPosition.y * 20.0) * 0.3 + 0.7;
          float fastPulse = sin(time * 30.0) * 0.15 + 0.85;
          
          // Fractal noise for chaotic energy
          float n = noise(vPosition * 15.0 + time * 3.0);
          n += noise(vPosition * 30.0 - time * 5.0) * 0.5;
          
          // Build color layers
          vec3 baseColor = color1;
          baseColor = mix(baseColor, color2, swirl1 * 0.8);
          baseColor = mix(baseColor, color3, swirl2 * swirl1 * 0.6);
          
          // Cyan energy core
          float core = pow(1.0 - length(vPosition) * 3.0, 2.0);
          baseColor = mix(baseColor, color4, core * 0.5 * pulse);
          
          // Fresnel edge glow
          baseColor += color3 * fresnel * 1.8;
          baseColor += color4 * fresnel * n * 0.5;
          
          // Lightning crackle
          float lightning = step(0.85, noise(vPosition * 50.0 + time * 20.0));
          baseColor += color4 * lightning * 2.0;
          
          // Flickering
          float flicker = 0.8 + hash(vec3(time * 50.0, 0.0, 0.0)) * 0.2;
          baseColor *= flicker * fastPulse;
          
          // Boost brightness
          baseColor *= 1.3;
          
          gl_FragColor = vec4(baseColor, 1.0);
        }
      `,
      side: THREE.FrontSide,
    });
  }
  return sharedCoreMaterial;
}

function getSharedGlowMaterial(): THREE.ShaderMaterial {
  if (!sharedGlowMaterial) {
    sharedGlowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color1: { value: new THREE.Color(0x7c3aed) },
        color2: { value: new THREE.Color(0xc084fc) },
        color3: { value: new THREE.Color(0x00ffff) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          
          // Breathing glow
          vec3 pos = position;
          float breathe = sin(time * 5.0) * 0.05 + 1.0;
          pos *= breathe;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        varying vec3 vNormal;
        varying vec3 vPosition;
        
        void main() {
          // Multi-layer pulsing
          float pulse1 = sin(time * 10.0) * 0.2 + 0.8;
          float pulse2 = sin(time * 15.0 + vPosition.y * 10.0) * 0.15 + 0.85;
          
          // Fresnel glow
          float fresnel = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          
          // Swirling color
          float swirl = sin(vPosition.x * 10.0 + time * 8.0) * 0.5 + 0.5;
          
          vec3 color = mix(color1, color2, swirl);
          color = mix(color, color3, fresnel * pulse2 * 0.3);
          
          float alpha = fresnel * pulse1 * pulse2 * 0.7;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedGlowMaterial;
}

function getSharedParticleMaterial(): THREE.PointsMaterial {
  if (!sharedParticleMaterial) {
    sharedParticleMaterial = new THREE.PointsMaterial({
      color: 0x9333ea,
      size: 0.08,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedParticleMaterial;
}

// Pre-compile shaders on module load (before any DireBall is spawned)
if (typeof window !== 'undefined') {
  // Defer shader compilation to after first frame
  requestAnimationFrame(() => {
    getSharedCoreMaterial();
    getSharedGlowMaterial();
    getSharedParticleMaterial();
  });
}

const LIFETIME = 3;
const BALL_RADIUS = 0.21; // Reduced 30% from 0.3 for better gameplay feel
const PARTICLE_COUNT = 15; // Reduced from 30 for performance
const PROJECTILE_DAMAGE = 35; // Damage dealt to NPCs on hit
const NPC_HIT_RADIUS = 1.2; // Radius for NPC collision detection (accounts for player hitbox)

/**
 * DireBall - A dark magic fireball projectile
 * Visual style: Purple/black flaming sphere with swirling dark energy
 * PERFORMANCE: Uses shared materials, no point lights, reduced particles
 * Wrapped in React.memo to prevent cascading re-renders from parent updates
 */
export const DireBall = React.memo(({ id, position, velocity, startTime, ownerId }: DireBallProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const outerGlowRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const hasCollided = useRef(false);
  const hasLoggedOnce = useRef(false);
  
  // Current position (updated each frame based on velocity)
  const currentPos = useRef({ x: position.x, y: position.y, z: position.z });
  const timeRef = useRef(0);
  
  // Get removeDireBall action from store
  const removeDireBall = useGameStore(state => state.removeDireBall);
  
  
  // Get shared materials (no shader compilation on spawn)
  const coreMaterial = getSharedCoreMaterial();
  const glowMaterial = getSharedGlowMaterial();
  const particleMaterial = getSharedParticleMaterial();
  
  // Trailing particles - reduced count
  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const r = BALL_RADIUS * (0.5 + Math.random() * 1.5);
      
      positions[i * 3] = -Math.random() * 1.5;
      positions[i * 3 + 1] = Math.sin(phi) * Math.cos(theta) * r * 0.5;
      positions[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r * 0.5;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geometry;
  }, []);
  
  // Track last particle update time for throttling
  const lastParticleUpdateRef = useRef(0);
  
  // Update position and check lifetime
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    
    // If already collided, hide and skip processing
    if (hasCollided.current) {
      groupRef.current.visible = false;
      return;
    }
    
    const elapsed = (Date.now() - startTime) / 1000;
    
    // Hide when expired (early exit for performance)
    if (elapsed >= LIFETIME) {
      groupRef.current.visible = false;
      return;
    }
    
    timeRef.current += delta;
    
    // PERFORMANCE: Update shader uniforms (shared, so this affects all balls)
    // Only update if this is the first ball being processed this frame
    if (coreMaterial.uniforms) {
      coreMaterial.uniforms.time.value = timeRef.current;
    }
    if (glowMaterial.uniforms) {
      glowMaterial.uniforms.time.value = timeRef.current;
    }
    
    // Calculate movement for this frame
    const moveX = velocity.x * delta;
    const moveY = velocity.y * delta;
    const moveZ = velocity.z * delta;
    const moveDistance = Math.sqrt(moveX * moveX + moveY * moveY + moveZ * moveZ);
    
    // Check for collision with terrain before moving
    if (isPhysicsReady() && moveDistance > 0.001) {
      const world = getPhysicsWorld();
      if (world) {
        // Normalize velocity for ray direction
        const speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
        const direction = {
          x: velocity.x / speed,
          y: velocity.y / speed,
          z: velocity.z / speed
        };
        
        // Raycast from current position in direction of travel
        const hit = raycast(world, currentPos.current, direction, moveDistance + BALL_RADIUS);
        
        if (hit && hit.distance <= moveDistance + BALL_RADIUS) {
          // Hit terrain - mark as collided and remove from store
          hasCollided.current = true;
          groupRef.current.visible = false;
          removeDireBall(id);
          return;
        }
      }
    }
    
    // Check for NPC/enemy player collision
    const { players, localPlayer } = useGameStore.getState();
    
    // Mark as logged
    hasLoggedOnce.current = true;
    
    // Check all players for collision (NPCs and real players)
    for (const [playerId, player] of players) {
      // Skip self
      if (playerId === localPlayer?.id) continue;
      
      // Skip dead players
      if (player.state !== 'alive') continue;
      
      // Skip same team (friendly fire off)
      if (localPlayer && player.team === localPlayer.team) {
        continue; // Same team, skip
      }
      
      // Calculate distance to player
      const dx = player.position.x - currentPos.current.x;
      const dy = (player.position.y + 0.9) - currentPos.current.y; // Aim at chest height
      const dz = player.position.z - currentPos.current.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (distance <= NPC_HIT_RADIUS) {
        // Apply damage - NPCs use damageNpc, real players would use server damage
        if (playerId.startsWith('npc_')) {
          damageNpc(playerId, PROJECTILE_DAMAGE);
        }
        
        // Mark as collided and remove
        hasCollided.current = true;
        groupRef.current.visible = false;
        removeDireBall(id);
        return;
      }
    }
    
    // Move the projectile
    currentPos.current.x += moveX;
    currentPos.current.y += moveY;
    currentPos.current.z += moveZ;
    
    // Update group position
    groupRef.current.position.set(
      currentPos.current.x,
      currentPos.current.y,
      currentPos.current.z
    );
    
    // Rotate the ball for dynamic effect
    if (coreRef.current) {
      coreRef.current.rotation.x += delta * 3;
      coreRef.current.rotation.y += delta * 5;
    }
    
    // PERFORMANCE: Throttle particle updates to every 50ms instead of every frame
    const now = Date.now();
    if (particlesRef.current && now - lastParticleUpdateRef.current > 50) {
      lastParticleUpdateRef.current = now;
      const positions = particlesRef.current.geometry.attributes.position;
      const timeDelta = 0.05; // Fixed timestep for consistency
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i) - timeDelta * 8;
        if (x < -2) {
          positions.setX(i, -Math.random() * 0.3);
          positions.setY(i, (Math.random() - 0.5) * BALL_RADIUS);
          positions.setZ(i, (Math.random() - 0.5) * BALL_RADIUS);
        } else {
          positions.setX(i, x);
        }
      }
      positions.needsUpdate = true;
    }
  });
  
  // Orient the projectile toward its velocity direction
  const rotation = useMemo(() => {
    const dir = new THREE.Vector3(velocity.x, velocity.y, velocity.z).normalize();
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    const euler = new THREE.Euler().setFromQuaternion(quaternion);
    return euler;
  }, [velocity.x, velocity.y, velocity.z]);
  
  return (
    <group ref={groupRef} position={[position.x, position.y, position.z]} rotation={rotation}>
      {/* Dark magic core sphere - reduced geometry for performance */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[BALL_RADIUS, 16, 16]} />
        <primitive object={coreMaterial} />
      </mesh>
      
      {/* Outer glow sphere - reduced geometry */}
      <mesh ref={outerGlowRef}>
        <sphereGeometry args={[BALL_RADIUS * 1.5, 12, 12]} />
        <primitive object={glowMaterial} />
      </mesh>
      
      {/* Inner bright core - cyan energy center */}
      <mesh>
        <sphereGeometry args={[BALL_RADIUS * 0.35, 12, 12]} />
        <meshBasicMaterial 
          color={0x00ffff} 
          transparent 
          opacity={0.95}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Secondary glow ring */}
      <mesh>
        <sphereGeometry args={[BALL_RADIUS * 0.5, 8, 8]} />
        <meshBasicMaterial 
          color={0xc084fc} 
          transparent 
          opacity={0.4}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* Trailing particles */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <primitive object={particleMaterial} />
      </points>
      
      {/* PERFORMANCE: Removed point lights - they caused major FPS drops
          The shader materials provide enough visual glow effect */}
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (position, velocity)
  return (
    prev.id === next.id &&
    prev.position.x === next.position.x &&
    prev.position.y === next.position.y &&
    prev.position.z === next.position.z &&
    prev.velocity.x === next.velocity.x &&
    prev.velocity.y === next.velocity.y &&
    prev.velocity.z === next.velocity.z &&
    prev.startTime === next.startTime &&
    prev.ownerId === next.ownerId
  );
});

// Container component to render all active dire balls
export interface DireBallData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
}

interface DireBallsProps {
  balls: DireBallData[];
}

export function DireBalls({ balls }: DireBallsProps) {
  const clearExpiredDireBalls = useGameStore(state => state.clearExpiredDireBalls);
  
  // Periodically clean up expired balls from the store
  useEffect(() => {
    const interval = setInterval(() => {
      clearExpiredDireBalls();
    }, 500); // Clean up every 500ms
    
    return () => clearInterval(interval);
  }, [clearExpiredDireBalls]);
  
  // Filter out expired balls for rendering
  const LIFETIME = 3000; // 3 seconds in ms
  const now = Date.now();
  const activeBalls = balls.filter(ball => {
    return now - ball.startTime < LIFETIME;
  });

  return (
    <>
      {activeBalls.map((ball) => (
        <DireBall
          key={ball.id}
          id={ball.id}
          position={ball.position}
          velocity={ball.velocity}
          startTime={ball.startTime}
          ownerId={ball.ownerId}
        />
      ))}
    </>
  );
}

