import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';

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
        color1: { value: new THREE.Color(0x1a0033) },
        color2: { value: new THREE.Color(0x9333ea) },
        color3: { value: new THREE.Color(0xff4400) },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vUv = uv;
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying vec3 vPosition;
        float noise(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
        }
        void main() {
          vec3 viewDir = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.0);
          float swirl = sin(vPosition.x * 10.0 + time * 5.0) * 
                       cos(vPosition.y * 10.0 - time * 4.0) * 
                       sin(vPosition.z * 10.0 + time * 3.0);
          swirl = swirl * 0.5 + 0.5;
          float flicker = sin(time * 20.0 + vPosition.y * 15.0) * 0.3 + 0.7;
          vec3 baseColor = mix(color1, color2, swirl);
          baseColor = mix(baseColor, color3, fresnel * flicker * 0.5);
          float brightness = noise(vPosition * 20.0 + vec3(time * 5.0));
          baseColor += color2 * brightness * 0.3;
          baseColor += color2 * fresnel * 1.5;
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
        color: { value: new THREE.Color(0x7c3aed) },
      },
      vertexShader: `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color;
        varying vec3 vNormal;
        void main() {
          float pulse = sin(time * 8.0) * 0.2 + 0.8;
          float intensity = pow(0.6 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.0);
          gl_FragColor = vec4(color, intensity * pulse * 0.6);
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
const BALL_RADIUS = 0.3;
const PARTICLE_COUNT = 15; // Reduced from 30 for performance

/**
 * DireBall - A dark magic fireball projectile
 * Visual style: Purple/black flaming sphere with swirling dark energy
 * PERFORMANCE: Uses shared materials, no point lights, reduced particles
 */
export function DireBall({ position, velocity, startTime }: DireBallProps) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const outerGlowRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);
  
  // Current position (updated each frame based on velocity)
  const currentPos = useRef({ x: position.x, y: position.y, z: position.z });
  const timeRef = useRef(0);
  
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
    
    // Move the projectile
    currentPos.current.x += velocity.x * delta;
    currentPos.current.y += velocity.y * delta;
    currentPos.current.z += velocity.z * delta;
    
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
      
      {/* Inner bright core - reduced geometry */}
      <mesh>
        <sphereGeometry args={[BALL_RADIUS * 0.4, 8, 8]} />
        <meshBasicMaterial 
          color={0xff6600} 
          transparent 
          opacity={0.9}
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
}

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

