import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLAZE_COLORS,
  EARTH_COLORS,
  HOOKSHOT_COLORS,
  PHANTOM_COLORS,
  SHARED_GEOMETRIES,
} from './effectResources';
import { BudgetedPointLight } from './systems/DynamicLightBudget';
import { recordSpawnMarker, recordSystemTime, registerFrameSystem } from '../../utils/perfMarks';
import { getFrameClock } from '../../utils/frameClock';

export type TerrainImpactKind =
  | 'blaze_rocket'
  | 'blaze_flamethrower'
  | 'phantom_dire_ball'
  | 'chronos_pulse'
  | 'hookshot_hook'
  | 'hookshot_drag_hook'
  | 'hookshot_grapple'
  | 'hookshot_trap'
  | 'earth_wall';

interface TerrainImpactData {
  id: string;
  kind: TerrainImpactKind;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  direction?: { x: number; y: number; z: number };
  startTime: number;
  frameStartTime: number;
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
const PHANTOM_DIRE_IMPACT_CAPACITY = 48;
const PHANTOM_DIRE_IMPACT_PARTICLES = 10;
const PHANTOM_DIRE_IMPACT_SMOKE = 1;
const PHANTOM_DIRE_IMPACT_INDICES = Array.from({ length: PHANTOM_DIRE_IMPACT_CAPACITY }, (_, i) => i);
const PHANTOM_DIRE_PARTICLE_INDICES = Array.from({ length: PHANTOM_DIRE_IMPACT_PARTICLES }, (_, i) => i);
const PHANTOM_DIRE_SMOKE_INDICES = Array.from({ length: PHANTOM_DIRE_IMPACT_SMOKE }, (_, i) => i);
const IMPACT_UP_VECTOR = new THREE.Vector3(0, 1, 0);
const impactNormalVector = new THREE.Vector3();

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
    case 'chronos_pulse':
      return {
        duration: 540,
        scale: 0.5,
        flashColor: 0xd9ffe7,
        coreColor: 0x86efac,
        outerColor: 0x22c55e,
        ringColor: 0xb7ffd1,
        secondRingColor: 0x4ade80,
        particleColors: [0xd9ffe7, 0x86efac, 0x22c55e],
        smokeColor: 0x0f2f21,
        particleCount: 9,
        smokeCount: 1,
        particleSpeed: 3.2,
        particleLift: 2.4,
        gravity: 4,
        coreRadius: 0.62,
        ringRadius: 1.45,
        lightColor: 0x22c55e,
        lightIntensity: 6,
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

const PHANTOM_DIRE_IMPACT_STYLE = getImpactStyle('phantom_dire_ball');

interface PooledPhantomDireImpactSlot {
  active: boolean;
  id: number;
  position: { x: number; y: number; z: number };
  quaternion: THREE.Quaternion;
  startTime: number;
  duration: number;
  scale: number;
  seed: number;
}

interface PhantomDireImpactRenderSlot {
  group: THREE.Group | null;
  flash: THREE.Mesh | null;
  core: THREE.Mesh | null;
  outer: THREE.Mesh | null;
  ring: THREE.Mesh | null;
  ring2: THREE.Mesh | null;
  particles: Array<THREE.Mesh | null>;
  smoke: Array<THREE.Mesh | null>;
  light: THREE.PointLight | null;
}

const phantomDireImpactSlots: PooledPhantomDireImpactSlot[] = Array.from(
  { length: PHANTOM_DIRE_IMPACT_CAPACITY },
  () => ({
    active: false,
    id: 0,
    position: { x: 0, y: 0, z: 0 },
    quaternion: new THREE.Quaternion(),
    startTime: 0,
    duration: PHANTOM_DIRE_IMPACT_STYLE.duration,
    scale: PHANTOM_DIRE_IMPACT_STYLE.scale,
    seed: 0,
  })
);

let nextPhantomDireImpactSlot = 0;

function ensurePhantomDireRenderSlot(
  slots: PhantomDireImpactRenderSlot[],
  index: number
): PhantomDireImpactRenderSlot {
  let slot = slots[index];
  if (!slot) {
    slot = {
      group: null,
      flash: null,
      core: null,
      outer: null,
      ring: null,
      ring2: null,
      particles: [],
      smoke: [],
      light: null,
    };
    slots[index] = slot;
  }
  return slot;
}

function claimPooledPhantomDireImpact(
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  scale: number,
  frameNow: number
): void {
  const slot = phantomDireImpactSlots[nextPhantomDireImpactSlot];
  nextPhantomDireImpactSlot = (nextPhantomDireImpactSlot + 1) % PHANTOM_DIRE_IMPACT_CAPACITY;

  impactNormalVector.set(normal.x, normal.y, normal.z);
  if (impactNormalVector.lengthSq() < 0.0001) {
    impactNormalVector.set(0, 1, 0);
  } else {
    impactNormalVector.normalize();
  }

  slot.active = true;
  slot.id = terrainImpactIdCounter++;
  slot.position.x = position.x + impactNormalVector.x * 0.04;
  slot.position.y = position.y + impactNormalVector.y * 0.04;
  slot.position.z = position.z + impactNormalVector.z * 0.04;
  slot.quaternion.setFromUnitVectors(IMPACT_UP_VECTOR, impactNormalVector);
  slot.startTime = frameNow;
  slot.duration = PHANTOM_DIRE_IMPACT_STYLE.duration;
  slot.scale = scale;
  slot.seed = Math.random() * Math.PI * 2;
}

function compactActiveTerrainImpacts(frameNow: number): boolean {
  let writeIndex = 0;
  let changed = false;

  for (let readIndex = 0; readIndex < terrainImpactEffects.length; readIndex++) {
    const effect = terrainImpactEffects[readIndex];
    if (frameNow - effect.frameStartTime < effect.duration) {
      if (writeIndex !== readIndex) changed = true;
      terrainImpactEffects[writeIndex] = effect;
      writeIndex++;
    } else {
      changed = true;
    }
  }

  if (terrainImpactEffects.length !== writeIndex) {
    terrainImpactEffects.length = writeIndex;
  }

  return changed;
}

function syncActiveTerrainImpacts(activeEffects: TerrainImpactData[]): void {
  activeEffects.length = terrainImpactEffects.length;
  for (let i = 0; i < terrainImpactEffects.length; i++) {
    activeEffects[i] = terrainImpactEffects[i];
  }
}

export function triggerTerrainImpact(
  kind: TerrainImpactKind,
  position: { x: number; y: number; z: number },
  options: TerrainImpactOptions = {}
): void {
  const style = getImpactStyle(kind);
  const normal = options.normal ?? UP;
  const now = Date.now();
  const frameNow = getFrameClock().nowMs;

  if (kind === 'phantom_dire_ball') {
    claimPooledPhantomDireImpact(position, normal, (options.scale ?? 1) * style.scale, frameNow);
    recordSpawnMarker('impact:phantomDireBall');
    terrainImpactRevision++;
    return;
  }

  terrainImpactEffects.push({
    id: `terrain_impact_${terrainImpactIdCounter++}`,
    kind,
    position: { ...position },
    normal: { ...normal },
    direction: options.direction ? { ...options.direction } : undefined,
    startTime: now,
    frameStartTime: frameNow,
    duration: style.duration,
    scale: (options.scale ?? 1) * style.scale,
    seed: Math.random() * Math.PI * 2,
  });

  if (terrainImpactEffects.length > MAX_IMPACTS) {
    terrainImpactEffects.splice(0, terrainImpactEffects.length - MAX_IMPACTS);
  }

  terrainImpactRevision++;
}

export function prewarmTerrainImpactResources(renderer?: THREE.WebGLRenderer): void {
  if (!renderer) return;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.z = 4;

  const flashMaterial = new THREE.MeshBasicMaterial({
    color: PHANTOM_DIRE_IMPACT_STYLE.flashColor,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: PHANTOM_DIRE_IMPACT_STYLE.coreColor,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ringMaterial = new THREE.MeshBasicMaterial({
    color: PHANTOM_DIRE_IMPACT_STYLE.ringColor,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const smokeMaterial = new THREE.MeshBasicMaterial({
    color: PHANTOM_DIRE_IMPACT_STYLE.smokeColor,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
  });

  const flash = new THREE.Mesh(SHARED_GEOMETRIES.sphere8, flashMaterial);
  const core = new THREE.Mesh(SHARED_GEOMETRIES.sphere8, coreMaterial);
  const ring = new THREE.Mesh(SHARED_GEOMETRIES.ring24, ringMaterial);
  const particle = new THREE.Mesh(SHARED_GEOMETRIES.sphere8, coreMaterial);
  const smoke = new THREE.Mesh(SHARED_GEOMETRIES.sphere8, smokeMaterial);
  flash.scale.setScalar(0.5);
  core.scale.setScalar(0.7);
  ring.scale.setScalar(1.2);
  particle.scale.setScalar(0.08);
  smoke.scale.setScalar(0.2);
  scene.add(flash, core, ring, particle, smoke);

  renderer.compile(scene, camera);
  flashMaterial.dispose();
  coreMaterial.dispose();
  ringMaterial.dispose();
  smokeMaterial.dispose();
}

export function TerrainImpactEffectsManager() {
  const activeEffectsRef = useRef<TerrainImpactData[]>([]);
  const phantomRenderSlotsRef = useRef<PhantomDireImpactRenderSlot[]>([]);
  const lastCountRef = useRef(0);
  const lastRevisionRef = useRef(0);
  const [, setVersion] = useState(0);

  useEffect(() => registerFrameSystem('terrain-impacts'), []);

  useFrame(() => {
    const frameStart = performance.now();
    const frameNow = getFrameClock().nowMs;
    const changed = compactActiveTerrainImpacts(frameNow);
    syncActiveTerrainImpacts(activeEffectsRef.current);
    updatePooledPhantomDireImpacts(phantomRenderSlotsRef.current, frameNow);

    if (
      changed ||
      activeEffectsRef.current.length !== lastCountRef.current ||
      terrainImpactRevision !== lastRevisionRef.current
    ) {
      lastCountRef.current = activeEffectsRef.current.length;
      lastRevisionRef.current = terrainImpactRevision;
      setVersion(v => v + 1);
    }

    recordSystemTime('terrainImpacts', performance.now() - frameStart);
  });

  return (
    <group>
      <PooledPhantomDireImpactSlots renderSlots={phantomRenderSlotsRef.current} />
      {activeEffectsRef.current.map(effect => (
        <TerrainImpactBurst key={effect.id} effect={effect} />
      ))}
    </group>
  );
}

function updatePooledPhantomDireImpacts(renderSlots: PhantomDireImpactRenderSlot[], now: number): void {
  const style = PHANTOM_DIRE_IMPACT_STYLE;

  for (let slotIndex = 0; slotIndex < PHANTOM_DIRE_IMPACT_CAPACITY; slotIndex++) {
    const data = phantomDireImpactSlots[slotIndex];
    const renderSlot = renderSlots[slotIndex];
    if (!renderSlot?.group) continue;

    if (!data.active) {
      renderSlot.group.visible = false;
      if (renderSlot.light) renderSlot.light.intensity = 0;
      continue;
    }

    const elapsed = now - data.startTime;
    if (elapsed >= data.duration) {
      data.active = false;
      renderSlot.group.visible = false;
      if (renderSlot.light) renderSlot.light.intensity = 0;
      continue;
    }

    const progress = Math.min(1, elapsed / data.duration);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const fade = Math.max(0, 1 - progress);
    const hotFade = Math.max(0, 1 - progress * 1.6);
    const baseScale = data.scale;

    renderSlot.group.visible = true;
    renderSlot.group.position.set(data.position.x, data.position.y, data.position.z);
    renderSlot.group.quaternion.copy(data.quaternion);

    if (renderSlot.flash) {
      const flashProgress = Math.min(1, elapsed / 80);
      renderSlot.flash.scale.setScalar(baseScale * (0.28 + flashProgress * style.coreRadius * 1.3));
      (renderSlot.flash.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - flashProgress * 1.45);
    }

    if (renderSlot.core) {
      renderSlot.core.scale.setScalar(baseScale * style.coreRadius * (0.45 + easeOut * 0.85));
      (renderSlot.core.material as THREE.MeshBasicMaterial).opacity = hotFade * 0.88;
    }

    if (renderSlot.outer) {
      renderSlot.outer.scale.setScalar(baseScale * style.coreRadius * (0.8 + easeOut * 1.4));
      (renderSlot.outer.material as THREE.MeshBasicMaterial).opacity = fade * 0.45;
    }

    if (renderSlot.ring) {
      const ringScale = baseScale * (0.35 + easeOut * style.ringRadius);
      renderSlot.ring.scale.set(ringScale, ringScale, 1);
      (renderSlot.ring.material as THREE.MeshBasicMaterial).opacity = fade * 0.72;
    }

    if (renderSlot.ring2) {
      const ringScale = baseScale * (0.2 + easeOut * style.ringRadius * 0.62);
      renderSlot.ring2.scale.set(ringScale, ringScale, 1);
      (renderSlot.ring2.material as THREE.MeshBasicMaterial).opacity = fade * 0.5;
    }

    const t = elapsed / 1000;
    for (let i = 0; i < PHANTOM_DIRE_IMPACT_PARTICLES; i++) {
      const particle = renderSlot.particles[i];
      if (!particle) continue;

      const angle = data.seed + (i / style.particleCount) * Math.PI * 2 + Math.sin(i * 12.9898 + data.seed) * 0.32;
      const speed = style.particleSpeed * (0.65 + ((i * 37) % 17) / 35);
      const lift = style.particleLift * (0.65 + ((i * 19) % 13) / 30);
      const size = 0.045 + ((i * 23) % 11) * 0.008;
      const spin = (i % 2 === 0 ? 1 : -1) * (2 + (i % 4));
      const lateral = speed * t;
      const y = lift * t - style.gravity * t * t * 0.5;

      particle.position.set(
        Math.cos(angle) * lateral,
        Math.max(-0.08, y),
        Math.sin(angle) * lateral
      );
      particle.rotation.set(t * spin, t * spin * 0.7, t * spin * 1.3);
      particle.scale.setScalar(baseScale * size * (1 - progress * 0.55));
      (particle.material as THREE.MeshBasicMaterial).opacity = Math.max(0, fade * (y > -0.04 ? 1 : 0.25));
    }

    for (let i = 0; i < PHANTOM_DIRE_IMPACT_SMOKE; i++) {
      const puff = renderSlot.smoke[i];
      if (!puff) continue;

      const smokeProgress = Math.min(1, progress * 1.15);
      const angle = data.seed * 0.7 + (i / Math.max(1, style.smokeCount)) * Math.PI * 2;
      const speed = 0.7 + i * 0.18;
      const lift = 0.9 + i * 0.2;
      const size = 0.18 + i * 0.04;
      puff.position.set(
        Math.cos(angle) * speed * smokeProgress,
        lift * smokeProgress,
        Math.sin(angle) * speed * smokeProgress
      );
      puff.scale.setScalar(baseScale * (size + smokeProgress * 0.35));
      (puff.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.34 - smokeProgress * 0.34);
    }

    if (renderSlot.light) {
      renderSlot.light.intensity = style.lightIntensity * fade;
      renderSlot.light.distance = 8 * data.scale;
    }
  }
}

function PooledPhantomDireImpactSlots({ renderSlots }: { renderSlots: PhantomDireImpactRenderSlot[] }) {
  const style = PHANTOM_DIRE_IMPACT_STYLE;

  return (
    <>
      {PHANTOM_DIRE_IMPACT_INDICES.map((slotIndex) => {
        const slot = ensurePhantomDireRenderSlot(renderSlots, slotIndex);
        return (
          <group
            key={slotIndex}
            ref={el => { slot.group = el; }}
            visible={false}
          >
            <mesh ref={el => { slot.flash = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <meshBasicMaterial color={style.flashColor} transparent opacity={1} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>

            <mesh ref={el => { slot.core = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <meshBasicMaterial color={style.coreColor} transparent opacity={0.9} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>

            <mesh ref={el => { slot.outer = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <meshBasicMaterial color={style.outerColor} transparent opacity={0.45} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>

            <mesh ref={el => { slot.ring = el; }} rotation-x={-Math.PI / 2} position-y={0.03} geometry={SHARED_GEOMETRIES.ring24}>
              <meshBasicMaterial color={style.ringColor} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>

            <mesh ref={el => { slot.ring2 = el; }} rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.ring16}>
              <meshBasicMaterial color={style.secondRingColor} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>

            {PHANTOM_DIRE_PARTICLE_INDICES.map((particleIndex) => (
              <mesh
                key={`particle-${particleIndex}`}
                ref={el => { slot.particles[particleIndex] = el; }}
                geometry={SHARED_GEOMETRIES.sphere8}
              >
                <meshBasicMaterial
                  color={style.particleColors[particleIndex % style.particleColors.length]}
                  transparent
                  opacity={1}
                  depthWrite={false}
                  blending={THREE.AdditiveBlending}
                />
              </mesh>
            ))}

            {PHANTOM_DIRE_SMOKE_INDICES.map((smokeIndex) => (
              <mesh
                key={`smoke-${smokeIndex}`}
                ref={el => { slot.smoke[smokeIndex] = el; }}
                geometry={SHARED_GEOMETRIES.sphere8}
              >
                <meshBasicMaterial color={style.smokeColor} transparent opacity={0.3} depthWrite={false} />
              </mesh>
            ))}

            <BudgetedPointLight
              budgetPriority={2}
              ref={el => { slot.light = el; }}
              color={style.lightColor}
              intensity={0}
              distance={8 * style.scale}
              decay={2}
            />
          </group>
        );
      })}
    </>
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
    const elapsed = getFrameClock().nowMs - effect.frameStartTime;
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
