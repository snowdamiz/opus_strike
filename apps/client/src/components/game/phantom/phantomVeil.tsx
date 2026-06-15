import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../../../store/gameStore';
import { visualStore } from '../../../store/visualStore';

// ============================================================================
// PHANTOM VEIL 3D EFFECT
// A fractured phase-cloak that wraps the player in broken light.
// ============================================================================

interface PhantomVeilEffectProps {
  isActive: boolean;
  playerPosition?: { x: number; y: number; z: number };
  playerId?: string;
  renderParticles?: boolean;
}

const VEIL_HEIGHT = 2.65;
const VEIL_PARTICLE_COUNT = 150;
const VEIL_RIBBON_COUNT = 10;
const TWO_PI = Math.PI * 2;

const VEIL_SHELL_GEOMETRY = new THREE.CylinderGeometry(1, 0.72, VEIL_HEIGHT, 36, 10, true);
const VEIL_RING_GEOMETRY = new THREE.RingGeometry(0.68, 1, 48);
const VEIL_DISC_GEOMETRY = new THREE.CircleGeometry(1, 48);
const VEIL_RIBBON_GEOMETRY = new THREE.PlaneGeometry(1, 1, 1, 10);

function createVeilShellMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      pulse: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float time;

      void main() {
        vUv = uv;
        vec3 pos = position;
        float angle = atan(pos.z, pos.x);
        float ripple = sin(pos.y * 8.0 + angle * 4.0 + time * 2.8) * 0.028;
        pos.xz *= 1.0 + ripple;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float time;
      uniform float pulse;

      void main() {
        float bottomFade = smoothstep(0.0, 0.16, vUv.y);
        float topFade = 1.0 - smoothstep(0.78, 1.0, vUv.y);
        float fade = bottomFade * topFade;

        float band = smoothstep(0.82, 1.0, abs(sin((vUv.y - time * 0.15) * 28.0)));
        float seam = smoothstep(0.92, 1.0, abs(sin(vUv.x * 22.0 + time * 0.9 + sin(vUv.y * 9.0))));
        float staticBreak = step(0.84, fract(sin(dot(floor(vUv * 36.0), vec2(12.9898, 78.233))) * 43758.5453 + time * 0.18));

        vec3 voidBlue = vec3(0.015, 0.025, 0.075);
        vec3 coldCyan = vec3(0.08, 0.88, 1.0);
        vec3 veilViolet = vec3(0.58, 0.25, 1.0);
        vec3 color = mix(voidBlue, coldCyan, band * 0.68);
        color = mix(color, veilViolet, seam * 0.5 + pulse * 0.12);
        color += vec3(0.88, 0.96, 1.0) * staticBreak * band * 0.35;

        float alpha = (0.045 + band * 0.18 + seam * 0.11 + staticBreak * 0.07) * fade;
        alpha *= 0.78 + pulse * 0.32;

        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createVeilRibbonMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      uniform float time;

      void main() {
        vUv = uv;
        vec3 pos = position;
        pos.x += sin(uv.y * 10.0 + time * 2.0) * 0.035;
        pos.z += cos(uv.y * 7.0 - time * 1.6) * 0.025;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 vUv;
      uniform float time;

      void main() {
        float center = 1.0 - smoothstep(0.0, 0.48, abs(vUv.x - 0.5));
        float heightFade = smoothstep(0.0, 0.14, vUv.y) * (1.0 - smoothstep(0.82, 1.0, vUv.y));
        float cut = smoothstep(0.74, 1.0, abs(sin(vUv.y * 22.0 - time * 3.4)));
        float flash = smoothstep(0.93, 1.0, sin(vUv.y * 9.0 + time * 5.0) * 0.5 + 0.5);

        vec3 color = mix(vec3(0.12, 0.9, 1.0), vec3(0.78, 0.53, 1.0), vUv.y);
        color += vec3(0.95, 1.0, 1.0) * flash * 0.28;

        float alpha = center * heightFade * (0.12 + cut * 0.34 + flash * 0.16);
        gl_FragColor = vec4(color, alpha);
      }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

function createVeilParticleGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(VEIL_PARTICLE_COUNT * 3);
  const angles = new Float32Array(VEIL_PARTICLE_COUNT);
  const radii = new Float32Array(VEIL_PARTICLE_COUNT);
  const speeds = new Float32Array(VEIL_PARTICLE_COUNT);
  const seeds = new Float32Array(VEIL_PARTICLE_COUNT);

  for (let i = 0; i < VEIL_PARTICLE_COUNT; i++) {
    const angle = Math.random() * TWO_PI;
    const radius = 0.52 + Math.random() * 0.78;
    const height = Math.random() * VEIL_HEIGHT;

    positions[i * 3] = Math.cos(angle) * radius;
    positions[i * 3 + 1] = height;
    positions[i * 3 + 2] = Math.sin(angle) * radius;
    angles[i] = angle;
    radii[i] = radius;
    speeds[i] = 0.65 + Math.random() * 1.35;
    seeds[i] = Math.random();
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('angle', new THREE.BufferAttribute(angles, 1));
  geometry.setAttribute('radius', new THREE.BufferAttribute(radii, 1));
  geometry.setAttribute('speed', new THREE.BufferAttribute(speeds, 1));
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  return geometry;
}

export function PhantomVeil3DEffect({
  isActive,
  playerPosition,
  playerId,
  renderParticles = true,
}: PhantomVeilEffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const ribbonGroupRef = useRef<THREE.Group>(null);
  const lowRingRef = useRef<THREE.Mesh>(null);
  const highRingRef = useRef<THREE.Mesh>(null);

  const shellMaterial = useMemo(() => createVeilShellMaterial(), []);
  const ribbonMaterial = useMemo(() => createVeilRibbonMaterial(), []);
  const particleGeometry = useMemo(() => createVeilParticleGeometry(), []);
  const particleMaterial = useMemo(() => new THREE.PointsMaterial({
    color: 0x67e8f9,
    size: 0.075,
    transparent: true,
    opacity: 0.74,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  }), []);
  const lowRingMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x22d3ee,
    transparent: true,
    opacity: 0.46,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);
  const highRingMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0xc4b5fd,
    transparent: true,
    opacity: 0.34,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }), []);
  const eclipseMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x020617,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  }), []);
  const ribbonConfigs = useMemo(() => (
    Array.from({ length: VEIL_RIBBON_COUNT }, (_, index) => {
      const angle = (index / VEIL_RIBBON_COUNT) * TWO_PI;
      return {
        angle,
        radius: 0.72 + (index % 3) * 0.08,
        height: 1.7 + (index % 4) * 0.18,
        width: 0.12 + (index % 2) * 0.055,
        y: 1.03 + (index % 3) * 0.12,
      };
    })
  ), []);

  useEffect(() => () => {
    shellMaterial.dispose();
    ribbonMaterial.dispose();
    particleGeometry.dispose();
    particleMaterial.dispose();
    lowRingMaterial.dispose();
    highRingMaterial.dispose();
    eclipseMaterial.dispose();
  }, [
    eclipseMaterial,
    highRingMaterial,
    lowRingMaterial,
    particleGeometry,
    particleMaterial,
    ribbonMaterial,
    shellMaterial,
  ]);

  useFrame((state, delta) => {
    if (!isActive || !groupRef.current) return;

    const store = useGameStore.getState();
    const trackedPlayer = playerId
      ? (store.localPlayer?.id === playerId ? store.localPlayer : store.players.get(playerId))
      : null;
    const trackedPosition = playerId
      ? (visualStore.getState().playerPositions.get(playerId) ?? trackedPlayer?.position)
      : null;
    const currentPosition = trackedPosition ?? playerPosition;
    if (!currentPosition) {
      groupRef.current.visible = false;
      return;
    }

    const time = state.clock.elapsedTime;
    const pulse = Math.sin(time * 4.2) * 0.5 + 0.5;

    groupRef.current.visible = true;
    groupRef.current.position.set(currentPosition.x, currentPosition.y - 0.92, currentPosition.z);
    groupRef.current.rotation.y = Math.sin(time * 0.62) * 0.045;

    shellMaterial.uniforms.time.value = time;
    shellMaterial.uniforms.pulse.value = pulse;
    ribbonMaterial.uniforms.time.value = time;

    if (ribbonGroupRef.current) {
      ribbonGroupRef.current.rotation.y -= delta * 0.36;
    }

    if (lowRingRef.current) {
      lowRingRef.current.rotation.z += delta * 1.45;
      lowRingRef.current.scale.setScalar(1 + pulse * 0.12);
      lowRingMaterial.opacity = 0.24 + pulse * 0.28;
    }

    if (highRingRef.current) {
      highRingRef.current.rotation.z -= delta * 0.9;
      highRingRef.current.scale.setScalar(0.78 + (1 - pulse) * 0.1);
      highRingMaterial.opacity = 0.18 + (1 - pulse) * 0.22;
    }

    if (renderParticles && particlesRef.current) {
      const positions = particlesRef.current.geometry.attributes.position as THREE.BufferAttribute;
      const angles = particlesRef.current.geometry.attributes.angle as THREE.BufferAttribute;
      const radii = particlesRef.current.geometry.attributes.radius as THREE.BufferAttribute;
      const speeds = particlesRef.current.geometry.attributes.speed as THREE.BufferAttribute;
      const seeds = particlesRef.current.geometry.attributes.seed as THREE.BufferAttribute;

      for (let i = 0; i < positions.count; i++) {
        const seed = seeds.getX(i);
        const speed = speeds.getX(i);
        const rise = (seed + time * (0.08 + speed * 0.055)) % 1;
        const angle = angles.getX(i) + time * (0.28 + speed * 0.17) + Math.sin(time * 1.3 + seed * 11) * 0.18;
        const radius = radii.getX(i) + Math.sin(time * 2.4 + seed * 19) * 0.1;

        positions.setXYZ(
          i,
          Math.cos(angle) * radius,
          rise * VEIL_HEIGHT,
          Math.sin(angle) * radius
        );
      }

      positions.needsUpdate = true;
      particleMaterial.opacity = 0.54 + pulse * 0.26;
    }
  });

  if (!isActive) return null;

  return (
    <group ref={groupRef}>
      <mesh geometry={VEIL_DISC_GEOMETRY} rotation-x={-Math.PI / 2} position-y={0.035} scale={[0.86, 0.86, 1]}>
        <primitive object={eclipseMaterial} />
      </mesh>

      <mesh geometry={VEIL_SHELL_GEOMETRY} position-y={VEIL_HEIGHT / 2} scale={[0.82, 1, 0.82]}>
        <primitive object={shellMaterial} />
      </mesh>

      <group ref={ribbonGroupRef}>
        {ribbonConfigs.map(config => (
          <mesh
            key={config.angle}
            geometry={VEIL_RIBBON_GEOMETRY}
            position={[
              Math.cos(config.angle) * config.radius,
              config.y,
              Math.sin(config.angle) * config.radius,
            ]}
            rotation-y={Math.PI / 2 - config.angle}
            scale={[config.width, config.height, 1]}
          >
            <primitive object={ribbonMaterial} />
          </mesh>
        ))}
      </group>

      <mesh ref={lowRingRef} geometry={VEIL_RING_GEOMETRY} rotation-x={-Math.PI / 2} position-y={0.08} scale={[1.02, 1.02, 1]}>
        <primitive object={lowRingMaterial} />
      </mesh>

      <mesh ref={highRingRef} geometry={VEIL_RING_GEOMETRY} rotation-x={-Math.PI / 2} position-y={1.62} scale={[0.82, 0.82, 1]}>
        <primitive object={highRingMaterial} />
      </mesh>

      {renderParticles && (
        <points ref={particlesRef} geometry={particleGeometry}>
          <primitive object={particleMaterial} />
        </points>
      )}
    </group>
  );
}
