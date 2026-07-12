import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  ALL_HERO_IDS,
  DEFAULT_HERO_SKIN_IDS,
  HERO_DEFINITIONS,
  type HeroId,
  type HeroSkinId,
} from '@voxel-strike/shared';
import {
  clearExpiredDeathVisuals,
  getActiveDeathVisuals,
  visualStore,
  type DeathVisualSnapshot,
} from '../../store/visualStore';
import {
  EMPTY_RIGGED_PARTS,
  HERO_BONE_PIVOTS,
  getPartGeometry,
  groupRiggedParts,
} from '../../model-system/heroRig';
import {
  EMPTY_TEAM_ACCENT_PARTS,
} from '../../model-system/heroBodyManifests';
import { resolveHeroSkinModel } from '../../model-system/heroSkinModelResolver';
import { getHeroBodyRenderParts } from '../../model-system/heroBodyRenderParts';
import type {
  HeroBoneName,
  MaterialKind,
  RiggedVoxelPart,
  TeamAccentPart,
  VoxelPart,
} from '../../model-system/heroBodyTypes';
import {
  MOVEMENT_DIAGNOSTICS_ENABLED,
  measureFrameWork,
  recordEffectSlotDiagnostics,
  recordFrameAllocation,
} from '../../movement/networkDiagnostics';
import type { RagdollQualityConfig } from './visualQuality';

interface RagdollManagerProps {
  config: RagdollQualityConfig;
}

interface BoneRuntime {
  name: HeroBoneName;
  position: THREE.Vector3;
  previousPosition: THREE.Vector3;
  quaternion: THREE.Quaternion;
  angularVelocity: THREE.Vector3;
  floorRadius: number;
}

interface RagdollRuntime {
  bones: Record<HeroBoneName, BoneRuntime>;
  yawQuaternion: THREE.Quaternion;
  restDirections: Partial<Record<HeroBoneName, THREE.Vector3>>;
  restLengths: Partial<Record<HeroBoneName, number>>;
  scale: number;
  sleepMs: number;
  sleeping: boolean;
}

interface RagdollRenderResources {
  riggedPartsByBone: Record<HeroBoneName, RiggedVoxelPart<VoxelPart>[]>;
  riggedTeamAccentPartsByBone: Record<HeroBoneName, RiggedVoxelPart<TeamAccentPart>[]>;
  baseMaterialByKind: Map<MaterialKind, THREE.MeshStandardMaterial>;
}

interface RagdollSlotHandle {
  heroId: HeroId;
  skinId: HeroSkinId;
  poolIndex: number;
  group: THREE.Group | null;
  boneRefs: Partial<Record<HeroBoneName, THREE.Group | null>>;
  materialList: THREE.Material[];
  assignedSnapshotId: string | null;
  snapshot: DeathVisualSnapshot | null;
  runtime: RagdollRuntime | null;
  appliedOpacity: number;
  hidden: boolean;
  renderedModelKey: string | null;
}

const RAGDOLL_BONES: HeroBoneName[] = [
  'aura',
  'hips',
  'torso',
  'head',
  'leftLeg',
  'rightLeg',
  'leftKnee',
  'rightKnee',
  'leftShin',
  'rightShin',
  'leftArm',
  'rightArm',
  'leftForearm',
  'rightForearm',
];

const RENDER_BONES: HeroBoneName[] = [
  'hips',
  'torso',
  'head',
  'leftLeg',
  'rightLeg',
  'leftKnee',
  'rightKnee',
  'leftShin',
  'rightShin',
  'leftArm',
  'rightArm',
  'leftForearm',
  'rightForearm',
];

const BONE_PARENT: Partial<Record<HeroBoneName, HeroBoneName>> = {
  aura: 'hips',
  torso: 'hips',
  head: 'torso',
  leftLeg: 'hips',
  rightLeg: 'hips',
  leftKnee: 'leftLeg',
  rightKnee: 'rightLeg',
  leftShin: 'leftKnee',
  rightShin: 'rightKnee',
  leftArm: 'torso',
  rightArm: 'torso',
  leftForearm: 'leftArm',
  rightForearm: 'rightArm',
};

const GRAVITY = -13.5;
const FLOOR_Y = 0.035;
const LINEAR_DAMPING = 0.986;
const FLOOR_FRICTION = 0.58;
const FLOOR_BOUNCE = 0.16;
const MAX_FRAME_DT = 0.04;
const CONSTRAINT_ITERATIONS = 4;
const SLEEP_AFTER_MS = 720;
const SLEEP_SPEED_SQ = 0.000018;
const EXPIRY_SWEEP_INTERVAL_MS = 250;
const DEFAULT_HERO: HeroId = 'phantom';
const DEFAULT_SKIN = resolveHeroSkinModel(DEFAULT_HERO).skinId;

const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const tmpQuatA = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const ragdollYawAxis = new THREE.Vector3(0, 1, 0);
const ragdollRenderResourcesBySkin = new Map<HeroSkinId, RagdollRenderResources>();
function hash01(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 10000) / 10000;
}

function normalizeSnapshotDirection(snapshot: DeathVisualSnapshot): THREE.Vector3 {
  const source = snapshot.sourceDirection ?? snapshot.velocity;
  const direction = new THREE.Vector3(source.x, source.y, source.z);
  if (direction.lengthSq() > 0.0001) {
    return direction.normalize();
  }

  return new THREE.Vector3(
    Math.sin(snapshot.lookYaw),
    0,
    Math.cos(snapshot.lookYaw)
  ).normalize();
}

function getBoneFloorRadius(name: HeroBoneName): number {
  if (name === 'head') return 0.18;
  if (name === 'torso' || name === 'hips') return 0.22;
  if (name === 'leftShin' || name === 'rightShin') return 0.13;
  return 0.11;
}

function getBoneImpulseWeight(name: HeroBoneName): number {
  if (name === 'torso' || name === 'head') return 1.05;
  if (name === 'leftArm' || name === 'rightArm' || name === 'leftForearm' || name === 'rightForearm') return 1.34;
  if (name === 'leftShin' || name === 'rightShin') return 0.92;
  return 0.78;
}

function getScaledPivot(name: HeroBoneName, scale: number): THREE.Vector3 {
  const pivot = HERO_BONE_PIVOTS[name];
  return new THREE.Vector3(pivot[0] * scale, pivot[1] * scale, pivot[2] * scale);
}

function createRagdollRuntime(snapshot: DeathVisualSnapshot, height: number): RagdollRuntime {
  const scale = height / 1.8;
  const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(ragdollYawAxis, snapshot.lookYaw);
  const rootOrigin = new THREE.Vector3(
    snapshot.position.x,
    snapshot.position.y - height / 2,
    snapshot.position.z
  );
  const sourceDirection = normalizeSnapshotDirection(snapshot);
  const baseVelocity = new THREE.Vector3(
    snapshot.velocity.x,
    snapshot.velocity.y,
    snapshot.velocity.z
  );
  const movementBoost = snapshot.movement.isSliding
    ? 1.25
    : snapshot.movement.isJetpacking || !snapshot.movement.isGrounded
      ? 1.08
      : 0.86;
  const verticalLift = snapshot.movement.isJetpacking || !snapshot.movement.isGrounded ? 1.35 : 0.45;
  const rootVelocity = baseVelocity.multiplyScalar(0.48).addScaledVector(sourceDirection, 3.25 * movementBoost);
  rootVelocity.y += verticalLift;
  const right = new THREE.Vector3(Math.cos(snapshot.lookYaw), 0, -Math.sin(snapshot.lookYaw));

  const bones = {} as Record<HeroBoneName, BoneRuntime>;
  const restDirections: Partial<Record<HeroBoneName, THREE.Vector3>> = {};
  const restLengths: Partial<Record<HeroBoneName, number>> = {};

  for (const name of RAGDOLL_BONES) {
    const pivot = getScaledPivot(name, scale).applyQuaternion(yawQuaternion);
    const position = rootOrigin.clone().add(pivot);
    const lateralSeed = hash01(`${snapshot.id}:${name}:x`) * 2 - 1;
    const liftSeed = hash01(`${snapshot.id}:${name}:y`);
    const spinSeed = hash01(`${snapshot.id}:${name}:spin`) * 2 - 1;
    const boneVelocity = rootVelocity.clone()
      .addScaledVector(sourceDirection, getBoneImpulseWeight(name))
      .addScaledVector(right, lateralSeed * 1.15);
    boneVelocity.y += liftSeed * 0.72;
    const previousPosition = position.clone().addScaledVector(boneVelocity, -0.016);

    bones[name] = {
      name,
      position,
      previousPosition,
      quaternion: yawQuaternion.clone(),
      angularVelocity: new THREE.Vector3(
        1.4 + liftSeed * 2.4,
        spinSeed * 1.8,
        lateralSeed * 2.6
      ),
      floorRadius: getBoneFloorRadius(name) * scale,
    };
  }

  for (const name of RAGDOLL_BONES) {
    const parentName = BONE_PARENT[name];
    if (!parentName) continue;

    const restOffset = getScaledPivot(name, scale).sub(getScaledPivot(parentName, scale));
    restLengths[name] = restOffset.length();
    restDirections[name] = restOffset.applyQuaternion(yawQuaternion).normalize();
  }

  return {
    bones,
    yawQuaternion,
    restDirections,
    restLengths,
    scale,
    sleepMs: 0,
    sleeping: false,
  };
}

function applyFloorCollision(bone: BoneRuntime): void {
  const floor = FLOOR_Y + bone.floorRadius;
  if (bone.position.y >= floor) return;

  const velocityX = bone.position.x - bone.previousPosition.x;
  const velocityY = bone.position.y - bone.previousPosition.y;
  const velocityZ = bone.position.z - bone.previousPosition.z;
  bone.position.y = floor;
  bone.previousPosition.x = bone.position.x - velocityX * FLOOR_FRICTION;
  bone.previousPosition.y = bone.position.y + velocityY * FLOOR_BOUNCE;
  bone.previousPosition.z = bone.position.z - velocityZ * FLOOR_FRICTION;
}

function solveBoneConstraints(runtime: RagdollRuntime): void {
  const bones = runtime.bones;

  for (let iteration = 0; iteration < CONSTRAINT_ITERATIONS; iteration++) {
    for (const name of RAGDOLL_BONES) {
      const parentName = BONE_PARENT[name];
      const restLength = runtime.restLengths[name];
      if (!parentName || !restLength) continue;

      const child = bones[name];
      const parent = bones[parentName];
      tmpVecA.copy(child.position).sub(parent.position);
      const length = tmpVecA.length();
      if (length <= 0.0001) continue;

      const correctionScale = (length - restLength) / length;
      const parentWeight = parentName === 'hips' ? 0.22 : 0.38;
      const childWeight = 1 - parentWeight;
      tmpVecA.multiplyScalar(correctionScale);
      child.position.addScaledVector(tmpVecA, -childWeight);
      parent.position.addScaledVector(tmpVecA, parentWeight);
      applyFloorCollision(child);
      applyFloorCollision(parent);
    }
  }
}

function updateBoneOrientations(runtime: RagdollRuntime, dt: number): void {
  const bones = runtime.bones;

  for (const name of RAGDOLL_BONES) {
    const bone = bones[name];
    const parentName = BONE_PARENT[name];

    if (parentName && runtime.restDirections[name]) {
      tmpVecA.copy(runtime.restDirections[name]!);
      tmpVecB.copy(bone.position).sub(bones[parentName].position);
      if (tmpVecB.lengthSq() > 0.0001) {
        tmpVecB.normalize();
        tmpQuatA.setFromUnitVectors(tmpVecA, tmpVecB);
        bone.quaternion.copy(tmpQuatA).multiply(runtime.yawQuaternion).normalize();
      }
      continue;
    }

    tmpEuler.set(
      bone.angularVelocity.x * dt,
      bone.angularVelocity.y * dt,
      bone.angularVelocity.z * dt,
      'XYZ'
    );
    tmpQuatA.setFromEuler(tmpEuler);
    bone.quaternion.multiply(tmpQuatA).normalize();
    bone.angularVelocity.multiplyScalar(0.94);
  }
}

function stepRagdoll(runtime: RagdollRuntime, delta: number): void {
  if (runtime.sleeping) return;

  const dt = Math.min(delta, MAX_FRAME_DT);
  const substeps = Math.max(1, Math.ceil(dt / 0.016));
  const stepDt = dt / substeps;
  let maxSpeedSq = 0;

  for (let step = 0; step < substeps; step++) {
    for (const name of RAGDOLL_BONES) {
      const bone = runtime.bones[name];
      tmpVecA.copy(bone.position).sub(bone.previousPosition).multiplyScalar(LINEAR_DAMPING);
      bone.previousPosition.copy(bone.position);
      bone.position.add(tmpVecA);
      bone.position.y += GRAVITY * stepDt * stepDt;
      applyFloorCollision(bone);
    }

    solveBoneConstraints(runtime);
  }

  updateBoneOrientations(runtime, dt);

  for (const name of RAGDOLL_BONES) {
    const bone = runtime.bones[name];
    const speedSq = bone.position.distanceToSquared(bone.previousPosition);
    if (speedSq > maxSpeedSq) maxSpeedSq = speedSq;
  }

  if (maxSpeedSq <= SLEEP_SPEED_SQ) {
    runtime.sleepMs += dt * 1000;
    runtime.sleeping = runtime.sleepMs >= SLEEP_AFTER_MS;
  } else {
    runtime.sleepMs = 0;
  }
}

function getMaterialEmissiveIntensity(kind: MaterialKind): number {
  if (kind === 'glow') return 0.52;
  if (kind === 'eye') return 0.62;
  if (kind === 'accent') return 0.24;
  if (kind === 'mist') return 0.18;
  return 0;
}

function createRagdollBaseMaterials(heroId: HeroId, skinId: HeroSkinId): Map<MaterialKind, THREE.MeshStandardMaterial> {
  const manifest = resolveHeroSkinModel(heroId, skinId).bodyManifest;
  const materialByKind = new Map<MaterialKind, THREE.MeshStandardMaterial>();

  (Object.keys(manifest.materialPalette) as MaterialKind[]).forEach((kind) => {
    const baseColor = manifest.materialPalette[kind];
    const emissiveIntensity = getMaterialEmissiveIntensity(kind);
    const isTranslucent = kind === 'glass' || kind === 'mist';
    const material = new THREE.MeshStandardMaterial({
      color: baseColor,
      emissive: emissiveIntensity > 0 ? new THREE.Color(baseColor) : new THREE.Color('#000000'),
      emissiveIntensity,
      roughness: kind === 'glass' ? 0.2 : kind === 'eye' || kind === 'glow' ? 0.34 : 0.74,
      metalness: kind === 'armor' || kind === 'accent' || kind === 'edge' ? 0.24 : 0.04,
      transparent: isTranslucent,
      opacity: kind === 'mist' ? 0.18 : kind === 'glass' ? 0.52 : 1,
      depthWrite: !isTranslucent,
      toneMapped: kind !== 'eye' && kind !== 'glow',
    });
    material.userData.ragdollBaseOpacity = material.opacity;
    material.userData.ragdollBaseTransparent = material.transparent;
    material.userData.ragdollBaseDepthWrite = material.depthWrite;
    materialByKind.set(kind, material);
  });

  return materialByKind;
}

function getRagdollRenderResources(heroId: HeroId, skinId: HeroSkinId): RagdollRenderResources {
  const resolved = resolveHeroSkinModel(heroId, skinId);
  const cached = ragdollRenderResourcesBySkin.get(resolved.skinId);
  if (cached) return cached;

  const manifest = resolved.bodyManifest;
  const renderParts = getHeroBodyRenderParts(manifest.parts);
  const renderTeamAccentParts = getHeroBodyRenderParts(
    manifest.teamAccentParts ?? EMPTY_TEAM_ACCENT_PARTS,
    renderParts
  );
  const resources: RagdollRenderResources = {
    riggedPartsByBone: groupRiggedParts(renderParts),
    riggedTeamAccentPartsByBone: groupRiggedParts(renderTeamAccentParts),
    baseMaterialByKind: createRagdollBaseMaterials(heroId, resolved.skinId),
  };
  ragdollRenderResourcesBySkin.set(resolved.skinId, resources);
  return resources;
}

function createRagdollMaterialInstances(
  baseMaterialByKind: Map<MaterialKind, THREE.MeshStandardMaterial>
): Map<MaterialKind, THREE.MeshStandardMaterial> {
  const materialByKind = new Map<MaterialKind, THREE.MeshStandardMaterial>();
  baseMaterialByKind.forEach((baseMaterial, kind) => {
    materialByKind.set(kind, baseMaterial.clone());
  });
  return materialByKind;
}

export function prewarmRagdollRenderResources(): void {
  // Default skins cover the ragdoll shader/material variants up front. Other
  // cosmetic manifests are cheap CPU-only cache misses on their first death;
  // eagerly hydrating every catalog skin bloats landing-time work and memory.
  for (const heroId of ALL_HERO_IDS) {
    getRagdollRenderResources(heroId, DEFAULT_HERO_SKIN_IDS[heroId]);
  }
}

export function getRagdollGpuPrewarmMaterials(): THREE.Material[] {
  prewarmRagdollRenderResources();
  return Array.from(ragdollRenderResourcesBySkin.values()).flatMap((resources) => (
    Array.from(resources.baseMaterialByKind.values())
  ));
}

function applyRagdollOpacity(materials: THREE.Material[], opacity: number): void {
  const clamped = THREE.MathUtils.clamp(opacity, 0, 1);
  for (const material of materials) {
    const baseOpacity = typeof material.userData.ragdollBaseOpacity === 'number'
      ? material.userData.ragdollBaseOpacity
      : material.opacity;
    const baseTransparent = material.userData.ragdollBaseTransparent === true;
    const baseDepthWrite = material.userData.ragdollBaseDepthWrite !== false;
    const nextTransparent = clamped < 0.999 || baseTransparent;

    material.opacity = baseOpacity * clamped;
    if (material.transparent !== nextTransparent) {
      material.transparent = nextTransparent;
      material.needsUpdate = true;
    }
    material.depthWrite = clamped >= 0.999 && baseDepthWrite;
  }
}

function getFadeOpacity(snapshot: DeathVisualSnapshot, effectiveExpiresAt: number, nowMs: number): number {
  const lifetime = Math.max(1, effectiveExpiresAt - snapshot.startedAtMs);
  const age = nowMs - snapshot.startedAtMs;
  const fadeStart = lifetime * 0.76;
  if (age <= fadeStart) return 1;
  return 1 - THREE.MathUtils.clamp((age - fadeStart) / Math.max(1, lifetime - fadeStart), 0, 1);
}

function createRagdollSlotHandle(poolIndex: number): RagdollSlotHandle {
  return {
    heroId: DEFAULT_HERO,
    skinId: DEFAULT_SKIN,
    poolIndex,
    group: null,
    boneRefs: {},
    materialList: [],
    assignedSnapshotId: null,
    snapshot: null,
    runtime: null,
    appliedOpacity: -1,
    hidden: true,
    renderedModelKey: null,
  };
}

function createRagdollSlotPool(maxTotal: number): RagdollSlotHandle[] {
  const clampedMax = Math.max(0, maxTotal);
  return Array.from({ length: clampedMax }, (_, poolIndex) => createRagdollSlotHandle(poolIndex));
}

function clearRagdollSlot(handle: RagdollSlotHandle): void {
  handle.assignedSnapshotId = null;
  handle.snapshot = null;
  handle.runtime = null;
  handle.appliedOpacity = -1;
  handle.hidden = true;
  if (handle.group) {
    handle.group.visible = false;
  }
}

function findRagdollSlotForSnapshot(
  pool: RagdollSlotHandle[],
  snapshotId: string
): RagdollSlotHandle | null {
  for (const handle of pool) {
    if (handle.assignedSnapshotId === snapshotId) {
      return handle;
    }
  }
  return null;
}

function findFreeRagdollSlot(pool: RagdollSlotHandle[]): RagdollSlotHandle | null {
  for (const handle of pool) {
    if (!handle.assignedSnapshotId) {
      return handle;
    }
  }
  return null;
}

function activateRagdollSlot(
  handle: RagdollSlotHandle,
  snapshot: DeathVisualSnapshot,
  heroId: HeroId,
  skinId: HeroSkinId
): boolean {
  return measureFrameWork('event.ragdoll.activateSlot', () => {
    const nextModelKey = `${heroId}:${skinId}`;
    const modelChanged = handle.renderedModelKey !== nextModelKey;
    handle.heroId = heroId;
    handle.skinId = skinId;
    if (modelChanged) {
      handle.boneRefs = {};
      handle.materialList = [];
      if (handle.group) handle.group.visible = false;
    }
    const height = HERO_DEFINITIONS[heroId].stats.size.height;
    handle.assignedSnapshotId = snapshot.id;
    handle.snapshot = snapshot;
    handle.runtime = measureFrameWork('event.ragdoll.createRuntime', () => {
      recordFrameAllocation('ragdoll.runtime');
      return createRagdollRuntime(snapshot, height);
    });
    handle.appliedOpacity = -1;
    handle.hidden = modelChanged;
    if (!modelChanged) applyRagdollOpacity(handle.materialList, 1);
    if (!modelChanged && handle.group) {
      handle.group.visible = true;
    }
    return modelChanged;
  });
}

function updateRagdollSlot(handle: RagdollSlotHandle, delta: number, nowMs: number): boolean {
  const snapshot = handle.snapshot;
  const runtime = handle.runtime;
  const root = handle.group;
  if (!snapshot || !runtime || !root) return false;

  // A slot stays active while React swaps its lazily selected hero model.
  // Removing it from the active list here would leave the newly rendered
  // model visible but never simulated or faded until another death revision.
  if (handle.renderedModelKey !== `${handle.heroId}:${handle.skinId}`) return true;

  if (!handle.hidden && !root.visible) {
    root.visible = true;
  }

  if (nowMs >= snapshot.expiresAtMs && !handle.hidden) {
    handle.hidden = true;
    root.visible = false;
  }

  if (!handle.hidden) {
    stepRagdoll(runtime, delta);
  }

  const opacity = getFadeOpacity(snapshot, snapshot.expiresAtMs, nowMs);
  if (Math.abs(handle.appliedOpacity - opacity) > 0.002) {
    handle.appliedOpacity = opacity;
    applyRagdollOpacity(handle.materialList, opacity);
  }

  for (const boneName of RENDER_BONES) {
    const node = handle.boneRefs[boneName];
    const bone = runtime.bones[boneName];
    if (!node || !bone) continue;

    node.position.copy(bone.position);
    node.quaternion.copy(bone.quaternion);
    node.scale.setScalar(runtime.scale);
  }

  return !handle.hidden;
}

function syncRagdollSlots(
  pool: RagdollSlotHandle[],
  activeSnapshots: DeathVisualSnapshot[]
): { activeHandles: RagdollSlotHandle[]; modelChanged: boolean } {
  let modelChanged = false;
  const activeIds = new Set<string>();
  for (const snapshot of activeSnapshots) {
    activeIds.add(snapshot.id);
  }

  for (const handle of pool) {
    if (handle.assignedSnapshotId && !activeIds.has(handle.assignedSnapshotId)) {
      clearRagdollSlot(handle);
    }
  }

  for (const snapshot of activeSnapshots) {
    const heroId = snapshot.heroId ?? DEFAULT_HERO;
    const skinId = resolveHeroSkinModel(heroId, snapshot.skinId).skinId;
    if (findRagdollSlotForSnapshot(pool, snapshot.id)) continue;

    const freeSlot = findFreeRagdollSlot(pool);
    if (freeSlot) {
      modelChanged = activateRagdollSlot(freeSlot, snapshot, heroId, skinId) || modelChanged;
    }
  }

  const activeHandles: RagdollSlotHandle[] = [];
  for (const handle of pool) {
    if (handle.assignedSnapshotId !== null) {
      activeHandles.push(handle);
    }
  }
  return { activeHandles, modelChanged };
}

function RagdollPartMeshes({
  parts,
  materialByKind,
  castShadow,
}: {
  parts: RiggedVoxelPart<VoxelPart>[];
  materialByKind: Map<MaterialKind, THREE.MeshStandardMaterial>;
  castShadow: boolean;
}) {
  return (
    <>
      {parts.map((riggedPart, index) => (
        <mesh
          key={riggedPart.part.id ?? `${riggedPart.bone}-${index}`}
          position={riggedPart.meshOffset}
          rotation={riggedPart.part.rotation}
          scale={riggedPart.part.scale}
          castShadow={castShadow}
          geometry={getPartGeometry(riggedPart.part)}
        >
          <primitive object={materialByKind.get(riggedPart.part.material)!} attach="material" />
        </mesh>
      ))}
    </>
  );
}

function RagdollTeamAccentMeshes({
  parts,
  materialByKind,
  castShadow,
}: {
  parts: RiggedVoxelPart<TeamAccentPart>[];
  materialByKind: Map<MaterialKind, THREE.MeshStandardMaterial>;
  castShadow: boolean;
}) {
  return (
    <>
      {parts.map((riggedPart, index) => (
        <mesh
          key={`team-${riggedPart.part.id ?? `${riggedPart.bone}-${index}`}`}
          position={riggedPart.meshOffset}
          rotation={riggedPart.part.rotation}
          scale={riggedPart.part.scale}
          castShadow={castShadow}
          geometry={getPartGeometry(riggedPart.part)}
        >
          <primitive object={materialByKind.get(riggedPart.part.material)!} attach="material" />
        </mesh>
      ))}
    </>
  );
}

const PooledRagdollSlot = memo(function PooledRagdollSlot({
  handle,
  modelKey,
  castShadows,
}: {
  handle: RagdollSlotHandle;
  modelKey: string;
  castShadows: boolean;
}) {
  const resolvedHero = handle.heroId;
  const renderResources = getRagdollRenderResources(resolvedHero, handle.skinId);
  const materialByKind = useMemo(
    () => measureFrameWork('event.ragdoll.createMaterials', () => (
      createRagdollMaterialInstances(renderResources.baseMaterialByKind)
    )),
    [renderResources]
  );
  const materialList = useMemo(
    () => [...materialByKind.values()],
    [materialByKind]
  );

  handle.materialList = materialList;

  useLayoutEffect(() => {
    handle.renderedModelKey = modelKey;
    if (!handle.assignedSnapshotId) return;
    handle.hidden = false;
    applyRagdollOpacity(materialList, 1);
    if (handle.group) handle.group.visible = true;
  }, [handle, materialList, modelKey]);

  useEffect(() => {
    return () => {
      materialByKind.forEach((material) => material.dispose());
    };
  }, [materialByKind]);

  const renderPartsForBone = (bone: HeroBoneName) => (
    <>
      <RagdollPartMeshes
        parts={renderResources.riggedPartsByBone[bone] ?? EMPTY_RIGGED_PARTS}
        materialByKind={materialByKind}
        castShadow={castShadows}
      />
      <RagdollTeamAccentMeshes
        parts={renderResources.riggedTeamAccentPartsByBone[bone] ?? EMPTY_RIGGED_PARTS}
        materialByKind={materialByKind}
        castShadow={castShadows}
      />
    </>
  );

  return (
    <group ref={(node) => {
      handle.group = node;
      if (node) {
        node.visible = Boolean(handle.assignedSnapshotId) && !handle.hidden;
      }
    }} visible={false}>
      <group ref={(node) => { handle.boneRefs.hips = node; }}>
        {renderPartsForBone('hips')}
      </group>
      <group ref={(node) => { handle.boneRefs.torso = node; }}>
        {renderPartsForBone('torso')}
      </group>
      <group ref={(node) => { handle.boneRefs.head = node; }}>
        {renderPartsForBone('head')}
      </group>
      <group ref={(node) => { handle.boneRefs.leftLeg = node; }}>
        {renderPartsForBone('leftLeg')}
      </group>
      <group ref={(node) => { handle.boneRefs.rightLeg = node; }}>
        {renderPartsForBone('rightLeg')}
      </group>
      <group ref={(node) => { handle.boneRefs.leftKnee = node; }}>
        {renderPartsForBone('leftKnee')}
      </group>
      <group ref={(node) => { handle.boneRefs.rightKnee = node; }}>
        {renderPartsForBone('rightKnee')}
      </group>
      <group ref={(node) => { handle.boneRefs.leftShin = node; }}>
        {renderPartsForBone('leftShin')}
      </group>
      <group ref={(node) => { handle.boneRefs.rightShin = node; }}>
        {renderPartsForBone('rightShin')}
      </group>
      <group ref={(node) => { handle.boneRefs.leftArm = node; }}>
        {renderPartsForBone('leftArm')}
      </group>
      <group ref={(node) => { handle.boneRefs.rightArm = node; }}>
        {renderPartsForBone('rightArm')}
      </group>
      <group ref={(node) => { handle.boneRefs.leftForearm = node; }}>
        {renderPartsForBone('leftForearm')}
      </group>
      <group ref={(node) => { handle.boneRefs.rightForearm = node; }}>
        {renderPartsForBone('rightForearm')}
      </group>
    </group>
  );
});

export function RagdollManager({ config }: RagdollManagerProps) {
  const poolHandlesRef = useRef<RagdollSlotHandle[]>([]);
  const [, setPoolRevision] = useState(0);
  if (poolHandlesRef.current.length < config.maxTotal) {
    const firstNewSlot = poolHandlesRef.current.length;
    const newSlots = createRagdollSlotPool(config.maxTotal - firstNewSlot);
    for (let index = 0; index < newSlots.length; index++) {
      newSlots[index].poolIndex = firstNewSlot + index;
      poolHandlesRef.current.push(newSlots[index]);
    }
  }
  const poolHandles = poolHandlesRef.current;
  const lastExpirySweepRef = useRef(0);
  const lastSyncedDeathRevisionRef = useRef(-1);
  const activeHandlesRef = useRef<RagdollSlotHandle[]>([]);

  useEffect(() => {
    lastSyncedDeathRevisionRef.current = -1;
    activeHandlesRef.current = [];
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      recordEffectSlotDiagnostics('ragdolls', {
        active: 0,
        hiddenMounted: poolHandles.length,
        capacity: config.maxTotal,
      });
    }

  }, [config.maxTotal, poolHandles.length]);

  useEffect(() => () => {
    poolHandlesRef.current.forEach(clearRagdollSlot);
  }, []);

  useFrame((_, delta) => {
    if (MOVEMENT_DIAGNOSTICS_ENABLED) {
      measureFrameWork('frame.effects.ragdollManager', () => {
        const now = Date.now();
        if (now - lastExpirySweepRef.current >= EXPIRY_SWEEP_INTERVAL_MS) {
          lastExpirySweepRef.current = now;
          clearExpiredDeathVisuals(now);
        }

        const deathVisualRevision = visualStore.getState().deathVisualRevision;
        if (deathVisualRevision !== lastSyncedDeathRevisionRef.current) {
          lastSyncedDeathRevisionRef.current = deathVisualRevision;
          const activeSnapshots = config.maxTotal <= 0
            ? []
            : getActiveDeathVisuals(now).slice(0, config.maxTotal);
          const syncResult = syncRagdollSlots(poolHandles, activeSnapshots);
          activeHandlesRef.current = syncResult.activeHandles;
          if (syncResult.modelChanged) setPoolRevision((revision) => revision + 1);
          recordEffectSlotDiagnostics('ragdolls', {
            active: activeSnapshots.length,
            hiddenMounted: Math.max(0, poolHandles.length - activeSnapshots.length),
            capacity: config.maxTotal,
          });
        }
      });
    } else {
      const now = Date.now();
      if (now - lastExpirySweepRef.current >= EXPIRY_SWEEP_INTERVAL_MS) {
        lastExpirySweepRef.current = now;
        clearExpiredDeathVisuals(now);
      }

      const deathVisualRevision = visualStore.getState().deathVisualRevision;
      if (deathVisualRevision !== lastSyncedDeathRevisionRef.current) {
        lastSyncedDeathRevisionRef.current = deathVisualRevision;
        const activeSnapshots = config.maxTotal <= 0
          ? []
          : getActiveDeathVisuals(now).slice(0, config.maxTotal);
        const syncResult = syncRagdollSlots(poolHandles, activeSnapshots);
        activeHandlesRef.current = syncResult.activeHandles;
        if (syncResult.modelChanged) setPoolRevision((revision) => revision + 1);
      }
    }

    if (activeHandlesRef.current.length > 0) {
      if (MOVEMENT_DIAGNOSTICS_ENABLED) {
        measureFrameWork('frame.effects.ragdollBody', () => {
          const activeHandles = activeHandlesRef.current;
          const now = Date.now();
          let writeIndex = 0;
          for (let readIndex = 0; readIndex < activeHandles.length; readIndex++) {
            const handle = activeHandles[readIndex];
            if (!updateRagdollSlot(handle, delta, now)) continue;
            activeHandles[writeIndex] = handle;
            writeIndex++;
          }
          activeHandles.length = writeIndex;
        });
      } else {
        const activeHandles = activeHandlesRef.current;
        const now = Date.now();
        let writeIndex = 0;
        for (let readIndex = 0; readIndex < activeHandles.length; readIndex++) {
          const handle = activeHandles[readIndex];
          if (!updateRagdollSlot(handle, delta, now)) continue;
          activeHandles[writeIndex] = handle;
          writeIndex++;
        }
        activeHandles.length = writeIndex;
      }
    }
  });

  if (poolHandles.length === 0) return null;

  return (
    <group>
      {poolHandles.map((handle) => (
        <PooledRagdollSlot
          key={handle.poolIndex}
          handle={handle}
          modelKey={`${handle.heroId}:${handle.skinId}`}
          castShadows={config.castShadows && handle.poolIndex < config.maxHighQuality}
        />
      ))}
    </group>
  );
}
