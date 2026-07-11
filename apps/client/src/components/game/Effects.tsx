import { useRef, useEffect, useLayoutEffect, useMemo, useState, type MutableRefObject } from 'react';
import { useFrame, useThree, type RootState } from '@react-three/fiber';
import * as THREE from 'three';
import {
  getPhantomUmbralDecoyCastSchedule,
  getPhantomUmbralDecoyMotion,
  getPhantomUmbralDecoySeed,
  type HeroSkinId,
  type Team,
} from '@voxel-strike/shared';
import { resolveAbilitySocketOrigin } from '../../model-system/abilitySocketResolver';
import {
  chronosOrbForwardFromYaw,
  offsetChronosOrbVisualVector,
} from '../../model-system/chronosOrbVisualOrigin';
import { useGameStore } from '../../store/gameStore';
import { visualStore } from '../../store/visualStore';
import { getFrameClock } from '../../utils/frameClock';
import { BudgetedPointLight } from './systems/DynamicLightBudget';
import { createFrameUpdaterRegistry } from './systems/frameUpdaterRegistry';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../movement/networkDiagnostics';
import { useDeferredFrameCommit } from './systems/useDeferredFrameCommit';
import { SHARED_GEOMETRIES } from './effectResources';
import { HeroVoxelBody } from './HeroVoxelBody';
import { getPlayerFeetY } from './playerWorldAnchors';
import { playSharedSound } from '../../hooks/useAudio';

export type ScrapshotImpactKind = 'miss' | 'terrain' | 'player' | 'aegis';
export type ScrapshotEffectMode = 'prediction' | 'full' | 'impacts';

export interface ScrapshotEffectImpactInput {
  position: { x: number; y: number; z: number };
  kind: ScrapshotImpactKind;
}

interface ScrapshotEffectImpact {
  position: THREE.Vector3;
  kind: ScrapshotImpactKind;
}

interface Effect {
  id: string;
  type: 'grapple' | 'scrapshot' | 'blink' | 'explosion' | 'hit' | 'lifeline' | 'heal' | 'chronosSelfHealPulse' | 'chronosAegisBreak' | 'umbralDecoy';
  position: THREE.Vector3;
  direction?: THREE.Vector3;
  endPosition?: THREE.Vector3;
  scrapshotImpacts?: ScrapshotEffectImpact[];
  scrapshotMode?: ScrapshotEffectMode;
  sourceAbilityId?: string;
  sourcePlayerId?: string;
  startTime: number;
  duration: number;
  ownerTeam?: Team;
  ownerSkinId?: HeroSkinId | string | null;
  ownerIsBot?: boolean;
  decoySeed?: number;
  decoyAgeOffsetMs?: number;
}

// Global effect manager
const effects: Effect[] = [];
let effectIdCounter = 0;
const MAX_GLOBAL_EFFECTS = 96;
const EXPLOSION_PARTICLE_COUNT = 20;
const BLINK_RING_GEOMETRY = new THREE.RingGeometry(0.5, 0.7, 6);
const GLOBAL_EFFECT_BOX_SCALE = 0.2;
const GLOBAL_EFFECT_SPHERE_SCALE = 0.3;
const GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE = 0.05;
const LIFELINE_AXIS = new THREE.Vector3(0, 1, 0);
const EFFECT_FORWARD = new THREE.Vector3(0, 0, 1);
const EXPLOSION_INSTANCE_DUMMY = new THREE.Object3D();
const GRAPPLE_LINE_MATERIAL = new THREE.LineBasicMaterial({ color: '#00ff88', linewidth: 2 });
const SCRAPSHOT_INSTANCE_DUMMY = new THREE.Object3D();
const SCRAPSHOT_MUZZLE_SPARK_COUNT = 12;
const SCRAPSHOT_IMPACT_SPARKS_PER_HIT = 4;
const SCRAPSHOT_SMOKE_PUFF_COUNT = 4;
const SCRAPSHOT_VISUAL_TRAVEL_SPEED = 68;
const SCRAPSHOT_MIN_TRAVEL_SECONDS = 0.09;
const SCRAPSHOT_MAX_TRAVEL_SECONDS = 0.22;
const SCRAPSHOT_MATERIAL_POOL_PREWARM_COUNT = 8;
const GLOBAL_EFFECT_MATERIAL_POOL_LIMIT = 12;
const CHRONOS_AEGIS_BREAK_SHARD_COUNT = 14;
type GlobalEffectUpdater = (state: RootState, delta: number) => void;
const globalEffectUpdaters = createFrameUpdaterRegistry<RootState>();

type GlobalEffectMaterialKind =
  | 'blinkStart'
  | 'blinkEnd'
  | 'scrapshotCore'
  | 'scrapshotGlow'
  | 'scrapshotMuzzle'
  | 'scrapshotImpact'
  | 'scrapshotSmoke'
  | 'explosion'
  | 'hit'
  | 'lifelineGlow'
  | 'lifelineBeam'
  | 'healSphere'
  | 'healRing'
  | 'chronosSelfHealSphere'
  | 'chronosSelfHealRingGreen'
  | 'chronosSelfHealRingLight'
  | 'chronosAegisBreakFlash'
  | 'chronosAegisBreakRing'
  | 'chronosAegisBreakShard';

const GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY: Record<GlobalEffectMaterialKind, number> = {
  blinkStart: 1,
  blinkEnd: 0,
  scrapshotCore: 0.98,
  scrapshotGlow: 0.68,
  scrapshotMuzzle: 1,
  scrapshotImpact: 0.92,
  scrapshotSmoke: 0.28,
  explosion: 1,
  hit: 1,
  lifelineGlow: 0.2,
  lifelineBeam: 0.72,
  healSphere: 0.46,
  healRing: 0.62,
  chronosSelfHealSphere: 0.34,
  chronosSelfHealRingGreen: 0.72,
  chronosSelfHealRingLight: 0.72,
  chronosAegisBreakFlash: 0,
  chronosAegisBreakRing: 0,
  chronosAegisBreakShard: 0,
};
const globalEffectMaterialPools = new Map<GlobalEffectMaterialKind, THREE.MeshBasicMaterial[]>();
const SCRAPSHOT_MATERIAL_KINDS = [
  'scrapshotCore',
  'scrapshotGlow',
  'scrapshotMuzzle',
  'scrapshotImpact',
  'scrapshotSmoke',
] as const satisfies readonly GlobalEffectMaterialKind[];

function createGlobalEffectMaterial(kind: GlobalEffectMaterialKind): THREE.MeshBasicMaterial {
  switch (kind) {
    case 'blinkStart':
    case 'blinkEnd':
      return new THREE.MeshBasicMaterial({
        color: 0x9f7aea,
        transparent: true,
        opacity: GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind],
        side: THREE.DoubleSide,
      });
    case 'scrapshotCore':
      return createAdditiveBasicMaterial(0xfff7d6, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind]);
    case 'scrapshotGlow':
      return createAdditiveBasicMaterial(0xff5a00, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind]);
    case 'scrapshotMuzzle':
      return createAdditiveBasicMaterial(0xffd36a, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: THREE.DoubleSide,
      });
    case 'scrapshotImpact':
      return createAdditiveBasicMaterial(0xffffff, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: THREE.DoubleSide,
      });
    case 'scrapshotSmoke':
      return new THREE.MeshBasicMaterial({
        color: 0x3b211d,
        transparent: true,
        opacity: GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind],
        depthWrite: false,
        toneMapped: false,
      });
    case 'explosion':
      return new THREE.MeshBasicMaterial({
        color: 0xff6b35,
        transparent: true,
        opacity: GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind],
      });
    case 'hit':
      return new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind],
      });
    case 'lifelineGlow':
      return createAdditiveBasicMaterial(0x22c55e, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind]);
    case 'lifelineBeam':
      return createAdditiveBasicMaterial(0xbbf7d0, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind]);
    case 'healSphere':
    case 'chronosSelfHealSphere':
      return createAdditiveBasicMaterial(0x86efac, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: kind === 'chronosSelfHealSphere' ? THREE.DoubleSide : THREE.FrontSide,
      });
    case 'healRing':
      return createAdditiveBasicMaterial(0xbbf7d0, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: THREE.DoubleSide,
      });
    case 'chronosSelfHealRingGreen':
      return createAdditiveBasicMaterial(0x22c55e, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: THREE.DoubleSide,
      });
    case 'chronosSelfHealRingLight':
      return createAdditiveBasicMaterial(0xbbf7d0, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: THREE.DoubleSide,
      });
    case 'chronosAegisBreakFlash':
      return createAdditiveBasicMaterial(0xfef9c3, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: THREE.DoubleSide,
      });
    case 'chronosAegisBreakRing':
      return createAdditiveBasicMaterial(0xfacc15, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind], {
        side: THREE.DoubleSide,
      });
    case 'chronosAegisBreakShard':
      return createAdditiveBasicMaterial(0x86efac, GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind]);
  }
}

function createAdditiveBasicMaterial(
  color: number,
  opacity: number,
  options: { side?: THREE.Side } = {}
): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  if (options.side !== undefined) material.side = options.side;
  return material;
}

function acquireGlobalEffectMaterial(kind: GlobalEffectMaterialKind): THREE.MeshBasicMaterial {
  const pool = globalEffectMaterialPools.get(kind);
  const material = pool?.pop() ?? createGlobalEffectMaterial(kind);
  material.opacity = GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind];
  material.visible = true;
  return material;
}

function releaseGlobalEffectMaterial(kind: GlobalEffectMaterialKind, material: THREE.MeshBasicMaterial): void {
  material.opacity = GLOBAL_EFFECT_MATERIAL_INITIAL_OPACITY[kind];
  material.visible = true;
  let pool = globalEffectMaterialPools.get(kind);
  if (!pool) {
    pool = [];
    globalEffectMaterialPools.set(kind, pool);
  }
  if (pool.length >= GLOBAL_EFFECT_MATERIAL_POOL_LIMIT) {
    material.dispose();
    return;
  }
  pool.push(material);
}

function useGlobalEffectMaterial(kind: GlobalEffectMaterialKind): THREE.MeshBasicMaterial;
function useGlobalEffectMaterial(kind: GlobalEffectMaterialKind, enabled: boolean): THREE.MeshBasicMaterial | null;
function useGlobalEffectMaterial(
  kind: GlobalEffectMaterialKind,
  enabled = true,
): THREE.MeshBasicMaterial | null {
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  if (enabled && !materialRef.current) {
    materialRef.current = acquireGlobalEffectMaterial(kind);
  }
  useEffect(() => {
    if (enabled && !materialRef.current) {
      materialRef.current = acquireGlobalEffectMaterial(kind);
    } else if (!enabled && materialRef.current) {
      releaseGlobalEffectMaterial(kind, materialRef.current);
      materialRef.current = null;
    }

    return () => {
      const material = materialRef.current;
      if (!material) return;
      materialRef.current = null;
      releaseGlobalEffectMaterial(kind, material);
    };
  }, [enabled, kind]);
  return materialRef.current;
}

export function prewarmScrapshotResources(): void {
  for (const kind of SCRAPSHOT_MATERIAL_KINDS) {
    let pool = globalEffectMaterialPools.get(kind);
    if (!pool) {
      pool = [];
      globalEffectMaterialPools.set(kind, pool);
    }
    while (pool.length < SCRAPSHOT_MATERIAL_POOL_PREWARM_COUNT) {
      pool.push(createGlobalEffectMaterial(kind));
    }
  }
}

function appendScrapshotPrewarmMesh(
  target: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  index: number,
  instanceCount: number,
): void {
  const x = -2.3 + (index % 8) * 0.32;
  const y = -0.95 + Math.floor(index / 8) * 0.32;
  if (instanceCount > 0) {
    const mesh = new THREE.InstancedMesh(geometry, material, instanceCount);
    SCRAPSHOT_INSTANCE_DUMMY.position.set(x, y, -4.35);
    SCRAPSHOT_INSTANCE_DUMMY.quaternion.identity();
    SCRAPSHOT_INSTANCE_DUMMY.scale.setScalar(0.12);
    SCRAPSHOT_INSTANCE_DUMMY.updateMatrix();
    for (let instanceIndex = 0; instanceIndex < instanceCount; instanceIndex++) {
      mesh.setMatrixAt(instanceIndex, SCRAPSHOT_INSTANCE_DUMMY.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = 'gpu-prewarm-scrapshot-instanced';
    target.add(mesh);
    return;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, -4.35);
  mesh.scale.setScalar(0.12);
  mesh.frustumCulled = false;
  mesh.name = 'gpu-prewarm-scrapshot-mesh';
  target.add(mesh);
}

export function appendScrapshotGpuPrewarmObjects(target: THREE.Object3D): void {
  const core = createGlobalEffectMaterial('scrapshotCore');
  const glow = createGlobalEffectMaterial('scrapshotGlow');
  const muzzle = createGlobalEffectMaterial('scrapshotMuzzle');
  const impact = createGlobalEffectMaterial('scrapshotImpact');
  const smoke = createGlobalEffectMaterial('scrapshotSmoke');
  const objects: Array<[THREE.BufferGeometry, THREE.Material, number]> = [
    [SHARED_GEOMETRIES.cylinder8, glow, 6],
    [SHARED_GEOMETRIES.cylinder8, core, 6],
    [SHARED_GEOMETRIES.sphere8, core, 6],
    [SHARED_GEOMETRIES.sphere8, muzzle, 0],
    [SHARED_GEOMETRIES.cone8, muzzle, 0],
    [SHARED_GEOMETRIES.ring16, muzzle, 0],
    [SHARED_GEOMETRIES.ring8, muzzle, 0],
    [SHARED_GEOMETRIES.box, muzzle, SCRAPSHOT_MUZZLE_SPARK_COUNT],
    [SHARED_GEOMETRIES.sphere8, smoke, SCRAPSHOT_SMOKE_PUFF_COUNT],
    [SHARED_GEOMETRIES.sphere8, impact, 6],
    [SHARED_GEOMETRIES.ring16, impact, 6],
    [SHARED_GEOMETRIES.box, impact, 6 * SCRAPSHOT_IMPACT_SPARKS_PER_HIT],
  ];
  objects.forEach(([geometry, material, instanceCount], index) => {
    appendScrapshotPrewarmMesh(target, geometry, material, index, instanceCount);
  });
}

interface ChronosAegisBreakShard {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  spin: number;
  rotation: number;
}

function hashEffectId(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeededUnit(seed: number): [number, number] {
  const nextSeed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return [nextSeed / 0xffffffff, nextSeed];
}

function createExplosionDirections(effectId: string): Float32Array {
  const directions = new Float32Array(EXPLOSION_PARTICLE_COUNT * 3);
  let seed = hashEffectId(effectId);

  for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
    let rx: number;
    let ry: number;
    let rz: number;
    [rx, seed] = nextSeededUnit(seed);
    [ry, seed] = nextSeededUnit(seed);
    [rz, seed] = nextSeededUnit(seed);

    const x = rx * 2 - 1;
    const y = ry;
    const z = rz * 2 - 1;
    const invLength = 1 / Math.max(0.0001, Math.hypot(x, y, z));
    const offset = i * 3;
    directions[offset] = x * invLength;
    directions[offset + 1] = y * invLength;
    directions[offset + 2] = z * invLength;
  }

  return directions;
}

function createChronosAegisBreakShards(effectId: string): ChronosAegisBreakShard[] {
  let seed = hashEffectId(`${effectId}:aegis_break`);
  return Array.from({ length: CHRONOS_AEGIS_BREAK_SHARD_COUNT }, (_, index) => {
    let unit: number;
    [unit, seed] = nextSeededUnit(seed);
    const angle = unit * Math.PI * 2;
    [unit, seed] = nextSeededUnit(seed);
    const radius = 0.55 + unit * 2.35;
    [unit, seed] = nextSeededUnit(seed);
    const z = 0.24 + unit * 0.95;
    [unit, seed] = nextSeededUnit(seed);
    const width = 0.018 + unit * 0.022;
    [unit, seed] = nextSeededUnit(seed);
    const height = 0.34 + unit * 0.82;
    [unit, seed] = nextSeededUnit(seed);
    const spin = (unit * 2 - 1) * (2.8 + index * 0.07);
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * 0.58,
      z,
      width,
      height,
      spin,
      rotation: angle + Math.PI * 0.5,
    };
  });
}

function writeGrappleLinePositions(target: Float32Array, effect: Effect): void {
  const end = effect.endPosition ?? effect.position;
  target[0] = effect.position.x;
  target[1] = effect.position.y;
  target[2] = effect.position.z;
  target[3] = end.x;
  target[4] = end.y;
  target[5] = end.z;
}

function useGlobalEffectUpdater(effectId: string, updater: GlobalEffectUpdater): void {
  const updaterRef = useRef(updater);
  updaterRef.current = updater;

  useEffect(() => {
    const registeredUpdater: GlobalEffectUpdater = (state, delta) => updaterRef.current(state, delta);
    return globalEffectUpdaters.register(effectId, registeredUpdater);
  }, [effectId]);
}

export interface GlobalEffectStats {
  active: number;
  capacity: number;
  pressure: number;
}

function isEffectAlive(effect: Effect, now: number): boolean {
  return now - effect.startTime < effect.duration;
}

function compactExpiredEffects(now: number): boolean {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < effects.length; readIndex++) {
    const effect = effects[readIndex];
    if (!isEffectAlive(effect, now)) continue;
    effects[writeIndex++] = effect;
  }
  if (writeIndex === effects.length) return false;
  effects.length = writeIndex;
  return true;
}

function isCriticalEffect(effect: Effect): boolean {
  return (
    effect.type === 'lifeline' ||
    effect.type === 'heal' ||
    effect.type === 'chronosSelfHealPulse' ||
    effect.type === 'chronosAegisBreak'
  );
}

function dropOldestNonCriticalEffect(): void {
  let dropIndex = 0;
  for (let index = 0; index < effects.length; index++) {
    const effect = effects[index];
    if (!isCriticalEffect(effect)) {
      dropIndex = index;
      break;
    }
  }
  for (let index = dropIndex + 1; index < effects.length; index++) {
    effects[index - 1] = effects[index];
  }
  effects.length = Math.max(0, effects.length - 1);
}

function dropOldestNonCriticalEffects(dropCount: number): void {
  let remainingDrops = Math.min(dropCount, effects.length);
  if (remainingDrops <= 0) return;
  if (remainingDrops === 1) {
    dropOldestNonCriticalEffect();
    return;
  }

  let writeIndex = 0;
  for (let readIndex = 0; readIndex < effects.length; readIndex++) {
    const effect = effects[readIndex];
    if (remainingDrops > 0 && !isCriticalEffect(effect)) {
      remainingDrops--;
      continue;
    }
    effects[writeIndex++] = effect;
  }

  if (remainingDrops > 0) {
    for (let index = remainingDrops; index < writeIndex; index++) {
      effects[index - remainingDrops] = effects[index];
    }
    writeIndex = Math.max(0, writeIndex - remainingDrops);
  }

  effects.length = writeIndex;
}

export function addEffect(effect: Omit<Effect, 'id' | 'startTime'>) {
  const now = Date.now();
  compactExpiredEffects(now);
  if (effects.length >= MAX_GLOBAL_EFFECTS) {
    dropOldestNonCriticalEffect();
  }
  effects.push({
    ...effect,
    id: `effect_${effectIdCounter++}`,
    startTime: now,
  });
}

export function addUmbralDecoyEffect(input: {
  position: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  durationMs: number;
  ownerTeam: Team;
  ownerSkinId?: HeroSkinId | string | null;
  ownerIsBot?: boolean;
  castId: string;
  ageOffsetMs?: number;
}): void {
  addEffect({
    type: 'umbralDecoy',
    position: new THREE.Vector3(input.position.x, input.position.y, input.position.z),
    direction: new THREE.Vector3(input.direction.x, 0, input.direction.z),
    duration: input.durationMs,
    ownerTeam: input.ownerTeam,
    ownerSkinId: input.ownerSkinId,
    ownerIsBot: input.ownerIsBot,
    decoySeed: getPhantomUmbralDecoySeed(input.castId),
    decoyAgeOffsetMs: input.ageOffsetMs,
  });
}

export function addEffects(newEffects: readonly Omit<Effect, 'id' | 'startTime'>[]): void {
  if (newEffects.length === 0) return;

  const now = Date.now();
  compactExpiredEffects(now);
  const overflowCount = effects.length + newEffects.length - MAX_GLOBAL_EFFECTS;
  if (overflowCount > 0) {
    dropOldestNonCriticalEffects(overflowCount);
  }
  for (const effect of newEffects) {
    if (effects.length >= MAX_GLOBAL_EFFECTS) {
      dropOldestNonCriticalEffect();
    }
    effects.push({
      ...effect,
      id: `effect_${effectIdCounter++}`,
      startTime: now,
    });
  }
}

export function addScrapshotEffects(
  startPosition: { x: number; y: number; z: number },
  impacts: readonly ScrapshotEffectImpactInput[],
  mode: ScrapshotEffectMode = 'full',
): void {
  if (impacts.length === 0) return;

  addEffect({
    type: 'scrapshot',
    position: new THREE.Vector3(startPosition.x, startPosition.y, startPosition.z),
    scrapshotImpacts: impacts.map((impact) => ({
      position: new THREE.Vector3(impact.position.x, impact.position.y, impact.position.z),
      kind: impact.kind,
    })),
    scrapshotMode: mode,
    duration: mode === 'impacts' ? 340 : 430,
  });
}

export function getGlobalEffectStats(now = Date.now()): GlobalEffectStats {
  compactExpiredEffects(now);
  return {
    active: effects.length,
    capacity: MAX_GLOBAL_EFFECTS,
    pressure: effects.length / MAX_GLOBAL_EFFECTS,
  };
}

function runGlobalEffectsFrame(
  state: RootState,
  delta: number,
  activeEffectsRef: MutableRefObject<Effect[]>,
  lastEffectCountRef: MutableRefObject<number>,
  lastCleanupRef: MutableRefObject<number>,
  commitEffectCount: (effectCount: number) => void
): void {
  const now = getFrameClock().epochNowMs;

  // Only clean up every 100ms to avoid excessive processing
  if (now - lastCleanupRef.current >= 100) {
    lastCleanupRef.current = now;
    compactExpiredEffects(now);
  }

  activeEffectsRef.current = effects;
  // Additions need to mount on the next rendered frame; only expiration cleanup
  // remains throttled. Gating this check behind cleanup made short casts appear
  // up to 100ms late and consumed most of their visible lifetime.
  if (effects.length !== lastEffectCountRef.current) {
    lastEffectCountRef.current = effects.length;
    commitEffectCount(effects.length);
  }

  globalEffectUpdaters.run(state, delta);

  if (MOVEMENT_DIAGNOSTICS_ENABLED) {
    recordEffectSlotDiagnostics('globalEffects', {
      active: effects.length,
      capacity: MAX_GLOBAL_EFFECTS,
      hiddenMounted: Math.max(0, MAX_GLOBAL_EFFECTS - effects.length),
    });
  }
}

export function Effects() {
  // Use ref for active effects to avoid setState in useFrame (prevents 60fps re-renders)
  const activeEffectsRef = useRef<Effect[]>([]);

  // Version counter to trigger re-renders when effects change (incremented only when count changes)
  const [, setEffectsVersion] = useState(0);
  const deferEffectCountCommit = useDeferredFrameCommit(setEffectsVersion);

  const lastEffectCountRef = useRef(0);
  const lastCleanupRef = useRef(0);

  useFrame((state, delta) => {
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.effects.global', () => (
        runGlobalEffectsFrame(state, delta, activeEffectsRef, lastEffectCountRef, lastCleanupRef, deferEffectCountCommit)
      ));
    } else {
      runGlobalEffectsFrame(state, delta, activeEffectsRef, lastEffectCountRef, lastCleanupRef, deferEffectCountCommit);
    }
  });

  return (
    <group>
      {activeEffectsRef.current.map(effect => {
        switch (effect.type) {
          case 'grapple':
            return <GrappleLine key={effect.id} effect={effect} />;
          case 'scrapshot':
            return <ScrapshotBlastEffect key={effect.id} effect={effect} />;
          case 'blink':
            return <BlinkEffect key={effect.id} effect={effect} />;
          case 'explosion':
            return <ExplosionEffect key={effect.id} effect={effect} />;
          case 'hit':
            return <HitEffect key={effect.id} effect={effect} />;
          case 'lifeline':
            return <LifelineBeamEffect key={effect.id} effect={effect} />;
          case 'heal':
            return <HealPulseEffect key={effect.id} effect={effect} />;
          case 'chronosSelfHealPulse':
            return <ChronosSelfHealPulseEffect key={effect.id} effect={effect} />;
          case 'chronosAegisBreak':
            return <ChronosAegisBreakEffect key={effect.id} effect={effect} />;
          case 'umbralDecoy':
            return <UmbralDecoyEffect key={effect.id} effect={effect} />;
          default:
            return null;
        }
      })}
    </group>
  );
}

interface EffectProps {
  effect: Effect;
}

function UmbralDecoyEffect({ effect }: EffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyOpacityRef = useRef(1);
  const isAttackingRef = useRef(false);
  const attackStartedAtMsRef = useRef<number | null>(null);
  const attackSideRef = useRef<-1 | 1>(1);
  const shieldRef = useRef<THREE.Mesh>(null);
  const blinkStartRef = useRef<THREE.Mesh>(null);
  const blinkEndRef = useRef<THREE.Mesh>(null);
  const projectileRefs = useRef<Array<THREE.Mesh | null>>([]);
  const playedCastSoundsRef = useRef([false, false, false, false]);
  const direction = useMemo(() => {
    const horizontal = (effect.direction ?? new THREE.Vector3(0, 0, -1)).clone();
    horizontal.y = 0;
    return horizontal.lengthSq() > 0.0001 ? horizontal.normalize() : new THREE.Vector3(0, 0, -1);
  }, [effect.direction]);
  const seed = effect.decoySeed ?? 0;
  const schedule = useMemo(() => getPhantomUmbralDecoyCastSchedule(seed), [seed]);
  const shieldMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x8b5cf6,
    transparent: true,
    opacity: 0,
    wireframe: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), []);
  const blinkMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0xa78bfa,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), []);
  const projectileMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: 0x9f7aea,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  }), []);

  useEffect(() => () => {
    shieldMaterial.dispose();
    blinkMaterial.dispose();
    projectileMaterial.dispose();
  }, [blinkMaterial, projectileMaterial, shieldMaterial]);

  useGlobalEffectUpdater(effect.id, () => {
    const group = groupRef.current;
    if (!group) return;
    const elapsedMs = Math.max(
      0,
      getFrameClock().epochNowMs - effect.startTime + (effect.decoyAgeOffsetMs ?? 0),
    );
    const motion = getPhantomUmbralDecoyMotion(
      effect.position,
      direction,
      Math.min(effect.duration, elapsedMs),
      seed,
    );
    group.position.set(motion.position.x, getPlayerFeetY(motion.position.y), motion.position.z);
    group.rotation.y = motion.yaw;
    const fadeStartMs = Math.max(0, effect.duration - 450);
    bodyOpacityRef.current = elapsedMs <= fadeStartMs
      ? 1
      : Math.max(0, 1 - (elapsedMs - fadeStartMs) / Math.max(1, effect.duration - fadeStartMs));

    const activePrimaryIndex = schedule.primaryCastTimesMs.findIndex((castTime) => (
      elapsedMs >= castTime && elapsedMs < castTime + 260
    ));
    isAttackingRef.current = activePrimaryIndex >= 0;
    attackStartedAtMsRef.current = activePrimaryIndex >= 0
      ? effect.startTime + schedule.primaryCastTimesMs[activePrimaryIndex]
      : null;
    attackSideRef.current = activePrimaryIndex === 1 ? -1 : 1;

    const shieldAge = elapsedMs - schedule.shieldCastTimeMs;
    if (shieldRef.current) {
      shieldRef.current.visible = shieldAge >= 0 && shieldAge < 620;
      shieldRef.current.scale.setScalar(0.65 + THREE.MathUtils.smoothstep(shieldAge, 0, 300) * 0.55);
      shieldMaterial.opacity = shieldRef.current.visible
        ? 0.3 * (1 - THREE.MathUtils.smoothstep(shieldAge, 360, 620))
        : 0;
    }

    const blinkAge = elapsedMs - schedule.blinkCastTimeMs;
    const blinkVisible = blinkAge >= -90 && blinkAge < 420;
    const blinkBefore = getPhantomUmbralDecoyMotion(effect.position, direction, Math.max(0, schedule.blinkCastTimeMs - 1), seed);
    const blinkAfter = getPhantomUmbralDecoyMotion(effect.position, direction, schedule.blinkCastTimeMs + 1, seed);
    for (const [mesh, blinkMotion] of [
      [blinkStartRef.current, blinkBefore],
      [blinkEndRef.current, blinkAfter],
    ] as const) {
      if (!mesh) continue;
      mesh.visible = blinkVisible;
      mesh.position.set(blinkMotion.position.x, getPlayerFeetY(blinkMotion.position.y) + 0.06, blinkMotion.position.z);
      mesh.scale.setScalar(1 + Math.max(0, blinkAge) / 260);
    }
    blinkMaterial.opacity = blinkVisible
      ? 0.78 * (1 - THREE.MathUtils.smoothstep(blinkAge, 100, 420))
      : 0;

    schedule.primaryCastTimesMs.forEach((castTime, index) => {
      const projectile = projectileRefs.current[index];
      if (!projectile) return;
      const projectileAge = elapsedMs - castTime;
      projectile.visible = projectileAge >= 0 && projectileAge < 720;
      if (!projectile.visible) return;
      const castMotion = getPhantomUmbralDecoyMotion(effect.position, direction, castTime, seed);
      const castForwardX = -Math.sin(castMotion.yaw);
      const castForwardZ = -Math.cos(castMotion.yaw);
      const travel = projectileAge / 1000 * 20;
      projectile.position.set(
        castMotion.position.x + castForwardX * travel,
        castMotion.position.y + 0.95,
        castMotion.position.z + castForwardZ * travel,
      );
      const projectileFade = 1 - THREE.MathUtils.smoothstep(projectileAge, 540, 720);
      projectile.scale.setScalar((0.18 + Math.sin(projectileAge * 0.025) * 0.025) * projectileFade);
    });

    const soundSchedule = [
      schedule.primaryCastTimesMs[0],
      schedule.shieldCastTimeMs,
      schedule.blinkCastTimeMs,
      schedule.primaryCastTimesMs[1],
    ];
    soundSchedule.forEach((castTime, index) => {
      if (playedCastSoundsRef.current[index] || elapsedMs < castTime) return;
      playedCastSoundsRef.current[index] = true;
      const soundMotion = getPhantomUmbralDecoyMotion(effect.position, direction, castTime, seed);
      const position = soundMotion.position;
      const soundId = index === 1 ? 'phantomShieldCast' : index === 2 ? 'phantomBlink' : 'phantomBasic';
      void playSharedSound(soundId, { position, volume: index === 1 ? 0.72 : 0.62 });
    });
  });

  return (
    <>
      <group
        ref={groupRef}
        position={[effect.position.x, getPlayerFeetY(effect.position.y), effect.position.z]}
      >
        <HeroVoxelBody
          heroId="phantom"
          skinId={effect.ownerSkinId}
          team={effect.ownerTeam ?? 'red'}
          height={1.8}
          isBot={effect.ownerIsBot}
          isMoving
          isAttackingRef={isAttackingRef}
          attackStartedAtMsRef={attackStartedAtMsRef}
          attackSideRef={attackSideRef}
          movementPose="run"
          bodyOpacity={1}
          bodyOpacityRef={bodyOpacityRef}
          castShadow
          showTeamAccents
        />
        <mesh
          ref={shieldRef}
          geometry={SHARED_GEOMETRIES.sphere16}
          material={shieldMaterial}
          position={[0, 0.9, 0]}
          visible={false}
        />
      </group>
      <mesh
        ref={blinkStartRef}
        geometry={SHARED_GEOMETRIES.ring24}
        material={blinkMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      />
      <mesh
        ref={blinkEndRef}
        geometry={SHARED_GEOMETRIES.ring24}
        material={blinkMaterial}
        rotation={[-Math.PI / 2, 0, 0]}
        visible={false}
      />
      {schedule.primaryCastTimesMs.map((castTime, index) => (
        <mesh
          key={castTime}
          ref={(node) => {
            projectileRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.sphere12}
          material={projectileMaterial}
          visible={false}
        />
      ))}
    </>
  );
}

function GrappleLine({ effect }: EffectProps) {
  const positions = useMemo(() => {
    const initialPositions = new Float32Array(6);
    writeGrappleLinePositions(initialPositions, effect);
    return initialPositions;
  }, [effect]);
  const geometry = useMemo(() => {
    const bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return bufferGeometry;
  }, [positions]);
  const lineObject = useMemo(() => {
    const line = new THREE.Line(geometry, GRAPPLE_LINE_MATERIAL);
    line.frustumCulled = false;
    return line;
  }, [geometry]);

  useGlobalEffectUpdater(effect.id, () => {
    writeGrappleLinePositions(positions, effect);
    const positionAttribute = geometry.getAttribute('position') as THREE.BufferAttribute;
    positionAttribute.needsUpdate = true;
  });

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <primitive object={lineObject} />
  );
}

interface ScrapshotPelletVisual {
  end: THREE.Vector3;
  direction: THREE.Vector3;
  tracerQuaternion: THREE.Quaternion;
  impactQuaternion: THREE.Quaternion;
  length: number;
  travelSeconds: number;
  kind: ScrapshotImpactKind;
}

interface ScrapshotSparkVisual {
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  quaternion: THREE.Quaternion;
  speed: number;
  scale: number;
  delay: number;
  color: number;
}

interface ScrapshotSmokeVisual {
  direction: THREE.Vector3;
  speed: number;
  scale: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getScrapshotImpactColor(kind: ScrapshotImpactKind): number {
  switch (kind) {
    case 'player':
      return 0xfff4bd;
    case 'aegis':
      return 0xa7f3d0;
    case 'terrain':
      return 0xff7a00;
    case 'miss':
      return 0xffb347;
  }
}

function createScrapshotPelletVisuals(effect: Effect): ScrapshotPelletVisual[] {
  const impacts = effect.scrapshotImpacts ?? [];
  const visuals: ScrapshotPelletVisual[] = [];

  for (const impact of impacts) {
    const direction = impact.position.clone().sub(effect.position);
    const length = direction.length();
    if (length <= 0.001) continue;
    direction.multiplyScalar(1 / length);
    visuals.push({
      end: impact.position,
      direction,
      tracerQuaternion: new THREE.Quaternion().setFromUnitVectors(LIFELINE_AXIS, direction),
      impactQuaternion: new THREE.Quaternion().setFromUnitVectors(EFFECT_FORWARD, direction),
      length,
      travelSeconds: Math.max(
        SCRAPSHOT_MIN_TRAVEL_SECONDS,
        Math.min(SCRAPSHOT_MAX_TRAVEL_SECONDS, length / SCRAPSHOT_VISUAL_TRAVEL_SPEED),
      ),
      kind: impact.kind,
    });
  }

  return visuals;
}

function createScrapshotMuzzleSparks(
  effect: Effect,
  pellets: readonly ScrapshotPelletVisual[],
): ScrapshotSparkVisual[] {
  if (pellets.length === 0) return [];

  const sparks: ScrapshotSparkVisual[] = [];
  let seed = hashEffectId(`${effect.id}:scrapshot_muzzle`);
  for (let index = 0; index < SCRAPSHOT_MUZZLE_SPARK_COUNT; index++) {
    const pellet = pellets[index % pellets.length];
    const reference = Math.abs(pellet.direction.y) < 0.92
      ? LIFELINE_AXIS
      : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(pellet.direction, reference).normalize();
    const up = new THREE.Vector3().crossVectors(right, pellet.direction).normalize();
    let random: number;
    [random, seed] = nextSeededUnit(seed);
    const horizontalJitter = (random * 2 - 1) * 0.24;
    [random, seed] = nextSeededUnit(seed);
    const verticalJitter = (random * 2 - 1) * 0.2;
    const direction = pellet.direction.clone()
      .addScaledVector(right, horizontalJitter)
      .addScaledVector(up, verticalJitter)
      .normalize();
    [random, seed] = nextSeededUnit(seed);
    const speed = 6.5 + random * 6.5;
    [random, seed] = nextSeededUnit(seed);
    const scale = 0.035 + random * 0.045;

    sparks.push({
      origin: effect.position,
      direction,
      quaternion: new THREE.Quaternion().setFromUnitVectors(LIFELINE_AXIS, direction),
      speed,
      scale,
      delay: index * 0.0015,
      color: 0xffd36a,
    });
  }
  return sparks;
}

function createScrapshotImpactSparks(
  effect: Effect,
  pellets: readonly ScrapshotPelletVisual[],
  immediate: boolean,
): ScrapshotSparkVisual[] {
  const sparks: ScrapshotSparkVisual[] = [];
  let seed = hashEffectId(`${effect.id}:scrapshot_impacts`);

  for (const pellet of pellets) {
    if (pellet.kind === 'miss') continue;
    const reference = Math.abs(pellet.direction.y) < 0.92
      ? LIFELINE_AXIS
      : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(pellet.direction, reference).normalize();
    const up = new THREE.Vector3().crossVectors(right, pellet.direction).normalize();

    for (let index = 0; index < SCRAPSHOT_IMPACT_SPARKS_PER_HIT; index++) {
      let random: number;
      [random, seed] = nextSeededUnit(seed);
      const angle = (index / SCRAPSHOT_IMPACT_SPARKS_PER_HIT) * Math.PI * 2 + random * 0.7;
      const direction = pellet.direction.clone().multiplyScalar(-0.38)
        .addScaledVector(right, Math.cos(angle))
        .addScaledVector(up, Math.sin(angle) * 0.82 + 0.24)
        .normalize();
      [random, seed] = nextSeededUnit(seed);
      const speed = 2.8 + random * 4.2;
      [random, seed] = nextSeededUnit(seed);
      const scale = 0.026 + random * 0.028;

      sparks.push({
        origin: pellet.end,
        direction,
        quaternion: new THREE.Quaternion().setFromUnitVectors(LIFELINE_AXIS, direction),
        speed,
        scale,
        delay: immediate ? 0 : pellet.travelSeconds,
        color: getScrapshotImpactColor(pellet.kind),
      });
    }
  }
  return sparks;
}

function createScrapshotSmoke(
  effect: Effect,
  forward: THREE.Vector3,
): ScrapshotSmokeVisual[] {
  const reference = Math.abs(forward.y) < 0.92 ? LIFELINE_AXIS : new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3().crossVectors(forward, reference).normalize();
  let seed = hashEffectId(`${effect.id}:scrapshot_smoke`);

  return Array.from({ length: SCRAPSHOT_SMOKE_PUFF_COUNT }, (_, index) => {
    let random: number;
    [random, seed] = nextSeededUnit(seed);
    const sideways = (random * 2 - 1) * 0.55;
    [random, seed] = nextSeededUnit(seed);
    const upward = 0.5 + random * 0.48;
    [random, seed] = nextSeededUnit(seed);
    const speed = 0.55 + random * 0.65;
    [random, seed] = nextSeededUnit(seed);
    const scale = 0.16 + random * 0.11 + index * 0.018;
    return {
      direction: forward.clone().multiplyScalar(-0.2)
        .addScaledVector(right, sideways)
        .addScaledVector(LIFELINE_AXIS, upward)
        .normalize(),
      speed,
      scale,
    };
  });
}

function writeScrapshotInstance(
  mesh: THREE.InstancedMesh | null,
  index: number,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
  scaleX: number,
  scaleY: number,
  scaleZ: number,
): void {
  if (!mesh) return;
  SCRAPSHOT_INSTANCE_DUMMY.position.copy(position);
  SCRAPSHOT_INSTANCE_DUMMY.quaternion.copy(quaternion);
  SCRAPSHOT_INSTANCE_DUMMY.scale.set(scaleX, scaleY, scaleZ);
  SCRAPSHOT_INSTANCE_DUMMY.updateMatrix();
  mesh.setMatrixAt(index, SCRAPSHOT_INSTANCE_DUMMY.matrix);
}

function commitScrapshotInstances(mesh: THREE.InstancedMesh | null): void {
  if (mesh) mesh.instanceMatrix.needsUpdate = true;
}

function hideScrapshotInstances(mesh: THREE.InstancedMesh | null, position: THREE.Vector3): void {
  if (!mesh) return;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  SCRAPSHOT_INSTANCE_DUMMY.position.copy(position);
  SCRAPSHOT_INSTANCE_DUMMY.quaternion.identity();
  SCRAPSHOT_INSTANCE_DUMMY.scale.setScalar(0.001);
  SCRAPSHOT_INSTANCE_DUMMY.updateMatrix();
  for (let index = 0; index < mesh.count; index++) {
    mesh.setMatrixAt(index, SCRAPSHOT_INSTANCE_DUMMY.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function ScrapshotBlastEffect({ effect }: EffectProps) {
  const elapsedSeconds = useRef(0);
  const tracerGlowRef = useRef<THREE.InstancedMesh>(null);
  const tracerCoreRef = useRef<THREE.InstancedMesh>(null);
  const pelletHeadRef = useRef<THREE.InstancedMesh>(null);
  const muzzleSparkRef = useRef<THREE.InstancedMesh>(null);
  const smokeRef = useRef<THREE.InstancedMesh>(null);
  const impactFlareRef = useRef<THREE.InstancedMesh>(null);
  const impactRingRef = useRef<THREE.InstancedMesh>(null);
  const impactSparkRef = useRef<THREE.InstancedMesh>(null);
  const muzzleCoreRef = useRef<THREE.Mesh>(null);
  const muzzleGlowRef = useRef<THREE.Mesh>(null);
  const muzzleConeRef = useRef<THREE.Mesh>(null);
  const muzzleRingARef = useRef<THREE.Mesh>(null);
  const muzzleRingBRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const mode = effect.scrapshotMode ?? 'full';
  const showMuzzle = mode !== 'impacts';
  const showTrails = mode !== 'impacts';
  const compactMuzzle = mode === 'prediction';
  const muzzleFlashDuration = compactMuzzle ? 0.075 : 0.11;
  const muzzleOpacity = compactMuzzle ? 0.38 : 0.62;
  const muzzleLightIntensity = compactMuzzle ? 2.2 : 5.5;
  const muzzleLightDistance = compactMuzzle ? 2.8 : 4.5;
  const pelletVisuals = useMemo(() => createScrapshotPelletVisuals(effect), [effect]);
  const impactVisuals = useMemo(
    () => pelletVisuals.filter((pellet) => pellet.kind !== 'miss'),
    [pelletVisuals],
  );
  const forward = useMemo(() => {
    const average = new THREE.Vector3();
    pelletVisuals.forEach((pellet) => average.add(pellet.direction));
    return average.lengthSq() > 0.0001 ? average.normalize() : EFFECT_FORWARD.clone();
  }, [pelletVisuals]);
  const muzzleQuaternion = useMemo(
    () => new THREE.Quaternion().setFromUnitVectors(EFFECT_FORWARD, forward),
    [forward],
  );
  const muzzleSparks = useMemo(
    () => showMuzzle ? createScrapshotMuzzleSparks(effect, pelletVisuals) : [],
    [effect, pelletVisuals, showMuzzle],
  );
  const impactSparks = useMemo(
    () => createScrapshotImpactSparks(effect, pelletVisuals, mode === 'impacts'),
    [effect, mode, pelletVisuals],
  );
  const smoke = useMemo(
    () => showMuzzle ? createScrapshotSmoke(effect, forward) : [],
    [effect, forward, showMuzzle],
  );
  const showImpacts = impactVisuals.length > 0;
  const tracerCoreMaterial = useGlobalEffectMaterial('scrapshotCore', showTrails);
  const tracerGlowMaterial = useGlobalEffectMaterial('scrapshotGlow', showTrails);
  const muzzleMaterial = useGlobalEffectMaterial('scrapshotMuzzle', showMuzzle);
  const impactMaterial = useGlobalEffectMaterial('scrapshotImpact', showImpacts);
  const smokeMaterial = useGlobalEffectMaterial('scrapshotSmoke', showMuzzle);

  useLayoutEffect(() => {
    const dynamicMeshes = [
      tracerGlowRef.current,
      tracerCoreRef.current,
      pelletHeadRef.current,
      muzzleSparkRef.current,
      smokeRef.current,
      impactFlareRef.current,
      impactRingRef.current,
      impactSparkRef.current,
    ];
    dynamicMeshes.forEach((mesh) => hideScrapshotInstances(mesh, effect.position));
    muzzleCoreRef.current?.scale.setScalar(0.001);
    muzzleGlowRef.current?.scale.setScalar(0.001);
    muzzleConeRef.current?.scale.setScalar(0.001);
    muzzleRingARef.current?.scale.setScalar(0.001);
    muzzleRingBRef.current?.scale.setScalar(0.001);

    impactVisuals.forEach((pellet, index) => {
      const color = new THREE.Color(getScrapshotImpactColor(pellet.kind));
      impactFlareRef.current?.setColorAt(index, color);
      impactRingRef.current?.setColorAt(index, color);
    });
    impactSparks.forEach((spark, index) => {
      impactSparkRef.current?.setColorAt(index, new THREE.Color(spark.color));
    });
    if (impactFlareRef.current?.instanceColor) impactFlareRef.current.instanceColor.needsUpdate = true;
    if (impactRingRef.current?.instanceColor) impactRingRef.current.instanceColor.needsUpdate = true;
    if (impactSparkRef.current?.instanceColor) impactSparkRef.current.instanceColor.needsUpdate = true;
  }, [effect.position, impactSparks, impactVisuals]);

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    elapsedSeconds.current += delta;
    const elapsed = elapsedSeconds.current;
    const flashT = clamp01(elapsed / muzzleFlashDuration);
    const flashFade = 1 - flashT;
    const trailEnvelope = 1 - clamp01((elapsed - 0.08) / 0.22);

    if (showTrails && tracerCoreMaterial && tracerGlowMaterial) {
      pelletVisuals.forEach((pellet, index) => {
        const travelT = clamp01(elapsed / pellet.travelSeconds);
        const headDistance = pellet.length * travelT;
        const arrivalFade = 1 - clamp01((elapsed - pellet.travelSeconds) / 0.12);
        const visibleTailLength = Math.max(0.001, Math.min(headDistance, 2.7 + index * 0.14));
        const tailCenterDistance = Math.max(0, headDistance - visibleTailLength * 0.5);
        const radiusFade = Math.max(0.001, arrivalFade * trailEnvelope);

        SCRAPSHOT_INSTANCE_DUMMY.position.copy(effect.position)
          .addScaledVector(pellet.direction, tailCenterDistance);
        writeScrapshotInstance(
          tracerGlowRef.current,
          index,
          SCRAPSHOT_INSTANCE_DUMMY.position,
          pellet.tracerQuaternion,
          0.17 * radiusFade,
          visibleTailLength,
          0.17 * radiusFade,
        );
        writeScrapshotInstance(
          tracerCoreRef.current,
          index,
          SCRAPSHOT_INSTANCE_DUMMY.position,
          pellet.tracerQuaternion,
          0.052 * radiusFade,
          visibleTailLength,
          0.052 * radiusFade,
        );

        SCRAPSHOT_INSTANCE_DUMMY.position.copy(effect.position)
          .addScaledVector(pellet.direction, headDistance);
        const headScale = 0.105 * radiusFade;
        writeScrapshotInstance(
          pelletHeadRef.current,
          index,
          SCRAPSHOT_INSTANCE_DUMMY.position,
          pellet.impactQuaternion,
          headScale,
          headScale,
          headScale * 1.55,
        );
      });
      tracerCoreMaterial.opacity = 0.98 * trailEnvelope;
      tracerGlowMaterial.opacity = 0.68 * trailEnvelope;
      commitScrapshotInstances(tracerGlowRef.current);
      commitScrapshotInstances(tracerCoreRef.current);
      commitScrapshotInstances(pelletHeadRef.current);
    }

    if (showMuzzle && muzzleMaterial && smokeMaterial) {
      muzzleMaterial.opacity = muzzleOpacity * flashFade;
      if (muzzleCoreRef.current) {
        muzzleCoreRef.current.scale.setScalar(
          compactMuzzle ? 0.08 + flashT * 0.12 : 0.12 + flashT * 0.2,
        );
      }
      if (muzzleGlowRef.current) {
        muzzleGlowRef.current.scale.setScalar(
          compactMuzzle ? 0.14 + flashT * 0.18 : 0.22 + flashT * 0.3,
        );
      }
      if (muzzleConeRef.current) {
        muzzleConeRef.current.position.z = compactMuzzle
          ? 0.12 + flashT * 0.18
          : 0.2 + flashT * 0.3;
        const coneRadius = (compactMuzzle ? 0.12 : 0.2) * flashFade;
        muzzleConeRef.current.scale.set(
          coneRadius,
          compactMuzzle ? 0.42 + flashT * 0.34 : 0.85 + flashT * 0.6,
          coneRadius,
        );
      }
      if (muzzleRingARef.current) {
        muzzleRingARef.current.scale.setScalar(
          compactMuzzle ? 0.12 + flashT * 0.28 : 0.2 + flashT * 0.55,
        );
        muzzleRingARef.current.rotation.z += delta * 8;
      }
      if (muzzleRingBRef.current) {
        muzzleRingBRef.current.scale.setScalar(
          compactMuzzle ? 0.08 + flashT * 0.2 : 0.14 + flashT * 0.4,
        );
        muzzleRingBRef.current.rotation.z -= delta * 11;
      }

      const sparkT = clamp01(elapsed / 0.23);
      muzzleSparks.forEach((spark, index) => {
        const localT = clamp01((elapsed - spark.delay) / 0.2);
        SCRAPSHOT_INSTANCE_DUMMY.position.copy(spark.origin)
          .addScaledVector(spark.direction, spark.speed * localT * 0.19);
        SCRAPSHOT_INSTANCE_DUMMY.position.y += localT * localT * 0.14;
        const scale = spark.scale
          * (compactMuzzle ? 0.55 : 0.8)
          * (1 - localT)
          * Math.max(0.001, flashFade + 0.18);
        writeScrapshotInstance(
          muzzleSparkRef.current,
          index,
          SCRAPSHOT_INSTANCE_DUMMY.position,
          spark.quaternion,
          scale,
          scale * 5.2,
          scale,
        );
      });
      commitScrapshotInstances(muzzleSparkRef.current);

      const smokeT = clamp01((elapsed - 0.035) / 0.39);
      smokeMaterial.opacity = 0.28 * (1 - smokeT);
      smoke.forEach((puff, index) => {
        SCRAPSHOT_INSTANCE_DUMMY.position.copy(effect.position)
          .addScaledVector(puff.direction, puff.speed * smokeT);
        const scale = puff.scale * (0.72 + smokeT * 2.15);
        writeScrapshotInstance(
          smokeRef.current,
          index,
          SCRAPSHOT_INSTANCE_DUMMY.position,
          muzzleQuaternion,
          scale * (1 + index * 0.05),
          scale,
          scale * 0.86,
        );
      });
      commitScrapshotInstances(smokeRef.current);

      if (lightRef.current) {
        lightRef.current.intensity = muzzleLightIntensity * flashFade * flashFade;
      }
      if (sparkT >= 1 && lightRef.current) lightRef.current.intensity = 0;
    }

    if (showImpacts && impactMaterial) {
      const impactFade = 1 - clamp01((elapsed - 0.1) / 0.3);
      impactMaterial.opacity = 0.92 * impactFade;
      impactVisuals.forEach((pellet, index) => {
        const impactDelay = mode === 'impacts' ? 0 : pellet.travelSeconds;
        const impactT = clamp01((elapsed - impactDelay) / 0.27);
        const burst = Math.sin(Math.min(1, impactT * 1.2) * Math.PI);
        const flareScale = Math.max(0.001, (0.14 + impactT * 0.38) * burst);
        const ringScale = Math.max(0.001, (0.22 + impactT * 0.92) * burst);
        writeScrapshotInstance(
          impactFlareRef.current,
          index,
          pellet.end,
          pellet.impactQuaternion,
          flareScale,
          flareScale,
          flareScale,
        );
        writeScrapshotInstance(
          impactRingRef.current,
          index,
          pellet.end,
          pellet.impactQuaternion,
          ringScale,
          ringScale,
          ringScale,
        );
      });
      impactSparks.forEach((spark, index) => {
        const sparkT = clamp01((elapsed - spark.delay) / 0.28);
        SCRAPSHOT_INSTANCE_DUMMY.position.copy(spark.origin)
          .addScaledVector(spark.direction, spark.speed * sparkT * 0.22);
        SCRAPSHOT_INSTANCE_DUMMY.position.y -= sparkT * sparkT * 0.22;
        const scale = Math.max(0.001, spark.scale * (1 - sparkT));
        writeScrapshotInstance(
          impactSparkRef.current,
          index,
          SCRAPSHOT_INSTANCE_DUMMY.position,
          spark.quaternion,
          scale,
          scale * 6.5,
          scale,
        );
      });
      commitScrapshotInstances(impactFlareRef.current);
      commitScrapshotInstances(impactRingRef.current);
      commitScrapshotInstances(impactSparkRef.current);
    }
  });

  if (pelletVisuals.length === 0) return null;

  return (
    <group frustumCulled={false}>
      {showTrails && tracerCoreMaterial && tracerGlowMaterial && (
        <>
          <instancedMesh
            ref={tracerGlowRef}
            args={[SHARED_GEOMETRIES.cylinder8, tracerGlowMaterial, pelletVisuals.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={tracerCoreRef}
            args={[SHARED_GEOMETRIES.cylinder8, tracerCoreMaterial, pelletVisuals.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={pelletHeadRef}
            args={[SHARED_GEOMETRIES.sphere8, tracerCoreMaterial, pelletVisuals.length]}
            frustumCulled={false}
          />
        </>
      )}

      {showMuzzle && muzzleMaterial && smokeMaterial && (
        <>
          <group position={effect.position} quaternion={muzzleQuaternion} frustumCulled={false}>
            <mesh ref={muzzleGlowRef} geometry={SHARED_GEOMETRIES.sphere8} material={muzzleMaterial} />
            <mesh ref={muzzleCoreRef} geometry={SHARED_GEOMETRIES.sphere8} material={muzzleMaterial} />
            <mesh
              ref={muzzleConeRef}
              geometry={SHARED_GEOMETRIES.cone8}
              material={muzzleMaterial}
              rotation={[Math.PI / 2, 0, 0]}
            />
            <mesh ref={muzzleRingARef} geometry={SHARED_GEOMETRIES.ring16} material={muzzleMaterial} />
            <mesh
              ref={muzzleRingBRef}
              geometry={SHARED_GEOMETRIES.ring8}
              material={muzzleMaterial}
              rotation={[0, 0, Math.PI / 8]}
            />
            <BudgetedPointLight
              ref={lightRef}
              budgetPriority={5}
              budgetRadius={muzzleLightDistance}
              color="#ff7a00"
              intensity={0}
              distance={muzzleLightDistance}
              decay={2}
            />
          </group>
          <instancedMesh
            ref={muzzleSparkRef}
            args={[SHARED_GEOMETRIES.box, muzzleMaterial, muzzleSparks.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={smokeRef}
            args={[SHARED_GEOMETRIES.sphere8, smokeMaterial, smoke.length]}
            frustumCulled={false}
          />
        </>
      )}

      {showImpacts && impactMaterial && (
        <>
          <instancedMesh
            ref={impactFlareRef}
            args={[SHARED_GEOMETRIES.sphere8, impactMaterial, impactVisuals.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={impactRingRef}
            args={[SHARED_GEOMETRIES.ring16, impactMaterial, impactVisuals.length]}
            frustumCulled={false}
          />
          <instancedMesh
            ref={impactSparkRef}
            args={[SHARED_GEOMETRIES.box, impactMaterial, impactSparks.length]}
            frustumCulled={false}
          />
        </>
      )}
    </group>
  );
}

function BlinkEffect({ effect }: EffectProps) {
  const startRef = useRef<THREE.Mesh>(null);
  const endRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const startMaterial = useGlobalEffectMaterial('blinkStart');
  const endMaterial = useGlobalEffectMaterial('blinkEnd');

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);

    if (startRef.current) {
      const mat = startRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 1 - t;
      startRef.current.scale.setScalar(1 + t);
    }

    if (endRef.current && effect.endPosition) {
      const mat = endRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = t * (1 - t) * 4; // Peak at middle
      endRef.current.scale.setScalar(t * 2);
    }
  });

  return (
    <group>
      {/* Start position effect */}
      <mesh ref={startRef} position={effect.position} geometry={BLINK_RING_GEOMETRY} material={startMaterial} />

      {/* End position effect */}
      {effect.endPosition && (
        <mesh ref={endRef} position={effect.endPosition} geometry={BLINK_RING_GEOMETRY} material={endMaterial} />
      )}
    </group>
  );
}

function ExplosionEffect({ effect }: EffectProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const progress = useRef(0);
  const directions = useMemo(() => createExplosionDirections(effect.id), [effect.id]);
  const material = useGlobalEffectMaterial('explosion');

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const scale = 1 - t * 0.5;

    for (let i = 0; i < EXPLOSION_PARTICLE_COUNT; i++) {
      const offset = i * 3;
      EXPLOSION_INSTANCE_DUMMY.position.set(
        directions[offset] * t * 3,
        directions[offset + 1] * t * 3,
        directions[offset + 2] * t * 3
      );
      EXPLOSION_INSTANCE_DUMMY.scale.setScalar(scale * GLOBAL_EFFECT_BOX_SCALE);
      EXPLOSION_INSTANCE_DUMMY.updateMatrix();
      mesh.setMatrixAt(i, EXPLOSION_INSTANCE_DUMMY.matrix);
    }

    (mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[SHARED_GEOMETRIES.box, undefined, EXPLOSION_PARTICLE_COUNT]}
      position={effect.position}
      frustumCulled={false}
      material={material}
    />
  );
}

function HitEffect({ effect }: EffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const material = useGlobalEffectMaterial('hit');

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    if (!meshRef.current) return;

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);

    const mat = meshRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 1 - t;
    meshRef.current.scale.setScalar((0.5 + t) * GLOBAL_EFFECT_SPHERE_SCALE);
  });

  return (
    <mesh
      ref={meshRef}
      position={effect.position}
      geometry={SHARED_GEOMETRIES.sphere8}
      material={material}
      scale={0.5 * GLOBAL_EFFECT_SPHERE_SCALE}
    />
  );
}

function writeChronosEffectSourceForward(
  effect: Effect,
  camera: THREE.Camera,
  target: THREE.Vector3
): THREE.Vector3 | null {
  if (!effect.sourceAbilityId) return null;

  if (!effect.sourcePlayerId) {
    camera.getWorldDirection(target);
    return target;
  }

  const store = useGameStore.getState();
  const yaw = visualStore.getState().playerRotations.get(effect.sourcePlayerId)
    ?? store.players.get(effect.sourcePlayerId)?.lookYaw
    ?? (store.localPlayer?.id === effect.sourcePlayerId ? store.localPlayer.lookYaw : undefined);
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) return null;

  const forward = chronosOrbForwardFromYaw(yaw);
  target.set(forward.x, forward.y, forward.z);
  return target;
}

function LifelineBeamEffect({ effect }: EffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const beamRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const { camera } = useThree();
  const source = useMemo(() => new THREE.Vector3(), []);
  const end = useMemo(() => new THREE.Vector3(), []);
  const midpoint = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const sourceForward = useMemo(() => new THREE.Vector3(), []);
  const quaternion = useMemo(() => new THREE.Quaternion(), []);
  const glowMaterial = useGlobalEffectMaterial('lifelineGlow');
  const beamMaterial = useGlobalEffectMaterial('lifelineBeam');

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const socketOrigin = effect.sourceAbilityId
      ? resolveAbilitySocketOrigin({
        ownerScope: effect.sourcePlayerId ? 'remoteBody' : 'localViewmodel',
        playerId: effect.sourcePlayerId,
        abilityId: effect.sourceAbilityId,
      })
      : null;
    source.copy(socketOrigin?.position ?? effect.position);
    offsetChronosOrbVisualVector(
      source,
      writeChronosEffectSourceForward(effect, camera, sourceForward),
      effect.sourceAbilityId
    );
    end.copy(effect.endPosition ?? source);
    direction.copy(end).sub(source);
    const length = Math.max(0.001, direction.length());
    direction.normalize();
    midpoint.copy(source).add(end).multiplyScalar(0.5);
    quaternion.setFromUnitVectors(LIFELINE_AXIS, direction);
    group.position.copy(midpoint);
    group.quaternion.copy(quaternion);

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = Math.sin((1 - t) * Math.PI * 0.5);
    const beamRadius = 0.74 + Math.sin(t * Math.PI * 4) * 0.08;

    if (beamRef.current) {
      const mat = beamRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.72 * fade;
      beamRef.current.scale.set(
        beamRadius * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE,
        length,
        beamRadius * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE
      );
    }

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.2 * fade;
      glowRef.current.scale.set(
        beamRadius * 2.4 * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE,
        length,
        beamRadius * 2.4 * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE
      );
    }
  });

  return (
    <group ref={groupRef} position={effect.position}>
      <mesh
        ref={glowRef}
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={glowMaterial}
        scale={[1.8 * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE, 1, 1.8 * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE]}
      />
      <mesh
        ref={beamRef}
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={beamMaterial}
        scale={[0.74 * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE, 1, 0.74 * GLOBAL_EFFECT_CYLINDER_RADIUS_SCALE]}
      />
    </group>
  );
}

function HealPulseEffect({ effect }: EffectProps) {
  const sphereRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const progress = useRef(0);
  const sphereMaterial = useGlobalEffectMaterial('healSphere');
  const ringMaterial = useGlobalEffectMaterial('healRing');

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = 1 - t;

    if (sphereRef.current) {
      const mat = sphereRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.46 * fade;
      sphereRef.current.scale.setScalar((0.7 + t * 1.45) * GLOBAL_EFFECT_SPHERE_SCALE);
    }

    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.62 * fade;
      ringRef.current.scale.setScalar(0.45 + t * 1.35);
    }
  });

  return (
    <group position={effect.position}>
      <mesh
        ref={sphereRef}
        geometry={SHARED_GEOMETRIES.sphere8}
        material={sphereMaterial}
        scale={0.7 * GLOBAL_EFFECT_SPHERE_SCALE}
      />
      <mesh
        ref={ringRef}
        geometry={BLINK_RING_GEOMETRY}
        material={ringMaterial}
        rotation={[Math.PI / 2, 0, 0]}
      />
    </group>
  );
}

function ChronosSelfHealPulseEffect({ effect }: EffectProps) {
  const groupRef = useRef<THREE.Group>(null);
  const sphereRef = useRef<THREE.Mesh>(null);
  const ringRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const progress = useRef(0);
  const { camera } = useThree();
  const source = useMemo(() => new THREE.Vector3(), []);
  const sourceForward = useMemo(() => new THREE.Vector3(), []);
  const sphereMaterial = useGlobalEffectMaterial('chronosSelfHealSphere');
  const ringMaterialGreen = useGlobalEffectMaterial('chronosSelfHealRingGreen');
  const ringMaterialLight = useGlobalEffectMaterial('chronosSelfHealRingLight');

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const socketOrigin = effect.sourceAbilityId
      ? resolveAbilitySocketOrigin({
        ownerScope: effect.sourcePlayerId ? 'remoteBody' : 'localViewmodel',
        playerId: effect.sourcePlayerId,
        abilityId: effect.sourceAbilityId,
      })
      : null;
    source.copy(socketOrigin?.position ?? effect.position);
    offsetChronosOrbVisualVector(
      source,
      writeChronosEffectSourceForward(effect, camera, sourceForward),
      effect.sourceAbilityId
    );
    group.position.copy(source);

    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = Math.max(0, 1 - t);
    const pulse = Math.sin(t * Math.PI);
    const radius = 0.25 + t * 4.6;

    if (sphereRef.current) {
      const mat = sphereRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.34 * fade;
      sphereRef.current.scale.setScalar(radius);
    }

    ringRefs.current.forEach((ring, index) => {
      if (!ring) return;
      const mat = ring.material as THREE.MeshBasicMaterial;
      const ripple = 0.92 + Math.sin(t * Math.PI * 3 + index * 0.7) * 0.08;
      mat.opacity = 0.72 * fade;
      ring.scale.setScalar(radius * ripple);
      ring.rotation.z += delta * (1.5 + index * 0.35);
    });

    if (lightRef.current) {
      lightRef.current.intensity = 1.8 * pulse * fade;
    }
  });

  return (
    <group ref={groupRef} position={effect.position} frustumCulled={false}>
      <mesh ref={sphereRef} geometry={SHARED_GEOMETRIES.sphere16} material={sphereMaterial} />
      {[
        [Math.PI / 2, 0, 0],
        [0, Math.PI / 2, 0],
        [0, 0, 0],
      ].map((rotation, index) => (
        <mesh
          key={index}
          ref={(node) => {
            ringRefs.current[index] = node;
          }}
          geometry={BLINK_RING_GEOMETRY}
          material={index === 1 ? ringMaterialLight : ringMaterialGreen}
          rotation={rotation as [number, number, number]}
        />
      ))}
      <BudgetedPointLight
        ref={lightRef}
        budgetPriority={3.2}
        budgetRadius={5.5}
        color="#86efac"
        intensity={0}
        distance={5.5}
        decay={2}
      />
    </group>
  );
}

function ChronosAegisBreakEffect({ effect }: EffectProps) {
  const flashRef = useRef<THREE.Mesh>(null);
  const ringARef = useRef<THREE.Mesh>(null);
  const ringBRef = useRef<THREE.Mesh>(null);
  const shardRefs = useRef<(THREE.Mesh | null)[]>([]);
  const lightRef = useRef<THREE.PointLight>(null);
  const progress = useRef(0);
  const shards = useMemo(() => createChronosAegisBreakShards(effect.id), [effect.id]);
  const quaternion = useMemo(() => {
    const direction = (effect.direction ?? EFFECT_FORWARD).clone();
    if (direction.lengthSq() <= 0.0001) direction.copy(EFFECT_FORWARD);
    direction.normalize();
    return new THREE.Quaternion().setFromUnitVectors(EFFECT_FORWARD, direction);
  }, [effect.direction]);
  const flashMaterial = useGlobalEffectMaterial('chronosAegisBreakFlash');
  const ringMaterial = useGlobalEffectMaterial('chronosAegisBreakRing');
  const shardMaterial = useGlobalEffectMaterial('chronosAegisBreakShard');

  useGlobalEffectUpdater(effect.id, (_, delta) => {
    progress.current += delta / (effect.duration / 1000);
    const t = Math.min(1, progress.current);
    const fade = Math.max(0, 1 - t);
    const burst = Math.sin(Math.min(1, t * 1.45) * Math.PI);

    if (flashRef.current) {
      flashMaterial.opacity = 0.58 * fade;
      flashRef.current.scale.setScalar((0.78 + t * 2.4) * GLOBAL_EFFECT_SPHERE_SCALE);
    }
    if (ringARef.current) {
      ringMaterial.opacity = 0.72 * fade;
      ringARef.current.scale.setScalar(0.95 + t * 3.35);
      ringARef.current.rotation.z += delta * 1.8;
    }
    if (ringBRef.current) {
      ringBRef.current.scale.setScalar(0.56 + t * 2.5);
      ringBRef.current.rotation.z -= delta * 2.3;
    }
    shardMaterial.opacity = 0.82 * fade;
    shards.forEach((shard, index) => {
      const mesh = shardRefs.current[index];
      if (!mesh) return;
      mesh.position.set(shard.x * t, shard.y * t, shard.z * burst);
      mesh.rotation.set(0, 0, shard.rotation + shard.spin * t);
      mesh.scale.set(
        shard.width * (1 - t * 0.25) * GLOBAL_EFFECT_BOX_SCALE,
        shard.height * (1 - t * 0.42) * GLOBAL_EFFECT_BOX_SCALE,
        0.018 * GLOBAL_EFFECT_BOX_SCALE
      );
    });
    if (lightRef.current) {
      lightRef.current.intensity = 3.1 * burst * fade;
    }
  });

  return (
    <group position={effect.position} quaternion={quaternion} frustumCulled={false}>
      <mesh ref={flashRef} geometry={SHARED_GEOMETRIES.sphere8} material={flashMaterial} scale={0.78 * GLOBAL_EFFECT_SPHERE_SCALE} frustumCulled={false} />
      <mesh ref={ringARef} geometry={BLINK_RING_GEOMETRY} material={ringMaterial} frustumCulled={false} />
      <mesh ref={ringBRef} geometry={BLINK_RING_GEOMETRY} material={ringMaterial} frustumCulled={false} />
      {shards.map((_, index) => (
        <mesh
          key={index}
          ref={(node) => {
            shardRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.box}
          material={shardMaterial}
          frustumCulled={false}
        />
      ))}
      <BudgetedPointLight
        ref={lightRef}
        budgetPriority={3.5}
        budgetRadius={5.8}
        color="#fde68a"
        intensity={0}
        distance={5.8}
        decay={2}
      />
    </group>
  );
}
