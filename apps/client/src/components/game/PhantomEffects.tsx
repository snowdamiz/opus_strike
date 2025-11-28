import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../store/gameStore';

// ============================================================================
// PHANTOM BLINK TELEPORT EFFECT
// A dramatic void rift effect that appears during teleportation
// ============================================================================

interface BlinkTeleportEffectProps {
  startPosition: { x: number; y: number; z: number };
  endPosition: { x: number; y: number; z: number };
  startTime: number;
}

// Shared shader materials for blink effect
let sharedRiftMaterial: THREE.ShaderMaterial | null = null;
let sharedTrailMaterial: THREE.ShaderMaterial | null = null;
let sharedDistortionMaterial: THREE.ShaderMaterial | null = null;

function getRiftMaterial(): THREE.ShaderMaterial {
  if (!sharedRiftMaterial) {
    sharedRiftMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
        color1: { value: new THREE.Color(0x0a0015) }, // Deep void
        color2: { value: new THREE.Color(0x7c3aed) }, // Violet
        color3: { value: new THREE.Color(0xc084fc) }, // Light purple
        color4: { value: new THREE.Color(0x00ffff) }, // Cyan accent
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vNormal;
        uniform float time;
        uniform float progress;
        
        void main() {
          vUv = uv;
          vPosition = position;
          vNormal = normalize(normalMatrix * normal);
          
          // Warp effect - vertices spiral inward
          vec3 pos = position;
          float warp = sin(position.y * 8.0 + time * 15.0) * 0.1 * (1.0 - progress);
          pos.x += warp * cos(position.y * 3.0);
          pos.z += warp * sin(position.y * 3.0);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 color4;
        varying vec2 vUv;
        varying vec3 vPosition;
        varying vec3 vNormal;
        
        // Noise function for chaotic energy
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }
        
        void main() {
          vec2 center = vec2(0.5);
          vec2 uv = vUv - center;
          float dist = length(uv);
          float angle = atan(uv.y, uv.x);
          
          // Spiraling void energy
          float spiral1 = sin(angle * 5.0 + time * 12.0 - dist * 20.0) * 0.5 + 0.5;
          float spiral2 = sin(angle * 7.0 - time * 8.0 + dist * 15.0) * 0.5 + 0.5;
          float spiral3 = sin(angle * 3.0 + time * 20.0 - dist * 30.0) * 0.5 + 0.5;
          
          // Fractal noise for energy crackling
          float n = noise(vUv * 10.0 + time * 3.0);
          n += noise(vUv * 20.0 - time * 5.0) * 0.5;
          n += noise(vUv * 40.0 + time * 8.0) * 0.25;
          
          // Create void center with glowing edges
          float voidCore = smoothstep(0.2, 0.0, dist);
          float voidRing = smoothstep(0.4, 0.25, dist) * smoothstep(0.1, 0.25, dist);
          float outerGlow = smoothstep(0.5, 0.3, dist);
          
          // Color mixing with energy
          vec3 color = color1;
          color = mix(color, color2, spiral1 * outerGlow);
          color = mix(color, color3, spiral2 * voidRing * n);
          color = mix(color, color4, spiral3 * 0.3 * (1.0 - dist) * n);
          
          // Bright edge with electrical crackling
          float edge = smoothstep(0.48, 0.45, dist) * smoothstep(0.35, 0.45, dist);
          float crackle = step(0.7, noise(vUv * 50.0 + time * 10.0));
          color += color3 * edge * 2.0;
          color += color4 * crackle * edge * 3.0;
          
          // Pulsing core
          float pulse = sin(time * 20.0) * 0.2 + 0.8;
          color += color3 * voidCore * pulse * 2.0;
          
          // Alpha with fade based on progress
          float alpha = outerGlow * (1.0 - progress * progress);
          alpha *= pulse;
          alpha += voidRing * 0.5;
          
          // Final bloom
          color *= 1.2;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedRiftMaterial;
}

function getTrailMaterial(): THREE.ShaderMaterial {
  if (!sharedTrailMaterial) {
    sharedTrailMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
      },
      vertexShader: `
        varying vec3 vPosition;
        varying float vProgress;
        attribute float lineProgress;
        uniform float progress;
        
        void main() {
          vPosition = position;
          vProgress = lineProgress;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        varying vec3 vPosition;
        varying float vProgress;
        
        void main() {
          // Trail fades from start to end
          float fade = smoothstep(0.0, 0.3, vProgress) * smoothstep(1.0, 0.7, vProgress);
          
          // Energy pulse along trail
          float pulse = sin(vProgress * 20.0 - time * 30.0) * 0.5 + 0.5;
          
          // Purple/cyan gradient
          vec3 color = mix(
            vec3(0.486, 0.227, 0.929), // Purple
            vec3(0.0, 1.0, 1.0),        // Cyan
            pulse
          );
          
          float alpha = fade * (1.0 - progress) * pulse;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedTrailMaterial;
}

const BLINK_EFFECT_DURATION = 600; // ms

export function BlinkTeleportEffect({ startPosition, endPosition, startTime }: BlinkTeleportEffectProps) {
  const startGroupRef = useRef<THREE.Group>(null);
  const endGroupRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Points>(null);
  const particlesRef = useRef<THREE.Points>(null);
  
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
    
    // Animate burst particles
    if (particlesRef.current && progress < 0.5) {
      const positions = particlesRef.current.geometry.attributes.position;
      const velocities = particlesRef.current.geometry.attributes.velocity;
      
      for (let i = 0; i < positions.count; i++) {
        positions.setX(i, positions.getX(i) + (velocities as THREE.BufferAttribute).getX(i) * delta);
        positions.setY(i, positions.getY(i) + (velocities as THREE.BufferAttribute).getY(i) * delta);
        positions.setZ(i, positions.getZ(i) + (velocities as THREE.BufferAttribute).getZ(i) * delta);
      }
      positions.needsUpdate = true;
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

// ============================================================================
// SHADOW STEP ARRIVAL EFFECT
// Dramatic shadow materialization when teleporting via Shadow Step
// ============================================================================

interface ShadowStepArrivalProps {
  position: { x: number; y: number; z: number };
  startTime: number;
}

const SHADOW_ARRIVAL_DURATION = 800; // ms

// Enhanced shader for shadow arrival
let sharedShadowArrivalMaterial: THREE.ShaderMaterial | null = null;

function getShadowArrivalMaterial(): THREE.ShaderMaterial {
  if (!sharedShadowArrivalMaterial) {
    sharedShadowArrivalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        progress: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vUv = uv;
          vPosition = position;
          
          // Shadow tendrils wave effect
          vec3 pos = position;
          float wave = sin(position.y * 5.0 + time * 10.0) * 0.1;
          pos.x += wave * (1.0 - uv.y);
          pos.z += wave * 0.5 * (1.0 - uv.y);
          
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float progress;
        varying vec2 vUv;
        varying vec3 vPosition;
        
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        void main() {
          // Rising shadow effect
          float rise = smoothstep(0.0, progress, vUv.y);
          
          // Shadow tendrils
          float tendril = sin(vUv.x * 20.0 + time * 5.0) * 0.5 + 0.5;
          tendril *= sin(vUv.x * 15.0 - time * 8.0) * 0.5 + 0.5;
          
          // Dark core with purple edge
          vec3 shadowColor = vec3(0.05, 0.0, 0.1);
          vec3 edgeColor = vec3(0.486, 0.227, 0.929);
          vec3 glowColor = vec3(0.752, 0.518, 0.988);
          
          // Noise for organic feeling
          float n = hash(vUv * 50.0 + time);
          
          // Color mixing
          vec3 color = shadowColor;
          float edgeFade = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          color = mix(color, edgeColor, tendril * edgeFade * 0.7);
          color += glowColor * rise * (1.0 - vUv.y) * 0.3;
          
          // Particles/sparks
          float spark = step(0.97, hash(vUv * 100.0 + time * 10.0));
          color += glowColor * spark * 2.0;
          
          // Alpha - fade at edges
          float alpha = rise * (1.0 - abs(vUv.x - 0.5) * 2.0);
          alpha *= smoothstep(1.0, 0.8, progress); // Fade out at end
          alpha *= 0.8 + tendril * 0.2;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      depthWrite: false,
    });
  }
  return sharedShadowArrivalMaterial;
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

// ============================================================================
// PHANTOM VEIL 3D EFFECT
// Ethereal ghost particles around the player during invisibility
// ============================================================================

interface PhantomVeilEffectProps {
  isActive: boolean;
  playerPosition: { x: number; y: number; z: number };
}

export function PhantomVeil3DEffect({ isActive, playerPosition }: PhantomVeilEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const wisprRef = useRef<THREE.Points>(null);
  
  // Ghost particles swirling around player
  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const particleCount = 100;
    const positions = new Float32Array(particleCount * 3);
    const randoms = new Float32Array(particleCount);
    const offsets = new Float32Array(particleCount);
    
    for (let i = 0; i < particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const height = Math.random() * 2;
      const radius = 0.8 + Math.random() * 0.8;
      
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      randoms[i] = Math.random();
      offsets[i] = Math.random() * Math.PI * 2;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('offset', new THREE.BufferAttribute(offsets, 1));
    
    return geometry;
  }, []);
  
  // Wisp trails - longer trailing particles
  const wispGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const count = 30;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 1.2;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.5 + Math.random() * 1.5;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      randoms[i] = Math.random();
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    
    return geometry;
  }, []);
  
  useFrame((state, delta) => {
    if (!isActive || !groupRef.current) return;
    
    // Follow player position
    groupRef.current.position.set(playerPosition.x, playerPosition.y - 0.9, playerPosition.z);
    
    // Animate particles - spiral motion
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position;
      const offsets = particlesRef.current.geometry.attributes.offset;
      const time = state.clock.elapsedTime;
      
      for (let i = 0; i < positions.count; i++) {
        const offset = (offsets as THREE.BufferAttribute).getX(i);
        const angle = offset + time * 2;
        const baseRadius = 0.8 + Math.sin(time * 3 + offset * 5) * 0.2;
        const height = (positions.getY(i) + delta * 0.5) % 2.5;
        
        positions.setX(i, Math.cos(angle) * baseRadius);
        positions.setY(i, height);
        positions.setZ(i, Math.sin(angle) * baseRadius);
      }
      positions.needsUpdate = true;
    }
    
    // Animate wisps - slower orbital motion
    if (wisprRef.current) {
      wisprRef.current.rotation.y += delta * 0.5;
    }
  });
  
  if (!isActive) return null;
  
  return (
    <group ref={groupRef}>
      {/* Swirling ghost particles */}
      <points ref={particlesRef} geometry={particleGeometry}>
        <pointsMaterial 
          color={0x9333ea}
          size={0.08}
          transparent
          opacity={0.6}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      
      {/* Wisp trails */}
      <points ref={wisprRef} geometry={wispGeometry}>
        <pointsMaterial 
          color={0xc084fc}
          size={0.12}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
      
      {/* Ground shadow */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.01}>
        <circleGeometry args={[0.8, 32]} />
        <meshBasicMaterial 
          color={0x1a0033}
          transparent
          opacity={0.5}
        />
      </mesh>
    </group>
  );
}

// ============================================================================
// BLINK EFFECT MANAGER
// Tracks and renders active blink teleport effects
// ============================================================================

interface BlinkEffectData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  endPosition: { x: number; y: number; z: number };
  startTime: number;
}

interface ShadowArrivalData {
  id: string;
  position: { x: number; y: number; z: number };
  startTime: number;
}

// Global effect state - accessible from PlayerController
const blinkEffects: BlinkEffectData[] = [];
const shadowArrivals: ShadowArrivalData[] = [];
let effectIdCounter = 0;

export function triggerBlinkEffect(start: { x: number; y: number; z: number }, end: { x: number; y: number; z: number }) {
  blinkEffects.push({
    id: `blink_${effectIdCounter++}`,
    startPosition: { ...start },
    endPosition: { ...end },
    startTime: Date.now(),
  });
}

export function triggerShadowArrival(position: { x: number; y: number; z: number }) {
  shadowArrivals.push({
    id: `shadow_${effectIdCounter++}`,
    position: { ...position },
    startTime: Date.now(),
  });
}

export function PhantomEffectsManager() {
  const [activeBlinkEffects, setActiveBlinkEffects] = useState<BlinkEffectData[]>([]);
  const [activeShadowArrivals, setActiveShadowArrivals] = useState<ShadowArrivalData[]>([]);
  const { localPlayer, ultimateEffectActive, ultimateEffectType } = useGameStore();
  
  useFrame(() => {
    const now = Date.now();
    
    // Clean up expired blink effects
    const activeBlinks = blinkEffects.filter(e => now - e.startTime < BLINK_EFFECT_DURATION);
    blinkEffects.length = 0;
    blinkEffects.push(...activeBlinks);
    
    if (activeBlinks.length !== activeBlinkEffects.length) {
      setActiveBlinkEffects([...activeBlinks]);
    }
    
    // Clean up expired shadow arrivals
    const activeArrivals = shadowArrivals.filter(e => now - e.startTime < SHADOW_ARRIVAL_DURATION);
    shadowArrivals.length = 0;
    shadowArrivals.push(...activeArrivals);
    
    if (activeArrivals.length !== activeShadowArrivals.length) {
      setActiveShadowArrivals([...activeArrivals]);
    }
  });
  
  const showVeilEffect = ultimateEffectActive && ultimateEffectType === 'phantom_veil' && localPlayer;
  
  return (
    <group>
      {/* Blink teleport effects */}
      {activeBlinkEffects.map(effect => (
        <BlinkTeleportEffect
          key={effect.id}
          startPosition={effect.startPosition}
          endPosition={effect.endPosition}
          startTime={effect.startTime}
        />
      ))}
      
      {/* Shadow Step arrival effects */}
      {activeShadowArrivals.map(effect => (
        <ShadowStepArrivalEffect
          key={effect.id}
          position={effect.position}
          startTime={effect.startTime}
        />
      ))}
      
      {/* Phantom Veil 3D effect */}
      {showVeilEffect && localPlayer && (
        <PhantomVeil3DEffect
          isActive={true}
          playerPosition={localPlayer.position}
        />
      )}
    </group>
  );
}


