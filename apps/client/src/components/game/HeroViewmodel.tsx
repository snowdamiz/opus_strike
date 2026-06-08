import { memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShallow } from 'zustand/shallow';
import type { HeroId } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  getPhantomPrimaryHeldBlend,
  getPhantomPrimaryShotPulse,
  type PhantomPrimaryPoseSampleContext,
} from '../../viewmodel/phantomPrimaryPose';
import {
  registerViewmodelPoseSampler,
  registerViewmodelSocket,
  type ViewmodelSocketPoseDraft,
} from '../../viewmodel/viewmodelSocketRegistry';
import {
  BLAZE_COLORS,
  HOOKSHOT_COLORS,
  PHANTOM_COLORS,
  SHARED_GEOMETRIES,
  getHookshotMaterials,
} from './effectResources';

type ViewmodelHeroId = Extract<HeroId, 'phantom' | 'hookshot' | 'blaze'>;

interface ViewmodelActionState {
  active: boolean;
  charging: boolean;
  targeting: boolean;
}

interface ViewmodelMaterialSet {
  armor: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
}

interface HeroViewmodelProps {
  heroId: ViewmodelHeroId;
  action: ViewmodelActionState;
}

const VIEWMODEL_HEROES = new Set<HeroId>(['phantom', 'hookshot', 'blaze']);
const materialCache = new Map<ViewmodelHeroId, ViewmodelMaterialSet>();

interface MutableTransformTarget {
  position: THREE.Vector3;
  rotation: THREE.Euler;
}

interface PhantomPrimaryAttackState {
  eventId: string;
  side: -1 | 1;
  startTimeMs: number;
}

interface PhantomHandPoseTargets {
  arm: MutableTransformTarget;
  wrist: MutableTransformTarget;
  palm: MutableTransformTarget;
  thumb: MutableTransformTarget;
  fingers: MutableTransformTarget[];
}

const VIEWMODEL_ROOT_EULER_ORDER = 'XYZ';
const PHANTOM_VIEWMODEL_OFFSET = new THREE.Vector3(0, 0.28, -0.04);
const PHANTOM_PALM_SOCKET_OFFSET = new THREE.Vector3(0, 0.012, -0.4);
const PHANTOM_CLOSED_FINGER_ROWS = [-0.066, -0.022, 0.022, 0.066] as const;
const PHANTOM_OPEN_FINGER_SLOTS = [-0.056, -0.019, 0.019, 0.056] as const;
const PHANTOM_IDLE_HAND_POSITION = {
  x: 0.326,
  y: -0.52,
  z: -0.605,
} as const;
const PHANTOM_IDLE_HAND_ROTATION = {
  x: 0.33,
  y: 0.38,
  z: -0.14,
} as const;

const matrixPosition = new THREE.Vector3();
const matrixQuaternion = new THREE.Quaternion();
const matrixUnitScale = new THREE.Vector3(1, 1, 1);
const phantomWorldScale = new THREE.Vector3(1, 1, 1);
const matrixEuler = new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER);
const viewmodelRootMatrix = new THREE.Matrix4();
const phantomOffsetMatrix = new THREE.Matrix4();
const phantomArmMatrix = new THREE.Matrix4();
const phantomWristMatrix = new THREE.Matrix4();
const phantomPalmMatrix = new THREE.Matrix4();
const phantomSocketMatrix = new THREE.Matrix4();
const phantomWorldMatrix = new THREE.Matrix4();
const phantomWorldPosition = new THREE.Vector3();
const phantomWorldQuaternion = new THREE.Quaternion();

const HERO_MATERIAL_COLORS: Record<ViewmodelHeroId, {
  armor: number;
  dark: number;
  metal: number;
  accent: number;
  glow: number;
  glass: number;
}> = {
  phantom: {
    armor: 0x302447,
    dark: 0x090612,
    metal: 0x211833,
    accent: PHANTOM_COLORS.violet,
    glow: PHANTOM_COLORS.lightPurple,
    glass: 0x251a3a,
  },
  hookshot: {
    armor: 0x1f3b4a,
    dark: 0x10242e,
    metal: HOOKSHOT_COLORS.metal,
    accent: HOOKSHOT_COLORS.energy,
    glow: HOOKSHOT_COLORS.energy,
    glass: 0x22d3ee,
  },
  blaze: {
    armor: 0x7c2d12,
    dark: 0x1f130d,
    metal: BLAZE_COLORS.metal,
    accent: BLAZE_COLORS.fireOrange,
    glow: BLAZE_COLORS.fireYellow,
    glass: 0xfb923c,
  },
};

function isViewmodelHero(heroId: HeroId | '' | null | undefined): heroId is ViewmodelHeroId {
  return Boolean(heroId && VIEWMODEL_HEROES.has(heroId));
}

function getViewmodelMaterials(heroId: ViewmodelHeroId): ViewmodelMaterialSet {
  const cached = materialCache.get(heroId);
  if (cached) return cached;

  const colors = HERO_MATERIAL_COLORS[heroId];
  const materials: ViewmodelMaterialSet = {
    armor: new THREE.MeshStandardMaterial({
      color: colors.armor,
      metalness: 0.3,
      roughness: 0.42,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: colors.dark,
      metalness: 0.24,
      roughness: 0.6,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: colors.metal,
      metalness: 0.76,
      roughness: 0.25,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: 0.34,
      metalness: 0.2,
      roughness: 0.32,
    }),
    glow: new THREE.MeshBasicMaterial({
      color: colors.glow,
      toneMapped: false,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: colors.glass,
      emissive: colors.glass,
      emissiveIntensity: 0.26,
      metalness: 0.1,
      roughness: 0.18,
    }),
  };

  materialCache.set(heroId, materials);
  return materials;
}

function getActionState(heroId: ViewmodelHeroId): ViewmodelActionState {
  const store = useGameStore.getState();
  const localPlayerId = store.localPlayer?.id;

  switch (heroId) {
    case 'phantom':
      return {
        active: store.voidRays.some(ray => ray.ownerId === localPlayerId),
        charging: store.voidRayCharging,
        targeting: store.shadowStepTargeting,
      };
    case 'hookshot':
      return {
        active:
          store.hookProjectiles.some(hook => hook.ownerId === localPlayerId) ||
          store.dragHooks.some(hook => hook.ownerId === localPlayerId) ||
          store.grappleLines.some(line => line.ownerId === localPlayerId),
        charging: false,
        targeting: store.grappleTrapTargeting,
      };
    case 'blaze':
      return {
        active: store.flamethrowerActive || store.rockets.some(rocket => rocket.ownerId === localPlayerId),
        charging: false,
        targeting: store.bombTargeting || store.airStrikeTargeting,
      };
  }
}

function writeViewmodelRootTransform(
  target: MutableTransformTarget,
  elapsedSeconds: number,
  actionBlend: number,
  targetingBlend: number
): void {
  const bob = Math.sin(elapsedSeconds * 1.65) * 0.009;
  const sway = Math.sin(elapsedSeconds * 0.92) * 0.006;

  target.position.set(
    sway * 0.16,
    -0.055 + bob - targetingBlend * 0.09 + actionBlend * 0.025,
    0.17 - targetingBlend * 0.035 - actionBlend * 0.05
  );
  target.rotation.set(
    -0.025 + targetingBlend * 0.09 - actionBlend * 0.035,
    sway * 0.07,
    Math.sin(elapsedSeconds * 1.2) * 0.009
  );
}

function composeTransformMatrix(
  matrix: THREE.Matrix4,
  position: THREE.Vector3,
  rotation: THREE.Euler
): THREE.Matrix4 {
  matrixQuaternion.setFromEuler(rotation);
  matrix.compose(position, matrixQuaternion, matrixUnitScale);
  return matrix;
}

function writePhantomHandPose(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  holdBlend: number,
  shotPulse: number,
  elapsedSeconds: number
): void {
  void elapsedSeconds;
  const sideSign = side;
  const thumbSide = -sideSign;
  const readyBlend = THREE.MathUtils.clamp(holdBlend, 0, 1);

  targets.arm.position.set(
    sideSign * (PHANTOM_IDLE_HAND_POSITION.x - readyBlend * 0.03 - shotPulse * 0.006),
    PHANTOM_IDLE_HAND_POSITION.y + readyBlend * 0.052 + shotPulse * 0.004,
    PHANTOM_IDLE_HAND_POSITION.z - readyBlend * 0.032 - shotPulse * 0.014
  );
  targets.arm.rotation.set(
    PHANTOM_IDLE_HAND_ROTATION.x - readyBlend * 0.37 - shotPulse * 0.055,
    sideSign * (PHANTOM_IDLE_HAND_ROTATION.y - readyBlend * 0.2 - shotPulse * 0.02),
    sideSign * (PHANTOM_IDLE_HAND_ROTATION.z + readyBlend * 0.42 + shotPulse * 0.055)
  );

  targets.wrist.position.set(0, 0, 0);
  targets.wrist.rotation.set(
    -readyBlend * 0.08 - shotPulse * 0.03,
    sideSign * (-readyBlend * 0.06 - shotPulse * 0.018),
    sideSign * (readyBlend * 0.24 + shotPulse * 0.04)
  );

  targets.palm.position.set(
    sideSign * readyBlend * 0.006,
    readyBlend * 0.004,
    -readyBlend * 0.01 - shotPulse * 0.006
  );
  targets.palm.rotation.set(
    -readyBlend * 0.045 - shotPulse * 0.022,
    sideSign * -readyBlend * 0.05,
    sideSign * readyBlend * 0.03
  );

  targets.thumb.position.set(
    thumbSide * (0.072 + readyBlend * 0.006),
    -0.024 + readyBlend * 0.004,
    -0.032 + readyBlend * 0.004 - shotPulse * 0.002
  );
  targets.thumb.rotation.set(
    0.015 - readyBlend * 0.018,
    thumbSide * (0.04 + readyBlend * 0.045),
    thumbSide * (-0.18 - readyBlend * 0.045)
  );

  for (let index = 0; index < targets.fingers.length; index++) {
    const finger = targets.fingers[index];
    const slot = PHANTOM_OPEN_FINGER_SLOTS[index] ?? 0;
    const fingerIndexOffset = index - 1.5;
    const lengthBias = index === 1 || index === 2 ? 0.006 : -0.004;
    finger.position.set(
      slot + readyBlend * fingerIndexOffset * 0.006,
      0.056 + lengthBias,
      -0.038 + Math.abs(fingerIndexOffset) * 0.001 - shotPulse * 0.002
    );
    finger.rotation.set(
      -0.04 - shotPulse * 0.028,
      -fingerIndexOffset * 0.018,
      -fingerIndexOffset * (0.16 + readyBlend * 0.08)
    );
  }
}

function writePhantomForearmPose(
  target: MutableTransformTarget,
  side: -1 | 1,
  holdBlend: number,
  shotPulse: number,
  elapsedSeconds: number
): void {
  void elapsedSeconds;
  target.position.set(
    side * (0.34 - holdBlend * 0.042 - shotPulse * 0.009),
    -0.58 + holdBlend * 0.066 + shotPulse * 0.004,
    -0.41 - holdBlend * 0.096 - shotPulse * 0.01
  );
  target.rotation.set(
    0.22 - holdBlend * 0.34 - shotPulse * 0.055,
    side * (-0.1 + holdBlend * 0.08 + shotPulse * 0.014),
    side * (-0.09 + holdBlend * 0.235 + shotPulse * 0.055)
  );
}

function composePhantomPrimaryPalmMatrix({
  camera,
  elapsedSeconds,
  actionBlend,
  targetingBlend,
  side,
  holdBlend,
  shotPulse,
}: {
  camera: THREE.Camera;
  elapsedSeconds: number;
  actionBlend: number;
  targetingBlend: number;
  side: -1 | 1;
  holdBlend: number;
  shotPulse: number;
}): THREE.Matrix4 {
  const rootTransform = {
    position: matrixPosition,
    rotation: matrixEuler,
  };
  writeViewmodelRootTransform(rootTransform, elapsedSeconds, actionBlend, targetingBlend);
  composeTransformMatrix(viewmodelRootMatrix, rootTransform.position, rootTransform.rotation);

  matrixPosition.copy(PHANTOM_VIEWMODEL_OFFSET);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(phantomOffsetMatrix, matrixPosition, matrixEuler);

  const poseTarget: PhantomHandPoseTargets = {
    arm: { position: matrixPosition, rotation: matrixEuler },
    wrist: { position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER) },
    palm: { position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER) },
    thumb: { position: new THREE.Vector3(), rotation: new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER) },
    fingers: Array.from({ length: 4 }, () => ({
      position: new THREE.Vector3(),
      rotation: new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER),
    })),
  };
  writePhantomHandPose(poseTarget, side, holdBlend, shotPulse, elapsedSeconds);

  composeTransformMatrix(phantomArmMatrix, poseTarget.arm.position, poseTarget.arm.rotation);
  composeTransformMatrix(phantomWristMatrix, poseTarget.wrist.position, poseTarget.wrist.rotation);
  composeTransformMatrix(phantomPalmMatrix, poseTarget.palm.position, poseTarget.palm.rotation);

  matrixPosition.copy(PHANTOM_PALM_SOCKET_OFFSET);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(phantomSocketMatrix, matrixPosition, matrixEuler);

  camera.updateMatrixWorld();
  phantomWorldMatrix
    .copy(camera.matrixWorld)
    .multiply(viewmodelRootMatrix)
    .multiply(phantomOffsetMatrix)
    .multiply(phantomArmMatrix)
    .multiply(phantomWristMatrix)
    .multiply(phantomPalmMatrix)
    .multiply(phantomSocketMatrix);

  return phantomWorldMatrix;
}

function samplePhantomPrimaryPalmSocket(
  context: PhantomPrimaryPoseSampleContext,
  actionBlend: number,
  targetingBlend: number
): ViewmodelSocketPoseDraft {
  const attackTimeSeconds = context.actionTimeSeconds ?? PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS;
  const timestampMs = context.timestampMs ?? Date.now();
  const holdBlend = context.holdBlend ?? getPhantomPrimaryHeldBlend(timestampMs);
  const shotPulse = context.shotPulse ?? getPhantomPrimaryShotPulse(attackTimeSeconds);
  const worldMatrix = composePhantomPrimaryPalmMatrix({
    camera: context.camera,
    elapsedSeconds: context.elapsedSeconds,
    actionBlend,
    targetingBlend,
    side: context.side,
    holdBlend,
    shotPulse,
  });

  worldMatrix.decompose(phantomWorldPosition, phantomWorldQuaternion, phantomWorldScale);

  return {
    position: phantomWorldPosition.clone(),
    quaternion: phantomWorldQuaternion.clone(),
    timestampMs,
  };
}

function Forearm({
  side,
  materials,
  length = 0.34,
  width = 0.16,
  thickness = 0.13,
  positionZ = -0.24,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  length?: number;
  width?: number;
  thickness?: number;
  positionZ?: number;
}) {
  return (
    <group position={[side * 0.34, -0.58, positionZ]} rotation={[0.22, side * -0.18, side * -0.06]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[width * 0.72, thickness, length]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, thickness * 0.27, -0.06]} scale={[width, thickness * 0.7, length * 0.7]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.005, -length * 0.5]} scale={[width * 0.86, thickness, 0.1]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, thickness * 0.7, -0.09]} scale={[width * 0.56, Math.max(0.014, thickness * 0.2), length * 0.46]} />
    </group>
  );
}

function PhantomAnimatedForearm({
  side,
  materials,
  primaryAttackRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
}) {
  const forearmRef = useRef<THREE.Group>(null);
  const length = 0.32;
  const width = 0.074;
  const thickness = 0.066;

  useFrame((state) => {
    const forearm = forearmRef.current;
    if (!forearm) return;

    const nowMs = Date.now();
    const attack = primaryAttackRef.current;
    const attackTimeSeconds = attack?.side === side
      ? (nowMs - attack.startTimeMs) / 1000
      : Number.POSITIVE_INFINITY;
    const holdBlend = getPhantomPrimaryHeldBlend(nowMs);
    const shotPulse = getPhantomPrimaryShotPulse(attackTimeSeconds);
    writePhantomForearmPose(forearm, side, holdBlend, shotPulse, state.clock.elapsedTime);
  });

  return (
    <group ref={forearmRef} position={[side * 0.34, -0.58, -0.43]} rotation={[0.22, side * -0.18, side * -0.06]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[width * 0.72, thickness, length]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, thickness * 0.27, -0.06]} scale={[width, thickness * 0.7, length * 0.7]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.005, -length * 0.5]} scale={[width * 0.86, thickness, 0.1]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, thickness * 0.7, -0.09]} scale={[width * 0.56, Math.max(0.014, thickness * 0.2), length * 0.46]} />
    </group>
  );
}

function PhantomPoseableHand({
  side,
  materials,
  primaryAttackRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
}) {
  const closedVisualRef = useRef<THREE.Group>(null);
  const armRef = useRef<THREE.Group>(null);
  const wristRef = useRef<THREE.Group>(null);
  const palmRef = useRef<THREE.Group>(null);
  const openVisualRef = useRef<THREE.Group>(null);
  const thumbRef = useRef<THREE.Group>(null);
  const socketRef = useRef<THREE.Group>(null);
  const fingerRefs = useRef<(THREE.Group | null)[]>([]);
  const thumbSide = -side;

  useEffect(() => {
    if (!socketRef.current) return undefined;
    return registerViewmodelSocket(PHANTOM_PRIMARY_PALM_SOCKET_NAMES[side], socketRef.current);
  }, [side]);

  useFrame((state) => {
    const closedVisual = closedVisualRef.current;
    const arm = armRef.current;
    const wrist = wristRef.current;
    const palm = palmRef.current;
    const openVisual = openVisualRef.current;
    const thumb = thumbRef.current;
    const fingers = fingerRefs.current.filter(Boolean) as THREE.Group[];
    if (!arm || !wrist || !palm || !thumb || fingers.length !== 4) return;

    const nowMs = Date.now();
    const attack = primaryAttackRef.current;
    const attackTimeSeconds = attack?.side === side
      ? (nowMs - attack.startTimeMs) / 1000
      : Number.POSITIVE_INFINITY;
    const holdBlend = getPhantomPrimaryHeldBlend(nowMs);
    const shotPulse = getPhantomPrimaryShotPulse(attackTimeSeconds);
    const openVisualBlend = THREE.MathUtils.smoothstep(holdBlend, 0.02, 0.72);
    const closedVisualBlend = 1 - THREE.MathUtils.smoothstep(holdBlend, 0, 0.5);

    if (closedVisual) {
      closedVisual.visible = closedVisualBlend > 0.025;
      closedVisual.scale.setScalar(Math.max(0.001, closedVisualBlend));
    }

    if (openVisual) {
      openVisual.visible = openVisualBlend > 0.025;
      openVisual.scale.setScalar(Math.max(0.001, openVisualBlend));
    }

    writePhantomHandPose(
      {
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      holdBlend,
      shotPulse,
      state.clock.elapsedTime
    );
  });

  return (
    <group>
      <group
        ref={closedVisualRef}
        position={[side * PHANTOM_IDLE_HAND_POSITION.x, PHANTOM_IDLE_HAND_POSITION.y, PHANTOM_IDLE_HAND_POSITION.z]}
        rotation={[
          PHANTOM_IDLE_HAND_ROTATION.x,
          side * PHANTOM_IDLE_HAND_ROTATION.y,
          side * PHANTOM_IDLE_HAND_ROTATION.z,
        ]}
      >
        <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[0.092, 0.124, 0.12]} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.018, 0.006, 0.018]} scale={[0.076, 0.102, 0.074]} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.052, 0, -0.014]} scale={[0.018, 0.105, 0.068]} />

        {PHANTOM_CLOSED_FINGER_ROWS.map((row, index) => (
          <group key={row} position={[side * -0.006, row, -0.072]}>
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} scale={[0.106, 0.028, 0.052]} />
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.026, 0, -0.026]} scale={[0.04, 0.026, 0.034]} />
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[side * -0.028, 0, -0.034]} scale={[0.07, 0.026, 0.042]} />
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * -0.058, 0, -0.06]} scale={[0.02, 0.018, 0.022]} />
            {(index === 1 || index === 2) && (
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * 0.052, 0, 0.012]} scale={[0.014, 0.014, 0.028]} />
            )}
          </group>
        ))}

        <group position={[side * 0.076, -0.044, -0.014]} rotation={[0.06, side * -0.08, side * 0.28]}>
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} scale={[0.046, 0.09, 0.056]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.006, 0.002, 0.016]} scale={[0.034, 0.07, 0.034]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * -0.014, 0.01, -0.02]} scale={[0.014, 0.046, 0.01]} />
        </group>

        <mesh
          geometry={SHARED_GEOMETRIES.box}
          material={materials.dark}
          position={[0, 0, 0.085]}
          scale={[0.074, 0.088, 0.038]}
        />
        <mesh
          geometry={SHARED_GEOMETRIES.box}
          material={materials.glow}
          position={[side * -0.034, 0, -0.108]}
          scale={[0.05, 0.014, 0.012]}
        />
      </group>

      <group
        ref={armRef}
        position={[side * PHANTOM_IDLE_HAND_POSITION.x, PHANTOM_IDLE_HAND_POSITION.y, PHANTOM_IDLE_HAND_POSITION.z]}
        rotation={[
          PHANTOM_IDLE_HAND_ROTATION.x,
          side * PHANTOM_IDLE_HAND_ROTATION.y,
          side * PHANTOM_IDLE_HAND_ROTATION.z,
        ]}
      >
        <group ref={wristRef}>
          <group ref={palmRef}>
            <group ref={openVisualRef} visible={false} scale={[0.001, 0.001, 0.001]}>
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -0.072, 0.086]} scale={[0.07, 0.062, 0.084]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.104, 0.142]} scale={[0.058, 0.044, 0.104]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.028, -0.094, 0.082]} scale={[0.016, 0.044, 0.058]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[0.104, 0.128, 0.052]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.014, 0.002, 0.012]} scale={[0.084, 0.104, 0.036]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.056, -0.004, -0.018]} scale={[0.018, 0.088, 0.028]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[0, 0.012, -0.048]} scale={[0.058, 0.074, 0.014]} />

              {PHANTOM_OPEN_FINGER_SLOTS.map((slot, index) => {
                const isLongFinger = index === 1 || index === 2;
                const segmentLength = isLongFinger ? 0.08 : 0.068;
                const tipY = segmentLength + 0.014;
                return (
                  <group
                    key={slot}
                    ref={(node) => {
                      fingerRefs.current[index] = node;
                    }}
                    position={[slot, 0.056, -0.038]}
                    rotation={[-0.04, 0, -(index - 1.5) * 0.22]}
                  >
                    <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.006, 0.012]} scale={[0.028, 0.024, 0.024]} />
                    <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, segmentLength * 0.5, 0]} scale={[0.024, segmentLength, 0.024]} />
                    <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, segmentLength * 0.35, 0.006]} scale={[0.027, segmentLength * 0.42, 0.026]} />
                    <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[0, segmentLength * 0.5, -0.012]} scale={[0.013, segmentLength * 0.62, 0.011]} />
                    <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, tipY, -0.001]} scale={[0.023, 0.03, 0.024]} />
                  </group>
                );
              })}

              <group ref={thumbRef} position={[thumbSide * 0.072, -0.024, -0.032]} rotation={[0.015, thumbSide * 0.04, thumbSide * -0.18]}>
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, 0, 0.006]} scale={[0.026, 0.03, 0.022]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[thumbSide * 0.024, 0.01, 0]} scale={[0.042, 0.028, 0.024]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[thumbSide * 0.024, 0.016, 0.007]} scale={[0.032, 0.018, 0.024]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[thumbSide * 0.024, 0.012, -0.01]} scale={[0.028, 0.01, 0.01]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[thumbSide * 0.05, 0.012, -0.001]} scale={[0.024, 0.024, 0.022]} />
              </group>

              <mesh
                geometry={SHARED_GEOMETRIES.box}
                material={materials.dark}
                position={[0, 0, 0.058]}
                scale={[0.074, 0.088, 0.032]}
              />
            </group>

            <group
              ref={socketRef}
              name={PHANTOM_PRIMARY_PALM_SOCKET_NAMES[side]}
              position={[
                PHANTOM_PALM_SOCKET_OFFSET.x,
                PHANTOM_PALM_SOCKET_OFFSET.y,
                PHANTOM_PALM_SOCKET_OFFSET.z,
              ]}
            />
          </group>
        </group>
      </group>
    </group>
  );
}

function PhantomViewmodel({
  materials,
  primaryAttackRef,
}: {
  materials: ViewmodelMaterialSet;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
}) {
  return (
    <group position={[
      PHANTOM_VIEWMODEL_OFFSET.x,
      PHANTOM_VIEWMODEL_OFFSET.y,
      PHANTOM_VIEWMODEL_OFFSET.z,
    ]}>
      <PhantomAnimatedForearm side={-1} materials={materials} primaryAttackRef={primaryAttackRef} />
      <PhantomAnimatedForearm side={1} materials={materials} primaryAttackRef={primaryAttackRef} />
      <PhantomPoseableHand side={-1} materials={materials} primaryAttackRef={primaryAttackRef} />
      <PhantomPoseableHand side={1} materials={materials} primaryAttackRef={primaryAttackRef} />
    </group>
  );
}

function HookHand({
  side,
  materials,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
}) {
  const hookMaterials = getHookshotMaterials();

  return (
    <group position={[side * 0.34, -0.49, -0.54]} rotation={[0.08, side * -0.18, side * 0.06]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, 0.01, 0.08]} scale={[0.2, 0.16, 0.22]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, 0.105, 0.04]} scale={[0.14, 0.03, 0.14]} />
      <mesh geometry={SHARED_GEOMETRIES.ring16} material={hookMaterials.ring} position={[0, 0, -0.08]} rotation={[Math.PI / 2, 0, 0]} scale={[0.21, 0.21, 0.06]} />
      <mesh geometry={SHARED_GEOMETRIES.sphere8} material={hookMaterials.glow} position={[0, 0, -0.08]} scale={0.11} />

      <mesh geometry={SHARED_GEOMETRIES.cylinder8} material={hookMaterials.shaft} position={[0, 0, -0.27]} rotation={[Math.PI / 2, 0, 0]} scale={[0.07, 0.34, 0.07]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder8} material={hookMaterials.crown} position={[0, 0, -0.45]} rotation={[0, 0, Math.PI / 2]} scale={[0.052, 0.26, 0.052]} />
      <mesh geometry={SHARED_GEOMETRIES.cone8} material={hookMaterials.tip} position={[0, 0, -0.64]} rotation={[Math.PI / 2, 0, 0]} scale={[0.08, 0.16, 0.08]} />

      <mesh
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={hookMaterials.fluke}
        position={[side * 0.14, 0.01, -0.47]}
        rotation={[0.52, 0, side * 0.72]}
        scale={[0.048, 0.28, 0.048]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.cone8}
        material={hookMaterials.tip}
        position={[side * 0.26, 0.035, -0.55]}
        rotation={[0.78, 0, side * 1.18]}
        scale={[0.07, 0.14, 0.052]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={hookMaterials.fluke}
        position={[side * -0.13, -0.01, -0.47]}
        rotation={[0.48, 0, side * -0.72]}
        scale={[0.045, 0.24, 0.045]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.cone8}
        material={hookMaterials.tip}
        position={[side * -0.23, 0.02, -0.54]}
        rotation={[0.75, 0, side * -1.12]}
        scale={[0.062, 0.12, 0.048]}
      />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[0, -0.105, -0.28]} scale={[0.035, 0.035, 0.28]} />
    </group>
  );
}

function HookshotViewmodel({ materials }: { materials: ViewmodelMaterialSet }) {
  return (
    <group>
      <Forearm side={-1} materials={materials} length={0.32} width={0.17} />
      <Forearm side={1} materials={materials} length={0.32} width={0.17} />
      <HookHand side={-1} materials={materials} />
      <HookHand side={1} materials={materials} />
    </group>
  );
}

function RocketLauncher({
  side,
  materials,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
}) {
  return (
    <group position={[side * 0.33, -0.49, -0.55]} rotation={[0.07, side * -0.12, side * 0.05]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -0.02, 0.12]} scale={[0.2, 0.14, 0.28]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.metal} position={[0, 0, -0.14]} rotation={[Math.PI / 2, 0, 0]} scale={[0.15, 0.46, 0.15]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.dark} position={[0, 0, -0.39]} rotation={[Math.PI / 2, 0, 0]} scale={[0.17, 0.06, 0.17]} />
      <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.glow} position={[0, 0, -0.43]} rotation={[Math.PI / 2, 0, 0]} scale={[0.092, 0.03, 0.092]} />

      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, 0.12, -0.12]} scale={[0.27, 0.08, 0.45]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.16, 0, -0.12]} scale={[0.07, 0.19, 0.4]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, 0.17, -0.16]} scale={[0.16, 0.025, 0.26]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * -0.18, 0, -0.27]} scale={[0.025, 0.11, 0.18]} />

      {[-0.26, -0.12, 0.02].map(z => (
        <mesh key={z} geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.15, z]} scale={[0.2, 0.028, 0.035]} />
      ))}

      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -0.14, 0.12]} rotation={[0.28, 0, 0]} scale={[0.1, 0.18, 0.1]} />
      <mesh geometry={SHARED_GEOMETRIES.cone8} material={materials.glow} position={[0, -0.02, -0.48]} rotation={[Math.PI, 0, 0]} scale={[0.07, 0.16, 0.07]} />
    </group>
  );
}

function BlazeViewmodel({ materials }: { materials: ViewmodelMaterialSet }) {
  return (
    <group>
      <Forearm side={-1} materials={materials} length={0.34} width={0.18} />
      <Forearm side={1} materials={materials} length={0.34} width={0.18} />
      <RocketLauncher side={-1} materials={materials} />
      <RocketLauncher side={1} materials={materials} />
    </group>
  );
}

const HeroViewmodelInner = memo(function HeroViewmodelInner({ heroId, action }: HeroViewmodelProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);
  const actionBlendRef = useRef(action.active || action.charging ? 1 : 0);
  const targetingBlendRef = useRef(action.targeting ? 1 : 0);
  const phantomPrimaryAttackRef = useRef<PhantomPrimaryAttackState | null>(null);
  const processedPhantomPrimaryEventIdRef = useRef<string | null>(null);
  const materials = useMemo(() => getViewmodelMaterials(heroId), [heroId]);

  useEffect(() => {
    if (heroId !== 'phantom') return undefined;

    const unregisterLeft = registerViewmodelPoseSampler<PhantomPrimaryPoseSampleContext>(
      PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1],
      (context) => samplePhantomPrimaryPalmSocket(
        { ...context, side: -1 },
        actionBlendRef.current,
        targetingBlendRef.current
      )
    );
    const unregisterRight = registerViewmodelPoseSampler<PhantomPrimaryPoseSampleContext>(
      PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1],
      (context) => samplePhantomPrimaryPalmSocket(
        { ...context, side: 1 },
        actionBlendRef.current,
        targetingBlendRef.current
      )
    );

    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [heroId]);

  useFrame((state, delta) => {
    if (!groupRef.current || !rootRef.current) return;

    const liveAction = getActionState(heroId);
    actionBlendRef.current = THREE.MathUtils.damp(
      actionBlendRef.current,
      liveAction.active || liveAction.charging ? 1 : 0,
      9,
      delta
    );
    targetingBlendRef.current = THREE.MathUtils.damp(
      targetingBlendRef.current,
      liveAction.targeting ? 1 : 0,
      10,
      delta
    );

    groupRef.current.position.copy(camera.position);
    groupRef.current.quaternion.copy(camera.quaternion);

    const t = state.clock.elapsedTime;
    const actionBlend = actionBlendRef.current;
    const targetingBlend = targetingBlendRef.current;

    if (heroId === 'phantom') {
      const store = useGameStore.getState();
      const localPlayerId = store.localPlayer?.id;
      if (localPlayerId) {
        for (let index = store.direBalls.length - 1; index >= 0; index--) {
          const ball = store.direBalls[index];
          if (ball.ownerId !== localPlayerId) continue;
          if (ball.launchSide !== -1 && ball.launchSide !== 1) continue;

          const eventId = ball.viewmodelEventId ?? ball.id;
          if (processedPhantomPrimaryEventIdRef.current !== eventId) {
            processedPhantomPrimaryEventIdRef.current = eventId;
            phantomPrimaryAttackRef.current = {
              eventId,
              side: ball.launchSide,
              startTimeMs: ball.startTime - PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS * 1000,
            };
          }
          break;
        }
      }
    }

    writeViewmodelRootTransform(rootRef.current, t, actionBlend, targetingBlend);
  });

  return (
    <group ref={groupRef} frustumCulled={false} renderOrder={20}>
      <group ref={rootRef}>
        {heroId === 'phantom' && (
          <PhantomViewmodel materials={materials} primaryAttackRef={phantomPrimaryAttackRef} />
        )}
        {heroId === 'hookshot' && <HookshotViewmodel materials={materials} />}
        {heroId === 'blaze' && <BlazeViewmodel materials={materials} />}
      </group>
    </group>
  );
});

export function HeroViewmodel() {
  const {
    heroId,
    playerState,
    gamePhase,
    actionActive,
    actionCharging,
    actionTargeting,
  } = useGameStore(
    useShallow(state => {
      const currentHeroId = state.localPlayer?.heroId ?? null;
      const viewmodelHeroId = isViewmodelHero(currentHeroId) ? currentHeroId : null;
      const localPlayerId = state.localPlayer?.id;

      return {
        heroId: viewmodelHeroId,
        playerState: state.localPlayer?.state ?? 'dead',
        gamePhase: state.gamePhase,
        actionActive: Boolean(
          viewmodelHeroId &&
          (
            (viewmodelHeroId === 'blaze' && state.flamethrowerActive) ||
            (viewmodelHeroId === 'phantom' && state.voidRays.some(ray => ray.ownerId === localPlayerId)) ||
            (viewmodelHeroId === 'hookshot' && state.hookProjectiles.some(hook => hook.ownerId === localPlayerId))
          )
        ),
        actionCharging: viewmodelHeroId === 'phantom' && state.voidRayCharging,
        actionTargeting: Boolean(
          viewmodelHeroId &&
          (
            (viewmodelHeroId === 'phantom' && state.shadowStepTargeting) ||
            (viewmodelHeroId === 'blaze' && (state.bombTargeting || state.airStrikeTargeting)) ||
            (viewmodelHeroId === 'hookshot' && state.grappleTrapTargeting)
          )
        ),
      };
    })
  );

  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown';
  if (!heroId || !isPlaying || playerState !== 'alive') return null;

  return (
    <HeroViewmodelInner
      key={heroId}
      heroId={heroId}
      action={{
        active: actionActive,
        charging: actionCharging,
        targeting: actionTargeting,
      }}
    />
  );
}
