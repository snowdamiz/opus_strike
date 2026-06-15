import { memo, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useStore } from 'zustand';
import * as THREE from 'three';
import { HERO_DEFINITIONS, type HeroId } from '@voxel-strike/shared';
import {
  clearExpiredDeathVisuals,
  getActiveDeathVisuals,
  visualStore,
  type DeathVisualSnapshot,
} from '../../store/visualStore';
import {
  EMPTY_RIGGED_PARTS,
  HERO_BONE_PIVOTS,
  HERO_PART_GEOMETRIES,
  getPartGeometry,
  groupRiggedParts,
} from '../../model-system/heroRig';
import {
  EMPTY_TEAM_ACCENT_PARTS,
  HERO_BODY_MANIFESTS,
} from '../../model-system/heroBodyManifests';
import type {
  HeroBoneName,
  MaterialKind,
  RiggedVoxelPart,
  TeamAccentPart,
  VoxelPart,
} from '../../model-system/heroBodyTypes';
import type { RagdollQualityConfig } from './visualQuality';

interface RagdollManagerProps {
  config: RagdollQualityConfig;
}

interface RagdollBodyProps {
  snapshot: DeathVisualSnapshot;
  highQuality: boolean;
  castShadows: boolean;
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

const tmpVecA = new THREE.Vector3();
const tmpVecB = new THREE.Vector3();
const tmpQuatA = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();

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
  const yawQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), snapshot.lookYaw);
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

  const bones = {} as Record<HeroBoneName, BoneRuntime>;
  const restDirections: Partial<Record<HeroBoneName, THREE.Vector3>> = {};
  const restLengths: Partial<Record<HeroBoneName, number>> = {};

  for (const name of RAGDOLL_BONES) {
    const pivot = getScaledPivot(name, scale).applyQuaternion(yawQuaternion);
    const position = rootOrigin.clone().add(pivot);
    const lateralSeed = hash01(`${snapshot.id}:${name}:x`) * 2 - 1;
    const liftSeed = hash01(`${snapshot.id}:${name}:y`);
    const spinSeed = hash01(`${snapshot.id}:${name}:spin`) * 2 - 1;
    const right = new THREE.Vector3(Math.cos(snapshot.lookYaw), 0, -Math.sin(snapshot.lookYaw));
    const boneVelocity = rootVelocity.clone()
      .addScaledVector(sourceDirection, getBoneImpulseWeight(name))
      .addScaledVector(right, lateralSeed * 1.15)
      .add(new THREE.Vector3(0, liftSeed * 0.72, 0));
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

function createRagdollMaterials(heroId: HeroId): Map<MaterialKind, THREE.MeshStandardMaterial> {
  const manifest = HERO_BODY_MANIFESTS[heroId];
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
          key={`${riggedPart.bone}-${index}`}
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
          key={`team-${riggedPart.bone}-${index}`}
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

const RagdollBody = memo(function RagdollBody({
  snapshot,
  highQuality,
  castShadows,
}: RagdollBodyProps) {
  const resolvedHero = snapshot.heroId ?? DEFAULT_HERO;
  const heroStats = HERO_DEFINITIONS[resolvedHero].stats;
  const height = heroStats.size.height;
  const runtimeRef = useRef<RagdollRuntime | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const boneRefs = useRef<Partial<Record<HeroBoneName, THREE.Group | null>>>({});
  const appliedOpacityRef = useRef(-1);
  const hiddenRef = useRef(false);
  const effectiveExpiresAt = snapshot.expiresAtMs;
  const manifest = HERO_BODY_MANIFESTS[resolvedHero];
  const riggedPartsByBone = useMemo(() => groupRiggedParts(manifest.parts), [manifest.parts]);
  const riggedTeamAccentPartsByBone = useMemo(
    () => groupRiggedParts(manifest.teamAccentParts ?? EMPTY_TEAM_ACCENT_PARTS),
    [manifest.teamAccentParts]
  );
  const materialByKind = useMemo(
    () => createRagdollMaterials(resolvedHero),
    [resolvedHero]
  );
  const materialList = useMemo(
    () => [...materialByKind.values()],
    [materialByKind]
  );
  const shouldCastShadow = highQuality && castShadows;

  if (!runtimeRef.current) {
    runtimeRef.current = createRagdollRuntime(snapshot, height);
  }

  useEffect(() => {
    return () => {
      materialByKind.forEach((material) => material.dispose());
    };
  }, [materialByKind]);

  useFrame((_, delta) => {
    const runtime = runtimeRef.current;
    const root = groupRef.current;
    if (!runtime || !root) return;

    const nowMs = Date.now();
    if (nowMs >= effectiveExpiresAt && !hiddenRef.current) {
      hiddenRef.current = true;
      root.visible = false;
    }

    if (!hiddenRef.current) {
      stepRagdoll(runtime, delta);
    }

    const opacity = getFadeOpacity(snapshot, effectiveExpiresAt, nowMs);
    if (Math.abs(appliedOpacityRef.current - opacity) > 0.002) {
      appliedOpacityRef.current = opacity;
      applyRagdollOpacity(materialList, opacity);
    }

    for (const boneName of RENDER_BONES) {
      const node = boneRefs.current[boneName];
      const bone = runtime.bones[boneName];
      if (!node || !bone) continue;

      node.position.copy(bone.position);
      node.quaternion.copy(bone.quaternion);
      node.scale.setScalar(runtime.scale);
    }
  });

  const renderPartsForBone = (bone: HeroBoneName) => (
    <>
      <RagdollPartMeshes
        parts={riggedPartsByBone[bone] ?? EMPTY_RIGGED_PARTS}
        materialByKind={materialByKind}
        castShadow={shouldCastShadow}
      />
      <RagdollTeamAccentMeshes
        parts={riggedTeamAccentPartsByBone[bone] ?? EMPTY_RIGGED_PARTS}
        materialByKind={materialByKind}
        castShadow={shouldCastShadow}
      />
    </>
  );

  const renderKneeJoint = (side: 'left' | 'right') => (
    <>
      <mesh
        key={`${resolvedHero}-${side}-ragdoll-knee-cap`}
        position={[0, 0.015, -0.185]}
        scale={[0.18, 0.08, 0.05]}
        castShadow={shouldCastShadow}
        geometry={HERO_PART_GEOMETRIES.box}
      >
        <primitive object={materialByKind.get('edge')!} attach="material" />
      </mesh>
      <mesh
        key={`${resolvedHero}-${side}-ragdoll-knee-glow`}
        position={[0, 0.018, -0.222]}
        scale={[0.105, 0.028, 0.026]}
        castShadow={shouldCastShadow}
        geometry={HERO_PART_GEOMETRIES.box}
      >
        <primitive object={materialByKind.get('accent')!} attach="material" />
      </mesh>
    </>
  );

  const renderUpperLegLink = (side: 'left' | 'right') => (
    <mesh
      key={`${resolvedHero}-${side}-ragdoll-upper-leg-link`}
      position={[0, -0.15, -0.018]}
      scale={[0.17, 0.3, 0.13]}
      castShadow={shouldCastShadow}
      geometry={HERO_PART_GEOMETRIES.box}
    >
      <primitive object={materialByKind.get('dark')!} attach="material" />
    </mesh>
  );

  return (
    <group ref={groupRef}>
      <group ref={(node) => { boneRefs.current.hips = node; }}>
        {renderPartsForBone('hips')}
      </group>
      <group ref={(node) => { boneRefs.current.torso = node; }}>
        {renderPartsForBone('torso')}
      </group>
      <group ref={(node) => { boneRefs.current.head = node; }}>
        {renderPartsForBone('head')}
      </group>
      <group ref={(node) => { boneRefs.current.leftLeg = node; }}>
        {renderUpperLegLink('left')}
        {renderPartsForBone('leftLeg')}
      </group>
      <group ref={(node) => { boneRefs.current.rightLeg = node; }}>
        {renderUpperLegLink('right')}
        {renderPartsForBone('rightLeg')}
      </group>
      <group ref={(node) => { boneRefs.current.leftKnee = node; }}>
        {renderKneeJoint('left')}
      </group>
      <group ref={(node) => { boneRefs.current.rightKnee = node; }}>
        {renderKneeJoint('right')}
      </group>
      <group ref={(node) => { boneRefs.current.leftShin = node; }}>
        {renderPartsForBone('leftShin')}
      </group>
      <group ref={(node) => { boneRefs.current.rightShin = node; }}>
        {renderPartsForBone('rightShin')}
      </group>
      <group ref={(node) => { boneRefs.current.leftArm = node; }}>
        {renderPartsForBone('leftArm')}
      </group>
      <group ref={(node) => { boneRefs.current.rightArm = node; }}>
        {renderPartsForBone('rightArm')}
      </group>
      <group ref={(node) => { boneRefs.current.leftForearm = node; }}>
        {renderPartsForBone('leftForearm')}
      </group>
      <group ref={(node) => { boneRefs.current.rightForearm = node; }}>
        {renderPartsForBone('rightForearm')}
      </group>
    </group>
  );
});

export function RagdollManager({ config }: RagdollManagerProps) {
  const deathVisualRevision = useStore(visualStore, (state) => state.deathVisualRevision);
  const lastExpirySweepRef = useRef(0);
  const activeSnapshots = useMemo(() => {
    if (config.maxTotal <= 0) return [];
    return getActiveDeathVisuals(Date.now()).slice(0, config.maxTotal);
  }, [config.maxTotal, deathVisualRevision]);

  useFrame(() => {
    const now = Date.now();
    if (now - lastExpirySweepRef.current < EXPIRY_SWEEP_INTERVAL_MS) return;
    lastExpirySweepRef.current = now;
    clearExpiredDeathVisuals(now);
  });

  if (activeSnapshots.length === 0) return null;

  return (
    <group>
      {activeSnapshots.map((snapshot, index) => (
        <RagdollBody
          key={snapshot.id}
          snapshot={snapshot}
          highQuality={index < config.maxHighQuality}
          castShadows={config.castShadows}
        />
      ))}
    </group>
  );
}
