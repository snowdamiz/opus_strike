import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import type { Team } from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import { getFrameClock } from '../../../utils/frameClock';

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
const VOID_ZONE_VORTEX_GEOMETRY = new THREE.CircleGeometry(1, 128);
const VOID_ZONE_EVENT_HORIZON_GEOMETRY = new THREE.CircleGeometry(1, 64);
const VOID_ZONE_RING_INNER_GEOMETRY = new THREE.RingGeometry(0.28, 0.35, 64);
const VOID_ZONE_RING_MIDDLE_GEOMETRY = new THREE.RingGeometry(0.45, 0.55, 64);
const VOID_ZONE_RING_OUTER_GEOMETRY = new THREE.RingGeometry(0.7, 0.8, 64);
const VOID_ZONE_BOUNDARY_RING_GEOMETRY = new THREE.RingGeometry(0.95, 1.05, 64);
const VOID_ZONE_MOTE_COUNT = 18;
const VOID_ZONE_MOTE_BASE_HEIGHT = 0.035;
const VOID_ZONE_MOTE_MAX_LIFT = 0.18;
const VOID_ZONE_MOTE_MIN_RADIUS = 0.34;
const VOID_ZONE_MOTE_RESET_RADIUS = 0.8;
const VOID_ZONE_GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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
          
          float glint = pow(max(0.0, sin(angle * 8.0 - time * 2.8 + dist * 12.0)), 10.0) * outerRing;
          color += color4 * glint * 0.9;
          
          float alpha = smoothstep(0.5, 0.2, dist) * opacity;
          alpha = max(alpha, eventHorizon * 0.95);
          alpha = max(alpha, outerRing * ringPulse * 0.68);
          alpha = max(alpha, jets * 0.32);
          
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

export function prewarmVoidZoneResources(): void {
  getVortexMaterial();
  getEventHorizonMaterial();
  getAccretionMaterial();
}

export function appendVoidZoneGpuPrewarmObjects(target: THREE.Object3D): void {
  prewarmVoidZoneResources();

  const group = new THREE.Group();
  group.name = 'gpu-prewarm-void-zone';
  group.position.set(1.4, 0, -4.8);
  group.scale.setScalar(0.28);

  group.add(new THREE.Mesh(VOID_ZONE_VORTEX_GEOMETRY, getVortexMaterial()));
  group.add(new THREE.Mesh(VOID_ZONE_EVENT_HORIZON_GEOMETRY, getEventHorizonMaterial()));
  group.add(new THREE.Mesh(VOID_ZONE_RING_INNER_GEOMETRY, getAccretionMaterial()));
  group.add(new THREE.Mesh(VOID_ZONE_RING_MIDDLE_GEOMETRY, getAccretionMaterial()));
  group.add(new THREE.Mesh(VOID_ZONE_RING_OUTER_GEOMETRY, getAccretionMaterial()));
  group.add(new THREE.Mesh(VOID_ZONE_BOUNDARY_RING_GEOMETRY, getAccretionMaterial()));

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    0.18, 0.01, 0.16,
    -0.14, 0.02, -0.2,
  ]), 3));
  particleGeometry.setAttribute('speed', new THREE.BufferAttribute(new Float32Array([0.45, 0.7, 0.9]), 1));
  particleGeometry.setAttribute('angle', new THREE.BufferAttribute(new Float32Array([0, 2.1, 4.2]), 1));
  particleGeometry.setAttribute('radius', new THREE.BufferAttribute(new Float32Array([0.2, 0.48, 0.72]), 1));
  group.add(new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    color: 0xc084fc,
    size: 0.08,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  })));

  target.add(group);
}

export const VoidZone = React.memo(({ position, radius, duration, startTime, ownerId }: VoidZoneProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const innerRingsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const timeRef = useRef(0);
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - startTime));

  const vortexMaterial = useMemo(() => getVortexMaterial().clone(), []);
  const eventHorizonMaterial = useMemo(() => getEventHorizonMaterial().clone(), []);
  const accretionMaterial = useMemo(() => getAccretionMaterial().clone(), []);

  const particleGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(VOID_ZONE_MOTE_COUNT * 3);
    const speeds = new Float32Array(VOID_ZONE_MOTE_COUNT);
    const angles = new Float32Array(VOID_ZONE_MOTE_COUNT);
    const radii = new Float32Array(VOID_ZONE_MOTE_COUNT);
    
    for (let i = 0; i < VOID_ZONE_MOTE_COUNT; i++) {
      const angle = i * VOID_ZONE_GOLDEN_ANGLE;
      const band = (i % 6) / 5;
      const r = radius * Math.min(0.94, VOID_ZONE_MOTE_MIN_RADIUS + band * 0.54);
      const height = VOID_ZONE_MOTE_BASE_HEIGHT + ((i % 4) / 3) * 0.06;
      
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = height;
      positions[i * 3 + 2] = Math.sin(angle) * r;
      speeds[i] = 0.34 + (i % 5) * 0.08;
      angles[i] = angle;
      radii[i] = r;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));
    geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1));
    
    return geometry;
  }, [radius]);

  const particleMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0xc084fc,
    size: 0.075,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);

  useFrame((_, delta) => {
    if (!groupRef.current) return;

    const frameClock = getFrameClock();
    const progress = Math.min(1, ((frameClock.nowMs - startFrameTimeRef.current) / 1000) / duration);
    
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
      const rings = innerRingsRef.current.children;
      for (let i = 0; i < rings.length; i++) {
        const ring = rings[i];
        const speed = 1 + i * 0.5;
        const direction = i % 2 === 0 ? 1 : -1;
        ring.rotation.z += delta * speed * direction;
        const scale = 1 + Math.sin(time * 3 + i) * 0.1;
        ring.scale.setScalar(scale);
      }
    }

    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const speeds = particlesRef.current.geometry.attributes.speed as THREE.BufferAttribute;
      const angleAttrs = particlesRef.current.geometry.attributes.angle as THREE.BufferAttribute;
      const radiiAttrs = particlesRef.current.geometry.attributes.radius as THREE.BufferAttribute;
      // Index the typed arrays directly to avoid per-particle getX/setX call overhead.
      // angle/radius are CPU-only persistent state (never uploaded), so only the
      // position attribute is flagged needsUpdate, matching the original behavior.
      const positionArray = positions.array as Float32Array;
      const speedArray = speeds.array as Float32Array;
      const angleArray = angleAttrs.array as Float32Array;
      const radiusArray = radiiAttrs.array as Float32Array;
      const count = positions.count;

      for (let i = 0; i < count; i++) {
        const speed = speedArray[i];
        let angle = angleArray[i];
        let r = radiusArray[i];

        const normalizedRadius = r / radius;
        angle += delta * speed * (0.7 + (1 - normalizedRadius) * 0.9);
        r -= delta * 0.14;

        if (r < radius * VOID_ZONE_MOTE_MIN_RADIUS) {
          r = radius * (VOID_ZONE_MOTE_RESET_RADIUS + ((i * 17) % 5) * 0.028);
          angle += Math.PI * 1.381966;
        }

        angleArray[i] = angle;
        radiusArray[i] = r;

        const lift = (Math.sin(time * 2.2 + i * 0.85) * 0.5 + 0.5) * VOID_ZONE_MOTE_MAX_LIFT;
        const height = VOID_ZONE_MOTE_BASE_HEIGHT + lift * (1 - Math.min(0.85, r / radius) * 0.65);

        positionArray[i * 3] = Math.cos(angle) * r;
        positionArray[i * 3 + 1] = height;
        positionArray[i * 3 + 2] = Math.sin(angle) * r;
      }
      positions.needsUpdate = true;
      particleMaterial.opacity = currentOpacity * 0.48;
    }
  });

  return (
    <group ref={groupRef} position={[position.x, position.y + 0.02, position.z]}>
      <mesh rotation-x={-Math.PI / 2} geometry={VOID_ZONE_VORTEX_GEOMETRY} scale={[radius, radius, 1]}>
        <primitive object={vortexMaterial} />
      </mesh>

      <mesh
        rotation-x={-Math.PI / 2}
        position-y={0.03}
        geometry={VOID_ZONE_EVENT_HORIZON_GEOMETRY}
        scale={[radius * 0.25, radius * 0.25, 1]}
      >
        <primitive object={eventHorizonMaterial} />
      </mesh>

      <group ref={innerRingsRef}>
        <mesh rotation-x={-Math.PI / 2} position-y={0.04} geometry={VOID_ZONE_RING_INNER_GEOMETRY} scale={[radius, radius, 1]}>
          <meshBasicMaterial 
            color={0xc084fc}
            transparent
            opacity={0.7}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        
        <mesh rotation-x={-Math.PI / 2} position-y={0.05} geometry={VOID_ZONE_RING_MIDDLE_GEOMETRY} scale={[radius, radius, 1]}>
          <meshBasicMaterial 
            color={0x7c3aed}
            transparent
            opacity={0.5}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        
        <mesh rotation-x={-Math.PI / 2} position-y={0.06} geometry={VOID_ZONE_RING_OUTER_GEOMETRY} scale={[radius, radius, 1]}>
          <meshBasicMaterial 
            color={0x9333ea}
            transparent
            opacity={0.4}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      <mesh rotation-x={-Math.PI / 2} position-y={0.08} geometry={VOID_ZONE_BOUNDARY_RING_GEOMETRY} scale={[radius, radius, 1]}>
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
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (position)
  return (
    prev.position.x === next.position.x &&
    prev.position.y === next.position.y &&
    prev.position.z === next.position.z &&
    prev.radius === next.radius &&
    prev.duration === next.duration &&
    prev.startTime === next.startTime &&
    prev.ownerId === next.ownerId
  );
});

// Container component
interface VoidZoneData {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  duration: number;
  startTime: number;
  ownerId: string;
  ownerTeam: Team;
}

interface VoidZonesProps {
  zones: VoidZoneData[];
}

export function VoidZones({ zones }: VoidZonesProps) {
  return (
    <>
      {zones.map((zone) => (
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

export function VoidZonesManager() {
  const zones = useGameStore(state => state.voidZones);
  return <VoidZones zones={zones} />;
}
