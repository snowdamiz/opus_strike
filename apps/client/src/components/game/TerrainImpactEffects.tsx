import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLAZE_COLORS,
  EARTH_COLORS,
  HOOKSHOT_COLORS,
  PHANTOM_COLORS,
  SHARED_GEOMETRIES,
} from './effectResources';

export type TerrainImpactKind =
  | 'blaze_rocket'
  | 'blaze_flamethrower'
  | 'phantom_dire_ball'
  | 'hookshot_hook'
  | 'hookshot_drag_hook'
  | 'hookshot_grapple'
  | 'hookshot_trap'
  | 'earth_wall'
  | 'glacier_ice_wall'
  | 'glacier_mallet';

interface TerrainImpactData {
  id: string;
  kind: TerrainImpactKind;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  direction?: { x: number; y: number; z: number };
  startTime: number;
  duration: number;
  scale: number;
  seed: number;
}

interface TerrainImpactOptions {
  normal?: { x: number; y: number; z: number };
  direction?: { x: number; y: number; z: number };
  scale?: number;
}

interface ImpactStyle {
  duration: number;
  scale: number;
  flashColor: number;
  coreColor: number;
  outerColor: number;
  ringColor: number;
  secondRingColor: number;
  particleColors: number[];
  smokeColor: number;
  particleCount: number;
  smokeCount: number;
  particleSpeed: number;
  particleLift: number;
  gravity: number;
  coreRadius: number;
  ringRadius: number;
  lightColor: number;
  lightIntensity: number;
  additive: boolean;
  debrisShape: 'sphere' | 'box' | 'cone';
}

const terrainImpactEffects: TerrainImpactData[] = [];
let terrainImpactIdCounter = 0;
let terrainImpactRevision = 0;

const UP = { x: 0, y: 1, z: 0 };
const MAX_IMPACTS = 80;

function getImpactStyle(kind: TerrainImpactKind): ImpactStyle {
  switch (kind) {
    case 'blaze_rocket':
      return {
        duration: 760,
        scale: 0.62,
        flashColor: BLAZE_COLORS.fireWhite,
        coreColor: BLAZE_COLORS.fireYellow,
        outerColor: BLAZE_COLORS.fireRed,
        ringColor: BLAZE_COLORS.fireOrange,
        secondRingColor: BLAZE_COLORS.fireYellow,
        particleColors: [BLAZE_COLORS.fireYellow, BLAZE_COLORS.fireOrange, BLAZE_COLORS.fireRed],
        smokeColor: BLAZE_COLORS.smokeDark,
        particleCount: 9,
        smokeCount: 2,
        particleSpeed: 4.2,
        particleLift: 3.6,
        gravity: 12,
        coreRadius: 0.82,
        ringRadius: 2.0,
        lightColor: BLAZE_COLORS.fireRed,
        lightIntensity: 9,
        additive: true,
        debrisShape: 'sphere',
      };
    case 'blaze_flamethrower':
      return {
        duration: 360,
        scale: 0.55,
        flashColor: BLAZE_COLORS.fireYellow,
        coreColor: BLAZE_COLORS.fireOrange,
        outerColor: BLAZE_COLORS.fireRed,
        ringColor: BLAZE_COLORS.fireOrange,
        secondRingColor: BLAZE_COLORS.fireYellow,
        particleColors: [BLAZE_COLORS.fireYellow, BLAZE_COLORS.fireOrange],
        smokeColor: BLAZE_COLORS.smokeDark,
        particleCount: 7,
        smokeCount: 2,
        particleSpeed: 3.2,
        particleLift: 2.3,
        gravity: 8,
        coreRadius: 0.7,
        ringRadius: 1.55,
        lightColor: BLAZE_COLORS.fireOrange,
        lightIntensity: 7,
        additive: true,
        debrisShape: 'sphere',
      };
    case 'phantom_dire_ball':
      return {
        duration: 620,
        scale: 0.58,
        flashColor: PHANTOM_COLORS.cyan,
        coreColor: PHANTOM_COLORS.lightPurple,
        outerColor: PHANTOM_COLORS.violet,
        ringColor: PHANTOM_COLORS.cyan,
        secondRingColor: PHANTOM_COLORS.lightPurple,
        particleColors: [PHANTOM_COLORS.cyan, PHANTOM_COLORS.lightPurple, PHANTOM_COLORS.violet],
        smokeColor: PHANTOM_COLORS.shadow,
        particleCount: 10,
        smokeCount: 1,
        particleSpeed: 3.4,
        particleLift: 2.5,
        gravity: 4,
        coreRadius: 0.7,
        ringRadius: 1.55,
        lightColor: PHANTOM_COLORS.violet,
        lightIntensity: 7,
        additive: true,
        debrisShape: 'sphere',
      };
    case 'hookshot_drag_hook':
      return {
        duration: 520,
        scale: 1,
        flashColor: PHANTOM_COLORS.white,
        coreColor: HOOKSHOT_COLORS.energy,
        outerColor: HOOKSHOT_COLORS.energyGlow,
        ringColor: HOOKSHOT_COLORS.energy,
        secondRingColor: PHANTOM_COLORS.white,
        particleColors: [PHANTOM_COLORS.white, HOOKSHOT_COLORS.energy, HOOKSHOT_COLORS.metalLight],
        smokeColor: 0x4d5960,
        particleCount: 12,
        smokeCount: 2,
        particleSpeed: 6,
        particleLift: 3.4,
        gravity: 9,
        coreRadius: 0.7,
        ringRadius: 2.15,
        lightColor: HOOKSHOT_COLORS.energy,
        lightIntensity: 10,
        additive: true,
        debrisShape: 'cone',
      };
    case 'hookshot_grapple':
      return {
        duration: 560,
        scale: 0.95,
        flashColor: PHANTOM_COLORS.white,
        coreColor: HOOKSHOT_COLORS.energy,
        outerColor: HOOKSHOT_COLORS.energyGlow,
        ringColor: HOOKSHOT_COLORS.energy,
        secondRingColor: PHANTOM_COLORS.white,
        particleColors: [PHANTOM_COLORS.white, HOOKSHOT_COLORS.energy, HOOKSHOT_COLORS.metalLight],
        smokeColor: 0x4d5960,
        particleCount: 10,
        smokeCount: 2,
        particleSpeed: 5.4,
        particleLift: 3,
        gravity: 8,
        coreRadius: 0.65,
        ringRadius: 1.85,
        lightColor: HOOKSHOT_COLORS.energy,
        lightIntensity: 9,
        additive: true,
        debrisShape: 'cone',
      };
    case 'hookshot_trap':
      return {
        duration: 720,
        scale: 1.2,
        flashColor: PHANTOM_COLORS.white,
        coreColor: HOOKSHOT_COLORS.energy,
        outerColor: HOOKSHOT_COLORS.energyGlow,
        ringColor: HOOKSHOT_COLORS.energy,
        secondRingColor: HOOKSHOT_COLORS.energyGlow,
        particleColors: [HOOKSHOT_COLORS.energy, HOOKSHOT_COLORS.energyGlow, HOOKSHOT_COLORS.metalLight],
        smokeColor: EARTH_COLORS.dirtDark,
        particleCount: 16,
        smokeCount: 5,
        particleSpeed: 4.4,
        particleLift: 3.5,
        gravity: 10,
        coreRadius: 0.95,
        ringRadius: 3.6,
        lightColor: HOOKSHOT_COLORS.energy,
        lightIntensity: 12,
        additive: true,
        debrisShape: 'box',
      };
    case 'earth_wall':
      return {
        duration: 680,
        scale: 1,
        flashColor: EARTH_COLORS.hookGlow,
        coreColor: EARTH_COLORS.dirtLight,
        outerColor: EARTH_COLORS.dirt,
        ringColor: EARTH_COLORS.hookGlow,
        secondRingColor: EARTH_COLORS.dirtLight,
        particleColors: [EARTH_COLORS.dirt, EARTH_COLORS.dirtDark, EARTH_COLORS.rock],
        smokeColor: EARTH_COLORS.dirtDark,
        particleCount: 16,
        smokeCount: 6,
        particleSpeed: 4.8,
        particleLift: 4.2,
        gravity: 13,
        coreRadius: 0.9,
        ringRadius: 3,
        lightColor: EARTH_COLORS.hookGlow,
        lightIntensity: 8,
        additive: false,
        debrisShape: 'box',
      };
    case 'glacier_ice_wall':
      return {
        duration: 560,
        scale: 0.85,
        flashColor: PHANTOM_COLORS.white,
        coreColor: 0xb9f2ff,
        outerColor: 0x5ecdf2,
        ringColor: 0xa7f3ff,
        secondRingColor: 0x74d8ff,
        particleColors: [PHANTOM_COLORS.white, 0xa7f3ff, 0x5ecdf2],
        smokeColor: 0xdff9ff,
        particleCount: 12,
        smokeCount: 3,
        particleSpeed: 3.7,
        particleLift: 4.8,
        gravity: 6,
        coreRadius: 0.75,
        ringRadius: 2.1,
        lightColor: 0x7de7ff,
        lightIntensity: 8,
        additive: true,
        debrisShape: 'cone',
      };
    case 'glacier_mallet':
      return {
        duration: 620,
        scale: 1,
        flashColor: PHANTOM_COLORS.white,
        coreColor: 0xcff8ff,
        outerColor: 0x68d7ff,
        ringColor: 0xb6f2ff,
        secondRingColor: 0x88ddff,
        particleColors: [PHANTOM_COLORS.white, 0xb6f2ff, 0x68d7ff],
        smokeColor: 0xe8fbff,
        particleCount: 16,
        smokeCount: 4,
        particleSpeed: 5.2,
        particleLift: 5.8,
        gravity: 9,
        coreRadius: 1.1,
        ringRadius: 2.8,
        lightColor: 0x8deaff,
        lightIntensity: 13,
        additive: true,
        debrisShape: 'cone',
      };
    case 'hookshot_hook':
    default:
      return {
        duration: 460,
        scale: 0.46,
        flashColor: PHANTOM_COLORS.white,
        coreColor: HOOKSHOT_COLORS.energy,
        outerColor: HOOKSHOT_COLORS.energyGlow,
        ringColor: HOOKSHOT_COLORS.energy,
        secondRingColor: PHANTOM_COLORS.white,
        particleColors: [PHANTOM_COLORS.white, HOOKSHOT_COLORS.energy, HOOKSHOT_COLORS.metalLight],
        smokeColor: 0x4d5960,
        particleCount: 5,
        smokeCount: 1,
        particleSpeed: 3.3,
        particleLift: 1.8,
        gravity: 8,
        coreRadius: 0.38,
        ringRadius: 0.9,
        lightColor: HOOKSHOT_COLORS.energy,
        lightIntensity: 4,
        additive: true,
        debrisShape: 'cone',
      };
  }
}

export function triggerTerrainImpact(
  kind: TerrainImpactKind,
  position: { x: number; y: number; z: number },
  options: TerrainImpactOptions = {}
): void {
  const style = getImpactStyle(kind);
  const normal = options.normal ?? UP;

  terrainImpactEffects.push({
    id: `terrain_impact_${terrainImpactIdCounter++}`,
    kind,
    position: { ...position },
    normal: { ...normal },
    direction: options.direction ? { ...options.direction } : undefined,
    startTime: Date.now(),
    duration: style.duration,
    scale: (options.scale ?? 1) * style.scale,
    seed: Math.random() * Math.PI * 2,
  });

  if (terrainImpactEffects.length > MAX_IMPACTS) {
    terrainImpactEffects.splice(0, terrainImpactEffects.length - MAX_IMPACTS);
  }

  terrainImpactRevision++;
}

export function TerrainImpactEffectsManager() {
  const activeEffectsRef = useRef<TerrainImpactData[]>([]);
  const lastCountRef = useRef(0);
  const lastRevisionRef = useRef(0);
  const [, setVersion] = useState(0);

  useFrame(() => {
    const now = Date.now();
    const active = terrainImpactEffects.filter(effect => now - effect.startTime < effect.duration);
    terrainImpactEffects.length = 0;
    terrainImpactEffects.push(...active);
    activeEffectsRef.current = active;

    if (active.length !== lastCountRef.current || terrainImpactRevision !== lastRevisionRef.current) {
      lastCountRef.current = active.length;
      lastRevisionRef.current = terrainImpactRevision;
      setVersion(v => v + 1);
    }
  });

  return (
    <group>
      {activeEffectsRef.current.map(effect => (
        <TerrainImpactBurst key={effect.id} effect={effect} />
      ))}
    </group>
  );
}

interface ParticleConfig {
  angle: number;
  speed: number;
  lift: number;
  size: number;
  colorIndex: number;
  spin: number;
}

function TerrainImpactBurst({ effect }: { effect: TerrainImpactData }) {
  const groupRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ring2Ref = useRef<THREE.Mesh>(null);
  const particleRefs = useRef<(THREE.Mesh | null)[]>([]);
  const smokeRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const style = useMemo(() => getImpactStyle(effect.kind), [effect.kind]);

  const orientation = useMemo(() => {
    const normal = new THREE.Vector3(effect.normal.x, effect.normal.y, effect.normal.z);
    if (normal.lengthSq() < 0.0001) normal.set(0, 1, 0);
    normal.normalize();
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  }, [effect.normal.x, effect.normal.y, effect.normal.z]);

  const impactPosition = useMemo(() => {
    const normal = new THREE.Vector3(effect.normal.x, effect.normal.y, effect.normal.z);
    if (normal.lengthSq() < 0.0001) normal.set(0, 1, 0);
    normal.normalize();
    return new THREE.Vector3(effect.position.x, effect.position.y, effect.position.z).addScaledVector(normal, 0.04);
  }, [effect.normal.x, effect.normal.y, effect.normal.z, effect.position.x, effect.position.y, effect.position.z]);

  const particles = useMemo<ParticleConfig[]>(() => {
    return Array.from({ length: style.particleCount }, (_, i) => ({
      angle: effect.seed + (i / style.particleCount) * Math.PI * 2 + Math.sin(i * 12.9898 + effect.seed) * 0.32,
      speed: style.particleSpeed * (0.65 + ((i * 37) % 17) / 35),
      lift: style.particleLift * (0.65 + ((i * 19) % 13) / 30),
      size: 0.045 + ((i * 23) % 11) * 0.008,
      colorIndex: i % style.particleColors.length,
      spin: (i % 2 === 0 ? 1 : -1) * (2 + (i % 4)),
    }));
  }, [effect.seed, style.particleColors.length, style.particleCount, style.particleLift, style.particleSpeed]);

  const smoke = useMemo<ParticleConfig[]>(() => {
    return Array.from({ length: style.smokeCount }, (_, i) => ({
      angle: effect.seed * 0.7 + (i / Math.max(1, style.smokeCount)) * Math.PI * 2,
      speed: 0.7 + i * 0.18,
      lift: 0.9 + i * 0.2,
      size: 0.18 + i * 0.04,
      colorIndex: 0,
      spin: 0,
    }));
  }, [effect.seed, style.smokeCount]);

  useFrame(() => {
    const elapsed = Date.now() - effect.startTime;
    const progress = Math.min(1, elapsed / effect.duration);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const fade = Math.max(0, 1 - progress);
    const hotFade = Math.max(0, 1 - progress * 1.6);
    const baseScale = effect.scale;

    if (groupRef.current) {
      groupRef.current.quaternion.copy(orientation);
    }

    if (flashRef.current) {
      const flashProgress = Math.min(1, elapsed / 80);
      flashRef.current.scale.setScalar(baseScale * (0.28 + flashProgress * style.coreRadius * 1.3));
      (flashRef.current.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashProgress * 1.45);
    }

    if (coreRef.current) {
      coreRef.current.scale.setScalar(baseScale * style.coreRadius * (0.45 + easeOut * 0.85));
      (coreRef.current.material as THREE.MeshBasicMaterial).opacity = hotFade * 0.88;
    }

    if (outerRef.current) {
      outerRef.current.scale.setScalar(baseScale * style.coreRadius * (0.8 + easeOut * 1.4));
      (outerRef.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.45;
    }

    if (ringRef.current) {
      const s = baseScale * (0.35 + easeOut * style.ringRadius);
      ringRef.current.scale.set(s, s, 1);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.72;
    }

    if (ring2Ref.current) {
      const s = baseScale * (0.2 + easeOut * style.ringRadius * 0.62);
      ring2Ref.current.scale.set(s, s, 1);
      (ring2Ref.current.material as THREE.MeshBasicMaterial).opacity = fade * 0.5;
    }

    const t = elapsed / 1000;
    particleRefs.current.forEach((particle, i) => {
      const config = particles[i];
      if (!particle || !config) return;
      const lateral = config.speed * t;
      const y = config.lift * t - style.gravity * t * t * 0.5;
      particle.position.set(
        Math.cos(config.angle) * lateral,
        Math.max(-0.08, y),
        Math.sin(config.angle) * lateral
      );
      particle.rotation.set(t * config.spin, t * config.spin * 0.7, t * config.spin * 1.3);
      particle.scale.setScalar(baseScale * config.size * (1 - progress * 0.55));
      (particle.material as THREE.MeshBasicMaterial).opacity = Math.max(0, fade * (y > -0.04 ? 1 : 0.25));
    });

    smokeRefs.current.forEach((puff, i) => {
      const config = smoke[i];
      if (!puff || !config) return;
      const smokeProgress = Math.min(1, progress * 1.15);
      puff.position.set(
        Math.cos(config.angle) * config.speed * smokeProgress,
        config.lift * smokeProgress,
        Math.sin(config.angle) * config.speed * smokeProgress
      );
      puff.scale.setScalar(baseScale * (config.size + smokeProgress * 0.35));
      (puff.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.34 - smokeProgress * 0.34);
    });

    if (lightRef.current) {
      lightRef.current.intensity = style.lightIntensity * fade;
    }
  });

  return (
    <group ref={groupRef} position={impactPosition}>
      <mesh ref={flashRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={style.flashColor} transparent opacity={1} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={style.coreColor} transparent opacity={0.9} depthWrite={false} blending={style.additive ? THREE.AdditiveBlending : THREE.NormalBlending} />
      </mesh>

      <mesh ref={outerRef} geometry={SHARED_GEOMETRIES.sphere8}>
        <meshBasicMaterial color={style.outerColor} transparent opacity={0.45} depthWrite={false} blending={style.additive ? THREE.AdditiveBlending : THREE.NormalBlending} />
      </mesh>

      <mesh ref={ringRef} rotation-x={-Math.PI / 2} position-y={0.03} geometry={SHARED_GEOMETRIES.ring24}>
        <meshBasicMaterial color={style.ringColor} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} blending={style.additive ? THREE.AdditiveBlending : THREE.NormalBlending} />
      </mesh>

      <mesh ref={ring2Ref} rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.ring16}>
        <meshBasicMaterial color={style.secondRingColor} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} blending={style.additive ? THREE.AdditiveBlending : THREE.NormalBlending} />
      </mesh>

      {particles.map((particle, i) => (
        <mesh
          key={`particle-${i}`}
          ref={el => particleRefs.current[i] = el}
          geometry={
            style.debrisShape === 'box'
              ? SHARED_GEOMETRIES.box
              : style.debrisShape === 'cone'
                ? SHARED_GEOMETRIES.cone6
                : SHARED_GEOMETRIES.sphere8
          }
        >
          <meshBasicMaterial
            color={style.particleColors[particle.colorIndex]}
            transparent
            opacity={1}
            depthWrite={false}
            blending={style.additive ? THREE.AdditiveBlending : THREE.NormalBlending}
          />
        </mesh>
      ))}

      {smoke.map((_, i) => (
        <mesh key={`smoke-${i}`} ref={el => smokeRefs.current[i] = el} geometry={SHARED_GEOMETRIES.sphere8}>
          <meshBasicMaterial color={style.smokeColor} transparent opacity={0.3} depthWrite={false} />
        </mesh>
      ))}

      <pointLight ref={lightRef} color={style.lightColor} intensity={style.lightIntensity} distance={8 * effect.scale} decay={2} />
    </group>
  );
}
