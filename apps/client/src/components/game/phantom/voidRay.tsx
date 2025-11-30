import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore, VoidRayData } from '../../../store/gameStore';
import { getPhysicsWorld, isPhysicsReady, raycast } from '../../../hooks/usePhysics';
import { damageNpc } from '../../ui/GameConsole';

interface VoidRayProps {
  id: string;
  startPosition: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
}

// ============================================================================
// ULTIMATE VOID RAY - DEVASTATING SPIRALING BEAM OF VOID ENERGY
// Features multiple thick purple/cyan spiraling ribbons, intense particles,
// lightning effects, and dramatic impact visuals
// ============================================================================

const RAY_SPEED = 200;
const RAY_LENGTH = 100;
const RAY_RADIUS = 0.45;
const RAY_LIFETIME = 0.65;
const RAY_DAMAGE = 80;
const PLAYER_HIT_RADIUS = 1.5;
const SPIRAL_COUNT = 5;
const PARTICLE_COUNT = 200;

// Main spiral ribbon shader - thick glowing energy ribbons
let sharedSpiralMaterial: THREE.ShaderMaterial | null = null;

function getSpiralMaterial(): THREE.ShaderMaterial {
  if (!sharedSpiralMaterial) {
    sharedSpiralMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
        beamLength: { value: 1 },
        spiralIndex: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec2 vUv;
        varying float vT;
        uniform float time;
        uniform float beamLength;
        
        void main() {
          vPosition = position;
          vUv = uv;
          vT = clamp(position.y / max(beamLength, 0.1), 0.0, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        uniform float beamLength;
        uniform float spiralIndex;
        varying vec3 vPosition;
        varying vec2 vUv;
        varying float vT;
        
        float hash(float n) {
          return fract(sin(n) * 43758.5453);
        }
        
        void main() {
          // Rushing energy flow - multiple waves
          float flow1 = sin(vT * 40.0 - time * 50.0 + spiralIndex) * 0.5 + 0.5;
          float flow2 = sin(vT * 30.0 + time * 40.0 - spiralIndex * 2.0) * 0.5 + 0.5;
          float flow3 = cos(vT * 25.0 - time * 60.0 + spiralIndex * 0.5) * 0.5 + 0.5;
          float combinedFlow = flow1 * flow2 + flow3 * 0.5;
          
          // Colors - deep purple to bright cyan
          vec3 voidPurple = vec3(0.35, 0.05, 0.7);
          vec3 brightPurple = vec3(0.7, 0.35, 1.0);
          vec3 hotPink = vec3(1.0, 0.3, 0.8);
          vec3 cyan = vec3(0.0, 1.0, 1.0);
          vec3 white = vec3(1.0, 0.98, 1.0);
          
          // Dynamic color based on flow and position
          vec3 color = mix(voidPurple, brightPurple, flow1);
          color = mix(color, hotPink, flow2 * 0.4);
          color = mix(color, cyan, combinedFlow * 0.5);
          
          // Hot bright core of ribbon
          float coreIntensity = pow(1.0 - abs(vUv.x - 0.5) * 2.0, 2.0);
          color = mix(color, white, coreIntensity * 0.6);
          
          // Lightning flashes
          float lightning = step(0.93, hash(vT * 100.0 + time * 30.0 + spiralIndex));
          color += cyan * lightning * 3.0;
          
          // Pulsing
          float pulse = sin(time * 30.0 + vT * 20.0) * 0.2 + 0.8;
          float fastPulse = sin(time * 60.0 + vPosition.y * 15.0) * 0.15 + 0.85;
          color *= pulse * fastPulse * 1.6;
          
          // Alpha with nice edges and tip fade
          float edgeFade = smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
          float tipFade = smoothstep(1.0, 0.9, vT);
          float baseFade = smoothstep(0.0, 0.05, vT);
          float alpha = progress * edgeFade * tipFade * baseFade * pulse;
          alpha = min(alpha, 0.95);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedSpiralMaterial;
}

// Inner beam core shader
let sharedCoreMaterial: THREE.ShaderMaterial | null = null;

function getCoreMaterial(): THREE.ShaderMaterial {
  if (!sharedCoreMaterial) {
    sharedCoreMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormal;
        uniform float time;
        
        void main() {
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          
          vec3 pos = position;
          float wave = sin(position.y * 12.0 + time * 25.0) * 0.02;
          pos.x += wave;
          pos.z += wave * 0.8;
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        varying vec3 vPosition;
        varying vec3 vNormal;
        
        float hash(vec3 p) {
          return fract(sin(dot(p, vec3(12.9898, 78.233, 45.5432))) * 43758.5453);
        }
        
        void main() {
          vec3 viewDir = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 2.5);
          
          // Intense core colors
          vec3 hotCore = vec3(1.0, 0.95, 1.0);
          vec3 purple = vec3(0.7, 0.3, 1.0);
          vec3 cyan = vec3(0.0, 1.0, 1.0);
          
          float swirl = sin(vPosition.y * 20.0 - time * 40.0) * 0.5 + 0.5;
          
          vec3 color = mix(purple, hotCore, 0.6);
          color = mix(color, cyan, swirl * fresnel * 0.5);
          color += hotCore * fresnel * 0.5;
          
          // Electric crackling
          float crack = step(0.9, hash(vPosition * 40.0 + time * 20.0));
          color += cyan * crack * 2.5;
          
          float pulse = sin(time * 35.0) * 0.15 + 0.85;
          float alpha = progress * (0.85 + fresnel * 0.15) * pulse;
          
          gl_FragColor = vec4(color * 1.4, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedCoreMaterial;
}

// Outer distortion glow
let sharedGlowMaterial: THREE.ShaderMaterial | null = null;

function getGlowMaterial(): THREE.ShaderMaterial {
  if (!sharedGlowMaterial) {
    sharedGlowMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
      },
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vPosition;
        
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        varying vec3 vNormal;
        varying vec3 vPosition;
        
        void main() {
          vec3 viewDir = normalize(cameraPosition - vPosition);
          float fresnel = pow(1.0 - abs(dot(viewDir, vNormal)), 3.0);
          
          vec3 purple = vec3(0.5, 0.2, 0.9);
          vec3 cyan = vec3(0.0, 0.8, 1.0);
          
          float wave = sin(vPosition.y * 8.0 - time * 15.0) * 0.5 + 0.5;
          vec3 color = mix(purple, cyan, wave * 0.5);
          
          float pulse = sin(time * 20.0 + vPosition.y * 5.0) * 0.2 + 0.8;
          float alpha = fresnel * progress * pulse * 0.4;
          
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

// Pre-compile shaders
if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    getSpiralMaterial();
    getCoreMaterial();
    getGlowMaterial();
  });
}

export function VoidRay({ id, startPosition, direction, startTime, ownerId }: VoidRayProps) {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const spiralsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const sparkParticlesRef = useRef<THREE.Points>(null);
  const impactRef = useRef<THREE.Group>(null);
  const hitPlayersRef = useRef<Set<string>>(new Set());
  const currentLengthRef = useRef(0);
  const hasLoggedRef = useRef(false);
  
  const removeVoidRay = useGameStore(state => state.removeVoidRay);
  
  // Create individual spiral materials (each needs its own uniforms)
  const spiralMaterials = useMemo(() => {
    return Array.from({ length: SPIRAL_COUNT }, (_, i) => {
      const mat = getSpiralMaterial().clone();
      mat.uniforms.spiralIndex = { value: i };
      return mat;
    });
  }, []);
  
  const coreMaterial = useMemo(() => getCoreMaterial().clone(), []);
  const glowMaterial = useMemo(() => getGlowMaterial().clone(), []);
  
  // Create spiral geometries - thick tubes wrapping around beam
  const spiralGeometries = useMemo(() => {
    const geometries: THREE.TubeGeometry[] = [];
    
    for (let s = 0; s < SPIRAL_COUNT; s++) {
      const points: THREE.Vector3[] = [];
      const segments = 100;
      
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const y = t; // Normalized 0-1
        // More wraps, varying radius
        const angle = t * Math.PI * 12 + (s / SPIRAL_COUNT) * Math.PI * 2;
        const radiusVariation = 1.0 + Math.sin(t * Math.PI * 3) * 0.25;
        const radius = RAY_RADIUS * (1.1 + s * 0.1) * radiusVariation;
        
        points.push(new THREE.Vector3(
          Math.cos(angle) * radius,
          y,
          Math.sin(angle) * radius
        ));
      }
      
      const curve = new THREE.CatmullRomCurve3(points);
      // Thick, visible tubes
      const tubeGeo = new THREE.TubeGeometry(curve, 80, 0.07 + s * 0.01, 8, false);
      geometries.push(tubeGeo);
    }
    
    return geometries;
  }, []);
  
  // Main particle system - spiraling along beam
  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const randoms = new Float32Array(PARTICLE_COUNT);
    const speeds = new Float32Array(PARTICLE_COUNT);
    const sizes = new Float32Array(PARTICLE_COUNT);
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const t = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const radius = RAY_RADIUS * (0.6 + Math.random() * 1.0);
      
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = t;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      randoms[i] = Math.random();
      speeds[i] = 0.8 + Math.random() * 1.5;
      sizes[i] = 0.06 + Math.random() * 0.1;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    return geometry;
  }, []);
  
  // Spark particles - bright flashes
  const sparkGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const count = 50;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = Math.random();
      positions[i * 3 + 2] = 0;
      randoms[i] = Math.random();
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    
    return geometry;
  }, []);
  
  const particleMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0xc084fc,
    size: 0.1,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);
  
  const sparkMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0x00ffff,
    size: 0.15,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);
  
  // Beam rotation
  const rotation = useMemo(() => {
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return new THREE.Euler().setFromQuaternion(quaternion);
  }, [direction.x, direction.y, direction.z]);
  
  
  useFrame((state, delta) => {
    if (!groupRef.current) return;
    
    const elapsed = (Date.now() - startTime) / 1000;
    
    if (elapsed >= RAY_LIFETIME) {
      groupRef.current.visible = false;
      return;
    }
    
    const time = state.clock.elapsedTime;
    
    // Calculate beam length
    let targetLength = Math.min(RAY_LENGTH, elapsed * RAY_SPEED);
    currentLengthRef.current = targetLength;
    
    // Terrain collision
    if (isPhysicsReady()) {
      const world = getPhysicsWorld();
      if (world) {
        const hit = raycast(world, startPosition, direction, targetLength);
        if (hit && hit.distance < targetLength) {
          targetLength = hit.distance;
        }
      }
    }
    
    // Fade in/out
    const progress = elapsed < 0.06 ? elapsed / 0.06 : 
                     elapsed > RAY_LIFETIME - 0.12 ? (RAY_LIFETIME - elapsed) / 0.12 : 1;
    
    // Update core beam
    if (beamRef.current) {
      beamRef.current.scale.y = targetLength;
      beamRef.current.position.y = targetLength / 2;
    }
    
    if (coreRef.current) {
      coreRef.current.scale.y = targetLength;
      coreRef.current.position.y = targetLength / 2;
    }
    
    if (glowRef.current) {
      glowRef.current.scale.y = targetLength;
      glowRef.current.position.y = targetLength / 2;
    }
    
    // Update materials
    if (coreMaterial.uniforms) {
      coreMaterial.uniforms.time.value = time;
      coreMaterial.uniforms.progress.value = progress;
    }
    
    if (glowMaterial.uniforms) {
      glowMaterial.uniforms.time.value = time;
      glowMaterial.uniforms.progress.value = progress;
    }
    
    // Update spirals - fast rotation and scale
    if (spiralsRef.current) {
      spiralsRef.current.rotation.y += delta * 15; // Very fast spin!
      
      spiralsRef.current.children.forEach((mesh, i) => {
        mesh.scale.y = targetLength;
        
        const mat = spiralMaterials[i];
        if (mat && mat.uniforms) {
          mat.uniforms.time.value = time;
          mat.uniforms.progress.value = progress;
          mat.uniforms.beamLength.value = targetLength;
        }
      });
    }
    
    // Animate particles - spiral motion
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position;
      const randoms = particlesRef.current.geometry.attributes.random;
      const speeds = particlesRef.current.geometry.attributes.speed;
      
      for (let i = 0; i < positions.count; i++) {
        const r = (randoms as THREE.BufferAttribute).getX(i);
        const speed = (speeds as THREE.BufferAttribute).getX(i);
        
        const angle = r * Math.PI * 2 + time * 10 * speed;
        const baseRadius = RAY_RADIUS * (0.5 + r * 0.8);
        const wobble = Math.sin(time * 20 + r * 30) * 0.08;
        const radius = baseRadius + wobble;
        
        let t = positions.getY(i) / targetLength;
        t = (t + delta * speed * 2.5) % 1;
        
        positions.setX(i, Math.cos(angle) * radius);
        positions.setY(i, t * targetLength);
        positions.setZ(i, Math.sin(angle) * radius);
      }
      positions.needsUpdate = true;
      
      // Color shift purple->cyan
      const hue = 0.75 + Math.sin(time * 8) * 0.1;
      particleMaterial.color.setHSL(hue, 0.85, 0.65);
      particleMaterial.opacity = progress * 0.9;
    }
    
    // Animate spark particles - random flashes
    if (sparkParticlesRef.current) {
      const positions = sparkParticlesRef.current.geometry.attributes.position;
      const randoms = sparkParticlesRef.current.geometry.attributes.random;
      
      for (let i = 0; i < positions.count; i++) {
        const r = (randoms as THREE.BufferAttribute).getX(i);
        
        // Random position along beam with spiral
        const t = (r + time * 3) % 1;
        const angle = t * Math.PI * 8 + r * Math.PI * 2;
        const radius = RAY_RADIUS * (1.0 + Math.sin(time * 30 + r * 50) * 0.5);
        
        positions.setX(i, Math.cos(angle) * radius);
        positions.setY(i, t * targetLength);
        positions.setZ(i, Math.sin(angle) * radius);
      }
      positions.needsUpdate = true;
      
      // Flicker opacity
      sparkMaterial.opacity = 0.5 + Math.random() * 0.5;
    }
    
    // Impact effect
    if (impactRef.current) {
      impactRef.current.position.y = targetLength;
      impactRef.current.rotation.y += delta * 20;
      
      const impactPulse = 0.8 + Math.sin(time * 30) * 0.3;
      impactRef.current.scale.setScalar(impactPulse);
    }
    
    // Player collision
    const { players, localPlayer } = useGameStore.getState();
    
    // Track if we've already logged (now a no-op but kept for hasLoggedRef reference)
    hasLoggedRef.current = true;
    
    for (const [playerId, player] of players) {
      if (playerId === localPlayer?.id) continue;
      if (player.state !== 'alive') continue;
      if (localPlayer && player.team === localPlayer.team) continue;
      if (hitPlayersRef.current.has(playerId)) continue;
      
      const playerPos = new THREE.Vector3(player.position.x, player.position.y + 0.9, player.position.z);
      const rayStart = new THREE.Vector3(startPosition.x, startPosition.y, startPosition.z);
      const rayDir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
      
      const toPlayer = playerPos.clone().sub(rayStart);
      const projectionLength = toPlayer.dot(rayDir);
      
      if (projectionLength < 0 || projectionLength > currentLengthRef.current) continue;
      
      const closestPoint = rayStart.clone().add(rayDir.clone().multiplyScalar(projectionLength));
      const distance = closestPoint.distanceTo(playerPos);
      
      if (distance <= PLAYER_HIT_RADIUS + RAY_RADIUS) {
        hitPlayersRef.current.add(playerId);
        
        if (playerId.startsWith('npc_')) {
          damageNpc(playerId, RAY_DAMAGE);
        }
      }
    }
  });
  
  return (
    <group ref={groupRef} position={[startPosition.x, startPosition.y, startPosition.z]} rotation={rotation}>
      {/* ===== SPIRALING ENERGY RIBBONS ===== */}
      <group ref={spiralsRef}>
        {spiralGeometries.map((geo, i) => (
          <mesh key={i} geometry={geo}>
            <primitive object={spiralMaterials[i]} />
          </mesh>
        ))}
      </group>
      
      {/* ===== OUTER GLOW ===== */}
      <mesh ref={glowRef}>
        <cylinderGeometry args={[RAY_RADIUS * 2.0, RAY_RADIUS * 2.2, 1, 20, 1, true]} />
        <primitive object={glowMaterial} />
      </mesh>
      
      {/* ===== MAIN BEAM ===== */}
      <mesh ref={beamRef}>
        <cylinderGeometry args={[RAY_RADIUS * 0.6, RAY_RADIUS * 0.7, 1, 16, 8, true]} />
        <primitive object={coreMaterial} />
      </mesh>
      
      {/* ===== BRIGHT CORE ===== */}
      <mesh ref={coreRef}>
        <cylinderGeometry args={[RAY_RADIUS * 0.2, RAY_RADIUS * 0.25, 1, 12, 1, true]} />
        <meshBasicMaterial 
          color={0xffffff}
          transparent
          opacity={0.98}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* ===== SPIRALING PARTICLES ===== */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <primitive object={particleMaterial} />
      </points>
      
      {/* ===== SPARK PARTICLES ===== */}
      <points ref={sparkParticlesRef} geometry={sparkGeometry}>
        <primitive object={sparkMaterial} />
      </points>
      
      {/* ===== ORIGIN BURST ===== */}
      <mesh>
        <sphereGeometry args={[RAY_RADIUS * 1.8, 24, 24]} />
        <meshBasicMaterial 
          color={0xc084fc}
          transparent
          opacity={0.95}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      <mesh>
        <sphereGeometry args={[RAY_RADIUS * 2.5, 16, 16]} />
        <meshBasicMaterial 
          color={0x7c3aed}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      
      {/* ===== IMPACT EFFECT ===== */}
      <group ref={impactRef}>
        {/* Inner ring */}
        <mesh rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.2, 0.6, 32]} />
          <meshBasicMaterial
            color={0x00ffff}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Outer ring */}
        <mesh rotation-x={-Math.PI / 2}>
          <ringGeometry args={[0.6, 1.0, 32]} />
          <meshBasicMaterial
            color={0xc084fc}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Impact sparks */}
        {[...Array(10)].map((_, i) => {
          const angle = (i / 10) * Math.PI * 2;
          const r = 0.4 + (i % 2) * 0.3;
          return (
            <mesh key={i} position={[Math.cos(angle) * r, 0, Math.sin(angle) * r]}>
              <sphereGeometry args={[0.06, 8, 8]} />
              <meshBasicMaterial
                color={i % 2 === 0 ? 0x00ffff : 0xc084fc}
                transparent
                opacity={0.9}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

// Container
interface VoidRaysProps {
  rays: VoidRayData[];
}

export function VoidRays({ rays }: VoidRaysProps) {
  const clearExpiredVoidRays = useGameStore(state => state.clearExpiredVoidRays);
  
  useEffect(() => {
    const interval = setInterval(clearExpiredVoidRays, 100);
    return () => clearInterval(interval);
  }, [clearExpiredVoidRays]);
  
  const now = Date.now();
  const activeRays = rays.filter(ray => now - ray.startTime < 650);

  return (
    <>
      {activeRays.map((ray) => (
        <VoidRay
          key={ray.id}
          id={ray.id}
          startPosition={ray.startPosition}
          direction={ray.direction}
          startTime={ray.startTime}
          ownerId={ray.ownerId}
        />
      ))}
    </>
  );
}

