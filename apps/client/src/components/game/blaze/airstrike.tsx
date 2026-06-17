import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  BLAZE_GEARSTORM_DAMAGE,
  BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
  BLAZE_GEARSTORM_DURATION_MS,
  BLAZE_GEARSTORM_RADIUS,
  type Team,
} from '@voxel-strike/shared';
import { checkGroundWithNormal, isPhysicsReady } from '../../../hooks/usePhysics';
import { SHARED_GEOMETRIES } from '../effectResources';
import { BudgetedPointLight } from '../systems/DynamicLightBudget';
import { getFrameClock } from '../../../utils/frameClock';
import {
  measureFrameWork,
  recordEffectSlotDiagnostics,
} from '../../../movement/networkDiagnostics';
import { applyTutorialTrainingAreaDamage } from '../../../utils/tutorialTrainingHeroes';

// ============================================================================
// INFERNAL GEARSTORM EFFECT - BLAZE ULTIMATE
// ============================================================================

interface BurningCogData {
  angle: number;
  radius: number;
  groundY: number;
  height: number;
  size: number;
  spinSpeed: number;
  orbitSpeed: number;
  bobSpeed: number;
  bobAmount: number;
  yaw: number;
  tiltX: number;
  tiltY: number;
  phase: number;
}

interface BurnPatchData {
  x: number;
  z: number;
  groundY: number;
  radiusX: number;
  radiusZ: number;
  phase: number;
  opacity: number;
  color: number;
}

interface GroundFlameData {
  x: number;
  z: number;
  groundY: number;
  radius: number;
  height: number;
  phase: number;
  flickerSpeed: number;
  dutyCycle: number;
  yaw: number;
  leanX: number;
  leanZ: number;
}

interface AirStrikeData {
  id: string;
  ownerId: string | null;
  ownerTeam: Team | null;
  centerPosition: { x: number; y: number; z: number };
  startTime: number;
  frameStartTime: number;
  groundY: number;
  lastDamageTick: Map<string, number>;
  cogs: BurningCogData[];
  burnPatches: BurnPatchData[];
  groundFlames: GroundFlameData[];
}

const airStrikes: AirStrikeData[] = [];
let airStrikeIdCounter = 0;
let airStrikeRevision = 0;
let cachedGearstormSkyIntensityNowMs = -1;
let cachedGearstormSkyIntensityRevision = -1;
let cachedGearstormSkyIntensityCount = -1;
let cachedGearstormSkyIntensity = 0;

export const AIR_STRIKE_DURATION = BLAZE_GEARSTORM_DURATION_MS;
const GEARSTORM_SKY_AFTERGLOW_MS = 900;

const GEARSTORM_RADIUS = BLAZE_GEARSTORM_RADIUS;
const GEARSTORM_COG_COUNT = 48;
const GEARSTORM_BURN_PATCH_COUNT = 112;
const GEARSTORM_GROUND_FLAME_COUNT = 112;
const GEARSTORM_GROUND_RAY_START_HEIGHT = 96;
const GEARSTORM_GROUND_RAY_DISTANCE = 220;
const GROUND_FILL_OFFSET = 0.09;
const GROUND_RING_OFFSET = 0.13;
const GROUND_HOT_CORE_OFFSET = 0.16;
const GROUND_PATCH_OFFSET = 0.18;
const GROUND_FLAME_OFFSET = 0.12;
const COG_TEETH = 18;
const COG_DEPTH = 0.34;
const COG_FIRE_ORANGE = 0xff6a00;
const COG_RISE_DURATION_MS = 760;
const COG_RISE_STAGGER_MS = 260;
const COG_SINK_DURATION_MS = 920;
const COG_SINK_STAGGER_MS = 320;
const COG_BURY_DEPTH = 2.45;
const GROUND_FLAME_PLANE_ANGLES = [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4];
const GEARSTORM_GROUND_SAMPLE_CELL_SIZE = 7;
const GEARSTORM_MAX_GROUND_SAMPLES = 16;
const GEARSTORM_MULTI_STRIKE_DECORATIVE_FRAME_STRIDE = 2;

const GEARSTORM_BODY_MATERIAL_TEMPLATE = new THREE.MeshStandardMaterial({
  color: COG_FIRE_ORANGE,
  transparent: true,
  opacity: 0.56,
  depthWrite: false,
  emissive: COG_FIRE_ORANGE,
  emissiveIntensity: 0.42,
  roughness: 0.42,
  metalness: 0.15,
});
const GEARSTORM_INNER_RING_MATERIAL_TEMPLATE = new THREE.MeshStandardMaterial({
  color: COG_FIRE_ORANGE,
  transparent: true,
  opacity: 0.42,
  depthWrite: false,
  emissive: COG_FIRE_ORANGE,
  emissiveIntensity: 0.36,
  roughness: 0.46,
  metalness: 0.12,
});
const GEARSTORM_HUB_MATERIAL_TEMPLATE = new THREE.MeshStandardMaterial({
  color: COG_FIRE_ORANGE,
  transparent: true,
  opacity: 0.5,
  depthWrite: false,
  emissive: COG_FIRE_ORANGE,
  emissiveIntensity: 0.46,
  roughness: 0.4,
  metalness: 0.16,
});
const GEARSTORM_GROUND_FILL_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xff2a00,
  transparent: true,
  opacity: 0.2,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  toneMapped: false,
});
const GEARSTORM_GROUND_RING_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xff7a00,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  toneMapped: false,
});
const GEARSTORM_GROUND_CORE_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xffcc33,
  transparent: true,
  opacity: 0.22,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  toneMapped: false,
});
const GEARSTORM_BURN_PATCH_ORANGE_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xff4a00,
  transparent: true,
  opacity: 0.22,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  toneMapped: false,
});
const GEARSTORM_BURN_PATCH_YELLOW_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xffaa00,
  transparent: true,
  opacity: 0.22,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  toneMapped: false,
});
const GEARSTORM_FLAME_RING_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xff7a00,
  transparent: true,
  opacity: 0.42,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -1,
  polygonOffsetUnits: -4,
  toneMapped: false,
});
const GEARSTORM_FLAME_GLOW_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xff5a00,
  transparent: true,
  opacity: 0.28,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const GEARSTORM_FLAME_OUTER_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xff5a00,
  transparent: true,
  opacity: 0.68,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});
const GEARSTORM_FLAME_INNER_MATERIAL_TEMPLATE = new THREE.MeshBasicMaterial({
  color: 0xffd36a,
  transparent: true,
  opacity: 0.56,
  side: THREE.DoubleSide,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  toneMapped: false,
});

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

export function getBlazeGearstormSkyIntensity(nowMs = getFrameClock().nowMs): number {
  if (
    nowMs === cachedGearstormSkyIntensityNowMs &&
    airStrikeRevision === cachedGearstormSkyIntensityRevision &&
    airStrikes.length === cachedGearstormSkyIntensityCount
  ) {
    return cachedGearstormSkyIntensity;
  }

  let intensity = 0;

  for (const strike of airStrikes) {
    const elapsed = nowMs - strike.frameStartTime;
    if (elapsed < 0 || elapsed > AIR_STRIKE_DURATION + GEARSTORM_SKY_AFTERGLOW_MS) continue;

    const fadeIn = smoothstep01(elapsed / 640);
    const fadeOut = smoothstep01((AIR_STRIKE_DURATION + GEARSTORM_SKY_AFTERGLOW_MS - elapsed) / 1350);
    intensity = Math.max(intensity, fadeIn * fadeOut);
  }

  cachedGearstormSkyIntensityNowMs = nowMs;
  cachedGearstormSkyIntensityRevision = airStrikeRevision;
  cachedGearstormSkyIntensityCount = airStrikes.length;
  cachedGearstormSkyIntensity = clamp01(intensity);
  return cachedGearstormSkyIntensity;
}

function createGearShape(teeth: number, rootRadius: number, outerRadius: number, innerRadius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const sector = (Math.PI * 2) / teeth;
  const points: THREE.Vector2[] = [];

  for (let tooth = 0; tooth < teeth; tooth++) {
    const baseAngle = tooth * sector;
    const toothPoints: Array<[number, number]> = [
      [0.02, rootRadius],
      [0.16, outerRadius],
      [0.46, outerRadius],
      [0.6, rootRadius],
      [0.96, rootRadius],
    ];

    toothPoints.forEach(([sectorPosition, radius]) => {
      const angle = baseAngle + sectorPosition * sector;
      points.push(new THREE.Vector2(Math.cos(angle) * radius, Math.sin(angle) * radius));
    });
  }

  points.forEach((point, index) => {
    if (index === 0) {
      shape.moveTo(point.x, point.y);
      return;
    }
    shape.lineTo(point.x, point.y);
  });
  shape.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  return shape;
}

function createRingShape(innerRadius: number, outerRadius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);

  const hole = new THREE.Path();
  hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
  shape.holes.push(hole);

  return shape;
}

function createDiscShape(radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

function createExtrudedGeometry(shape: THREE.Shape, depth: number): THREE.ExtrudeGeometry {
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function createFlameShape(tipLean: number): THREE.Shape {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.48, 0.08, -0.52, 0.34, -0.28, 0.56);
  shape.bezierCurveTo(-0.2, 0.72, -0.12, 0.86, tipLean, 1);
  shape.bezierCurveTo(0.2, 0.8, 0.5, 0.62, 0.34, 0.36);
  shape.bezierCurveTo(0.5, 0.18, 0.36, 0.04, 0, 0);
  return shape;
}

const COG_BODY_GEOMETRY = createExtrudedGeometry(
  createGearShape(COG_TEETH, 0.86, 1.16, 0.42),
  COG_DEPTH
);
const COG_INNER_RING_GEOMETRY = createExtrudedGeometry(createRingShape(0.36, 0.58), COG_DEPTH * 1.12);
const COG_HUB_GEOMETRY = createExtrudedGeometry(createDiscShape(0.2), COG_DEPTH * 1.28);
const GROUND_FLAME_OUTER_GEOMETRY = new THREE.ShapeGeometry(createFlameShape(-0.04));
const GROUND_FLAME_INNER_GEOMETRY = new THREE.ShapeGeometry(createFlameShape(0.12));
const GEARSTORM_HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

interface GearstormMaterials {
  cogBody: THREE.MeshStandardMaterial;
  cogInnerRing: THREE.MeshStandardMaterial;
  cogHub: THREE.MeshStandardMaterial;
  groundFill: THREE.MeshBasicMaterial;
  groundRing: THREE.MeshBasicMaterial;
  groundCore: THREE.MeshBasicMaterial;
  burnPatchOrange: THREE.MeshBasicMaterial;
  burnPatchYellow: THREE.MeshBasicMaterial;
  flameRing: THREE.MeshBasicMaterial;
  flameGlow: THREE.MeshBasicMaterial;
  flameOuter: THREE.MeshBasicMaterial;
  flameInner: THREE.MeshBasicMaterial;
}

function createGearstormMaterials(): GearstormMaterials {
  return {
    cogBody: GEARSTORM_BODY_MATERIAL_TEMPLATE.clone(),
    cogInnerRing: GEARSTORM_INNER_RING_MATERIAL_TEMPLATE.clone(),
    cogHub: GEARSTORM_HUB_MATERIAL_TEMPLATE.clone(),
    groundFill: GEARSTORM_GROUND_FILL_MATERIAL_TEMPLATE.clone(),
    groundRing: GEARSTORM_GROUND_RING_MATERIAL_TEMPLATE.clone(),
    groundCore: GEARSTORM_GROUND_CORE_MATERIAL_TEMPLATE.clone(),
    burnPatchOrange: GEARSTORM_BURN_PATCH_ORANGE_MATERIAL_TEMPLATE.clone(),
    burnPatchYellow: GEARSTORM_BURN_PATCH_YELLOW_MATERIAL_TEMPLATE.clone(),
    flameRing: GEARSTORM_FLAME_RING_MATERIAL_TEMPLATE.clone(),
    flameGlow: GEARSTORM_FLAME_GLOW_MATERIAL_TEMPLATE.clone(),
    flameOuter: GEARSTORM_FLAME_OUTER_MATERIAL_TEMPLATE.clone(),
    flameInner: GEARSTORM_FLAME_INNER_MATERIAL_TEMPLATE.clone(),
  };
}

function disposeGearstormMaterials(materials: GearstormMaterials): void {
  Object.values(materials).forEach((material) => material.dispose());
}

function setInstancedMeshUsage(mesh: THREE.InstancedMesh | null): void {
  if (!mesh) return;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
}

function setInstancedMatrix(mesh: THREE.InstancedMesh | null, index: number, matrix: THREE.Matrix4): void {
  if (!mesh) return;
  mesh.setMatrixAt(index, matrix);
}

function hideInstancedMeshRange(mesh: THREE.InstancedMesh | null, startIndex: number, count: number): void {
  if (!mesh) return;
  for (let index = startIndex; index < count; index++) {
    mesh.setMatrixAt(index, GEARSTORM_HIDDEN_MATRIX);
  }
}

function commitInstancedMesh(mesh: THREE.InstancedMesh | null): void {
  if (!mesh) return;
  mesh.instanceMatrix.needsUpdate = true;
}

function writeBurnPatchMatrices(
  patches: BurnPatchData[],
  mesh: THREE.InstancedMesh | null,
  elapsed: number,
  matrixObject: THREE.Object3D
): void {
  if (!mesh) return;
  for (let index = 0; index < patches.length; index++) {
    const patch = patches[index];
    const patchPulse = 0.84 + Math.sin(elapsed * 0.008 + patch.phase) * 0.18;
    matrixObject.position.set(patch.x, patch.groundY + GROUND_PATCH_OFFSET, patch.z);
    matrixObject.rotation.set(-Math.PI / 2, 0, patch.phase + elapsed * 0.0009);
    matrixObject.scale.set(patch.radiusX * patchPulse, patch.radiusZ * patchPulse, 1);
    matrixObject.updateMatrix();
    mesh.setMatrixAt(index, matrixObject.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

function randomSigned(amount: number): number {
  return (Math.random() * 2 - 1) * amount;
}

function randomInRadius(radius: number): { x: number; z: number } {
  const angle = Math.random() * Math.PI * 2;
  const distance = Math.sqrt(Math.random()) * radius;
  return {
    x: Math.cos(angle) * distance,
    z: Math.sin(angle) * distance,
  };
}

function resolveGroundY(x: number, z: number, fallbackY: number): number {
  if (!isPhysicsReady()) return fallbackY;

  const groundCheck = checkGroundWithNormal(
    x,
    fallbackY + GEARSTORM_GROUND_RAY_START_HEIGHT,
    z,
    GEARSTORM_GROUND_RAY_DISTANCE,
    {
      priority: 'visual',
      feature: 'effect:blazeAirstrikeGround',
    }
  );

  return groundCheck ? groundCheck.groundY : fallbackY;
}

function createGearstormGroundResolver(centerX: number, centerZ: number, fallbackY: number) {
  const cache = new Map<string, number>();
  let sampleCount = 0;
  const centerGroundY = resolveGroundY(centerX, centerZ, fallbackY);

  cache.set('0,0', centerGroundY);

  return (x: number, z: number): number => {
    const cellX = Math.round((x - centerX) / GEARSTORM_GROUND_SAMPLE_CELL_SIZE);
    const cellZ = Math.round((z - centerZ) / GEARSTORM_GROUND_SAMPLE_CELL_SIZE);
    const key = `${cellX},${cellZ}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    if (sampleCount >= GEARSTORM_MAX_GROUND_SAMPLES) {
      return centerGroundY;
    }

    sampleCount += 1;
    const groundY = resolveGroundY(
      centerX + cellX * GEARSTORM_GROUND_SAMPLE_CELL_SIZE,
      centerZ + cellZ * GEARSTORM_GROUND_SAMPLE_CELL_SIZE,
      centerGroundY
    );
    cache.set(key, groundY);
    return groundY;
  };
}

interface AirStrikeOwner {
  ownerId?: string | null;
  ownerTeam?: Team | null;
}

function triggerAirStrikeImmediate(position: { x: number; y: number; z: number }, owner: AirStrikeOwner = {}) {
  const fallbackGroundY = position.y - 1;
  const resolveGearstormGroundY = createGearstormGroundResolver(position.x, position.z, fallbackGroundY);
  const groundY = resolveGearstormGroundY(position.x, position.z);
  const cogs: BurningCogData[] = [];
  const burnPatches: BurnPatchData[] = [];
  const groundFlames: GroundFlameData[] = [];

  for (let i = 0; i < GEARSTORM_COG_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 4.2 + Math.sqrt(Math.random()) * (GEARSTORM_RADIUS - 4.2);
    const x = position.x + Math.cos(angle) * radius;
    const z = position.z + Math.sin(angle) * radius;

    cogs.push({
      angle,
      radius,
      groundY: resolveGearstormGroundY(x, z),
      height: 2.2 + Math.random() * 4.6,
      size: 0.92 + Math.random() * 1.0,
      spinSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.38 + Math.random() * 0.42),
      orbitSpeed: (Math.random() > 0.5 ? 1 : -1) * (0.025 + Math.random() * 0.045),
      bobSpeed: 0.7 + Math.random() * 0.85,
      bobAmount: 0.22 + Math.random() * 0.42,
      yaw: Math.random() * Math.PI * 2,
      tiltX: randomSigned(0.7),
      tiltY: randomSigned(0.55),
      phase: Math.random() * Math.PI * 2,
    });
  }

  for (let i = 0; i < GEARSTORM_BURN_PATCH_COUNT; i++) {
    const offset = randomInRadius(GEARSTORM_RADIUS * 0.96);
    const x = position.x + offset.x;
    const z = position.z + offset.z;

    burnPatches.push({
      x,
      z,
      groundY: resolveGearstormGroundY(x, z),
      radiusX: 0.85 + Math.random() * 2.6,
      radiusZ: 0.55 + Math.random() * 1.85,
      phase: Math.random() * Math.PI * 2,
      opacity: 0.18 + Math.random() * 0.24,
      color: Math.random() > 0.45 ? 0xff4a00 : 0xffaa00,
    });
  }

  for (let i = 0; i < GEARSTORM_GROUND_FLAME_COUNT; i++) {
    const offset = randomInRadius(GEARSTORM_RADIUS * 0.94);
    const x = position.x + offset.x;
    const z = position.z + offset.z;

    groundFlames.push({
      x,
      z,
      groundY: resolveGearstormGroundY(x, z),
      radius: 0.28 + Math.random() * 0.4,
      height: 0.85 + Math.random() * 1.65,
      phase: Math.random(),
      flickerSpeed: 0.58 + Math.random() * 0.62,
      dutyCycle: 0.36 + Math.random() * 0.22,
      yaw: Math.random() * Math.PI * 2,
      leanX: randomSigned(0.16),
      leanZ: randomSigned(0.16),
    });
  }

  airStrikes.push({
    id: `gearstorm_${airStrikeIdCounter++}`,
    ownerId: owner.ownerId ?? null,
    ownerTeam: owner.ownerTeam ?? null,
    centerPosition: { ...position },
    startTime: Date.now(),
    frameStartTime: getFrameClock().nowMs,
    groundY,
    lastDamageTick: new Map(),
    cogs,
    burnPatches,
    groundFlames,
  });
  airStrikeRevision++;
}

export function triggerAirStrike(position: { x: number; y: number; z: number }, owner: AirStrikeOwner = {}) {
  measureFrameWork('event.effects.blazeAirstrikeTrigger', () => triggerAirStrikeImmediate(position, owner));
}

function InfernalGearstormEffect({ strike }: { strike: AirStrikeData }) {
  const groupRef = useRef<THREE.Group>(null);
  const groundFillRef = useRef<THREE.Mesh>(null);
  const groundRingRef = useRef<THREE.Mesh>(null);
  const groundHotCoreRef = useRef<THREE.Mesh>(null);
  const orangePatchRef = useRef<THREE.InstancedMesh | null>(null);
  const yellowPatchRef = useRef<THREE.InstancedMesh | null>(null);
  const flameRingRef = useRef<THREE.InstancedMesh | null>(null);
  const flameGlowRef = useRef<THREE.InstancedMesh | null>(null);
  const flameOuterRef = useRef<THREE.InstancedMesh | null>(null);
  const flameInnerRef = useRef<THREE.InstancedMesh | null>(null);
  const cogBodyRef = useRef<THREE.InstancedMesh | null>(null);
  const cogInnerRingRef = useRef<THREE.InstancedMesh | null>(null);
  const cogHubRef = useRef<THREE.InstancedMesh | null>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const matrixObjectRef = useRef(new THREE.Object3D());
  const childMatrixObjectRef = useRef(new THREE.Object3D());
  const tempVectorRef = useRef(new THREE.Vector3());
  const decorativeFrameIndexRef = useRef(0);
  const materials = useMemo(createGearstormMaterials, []);
  const patchGroups = useMemo(() => ({
    orange: strike.burnPatches.filter((patch) => patch.color === 0xff4a00),
    yellow: strike.burnPatches.filter((patch) => patch.color !== 0xff4a00),
  }), [strike.burnPatches]);

  useEffect(() => () => disposeGearstormMaterials(materials), [materials]);

  useLayoutEffect(() => {
    const instancedMeshes = [
      orangePatchRef.current,
      yellowPatchRef.current,
      flameRingRef.current,
      flameGlowRef.current,
      flameOuterRef.current,
      flameInnerRef.current,
      cogBodyRef.current,
      cogInnerRingRef.current,
      cogHubRef.current,
    ];

    instancedMeshes.forEach((mesh) => {
      if (!mesh) return;
      setInstancedMeshUsage(mesh);
      hideInstancedMeshRange(mesh, 0, mesh.count);
      commitInstancedMesh(mesh);
    });
  }, []);

  useFrame(() => measureFrameWork('frame.effects.blazeAirstrike', () => {
    const elapsed = getFrameClock().nowMs - strike.frameStartTime;

    if (elapsed > AIR_STRIKE_DURATION) {
      if (groupRef.current) groupRef.current.visible = false;
      if (lightRef.current) lightRef.current.intensity = 0;
      return;
    }

    const elapsedSeconds = elapsed / 1000;
    const fadeIn = clamp01(elapsed / 420);
    const fadeOut = clamp01((AIR_STRIKE_DURATION - elapsed) / 950);
    const fade = fadeIn * fadeOut;
    const pulse = 0.92 + Math.sin(elapsed * 0.006) * 0.08;
    applyTutorialTrainingAreaDamage({
      center: strike.centerPosition,
      radius: GEARSTORM_RADIUS,
      damage: BLAZE_GEARSTORM_DAMAGE,
      damageType: 'airstrike',
      sourceId: strike.ownerId,
      sourceTeam: strike.ownerTeam,
      abilityId: 'blaze_airstrike',
      falloffScale: 0.35,
      damageIntervalMs: BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS,
      lastDamageTick: strike.lastDamageTick,
    });
    const updateDecorativeInstancing = airStrikes.length <= 1 ||
      decorativeFrameIndexRef.current % GEARSTORM_MULTI_STRIKE_DECORATIVE_FRAME_STRIDE === 0;
    decorativeFrameIndexRef.current++;

    if (groundFillRef.current) {
      groundFillRef.current.rotation.z = elapsed * 0.00065;
      groundFillRef.current.scale.setScalar(GEARSTORM_RADIUS * (0.94 + fadeIn * 0.08) * pulse);
      materials.groundFill.opacity = 0.1 * fade;
    }

    if (groundRingRef.current) {
      groundRingRef.current.rotation.z = -elapsed * 0.0012;
      groundRingRef.current.scale.setScalar(GEARSTORM_RADIUS * (0.92 + Math.sin(elapsed * 0.004) * 0.035));
      materials.groundRing.opacity = 0.52 * fade;
    }

    if (groundHotCoreRef.current) {
      groundHotCoreRef.current.rotation.z = elapsed * 0.0015;
      groundHotCoreRef.current.scale.setScalar(GEARSTORM_RADIUS * 0.4 * (0.95 + Math.sin(elapsed * 0.008) * 0.08));
      materials.groundCore.opacity = 0.16 * fade;
    }

    const matrixObject = matrixObjectRef.current;
    const childMatrixObject = childMatrixObjectRef.current;
    const tempVector = tempVectorRef.current;

    if (updateDecorativeInstancing) {
      writeBurnPatchMatrices(patchGroups.orange, orangePatchRef.current, elapsed, matrixObject);
      writeBurnPatchMatrices(patchGroups.yellow, yellowPatchRef.current, elapsed, matrixObject);
    }
    materials.burnPatchOrange.opacity = 0.26 * fade;
    materials.burnPatchYellow.opacity = 0.24 * fade;

    if (updateDecorativeInstancing) {
      let flamePlaneIndex = 0;
      strike.groundFlames.forEach((flame, index) => {
        const cycle = (elapsedSeconds * flame.flickerSpeed + flame.phase) % 1;
        const active = cycle <= flame.dutyCycle;
        const flameLife = active ? cycle / flame.dutyCycle : 0;
        const bloom = active ? Math.sin(flameLife * Math.PI) * fade : 0;
        const shimmer = 0.88 + Math.sin(elapsed * 0.028 + flame.phase * 17.31) * 0.12;
        const flameHeight = 0.34 + bloom * 0.92;
        const visible = bloom > 0.035;
        const baseY = flame.groundY + GROUND_FLAME_OFFSET + bloom * 0.08;
        const yaw = flame.yaw + Math.sin(elapsedSeconds * 2.1 + flame.phase * Math.PI * 2) * 0.2;
        const scaleX = (0.82 + bloom * 0.36) * shimmer;
        const scaleZ = (0.82 + bloom * 0.3) * (1.76 - shimmer);

        if (!visible) {
          setInstancedMatrix(flameRingRef.current, index, GEARSTORM_HIDDEN_MATRIX);
          setInstancedMatrix(flameGlowRef.current, index, GEARSTORM_HIDDEN_MATRIX);
          for (let planeIndex = 0; planeIndex < GROUND_FLAME_PLANE_ANGLES.length; planeIndex++) {
            setInstancedMatrix(flameOuterRef.current, flamePlaneIndex, GEARSTORM_HIDDEN_MATRIX);
            setInstancedMatrix(flameInnerRef.current, flamePlaneIndex, GEARSTORM_HIDDEN_MATRIX);
            flamePlaneIndex++;
          }
          return;
        }

        matrixObject.position.set(flame.x, baseY + 0.015, flame.z);
        matrixObject.rotation.set(-Math.PI / 2, 0, yaw);
        matrixObject.scale.set(flame.radius * 1.28 * scaleX, flame.radius * 1.28 * scaleZ, 1);
        matrixObject.updateMatrix();
        setInstancedMatrix(flameRingRef.current, index, matrixObject.matrix);

        matrixObject.position.set(flame.x, baseY + flame.height * 0.24 * flameHeight, flame.z);
        matrixObject.rotation.set(flame.leanX, yaw, flame.leanZ);
        matrixObject.scale.set(
          flame.radius * 0.72 * scaleX,
          flame.height * 0.32 * flameHeight,
          flame.radius * 0.72 * scaleZ
        );
        matrixObject.updateMatrix();
        setInstancedMatrix(flameGlowRef.current, index, matrixObject.matrix);

        for (const planeAngle of GROUND_FLAME_PLANE_ANGLES) {
          matrixObject.position.set(flame.x, baseY, flame.z);
          matrixObject.rotation.set(flame.leanX, yaw + planeAngle, flame.leanZ);
          matrixObject.scale.set(flame.radius * scaleX, flame.height * flameHeight, 1);
          matrixObject.updateMatrix();
          setInstancedMatrix(flameOuterRef.current, flamePlaneIndex, matrixObject.matrix);

          matrixObject.position.set(flame.x, baseY + flame.height * 0.03 * flameHeight, flame.z);
          matrixObject.scale.set(flame.radius * 0.58 * scaleX, flame.height * 0.78 * flameHeight, 1);
          matrixObject.updateMatrix();
          setInstancedMatrix(flameInnerRef.current, flamePlaneIndex, matrixObject.matrix);
          flamePlaneIndex++;
        }
      });
      commitInstancedMesh(flameRingRef.current);
      commitInstancedMesh(flameGlowRef.current);
      commitInstancedMesh(flameOuterRef.current);
      commitInstancedMesh(flameInnerRef.current);
    }

    strike.cogs.forEach((cog, index) => {
      const phaseRatio = (cog.phase % (Math.PI * 2)) / (Math.PI * 2);
      const riseDelay = phaseRatio * COG_RISE_STAGGER_MS;
      const sinkDelay = (1 - phaseRatio) * COG_SINK_STAGGER_MS;
      const riseProgress = smoothstep01((elapsed - riseDelay) / COG_RISE_DURATION_MS);
      const sinkProgress = smoothstep01((AIR_STRIKE_DURATION - elapsed - sinkDelay) / COG_SINK_DURATION_MS);
      const liftProgress = Math.min(riseProgress, sinkProgress);
      const orbitAngle = cog.angle + elapsedSeconds * cog.orbitSpeed;
      const airborneY = cog.groundY + cog.height + Math.sin(elapsedSeconds * cog.bobSpeed + cog.phase) * cog.bobAmount;
      const buriedY = cog.groundY - COG_BURY_DEPTH * cog.size;

      if (liftProgress <= 0.001) {
        setInstancedMatrix(cogBodyRef.current, index, GEARSTORM_HIDDEN_MATRIX);
        setInstancedMatrix(cogInnerRingRef.current, index, GEARSTORM_HIDDEN_MATRIX);
        setInstancedMatrix(cogHubRef.current, index, GEARSTORM_HIDDEN_MATRIX);
        return;
      }

      matrixObject.position.set(
        strike.centerPosition.x + Math.cos(orbitAngle) * cog.radius,
        THREE.MathUtils.lerp(buriedY, airborneY, liftProgress),
        strike.centerPosition.z + Math.sin(orbitAngle) * cog.radius
      );
      matrixObject.rotation.set(
        cog.tiltX + Math.sin(elapsedSeconds * 0.8 + cog.phase) * 0.14,
        cog.yaw + elapsedSeconds * 0.12 + cog.tiltY,
        cog.phase + elapsedSeconds * cog.spinSpeed
      );
      matrixObject.scale.setScalar(cog.size);
      matrixObject.updateMatrix();
      setInstancedMatrix(cogBodyRef.current, index, matrixObject.matrix);

      tempVector.set(0, 0, 0.03 * cog.size).applyQuaternion(matrixObject.quaternion).add(matrixObject.position);
      childMatrixObject.position.copy(tempVector);
      childMatrixObject.quaternion.copy(matrixObject.quaternion);
      childMatrixObject.scale.setScalar(cog.size);
      childMatrixObject.updateMatrix();
      setInstancedMatrix(cogInnerRingRef.current, index, childMatrixObject.matrix);

      tempVector.set(0, 0, 0.07 * cog.size).applyQuaternion(matrixObject.quaternion).add(matrixObject.position);
      childMatrixObject.position.copy(tempVector);
      childMatrixObject.quaternion.copy(matrixObject.quaternion);
      childMatrixObject.scale.setScalar(cog.size);
      childMatrixObject.updateMatrix();
      setInstancedMatrix(cogHubRef.current, index, childMatrixObject.matrix);
    });
    commitInstancedMesh(cogBodyRef.current);
    commitInstancedMesh(cogInnerRingRef.current);
    commitInstancedMesh(cogHubRef.current);

    if (lightRef.current) {
      lightRef.current.position.set(strike.centerPosition.x, strike.groundY + 4.2, strike.centerPosition.z);
      lightRef.current.intensity = 12 * fade + Math.sin(elapsed * 0.012) * 1.8 * fade;
    }
  }));

  return (
    <group ref={groupRef}>
      <mesh
        ref={groundFillRef}
        position={[strike.centerPosition.x, strike.groundY + GROUND_FILL_OFFSET, strike.centerPosition.z]}
        rotation-x={-Math.PI / 2}
        geometry={SHARED_GEOMETRIES.circle32}
        material={materials.groundFill}
      />

      <mesh
        ref={groundRingRef}
        position={[strike.centerPosition.x, strike.groundY + GROUND_RING_OFFSET, strike.centerPosition.z]}
        rotation-x={-Math.PI / 2}
        geometry={SHARED_GEOMETRIES.ring32}
        material={materials.groundRing}
      />

      <mesh
        ref={groundHotCoreRef}
        position={[strike.centerPosition.x, strike.groundY + GROUND_HOT_CORE_OFFSET, strike.centerPosition.z]}
        rotation-x={-Math.PI / 2}
        geometry={SHARED_GEOMETRIES.circle16}
        material={materials.groundCore}
      />

      {patchGroups.orange.length > 0 && (
        <instancedMesh
          ref={(mesh) => {
            orangePatchRef.current = mesh;
            setInstancedMeshUsage(mesh);
          }}
          args={[SHARED_GEOMETRIES.circle16, materials.burnPatchOrange, patchGroups.orange.length]}
        />
      )}
      {patchGroups.yellow.length > 0 && (
        <instancedMesh
          ref={(mesh) => {
            yellowPatchRef.current = mesh;
            setInstancedMeshUsage(mesh);
          }}
          args={[SHARED_GEOMETRIES.circle16, materials.burnPatchYellow, patchGroups.yellow.length]}
        />
      )}

      <instancedMesh
        ref={(mesh) => {
          flameRingRef.current = mesh;
          setInstancedMeshUsage(mesh);
        }}
        args={[SHARED_GEOMETRIES.ring16, materials.flameRing, strike.groundFlames.length]}
      />
      <instancedMesh
        ref={(mesh) => {
          flameGlowRef.current = mesh;
          setInstancedMeshUsage(mesh);
        }}
        args={[SHARED_GEOMETRIES.sphere8, materials.flameGlow, strike.groundFlames.length]}
      />
      <instancedMesh
        ref={(mesh) => {
          flameOuterRef.current = mesh;
          setInstancedMeshUsage(mesh);
        }}
        args={[GROUND_FLAME_OUTER_GEOMETRY, materials.flameOuter, strike.groundFlames.length * GROUND_FLAME_PLANE_ANGLES.length]}
      />
      <instancedMesh
        ref={(mesh) => {
          flameInnerRef.current = mesh;
          setInstancedMeshUsage(mesh);
        }}
        args={[GROUND_FLAME_INNER_GEOMETRY, materials.flameInner, strike.groundFlames.length * GROUND_FLAME_PLANE_ANGLES.length]}
      />

      <instancedMesh
        ref={(mesh) => {
          cogBodyRef.current = mesh;
          setInstancedMeshUsage(mesh);
        }}
        args={[COG_BODY_GEOMETRY, materials.cogBody, strike.cogs.length]}
      />
      <instancedMesh
        ref={(mesh) => {
          cogInnerRingRef.current = mesh;
          setInstancedMeshUsage(mesh);
        }}
        args={[COG_INNER_RING_GEOMETRY, materials.cogInnerRing, strike.cogs.length]}
      />
      <instancedMesh
        ref={(mesh) => {
          cogHubRef.current = mesh;
          setInstancedMeshUsage(mesh);
        }}
        args={[COG_HUB_GEOMETRY, materials.cogHub, strike.cogs.length]}
      />

      <BudgetedPointLight
        budgetPriority={8}
        ref={lightRef}
        position={[strike.centerPosition.x, strike.groundY + 4.2, strike.centerPosition.z]}
        color={0xff4a00}
        intensity={12}
        distance={GEARSTORM_RADIUS * 2.1}
        decay={2}
      />
    </group>
  );
}

export function prewarmBlazeAirstrikeResources(): void {
  void COG_BODY_GEOMETRY;
  void COG_INNER_RING_GEOMETRY;
  void COG_HUB_GEOMETRY;
  void GROUND_FLAME_OUTER_GEOMETRY;
  void GROUND_FLAME_INNER_GEOMETRY;
  void GEARSTORM_BODY_MATERIAL_TEMPLATE;
  void GEARSTORM_FLAME_OUTER_MATERIAL_TEMPLATE;
}

function addGearstormPrewarmInstancedMesh(
  target: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  scale: [number, number, number] | number,
  rotation: [number, number, number] = [0, 0, 0]
): void {
  const mesh = new THREE.InstancedMesh(geometry, material, 1);
  const dummy = new THREE.Object3D();
  dummy.position.set(...position);
  dummy.rotation.set(...rotation);
  if (typeof scale === 'number') {
    dummy.scale.setScalar(scale);
  } else {
    dummy.scale.set(...scale);
  }
  dummy.updateMatrix();
  mesh.setMatrixAt(0, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  target.add(mesh);
}

export function appendBlazeAirstrikeGpuPrewarmObjects(target: THREE.Object3D): void {
  prewarmBlazeAirstrikeResources();
  const materials = createGearstormMaterials();

  addGearstormPrewarmInstancedMesh(target, COG_BODY_GEOMETRY, materials.cogBody, [1.55, -0.62, -4.45], 0.18, [0.42, 0.18, 0.24]);
  addGearstormPrewarmInstancedMesh(target, COG_INNER_RING_GEOMETRY, materials.cogInnerRing, [1.75, -0.62, -4.45], 0.16, [0.42, 0.18, 0.24]);
  addGearstormPrewarmInstancedMesh(target, COG_HUB_GEOMETRY, materials.cogHub, [1.93, -0.62, -4.45], 0.14, [0.42, 0.18, 0.24]);
  addGearstormPrewarmInstancedMesh(target, SHARED_GEOMETRIES.circle16, materials.burnPatchOrange, [2.18, -0.62, -4.45], [0.28, 0.16, 1], [-Math.PI / 2, 0, 0.4]);
  addGearstormPrewarmInstancedMesh(target, SHARED_GEOMETRIES.circle16, materials.burnPatchYellow, [2.45, -0.62, -4.45], [0.26, 0.18, 1], [-Math.PI / 2, 0, -0.24]);
  addGearstormPrewarmInstancedMesh(target, SHARED_GEOMETRIES.ring16, materials.flameRing, [2.75, -0.62, -4.45], [0.16, 0.16, 1], [-Math.PI / 2, 0, 0]);
  addGearstormPrewarmInstancedMesh(target, SHARED_GEOMETRIES.sphere8, materials.flameGlow, [2.98, -0.52, -4.45], [0.08, 0.22, 0.08]);
  addGearstormPrewarmInstancedMesh(target, GROUND_FLAME_OUTER_GEOMETRY, materials.flameOuter, [3.2, -0.7, -4.45], [0.12, 0.36, 1], [0, 0.2, 0]);
  addGearstormPrewarmInstancedMesh(target, GROUND_FLAME_INNER_GEOMETRY, materials.flameInner, [3.38, -0.7, -4.45], [0.08, 0.28, 1], [0, -0.2, 0]);
  addGearstormPrewarmInstancedMesh(target, SHARED_GEOMETRIES.circle32, materials.groundFill, [3.68, -0.72, -4.45], [0.24, 0.24, 1], [-Math.PI / 2, 0, 0]);
  addGearstormPrewarmInstancedMesh(target, SHARED_GEOMETRIES.ring32, materials.groundRing, [3.98, -0.72, -4.45], [0.24, 0.24, 1], [-Math.PI / 2, 0, 0]);
  addGearstormPrewarmInstancedMesh(target, SHARED_GEOMETRIES.circle16, materials.groundCore, [4.28, -0.72, -4.45], [0.18, 0.18, 1], [-Math.PI / 2, 0, 0]);
}

export function useAirStrikes() {
  const [activeStrikes, setActiveStrikes] = useState<AirStrikeData[]>([]);
  const lastRevisionRef = useRef(-1);

  useFrame(() => {
    const now = getFrameClock().nowMs;
    let changed = lastRevisionRef.current !== airStrikeRevision;

    for (let i = airStrikes.length - 1; i >= 0; i--) {
      if (now - airStrikes[i].frameStartTime >= AIR_STRIKE_DURATION + 300) {
        airStrikes.splice(i, 1);
        changed = true;
      }
    }

    if (changed) {
      lastRevisionRef.current = airStrikeRevision;
      setActiveStrikes([...airStrikes]);
    }

    recordEffectSlotDiagnostics('blazeAirstrike', {
      active: airStrikes.length,
      capacity: Math.max(1, airStrikes.length),
      hiddenMounted: 0,
    });
  });

  return activeStrikes;
}

export function AirStrikeEffects() {
  const activeStrikes = useAirStrikes();

  return (
    <>
      {activeStrikes.map(strike => (
        <InfernalGearstormEffect key={strike.id} strike={strike} />
      ))}
    </>
  );
}
