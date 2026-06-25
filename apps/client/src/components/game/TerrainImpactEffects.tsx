import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
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
  MOVEMENT_DIAGNOSTICS_ENABLED,
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
  maxRemoteMovementEffectDistance: Number.POSITIVE_INFINITY,
  remoteMovementEffectDensityScale: 1,
  remoteMovementEffectBotDistanceScale: 1,
  maxTerrainImpactRenderDistance: Number.POSITIVE_INFINITY,
};
const activeImpactCameraPosition = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
const PHANTOM_DIRE_IMPACT_CAPACITY = 48;
const PHANTOM_DIRE_IMPACT_PARTICLES = 10;
const PHANTOM_DIRE_IMPACT_SMOKE = 1;
const GENERIC_IMPACT_CAPACITY = MAX_IMPACTS;
const GENERIC_IMPACT_MAX_PARTICLES = 16;
const GENERIC_IMPACT_MAX_SMOKE = 6;
const PHANTOM_DIRE_IMPACT_INDICES = Array.from({ length: PHANTOM_DIRE_IMPACT_CAPACITY }, (_, i) => i);
const GENERIC_IMPACT_INDICES = Array.from({ length: GENERIC_IMPACT_CAPACITY }, (_, i) => i);
const IMPACT_UP_VECTOR = new THREE.Vector3(0, 1, 0);
const impactNormalVector = new THREE.Vector3();
const GENERIC_IMPACT_ALPHA_ATTRIBUTE = 'instanceAlpha';
const GENERIC_IMPACT_RING_QUATERNION = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
const GENERIC_IMPACT_IDENTITY_QUATERNION = new THREE.Quaternion();
const genericImpactLocalPosition = new THREE.Vector3();
const genericImpactWorldPosition = new THREE.Vector3();
const genericImpactWorldQuaternion = new THREE.Quaternion();
const genericImpactLocalQuaternion = new THREE.Quaternion();
const genericImpactLocalScale = new THREE.Vector3();
const genericImpactColor = new THREE.Color();
const genericImpactDummy = new THREE.Object3D();
const genericImpactEuler = new THREE.Euler();

function getGenericImpactCapacity(config = activeImpactConfig): number {
  return Math.min(GENERIC_IMPACT_CAPACITY, Math.max(0, Math.floor(config.maxActiveImpacts)));
}

function getPhantomDireImpactCapacity(config = activeImpactConfig): number {
  return Math.min(PHANTOM_DIRE_IMPACT_CAPACITY, Math.max(0, Math.floor(config.maxActiveImpacts)));
}

function getTerrainImpactParticleBudget(config = activeImpactConfig): number {
  const capacity = Math.max(1, Math.floor(config.maxActiveImpacts));
  return Math.max(1, Math.floor(config.maxActiveParticles / capacity));
}

function getBudgetedImpactStyle(kind: TerrainImpactKind, config = activeImpactConfig): ImpactStyle {
  const style = getImpactStyle(kind);
  const particleBudget = getTerrainImpactParticleBudget(config);
  const requestedParticles = style.particleCount + style.smokeCount;
  if (requestedParticles <= particleBudget) return style;

  const particleShare = style.particleCount / Math.max(1, requestedParticles);
  const nextParticleCount = Math.min(
    style.particleCount,
    Math.max(1, Math.ceil(particleBudget * particleShare))
  );
  const nextSmokeCount = Math.min(
    style.smokeCount,
    Math.max(0, particleBudget - nextParticleCount)
  );

  return {
    ...style,
    particleCount: nextParticleCount,
    smokeCount: nextSmokeCount,
  };
}

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
  particleCount: number;
  smokeCount: number;
}

interface PhantomDireImpactInstancedBatches {
  flash: GenericImpactInstanceBucket;
  core: GenericImpactInstanceBucket;
  outer: GenericImpactInstanceBucket;
  ring: GenericImpactInstanceBucket;
  ring2: GenericImpactInstanceBucket;
  particles: GenericImpactInstanceBucket;
  smoke: GenericImpactInstanceBucket;
  lights: Array<THREE.PointLight | null>;
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

interface GenericImpactInstanceBucket {
  mesh: THREE.InstancedMesh | null;
  alpha: THREE.InstancedBufferAttribute | null;
  count: number;
}

interface GenericImpactInstancedBatches {
  flashAdditive: GenericImpactInstanceBucket;
  coreAdditive: GenericImpactInstanceBucket;
  coreNormal: GenericImpactInstanceBucket;
  outerAdditive: GenericImpactInstanceBucket;
  outerNormal: GenericImpactInstanceBucket;
  ringAdditive: GenericImpactInstanceBucket;
  ringNormal: GenericImpactInstanceBucket;
  ring2Additive: GenericImpactInstanceBucket;
  ring2Normal: GenericImpactInstanceBucket;
  particleSphereAdditive: GenericImpactInstanceBucket;
  particleSphereNormal: GenericImpactInstanceBucket;
  particleBoxAdditive: GenericImpactInstanceBucket;
  particleBoxNormal: GenericImpactInstanceBucket;
  particleConeAdditive: GenericImpactInstanceBucket;
  particleConeNormal: GenericImpactInstanceBucket;
  smoke: GenericImpactInstanceBucket;
  lights: Array<THREE.PointLight | null>;
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
    particleCount: PHANTOM_DIRE_IMPACT_STYLE.particleCount,
    smokeCount: PHANTOM_DIRE_IMPACT_STYLE.smokeCount,
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

function createGenericImpactInstanceBucket(): GenericImpactInstanceBucket {
  return {
    mesh: null,
    alpha: null,
    count: 0,
  };
}

function createGenericImpactInstancedBatches(): GenericImpactInstancedBatches {
  return {
    flashAdditive: createGenericImpactInstanceBucket(),
    coreAdditive: createGenericImpactInstanceBucket(),
    coreNormal: createGenericImpactInstanceBucket(),
    outerAdditive: createGenericImpactInstanceBucket(),
    outerNormal: createGenericImpactInstanceBucket(),
    ringAdditive: createGenericImpactInstanceBucket(),
    ringNormal: createGenericImpactInstanceBucket(),
    ring2Additive: createGenericImpactInstanceBucket(),
    ring2Normal: createGenericImpactInstanceBucket(),
    particleSphereAdditive: createGenericImpactInstanceBucket(),
    particleSphereNormal: createGenericImpactInstanceBucket(),
    particleBoxAdditive: createGenericImpactInstanceBucket(),
    particleBoxNormal: createGenericImpactInstanceBucket(),
    particleConeAdditive: createGenericImpactInstanceBucket(),
    particleConeNormal: createGenericImpactInstanceBucket(),
    smoke: createGenericImpactInstanceBucket(),
    lights: [],
  };
}

function createPhantomDireImpactInstancedBatches(): PhantomDireImpactInstancedBatches {
  return {
    flash: createGenericImpactInstanceBucket(),
    core: createGenericImpactInstanceBucket(),
    outer: createGenericImpactInstanceBucket(),
    ring: createGenericImpactInstanceBucket(),
    ring2: createGenericImpactInstanceBucket(),
    particles: createGenericImpactInstanceBucket(),
    smoke: createGenericImpactInstanceBucket(),
    lights: [],
  };
}

function createGenericImpactInstancedMaterial(
  additive: boolean,
  side: THREE.Side = THREE.FrontSide
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side,
    vertexColors: true,
    toneMapped: false,
  });
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `attribute float ${GENERIC_IMPACT_ALPHA_ATTRIBUTE};\nvarying float vInstanceAlpha;\nvoid main() {`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n  vInstanceAlpha = ${GENERIC_IMPACT_ALPHA_ATTRIBUTE};`);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'varying float vInstanceAlpha;\nvoid main() {')
      .replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.a *= vInstanceAlpha;');
  };
  material.customProgramCacheKey = () => `terrain-impact-instanced-alpha:${additive ? 'add' : 'normal'}:${side}`;
  return material;
}

function ensureGenericImpactInstanceAttributes(
  mesh: THREE.InstancedMesh,
  capacity: number
): THREE.InstancedBufferAttribute {
  const existingAlpha = mesh.geometry.getAttribute(GENERIC_IMPACT_ALPHA_ATTRIBUTE);
  const alpha = existingAlpha instanceof THREE.InstancedBufferAttribute && existingAlpha.count >= capacity
    ? existingAlpha
    : new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  if (alpha !== existingAlpha) {
    alpha.setUsage(THREE.DynamicDrawUsage);
    mesh.geometry.setAttribute(GENERIC_IMPACT_ALPHA_ATTRIBUTE, alpha);
  }

  if (!mesh.instanceColor || mesh.instanceColor.count < capacity) {
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return alpha;
}

function attachGenericImpactBucketMesh(
  bucket: GenericImpactInstanceBucket,
  mesh: THREE.InstancedMesh | null,
  capacity: number
): void {
  bucket.mesh = mesh;
  bucket.alpha = mesh ? ensureGenericImpactInstanceAttributes(mesh, capacity) : null;
  bucket.count = 0;
  if (mesh) mesh.count = 0;
}

function resetGenericImpactBucket(bucket: GenericImpactInstanceBucket): void {
  bucket.count = 0;
}

function finalizeGenericImpactBucket(bucket: GenericImpactInstanceBucket): void {
  const mesh = bucket.mesh;
  const alpha = bucket.alpha;
  if (!mesh || !alpha) return;
  mesh.count = bucket.count;
  mesh.instanceMatrix.needsUpdate = true;
  alpha.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

function resetGenericImpactBatches(batches: GenericImpactInstancedBatches): void {
  resetGenericImpactBucket(batches.flashAdditive);
  resetGenericImpactBucket(batches.coreAdditive);
  resetGenericImpactBucket(batches.coreNormal);
  resetGenericImpactBucket(batches.outerAdditive);
  resetGenericImpactBucket(batches.outerNormal);
  resetGenericImpactBucket(batches.ringAdditive);
  resetGenericImpactBucket(batches.ringNormal);
  resetGenericImpactBucket(batches.ring2Additive);
  resetGenericImpactBucket(batches.ring2Normal);
  resetGenericImpactBucket(batches.particleSphereAdditive);
  resetGenericImpactBucket(batches.particleSphereNormal);
  resetGenericImpactBucket(batches.particleBoxAdditive);
  resetGenericImpactBucket(batches.particleBoxNormal);
  resetGenericImpactBucket(batches.particleConeAdditive);
  resetGenericImpactBucket(batches.particleConeNormal);
  resetGenericImpactBucket(batches.smoke);
}

function finalizeGenericImpactBatches(batches: GenericImpactInstancedBatches): void {
  finalizeGenericImpactBucket(batches.flashAdditive);
  finalizeGenericImpactBucket(batches.coreAdditive);
  finalizeGenericImpactBucket(batches.coreNormal);
  finalizeGenericImpactBucket(batches.outerAdditive);
  finalizeGenericImpactBucket(batches.outerNormal);
  finalizeGenericImpactBucket(batches.ringAdditive);
  finalizeGenericImpactBucket(batches.ringNormal);
  finalizeGenericImpactBucket(batches.ring2Additive);
  finalizeGenericImpactBucket(batches.ring2Normal);
  finalizeGenericImpactBucket(batches.particleSphereAdditive);
  finalizeGenericImpactBucket(batches.particleSphereNormal);
  finalizeGenericImpactBucket(batches.particleBoxAdditive);
  finalizeGenericImpactBucket(batches.particleBoxNormal);
  finalizeGenericImpactBucket(batches.particleConeAdditive);
  finalizeGenericImpactBucket(batches.particleConeNormal);
  finalizeGenericImpactBucket(batches.smoke);
}

function resetPhantomDireImpactBatches(batches: PhantomDireImpactInstancedBatches): void {
  resetGenericImpactBucket(batches.flash);
  resetGenericImpactBucket(batches.core);
  resetGenericImpactBucket(batches.outer);
  resetGenericImpactBucket(batches.ring);
  resetGenericImpactBucket(batches.ring2);
  resetGenericImpactBucket(batches.particles);
  resetGenericImpactBucket(batches.smoke);
}

function finalizePhantomDireImpactBatches(batches: PhantomDireImpactInstancedBatches): void {
  finalizeGenericImpactBucket(batches.flash);
  finalizeGenericImpactBucket(batches.core);
  finalizeGenericImpactBucket(batches.outer);
  finalizeGenericImpactBucket(batches.ring);
  finalizeGenericImpactBucket(batches.ring2);
  finalizeGenericImpactBucket(batches.particles);
  finalizeGenericImpactBucket(batches.smoke);
}

function getGenericImpactParticleBucket(
  batches: GenericImpactInstancedBatches,
  shape: ImpactStyle['debrisShape'],
  additive: boolean
): GenericImpactInstanceBucket {
  if (shape === 'box') {
    return additive ? batches.particleBoxAdditive : batches.particleBoxNormal;
  }
  if (shape === 'cone') {
    return additive ? batches.particleConeAdditive : batches.particleConeNormal;
  }
  return additive ? batches.particleSphereAdditive : batches.particleSphereNormal;
}

function writeGenericImpactInstance(
  bucket: GenericImpactInstanceBucket,
  rootPosition: { x: number; y: number; z: number },
  rootQuaternion: THREE.Quaternion,
  localPosition: THREE.Vector3,
  localQuaternion: THREE.Quaternion,
  localScale: THREE.Vector3,
  color: number,
  opacity: number
): void {
  const mesh = bucket.mesh;
  const alpha = bucket.alpha;
  if (!mesh || !alpha || opacity <= 0.001) return;

  const index = bucket.count;
  if (index >= mesh.instanceMatrix.count || index >= alpha.count) return;

  genericImpactWorldPosition.copy(localPosition).applyQuaternion(rootQuaternion);
  genericImpactWorldPosition.x += rootPosition.x;
  genericImpactWorldPosition.y += rootPosition.y;
  genericImpactWorldPosition.z += rootPosition.z;
  genericImpactWorldQuaternion.copy(rootQuaternion).multiply(localQuaternion);

  genericImpactDummy.position.copy(genericImpactWorldPosition);
  genericImpactDummy.quaternion.copy(genericImpactWorldQuaternion);
  genericImpactDummy.scale.copy(localScale);
  genericImpactDummy.updateMatrix();

  mesh.setMatrixAt(index, genericImpactDummy.matrix);
  mesh.setColorAt(index, genericImpactColor.setHex(color));
  alpha.setX(index, opacity);
  bucket.count = index + 1;
}

function claimPooledPhantomDireImpact(
  style: ImpactStyle,
  position: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  scale: number,
  frameNow: number,
  capacity: number
): void {
  if (capacity <= 0) return;
  nextPhantomDireImpactSlot %= capacity;
  const slot = phantomDireImpactSlots[nextPhantomDireImpactSlot];
  nextPhantomDireImpactSlot = (nextPhantomDireImpactSlot + 1) % capacity;

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
  slot.duration = style.duration;
  slot.scale = scale;
  slot.seed = Math.random() * Math.PI * 2;
  slot.particleCount = style.particleCount;
  slot.smokeCount = style.smokeCount;
}

function countActivePhantomDireImpacts(frameNow: number): number {
  let activeCount = 0;
  const capacity = getPhantomDireImpactCapacity();
  for (let slotIndex = 0; slotIndex < capacity; slotIndex++) {
    const slot = phantomDireImpactSlots[slotIndex];
    if (slot.active && frameNow - slot.startTime < slot.duration) {
      activeCount++;
    }
  }
  return activeCount;
}

function countVisibleGenericImpacts(frameNow: number): number {
  let activeCount = 0;
  const capacity = getGenericImpactCapacity();
  for (let slotIndex = 0; slotIndex < capacity; slotIndex++) {
    const slot = genericImpactSlots[slotIndex];
    if (slot.active && frameNow - slot.startTime < slot.duration) {
      activeCount++;
    }
  }
  return activeCount;
}

function recordTerrainImpactDiagnostics(frameNow: number, config: EffectQualityConfig): void {
  if (!MOVEMENT_DIAGNOSTICS_ENABLED) return;

  const phantomActive = countActivePhantomDireImpacts(frameNow);
  const genericActive = countVisibleGenericImpacts(frameNow);
  const phantomCapacity = getPhantomDireImpactCapacity(config);
  const genericCapacity = getGenericImpactCapacity(config);
  const totalCapacity = phantomCapacity + genericCapacity;
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
    capacity: phantomCapacity,
    hiddenMounted: Math.max(0, phantomCapacity - phantomActive),
  });
}

function chooseGenericImpactSlot(frameNow: number, maxActiveImpacts: number): PooledGenericImpactSlot | null {
  const capacity = Math.min(GENERIC_IMPACT_CAPACITY, Math.max(0, Math.floor(maxActiveImpacts)));
  if (capacity <= 0) return null;

  let activeCount = 0;
  let oldestSlot: PooledGenericImpactSlot | null = null;
  let reusableSlot: PooledGenericImpactSlot | null = null;
  let reusableSlotIndex = -1;

  nextGenericImpactSlot %= capacity;
  for (let offset = 0; offset < capacity; offset++) {
    const slotIndex = (nextGenericImpactSlot + offset) % capacity;
    const slot = genericImpactSlots[slotIndex];
    if (slot.active && frameNow - slot.startTime < slot.duration) {
      activeCount++;
      if (!oldestSlot || slot.startTime < oldestSlot.startTime) {
        oldestSlot = slot;
      }
      continue;
    }

    slot.active = false;
    if (!reusableSlot) {
      reusableSlot = slot;
      reusableSlotIndex = slotIndex;
    }
  }

  if (activeCount >= maxActiveImpacts) return oldestSlot;
  if (!reusableSlot) return null;

  nextGenericImpactSlot = (reusableSlotIndex + 1) % capacity;
  return reusableSlot;
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
  const maxActiveImpacts = getGenericImpactCapacity();
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

function isImpactWithinRenderDistance(position: { x: number; y: number; z: number }): boolean {
  const maxDistance = activeImpactConfig.maxTerrainImpactRenderDistance;
  if (!Number.isFinite(maxDistance) || !Number.isFinite(activeImpactCameraPosition.x)) return true;
  const dx = position.x - activeImpactCameraPosition.x;
  const dy = position.y - activeImpactCameraPosition.y;
  const dz = position.z - activeImpactCameraPosition.z;
  return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
}

export function triggerTerrainImpact(
  kind: TerrainImpactKind,
  position: { x: number; y: number; z: number },
  options: TerrainImpactOptions = {}
): void {
  if (activeImpactConfig.maxActiveImpacts <= 0) return;
  if (!isImpactWithinRenderDistance(position)) return;

  const style = getBudgetedImpactStyle(kind);
  const normal = options.normal ?? UP;
  const frameNow = getFrameClock().nowMs;

  if (kind === 'phantom_dire_ball') {
    const capacity = getPhantomDireImpactCapacity();
    let activePooledImpacts = 0;
    for (let slotIndex = 0; slotIndex < capacity; slotIndex++) {
      const slot = phantomDireImpactSlots[slotIndex];
      if (!slot.active) continue;
      activePooledImpacts++;
      if (activePooledImpacts >= capacity) return;
    }

    claimPooledPhantomDireImpact(style, position, normal, (options.scale ?? 1) * style.scale, frameNow, capacity);
    return;
  }

  claimGenericImpact(kind, style, position, normal, (options.scale ?? 1) * style.scale, frameNow);
}

export function TerrainImpactEffectsManager({ config }: { config: EffectQualityConfig }) {
  const phantomInstancedBatchesRef = useRef<PhantomDireImpactInstancedBatches | null>(null);
  const genericInstancedBatchesRef = useRef<GenericImpactInstancedBatches | null>(null);
  const phantomCapacity = getPhantomDireImpactCapacity(config);
  const genericCapacity = getGenericImpactCapacity(config);
  useEffect(() => {
    activeImpactConfig = config;
  }, [config]);

  useFrame(({ camera }) => {
    activeImpactCameraPosition.copy(camera.position);
    const frameNow = getFrameClock().nowMs;
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.effects.terrainImpacts', () => {
        updatePooledPhantomDireImpacts(phantomInstancedBatchesRef.current, frameNow);
        updatePooledGenericImpacts(genericInstancedBatchesRef.current, frameNow);
      });
    } else {
      updatePooledPhantomDireImpacts(phantomInstancedBatchesRef.current, frameNow);
      updatePooledGenericImpacts(genericInstancedBatchesRef.current, frameNow);
    }
    recordTerrainImpactDiagnostics(frameNow, config);
  });

  return (
    <group>
      <PooledPhantomDireImpactInstances
        batchesRef={phantomInstancedBatchesRef}
        enableDecorativeLights={config.enableDecorativeLights}
        capacity={phantomCapacity}
      />
      <PooledGenericImpactInstances
        batchesRef={genericInstancedBatchesRef}
        enableDecorativeLights={config.enableDecorativeLights}
        capacity={genericCapacity}
      />
    </group>
  );
}

function updatePooledPhantomDireImpacts(batches: PhantomDireImpactInstancedBatches | null, now: number): void {
  if (!batches) return;

  const style = PHANTOM_DIRE_IMPACT_STYLE;
  const capacity = getPhantomDireImpactCapacity();
  resetPhantomDireImpactBatches(batches);

  for (let slotIndex = 0; slotIndex < capacity; slotIndex++) {
    const data = phantomDireImpactSlots[slotIndex];
    const light = batches.lights[slotIndex];

    if (!data.active) {
      if (light) light.intensity = 0;
      continue;
    }

    const elapsed = now - data.startTime;
    if (elapsed >= data.duration) {
      data.active = false;
      if (light) light.intensity = 0;
      continue;
    }

    const progress = Math.min(1, elapsed / data.duration);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const fade = Math.max(0, 1 - progress);
    const hotFade = Math.max(0, 1 - progress * 1.6);
    const baseScale = data.scale;

    genericImpactLocalPosition.set(0, 0, 0);
    const flashProgress = Math.min(1, elapsed / 80);
    genericImpactLocalScale.setScalar(baseScale * (0.28 + flashProgress * style.coreRadius * 1.3));
    writeGenericImpactInstance(
      batches.flash,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_IDENTITY_QUATERNION,
      genericImpactLocalScale,
      style.flashColor,
      Math.max(0, 1 - flashProgress * 1.45)
    );

    genericImpactLocalScale.setScalar(baseScale * style.coreRadius * (0.45 + easeOut * 0.85));
    writeGenericImpactInstance(
      batches.core,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_IDENTITY_QUATERNION,
      genericImpactLocalScale,
      style.coreColor,
      hotFade * 0.88
    );

    genericImpactLocalScale.setScalar(baseScale * style.coreRadius * (0.8 + easeOut * 1.4));
    writeGenericImpactInstance(
      batches.outer,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_IDENTITY_QUATERNION,
      genericImpactLocalScale,
      style.outerColor,
      fade * 0.45
    );

    let ringScale = baseScale * (0.35 + easeOut * style.ringRadius);
    genericImpactLocalPosition.set(0, 0.03, 0);
    genericImpactLocalScale.set(ringScale, ringScale, 1);
    writeGenericImpactInstance(
      batches.ring,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_RING_QUATERNION,
      genericImpactLocalScale,
      style.ringColor,
      fade * 0.72
    );

    ringScale = baseScale * (0.2 + easeOut * style.ringRadius * 0.62);
    genericImpactLocalPosition.set(0, 0.05, 0);
    genericImpactLocalScale.set(ringScale, ringScale, 1);
    writeGenericImpactInstance(
      batches.ring2,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_RING_QUATERNION,
      genericImpactLocalScale,
      style.secondRingColor,
      fade * 0.5
    );

    const t = elapsed / 1000;
    for (let i = 0; i < data.particleCount; i++) {
      const angle = data.seed + (i / data.particleCount) * Math.PI * 2 + Math.sin(i * 12.9898 + data.seed) * 0.32;
      const speed = style.particleSpeed * (0.65 + ((i * 37) % 17) / 35);
      const lift = style.particleLift * (0.65 + ((i * 19) % 13) / 30);
      const size = 0.045 + ((i * 23) % 11) * 0.008;
      const spin = (i % 2 === 0 ? 1 : -1) * (2 + (i % 4));
      const lateral = speed * t;
      const y = lift * t - style.gravity * t * t * 0.5;

      genericImpactLocalPosition.set(
        Math.cos(angle) * lateral,
        Math.max(-0.08, y),
        Math.sin(angle) * lateral
      );
      genericImpactEuler.set(t * spin, t * spin * 0.7, t * spin * 1.3);
      genericImpactLocalQuaternion.setFromEuler(genericImpactEuler);
      genericImpactLocalScale.setScalar(baseScale * size * (1 - progress * 0.55));
      writeGenericImpactInstance(
        batches.particles,
        data.position,
        data.quaternion,
        genericImpactLocalPosition,
        genericImpactLocalQuaternion,
        genericImpactLocalScale,
        style.particleColors[i % style.particleColors.length],
        Math.max(0, fade * (y > -0.04 ? 1 : 0.25))
      );
    }

    for (let i = 0; i < data.smokeCount; i++) {
      const smokeProgress = Math.min(1, progress * 1.15);
      const angle = data.seed * 0.7 + (i / Math.max(1, data.smokeCount)) * Math.PI * 2;
      const speed = 0.7 + i * 0.18;
      const lift = 0.9 + i * 0.2;
      const size = 0.18 + i * 0.04;
      genericImpactLocalPosition.set(
        Math.cos(angle) * speed * smokeProgress,
        lift * smokeProgress,
        Math.sin(angle) * speed * smokeProgress
      );
      genericImpactLocalScale.setScalar(baseScale * (size + smokeProgress * 0.35));
      writeGenericImpactInstance(
        batches.smoke,
        data.position,
        data.quaternion,
        genericImpactLocalPosition,
        GENERIC_IMPACT_IDENTITY_QUATERNION,
        genericImpactLocalScale,
        style.smokeColor,
        Math.max(0, 0.34 - smokeProgress * 0.34)
      );
    }

    if (light) {
      light.position.set(data.position.x, data.position.y, data.position.z);
      light.color.setHex(style.lightColor);
      light.intensity = style.lightIntensity * fade;
      light.distance = 8 * data.scale;
    }
  }

  finalizePhantomDireImpactBatches(batches);
}

function PooledPhantomDireImpactInstances({
  batchesRef,
  enableDecorativeLights,
  capacity,
}: {
  batchesRef: MutableRefObject<PhantomDireImpactInstancedBatches | null>;
  enableDecorativeLights: boolean;
  capacity: number;
}) {
  const localBatchesRef = useRef<PhantomDireImpactInstancedBatches | null>(null);
  if (!localBatchesRef.current) {
    localBatchesRef.current = createPhantomDireImpactInstancedBatches();
  }
  const batches = localBatchesRef.current;
  batchesRef.current = batches;

  const surfaceCapacity = Math.max(1, capacity);
  const particleCapacity = Math.max(1, capacity * PHANTOM_DIRE_IMPACT_PARTICLES);
  const smokeCapacity = Math.max(1, capacity * PHANTOM_DIRE_IMPACT_SMOKE);
  const geometries = useMemo(() => ({
    flash: SHARED_GEOMETRIES.sphere8.clone(),
    core: SHARED_GEOMETRIES.sphere8.clone(),
    outer: SHARED_GEOMETRIES.sphere8.clone(),
    ring: SHARED_GEOMETRIES.ring24.clone(),
    ring2: SHARED_GEOMETRIES.ring16.clone(),
    particles: SHARED_GEOMETRIES.sphere8.clone(),
    smoke: SHARED_GEOMETRIES.sphere8.clone(),
  }), []);
  const materials = useMemo(() => ({
    additiveFront: createGenericImpactInstancedMaterial(true),
    additiveDouble: createGenericImpactInstancedMaterial(true, THREE.DoubleSide),
    normalFront: createGenericImpactInstancedMaterial(false),
  }), []);

  useEffect(() => () => {
    if (batchesRef.current === batches) {
      batchesRef.current = null;
    }
    Object.values(geometries).forEach(geometry => geometry.dispose());
    Object.values(materials).forEach(material => material.dispose());
  }, [batches, batchesRef, geometries, materials]);

  return (
    <>
      <instancedMesh
        key={`phantom-dire-impact-flash-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.flash, el, surfaceCapacity)}
        args={[geometries.flash, materials.additiveFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`phantom-dire-impact-core-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.core, el, surfaceCapacity)}
        args={[geometries.core, materials.additiveFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`phantom-dire-impact-outer-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.outer, el, surfaceCapacity)}
        args={[geometries.outer, materials.additiveFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`phantom-dire-impact-ring-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.ring, el, surfaceCapacity)}
        args={[geometries.ring, materials.additiveDouble, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`phantom-dire-impact-ring2-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.ring2, el, surfaceCapacity)}
        args={[geometries.ring2, materials.additiveDouble, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`phantom-dire-impact-particles-${particleCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.particles, el, particleCapacity)}
        args={[geometries.particles, materials.additiveFront, particleCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`phantom-dire-impact-smoke-${smokeCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.smoke, el, smokeCapacity)}
        args={[geometries.smoke, materials.normalFront, smokeCapacity]}
        frustumCulled={false}
      />
      {enableDecorativeLights && PHANTOM_DIRE_IMPACT_INDICES.slice(0, capacity).map((slotIndex) => (
        <BudgetedPointLight
          key={`phantom-dire-impact-light-${slotIndex}`}
          budgetPriority={2}
          ref={el => { batches.lights[slotIndex] = el; }}
          color={PHANTOM_DIRE_IMPACT_STYLE.lightColor}
          intensity={0}
          distance={8 * PHANTOM_DIRE_IMPACT_STYLE.scale}
          decay={2}
        />
      ))}
    </>
  );
}

function updatePooledGenericImpacts(batches: GenericImpactInstancedBatches | null, now: number): void {
  if (!batches) return;

  resetGenericImpactBatches(batches);
  const capacity = getGenericImpactCapacity();
  for (let slotIndex = 0; slotIndex < capacity; slotIndex++) {
    const data = genericImpactSlots[slotIndex];
    const light = batches.lights[slotIndex];

    if (!data.active) {
      if (light) light.intensity = 0;
      continue;
    }

    const elapsed = now - data.startTime;
    if (elapsed >= data.duration) {
      data.active = false;
      if (light) light.intensity = 0;
      continue;
    }

    const style = data.style;
    const progress = Math.min(1, elapsed / data.duration);
    const easeOut = 1 - Math.pow(1 - progress, 3);
    const fade = Math.max(0, 1 - progress);
    const hotFade = Math.max(0, 1 - progress * 1.6);
    const baseScale = data.scale;

    genericImpactLocalPosition.set(0, 0, 0);
    const flashProgress = Math.min(1, elapsed / 80);
    genericImpactLocalScale.setScalar(baseScale * (0.28 + flashProgress * style.coreRadius * 1.3));
    writeGenericImpactInstance(
      batches.flashAdditive,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_IDENTITY_QUATERNION,
      genericImpactLocalScale,
      style.flashColor,
      Math.max(0, 1 - flashProgress * 1.45)
    );

    genericImpactLocalScale.setScalar(baseScale * style.coreRadius * (0.45 + easeOut * 0.85));
    writeGenericImpactInstance(
      style.additive ? batches.coreAdditive : batches.coreNormal,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_IDENTITY_QUATERNION,
      genericImpactLocalScale,
      style.coreColor,
      hotFade * 0.88
    );

    genericImpactLocalScale.setScalar(baseScale * style.coreRadius * (0.8 + easeOut * 1.4));
    writeGenericImpactInstance(
      style.additive ? batches.outerAdditive : batches.outerNormal,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_IDENTITY_QUATERNION,
      genericImpactLocalScale,
      style.outerColor,
      fade * 0.45
    );

    let ringScale = baseScale * (0.35 + easeOut * style.ringRadius);
    genericImpactLocalPosition.set(0, 0.03, 0);
    genericImpactLocalScale.set(ringScale, ringScale, 1);
    writeGenericImpactInstance(
      style.additive ? batches.ringAdditive : batches.ringNormal,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_RING_QUATERNION,
      genericImpactLocalScale,
      style.ringColor,
      fade * 0.72
    );

    ringScale = baseScale * (0.2 + easeOut * style.ringRadius * 0.62);
    genericImpactLocalPosition.set(0, 0.05, 0);
    genericImpactLocalScale.set(ringScale, ringScale, 1);
    writeGenericImpactInstance(
      style.additive ? batches.ring2Additive : batches.ring2Normal,
      data.position,
      data.quaternion,
      genericImpactLocalPosition,
      GENERIC_IMPACT_RING_QUATERNION,
      genericImpactLocalScale,
      style.secondRingColor,
      fade * 0.5
    );

    const t = elapsed / 1000;
    const particleBucket = getGenericImpactParticleBucket(batches, style.debrisShape, style.additive);
    for (let i = 0; i < style.particleCount; i++) {
      const angle = data.seed + (i / style.particleCount) * Math.PI * 2 + Math.sin(i * 12.9898 + data.seed) * 0.32;
      const speed = style.particleSpeed * (0.65 + ((i * 37) % 17) / 35);
      const lift = style.particleLift * (0.65 + ((i * 19) % 13) / 30);
      const size = 0.045 + ((i * 23) % 11) * 0.008;
      const spin = (i % 2 === 0 ? 1 : -1) * (2 + (i % 4));
      const lateral = speed * t;
      const y = lift * t - style.gravity * t * t * 0.5;

      genericImpactLocalPosition.set(
        Math.cos(angle) * lateral,
        Math.max(-0.08, y),
        Math.sin(angle) * lateral
      );
      genericImpactEuler.set(t * spin, t * spin * 0.7, t * spin * 1.3);
      genericImpactLocalQuaternion.setFromEuler(genericImpactEuler);
      genericImpactLocalScale.setScalar(baseScale * size * (1 - progress * 0.55));
      writeGenericImpactInstance(
        particleBucket,
        data.position,
        data.quaternion,
        genericImpactLocalPosition,
        genericImpactLocalQuaternion,
        genericImpactLocalScale,
        style.particleColors[i % style.particleColors.length],
        Math.max(0, fade * (y > -0.04 ? 1 : 0.25))
      );
    }

    for (let i = 0; i < style.smokeCount; i++) {
      const smokeProgress = Math.min(1, progress * 1.15);
      const angle = data.seed * 0.7 + (i / Math.max(1, style.smokeCount)) * Math.PI * 2;
      const speed = 0.7 + i * 0.18;
      const lift = 0.9 + i * 0.2;
      const size = 0.18 + i * 0.04;
      genericImpactLocalPosition.set(
        Math.cos(angle) * speed * smokeProgress,
        lift * smokeProgress,
        Math.sin(angle) * speed * smokeProgress
      );
      genericImpactLocalScale.setScalar(baseScale * (size + smokeProgress * 0.35));
      writeGenericImpactInstance(
        batches.smoke,
        data.position,
        data.quaternion,
        genericImpactLocalPosition,
        GENERIC_IMPACT_IDENTITY_QUATERNION,
        genericImpactLocalScale,
        style.smokeColor,
        Math.max(0, 0.34 - smokeProgress * 0.34)
      );
    }

    if (light) {
      light.position.set(data.position.x, data.position.y, data.position.z);
      light.color.setHex(style.lightColor);
      light.intensity = style.lightIntensity * fade;
      light.distance = 8 * data.scale;
    }
  }

  finalizeGenericImpactBatches(batches);
}

function PooledGenericImpactInstances({
  batchesRef,
  enableDecorativeLights,
  capacity,
}: {
  batchesRef: MutableRefObject<GenericImpactInstancedBatches | null>;
  enableDecorativeLights: boolean;
  capacity: number;
}) {
  const localBatchesRef = useRef<GenericImpactInstancedBatches | null>(null);
  if (!localBatchesRef.current) {
    localBatchesRef.current = createGenericImpactInstancedBatches();
  }
  const batches = localBatchesRef.current;
  batchesRef.current = batches;

  const surfaceCapacity = Math.max(1, capacity);
  const particleCapacity = Math.max(1, capacity * GENERIC_IMPACT_MAX_PARTICLES);
  const smokeCapacity = Math.max(1, capacity * GENERIC_IMPACT_MAX_SMOKE);
  const geometries = useMemo(() => ({
    flash: SHARED_GEOMETRIES.sphere8.clone(),
    coreAdditive: SHARED_GEOMETRIES.sphere8.clone(),
    coreNormal: SHARED_GEOMETRIES.sphere8.clone(),
    outerAdditive: SHARED_GEOMETRIES.sphere8.clone(),
    outerNormal: SHARED_GEOMETRIES.sphere8.clone(),
    ringAdditive: SHARED_GEOMETRIES.ring24.clone(),
    ringNormal: SHARED_GEOMETRIES.ring24.clone(),
    ring2Additive: SHARED_GEOMETRIES.ring16.clone(),
    ring2Normal: SHARED_GEOMETRIES.ring16.clone(),
    particleSphereAdditive: SHARED_GEOMETRIES.sphere8.clone(),
    particleSphereNormal: SHARED_GEOMETRIES.sphere8.clone(),
    particleBoxAdditive: SHARED_GEOMETRIES.box.clone(),
    particleBoxNormal: SHARED_GEOMETRIES.box.clone(),
    particleConeAdditive: SHARED_GEOMETRIES.cone6.clone(),
    particleConeNormal: SHARED_GEOMETRIES.cone6.clone(),
    smoke: SHARED_GEOMETRIES.sphere8.clone(),
  }), []);
  const materials = useMemo(() => ({
    additiveFront: createGenericImpactInstancedMaterial(true),
    normalFront: createGenericImpactInstancedMaterial(false),
    additiveDouble: createGenericImpactInstancedMaterial(true, THREE.DoubleSide),
    normalDouble: createGenericImpactInstancedMaterial(false, THREE.DoubleSide),
  }), []);

  useEffect(() => () => {
    if (batchesRef.current === batches) {
      batchesRef.current = null;
    }
    Object.values(geometries).forEach(geometry => geometry.dispose());
    Object.values(materials).forEach(material => material.dispose());
  }, [batches, batchesRef, geometries, materials]);

  return (
    <>
      <instancedMesh
        key={`generic-impact-flash-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.flashAdditive, el, surfaceCapacity)}
        args={[geometries.flash, materials.additiveFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-core-add-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.coreAdditive, el, surfaceCapacity)}
        args={[geometries.coreAdditive, materials.additiveFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-core-normal-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.coreNormal, el, surfaceCapacity)}
        args={[geometries.coreNormal, materials.normalFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-outer-add-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.outerAdditive, el, surfaceCapacity)}
        args={[geometries.outerAdditive, materials.additiveFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-outer-normal-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.outerNormal, el, surfaceCapacity)}
        args={[geometries.outerNormal, materials.normalFront, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-ring-add-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.ringAdditive, el, surfaceCapacity)}
        args={[geometries.ringAdditive, materials.additiveDouble, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-ring-normal-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.ringNormal, el, surfaceCapacity)}
        args={[geometries.ringNormal, materials.normalDouble, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-ring2-add-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.ring2Additive, el, surfaceCapacity)}
        args={[geometries.ring2Additive, materials.additiveDouble, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-ring2-normal-${surfaceCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.ring2Normal, el, surfaceCapacity)}
        args={[geometries.ring2Normal, materials.normalDouble, surfaceCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-particle-sphere-add-${particleCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.particleSphereAdditive, el, particleCapacity)}
        args={[geometries.particleSphereAdditive, materials.additiveFront, particleCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-particle-sphere-normal-${particleCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.particleSphereNormal, el, particleCapacity)}
        args={[geometries.particleSphereNormal, materials.normalFront, particleCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-particle-box-add-${particleCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.particleBoxAdditive, el, particleCapacity)}
        args={[geometries.particleBoxAdditive, materials.additiveFront, particleCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-particle-box-normal-${particleCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.particleBoxNormal, el, particleCapacity)}
        args={[geometries.particleBoxNormal, materials.normalFront, particleCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-particle-cone-add-${particleCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.particleConeAdditive, el, particleCapacity)}
        args={[geometries.particleConeAdditive, materials.additiveFront, particleCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-particle-cone-normal-${particleCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.particleConeNormal, el, particleCapacity)}
        args={[geometries.particleConeNormal, materials.normalFront, particleCapacity]}
        frustumCulled={false}
      />
      <instancedMesh
        key={`generic-impact-smoke-${smokeCapacity}`}
        ref={el => attachGenericImpactBucketMesh(batches.smoke, el, smokeCapacity)}
        args={[geometries.smoke, materials.normalFront, smokeCapacity]}
        frustumCulled={false}
      />
      {enableDecorativeLights && GENERIC_IMPACT_INDICES.slice(0, capacity).map((slotIndex) => (
        <BudgetedPointLight
          key={`generic-impact-light-${slotIndex}`}
          budgetPriority={1.6}
          ref={el => { batches.lights[slotIndex] = el; }}
          color={0xffffff}
          intensity={0}
          distance={8}
          decay={2}
        />
      ))}
    </>
  );
}
