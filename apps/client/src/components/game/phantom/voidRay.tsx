import { useEffect, useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import React from 'react';
import {
  PHANTOM_VOID_RAY_COLLISION_RADIUS,
  PHANTOM_VOID_RAY_DAMAGE,
  PLAYER_COMBAT_HITBOX_PADDING,
  PLAYER_RADIUS,
  type Team,
} from '@voxel-strike/shared';
import { useGameStore } from '../../../store/gameStore';
import type { VoidRayData } from '../../../store/types';
import { getPhysicsWorld, isPhysicsReady, raycastInto, type RaycastHitResult } from '../../../hooks/usePhysics';
import { getFrameClock } from '../../../utils/frameClock';
import { getFirstChronosAegisVisualHit } from '../chronos/aegisCollision';
import { getAuthoritativeProjectileImpactHit } from '../projectileImpact';
import { measureFrameWork } from '../../../movement/networkDiagnostics';
import { findCombatVisualEnemyPlayerHit, rebuildCombatVisualFrameCache } from '../../../store/visualStore';
import { applyTutorialOfflineTrainingDamage } from '../../../utils/tutorialOfflineCombatRuntime';

interface VoidRayProps {
  id: string;
  startPosition: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  ownerTeam: Team;
  impactPosition?: { x: number; y: number; z: number };
  interceptedByChronosAegis?: boolean;
}

// ============================================================================
// ULTIMATE VOID RAY - DEVASTATING SPIRALING BEAM OF VOID ENERGY
// Features multiple thick purple/cyan spiraling ribbons, intense particles,
// lightning effects, and dramatic impact visuals
// ============================================================================

const RAY_SPEED = 420;
const RAY_LENGTH = 100;
const RAY_RADIUS = PHANTOM_VOID_RAY_COLLISION_RADIUS;
const PROJECTILE_COMBAT_QUERY_PADDING = PLAYER_RADIUS + PLAYER_COMBAT_HITBOX_PADDING + 0.75;
const RAY_SPIN_UP_TIME = 0.24;
const RAY_SUSTAIN_TIME = 0.44;
const RAY_SPIN_DOWN_TIME = 0.32;
const RAY_LIFETIME = RAY_SPIN_UP_TIME + RAY_SUSTAIN_TIME + RAY_SPIN_DOWN_TIME;
const SPIRAL_COUNT = 5;
const PARTICLE_COUNT = 120;
const SPARK_COUNT = 32;
const VOID_RAY_COLLISION_SAMPLE_INTERVAL_MS = 34;
const LOCAL_ORIGIN_HALO_INNER_RADIUS = RAY_RADIUS * 5.5;
const LOCAL_ORIGIN_HALO_OUTER_RADIUS = RAY_RADIUS * 7.5;
const LOCAL_ORIGIN_HALO_SECONDARY_INNER_RADIUS = RAY_RADIUS * 8.5;
const LOCAL_ORIGIN_HALO_SECONDARY_OUTER_RADIUS = RAY_RADIUS * 11;
const VOID_RAY_IMPACT_SPARK_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const RAY_GLOW_GEOMETRY = new THREE.CylinderGeometry(RAY_RADIUS * 2.0, RAY_RADIUS * 2.2, 1, 20, 1, true);
const RAY_BEAM_GEOMETRY = new THREE.CylinderGeometry(RAY_RADIUS * 0.6, RAY_RADIUS * 0.7, 1, 16, 8, true);
const RAY_CORE_GEOMETRY = new THREE.CylinderGeometry(RAY_RADIUS * 0.2, RAY_RADIUS * 0.25, 1, 12, 1, true);
const LOCAL_ORIGIN_HALO_GEOMETRY = new THREE.RingGeometry(LOCAL_ORIGIN_HALO_INNER_RADIUS, LOCAL_ORIGIN_HALO_OUTER_RADIUS, 48);
const LOCAL_ORIGIN_HALO_SECONDARY_GEOMETRY = new THREE.RingGeometry(
  LOCAL_ORIGIN_HALO_SECONDARY_INNER_RADIUS,
  LOCAL_ORIGIN_HALO_SECONDARY_OUTER_RADIUS,
  64
);
const LOCAL_ORIGIN_ENERGY_CORE_GEOMETRY = new THREE.SphereGeometry(RAY_RADIUS * 0.9, 16, 16);
const LOCAL_ORIGIN_ENERGY_GLOW_GEOMETRY = new THREE.SphereGeometry(RAY_RADIUS * 1.55, 18, 18);
const LOCAL_ORIGIN_ENERGY_SHELL_GEOMETRY = new THREE.SphereGeometry(RAY_RADIUS * 1.15, 12, 12);
const LOCAL_ORIGIN_ENERGY_RING_GEOMETRY = new THREE.RingGeometry(RAY_RADIUS * 1.45, RAY_RADIUS * 2.35, 32);
const REMOTE_ORIGIN_CORE_GEOMETRY = new THREE.SphereGeometry(RAY_RADIUS * 1.8, 24, 24);
const REMOTE_ORIGIN_GLOW_GEOMETRY = new THREE.SphereGeometry(RAY_RADIUS * 2.5, 16, 16);
const VOID_RAY_IMPACT_INNER_RING_GEOMETRY = new THREE.RingGeometry(0.2, 0.6, 32);
const VOID_RAY_IMPACT_OUTER_RING_GEOMETRY = new THREE.RingGeometry(0.6, 1.0, 32);
const VOID_RAY_IMPACT_SPARK_GEOMETRY = new THREE.SphereGeometry(0.06, 8, 8);
const VOID_RAY_IMPACT_SPARK_CONFIGS = VOID_RAY_IMPACT_SPARK_INDICES.map((i) => {
  const angle = (i / VOID_RAY_IMPACT_SPARK_INDICES.length) * Math.PI * 2;
  const radius = 0.4 + (i % 2) * 0.3;
  return {
    x: Math.cos(angle) * radius,
    z: Math.sin(angle) * radius,
    color: i % 2 === 0 ? 0x00ffff : 0xc084fc,
  };
});

function clamp01(value: number): number {
  return THREE.MathUtils.clamp(value, 0, 1);
}

function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

function easeInCubic(value: number): number {
  const t = clamp01(value);
  return t ** 3;
}

function applyOpacityEnvelope(root: THREE.Object3D | null, opacityEnvelope: number): void {
  if (!root) return;

  root.traverse((object) => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;

    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      const materialWithOpacity = mat as THREE.Material & { opacity?: number };
      if (typeof materialWithOpacity.opacity !== 'number') continue;

      const baseOpacity = typeof mat.userData.voidRayBaseOpacity === 'number'
        ? mat.userData.voidRayBaseOpacity
        : materialWithOpacity.opacity;
      mat.userData.voidRayBaseOpacity = baseOpacity;
      materialWithOpacity.opacity = baseOpacity * opacityEnvelope;
    }
  });
}

function getVoidRayAnimationEnvelope(elapsed: number) {
  const spinUp = clamp01(elapsed / RAY_SPIN_UP_TIME);
  const spinDown = clamp01((elapsed - RAY_SPIN_UP_TIME - RAY_SUSTAIN_TIME) / RAY_SPIN_DOWN_TIME);
  const spinUpEase = easeOutCubic(spinUp);
  const spinDownEase = THREE.MathUtils.smootherstep(spinDown, 0, 1);
  const intensity = spinUpEase * (1 - spinDownEase);
  const lengthScale = spinUpEase * (1 - easeInCubic(spinDown) * 0.82);

  return {
    spinUp,
    spinDown,
    spinUpEase,
    spinDownEase,
    intensity,
    lengthScale,
    beamWidth: THREE.MathUtils.lerp(0.18, 1.08, intensity) * (1 + spinDownEase * 0.18),
    glowWidth: THREE.MathUtils.lerp(0.35, 1.18, intensity) * (1 + spinDownEase * 0.32),
    originScale: (0.12 + spinUpEase * 0.94) * (1 - spinDownEase * 0.95),
    spinSpeed: THREE.MathUtils.lerp(4.5, 23, spinUpEase) * (1 - spinDownEase * 0.72),
  };
}

// Main spiral ribbon shader - thick glowing energy ribbons
let sharedSpiralMaterial: THREE.ShaderMaterial | null = null;
let sharedSpiralGeometries: THREE.TubeGeometry[] | null = null;

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

function getSharedSpiralGeometries(): THREE.TubeGeometry[] {
  if (!sharedSpiralGeometries) {
    sharedSpiralGeometries = [];

    for (let s = 0; s < SPIRAL_COUNT; s++) {
      const points: THREE.Vector3[] = [];
      const segments = 80;

      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const y = t;
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
      sharedSpiralGeometries.push(new THREE.TubeGeometry(curve, 64, 0.07 + s * 0.01, 8, false));
    }
  }

  return sharedSpiralGeometries;
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
    getSharedSpiralGeometries();
  });
}

export function prewarmVoidRayResources(): void {
  getSpiralMaterial();
  getCoreMaterial();
  getGlowMaterial();
  getSharedSpiralGeometries();
}

export function appendVoidRayGpuPrewarmObjects(target: THREE.Object3D): void {
  prewarmVoidRayResources();

  const group = new THREE.Group();
  group.name = 'gpu-prewarm-void-ray';
  group.position.set(0.2, 0, -5);
  group.scale.setScalar(0.25);

  group.add(new THREE.Mesh(RAY_GLOW_GEOMETRY, getGlowMaterial()));
  group.add(new THREE.Mesh(RAY_BEAM_GEOMETRY, getCoreMaterial()));
  group.add(new THREE.Mesh(RAY_CORE_GEOMETRY, getCoreMaterial()));
  group.add(new THREE.Mesh(LOCAL_ORIGIN_HALO_GEOMETRY, new THREE.MeshBasicMaterial({
    color: 0xc084fc,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })));
  group.add(new THREE.Mesh(LOCAL_ORIGIN_HALO_SECONDARY_GEOMETRY, new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })));
  group.add(new THREE.Mesh(LOCAL_ORIGIN_ENERGY_CORE_GEOMETRY, new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })));
  group.add(new THREE.Mesh(LOCAL_ORIGIN_ENERGY_GLOW_GEOMETRY, getGlowMaterial()));
  group.add(new THREE.Mesh(LOCAL_ORIGIN_ENERGY_SHELL_GEOMETRY, getCoreMaterial()));
  group.add(new THREE.Mesh(LOCAL_ORIGIN_ENERGY_RING_GEOMETRY, new THREE.MeshBasicMaterial({
    color: 0x7c3aed,
    transparent: true,
    opacity: 0.32,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })));
  group.add(new THREE.Mesh(REMOTE_ORIGIN_CORE_GEOMETRY, getCoreMaterial()));
  group.add(new THREE.Mesh(REMOTE_ORIGIN_GLOW_GEOMETRY, getGlowMaterial()));
  group.add(new THREE.Mesh(VOID_RAY_IMPACT_INNER_RING_GEOMETRY, new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })));
  group.add(new THREE.Mesh(VOID_RAY_IMPACT_OUTER_RING_GEOMETRY, new THREE.MeshBasicMaterial({
    color: 0xc084fc,
    transparent: true,
    opacity: 0.48,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })));
  group.add(new THREE.Mesh(VOID_RAY_IMPACT_SPARK_GEOMETRY, new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  })));

  for (const geometry of getSharedSpiralGeometries()) {
    group.add(new THREE.Mesh(geometry, getSpiralMaterial()));
  }

  const particleGeometry = new THREE.BufferGeometry();
  particleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, 0, 0,
    0.1, 0.25, -0.2,
    -0.1, -0.25, -0.4,
  ]), 3));
  particleGeometry.setAttribute('random', new THREE.BufferAttribute(new Float32Array([0.15, 0.5, 0.85]), 1));
  particleGeometry.setAttribute('speed', new THREE.BufferAttribute(new Float32Array([0.4, 0.8, 1]), 1));
  particleGeometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array([0.12, 0.16, 0.1]), 1));
  group.add(new THREE.Points(particleGeometry, new THREE.PointsMaterial({
    color: 0xc084fc,
    size: 0.12,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  })));

  target.add(group);
}

export const VoidRay = React.memo(({
  id,
  startPosition,
  direction,
  startTime,
  ownerId,
  ownerTeam,
  impactPosition,
  interceptedByChronosAegis,
}: VoidRayProps) => {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const spiralsRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const sparkParticlesRef = useRef<THREE.Points>(null);
  const impactRef = useRef<THREE.Group>(null);
  const originEnergyCoreRef = useRef<THREE.Mesh>(null);
  const originEnergyGlowRef = useRef<THREE.Mesh>(null);
  const originEnergyShellRef = useRef<THREE.Mesh>(null);
  const originEnergyRingRef = useRef<THREE.Mesh>(null);
  const localOriginHaloRef = useRef<THREE.Mesh>(null);
  const localOriginHaloSecondaryRef = useRef<THREE.Mesh>(null);
  const remoteOriginCoreRef = useRef<THREE.Mesh>(null);
  const remoteOriginGlowRef = useRef<THREE.Mesh>(null);
  const hasRequestedRemovalRef = useRef(false);
  const lastCollisionSampleRef = useRef(-VOID_RAY_COLLISION_SAMPLE_INTERVAL_MS);
  const cachedVisualCollisionDistanceRef = useRef<number | null>(null);
  const hasAppliedPracticeDamageRef = useRef(false);
  const terrainHitRef = useRef<RaycastHitResult>({
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1, z: 0 },
    distance: 0,
  });
  const startFrameTimeRef = useRef(getFrameClock().nowMs - Math.max(0, Date.now() - startTime));
  
  const isLocalOwner = useGameStore(state => state.localPlayer?.id === ownerId);
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
  
  const spiralGeometries = useMemo(() => getSharedSpiralGeometries(), []);
  
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
    
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.StreamDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    
    return geometry;
  }, []);
  
  // Spark particles - bright flashes
  const sparkGeometry = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const count = SPARK_COUNT;
    const positions = new Float32Array(count * 3);
    const randoms = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      positions[i * 3] = 0;
      positions[i * 3 + 1] = Math.random();
      positions[i * 3 + 2] = 0;
      randoms[i] = Math.random();
    }
    
    const positionAttribute = new THREE.BufferAttribute(positions, 3);
    positionAttribute.setUsage(THREE.StreamDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('random', new THREE.BufferAttribute(randoms, 1));
    
    return geometry;
  }, []);
  
  const particleMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0xc084fc,
    size: 0.1,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);
  
  const sparkMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0x00ffff,
    size: 0.15,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);

  useEffect(() => () => {
    spiralMaterials.forEach((material) => material.dispose());
    coreMaterial.dispose();
    glowMaterial.dispose();
    particleGeometry.dispose();
    sparkGeometry.dispose();
    particleMaterial.dispose();
    sparkMaterial.dispose();
  }, [
    coreMaterial,
    glowMaterial,
    particleGeometry,
    particleMaterial,
    sparkGeometry,
    sparkMaterial,
    spiralMaterials,
  ]);
  
  // Beam rotation
  const rotation = useMemo(() => {
    const dir = new THREE.Vector3(direction.x, direction.y, direction.z).normalize();
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return new THREE.Euler().setFromQuaternion(quaternion);
  }, [direction.x, direction.y, direction.z]);
  
  
  useFrame((state, delta) => measureFrameWork('frame.effects.voidRay', () => {
    if (!groupRef.current) return;
    
    const frameNow = getFrameClock().nowMs;
    const elapsed = (frameNow - startFrameTimeRef.current) / 1000;
    
    if (elapsed >= RAY_LIFETIME) {
      groupRef.current.visible = false;
      if (!hasRequestedRemovalRef.current) {
        hasRequestedRemovalRef.current = true;
        removeVoidRay(id);
      }
      return;
    }
    
    const time = state.clock.elapsedTime;
    const envelope = getVoidRayAnimationEnvelope(elapsed);
    groupRef.current.visible = envelope.intensity > 0.002;
    
    // Calculate beam length
    let targetLength = Math.min(RAY_LENGTH, elapsed * RAY_SPEED) * envelope.lengthScale;
    const authoritativeHit = interceptedByChronosAegis
      ? getAuthoritativeProjectileImpactHit(
        startPosition,
        direction,
        impactPosition,
        targetLength,
        RAY_RADIUS
      )
      : null;
    
    if (frameNow - lastCollisionSampleRef.current >= VOID_RAY_COLLISION_SAMPLE_INTERVAL_MS) {
      lastCollisionSampleRef.current = frameNow;
      let visualCollisionDistance: number | null = null;
      const aegisHit = getFirstChronosAegisVisualHit(
        startPosition,
        direction,
        targetLength,
        ownerTeam,
        ownerId,
        RAY_RADIUS
      );
      if (aegisHit) {
        visualCollisionDistance = aegisHit.distance;
      }

      if (isPhysicsReady()) {
        const world = getPhysicsWorld();
        if (world) {
          const hasHit = raycastInto(terrainHitRef.current, world, startPosition, direction, targetLength, {
            priority: 'visual',
            feature: 'effect:voidRayBeam',
          });
          if (hasHit) {
            visualCollisionDistance = visualCollisionDistance === null
              ? terrainHitRef.current.distance
              : Math.min(visualCollisionDistance, terrainHitRef.current.distance);
          }
        }
      }
      cachedVisualCollisionDistanceRef.current = visualCollisionDistance;
    }
    const visualCollisionDistance = cachedVisualCollisionDistanceRef.current;
    if (visualCollisionDistance !== null && visualCollisionDistance < targetLength) {
      targetLength = visualCollisionDistance;
    }
    if (authoritativeHit && authoritativeHit.distance < targetLength) {
      targetLength = authoritativeHit.distance;
    }

    if (!hasAppliedPracticeDamageRef.current && targetLength > 0.001) {
      const store = useGameStore.getState();
      if (store.isPracticeMode && store.gamePhase === 'playing') {
        const clock = getFrameClock();
        const combatCache = rebuildCombatVisualFrameCache(
          store.players.values(),
          clock.nowMs,
          clock.nowMs,
          store.players.size
        );
        const hitPlayer = findCombatVisualEnemyPlayerHit(
          combatCache,
          ownerTeam,
          ownerId,
          startPosition,
          direction,
          targetLength,
          RAY_RADIUS,
          {
            x: startPosition.x + direction.x * targetLength * 0.5,
            z: startPosition.z + direction.z * targetLength * 0.5,
          },
          targetLength * 0.5 + RAY_RADIUS + PROJECTILE_COMBAT_QUERY_PADDING
        );

        if (hitPlayer) {
          const result = applyTutorialOfflineTrainingDamage({
            target: hitPlayer,
            damage: PHANTOM_VOID_RAY_DAMAGE,
            damageType: 'void_ray',
            hitPosition: { x: hitPlayer.position.x, y: hitPlayer.position.y, z: hitPlayer.position.z },
            sourceId: ownerId,
            sourceTeam: ownerTeam,
            abilityId: 'phantom_void_ray',
          });
          hasAppliedPracticeDamageRef.current = result.applied;
        }
      }
    }

    const safeTargetLength = Math.max(targetLength, 0.001);
    
    // Update core beam
    if (beamRef.current) {
      beamRef.current.scale.set(envelope.beamWidth, targetLength, envelope.beamWidth);
      beamRef.current.position.y = targetLength / 2;
    }
    
    if (coreRef.current) {
      const coreWidth = envelope.beamWidth * 0.86;
      coreRef.current.scale.set(coreWidth, targetLength, coreWidth);
      coreRef.current.position.y = targetLength / 2;
      applyOpacityEnvelope(coreRef.current, envelope.intensity);
    }
    
    if (glowRef.current) {
      glowRef.current.scale.set(envelope.glowWidth, targetLength, envelope.glowWidth);
      glowRef.current.position.y = targetLength / 2;
    }
    
    // Update materials
    if (coreMaterial.uniforms) {
      coreMaterial.uniforms.time.value = time;
      coreMaterial.uniforms.progress.value = envelope.intensity;
    }
    
    if (glowMaterial.uniforms) {
      glowMaterial.uniforms.time.value = time;
      glowMaterial.uniforms.progress.value = envelope.intensity;
    }

    if (originEnergyCoreRef.current && originEnergyGlowRef.current && originEnergyShellRef.current && originEnergyRingRef.current) {
      const originPulse = 1 + Math.sin(time * 18.5) * 0.08 + Math.sin(time * 31.0) * 0.035;
      const originScale = envelope.originScale * originPulse;
      originEnergyCoreRef.current.scale.setScalar(originScale);
      originEnergyGlowRef.current.scale.setScalar(originScale * 1.28);
      originEnergyShellRef.current.scale.setScalar(originScale * 1.1);
      originEnergyRingRef.current.scale.setScalar(originScale * (1.08 + Math.sin(time * 12.0) * 0.04));
      originEnergyRingRef.current.rotation.z += delta * (4.8 + envelope.spinSpeed * 0.28);
      applyOpacityEnvelope(originEnergyCoreRef.current, envelope.intensity);
      applyOpacityEnvelope(originEnergyGlowRef.current, envelope.intensity);
      applyOpacityEnvelope(originEnergyShellRef.current, envelope.intensity);
      applyOpacityEnvelope(originEnergyRingRef.current, envelope.intensity);
    }

    if (localOriginHaloRef.current) {
      localOriginHaloRef.current.scale.setScalar(Math.max(0.001, envelope.originScale));
      localOriginHaloRef.current.rotation.z -= delta * envelope.spinSpeed * 0.42;
      applyOpacityEnvelope(localOriginHaloRef.current, envelope.intensity);
    }

    if (localOriginHaloSecondaryRef.current) {
      localOriginHaloSecondaryRef.current.scale.setScalar(Math.max(0.001, envelope.originScale * 1.08));
      localOriginHaloSecondaryRef.current.rotation.z += delta * envelope.spinSpeed * 0.3;
      applyOpacityEnvelope(localOriginHaloSecondaryRef.current, envelope.intensity);
    }

    if (remoteOriginCoreRef.current && remoteOriginGlowRef.current) {
      const remotePulse = 1 + Math.sin(time * 16.0) * 0.07;
      remoteOriginCoreRef.current.scale.setScalar(Math.max(0.001, envelope.originScale * remotePulse));
      remoteOriginGlowRef.current.scale.setScalar(Math.max(0.001, envelope.originScale * 1.22 * remotePulse));
      applyOpacityEnvelope(remoteOriginCoreRef.current, envelope.intensity);
      applyOpacityEnvelope(remoteOriginGlowRef.current, envelope.intensity);
    }
    
    // Update spirals - fast rotation and scale
    if (spiralsRef.current) {
      spiralsRef.current.rotation.y += delta * envelope.spinSpeed;
      
      spiralsRef.current.children.forEach((mesh, i) => {
        mesh.scale.set(envelope.beamWidth, targetLength, envelope.beamWidth);
        
        const mat = spiralMaterials[i];
        if (mat && mat.uniforms) {
          mat.uniforms.time.value = time;
          mat.uniforms.progress.value = envelope.intensity;
          mat.uniforms.beamLength.value = targetLength;
        }
      });
    }
    
    // Animate particles - spiral motion
    if (particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const randoms = particlesRef.current.geometry.attributes.random as THREE.BufferAttribute;
      const speeds = particlesRef.current.geometry.attributes.speed as THREE.BufferAttribute;
      const positionArray = positions.array as Float32Array;
      const randomArray = randoms.array as Float32Array;
      const speedArray = speeds.array as Float32Array;
      
      for (let i = 0; i < positions.count; i++) {
        const index = i * 3;
        const r = randomArray[i];
        const speed = speedArray[i];
        
        const angle = r * Math.PI * 2 + time * 10 * speed;
        const baseRadius = RAY_RADIUS * (0.5 + r * 0.8);
        const wobble = Math.sin(time * 20 + r * 30) * 0.08;
        const radius = baseRadius + wobble;
        
        let t = positionArray[index + 1] / safeTargetLength;
        t = (t + delta * speed * 2.5) % 1;
        
        positionArray[index] = Math.cos(angle) * radius;
        positionArray[index + 1] = t * targetLength;
        positionArray[index + 2] = Math.sin(angle) * radius;
      }
      positions.needsUpdate = true;
      
      // Color shift purple->cyan
      const hue = 0.75 + Math.sin(time * 8) * 0.1;
      particleMaterial.color.setHSL(hue, 0.85, 0.65);
      particleMaterial.opacity = envelope.intensity * 0.9;
      particleMaterial.size = THREE.MathUtils.lerp(0.035, 0.11, envelope.intensity);
    }
    
    // Animate spark particles - random flashes
    if (sparkParticlesRef.current) {
      const positions = sparkParticlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const randoms = sparkParticlesRef.current.geometry.attributes.random as THREE.BufferAttribute;
      const positionArray = positions.array as Float32Array;
      const randomArray = randoms.array as Float32Array;
      
      for (let i = 0; i < positions.count; i++) {
        const index = i * 3;
        const r = randomArray[i];
        
        // Random position along beam with spiral
        const t = (r + time * 3) % 1;
        const angle = t * Math.PI * 8 + r * Math.PI * 2;
        const radius = RAY_RADIUS * (1.0 + Math.sin(time * 30 + r * 50) * 0.5);
        
        positionArray[index] = Math.cos(angle) * radius;
        positionArray[index + 1] = t * targetLength;
        positionArray[index + 2] = Math.sin(angle) * radius;
      }
      positions.needsUpdate = true;
      
      // Flicker opacity
      sparkMaterial.opacity = THREE.MathUtils.clamp(
        envelope.intensity * (0.55 + Math.sin(time * 37.0) * 0.25 + Math.sin(time * 19.0 + 1.7) * 0.18),
        0,
        1
      );
      sparkMaterial.size = THREE.MathUtils.lerp(0.045, 0.16, envelope.intensity);
    }
    
    // Impact effect
    if (impactRef.current) {
      const impactEnvelope = envelope.intensity * THREE.MathUtils.smoothstep(targetLength, 8, 28);
      impactRef.current.position.y = targetLength;
      impactRef.current.visible = impactEnvelope > 0.02;
      impactRef.current.rotation.y += delta * (10 + envelope.spinSpeed * 0.65);
      
      const impactPulse = 0.8 + Math.sin(time * 30) * 0.3;
      impactRef.current.scale.setScalar(Math.max(0.001, impactPulse * (0.24 + impactEnvelope * 0.92)));
      applyOpacityEnvelope(impactRef.current, impactEnvelope);
    }
  }));
  
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
      <mesh ref={glowRef} geometry={RAY_GLOW_GEOMETRY} scale={[0.001, 0.001, 0.001]}>
        <primitive object={glowMaterial} />
      </mesh>
      
      {/* ===== MAIN BEAM ===== */}
      <mesh ref={beamRef} geometry={RAY_BEAM_GEOMETRY} scale={[0.001, 0.001, 0.001]}>
        <primitive object={coreMaterial} />
      </mesh>
      
      {/* ===== BRIGHT CORE ===== */}
      <mesh ref={coreRef} geometry={RAY_CORE_GEOMETRY} scale={[0.001, 0.001, 0.001]}>
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
      
      {/* ===== ORIGIN HALO ===== */}
      {isLocalOwner ? (
        <>
          <mesh ref={originEnergyGlowRef} geometry={LOCAL_ORIGIN_ENERGY_GLOW_GEOMETRY} scale={0.001}>
            <meshBasicMaterial
              color={0xc084fc}
              transparent
              opacity={0.42}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
          <mesh ref={originEnergyCoreRef} geometry={LOCAL_ORIGIN_ENERGY_CORE_GEOMETRY} scale={0.001}>
            <meshBasicMaterial
              color={0xffffff}
              transparent
              opacity={0.96}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
          <mesh ref={originEnergyShellRef} geometry={LOCAL_ORIGIN_ENERGY_SHELL_GEOMETRY} scale={0.001}>
            <meshBasicMaterial
              color={0xd8b4fe}
              transparent
              opacity={0.28}
              blending={THREE.AdditiveBlending}
              wireframe
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
          <mesh ref={originEnergyRingRef} rotation-x={-Math.PI / 2} position-y={0.02} geometry={LOCAL_ORIGIN_ENERGY_RING_GEOMETRY} scale={0.001}>
            <meshBasicMaterial
              color={0x22d3ee}
              transparent
              opacity={0.36}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
          <mesh
            ref={localOriginHaloRef}
            rotation-x={-Math.PI / 2}
            geometry={LOCAL_ORIGIN_HALO_GEOMETRY}
            scale={0.001}
          >
            <meshBasicMaterial
              color={0xd8b4fe}
              transparent
              opacity={0.32}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
          <mesh
            ref={localOriginHaloSecondaryRef}
            rotation-x={-Math.PI / 2}
            position-y={0.03}
            geometry={LOCAL_ORIGIN_HALO_SECONDARY_GEOMETRY}
            scale={0.001}
          >
            <meshBasicMaterial
              color={0x22d3ee}
              transparent
              opacity={0.18}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              depthTest={false}
            />
          </mesh>
        </>
      ) : (
        <>
          <mesh ref={remoteOriginCoreRef} geometry={REMOTE_ORIGIN_CORE_GEOMETRY} scale={0.001}>
            <meshBasicMaterial
              color={0xc084fc}
              transparent
              opacity={0.95}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh ref={remoteOriginGlowRef} geometry={REMOTE_ORIGIN_GLOW_GEOMETRY} scale={0.001}>
            <meshBasicMaterial
              color={0x7c3aed}
              transparent
              opacity={0.4}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </>
      )}
      
      {/* ===== IMPACT EFFECT ===== */}
      <group ref={impactRef} scale={0.001} visible={false}>
        {/* Inner ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={VOID_RAY_IMPACT_INNER_RING_GEOMETRY}>
          <meshBasicMaterial
            color={0x00ffff}
            transparent
            opacity={0.9}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Outer ring */}
        <mesh rotation-x={-Math.PI / 2} geometry={VOID_RAY_IMPACT_OUTER_RING_GEOMETRY}>
          <meshBasicMaterial
            color={0xc084fc}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        {/* Impact sparks */}
        {VOID_RAY_IMPACT_SPARK_CONFIGS.map((spark, i) => (
          <mesh key={i} position={[spark.x, 0, spark.z]} geometry={VOID_RAY_IMPACT_SPARK_GEOMETRY}>
            <meshBasicMaterial
              color={spark.color}
              transparent
              opacity={0.9}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}, (prev, next) => {
  // Custom comparison for object props (startPosition, direction)
  return (
    prev.id === next.id &&
    prev.startPosition.x === next.startPosition.x &&
    prev.startPosition.y === next.startPosition.y &&
    prev.startPosition.z === next.startPosition.z &&
    prev.direction.x === next.direction.x &&
    prev.direction.y === next.direction.y &&
    prev.direction.z === next.direction.z &&
    prev.startTime === next.startTime &&
    prev.ownerId === next.ownerId &&
    prev.ownerTeam === next.ownerTeam &&
    prev.impactPosition?.x === next.impactPosition?.x &&
    prev.impactPosition?.y === next.impactPosition?.y &&
    prev.impactPosition?.z === next.impactPosition?.z &&
    prev.interceptedByChronosAegis === next.interceptedByChronosAegis
  );
});

// Container
interface VoidRaysProps {
  rays: VoidRayData[];
}

export function VoidRays({ rays }: VoidRaysProps) {
  return (
    <>
      {rays.map((ray) => (
        <VoidRay
          key={ray.id}
          id={ray.id}
          startPosition={ray.startPosition}
          direction={ray.direction}
          startTime={ray.startTime}
          ownerId={ray.ownerId}
          ownerTeam={ray.ownerTeam}
          impactPosition={ray.impactPosition}
          interceptedByChronosAegis={ray.interceptedByChronosAegis}
        />
      ))}
    </>
  );
}

export function VoidRaysManager() {
  const rays = useGameStore(state => state.voidRays);
  return <VoidRays rays={rays} />;
}
