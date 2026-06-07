import { memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShallow } from 'zustand/shallow';
import type { HeroId } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  getPhantomPrimaryAttackBlend,
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
const PHANTOM_PALM_SOCKET_OFFSET = new THREE.Vector3(0, 0.012, -0.086);
const PHANTOM_FINGER_ROWS = [-0.066, -0.022, 0.022, 0.066] as const;

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
  attackBlend: number,
  elapsedSeconds: number
): void {
  const sideSign = side;

  targets.arm.position.set(
    sideSign * (0.3 - attackBlend * 0.02),
    -0.52 + attackBlend * 0.028,
    -0.64 - attackBlend * 0.095
  );
  targets.arm.rotation.set(
    0.18 - attackBlend * 0.5,
    sideSign * (0.78 - attackBlend * 0.2),
    sideSign * (-0.08 + attackBlend * 0.48)
  );

  targets.wrist.position.set(0, 0, 0);
  targets.wrist.rotation.set(
    -attackBlend * 0.18,
    sideSign * -attackBlend * 0.22,
    sideSign * attackBlend * 0.46
  );

  targets.palm.position.set(
    sideSign * attackBlend * 0.006,
    attackBlend * 0.004,
    -attackBlend * 0.024
  );
  targets.palm.rotation.set(
    -attackBlend * 0.08,
    sideSign * -attackBlend * 0.08,
    sideSign * attackBlend * 0.14
  );

  targets.thumb.position.set(sideSign * (0.072 + attackBlend * 0.01), -0.042 - attackBlend * 0.012, -0.004 - attackBlend * 0.018);
  targets.thumb.rotation.set(
    -attackBlend * 0.12,
    sideSign * attackBlend * 0.22,
    sideSign * (0.4 + attackBlend * 0.9)
  );

  for (let index = 0; index < targets.fingers.length; index++) {
    const finger = targets.fingers[index];
    const row = PHANTOM_FINGER_ROWS[index] ?? 0;
    const stagger = (index - 1.5) * 0.025;
    finger.position.set(
      sideSign * (-0.006 + attackBlend * 0.01),
      row + attackBlend * stagger,
      -0.072 - attackBlend * (0.068 + Math.abs(stagger) * 0.45)
    );
    finger.rotation.set(
      -attackBlend * 0.62,
      sideSign * attackBlend * 0.08,
      sideSign * attackBlend * (0.08 + stagger)
    );
  }
}

function writePhantomForearmPose(
  target: MutableTransformTarget,
  side: -1 | 1,
  attackBlend: number,
  elapsedSeconds: number
): void {
  void elapsedSeconds;
  target.position.set(
    side * (0.34 - attackBlend * 0.028),
    -0.58 + attackBlend * 0.026,
    -0.43 - attackBlend * 0.075
  );
  target.rotation.set(
    0.22 - attackBlend * 0.42,
    side * (-0.18 + attackBlend * 0.16),
    side * (-0.06 + attackBlend * 0.42)
  );
}

function composePhantomPrimaryPalmMatrix({
  camera,
  elapsedSeconds,
  actionBlend,
  targetingBlend,
  side,
  attackBlend,
}: {
  camera: THREE.Camera;
  elapsedSeconds: number;
  actionBlend: number;
  targetingBlend: number;
  side: -1 | 1;
  attackBlend: number;
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
  writePhantomHandPose(poseTarget, side, attackBlend, elapsedSeconds);

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
  const attackBlend = getPhantomPrimaryAttackBlend(attackTimeSeconds);
  const worldMatrix = composePhantomPrimaryPalmMatrix({
    camera: context.camera,
    elapsedSeconds: context.elapsedSeconds,
    actionBlend,
    targetingBlend,
    side: context.side,
    attackBlend,
  });

  worldMatrix.decompose(phantomWorldPosition, phantomWorldQuaternion, phantomWorldScale);

  return {
    position: phantomWorldPosition.clone(),
    quaternion: phantomWorldQuaternion.clone(),
    timestampMs: context.timestampMs,
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
  const length = 0.24;
  const width = 0.068;
  const thickness = 0.064;

  useFrame((state) => {
    const forearm = forearmRef.current;
    if (!forearm) return;

    const attack = primaryAttackRef.current;
    const attackTimeSeconds = attack?.side === side
      ? (Date.now() - attack.startTimeMs) / 1000
      : Number.POSITIVE_INFINITY;
    const attackBlend = getPhantomPrimaryAttackBlend(attackTimeSeconds);
    writePhantomForearmPose(forearm, side, attackBlend, state.clock.elapsedTime);
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
  const armRef = useRef<THREE.Group>(null);
  const wristRef = useRef<THREE.Group>(null);
  const palmRef = useRef<THREE.Group>(null);
  const thumbRef = useRef<THREE.Group>(null);
  const socketRef = useRef<THREE.Group>(null);
  const fingerRefs = useRef<(THREE.Group | null)[]>([]);

  useEffect(() => {
    if (!socketRef.current) return undefined;
    return registerViewmodelSocket(PHANTOM_PRIMARY_PALM_SOCKET_NAMES[side], socketRef.current);
  }, [side]);

  useFrame((state) => {
    const arm = armRef.current;
    const wrist = wristRef.current;
    const palm = palmRef.current;
    const thumb = thumbRef.current;
    const fingers = fingerRefs.current.filter(Boolean) as THREE.Group[];
    if (!arm || !wrist || !palm || !thumb || fingers.length !== 4) return;

    const attack = primaryAttackRef.current;
    const attackTimeSeconds = attack?.side === side
      ? (Date.now() - attack.startTimeMs) / 1000
      : Number.POSITIVE_INFINITY;
    const attackBlend = getPhantomPrimaryAttackBlend(attackTimeSeconds);

    writePhantomHandPose(
      {
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      attackBlend,
      state.clock.elapsedTime
    );
  });

  return (
    <group ref={armRef} position={[side * 0.3, -0.52, -0.64]} rotation={[0.18, side * 0.78, side * -0.08]}>
      <group ref={wristRef}>
        <group ref={palmRef}>
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[0.092, 0.124, 0.12]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.018, 0.006, 0.018]} scale={[0.076, 0.102, 0.074]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.052, 0, -0.014]} scale={[0.018, 0.105, 0.068]} />

          {PHANTOM_FINGER_ROWS.map((row, index) => (
            <group
              key={row}
              ref={(node) => {
                fingerRefs.current[index] = node;
              }}
              position={[side * -0.006, row, -0.072]}
            >
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} scale={[0.106, 0.028, 0.052]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.026, 0, -0.026]} scale={[0.04, 0.026, 0.034]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[side * -0.028, 0, -0.034]} scale={[0.07, 0.026, 0.042]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * -0.058, 0, -0.06]} scale={[0.02, 0.018, 0.022]} />
              {index === 1 && (
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * 0.052, 0, 0.012]} scale={[0.018, 0.019, 0.034]} />
              )}
            </group>
          ))}

          <group ref={thumbRef} position={[side * 0.072, -0.042, -0.004]} rotation={[0, 0, side * 0.4]}>
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} scale={[0.05, 0.1, 0.062]} />
          </group>

          <mesh
            geometry={SHARED_GEOMETRIES.box}
            material={materials.dark}
            position={[0, 0, 0.085]}
            scale={[0.074, 0.088, 0.038]}
          />
          <mesh
            geometry={SHARED_GEOMETRIES.sphere8}
            material={materials.glow}
            position={[side * -0.052, 0, -0.11]}
            scale={0.034}
          />

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
