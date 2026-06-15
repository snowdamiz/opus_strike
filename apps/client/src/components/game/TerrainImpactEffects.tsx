import { useEffect, useRef } from 'react';
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
import { getFrameClock } from '../../utils/frameClock';
import type { EffectQualityConfig } from './visualQuality';
import {
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../movement/networkDiagnostics';

export type TerrainImpactKind =
  | 'blaze_rocket'
  | 'blaze_flamethrower'
  | 'phantom_dire_ball'
  | 'chronos_pulse'
  | 'hookshot_hook'
  | 'hookshot_drag_hook'
  | 'hookshot_grapple'
  | 'hookshot_ground_hooks'
  | 'earth_wall';

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

let terrainImpactIdCounter = 0;

const UP = { x: 0, y: 1, z: 0 };
const MAX_IMPACTS = 80;
let activeImpactConfig: EffectQualityConfig = {
  maxActiveImpacts: MAX_IMPACTS,
  maxActiveTrails: 64,
  maxActiveParticles: 620,
  maxVisibleRemoteAbilityEffects: 48,
  enableDecorativeLights: true,
};
const PHANTOM_DIRE_IMPACT_CAPACITY = 48;
const PHANTOM_DIRE_IMPACT_PARTICLES = 10;
const PHANTOM_DIRE_IMPACT_SMOKE = 1;
const GENERIC_IMPACT_CAPACITY = MAX_IMPACTS;
const GENERIC_IMPACT_MAX_PARTICLES = 16;
const GENERIC_IMPACT_MAX_SMOKE = 6;
const PHANTOM_DIRE_IMPACT_INDICES = Array.from({ length: PHANTOM_DIRE_IMPACT_CAPACITY }, (_, i) => i);
const PHANTOM_DIRE_PARTICLE_INDICES = Array.from({ length: PHANTOM_DIRE_IMPACT_PARTICLES }, (_, i) => i);
const PHANTOM_DIRE_SMOKE_INDICES = Array.from({ length: PHANTOM_DIRE_IMPACT_SMOKE }, (_, i) => i);
const GENERIC_IMPACT_INDICES = Array.from({ length: GENERIC_IMPACT_CAPACITY }, (_, i) => i);
const GENERIC_PARTICLE_INDICES = Array.from({ length: GENERIC_IMPACT_MAX_PARTICLES }, (_, i) => i);
const GENERIC_SMOKE_INDICES = Array.from({ length: GENERIC_IMPACT_MAX_SMOKE }, (_, i) => i);
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
    case 'hookshot_ground_hooks':
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

interface PooledGenericImpactSlot {
  active: boolean;
  id: number;
  kind: TerrainImpactKind;
  style: ImpactStyle;
  position: { x: number; y: number; z: number };
  quaternion: THREE.Quaternion;
  startTime: number;
  duration: number;
  scale: number;
  seed: number;
}

interface GenericImpactRenderSlot {
  boundId: number;
  group: THREE.Group | null;
  flash: THREE.Mesh | null;
  core: THREE.Mesh | null;
  outer: THREE.Mesh | null;
  ring: THREE.Mesh | null;
  ring2: THREE.Mesh | null;
  particles: Array<THREE.Mesh | null>;
  smoke: Array<THREE.Mesh | null>;
  light: THREE.PointLight | null;
  materials: Map<string, THREE.MeshBasicMaterial>;
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

const DEFAULT_GENERIC_IMPACT_STYLE = getImpactStyle('hookshot_hook');
const genericImpactSlots: PooledGenericImpactSlot[] = Array.from(
  { length: GENERIC_IMPACT_CAPACITY },
  () => ({
    active: false,
    id: 0,
    kind: 'hookshot_hook',
    style: DEFAULT_GENERIC_IMPACT_STYLE,
    position: { x: 0, y: 0, z: 0 },
    quaternion: new THREE.Quaternion(),
    startTime: 0,
    duration: DEFAULT_GENERIC_IMPACT_STYLE.duration,
    scale: DEFAULT_GENERIC_IMPACT_STYLE.scale,
    seed: 0,
  })
);

let nextPhantomDireImpactSlot = 0;
let nextGenericImpactSlot = 0;

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

function ensureGenericImpactRenderSlot(
  slots: GenericImpactRenderSlot[],
  index: number
): GenericImpactRenderSlot {
  let slot = slots[index];
  if (!slot) {
    slot = {
      boundId: -1,
      group: null,
      flash: null,
      core: null,
      outer: null,
      ring: null,
      ring2: null,
      particles: [],
      smoke: [],
      light: null,
      materials: new Map(),
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

function countActiveGenericImpacts(frameNow: number): number {
  let activeCount = 0;
  for (const slot of genericImpactSlots) {
    if (slot.active && frameNow - slot.startTime < slot.duration) {
      activeCount++;
    } else {
      slot.active = false;
    }
  }
  return activeCount;
}

function countActivePhantomDireImpacts(frameNow: number): number {
  let activeCount = 0;
  for (const slot of phantomDireImpactSlots) {
    if (slot.active && frameNow - slot.startTime < slot.duration) {
      activeCount++;
    }
  }
  return activeCount;
}

function countVisibleGenericImpacts(frameNow: number): number {
  let activeCount = 0;
  for (const slot of genericImpactSlots) {
    if (slot.active && frameNow - slot.startTime < slot.duration) {
      activeCount++;
    }
  }
  return activeCount;
}

function recordTerrainImpactDiagnostics(frameNow: number, config: EffectQualityConfig): void {
  const phantomActive = countActivePhantomDireImpacts(frameNow);
  const genericActive = countVisibleGenericImpacts(frameNow);
  const genericCapacity = Math.min(GENERIC_IMPACT_CAPACITY, Math.max(0, config.maxActiveImpacts));
  const totalCapacity = PHANTOM_DIRE_IMPACT_CAPACITY + genericCapacity;
  const totalActive = phantomActive + genericActive;

  recordEffectSlotDiagnostics('terrainImpacts', {
    active: totalActive,
    capacity: totalCapacity,
    hiddenMounted: Math.max(0, totalCapacity - totalActive),
  });
  recordEffectSlotDiagnostics('terrainImpactGeneric', {
    active: genericActive,
    capacity: genericCapacity,
    hiddenMounted: Math.max(0, genericCapacity - genericActive),
  });
  recordEffectSlotDiagnostics('terrainImpactPhantomDire', {
    active: phantomActive,
    capacity: PHANTOM_DIRE_IMPACT_CAPACITY,
    hiddenMounted: Math.max(0, PHANTOM_DIRE_IMPACT_CAPACITY - phantomActive),
  });
}

function chooseGenericImpactSlot(frameNow: number, maxActiveImpacts: number): PooledGenericImpactSlot | null {
  if (maxActiveImpacts <= 0) return null;

  const activeCount = countActiveGenericImpacts(frameNow);
  if (activeCount >= maxActiveImpacts) {
    let oldestSlot: PooledGenericImpactSlot | null = null;
    for (const slot of genericImpactSlots) {
      if (!slot.active) continue;
      if (!oldestSlot || slot.startTime < oldestSlot.startTime) {
        oldestSlot = slot;
      }
    }
    return oldestSlot;
  }

  for (let offset = 0; offset < GENERIC_IMPACT_CAPACITY; offset++) {
    const slotIndex = (nextGenericImpactSlot + offset) % GENERIC_IMPACT_CAPACITY;
    const slot = genericImpactSlots[slotIndex];
    if (!slot.active) {
      nextGenericImpactSlot = (slotIndex + 1) % GENERIC_IMPACT_CAPACITY;
      return slot;
    }
  }

  return null;
}

function writeImpactSurfaceTransform(
  slot: Pick<PooledGenericImpactSlot, 'position' | 'quaternion'>,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number }
): void {
  impactNormalVector.set(normal.x, normal.y, normal.z);
  if (impactNormalVector.lengthSq() < 0.0001) {
    impactNormalVector.set(0, 1, 0);
  } else {
    impactNormalVector.normalize();
  }

  slot.position.x = position.x + impactNormalVector.x * 0.04;
  slot.position.y = position.y + impactNormalVector.y * 0.04;
  slot.position.z = position.z + impactNormalVector.z * 0.04;
  slot.quaternion.setFromUnitVectors(IMPACT_UP_VECTOR, impactNormalVector);
}

function claimGenericImpact(
  kind: TerrainImpactKind,
  style: ImpactStyle,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  scale: number,
  frameNow: number
): void {
  const maxActiveImpacts = Math.min(GENERIC_IMPACT_CAPACITY, activeImpactConfig.maxActiveImpacts);
  const slot = chooseGenericImpactSlot(frameNow, maxActiveImpacts);
  if (!slot) return;

  slot.active = true;
  slot.id = terrainImpactIdCounter++;
  slot.kind = kind;
  slot.style = style;
  writeImpactSurfaceTransform(slot, position, normal);
  slot.startTime = frameNow;
  slot.duration = style.duration;
  slot.scale = scale;
  slot.seed = Math.random() * Math.PI * 2;
}

export function triggerTerrainImpact(
  kind: TerrainImpactKind,
  position: { x: number; y: number; z: number },
  options: TerrainImpactOptions = {}
): void {
  if (activeImpactConfig.maxActiveImpacts <= 0) return;

  const style = getImpactStyle(kind);
  const normal = options.normal ?? UP;
  const frameNow = getFrameClock().nowMs;

  if (kind === 'phantom_dire_ball') {
    const activePooledImpacts = phantomDireImpactSlots.reduce((count, slot) => count + (slot.active ? 1 : 0), 0);
    if (activePooledImpacts >= activeImpactConfig.maxActiveImpacts) return;
    claimPooledPhantomDireImpact(position, normal, (options.scale ?? 1) * style.scale, frameNow);
    return;
  }

  claimGenericImpact(kind, style, position, normal, (options.scale ?? 1) * style.scale, frameNow);
}

export function TerrainImpactEffectsManager({ config }: { config: EffectQualityConfig }) {
  const phantomRenderSlotsRef = useRef<PhantomDireImpactRenderSlot[]>([]);
  const genericRenderSlotsRef = useRef<GenericImpactRenderSlot[]>([]);
  useEffect(() => {
    activeImpactConfig = config;
  }, [config]);

  useFrame(() => {
    const frameNow = getFrameClock().nowMs;
    measureFrameWork('frame.effects.terrainImpacts', () => {
      updatePooledPhantomDireImpacts(phantomRenderSlotsRef.current, frameNow);
      updatePooledGenericImpacts(genericRenderSlotsRef.current, frameNow);
    });
    recordTerrainImpactDiagnostics(frameNow, config);
  });

  return (
    <group>
      <PooledPhantomDireImpactSlots
        renderSlots={phantomRenderSlotsRef.current}
        enableDecorativeLights={config.enableDecorativeLights}
      />
      <PooledGenericImpactSlots
        renderSlots={genericRenderSlotsRef.current}
        enableDecorativeLights={config.enableDecorativeLights}
      />
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

function PooledPhantomDireImpactSlots({
  renderSlots,
  enableDecorativeLights,
}: {
  renderSlots: PhantomDireImpactRenderSlot[];
  enableDecorativeLights: boolean;
}) {
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

            {enableDecorativeLights && (
              <BudgetedPointLight
                budgetPriority={2}
                ref={el => { slot.light = el; }}
                color={style.lightColor}
                intensity={0}
                distance={8 * style.scale}
                decay={2}
              />
            )}
          </group>
        );
      })}
    </>
  );
}

function getDebrisGeometry(shape: ImpactStyle['debrisShape']): THREE.BufferGeometry {
  if (shape === 'box') return SHARED_GEOMETRIES.box;
  if (shape === 'cone') return SHARED_GEOMETRIES.cone6;
  return SHARED_GEOMETRIES.sphere8;
}

function getGenericImpactMaterial(
  renderSlot: GenericImpactRenderSlot,
  key: string,
  color: number,
  opacity: number,
  additive: boolean,
  side: THREE.Side = THREE.FrontSide
): THREE.MeshBasicMaterial {
  let material = renderSlot.materials.get(key);
  if (!material) {
    material = new THREE.MeshBasicMaterial({
      color,
      opacity,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side,
      toneMapped: false,
    });
    renderSlot.materials.set(key, material);
  } else {
    material.opacity = opacity;
  }
  return material;
}

function assignGenericImpactMaterial(
  renderSlot: GenericImpactRenderSlot,
  mesh: THREE.Mesh | null,
  role: string,
  color: number,
  opacity: number,
  additive: boolean,
  side: THREE.Side = THREE.FrontSide
): void {
  if (!mesh) return;
  const key = `${role}:${color}:${additive ? 'add' : 'norm'}:${side}`;
  mesh.material = getGenericImpactMaterial(renderSlot, key, color, opacity, additive, side);
}

function configureGenericRenderSlot(renderSlot: GenericImpactRenderSlot, data: PooledGenericImpactSlot): void {
  const style = data.style;
  const additive = style.additive;

  assignGenericImpactMaterial(renderSlot, renderSlot.flash, 'flash', style.flashColor, 1, true);
  assignGenericImpactMaterial(renderSlot, renderSlot.core, 'core', style.coreColor, 0.9, additive);
  assignGenericImpactMaterial(renderSlot, renderSlot.outer, 'outer', style.outerColor, 0.45, additive);
  assignGenericImpactMaterial(renderSlot, renderSlot.ring, 'ring', style.ringColor, 0.7, additive, THREE.DoubleSide);
  assignGenericImpactMaterial(renderSlot, renderSlot.ring2, 'ring2', style.secondRingColor, 0.5, additive, THREE.DoubleSide);

  const particleGeometry = getDebrisGeometry(style.debrisShape);
  for (let i = 0; i < GENERIC_IMPACT_MAX_PARTICLES; i++) {
    const particle = renderSlot.particles[i];
    if (!particle) continue;
    particle.visible = i < style.particleCount;
    particle.geometry = particleGeometry;
    assignGenericImpactMaterial(
      renderSlot,
      particle,
      `particle-${i}`,
      style.particleColors[i % style.particleColors.length],
      1,
      additive
    );
  }

  for (let i = 0; i < GENERIC_IMPACT_MAX_SMOKE; i++) {
    const smoke = renderSlot.smoke[i];
    if (!smoke) continue;
    smoke.visible = i < style.smokeCount;
    assignGenericImpactMaterial(renderSlot, smoke, `smoke-${i}`, style.smokeColor, 0.3, false);
  }

  if (renderSlot.light) {
    renderSlot.light.color.setHex(style.lightColor);
    renderSlot.light.distance = 8 * data.scale;
  }

  renderSlot.boundId = data.id;
}

function updatePooledGenericImpacts(renderSlots: GenericImpactRenderSlot[], now: number): void {
  for (let slotIndex = 0; slotIndex < GENERIC_IMPACT_CAPACITY; slotIndex++) {
    const data = genericImpactSlots[slotIndex];
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

    if (renderSlot.boundId !== data.id) {
      configureGenericRenderSlot(renderSlot, data);
    }

    const style = data.style;
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
    for (let i = 0; i < style.particleCount; i++) {
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

    for (let i = 0; i < style.smokeCount; i++) {
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

function disposeGenericImpactRenderSlotMaterials(renderSlots: GenericImpactRenderSlot[]): void {
  for (const slot of renderSlots) {
    for (const material of slot.materials.values()) {
      material.dispose();
    }
    slot.materials.clear();
  }
}

function PooledGenericImpactSlots({
  renderSlots,
  enableDecorativeLights,
}: {
  renderSlots: GenericImpactRenderSlot[];
  enableDecorativeLights: boolean;
}) {
  useEffect(() => () => disposeGenericImpactRenderSlotMaterials(renderSlots), [renderSlots]);

  return (
    <>
      {GENERIC_IMPACT_INDICES.map((slotIndex) => {
        const slot = ensureGenericImpactRenderSlot(renderSlots, slotIndex);
        return (
          <group
            key={slotIndex}
            ref={el => { slot.group = el; }}
            visible={false}
          >
            <mesh ref={el => { slot.flash = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <meshBasicMaterial color={0xffffff} transparent opacity={1} depthWrite={false} blending={THREE.AdditiveBlending} />
            </mesh>

            <mesh ref={el => { slot.core = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <meshBasicMaterial color={0xffffff} transparent opacity={0.9} depthWrite={false} />
            </mesh>

            <mesh ref={el => { slot.outer = el; }} geometry={SHARED_GEOMETRIES.sphere8}>
              <meshBasicMaterial color={0xffffff} transparent opacity={0.45} depthWrite={false} />
            </mesh>

            <mesh ref={el => { slot.ring = el; }} rotation-x={-Math.PI / 2} position-y={0.03} geometry={SHARED_GEOMETRIES.ring24}>
              <meshBasicMaterial color={0xffffff} transparent opacity={0.7} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>

            <mesh ref={el => { slot.ring2 = el; }} rotation-x={-Math.PI / 2} position-y={0.05} geometry={SHARED_GEOMETRIES.ring16}>
              <meshBasicMaterial color={0xffffff} transparent opacity={0.5} side={THREE.DoubleSide} depthWrite={false} />
            </mesh>

            {GENERIC_PARTICLE_INDICES.map((particleIndex) => (
              <mesh
                key={`particle-${particleIndex}`}
                ref={el => { slot.particles[particleIndex] = el; }}
                visible={false}
                geometry={SHARED_GEOMETRIES.sphere8}
              >
                <meshBasicMaterial color={0xffffff} transparent opacity={1} depthWrite={false} />
              </mesh>
            ))}

            {GENERIC_SMOKE_INDICES.map((smokeIndex) => (
              <mesh
                key={`smoke-${smokeIndex}`}
                ref={el => { slot.smoke[smokeIndex] = el; }}
                visible={false}
                geometry={SHARED_GEOMETRIES.sphere8}
              >
                <meshBasicMaterial color={0x333333} transparent opacity={0.3} depthWrite={false} />
              </mesh>
            ))}

            {enableDecorativeLights && (
              <BudgetedPointLight
                budgetPriority={1.6}
                ref={el => { slot.light = el; }}
                color={0xffffff}
                intensity={0}
                distance={8}
                decay={2}
              />
            )}
          </group>
        );
      })}
    </>
  );
}
