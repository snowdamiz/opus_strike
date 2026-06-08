import { memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShallow } from 'zustand/shallow';
import {
  HERO_DEFINITIONS,
  PHANTOM_PRIMARY_RELOAD_MS,
  SPRINT_MULTIPLIER,
  VOID_RAY_CHARGE_TIME,
  type HeroId,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  getPhantomPrimaryHeldBlend,
  getPhantomPrimaryShotPulse,
  type PhantomPrimaryPoseSampleContext,
  type PhantomVoidRayOrbPoseSampleContext,
} from '../../viewmodel/phantomPrimaryPose';
import { HOOKSHOT_HOOK_SOCKET_NAMES } from '../../viewmodel/hookshotPose';
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
import { HookshotViewmodelArrow } from './hookshot/arrowHead';

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

interface PhantomVoidRayReleaseState {
  eventId: string;
  startTimeMs: number;
}

interface HookshotPrimaryFireState {
  eventId: string;
  side: -1 | 1;
  startTimeMs: number;
}

interface HookshotSecondaryFireState {
  eventId: string;
  startTimeMs: number;
}

interface PhantomHandPoseTargets {
  closedHand?: MutableTransformTarget;
  arm: MutableTransformTarget;
  wrist: MutableTransformTarget;
  palm: MutableTransformTarget;
  thumb: MutableTransformTarget;
  fingers: MutableTransformTarget[];
}

interface PhantomLocomotionPose {
  movementBlend: number;
  runBlend: number;
  slideBlend: number;
  speedBlend: number;
  cycleTime: number;
}

interface PhantomLocomotionRuntime extends PhantomLocomotionPose {
  previousCameraPosition: THREE.Vector3;
  hasPreviousCameraPosition: boolean;
}

interface PhantomReloadPose {
  active: boolean;
  progress: number;
  blend: number;
  glowOpacity: number;
  shakeX: number;
  shakeY: number;
  shakeZ: number;
  shakeRotX: number;
  shakeRotY: number;
  shakeRotZ: number;
}

interface PhantomVoidRayChargePose {
  active: boolean;
  progress: number;
  blend: number;
  energy: number;
  glowOpacity: number;
  orbOpacity: number;
  orbScale: number;
  shakeX: number;
  shakeY: number;
  shakeZ: number;
}

const VIEWMODEL_ROOT_EULER_ORDER = 'XYZ';
const PHANTOM_VIEWMODEL_OFFSET = new THREE.Vector3(0, 0.28, -0.04);
const PHANTOM_PALM_SOCKET_OFFSET = new THREE.Vector3(0, 0.012, -0.4);
const PHANTOM_CLOSED_FINGER_ROWS = [-0.066, -0.022, 0.022, 0.066] as const;
const PHANTOM_OPEN_FINGER_SLOTS = [-0.056, -0.019, 0.019, 0.056] as const;
const PHANTOM_WALK_SPEED = HERO_DEFINITIONS.phantom.stats.moveSpeed;
const PHANTOM_RUN_SPEED = PHANTOM_WALK_SPEED * SPRINT_MULTIPLIER;
const PHANTOM_LOCOMOTION_MOVE_START_SPEED = 0.18;
const PHANTOM_LOCOMOTION_FULL_WALK_SPEED = 1.35;
const PHANTOM_LOCOMOTION_RUN_START_SPEED = PHANTOM_WALK_SPEED * 0.92;
const PHANTOM_LOCOMOTION_RUN_FULL_SPEED = PHANTOM_RUN_SPEED * 0.98;
const PHANTOM_LOCOMOTION_TELEPORT_DISTANCE = 1.45;
const PHANTOM_LOCOMOTION_WALK_CYCLE_SPEED = 7.35;
const PHANTOM_LOCOMOTION_RUN_CYCLE_SPEED = 10.95;
const PHANTOM_SLIDE_HAND_PULLBACK_Z = 0.11;
const PHANTOM_SLIDE_FOREARM_PULLBACK_Z = 0.09;
const PHANTOM_CLOSED_HAND_WRIST_PIVOT_Z = 0.105;
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
const PHANTOM_RELOAD_PULLBACK_Z = 0.092;
const PHANTOM_RELOAD_INWARD_X = 0.034;
const PHANTOM_RELOAD_LIFT_Y = 0.018;
const PHANTOM_VOID_RAY_RELEASE_EXTENSION_SECONDS = 0.5;
const PHANTOM_VOID_RAY_ORB_POSITION = new THREE.Vector3(0, -0.472, -0.72);
const PHANTOM_VOID_RAY_RELEASE_ORIGIN_POSITION = new THREE.Vector3(0, -0.38, -2.15);
const HOOKSHOT_PRIMARY_RECOIL_DURATION_SECONDS = 0.26;
const HOOKSHOT_SECONDARY_POSE_DURATION_SECONDS = 1.25;
const HOOKSHOT_LAUNCHER_TUBE_LENGTH = 0.096;
const HOOKSHOT_LAUNCHER_TUBE_CENTER_Z = -HOOKSHOT_LAUNCHER_TUBE_LENGTH * 0.5;
const HOOKSHOT_LAUNCHER_TUBE_FRONT_Z = -HOOKSHOT_LAUNCHER_TUBE_LENGTH;
const HOOKSHOT_LAUNCHER_RING_Z = HOOKSHOT_LAUNCHER_TUBE_FRONT_Z - 0.003;
const PHANTOM_RELOAD_IDLE_POSE: PhantomReloadPose = {
  active: false,
  progress: 0,
  blend: 0,
  glowOpacity: 0,
  shakeX: 0,
  shakeY: 0,
  shakeZ: 0,
  shakeRotX: 0,
  shakeRotY: 0,
  shakeRotZ: 0,
};
const PHANTOM_VOID_RAY_IDLE_CHARGE_POSE: PhantomVoidRayChargePose = {
  active: false,
  progress: 0,
  blend: 0,
  energy: 0,
  glowOpacity: 0,
  orbOpacity: 0,
  orbScale: 0,
  shakeX: 0,
  shakeY: 0,
  shakeZ: 0,
};

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
const phantomClosedHandPivotOffset = new THREE.Vector3(0, 0, PHANTOM_CLOSED_HAND_WRIST_PIVOT_Z);
const phantomClosedHandPivotWorldOffset = new THREE.Vector3();
const PHANTOM_STILL_LOCOMOTION_POSE: PhantomLocomotionPose = {
  movementBlend: 0,
  runBlend: 0,
  slideBlend: 0,
  speedBlend: 0,
  cycleTime: 0,
};

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

function createPhantomReloadGlowMaterial(): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: PHANTOM_COLORS.lightPurple,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function getPhantomReloadPose(nowMs: number, elapsedSeconds: number, side: -1 | 1): PhantomReloadPose {
  const store = useGameStore.getState();
  if (!store.phantomPrimaryReloading) return PHANTOM_RELOAD_IDLE_POSE;

  const start = store.phantomPrimaryReloadStart || nowMs;
  const duration = Math.max(1, store.phantomPrimaryReloadEnd - start || PHANTOM_PRIMARY_RELOAD_MS);
  const progress = THREE.MathUtils.clamp((nowMs - start) / duration, 0, 1);
  const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.18);
  const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.76, 1);
  const blend = fadeIn * fadeOut;
  const glowPulse = 0.54 + Math.sin(elapsedSeconds * 16.5 + side * 0.7) * 0.22 + Math.sin(elapsedSeconds * 31.0) * 0.1;
  const shakeStrength = blend * (0.56 + THREE.MathUtils.smoothstep(progress, 0.08, 0.4) * 0.44);

  return {
    active: true,
    progress,
    blend,
    glowOpacity: THREE.MathUtils.clamp(blend * glowPulse, 0, 0.82),
    shakeX: Math.sin(elapsedSeconds * 53 + side * 1.7) * 0.0032 * shakeStrength,
    shakeY: Math.sin(elapsedSeconds * 61 + side * 0.9) * 0.0026 * shakeStrength,
    shakeZ: Math.sin(elapsedSeconds * 47 + side * 2.1) * 0.0034 * shakeStrength,
    shakeRotX: Math.sin(elapsedSeconds * 71 + side * 1.3) * 0.016 * shakeStrength,
    shakeRotY: Math.sin(elapsedSeconds * 57 + side * 2.4) * 0.012 * shakeStrength,
    shakeRotZ: Math.sin(elapsedSeconds * 67 + side * 0.4) * 0.014 * shakeStrength,
  };
}

function getPhantomVoidRayChargePose(nowMs: number, elapsedSeconds: number): PhantomVoidRayChargePose {
  const store = useGameStore.getState();
  if (!store.voidRayCharging) return PHANTOM_VOID_RAY_IDLE_CHARGE_POSE;

  const start = store.voidRayChargeStart || nowMs;
  const progress = THREE.MathUtils.clamp((nowMs - start) / VOID_RAY_CHARGE_TIME, 0, 1);
  const blend = THREE.MathUtils.smoothstep(progress, 0, 0.32);
  const energy = THREE.MathUtils.smoothstep(progress, 0.08, 1);
  const pulse = 0.66 + Math.sin(elapsedSeconds * 15.5) * 0.16 + Math.sin(elapsedSeconds * 29.0) * 0.08;
  const shakeStrength = blend * THREE.MathUtils.lerp(0.2, 1, energy);

  return {
    active: true,
    progress,
    blend,
    energy,
    glowOpacity: THREE.MathUtils.clamp(blend * (0.22 + energy * 0.68) * pulse, 0, 0.88),
    orbOpacity: THREE.MathUtils.clamp(blend * (0.18 + energy * 0.72), 0, 0.92),
    orbScale: THREE.MathUtils.lerp(0.025, 0.142, energy) * (1 + Math.sin(elapsedSeconds * 9.5) * 0.035 * blend),
    shakeX: Math.sin(elapsedSeconds * 43) * 0.0019 * shakeStrength,
    shakeY: Math.sin(elapsedSeconds * 51 + 0.7) * 0.0017 * shakeStrength,
    shakeZ: Math.sin(elapsedSeconds * 47 + 1.2) * 0.0021 * shakeStrength,
  };
}

function applyPhantomReloadMotion(
  target: MutableTransformTarget,
  side: -1 | 1,
  reloadPose: PhantomReloadPose,
  intensity = 1
): void {
  if (!reloadPose.active || reloadPose.blend <= 0) return;

  const blend = reloadPose.blend * intensity;
  target.position.x += side * (-PHANTOM_RELOAD_INWARD_X * blend + reloadPose.shakeX * intensity);
  target.position.y += PHANTOM_RELOAD_LIFT_Y * blend + reloadPose.shakeY * intensity;
  target.position.z += PHANTOM_RELOAD_PULLBACK_Z * blend + reloadPose.shakeZ * intensity;
  target.rotation.x += reloadPose.shakeRotX * intensity - 0.028 * blend;
  target.rotation.y += reloadPose.shakeRotY * intensity + side * 0.018 * blend;
  target.rotation.z += reloadPose.shakeRotZ * intensity + side * -0.026 * blend;
}

function getPhantomVoidRayReleasePulse(
  release: PhantomVoidRayReleaseState | null,
  nowMs: number
): number {
  if (!release) return 0;
  return getPhantomPrimaryShotPulse((nowMs - release.startTimeMs) / 1000);
}

function getPhantomVoidRayReleaseExtensionBlend(
  release: PhantomVoidRayReleaseState | null,
  nowMs: number
): number {
  if (!release) return 0;

  const elapsedSeconds = (nowMs - release.startTimeMs) / 1000;
  const releaseElapsedSeconds = elapsedSeconds - PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS;
  if (releaseElapsedSeconds < 0) {
    return THREE.MathUtils.smoothstep(
      elapsedSeconds,
      0,
      PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS
    );
  }
  if (releaseElapsedSeconds < 0.32) return 1;
  if (releaseElapsedSeconds < PHANTOM_VOID_RAY_RELEASE_EXTENSION_SECONDS) {
    return 1 - THREE.MathUtils.smoothstep(
      releaseElapsedSeconds,
      0.32,
      PHANTOM_VOID_RAY_RELEASE_EXTENSION_SECONDS
    );
  }
  return 0;
}

function applyPhantomVoidRayChargeForearmPose(
  target: MutableTransformTarget,
  side: -1 | 1,
  chargePose: PhantomVoidRayChargePose,
  intensity = 1
): void {
  if (!chargePose.active || chargePose.blend <= 0) return;

  const blend = chargePose.blend * intensity;
  const energy = chargePose.energy;
  target.position.x += side * (-0.048 * blend + chargePose.shakeX * intensity);
  target.position.y += (0.018 + energy * 0.01) * blend + chargePose.shakeY * intensity;
  target.position.z += (-0.018 - energy * 0.006) * blend + chargePose.shakeZ * intensity;
  target.rotation.x += (-0.078 - energy * 0.024) * blend;
  target.rotation.y += side * (0.032 + energy * 0.018) * blend;
  target.rotation.z += side * (0.12 + energy * 0.032) * blend;
}

function applyPhantomVoidRayReleaseForearmPose(
  target: MutableTransformTarget,
  side: -1 | 1,
  releaseBlend: number
): void {
  if (releaseBlend <= 0) return;

  target.position.x += side * -0.034 * releaseBlend;
  target.position.y += 0.022 * releaseBlend;
  target.position.z += -0.052 * releaseBlend;
  target.rotation.x += -0.06 * releaseBlend;
  target.rotation.y += side * -0.016 * releaseBlend;
  target.rotation.z += side * 0.07 * releaseBlend;
}

function applyPhantomVoidRayChargeHandPose(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  chargePose: PhantomVoidRayChargePose,
  elapsedSeconds: number
): void {
  if (!chargePose.active || chargePose.blend <= 0) return;

  const blend = chargePose.blend;
  const energy = chargePose.energy;
  const sideSign = side;
  const thumbSide = -sideSign;
  const breathingLift = Math.sin(elapsedSeconds * 7.4 + sideSign * 0.6) * 0.0025 * blend;

  targets.arm.position.x += sideSign * (-0.062 * blend + chargePose.shakeX);
  targets.arm.position.y += (0.022 + energy * 0.012) * blend + breathingLift + chargePose.shakeY;
  targets.arm.position.z += (-0.022 - energy * 0.008) * blend + chargePose.shakeZ;
  targets.arm.rotation.x += (-0.048 - energy * 0.022) * blend;
  targets.arm.rotation.y += sideSign * (-0.072 - energy * 0.018) * blend;
  targets.arm.rotation.z += sideSign * (0.13 + energy * 0.032) * blend;

  targets.wrist.rotation.x += (-0.03 - energy * 0.018) * blend;
  targets.wrist.rotation.y += sideSign * (0.032 + energy * 0.018) * blend;
  targets.wrist.rotation.z += sideSign * (0.075 + energy * 0.022) * blend;

  targets.palm.position.x += sideSign * -0.012 * blend;
  targets.palm.position.y += 0.01 * blend;
  targets.palm.position.z += -0.018 * blend;
  targets.palm.rotation.x += 0.05 * blend;
  targets.palm.rotation.y += sideSign * -0.028 * blend;
  targets.palm.rotation.z += sideSign * 0.026 * blend;

  targets.thumb.position.x += thumbSide * (0.022 + energy * 0.01) * blend;
  targets.thumb.position.y += 0.012 * blend;
  targets.thumb.position.z += -0.012 * blend;
  targets.thumb.rotation.x += (-0.048 - energy * 0.015) * blend;
  targets.thumb.rotation.y += thumbSide * (0.095 + energy * 0.02) * blend;
  targets.thumb.rotation.z += thumbSide * (-0.12 - energy * 0.03) * blend;

  for (let index = 0; index < targets.fingers.length; index++) {
    const finger = targets.fingers[index];
    const fingerIndexOffset = index - 1.5;
    const outsideBias = Math.abs(fingerIndexOffset);
    finger.position.x += fingerIndexOffset * 0.01 * blend;
    finger.position.y += (0.014 + energy * 0.006 - outsideBias * 0.001) * blend;
    finger.position.z += (-0.012 - energy * 0.005) * blend;
    finger.rotation.x += (-0.075 - energy * 0.026) * blend;
    finger.rotation.y += -fingerIndexOffset * (0.025 + energy * 0.01) * blend;
    finger.rotation.z += -fingerIndexOffset * (0.13 + energy * 0.04) * blend;
  }

  if (targets.closedHand) {
    targets.closedHand.rotation.copy(targets.arm.rotation);
    phantomClosedHandPivotWorldOffset
      .copy(phantomClosedHandPivotOffset)
      .applyEuler(targets.closedHand.rotation);
    targets.closedHand.position.copy(targets.arm.position).add(phantomClosedHandPivotWorldOffset);
  }
}

function applyPhantomVoidRayReleaseHandPose(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  releaseBlend: number
): void {
  if (releaseBlend <= 0) return;

  const sideSign = side;
  const thumbSide = -sideSign;

  targets.arm.position.x += sideSign * -0.046 * releaseBlend;
  targets.arm.position.y += 0.032 * releaseBlend;
  targets.arm.position.z += -0.064 * releaseBlend;
  targets.arm.rotation.x += -0.056 * releaseBlend;
  targets.arm.rotation.y += sideSign * -0.036 * releaseBlend;
  targets.arm.rotation.z += sideSign * 0.078 * releaseBlend;

  targets.wrist.rotation.x += -0.026 * releaseBlend;
  targets.wrist.rotation.y += sideSign * 0.018 * releaseBlend;
  targets.wrist.rotation.z += sideSign * 0.026 * releaseBlend;

  targets.palm.position.z += -0.012 * releaseBlend;
  targets.palm.rotation.x += 0.035 * releaseBlend;
  targets.palm.rotation.y += sideSign * -0.018 * releaseBlend;

  targets.thumb.position.x += thumbSide * 0.012 * releaseBlend;
  targets.thumb.rotation.y += thumbSide * 0.035 * releaseBlend;
  targets.thumb.rotation.z += thumbSide * -0.048 * releaseBlend;

  for (let index = 0; index < targets.fingers.length; index++) {
    const finger = targets.fingers[index];
    const fingerIndexOffset = index - 1.5;
    finger.rotation.x += -0.038 * releaseBlend;
    finger.rotation.z += -fingerIndexOffset * 0.045 * releaseBlend;
  }

  if (targets.closedHand) {
    targets.closedHand.rotation.copy(targets.arm.rotation);
    phantomClosedHandPivotWorldOffset
      .copy(phantomClosedHandPivotOffset)
      .applyEuler(targets.closedHand.rotation);
    targets.closedHand.position.copy(targets.arm.position).add(phantomClosedHandPivotWorldOffset);
  }
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
  elapsedSeconds: number,
  locomotion: PhantomLocomotionPose = PHANTOM_STILL_LOCOMOTION_POSE
): void {
  const sideSign = side;
  const thumbSide = -sideSign;
  const readyBlend = THREE.MathUtils.clamp(holdBlend, 0, 1);
  const slideBlend = THREE.MathUtils.clamp(locomotion.slideBlend, 0, 1);
  const locomotionBlend = THREE.MathUtils.clamp(
    locomotion.movementBlend * (1 - readyBlend * 0.16 - shotPulse * 0.24) * (1 - slideBlend * 0.9),
    0,
    1
  );
  const runBlend = THREE.MathUtils.clamp(locomotion.runBlend * (1 - slideBlend), 0, 1);
  const phase = locomotion.cycleTime + (side === 1 ? 0 : Math.PI);
  const swing = Math.sin(phase);
  const counterSwing = Math.cos(phase);
  const lift = Math.max(0, swing);
  const drop = Math.max(0, -swing);
  const cadencePulse = 0.5 + 0.5 * Math.sin(phase * 2 + 0.25);
  const breath = Math.sin(elapsedSeconds * 1.55 + sideSign * 0.35) * 0.0025;
  const reachAmount = (0.04 + runBlend * 0.027) * locomotionBlend;
  const liftAmount = (0.017 + runBlend * 0.014) * locomotionBlend;
  const crossAmount = (0.011 + runBlend * 0.011) * locomotionBlend;
  const pumpPitch = (0.06 + runBlend * 0.055) * locomotionBlend;
  const pumpRoll = (0.032 + runBlend * 0.03) * locomotionBlend;
  const runTuck = runBlend * locomotionBlend;
  const inwardTuck = (0.018 + runBlend * 0.034) * locomotionBlend;
  const handUpBias = (0.18 + locomotionBlend * 0.028) * (1 - readyBlend * 0.45 - shotPulse * 0.4);
  const slidePullback = PHANTOM_SLIDE_HAND_PULLBACK_Z * slideBlend * (1 - readyBlend * 0.25 - shotPulse * 0.2);

  targets.arm.position.set(
    sideSign * (
      PHANTOM_IDLE_HAND_POSITION.x -
      readyBlend * 0.03 -
      shotPulse * 0.006 -
      inwardTuck +
      counterSwing * crossAmount
    ),
    PHANTOM_IDLE_HAND_POSITION.y +
      readyBlend * 0.052 +
      shotPulse * 0.004 +
      lift * liftAmount -
      drop * liftAmount * 0.28 +
      cadencePulse * runTuck * 0.006 +
      breath * (1 - locomotionBlend),
    PHANTOM_IDLE_HAND_POSITION.z -
      readyBlend * 0.032 -
      shotPulse * 0.014 -
      swing * reachAmount -
      runTuck * 0.007 +
      slidePullback
  );
  targets.arm.rotation.set(
    PHANTOM_IDLE_HAND_ROTATION.x -
      readyBlend * 0.37 -
      shotPulse * 0.055 -
      swing * pumpPitch -
      runTuck * 0.045 +
      handUpBias,
    sideSign * (
      PHANTOM_IDLE_HAND_ROTATION.y -
      readyBlend * 0.2 -
      shotPulse * 0.02 +
      counterSwing * (0.026 + runBlend * 0.028) * locomotionBlend
    ),
    sideSign * (
      PHANTOM_IDLE_HAND_ROTATION.z +
      readyBlend * 0.42 +
      shotPulse * 0.055 -
      swing * pumpRoll +
      counterSwing * 0.022 * locomotionBlend
    )
  );

  if (targets.closedHand) {
    targets.closedHand.rotation.copy(targets.arm.rotation);
    phantomClosedHandPivotWorldOffset
      .copy(phantomClosedHandPivotOffset)
      .applyEuler(targets.closedHand.rotation);
    targets.closedHand.position.copy(targets.arm.position).add(phantomClosedHandPivotWorldOffset);
  }

  targets.wrist.position.set(0, 0, 0);
  targets.wrist.rotation.set(
    -readyBlend * 0.045 -
      shotPulse * 0.018 -
      swing * (0.008 + runBlend * 0.006) * locomotionBlend,
    sideSign * (
      -readyBlend * 0.036 -
      shotPulse * 0.012 +
      counterSwing * 0.005 * locomotionBlend
    ),
    sideSign * (
      readyBlend * 0.14 +
      shotPulse * 0.024 -
      swing * 0.007 * locomotionBlend
    )
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
  elapsedSeconds: number,
  locomotion: PhantomLocomotionPose = PHANTOM_STILL_LOCOMOTION_POSE
): void {
  const locomotionBlend = THREE.MathUtils.clamp(
    locomotion.movementBlend * (1 - holdBlend * 0.08 - shotPulse * 0.18) * (1 - THREE.MathUtils.clamp(locomotion.slideBlend, 0, 1) * 0.9),
    0,
    1
  );
  const slideBlend = THREE.MathUtils.clamp(locomotion.slideBlend, 0, 1);
  const runBlend = THREE.MathUtils.clamp(locomotion.runBlend * (1 - slideBlend), 0, 1);
  const phase = locomotion.cycleTime + (side === 1 ? 0 : Math.PI);
  const swing = Math.sin(phase);
  const counterSwing = Math.cos(phase);
  const lift = Math.max(0, swing);
  const drop = Math.max(0, -swing);
  const breath = Math.sin(elapsedSeconds * 1.35 + side * 0.45) * 0.002;
  const reachAmount = (0.038 + runBlend * 0.029) * locomotionBlend;
  const liftAmount = (0.013 + runBlend * 0.017) * locomotionBlend;
  const crossAmount = (0.01 + runBlend * 0.012) * locomotionBlend;
  const pumpPitch = (0.16 + runBlend * 0.2) * locomotionBlend;
  const runTuck = runBlend * locomotionBlend;
  const inwardTuck = (0.016 + runBlend * 0.035) * locomotionBlend;
  const slidePullback = PHANTOM_SLIDE_FOREARM_PULLBACK_Z * slideBlend * (1 - holdBlend * 0.18 - shotPulse * 0.16);

  target.position.set(
    side * (
      0.34 -
      holdBlend * 0.042 -
      shotPulse * 0.009 -
      inwardTuck +
      counterSwing * crossAmount
    ),
    -0.58 +
      holdBlend * 0.066 +
      shotPulse * 0.004 +
      lift * liftAmount -
      drop * liftAmount * 0.32 +
      breath * (1 - locomotionBlend),
    -0.41 -
      holdBlend * 0.096 -
      shotPulse * 0.01 -
      swing * reachAmount -
      runTuck * 0.006 +
      slidePullback
  );
  target.rotation.set(
    0.22 -
      holdBlend * 0.34 -
      shotPulse * 0.055 -
      runTuck * 0.035 +
      swing * pumpPitch * 0.72,
    side * (
      -0.1 +
      holdBlend * 0.08 +
      shotPulse * 0.014 +
      counterSwing * (0.026 + runBlend * 0.03) * locomotionBlend
    ),
    side * (
      -0.09 +
      holdBlend * 0.235 +
      shotPulse * 0.055 -
      swing * (0.055 + runBlend * 0.074) * locomotionBlend +
      counterSwing * 0.018 * locomotionBlend
    )
  );
}

function getHookshotPrimaryRecoilPulse(
  fireState: HookshotPrimaryFireState | null,
  side: -1 | 1,
  nowMs: number
): number {
  if (!fireState || fireState.side !== side) return 0;

  const elapsedSeconds = (nowMs - fireState.startTimeMs) / 1000;
  if (elapsedSeconds < 0 || elapsedSeconds > HOOKSHOT_PRIMARY_RECOIL_DURATION_SECONDS) return 0;

  const kickIn = THREE.MathUtils.smoothstep(elapsedSeconds, 0, 0.035);
  const settle = 1 - THREE.MathUtils.smoothstep(
    elapsedSeconds,
    0.055,
    HOOKSHOT_PRIMARY_RECOIL_DURATION_SECONDS
  );
  return kickIn * settle;
}

function getHookshotSecondaryPosePulse(
  fireState: HookshotSecondaryFireState | null,
  nowMs: number
): number {
  if (!fireState) return 0;

  const elapsedSeconds = (nowMs - fireState.startTimeMs) / 1000;
  if (elapsedSeconds < 0 || elapsedSeconds > HOOKSHOT_SECONDARY_POSE_DURATION_SECONDS) return 0;

  const kickIn = THREE.MathUtils.smoothstep(elapsedSeconds, 0, 0.055);
  const settle = 1 - THREE.MathUtils.smoothstep(
    elapsedSeconds,
    0.82,
    HOOKSHOT_SECONDARY_POSE_DURATION_SECONDS
  );
  return kickIn * settle;
}

function applyHookshotPrimaryRecoilToForearm(
  target: MutableTransformTarget,
  side: -1 | 1,
  recoil: number
): void {
  if (recoil <= 0) return;

  target.position.x += side * 0.006 * recoil;
  target.position.y -= 0.008 * recoil;
  target.position.z += 0.052 * recoil;
  target.rotation.x += 0.058 * recoil;
  target.rotation.y += side * 0.014 * recoil;
  target.rotation.z += side * -0.034 * recoil;
}

function applyHookshotPrimaryRecoilToHand(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  recoil: number
): void {
  if (recoil <= 0) return;

  targets.arm.position.x += side * 0.008 * recoil;
  targets.arm.position.y -= 0.012 * recoil;
  targets.arm.position.z += 0.086 * recoil;
  targets.arm.rotation.x += 0.072 * recoil;
  targets.arm.rotation.y += side * 0.018 * recoil;
  targets.arm.rotation.z += side * -0.052 * recoil;

  targets.wrist.position.z += 0.014 * recoil;
  targets.wrist.rotation.x += 0.034 * recoil;
  targets.wrist.rotation.z += side * -0.022 * recoil;

  targets.palm.position.z += 0.018 * recoil;
  targets.palm.rotation.x += 0.032 * recoil;
  targets.palm.rotation.z += side * -0.018 * recoil;
}

function applyHookshotSecondaryPoseToForearm(
  target: MutableTransformTarget,
  side: -1 | 1,
  pulse: number
): void {
  if (pulse <= 0) return;

  if (side === -1) {
    target.position.x -= 0.045 * pulse;
    target.position.y -= 0.01 * pulse;
    target.position.z += 0.18 * pulse;
    target.rotation.x += 0.11 * pulse;
    target.rotation.y -= 0.18 * pulse;
    target.rotation.z -= 0.08 * pulse;
    return;
  }

  target.position.x -= 0.04 * pulse;
  target.position.y += 0.006 * pulse;
  target.position.z -= 0.075 * pulse;
  target.rotation.x -= 0.055 * pulse;
  target.rotation.y += 0.12 * pulse;
  target.rotation.z -= 0.045 * pulse;
}

function applyHookshotSecondaryPoseToHand(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  pulse: number
): void {
  if (pulse <= 0) return;

  if (side === -1) {
    targets.arm.position.x -= 0.045 * pulse;
    targets.arm.position.y -= 0.01 * pulse;
    targets.arm.position.z += 0.18 * pulse;
    targets.arm.rotation.x += 0.11 * pulse;
    targets.arm.rotation.y -= 0.18 * pulse;
    targets.arm.rotation.z -= 0.08 * pulse;

    targets.wrist.position.z += 0.018 * pulse;
    targets.wrist.rotation.x += 0.045 * pulse;
    targets.wrist.rotation.y -= 0.028 * pulse;
    targets.wrist.rotation.z -= 0.026 * pulse;

    targets.palm.position.z += 0.01 * pulse;
    targets.palm.rotation.x += 0.032 * pulse;
    targets.palm.rotation.y -= 0.026 * pulse;
    targets.palm.rotation.z -= 0.02 * pulse;
    return;
  }

  targets.arm.position.x -= 0.04 * pulse;
  targets.arm.position.y += 0.006 * pulse;
  targets.arm.position.z -= 0.075 * pulse;
  targets.arm.rotation.x -= 0.055 * pulse;
  targets.arm.rotation.y += 0.12 * pulse;
  targets.arm.rotation.z -= 0.045 * pulse;

  targets.wrist.position.z -= 0.012 * pulse;
  targets.wrist.rotation.x -= 0.024 * pulse;
  targets.wrist.rotation.y += 0.032 * pulse;
  targets.wrist.rotation.z -= 0.014 * pulse;

  targets.palm.position.z -= 0.014 * pulse;
  targets.palm.rotation.x -= 0.02 * pulse;
  targets.palm.rotation.y += 0.026 * pulse;
  targets.palm.rotation.z -= 0.01 * pulse;
}

function isLocalHookshotHookDetached(side: -1 | 1): boolean {
  const state = useGameStore.getState();
  const localPlayerId = state.localPlayer?.id;
  if (!localPlayerId) return false;

  return (
    state.hookProjectiles.some(hook => (
      hook.ownerId === localPlayerId &&
      (hook.launchSide ?? 1) === side
    )) ||
    state.dragHooks.some(hook => (
      hook.ownerId === localPlayerId &&
      (hook.launchSide ?? 1) === side
    )) ||
    state.grappleLines.some(line => (
      line.ownerId === localPlayerId &&
      line.state !== 'done' &&
      (line.launchSide ?? 1) === side
    ))
  );
}

function createPhantomLocomotionRuntime(): PhantomLocomotionRuntime {
  return {
    movementBlend: 0,
    runBlend: 0,
    slideBlend: 0,
    speedBlend: 0,
    cycleTime: 0,
    previousCameraPosition: new THREE.Vector3(),
    hasPreviousCameraPosition: false,
  };
}

function updatePhantomLocomotionRuntime(
  locomotion: PhantomLocomotionRuntime,
  camera: THREE.Camera,
  delta: number
): void {
  const previousPosition = locomotion.previousCameraPosition;
  if (!locomotion.hasPreviousCameraPosition) {
    previousPosition.copy(camera.position);
    locomotion.hasPreviousCameraPosition = true;
    return;
  }

  const dx = camera.position.x - previousPosition.x;
  const dz = camera.position.z - previousPosition.z;
  const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
  previousPosition.copy(camera.position);

  const frameSeconds = Math.max(delta, 1 / 120);
  const horizontalSpeed = horizontalDistance > PHANTOM_LOCOMOTION_TELEPORT_DISTANCE
    ? 0
    : horizontalDistance / frameSeconds;
  const store = useGameStore.getState();
  const movementState = store.localPlayer?.movement;
  const isGrounded = movementState?.isGrounded ?? true;
  const isSliding = movementState?.isSliding ?? false;
  const targetSlideBlend = THREE.MathUtils.clamp(
    Math.max(isSliding ? 1 : 0, store.slideIntensity),
    0,
    1
  );
  const speedMoveBlend = THREE.MathUtils.smoothstep(
    horizontalSpeed,
    PHANTOM_LOCOMOTION_MOVE_START_SPEED,
    PHANTOM_LOCOMOTION_FULL_WALK_SPEED
  );
  const targetMovementBlend = isGrounded && targetSlideBlend <= 0.02 ? speedMoveBlend : 0;
  const speedRunBlend = THREE.MathUtils.smoothstep(
    horizontalSpeed,
    PHANTOM_LOCOMOTION_RUN_START_SPEED,
    PHANTOM_LOCOMOTION_RUN_FULL_SPEED
  );
  const targetRunBlend = targetMovementBlend * Math.max(
    speedRunBlend,
    movementState?.isSprinting ? 1 : 0
  );
  const targetSpeedBlend = THREE.MathUtils.clamp(horizontalSpeed / PHANTOM_RUN_SPEED, 0, 1.35);

  locomotion.movementBlend = THREE.MathUtils.damp(
    locomotion.movementBlend,
    targetMovementBlend,
    targetMovementBlend > locomotion.movementBlend ? 12 : 8.5,
    delta
  );
  locomotion.runBlend = THREE.MathUtils.damp(
    locomotion.runBlend,
    targetRunBlend,
    10,
    delta
  );
  locomotion.slideBlend = THREE.MathUtils.damp(
    locomotion.slideBlend,
    targetSlideBlend,
    targetSlideBlend > locomotion.slideBlend ? 13 : 8,
    delta
  );
  locomotion.speedBlend = THREE.MathUtils.damp(
    locomotion.speedBlend,
    targetSpeedBlend,
    9,
    delta
  );

  if (locomotion.movementBlend <= 0.002) return;

  const cycleSpeed = THREE.MathUtils.lerp(
    PHANTOM_LOCOMOTION_WALK_CYCLE_SPEED,
    PHANTOM_LOCOMOTION_RUN_CYCLE_SPEED,
    locomotion.runBlend
  ) * THREE.MathUtils.lerp(
    0.82,
    1.14,
    THREE.MathUtils.clamp(locomotion.speedBlend, 0, 1)
  );
  locomotion.cycleTime = (locomotion.cycleTime + delta * cycleSpeed) % (Math.PI * 2);
}
function composePhantomPrimaryPalmMatrix({
  camera,
  elapsedSeconds,
  actionBlend,
  targetingBlend,
  side,
  holdBlend,
  shotPulse,
  locomotion,
}: {
  camera: THREE.Camera;
  elapsedSeconds: number;
  actionBlend: number;
  targetingBlend: number;
  side: -1 | 1;
  holdBlend: number;
  shotPulse: number;
  locomotion?: PhantomLocomotionPose;
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
  writePhantomHandPose(poseTarget, side, holdBlend, shotPulse, elapsedSeconds, locomotion);

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
  targetingBlend: number,
  locomotion?: PhantomLocomotionPose
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
    locomotion,
  });

  worldMatrix.decompose(phantomWorldPosition, phantomWorldQuaternion, phantomWorldScale);

  return {
    position: phantomWorldPosition.clone(),
    quaternion: phantomWorldQuaternion.clone(),
    timestampMs,
  };
}

function composePhantomVoidRayOrbMatrix({
  camera,
  elapsedSeconds,
  actionBlend,
  targetingBlend,
}: {
  camera: THREE.Camera;
  elapsedSeconds: number;
  actionBlend: number;
  targetingBlend: number;
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

  matrixPosition.copy(PHANTOM_VOID_RAY_RELEASE_ORIGIN_POSITION);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(phantomSocketMatrix, matrixPosition, matrixEuler);

  camera.updateMatrixWorld();
  phantomWorldMatrix
    .copy(camera.matrixWorld)
    .multiply(viewmodelRootMatrix)
    .multiply(phantomOffsetMatrix)
    .multiply(phantomSocketMatrix);

  return phantomWorldMatrix;
}

function samplePhantomVoidRayOrbSocket(
  context: PhantomVoidRayOrbPoseSampleContext,
  actionBlend: number,
  targetingBlend: number
): ViewmodelSocketPoseDraft {
  const timestampMs = context.timestampMs ?? Date.now();
  const worldMatrix = composePhantomVoidRayOrbMatrix({
    camera: context.camera,
    elapsedSeconds: context.elapsedSeconds,
    actionBlend,
    targetingBlend,
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
  voidRayReleaseRef,
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
  voidRayReleaseRef: MutableRefObject<PhantomVoidRayReleaseState | null>;
  locomotionRef: MutableRefObject<PhantomLocomotionPose>;
}) {
  const forearmRef = useRef<THREE.Group>(null);
  const length = 0.32;
  const rearLength = 0.38;
  const rearCenterZ = length * 0.5 + rearLength * 0.5 - 0.018;
  const width = 0.074;
  const thickness = 0.066;
  const reloadGlowMaterial = useMemo(createPhantomReloadGlowMaterial, []);

  useEffect(() => () => {
    reloadGlowMaterial.dispose();
  }, [reloadGlowMaterial]);

  useFrame((state) => {
    const forearm = forearmRef.current;
    if (!forearm) return;

    const nowMs = Date.now();
    const attack = primaryAttackRef.current;
    const attackTimeSeconds = attack?.side === side
      ? (nowMs - attack.startTimeMs) / 1000
      : Number.POSITIVE_INFINITY;
    const reloadPose = getPhantomReloadPose(nowMs, state.clock.elapsedTime, side);
    const chargePose = getPhantomVoidRayChargePose(nowMs, state.clock.elapsedTime);
    const voidRayReleasePulse = reloadPose.active
      ? 0
      : getPhantomVoidRayReleasePulse(voidRayReleaseRef.current, nowMs);
    const voidRayReleaseExtensionBlend = reloadPose.active
      ? 0
      : getPhantomVoidRayReleaseExtensionBlend(voidRayReleaseRef.current, nowMs);
    const baseHoldBlend = reloadPose.active || chargePose.active ? 0 : getPhantomPrimaryHeldBlend(nowMs);
    const holdBlend = Math.max(baseHoldBlend, voidRayReleasePulse, voidRayReleaseExtensionBlend * 0.78);
    const primaryShotPulse = getPhantomPrimaryShotPulse(attackTimeSeconds);
    const shotPulse = reloadPose.active ? 0 : Math.max(primaryShotPulse, voidRayReleasePulse);
    writePhantomForearmPose(
      forearm,
      side,
      holdBlend,
      shotPulse,
      state.clock.elapsedTime,
      locomotionRef.current
    );
    applyPhantomVoidRayChargeForearmPose(forearm, side, chargePose, 0.92);
    applyPhantomVoidRayReleaseForearmPose(forearm, side, voidRayReleaseExtensionBlend);
    applyPhantomReloadMotion(forearm, side, reloadPose, 0.82);
    reloadGlowMaterial.opacity = Math.max(
      reloadPose.glowOpacity * 0.42,
      chargePose.glowOpacity * 0.58,
      voidRayReleasePulse * 0.36,
      voidRayReleaseExtensionBlend * 0.24
    );
  });

  return (
    <group ref={forearmRef} position={[side * 0.34, -0.58, -0.43]} rotation={[0.22, side * -0.18, side * -0.06]}>
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -thickness * 0.04, rearCenterZ]} scale={[width * 0.86, thickness * 1.08, rearLength]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, thickness * 0.28, rearCenterZ - rearLength * 0.06]} scale={[width * 0.96, thickness * 0.58, rearLength * 0.72]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, thickness * 0.64, rearCenterZ - rearLength * 0.05]} scale={[width * 0.56, Math.max(0.014, thickness * 0.18), rearLength * 0.38]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[width * 0.72, thickness, length]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, thickness * 0.27, -0.06]} scale={[width, thickness * 0.7, length * 0.7]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.005, -length * 0.5]} scale={[width * 0.86, thickness, 0.1]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, thickness * 0.7, -0.09]} scale={[width * 0.56, Math.max(0.014, thickness * 0.2), length * 0.46]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={reloadGlowMaterial} position={[0, thickness * 0.32, -0.08]} scale={[width * 1.08, thickness * 0.84, length * 0.84]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={reloadGlowMaterial} position={[0, thickness * 0.82, -0.1]} scale={[width * 0.7, Math.max(0.018, thickness * 0.28), length * 0.58]} />
    </group>
  );
}

function PhantomPoseableHand({
  side,
  materials,
  primaryAttackRef,
  voidRayReleaseRef,
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
  voidRayReleaseRef: MutableRefObject<PhantomVoidRayReleaseState | null>;
  locomotionRef: MutableRefObject<PhantomLocomotionPose>;
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
  const reloadGlowMaterial = useMemo(createPhantomReloadGlowMaterial, []);

  useEffect(() => {
    if (!socketRef.current) return undefined;
    return registerViewmodelSocket(PHANTOM_PRIMARY_PALM_SOCKET_NAMES[side], socketRef.current);
  }, [side]);

  useEffect(() => () => {
    reloadGlowMaterial.dispose();
  }, [reloadGlowMaterial]);

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
    const reloadPose = getPhantomReloadPose(nowMs, state.clock.elapsedTime, side);
    const chargePose = getPhantomVoidRayChargePose(nowMs, state.clock.elapsedTime);
    const voidRayReleasePulse = reloadPose.active
      ? 0
      : getPhantomVoidRayReleasePulse(voidRayReleaseRef.current, nowMs);
    const voidRayReleaseExtensionBlend = reloadPose.active
      ? 0
      : getPhantomVoidRayReleaseExtensionBlend(voidRayReleaseRef.current, nowMs);
    const baseHoldBlend = reloadPose.active || chargePose.active ? 0 : getPhantomPrimaryHeldBlend(nowMs);
    const holdBlend = Math.max(baseHoldBlend, voidRayReleasePulse, voidRayReleaseExtensionBlend * 0.82);
    const primaryShotPulse = getPhantomPrimaryShotPulse(attackTimeSeconds);
    const shotPulse = reloadPose.active ? 0 : Math.max(primaryShotPulse, voidRayReleasePulse);
    const chargeOpenBlend = reloadPose.active ? 0 : chargePose.blend;
    const openVisualBlend = THREE.MathUtils.smoothstep(
      Math.max(holdBlend, chargeOpenBlend),
      0.02,
      0.72
    );
    const closedVisualBlend = 1 - THREE.MathUtils.smoothstep(
      Math.max(holdBlend, chargeOpenBlend),
      0,
      0.5
    );

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
        ...(closedVisual ? { closedHand: closedVisual } : {}),
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      holdBlend,
      shotPulse,
      state.clock.elapsedTime,
      locomotionRef.current
    );
    applyPhantomVoidRayChargeHandPose(
      {
        ...(closedVisual ? { closedHand: closedVisual } : {}),
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      chargePose,
      state.clock.elapsedTime
    );
    applyPhantomVoidRayReleaseHandPose(
      {
        ...(closedVisual ? { closedHand: closedVisual } : {}),
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      voidRayReleaseExtensionBlend
    );
    applyPhantomReloadMotion(arm, side, reloadPose);
    if (closedVisual) {
      applyPhantomReloadMotion(closedVisual, side, reloadPose);
    }
    reloadGlowMaterial.opacity = Math.max(
      reloadPose.glowOpacity * 0.62,
      chargePose.glowOpacity * 0.86,
      voidRayReleasePulse * 0.5,
      voidRayReleaseExtensionBlend * 0.34
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
        <group position={[0, 0, -PHANTOM_CLOSED_HAND_WRIST_PIVOT_Z]}>
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
          <mesh
            geometry={SHARED_GEOMETRIES.box}
            material={reloadGlowMaterial}
            position={[0, 0, -0.012]}
            scale={[0.132, 0.154, 0.132]}
          />
          <mesh
            geometry={SHARED_GEOMETRIES.box}
            material={reloadGlowMaterial}
            position={[side * -0.048, 0, -0.078]}
            scale={[0.052, 0.122, 0.042]}
          />
        </group>
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
              <mesh
                geometry={SHARED_GEOMETRIES.box}
                material={reloadGlowMaterial}
                position={[0, 0.018, -0.012]}
                scale={[0.126, 0.15, 0.072]}
              />
              <mesh
                geometry={SHARED_GEOMETRIES.box}
                material={reloadGlowMaterial}
                position={[0, 0.096, -0.034]}
                scale={[0.126, 0.112, 0.048]}
              />
              <mesh
                geometry={SHARED_GEOMETRIES.box}
                material={reloadGlowMaterial}
                position={[thumbSide * 0.058, 0.01, -0.032]}
                scale={[0.062, 0.05, 0.044]}
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

function createPhantomVoidRayChargeOrbMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function PhantomVoidRayChargeOrb() {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const coreMaterial = useMemo(() => createPhantomVoidRayChargeOrbMaterial(PHANTOM_COLORS.white), []);
  const shellMaterial = useMemo(() => createPhantomVoidRayChargeOrbMaterial(PHANTOM_COLORS.lightPurple), []);
  const haloMaterial = useMemo(() => createPhantomVoidRayChargeOrbMaterial(PHANTOM_COLORS.cyan), []);

  useEffect(() => () => {
    coreMaterial.dispose();
    shellMaterial.dispose();
    haloMaterial.dispose();
  }, [coreMaterial, haloMaterial, shellMaterial]);

  useFrame((state) => {
    const group = groupRef.current;
    const core = coreRef.current;
    const shell = shellRef.current;
    const halo = haloRef.current;
    if (!group || !core || !shell || !halo) return;

    const chargePose = getPhantomVoidRayChargePose(Date.now(), state.clock.elapsedTime);
    const visible = chargePose.active && chargePose.blend > 0.015;
    group.visible = visible;

    if (!visible) {
      coreMaterial.opacity = 0;
      shellMaterial.opacity = 0;
      haloMaterial.opacity = 0;
      return;
    }

    const orbScale = Math.max(0.001, chargePose.orbScale);
    const energyPulse = 1 + Math.sin(state.clock.elapsedTime * 18.5) * 0.045 * chargePose.blend;

    group.position.copy(PHANTOM_VOID_RAY_ORB_POSITION);
    group.rotation.set(
      state.clock.elapsedTime * 0.22,
      state.clock.elapsedTime * 0.5,
      state.clock.elapsedTime * 0.34
    );

    core.scale.setScalar(orbScale * energyPulse);
    shell.scale.setScalar(orbScale * 1.72);
    halo.scale.set(orbScale * 2.7, orbScale * 2.7, orbScale * 0.18);

    coreMaterial.opacity = chargePose.orbOpacity;
    shellMaterial.opacity = chargePose.orbOpacity * 0.48;
    haloMaterial.opacity = chargePose.orbOpacity * 0.36;
  });

  return (
    <group ref={groupRef} position={[
      PHANTOM_VOID_RAY_ORB_POSITION.x,
      PHANTOM_VOID_RAY_ORB_POSITION.y,
      PHANTOM_VOID_RAY_ORB_POSITION.z,
    ]} visible={false}>
      <mesh ref={coreRef} geometry={SHARED_GEOMETRIES.sphere12} material={coreMaterial} scale={0.001} />
      <mesh ref={shellRef} geometry={SHARED_GEOMETRIES.sphere16} material={shellMaterial} scale={0.001} />
      <mesh ref={haloRef} geometry={SHARED_GEOMETRIES.ring24} material={haloMaterial} scale={0.001} />
    </group>
  );
}

function PhantomViewmodel({
  materials,
  primaryAttackRef,
  voidRayReleaseRef,
  locomotionRef,
}: {
  materials: ViewmodelMaterialSet;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
  voidRayReleaseRef: MutableRefObject<PhantomVoidRayReleaseState | null>;
  locomotionRef: MutableRefObject<PhantomLocomotionPose>;
}) {
  return (
    <group position={[
      PHANTOM_VIEWMODEL_OFFSET.x,
      PHANTOM_VIEWMODEL_OFFSET.y,
      PHANTOM_VIEWMODEL_OFFSET.z,
    ]}>
      <PhantomAnimatedForearm side={-1} materials={materials} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomAnimatedForearm side={1} materials={materials} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomPoseableHand side={-1} materials={materials} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomPoseableHand side={1} materials={materials} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomVoidRayChargeOrb />
    </group>
  );
}

function HookshotPhantomForearm({
  side,
  materials,
  primaryFireRef,
  secondaryFireRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryFireRef: MutableRefObject<HookshotPrimaryFireState | null>;
  secondaryFireRef: MutableRefObject<HookshotSecondaryFireState | null>;
}) {
  const forearmRef = useRef<THREE.Group>(null);
  const length = 0.32;
  const rearLength = 0.38;
  const rearCenterZ = length * 0.5 + rearLength * 0.5 - 0.018;
  const width = 0.074;
  const thickness = 0.066;

  useFrame((state) => {
    const forearm = forearmRef.current;
    if (!forearm) return;
    writePhantomForearmPose(forearm, side, 0, 0, state.clock.elapsedTime);
    applyHookshotPrimaryRecoilToForearm(
      forearm,
      side,
      getHookshotPrimaryRecoilPulse(primaryFireRef.current, side, Date.now())
    );
    applyHookshotSecondaryPoseToForearm(
      forearm,
      side,
      getHookshotSecondaryPosePulse(secondaryFireRef.current, Date.now())
    );
  });

  return (
    <group
      ref={forearmRef}
      position={[side * 0.34, -0.58, -0.43]}
      rotation={[0.22, side * -0.18, side * -0.06]}
    >
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -thickness * 0.04, rearCenterZ]} scale={[width * 0.86, thickness * 1.08, rearLength]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, thickness * 0.28, rearCenterZ - rearLength * 0.06]} scale={[width * 0.96, thickness * 0.58, rearLength * 0.72]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[0, thickness * 0.64, rearCenterZ - rearLength * 0.05]} scale={[width * 0.56, Math.max(0.014, thickness * 0.18), rearLength * 0.38]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -thickness * 0.04, 0]} scale={[width * 0.78, thickness * 1.05, length]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, thickness * 0.24, -0.02]} scale={[width, thickness * 0.66, length * 0.74]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.006, -length * 0.48]} scale={[width * 0.92, thickness * 0.94, 0.085]} />
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.038, thickness * 0.69, -0.052]} scale={[0.034, Math.max(0.014, thickness * 0.2), length * 0.54]} />
    </group>
  );
}

function HookshotSimpleHookHand({
  side,
  materials,
  primaryFireRef,
  secondaryFireRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryFireRef: MutableRefObject<HookshotPrimaryFireState | null>;
  secondaryFireRef: MutableRefObject<HookshotSecondaryFireState | null>;
}) {
  const armRef = useRef<THREE.Group>(null);
  const wristRef = useRef<THREE.Group>(null);
  const palmRef = useRef<THREE.Group>(null);
  const thumbRef = useRef<THREE.Group>(null);
  const hookSocketRef = useRef<THREE.Group>(null);
  const hookVisualRef = useRef<THREE.Group>(null);
  const fingerRefs = useRef<(THREE.Group | null)[]>([]);
  const hookMaterials = getHookshotMaterials();

  useEffect(() => {
    if (!hookSocketRef.current) return undefined;
    return registerViewmodelSocket(HOOKSHOT_HOOK_SOCKET_NAMES[side], hookSocketRef.current);
  }, [side]);

  const isHookProjectileDetached = useGameStore(
    useShallow(state => {
      const localPlayerId = state.localPlayer?.id;
      return Boolean(localPlayerId && (
        state.hookProjectiles.some(hook => hook.ownerId === localPlayerId && (hook.launchSide ?? 1) === side) ||
        state.dragHooks.some(hook => hook.ownerId === localPlayerId && (hook.launchSide ?? 1) === side) ||
        state.grappleLines.some(line => line.ownerId === localPlayerId && line.state !== 'done' && (line.launchSide ?? 1) === side)
      ));
    })
  );

  useFrame((state) => {
    const arm = armRef.current;
    const wrist = wristRef.current;
    const palm = palmRef.current;
    const thumb = thumbRef.current;
    const fingers = fingerRefs.current.filter(Boolean) as THREE.Group[];
    if (!arm || !wrist || !palm || !thumb || fingers.length !== 4) return;

    const secondaryPulse = getHookshotSecondaryPosePulse(secondaryFireRef.current, Date.now());
    if (hookVisualRef.current) {
      hookVisualRef.current.visible = !isLocalHookshotHookDetached(side) && secondaryPulse <= 0.01;
    }

    const targets = {
      arm,
      wrist,
      palm,
      thumb,
      fingers,
    };
    writePhantomHandPose(
      targets,
      side,
      0,
      0,
      state.clock.elapsedTime
    );
    applyHookshotPrimaryRecoilToHand(
      targets,
      side,
      getHookshotPrimaryRecoilPulse(primaryFireRef.current, side, Date.now())
    );
    applyHookshotSecondaryPoseToHand(
      targets,
      side,
      secondaryPulse
    );
  });

  return (
    <group
      ref={armRef}
      position={[
        side * PHANTOM_IDLE_HAND_POSITION.x,
        PHANTOM_IDLE_HAND_POSITION.y,
        PHANTOM_IDLE_HAND_POSITION.z,
      ]}
      rotation={[
        PHANTOM_IDLE_HAND_ROTATION.x,
        side * PHANTOM_IDLE_HAND_ROTATION.y,
        side * PHANTOM_IDLE_HAND_ROTATION.z,
      ]}
    >
      <group ref={wristRef}>
        <group ref={palmRef}>
          <group ref={thumbRef} visible={false} />
          {PHANTOM_OPEN_FINGER_SLOTS.map((slot, index) => (
            <group
              key={slot}
              ref={(node) => {
                fingerRefs.current[index] = node;
              }}
              visible={false}
            />
          ))}

          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, 0, 0.048]} scale={[0.078, 0.104, 0.092]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.01, 0.006, 0.032]} scale={[0.064, 0.084, 0.064]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.048, 0, 0.006]} scale={[0.014, 0.074, 0.05]} />
          <mesh
            geometry={SHARED_GEOMETRIES.cylinder8}
            material={hookMaterials.shaft}
            position={[0, 0.006, HOOKSHOT_LAUNCHER_TUBE_CENTER_Z]}
            rotation={[Math.PI / 2, 0, 0]}
            scale={[0.028, HOOKSHOT_LAUNCHER_TUBE_LENGTH, 0.028]}
          />
          <mesh
            geometry={SHARED_GEOMETRIES.ring16}
            material={hookMaterials.ring}
            position={[0, 0.006, HOOKSHOT_LAUNCHER_RING_Z]}
            scale={[0.044, 0.044, 1]}
          />
          <mesh
            geometry={SHARED_GEOMETRIES.ring16}
            material={hookMaterials.glow}
            position={[0, 0.006, HOOKSHOT_LAUNCHER_RING_Z - 0.001]}
            scale={[0.054, 0.054, 1]}
          />
          <group ref={hookVisualRef} visible={!isHookProjectileDetached}>
            <HookshotViewmodelArrow
              side={side}
              materials={{
                shaft: hookMaterials.shaft,
                tip: hookMaterials.tip,
                glow: hookMaterials.glow,
              }}
              lightIntensity={2.1}
            />
          </group>
          <group ref={hookSocketRef} name={HOOKSHOT_HOOK_SOCKET_NAMES[side]} position={[0, 0.006, HOOKSHOT_LAUNCHER_TUBE_FRONT_Z]} />
        </group>
      </group>
    </group>
  );
}

function HookshotViewmodel({
  materials,
  primaryFireRef,
  secondaryFireRef,
}: {
  materials: ViewmodelMaterialSet;
  primaryFireRef: MutableRefObject<HookshotPrimaryFireState | null>;
  secondaryFireRef: MutableRefObject<HookshotSecondaryFireState | null>;
}) {
  return (
    <group position={[
      PHANTOM_VIEWMODEL_OFFSET.x,
      PHANTOM_VIEWMODEL_OFFSET.y,
      PHANTOM_VIEWMODEL_OFFSET.z,
    ]}>
      <HookshotPhantomForearm side={-1} materials={materials} primaryFireRef={primaryFireRef} secondaryFireRef={secondaryFireRef} />
      <HookshotPhantomForearm side={1} materials={materials} primaryFireRef={primaryFireRef} secondaryFireRef={secondaryFireRef} />
      <HookshotSimpleHookHand side={-1} materials={materials} primaryFireRef={primaryFireRef} secondaryFireRef={secondaryFireRef} />
      <HookshotSimpleHookHand side={1} materials={materials} primaryFireRef={primaryFireRef} secondaryFireRef={secondaryFireRef} />
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
  const actionBlendRef = useRef(action.active ? 1 : 0);
  const targetingBlendRef = useRef(action.targeting ? 1 : 0);
  const phantomPrimaryAttackRef = useRef<PhantomPrimaryAttackState | null>(null);
  const phantomVoidRayReleaseRef = useRef<PhantomVoidRayReleaseState | null>(null);
  const hookshotPrimaryFireRef = useRef<HookshotPrimaryFireState | null>(null);
  const hookshotSecondaryFireRef = useRef<HookshotSecondaryFireState | null>(null);
  const phantomLocomotionRef = useRef<PhantomLocomotionRuntime>(createPhantomLocomotionRuntime());
  const processedPhantomPrimaryEventIdRef = useRef<string | null>(null);
  const processedPhantomVoidRayEventIdRef = useRef<string | null>(null);
  const processedHookshotPrimaryEventIdRef = useRef<string | null>(null);
  const processedHookshotSecondaryEventIdRef = useRef<string | null>(null);
  const materials = useMemo(() => getViewmodelMaterials(heroId), [heroId]);

  useEffect(() => {
    if (heroId !== 'phantom') return undefined;

    const unregisterLeft = registerViewmodelPoseSampler<PhantomPrimaryPoseSampleContext>(
      PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1],
      (context) => samplePhantomPrimaryPalmSocket(
        { ...context, side: -1 },
        actionBlendRef.current,
        targetingBlendRef.current,
        phantomLocomotionRef.current
      )
    );
    const unregisterRight = registerViewmodelPoseSampler<PhantomPrimaryPoseSampleContext>(
      PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1],
      (context) => samplePhantomPrimaryPalmSocket(
        { ...context, side: 1 },
        actionBlendRef.current,
        targetingBlendRef.current,
        phantomLocomotionRef.current
      )
    );
    const unregisterVoidRayOrb = registerViewmodelPoseSampler<PhantomVoidRayOrbPoseSampleContext>(
      PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
      (context) => samplePhantomVoidRayOrbSocket(
        context,
        actionBlendRef.current,
        targetingBlendRef.current
      )
    );

    return () => {
      unregisterLeft();
      unregisterRight();
      unregisterVoidRayOrb();
    };
  }, [heroId]);

  useFrame((state, delta) => {
    if (!groupRef.current || !rootRef.current) return;

    const liveAction = getActionState(heroId);
    actionBlendRef.current = THREE.MathUtils.damp(
      actionBlendRef.current,
      liveAction.active ? 1 : 0,
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
      updatePhantomLocomotionRuntime(phantomLocomotionRef.current, camera, delta);

      const store = useGameStore.getState();
      const localPlayerId = store.localPlayer?.id;
      if (localPlayerId) {
        const release = phantomVoidRayReleaseRef.current;
        if (
          release &&
          Date.now() - release.startTimeMs >
            (PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS + PHANTOM_VOID_RAY_RELEASE_EXTENSION_SECONDS) * 1000
        ) {
          phantomVoidRayReleaseRef.current = null;
        }

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
              startTimeMs: ball.startTime - PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS * 1000,
            };
          }
          break;
        }

        for (let index = store.voidRays.length - 1; index >= 0; index--) {
          const ray = store.voidRays[index];
          if (ray.ownerId !== localPlayerId) continue;

          if (processedPhantomVoidRayEventIdRef.current !== ray.id) {
            processedPhantomVoidRayEventIdRef.current = ray.id;
            phantomVoidRayReleaseRef.current = {
              eventId: ray.id,
              startTimeMs: ray.startTime - PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS * 1000,
            };
          }
          break;
        }
      }
    }

    if (heroId === 'hookshot') {
      const store = useGameStore.getState();
      const localPlayerId = store.localPlayer?.id;
      const activeRecoil = hookshotPrimaryFireRef.current;
      const activeSecondaryPose = hookshotSecondaryFireRef.current;
      if (
        activeRecoil &&
        Date.now() - activeRecoil.startTimeMs > HOOKSHOT_PRIMARY_RECOIL_DURATION_SECONDS * 1000
      ) {
        hookshotPrimaryFireRef.current = null;
      }
      if (
        activeSecondaryPose &&
        Date.now() - activeSecondaryPose.startTimeMs > HOOKSHOT_SECONDARY_POSE_DURATION_SECONDS * 1000
      ) {
        hookshotSecondaryFireRef.current = null;
      }

      if (localPlayerId) {
        for (let index = store.hookProjectiles.length - 1; index >= 0; index--) {
          const hook = store.hookProjectiles[index];
          if (hook.ownerId !== localPlayerId) continue;
          if (hook.launchSide !== -1 && hook.launchSide !== 1) continue;

          if (processedHookshotPrimaryEventIdRef.current !== hook.id) {
            processedHookshotPrimaryEventIdRef.current = hook.id;
            hookshotPrimaryFireRef.current = {
              eventId: hook.id,
              side: hook.launchSide,
              startTimeMs: hook.startTime,
            };
          }
          break;
        }

        for (let index = store.dragHooks.length - 1; index >= 0; index--) {
          const hook = store.dragHooks[index];
          if (hook.ownerId !== localPlayerId) continue;

          if (processedHookshotSecondaryEventIdRef.current !== hook.id) {
            processedHookshotSecondaryEventIdRef.current = hook.id;
            hookshotSecondaryFireRef.current = {
              eventId: hook.id,
              startTimeMs: hook.startTime,
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
          <PhantomViewmodel
            materials={materials}
            primaryAttackRef={phantomPrimaryAttackRef}
            voidRayReleaseRef={phantomVoidRayReleaseRef}
            locomotionRef={phantomLocomotionRef}
          />
        )}
        {heroId === 'hookshot' && (
          <HookshotViewmodel
            materials={materials}
            primaryFireRef={hookshotPrimaryFireRef}
            secondaryFireRef={hookshotSecondaryFireRef}
          />
        )}
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
            (viewmodelHeroId === 'hookshot' && (
              state.dragHooks.some(hook => hook.ownerId === localPlayerId) ||
              state.grappleLines.some(line => line.ownerId === localPlayerId)
            ))
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
