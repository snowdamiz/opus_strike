import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../store/gameStore';
import { damageNpc } from '../../ui/GameConsole';

interface VoidZoneProps {
  position: { x: number; y: number; z: number };
  radius: number;
  duration: number;
  startTime: number;
  ownerId: string;
}

// ============================================================================
// ENHANCED VOID ZONE SHADER MATERIALS
// Creates a stunning black hole / void vortex visual effect
// ============================================================================

let sharedVortexMaterial: THREE.ShaderMaterial | null = null;
let sharedEventHorizonMaterial: THREE.ShaderMaterial | null = null;
let sharedAccretionMaterial: THREE.ShaderMaterial | null = null;
let sharedLightningMaterial: THREE.ShaderMaterial | null = null;

function getVortexMaterial(): THREE.ShaderMaterial {
  if (!sharedVortexMaterial) {
    sharedVortexMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        opacity: { value: 1 },
        color1: { value: new THREE.Color(0x000000) },
        color2: { value: new THREE.Color(0x1a0033) },
        color3: { value: new THREE.Color(0x7c3aed) },
        color4: { value: new THREE.Color(0xc084fc) },
        color5: { value: new THREE.Color(0x00ffff) },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vUv = uv;
          vPosition = position;
          vec3 pos = position;
          float dist = length(uv - vec2(0.5));
          float warp = sin(dist * 20.0 - time * 5.0) * 0.02 * (1.0 - dist);
          pos.y += warp;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float opacity;
        uniform vec3 color1;
        uniform vec3 color2;
        uniform vec3 color3;
        uniform vec3 color4;
        uniform vec3 color5;
        varying vec2 vUv;
        varying vec3 vPosition;
        
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
        
        float fbm(vec2 p) {
          float sum = 0.0;
          float amp = 0.5;
          for(int i = 0; i < 4; i++) {
            sum += amp * noise(p);
            p *= 2.0;
            amp *= 0.5;
          }
          return sum;
        }
        
        void main() {
          vec2 center = vec2(0.5);
          vec2 uv = vUv - center;
          float dist = length(uv);
          float angle = atan(uv.y, uv.x);
          
          float eventHorizon = smoothstep(0.15, 0.0, dist);
          
          float spiral1 = sin(angle * 5.0 + time * 4.0 - dist * 25.0) * 0.5 + 0.5;
          float spiral2 = sin(angle * 7.0 - time * 3.0 + dist * 20.0) * 0.5 + 0.5;
          float spiral3 = sin(angle * 3.0 + time * 6.0 - dist * 30.0) * 0.5 + 0.5;
          float spiral4 = sin(angle * 11.0 - time * 2.0 + dist * 15.0) * 0.5 + 0.5;
          
          float spiralNoise = fbm(uv * 8.0 + time * 0.5);
          float accretion = spiral1 * spiral2 * (0.7 + spiralNoise * 0.3);
          accretion += spiral3 * spiral4 * 0.3;
          
          float lensing = smoothstep(0.4, 0.2, dist) * smoothstep(0.1, 0.2, dist);
          
          float jet1 = smoothstep(0.1, 0.0, abs(sin(angle) * dist));
          float jet2 = smoothstep(0.1, 0.0, abs(cos(angle) * dist));
          float jets = (jet1 + jet2) * smoothstep(0.0, 0.3, dist) * smoothstep(0.5, 0.3, dist);
          jets *= sin(dist * 40.0 - time * 20.0) * 0.5 + 0.5;
          
          float outerRing = smoothstep(0.48, 0.45, dist) * smoothstep(0.38, 0.45, dist);
          float ringPulse = sin(time * 8.0 + dist * 30.0) * 0.3 + 0.7;
          
          float innerRing = smoothstep(0.25, 0.2, dist) * smoothstep(0.12, 0.2, dist);
          float innerGlow = sin(time * 12.0) * 0.2 + 0.8;
          
          vec3 color = color1;
          color = mix(color, color2, smoothstep(0.0, 0.3, dist) * (1.0 - eventHorizon));
          color = mix(color, color3, accretion * lensing * 0.8);
          color = mix(color, color4, innerRing * innerGlow * 0.6);
          color += color5 * jets * 0.8;
          color += color4 * outerRing * ringPulse * 1.5;
          
          float arc = step(0.9, hash(vec2(angle * 20.0, time * 10.0))) * outerRing;
          color += color5 * arc * 3.0;
          
          float alpha = smoothstep(0.5, 0.2, dist) * opacity;
          alpha = max(alpha, eventHorizon * 0.95);
          alpha = max(alpha, outerRing * ringPulse * 0.8);
          alpha = max(alpha, jets * 0.6);
          
          float pulse = sin(time * 3.0) * 0.1 + 0.9;
          alpha *= pulse;
          color *= 1.0 + (accretion * lensing * 0.5);
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }
  return sharedVortexMaterial;
}

function getEventHorizonMaterial(): THREE.ShaderMaterial {
  if (!sharedEventHorizonMaterial) {
    sharedEventHorizonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        opacity: { value: 1 },
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
        varying vec2 vUv;
        
        void main() {
          vec2 uv = vUv - vec2(0.5);
          float dist = length(uv);
          float core = smoothstep(0.3, 0.0, dist);
          float shimmer = sin(atan(uv.y, uv.x) * 20.0 + time * 10.0) * 0.5 + 0.5;
          float edge = smoothstep(0.4, 0.25, dist) * smoothstep(0.1, 0.25, dist);
          
          vec3 color = vec3(0.0);
          color += vec3(0.1, 0.0, 0.2) * edge * shimmer;
          
          float alpha = core * 0.95 + edge * shimmer * 0.3;
          alpha *= opacity;
          
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }
  return sharedEventHorizonMaterial;
}

function getAccretionMaterial(): THREE.ShaderMaterial {
  if (!sharedAccretionMaterial) {
    sharedAccretionMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        opacity: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPosition;
        uniform float time;
        
        void main() {
          vUv = uv;
          vPosition = position;
          vec3 pos = position;
          pos.y += sin(uv.x * 10.0 + time * 5.0) * 0.05;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float opacity;
        varying vec2 vUv;
        
        void main() {
          float dist = abs(vUv.y - 0.5) * 2.0;
          float glow = smoothstep(1.0, 0.0, dist);
          float energy = sin(vUv.x * 50.0 - time * 20.0) * 0.5 + 0.5;
          
          vec3 color = mix(
            vec3(0.486, 0.227, 0.929),
            vec3(0.0, 1.0, 1.0),
            energy
          );
          
          float alpha = glow * energy * opacity * 0.8;
          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
  }
  return sharedAccretionMaterial;
}

// Pre-compile shaders
if (typeof window !== 'undefined') {
  requestAnimationFrame(() => {
    getVortexMaterial();
    getEventHorizonMaterial();
    getAccretionMaterial();
  });
}

const PARTICLE_COUNT = 60;
const DEBRIS_COUNT = 20;
const VOID_ZONE_DAMAGE = 15;
const VOID_ZONE_DAMAGE_INTERVAL = 500;

export function VoidZone({ position, radius, duration, startTime, ownerId }: VoidZoneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const vortexRef = useRef<THREE.Mesh>(null);
  const eventHorizonRef = useRef<THREE.Mesh>(null);
  const innerRingsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const debrisRef = useRef<THREE.Points>(null);
  const lastDamageTickRef = useRef<Map<string, number>>(new Map());
  const timeRef = useRef(0);
  
  const getProgress = () => {
    const elapsed = (Date.now() - startTime) / 1000;
    return Math.min(1, elapsed / duration);
  };

  const vortexMaterial = useMemo(() => getVortexMaterial().clone(), []);
  const eventHorizonMaterial = useMemo(() => getEventHorizonMaterial().clone(), []);
  const accretionMaterial = useMemo(() => getAccretionMaterial().clone(), []);

  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const speeds = new Float32Array(PARTICLE_COUNT);
    const angles = new Float32Array(PARTICLE_COUNT);
    const radii = new Float32Array(PARTICLE_COUNT);
    
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * radius * 0.9;
      const height = Math.random() * 0.8;
      
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = Math.sin(angle) * r;
      sizes[i] = Math.random() * 0.1 + 0.03;
      speeds[i] = 0.5 + Math.random() * 2;
      angles[i] = angle;
      radii[i] = r;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));
    geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1));
    
    return geometry;
  }, [radius]);

  const debrisGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(DEBRIS_COUNT * 3);
    const velocities = new Float32Array(DEBRIS_COUNT * 3);
    const sizes = new Float32Array(DEBRIS_COUNT);
    
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = radius * (0.8 + Math.random() * 0.3);
      
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = 0.5 + Math.random() * 1.5;
      positions[i * 3 + 2] = Math.sin(angle) * r;
      
      velocities[i * 3] = -Math.cos(angle) * (0.5 + Math.random());
      velocities[i * 3 + 1] = -0.3;
      velocities[i * 3 + 2] = -Math.sin(angle) * (0.5 + Math.random());
      
      sizes[i] = 0.1 + Math.random() * 0.15;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    return geometry;
  }, [radius]);

  const particleMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0xc084fc,
    size: 0.1,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);

  const debrisMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0x7c3aed,
    size: 0.12,
    transparent: true,
    opacity: 0.8,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const progress = getProgress();
    
    if (progress >= 1) {
      groupRef.current.visible = false;
      return;
    }
    
    timeRef.current += delta;
    const time = timeRef.current;
    
    const fadeIn = Math.min(1, progress * 5);
    const fadeOut = progress > 0.75 ? 1 - ((progress - 0.75) / 0.25) : 1;
    const currentOpacity = fadeIn * fadeOut;

    if (vortexMaterial.uniforms) {
      vortexMaterial.uniforms.time.value = time;
      vortexMaterial.uniforms.opacity.value = currentOpacity;
    }

    if (eventHorizonMaterial.uniforms) {
      eventHorizonMaterial.uniforms.time.value = time;
      eventHorizonMaterial.uniforms.opacity.value = currentOpacity;
    }

    if (accretionMaterial.uniforms) {
      accretionMaterial.uniforms.time.value = time;
      accretionMaterial.uniforms.opacity.value = currentOpacity;
    }

    if (innerRingsRef.current) {
      innerRingsRef.current.children.forEach((ring, i) => {
        const speed = 1 + i * 0.5;
        const direction = i % 2 === 0 ? 1 : -1;
        ring.rotation.z += delta * speed * direction;
        const scale = 1 + Math.sin(time * 3 + i) * 0.1;
        ring.scale.setScalar(scale);
      });
    }

    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position;
      const speeds = particlesRef.current.geometry.attributes.speed;
      const angleAttrs = particlesRef.current.geometry.attributes.angle;
      const radiiAttrs = particlesRef.current.geometry.attributes.radius;
      
      for (let i = 0; i < positions.count; i++) {
        const speed = (speeds as THREE.BufferAttribute).getX(i);
        let angle = (angleAttrs as THREE.BufferAttribute).getX(i);
        let r = (radiiAttrs as THREE.BufferAttribute).getX(i);
        
        angle += delta * speed * (1 + (1 - r / radius) * 2);
        r -= delta * 0.3;
        
        if (r < 0.2) {
          r = radius * (0.7 + Math.random() * 0.3);
          angle = Math.random() * Math.PI * 2;
        }
        
        (angleAttrs as THREE.BufferAttribute).setX(i, angle);
        (radiiAttrs as THREE.BufferAttribute).setX(i, r);
        
        const height = (Math.sin(time * 3 + i) * 0.2 + 0.4) * (r / radius);
        
        positions.setX(i, Math.cos(angle) * r);
        positions.setY(i, height);
        positions.setZ(i, Math.sin(angle) * r);
      }
      positions.needsUpdate = true;
      particleMaterial.opacity = currentOpacity * 0.9;
    }

    if (debrisRef.current) {
      const positions = debrisRef.current.geometry.attributes.position;
      const velocities = debrisRef.current.geometry.attributes.velocity;
      
      for (let i = 0; i < positions.count; i++) {
        let x = positions.getX(i);
        let y = positions.getY(i);
        let z = positions.getZ(i);
        
        const vx = (velocities as THREE.BufferAttribute).getX(i);
        const vy = (velocities as THREE.BufferAttribute).getY(i);
        const vz = (velocities as THREE.BufferAttribute).getZ(i);
        
        x += vx * delta;
        y += vy * delta;
        z += vz * delta;
        
        const dist = Math.sqrt(x * x + z * z);
        if (dist < 0.3 || y < 0) {
          const angle = Math.random() * Math.PI * 2;
          const r = radius * (0.8 + Math.random() * 0.3);
          x = Math.cos(angle) * r;
          y = 0.5 + Math.random() * 1.5;
          z = Math.sin(angle) * r;
        }
        
        positions.setX(i, x);
        positions.setY(i, y);
        positions.setZ(i, z);
      }
      positions.needsUpdate = true;
      debrisMaterial.opacity = currentOpacity * 0.8;
    }

    const now = Date.now();
    const { players, localPlayer } = useGameStore.getState();
    
    for (const [playerId, player] of players) {
      if (playerId === localPlayer?.id) continue;
      if (player.state !== 'alive') continue;
      if (localPlayer && player.team === localPlayer.team) continue;
      
      const dx = player.position.x - position.x;
      const dz = player.position.z - position.z;
      const distSq = dx * dx + dz * dz;
      
      if (distSq <= radius * radius) {
        const lastDamage = lastDamageTickRef.current.get(playerId) || 0;
        if (now - lastDamage >= VOID_ZONE_DAMAGE_INTERVAL) {
          lastDamageTickRef.current.set(playerId, now);
          
          if (playerId.startsWith('npc_')) {
            damageNpc(playerId, VOID_ZONE_DAMAGE);
          }
        }
      }
    }
  });

  return (
    <group ref={groupRef} position={[position.x, position.y + 0.02, position.z]}>
      <mesh ref={vortexRef} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[radius, 128]} />
        <primitive object={vortexMaterial} />
      </mesh>

      <mesh ref={eventHorizonRef} rotation-x={-Math.PI / 2} position-y={0.03}>
        <circleGeometry args={[radius * 0.25, 64]} />
        <primitive object={eventHorizonMaterial} />
      </mesh>

      <group ref={innerRingsRef}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.04}>
          <ringGeometry args={[radius * 0.28, radius * 0.35, 64]} />
          <meshBasicMaterial 
            color={0xc084fc}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        
        <mesh rotation-x={-Math.PI / 2} position-y={0.05}>
          <ringGeometry args={[radius * 0.45, radius * 0.55, 64]} />
          <meshBasicMaterial 
            color={0x7c3aed}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        
        <mesh rotation-x={-Math.PI / 2} position-y={0.06}>
          <ringGeometry args={[radius * 0.7, radius * 0.8, 64]} />
          <meshBasicMaterial 
            color={0x9333ea}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      <mesh rotation-x={-Math.PI / 2} position-y={0.08}>
        <ringGeometry args={[radius * 0.95, radius * 1.05, 64]} />
        <meshBasicMaterial 
          color={0xc084fc}
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      <points ref={particlesRef} geometry={particleGeometry}>
        <primitive object={particleMaterial} />
      </points>

      <points ref={debrisRef} geometry={debrisGeometry}>
        <primitive object={debrisMaterial} />
      </points>

      <mesh position-y={0.5}>
        <cylinderGeometry args={[0.1, radius * 0.3, 1, 16, 1, true]} />
        <meshBasicMaterial 
          color={0x7c3aed}
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

// Container component
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
  
  useEffect(() => {
    const interval = setInterval(() => {
      clearExpiredVoidZones();
    }, 1000);
    
    return () => clearInterval(interval);
  }, [clearExpiredVoidZones]);
  
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

