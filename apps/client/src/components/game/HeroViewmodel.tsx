import { memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useShallow } from 'zustand/shallow';
import {
  BLAZE_PRIMARY_RELOAD_MS,
  CHRONOS_PRIMARY_RELOAD_MS,
  HERO_DEFINITIONS,
  isPhantomUmbralDecoyCloaked,
  PHANTOM_PRIMARY_RELOAD_MS,
  SPRINT_MULTIPLIER,
  VOID_RAY_CHARGE_TIME,
  type HeroId,
  type HeroSkinId,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import {
  PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_PRIMARY_VISUAL_FIRE_LEAD_SECONDS,
  PHANTOM_VOID_RAY_RELEASE_EXTENSION_SECONDS,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  getPhantomPrimaryHeldBlend,
  getPhantomShieldCastPose,
  getPhantomPrimaryShotPulse,
  getPhantomVeilCastPose,
  type PhantomPrimaryPoseSampleContext,
  type PhantomShieldCastPose,
  type PhantomVoidRayOrbPoseSampleContext,
} from '../../viewmodel/phantomPrimaryPose';
import {
  BLAZE_STAFF_SHOCKWAVE_DURATION_MS,
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  getBlazeRocketJumpStaffSlamPose,
  getBlazeStaffHeldBlend,
  getBlazeStaffShockwaveEvent,
  type BlazeRocketJumpStaffSlamPose,
  type BlazeRocketStaffPoseSampleContext,
} from '../../viewmodel/blazePose';
import {
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  getChronosAscendantParadoxPose,
  getChronosLifelineQueuedPose,
  getChronosLifelineConduitPose,
  getChronosPrimaryHeldBlend,
  getChronosPrimaryShotGlowBlend,
  getChronosTimebreakPose,
  type ChronosPrimaryOrbPoseSampleContext,
} from '../../viewmodel/chronosPose';
import {
  HOOKSHOT_HOOK_SOCKET_NAMES,
  HOOKSHOT_PRIMARY_RECOIL_DURATION_SECONDS,
  HOOKSHOT_SECONDARY_POSE_DURATION_SECONDS,
} from '../../viewmodel/hookshotPose';
import {
  registerViewmodelPoseSamplers,
  useRegisteredViewmodelSocket,
  writeViewmodelPoseDraftFromMatrix,
  type ViewmodelSocketPoseDraft,
} from '../../viewmodel/viewmodelKit';
import { SHARED_VIEWMODEL_ROOT_OFFSET } from '../../viewmodel/viewmodelManifests';
import { visualStore } from '../../store/visualStore';
import {
  PHANTOM_COLORS,
  SHARED_GEOMETRIES,
  getHookshotMaterials,
} from './effectResources';
import {
  HERO_MATERIAL_COLORS,
  getViewmodelMaterialsForSkin,
  isViewmodelHero,
  type ViewmodelHeroId,
  type ViewmodelMaterialSet,
} from './heroViewmodelMaterials';
import { ViewmodelSkinOverlay } from './viewmodelSkinOverlays';
import {
  getActionState,
  hasOwnedActiveGrappleLineOnSide,
  hasOwnedProjectileOnSide,
  isViewmodelActionActive,
  type ViewmodelActionState,
} from './heroViewmodelActions';
import { HookshotViewmodelArrow } from './hookshot/arrowHead';
import {
  createPhantomVeilSplitMaterial,
  updatePhantomVeilSplitMaterial,
} from './phantom/veilClap';
import {
  CHRONOS_AEGIS_PANEL_HEIGHT,
  CHRONOS_AEGIS_PANEL_WIDTH,
  createChronosAegisPanelGeometry,
} from './chronos/aegisGeometry';
import { BudgetedPointLight } from './systems/DynamicLightBudget';
import type { ViewmodelQualityConfig } from './visualQuality';
import { ViewmodelBurnOverlay } from './ViewmodelBurnOverlay';
import { playSharedSound } from '../../hooks/useAudio';

interface HeroViewmodelProps {
  heroId: ViewmodelHeroId;
  skinId?: HeroSkinId | string | null;
  action: ViewmodelActionState;
  config: ViewmodelQualityConfig;
}

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

function resolveFingerTargets(fingerRefs: (THREE.Group | null)[]): THREE.Group[] | null {
  if (!fingerRefs[0] || !fingerRefs[1] || !fingerRefs[2] || !fingerRefs[3]) {
    return null;
  }
  return fingerRefs as THREE.Group[];
}

function createMutableTransformTarget(): MutableTransformTarget {
  return {
    position: new THREE.Vector3(),
    rotation: new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER),
  };
}

function createPhantomHandPoseTargets(): PhantomHandPoseTargets;
function createPhantomHandPoseTargets(includeClosedHand: true): PhantomHandPoseTargets & {
  closedHand: MutableTransformTarget;
};
function createPhantomHandPoseTargets(includeClosedHand = false): PhantomHandPoseTargets {
  const targets: PhantomHandPoseTargets = {
    arm: createMutableTransformTarget(),
    wrist: createMutableTransformTarget(),
    palm: createMutableTransformTarget(),
    thumb: createMutableTransformTarget(),
    fingers: Array.from({ length: 4 }, () => createMutableTransformTarget()),
  };
  if (includeClosedHand) targets.closedHand = createMutableTransformTarget();
  return targets;
}

interface ViewmodelLocomotionPose {
  movementBlend: number;
  runBlend: number;
  slideBlend: number;
  speedBlend: number;
  cycleTime: number;
}

interface ViewmodelLocomotionRuntime extends ViewmodelLocomotionPose {
  previousCameraPosition: THREE.Vector3;
  hasPreviousCameraPosition: boolean;
}

interface ChronosMovementBobRuntime {
  phase: number;
  movementBlend: number;
  runBlend: number;
  slideBlend: number;
  previousCameraPosition: THREE.Vector3;
  hasPreviousCameraPosition: boolean;
}

interface ChronosMovementBobOffset {
  horizontalX: number;
  verticalY: number;
  slideBlend: number;
}

interface ChronosAegisPose {
  active: boolean;
  aegisBlend: number;
  blend: number;
  spread: number;
  shield: number;
  recoil: number;
  spinBoost: number;
  heartbeat: number;
  durabilityRatio: number;
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
const DEFAULT_VIEWMODEL_ROOT_OFFSET = new THREE.Vector3(...SHARED_VIEWMODEL_ROOT_OFFSET);
const PHANTOM_PALM_SOCKET_OFFSET = new THREE.Vector3(0, 0.012, -0.4);
const PHANTOM_CLOSED_FINGER_ROWS = [-0.066, -0.022, 0.022, 0.066] as const;
const PHANTOM_OPEN_FINGER_SLOTS = [-0.056, -0.019, 0.019, 0.056] as const;
const PHANTOM_LOCOMOTION_MOVE_START_SPEED = 0.18;
const PHANTOM_LOCOMOTION_FULL_WALK_SPEED = 1.35;
const PHANTOM_LOCOMOTION_TELEPORT_DISTANCE = 1.45;
const PHANTOM_LOCOMOTION_WALK_CYCLE_SPEED = 7.35;
const PHANTOM_LOCOMOTION_RUN_CYCLE_SPEED = 10.95;
const PHANTOM_SLIDE_BLEND_IN_SPEED = 10;
const PHANTOM_SLIDE_BLEND_OUT_SPEED = 7;
const PHANTOM_SLIDE_BLEND_MAX_DELTA_SECONDS = 1 / 30;
const PHANTOM_SLIDE_HAND_PULLBACK_Z = 0.11;
const PHANTOM_SLIDE_FOREARM_PULLBACK_Z = 0.09;
const PHANTOM_CLOSED_HAND_WRIST_PIVOT_Z = 0.105;
const PHANTOM_PRIMARY_READY_HAND_TUCK_Z = 0.014;
const PHANTOM_PRIMARY_SHOT_HAND_EXTENSION_Z = 0.044;
const PHANTOM_PRIMARY_READY_FOREARM_TUCK_Z = 0.024;
const PHANTOM_PRIMARY_SHOT_FOREARM_EXTENSION_Z = 0.04;
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
const PHANTOM_VOID_RAY_ORB_POSITION = new THREE.Vector3(0, -0.472, -0.72);
const PHANTOM_VOID_RAY_RELEASE_ORIGIN_POSITION = new THREE.Vector3(0, -0.38, -2.15);
const PHANTOM_VEIL_SPLIT_POSITION = new THREE.Vector3(0, -0.22, -0.58);
const PHANTOM_VEIL_SPLIT_BASE_SCALE = new THREE.Vector3(0.88, 2.1, 1);
const PHANTOM_VEIL_ARM_GLOW_FADE_MS = 420;
const HOOKSHOT_LAUNCHER_TUBE_LENGTH = 0.096;
const HOOKSHOT_LAUNCHER_TUBE_CENTER_Z = -HOOKSHOT_LAUNCHER_TUBE_LENGTH * 0.5;
const HOOKSHOT_LAUNCHER_TUBE_FRONT_Z = -HOOKSHOT_LAUNCHER_TUBE_LENGTH;
const HOOKSHOT_LAUNCHER_RING_Z = HOOKSHOT_LAUNCHER_TUBE_FRONT_Z - 0.003;
const BLAZE_RIGHT_FOREARM_READY_BLEND = 0.025;
const BLAZE_RIGHT_HAND_READY_BLEND = 0.035;
const BLAZE_STAFF_POSITION = new THREE.Vector3(0.006, -0.034, -0.088);
const BLAZE_STAFF_ROTATION = new THREE.Euler(-0.23, -0.075, 0.24, VIEWMODEL_ROOT_EULER_ORDER);
const BLAZE_STAFF_TIP_LOCAL_POSITION = new THREE.Vector3(0, 0.592, 0);
const BLAZE_STAFF_TIP_PRONG_ANGLES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5] as const;
const BLAZE_STAFF_TIP_FLAME_ANGLES = [
  Math.PI / 4,
  Math.PI * 0.75,
  Math.PI * 1.25,
  Math.PI * 1.75,
] as const;
const BLAZE_STAFF_RELOAD_FLAMES = [
  { y: -0.38, angle: 0, progress: 0.02, size: 1.06 },
  { y: -0.32, angle: Math.PI * 0.74, progress: 0.08, size: 0.92 },
  { y: -0.25, angle: Math.PI * 1.36, progress: 0.15, size: 1.12 },
  { y: -0.18, angle: Math.PI * 0.3, progress: 0.23, size: 0.98 },
  { y: -0.1, angle: Math.PI * 1.02, progress: 0.31, size: 1.18 },
  { y: -0.02, angle: Math.PI * 1.64, progress: 0.39, size: 0.96 },
  { y: 0.07, angle: Math.PI * 0.48, progress: 0.48, size: 1.16 },
  { y: 0.16, angle: Math.PI * 1.16, progress: 0.57, size: 1.02 },
  { y: 0.25, angle: Math.PI * 1.78, progress: 0.66, size: 1.2 },
  { y: 0.34, angle: Math.PI * 0.2, progress: 0.74, size: 1.08 },
  { y: 0.43, angle: Math.PI * 0.92, progress: 0.82, size: 1.24 },
  { y: 0.5, angle: Math.PI * 1.54, progress: 0.9, size: 1.1 },
] as const;
const BLAZE_STAFF_RELOAD_BURST_START = 0.78;
const BLAZE_STAFF_RELOAD_SHAFT_START_Y = -0.4;
const BLAZE_STAFF_RELOAD_SHAFT_END_Y = 0.52;
const BLAZE_STAFF_RELOAD_BURST_RAYS = [
  { angle: 0, pitch: -1.0, length: 1.16 },
  { angle: Math.PI * 0.25, pitch: -0.78, length: 0.84 },
  { angle: Math.PI * 0.5, pitch: -1.04, length: 1.08 },
  { angle: Math.PI * 0.75, pitch: -0.72, length: 0.9 },
  { angle: Math.PI, pitch: -1.0, length: 1.18 },
  { angle: Math.PI * 1.25, pitch: -0.8, length: 0.86 },
  { angle: Math.PI * 1.5, pitch: -1.06, length: 1.12 },
  { angle: Math.PI * 1.75, pitch: -0.76, length: 0.88 },
] as const;
const BLAZE_STAFF_RELOAD_BURST_SPARKS = [
  { angle: 0.2, lift: 0.074, distance: 0.22, delay: 0, size: 0.014 },
  { angle: 0.72, lift: 0.045, distance: 0.18, delay: 0.05, size: 0.01 },
  { angle: 1.24, lift: 0.092, distance: 0.26, delay: 0.01, size: 0.012 },
  { angle: 1.76, lift: 0.032, distance: 0.17, delay: 0.09, size: 0.009 },
  { angle: 2.34, lift: 0.082, distance: 0.24, delay: 0.03, size: 0.012 },
  { angle: 2.92, lift: 0.055, distance: 0.2, delay: 0.12, size: 0.009 },
  { angle: 3.48, lift: 0.096, distance: 0.28, delay: 0.02, size: 0.013 },
  { angle: 4.08, lift: 0.038, distance: 0.19, delay: 0.08, size: 0.01 },
  { angle: 4.7, lift: 0.078, distance: 0.25, delay: 0.04, size: 0.012 },
  { angle: 5.34, lift: 0.052, distance: 0.21, delay: 0.1, size: 0.009 },
] as const;
const CHRONOS_FOREARM_READY_BLEND = 0.52;
const CHRONOS_HAND_READY_BLEND = 0.62;
const CHRONOS_MOVEMENT_BOB_WALK_SPEED = 5.35;
const CHRONOS_MOVEMENT_BOB_RUN_SPEED = 8.15;
const CHRONOS_MOVEMENT_BOB_X = 0.032;
const CHRONOS_MOVEMENT_BOB_Y = 0.026;
const CHRONOS_MOVEMENT_BOB_MAX_DELTA_SECONDS = 1 / 30;
const CHRONOS_MOVEMENT_INPUT_FRESH_MS = 180;
const CHRONOS_FOREARM_CAMERA_PULLBACK_Z = 0.038;
const CHRONOS_HAND_CAMERA_PULLBACK_Z = 0.056;
const CHRONOS_FOREARM_SLIDE_CAMERA_PULLBACK_Z = 0.055;
const CHRONOS_HAND_SLIDE_CAMERA_PULLBACK_Z = 0.075;
const CHRONOS_SLIDE_PULLBACK_IN_SPEED = 10;
const CHRONOS_SLIDE_PULLBACK_OUT_SPEED = 7;
const CHRONOS_WEAPON_IDLE_POSITION = {
  x: 0,
  y: -0.365,
  z: -0.715,
} as const;
const CHRONOS_WEAPON_SOCKET_INWARD_X = 0.122;
const CHRONOS_WEAPON_SOCKET_Y = 0.018;
const CHRONOS_WEAPON_SOCKET_Z = -0.072;
const CHRONOS_WEAPON_BIND_LIFT_Y = 0.096;
const CHRONOS_WEAPON_BIND_FORWARD_Z = -0.062;
const CHRONOS_WEAPON_ORB_BASE_Y = -0.026;
const CHRONOS_WEAPON_ORB_HOVER_Y = 0.0032;
const CHRONOS_WEAPON_ORB_PRIMARY_HOLD_GLOW = 0.34;
const CHRONOS_WEAPON_ORB_GLOW_BASE_OPACITY = 0.38;
const CHRONOS_WEAPON_ORB_GLOW_HELD_OPACITY = 0.72;
const CHRONOS_WEAPON_ORB_LIGHT_BASE_INTENSITY = 0.34;
const CHRONOS_WEAPON_ORB_LIGHT_HELD_INTENSITY = 0.92;
const CHRONOS_WEAPON_PYRAMID_FACE_BASE_OPACITY = 0.3;
const CHRONOS_WEAPON_PYRAMID_FACE_GLOW_OPACITY = 0.58;
const CHRONOS_WEAPON_PYRAMID_EMISSIVE_BASE_INTENSITY = 0.2;
const CHRONOS_WEAPON_PYRAMID_EMISSIVE_GLOW_INTENSITY = 1.28;
const CHRONOS_WEAPON_PYRAMID_WIRE_BASE_OPACITY = 0.9;
const CHRONOS_WEAPON_PYRAMID_WIRE_GLOW_OPACITY = 1;
const CHRONOS_WEAPON_PYRAMID_FORWARD_TILT_X = -0.18;
const CHRONOS_WEAPON_PYRAMID_SPIN_SPEED = 0.22;
const CHRONOS_WEAPON_PYRAMID_PRIMARY_SPIN_BOOST = 0.86;
const CHRONOS_WEAPON_PYRAMID_RELOAD_SPIN_BOOST = 7.2;
const CHRONOS_WEAPON_PYRAMID_HEARTBEAT_GROWTH = 0.085;
const CHRONOS_WEAPON_RELOAD_AURA_PUFFS = [
  { angle: 0.08, radius: 0.26, y: 0.1, offset: 0.0, speed: 1.02, swirl: 0.72, size: 1.1 },
  { angle: 0.52, radius: 0.32, y: -0.06, offset: 0.08, speed: 1.14, swirl: -0.56, size: 0.94 },
  { angle: 1.04, radius: 0.28, y: 0.16, offset: 0.15, speed: 0.98, swirl: 0.64, size: 1.04 },
  { angle: 1.5, radius: 0.34, y: -0.14, offset: 0.23, speed: 1.18, swirl: -0.76, size: 0.88 },
  { angle: 2.0, radius: 0.3, y: 0.03, offset: 0.31, speed: 1.08, swirl: 0.58, size: 1.18 },
  { angle: 2.48, radius: 0.25, y: -0.02, offset: 0.39, speed: 1.2, swirl: -0.68, size: 0.96 },
  { angle: 2.96, radius: 0.36, y: 0.13, offset: 0.46, speed: 1.0, swirl: 0.78, size: 1.0 },
  { angle: 3.44, radius: 0.29, y: -0.12, offset: 0.54, speed: 1.16, swirl: -0.62, size: 1.12 },
  { angle: 3.92, radius: 0.33, y: 0.06, offset: 0.62, speed: 1.04, swirl: 0.7, size: 0.9 },
  { angle: 4.42, radius: 0.27, y: 0.18, offset: 0.69, speed: 1.22, swirl: -0.74, size: 1.08 },
  { angle: 4.88, radius: 0.35, y: -0.08, offset: 0.77, speed: 1.1, swirl: 0.6, size: 1.0 },
  { angle: 5.36, radius: 0.31, y: 0.01, offset: 0.85, speed: 0.96, swirl: -0.66, size: 0.92 },
  { angle: 5.82, radius: 0.24, y: -0.16, offset: 0.92, speed: 1.24, swirl: 0.8, size: 1.14 },
] as const;
const CHRONOS_WEAPON_RELOAD_AURA_MOTES = [
  { angle: 0.18, radius: 0.34, y: 0.14, offset: 0.02, speed: 1.08, drift: 0.8, size: 1.05 },
  { angle: 0.72, radius: 0.28, y: -0.1, offset: 0.13, speed: 1.18, drift: -0.9, size: 0.86 },
  { angle: 1.28, radius: 0.38, y: 0.02, offset: 0.24, speed: 0.98, drift: 1.05, size: 1.16 },
  { angle: 1.9, radius: 0.26, y: 0.17, offset: 0.36, speed: 1.3, drift: -0.7, size: 0.92 },
  { angle: 2.52, radius: 0.32, y: -0.15, offset: 0.47, speed: 1.04, drift: 0.92, size: 1 },
  { angle: 3.1, radius: 0.4, y: 0.08, offset: 0.58, speed: 1.22, drift: -1.02, size: 1.12 },
  { angle: 3.76, radius: 0.29, y: -0.03, offset: 0.68, speed: 1.12, drift: 0.75, size: 0.9 },
  { angle: 4.38, radius: 0.36, y: 0.2, offset: 0.78, speed: 0.94, drift: -0.84, size: 1.2 },
  { angle: 5.0, radius: 0.3, y: -0.12, offset: 0.88, speed: 1.28, drift: 0.95, size: 0.94 },
  { angle: 5.62, radius: 0.42, y: 0.01, offset: 0.96, speed: 1.0, drift: -0.72, size: 1.06 },
] as const;
const CHRONOS_AEGIS_VISUAL_STALE_MS = 220;
const CHRONOS_AEGIS_BLEND_IN_SPEED = 6.8;
const CHRONOS_AEGIS_BLEND_OUT_SPEED = 9;
const CHRONOS_AEGIS_SPREAD_START = 0.04;
const CHRONOS_AEGIS_SPREAD_END = 0.76;
const CHRONOS_AEGIS_SHIELD_START = 0.58;
const CHRONOS_AEGIS_PYRAMID_GROWTH = 0.82;
const CHRONOS_AEGIS_VIEWMODEL_SHIELD_Z = -2.15;
const CHRONOS_AEGIS_VIEWMODEL_EDGE_THICKNESS = 0.064;
const CHRONOS_AEGIS_VIEWMODEL_WIDTH = CHRONOS_AEGIS_PANEL_WIDTH * 0.9;
const CHRONOS_AEGIS_VIEWMODEL_HEIGHT = CHRONOS_AEGIS_PANEL_HEIGHT * 0.9;
const CHRONOS_AEGIS_DAMAGE_EDGE_COLOR = 0xfde68a;
const CHRONOS_AEGIS_DAMAGE_FILL_COLOR = 0xfacc15;
const CHRONOS_AEGIS_CRACK_COLOR = 0xfff7c2;
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
const CHRONOS_AEGIS_IDLE_POSE: ChronosAegisPose = {
  active: false,
  aegisBlend: 0,
  blend: 0,
  spread: 0,
  shield: 0,
  recoil: 0,
  spinBoost: 0,
  heartbeat: 0,
  durabilityRatio: 1,
};
const CHRONOS_STILL_MOVEMENT_BOB: ChronosMovementBobOffset = {
  horizontalX: 0,
  verticalY: 0,
  slideBlend: 0,
};

const matrixPosition = new THREE.Vector3();
const matrixQuaternion = new THREE.Quaternion();
const matrixUnitScale = new THREE.Vector3(1, 1, 1);
const viewmodelWorldScale = new THREE.Vector3(1, 1, 1);
const matrixEuler = new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER);
const viewmodelRootTransformScratch: MutableTransformTarget = {
  position: matrixPosition,
  rotation: matrixEuler,
};
const viewmodelRootMatrix = new THREE.Matrix4();
const viewmodelOffsetMatrix = new THREE.Matrix4();
const viewmodelArmMatrix = new THREE.Matrix4();
const viewmodelWristMatrix = new THREE.Matrix4();
const viewmodelPalmMatrix = new THREE.Matrix4();
const viewmodelSocketMatrix = new THREE.Matrix4();
const viewmodelWorldMatrix = new THREE.Matrix4();
const viewmodelWorldQuaternion = new THREE.Quaternion();
const blazeClosedHandInnerMatrix = new THREE.Matrix4();
const blazeStaffMatrix = new THREE.Matrix4();
const blazeStaffTipMatrix = new THREE.Matrix4();
const chronosRootMatrix = new THREE.Matrix4();
const chronosLeftSocketMatrix = new THREE.Matrix4();
const chronosRightSocketMatrix = new THREE.Matrix4();
const chronosWeaponMatrix = new THREE.Matrix4();
const chronosOrbMatrix = new THREE.Matrix4();
const chronosLeftSocketPosition = new THREE.Vector3();
const chronosRightSocketPosition = new THREE.Vector3();
const chronosWeaponPositionScratch = new THREE.Vector3();
const chronosWeaponRotationScratch = new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER);
const chronosOrbPositionScratch = new THREE.Vector3();
const blazeStaffPositionScratch = new THREE.Vector3();
const blazeStaffRotationScratch = new THREE.Euler(0, 0, 0, VIEWMODEL_ROOT_EULER_ORDER);
const viewmodelSocketPoseDraftScaleScratch = new THREE.Vector3(1, 1, 1);
const viewmodelSocketPoseDraftScratch: ViewmodelSocketPoseDraft = {
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
};
const phantomPrimaryPalmPoseTarget = createPhantomHandPoseTargets();
const blazeRocketHandPoseTarget = createPhantomHandPoseTargets(true);
const chronosHandPoseTarget = createPhantomHandPoseTargets();
const phantomClosedHandPivotOffset = new THREE.Vector3(0, 0, PHANTOM_CLOSED_HAND_WRIST_PIVOT_Z);
const phantomClosedHandPivotWorldOffset = new THREE.Vector3();
const VIEWMODEL_STILL_LOCOMOTION_POSE: ViewmodelLocomotionPose = {
  movementBlend: 0,
  runBlend: 0,
  slideBlend: 0,
  speedBlend: 0,
  cycleTime: 0,
};

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

function createAdditiveGlowMaterial(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function createChronosReloadAuraTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (!context) {
    return new THREE.CanvasTexture(canvas);
  }

  const gradient = context.createRadialGradient(32, 32, 2, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.28, 'rgba(210, 255, 226, 0.82)');
  gradient.addColorStop(0.62, 'rgba(64, 255, 150, 0.28)');
  gradient.addColorStop(1, 'rgba(64, 255, 150, 0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createChronosReloadAuraMaterial(
  texture: THREE.Texture,
  color: number
): THREE.SpriteMaterial {
  return new THREE.SpriteMaterial({
    map: texture,
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
}

function createPhantomReloadGlowMaterial(): THREE.MeshBasicMaterial {
  return createAdditiveGlowMaterial(PHANTOM_COLORS.lightPurple);
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

function getPhantomVeilArmGlowOpacity(nowMs: number, elapsedSeconds: number): number {
  const store = useGameStore.getState();
  const veilEffectActive = store.ultimateEffectActive && (
    store.ultimateEffectType === 'phantom_veil' ||
    store.ultimateEffectType === 'phantom_nightreign'
  );
  const castPose = getPhantomVeilCastPose(nowMs);
  if (!veilEffectActive && !castPose.active) return 0;

  const remainingMs = Math.max(0, store.ultimateEffectEndTime - nowMs);
  const effectGlow = veilEffectActive
    ? THREE.MathUtils.smoothstep(remainingMs, 0, PHANTOM_VEIL_ARM_GLOW_FADE_MS)
    : 0;
  const glowBase = Math.max(effectGlow, castPose.blend);
  const shimmer = 0.82 + Math.sin(elapsedSeconds * 7.4) * 0.12 + Math.sin(elapsedSeconds * 16.8) * 0.06;

  return THREE.MathUtils.clamp(glowBase * shimmer * 0.72, 0, 0.82);
}

// Per-frame shared pose memo. Both Phantom forearms, both hands and the charge orb
// request these poses every frame; each getter does a store read and (when active)
// allocates a fresh object. state.clock.elapsedTime is identical for every useFrame
// within a single frame, so it is a safe frame token to memo on. Consumers only read
// the returned pose, never mutate it, so sharing one instance per frame is safe.
let phantomChargePoseFrame = -1;
let phantomChargePoseCached: PhantomVoidRayChargePose = PHANTOM_VOID_RAY_IDLE_CHARGE_POSE;
function getPhantomVoidRayChargePoseFrame(nowMs: number, elapsedSeconds: number): PhantomVoidRayChargePose {
  if (elapsedSeconds !== phantomChargePoseFrame) {
    phantomChargePoseFrame = elapsedSeconds;
    phantomChargePoseCached = getPhantomVoidRayChargePose(nowMs, elapsedSeconds);
  }
  return phantomChargePoseCached;
}

let phantomVeilGlowFrame = -1;
let phantomVeilGlowCached = 0;
function getPhantomVeilArmGlowOpacityFrame(nowMs: number, elapsedSeconds: number): number {
  if (elapsedSeconds !== phantomVeilGlowFrame) {
    phantomVeilGlowFrame = elapsedSeconds;
    phantomVeilGlowCached = getPhantomVeilArmGlowOpacity(nowMs, elapsedSeconds);
  }
  return phantomVeilGlowCached;
}

let phantomReloadPoseFrameNeg = -1;
let phantomReloadPoseCachedNeg: PhantomReloadPose = PHANTOM_RELOAD_IDLE_POSE;
let phantomReloadPoseFramePos = -1;
let phantomReloadPoseCachedPos: PhantomReloadPose = PHANTOM_RELOAD_IDLE_POSE;
function getPhantomReloadPoseFrame(nowMs: number, elapsedSeconds: number, side: -1 | 1): PhantomReloadPose {
  if (side === 1) {
    if (elapsedSeconds !== phantomReloadPoseFramePos) {
      phantomReloadPoseFramePos = elapsedSeconds;
      phantomReloadPoseCachedPos = getPhantomReloadPose(nowMs, elapsedSeconds, 1);
    }
    return phantomReloadPoseCachedPos;
  }
  if (elapsedSeconds !== phantomReloadPoseFrameNeg) {
    phantomReloadPoseFrameNeg = elapsedSeconds;
    phantomReloadPoseCachedNeg = getPhantomReloadPose(nowMs, elapsedSeconds, -1);
  }
  return phantomReloadPoseCachedNeg;
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

function syncPhantomClosedHandToArm(targets: PhantomHandPoseTargets): void {
  if (!targets.closedHand) return;

  targets.closedHand.rotation.copy(targets.arm.rotation);
  phantomClosedHandPivotWorldOffset
    .copy(phantomClosedHandPivotOffset)
    .applyEuler(targets.closedHand.rotation);
  targets.closedHand.position.copy(targets.arm.position).add(phantomClosedHandPivotWorldOffset);
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

  syncPhantomClosedHandToArm(targets);
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

  syncPhantomClosedHandToArm(targets);
}

function applyPhantomShieldCastForearmPose(
  target: MutableTransformTarget,
  side: -1 | 1,
  shieldPose: PhantomShieldCastPose
): void {
  if (!shieldPose.active || shieldPose.blend <= 0) return;

  const blend = shieldPose.blend;
  const push = shieldPose.push;
  const pulse = shieldPose.pulse;

  target.position.x += side * (-0.048 * blend - 0.006 * push);
  target.position.y += 0.034 * blend + 0.004 * pulse;
  target.position.z += -0.082 * blend - 0.014 * push;
  target.rotation.x += -0.1 * blend - 0.014 * push;
  target.rotation.y += side * (-0.044 * blend - 0.01 * push);
  target.rotation.z += side * (0.14 * blend + 0.026 * pulse);
}

function applyPhantomShieldCastHandPose(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  shieldPose: PhantomShieldCastPose,
  elapsedSeconds: number
): void {
  if (!shieldPose.active || shieldPose.blend <= 0) return;

  const blend = shieldPose.blend;
  const push = shieldPose.push;
  const pulse = shieldPose.pulse;
  const sideSign = side;
  const thumbSide = -sideSign;
  const tremor = Math.sin(elapsedSeconds * 18.5 + sideSign * 0.45) * 0.0025 * pulse;

  targets.arm.position.x += sideSign * (-0.058 * blend - 0.009 * push);
  targets.arm.position.y += 0.044 * blend + 0.004 * pulse + tremor;
  targets.arm.position.z += -0.098 * blend - 0.018 * push;
  targets.arm.rotation.x += -0.088 * blend - 0.02 * push;
  targets.arm.rotation.y += sideSign * (-0.066 * blend - 0.012 * push);
  targets.arm.rotation.z += sideSign * (0.165 * blend + 0.028 * pulse);

  targets.wrist.position.y += 0.004 * blend;
  targets.wrist.position.z += -0.009 * blend;
  targets.wrist.rotation.x += -0.038 * blend - 0.007 * push;
  targets.wrist.rotation.y += sideSign * -0.026 * blend;
  targets.wrist.rotation.z += sideSign * (0.056 * blend + 0.012 * pulse);

  targets.palm.position.x += sideSign * -0.007 * blend;
  targets.palm.position.y += 0.01 * blend;
  targets.palm.position.z += -0.022 * blend - 0.006 * push;
  targets.palm.rotation.x += -0.028 * blend - 0.007 * push;
  targets.palm.rotation.y += sideSign * -0.058 * blend;
  targets.palm.rotation.z += sideSign * 0.038 * blend;

  targets.thumb.position.x += thumbSide * 0.018 * blend;
  targets.thumb.position.y += 0.012 * blend;
  targets.thumb.position.z += -0.018 * blend;
  targets.thumb.rotation.x += -0.03 * blend;
  targets.thumb.rotation.y += thumbSide * 0.065 * blend;
  targets.thumb.rotation.z += thumbSide * -0.08 * blend;

  for (let index = 0; index < targets.fingers.length; index++) {
    const finger = targets.fingers[index];
    const fingerIndexOffset = index - 1.5;
    const spread = Math.abs(fingerIndexOffset);
    finger.position.x += fingerIndexOffset * 0.012 * blend;
    finger.position.y += (0.012 - spread * 0.001) * blend;
    finger.position.z += -0.018 * blend - 0.004 * push;
    finger.rotation.x += -0.075 * blend - 0.016 * push;
    finger.rotation.y += -fingerIndexOffset * 0.018 * blend;
    finger.rotation.z += -fingerIndexOffset * (0.12 * blend + 0.025 * pulse);
  }

  syncPhantomClosedHandToArm(targets);
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
  locomotion: ViewmodelLocomotionPose = VIEWMODEL_STILL_LOCOMOTION_POSE,
  primaryReadyBlend = 0,
  primaryShotExtension = 0
): void {
  const sideSign = side;
  const thumbSide = -sideSign;
  const readyBlend = THREE.MathUtils.clamp(holdBlend, 0, 1);
  const primaryReadyTuck = THREE.MathUtils.clamp(primaryReadyBlend, 0, 1);
  const primaryShotReach = THREE.MathUtils.clamp(primaryShotExtension, 0, 1);
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
  const retractPulse = drop;
  const cadencePulse = 0.5 + 0.5 * Math.sin(phase * 2 + 0.25);
  const breath = Math.sin(elapsedSeconds * 1.55 + sideSign * 0.35) * 0.0025;
  const retractAmount = (0.04 + runBlend * 0.027) * locomotionBlend;
  const liftAmount = (0.017 + runBlend * 0.014) * locomotionBlend;
  const crossAmount = (0.011 + runBlend * 0.011) * locomotionBlend;
  const pumpPitch = (0.06 + runBlend * 0.055) * locomotionBlend;
  const pumpRoll = (0.032 + runBlend * 0.03) * locomotionBlend;
  const runTuck = runBlend * locomotionBlend;
  const inwardTuck = (0.018 + runBlend * 0.034) * locomotionBlend;
  const handUpBias = (0.18 + locomotionBlend * 0.028) * (1 - readyBlend * 0.45 - shotPulse * 0.4);
  const slidePullback = PHANTOM_SLIDE_HAND_PULLBACK_Z * slideBlend * (1 - readyBlend * 0.25 - shotPulse * 0.2);
  const readyHandExtensionZ = 0.032 - PHANTOM_PRIMARY_READY_HAND_TUCK_Z * primaryReadyTuck;

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
      readyBlend * readyHandExtensionZ -
      shotPulse * 0.014 -
      primaryShotReach * PHANTOM_PRIMARY_SHOT_HAND_EXTENSION_Z -
      runTuck * 0.003 +
      retractPulse * retractAmount +
      slidePullback
  );
  targets.arm.rotation.set(
    PHANTOM_IDLE_HAND_ROTATION.x -
      readyBlend * (0.37 - primaryReadyTuck * 0.045) -
      shotPulse * 0.055 -
      primaryShotReach * 0.07 -
      runTuck * 0.045 +
      retractPulse * pumpPitch +
      handUpBias,
    sideSign * (
      PHANTOM_IDLE_HAND_ROTATION.y -
      readyBlend * 0.2 -
      shotPulse * 0.02 -
      primaryShotReach * 0.018 +
      counterSwing * (0.026 + runBlend * 0.028) * locomotionBlend
    ),
    sideSign * (
      PHANTOM_IDLE_HAND_ROTATION.z +
      readyBlend * (0.42 - primaryReadyTuck * 0.035) +
      shotPulse * 0.055 +
      primaryShotReach * 0.035 +
      retractPulse * pumpRoll +
      counterSwing * 0.022 * locomotionBlend
    )
  );

  syncPhantomClosedHandToArm(targets);

  targets.wrist.position.set(0, 0, 0);
  targets.wrist.rotation.set(
    -readyBlend * 0.045 -
      shotPulse * 0.018 +
      retractPulse * (0.008 + runBlend * 0.006) * locomotionBlend,
    sideSign * (
      -readyBlend * 0.036 -
      shotPulse * 0.012 +
      counterSwing * 0.005 * locomotionBlend
    ),
    sideSign * (
      readyBlend * 0.14 +
      shotPulse * 0.024 +
      retractPulse * 0.007 * locomotionBlend
    )
  );

  targets.palm.position.set(
    sideSign * readyBlend * 0.006,
    readyBlend * 0.004,
    -readyBlend * (0.01 - primaryReadyTuck * 0.003) -
      shotPulse * 0.006 -
      primaryShotReach * 0.018
  );
  targets.palm.rotation.set(
    -readyBlend * (0.045 - primaryReadyTuck * 0.008) -
      shotPulse * 0.022 -
      primaryShotReach * 0.024,
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
      -0.038 + Math.abs(fingerIndexOffset) * 0.001 -
        shotPulse * 0.002 -
        primaryShotReach * 0.005
    );
    finger.rotation.set(
      -0.04 - shotPulse * 0.028 - primaryShotReach * 0.026,
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
  locomotion: ViewmodelLocomotionPose = VIEWMODEL_STILL_LOCOMOTION_POSE,
  primaryReadyBlend = 0,
  primaryShotExtension = 0
): void {
  const primaryReadyTuck = THREE.MathUtils.clamp(primaryReadyBlend, 0, 1);
  const primaryShotReach = THREE.MathUtils.clamp(primaryShotExtension, 0, 1);
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
  const retractPulse = drop;
  const breath = Math.sin(elapsedSeconds * 1.35 + side * 0.45) * 0.002;
  const retractAmount = (0.038 + runBlend * 0.029) * locomotionBlend;
  const liftAmount = (0.013 + runBlend * 0.017) * locomotionBlend;
  const crossAmount = (0.01 + runBlend * 0.012) * locomotionBlend;
  const pumpPitch = (0.16 + runBlend * 0.2) * locomotionBlend;
  const runTuck = runBlend * locomotionBlend;
  const inwardTuck = (0.016 + runBlend * 0.035) * locomotionBlend;
  const slidePullback = PHANTOM_SLIDE_FOREARM_PULLBACK_Z * slideBlend * (1 - holdBlend * 0.18 - shotPulse * 0.16);
  const readyForearmExtensionZ = 0.096 - PHANTOM_PRIMARY_READY_FOREARM_TUCK_Z * primaryReadyTuck;

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
      holdBlend * readyForearmExtensionZ -
      shotPulse * 0.01 -
      primaryShotReach * PHANTOM_PRIMARY_SHOT_FOREARM_EXTENSION_Z -
      runTuck * 0.003 +
      retractPulse * retractAmount +
      slidePullback
  );
  target.rotation.set(
    0.22 -
      holdBlend * (0.34 - primaryReadyTuck * 0.035) -
      shotPulse * 0.055 -
      primaryShotReach * 0.075 -
      runTuck * 0.035 -
      retractPulse * pumpPitch * 0.72,
    side * (
      -0.1 +
      holdBlend * 0.08 +
      shotPulse * 0.014 +
      primaryShotReach * 0.018 +
      counterSwing * (0.026 + runBlend * 0.03) * locomotionBlend
    ),
    side * (
      -0.09 +
      holdBlend * (0.235 - primaryReadyTuck * 0.025) +
      shotPulse * 0.055 +
      primaryShotReach * 0.04 +
      retractPulse * (0.055 + runBlend * 0.074) * locomotionBlend +
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
  poseAmount: number
): void {
  if (poseAmount <= 0) return;

  if (side === -1) {
    target.position.x -= 0.045 * poseAmount;
    target.position.y -= 0.01 * poseAmount;
    target.position.z += 0.18 * poseAmount;
    target.rotation.x += 0.11 * poseAmount;
    target.rotation.y -= 0.18 * poseAmount;
    target.rotation.z -= 0.08 * poseAmount;
    return;
  }

  target.position.x -= 0.04 * poseAmount;
  target.position.y += 0.006 * poseAmount;
  target.position.z -= 0.075 * poseAmount;
  target.rotation.x -= 0.055 * poseAmount;
  target.rotation.y += 0.12 * poseAmount;
  target.rotation.z -= 0.045 * poseAmount;
}

function applyHookshotSecondaryPoseToHand(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  poseAmount: number
): void {
  if (poseAmount <= 0) return;

  if (side === -1) {
    targets.arm.position.x -= 0.045 * poseAmount;
    targets.arm.position.y -= 0.01 * poseAmount;
    targets.arm.position.z += 0.18 * poseAmount;
    targets.arm.rotation.x += 0.11 * poseAmount;
    targets.arm.rotation.y -= 0.18 * poseAmount;
    targets.arm.rotation.z -= 0.08 * poseAmount;

    targets.wrist.position.z += 0.018 * poseAmount;
    targets.wrist.rotation.x += 0.045 * poseAmount;
    targets.wrist.rotation.y -= 0.028 * poseAmount;
    targets.wrist.rotation.z -= 0.026 * poseAmount;

    targets.palm.position.z += 0.01 * poseAmount;
    targets.palm.rotation.x += 0.032 * poseAmount;
    targets.palm.rotation.y -= 0.026 * poseAmount;
    targets.palm.rotation.z -= 0.02 * poseAmount;
    return;
  }

  targets.arm.position.x -= 0.04 * poseAmount;
  targets.arm.position.y += 0.006 * poseAmount;
  targets.arm.position.z -= 0.075 * poseAmount;
  targets.arm.rotation.x -= 0.055 * poseAmount;
  targets.arm.rotation.y += 0.12 * poseAmount;
  targets.arm.rotation.z -= 0.045 * poseAmount;

  targets.wrist.position.z -= 0.012 * poseAmount;
  targets.wrist.rotation.x -= 0.024 * poseAmount;
  targets.wrist.rotation.y += 0.032 * poseAmount;
  targets.wrist.rotation.z -= 0.014 * poseAmount;

  targets.palm.position.z -= 0.014 * poseAmount;
  targets.palm.rotation.x -= 0.02 * poseAmount;
  targets.palm.rotation.y += 0.026 * poseAmount;
  targets.palm.rotation.z -= 0.01 * poseAmount;
}

function isLocalHookshotHookDetached(side: -1 | 1): boolean {
  const state = useGameStore.getState();
  const localPlayerId = state.localPlayer?.id;
  if (!localPlayerId) return false;

  return (
    hasOwnedProjectileOnSide(state.hookProjectiles, localPlayerId, side) ||
    hasOwnedProjectileOnSide(state.dragHooks, localPlayerId, side) ||
    hasOwnedActiveGrappleLineOnSide(state, localPlayerId, side)
  );
}

function createViewmodelLocomotionRuntime(): ViewmodelLocomotionRuntime {
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

function updateViewmodelLocomotionRuntime(
  locomotion: ViewmodelLocomotionRuntime,
  camera: THREE.Camera,
  delta: number,
  heroId: ViewmodelHeroId = 'phantom'
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
  const cameraHorizontalSpeed = horizontalDistance > PHANTOM_LOCOMOTION_TELEPORT_DISTANCE
    ? 0
    : horizontalDistance / frameSeconds;
  const visualState = visualStore.getState();
  const localMovement = visualState.localViewmodelMovement;
  const isLocalMovementFresh = Date.now() - localMovement.updatedAtMs <= CHRONOS_MOVEMENT_INPUT_FRESH_MS;
  const horizontalSpeed = isLocalMovementFresh
    ? localMovement.horizontalSpeed
    : cameraHorizontalSpeed;
  const walkSpeed = HERO_DEFINITIONS[heroId].stats.moveSpeed;
  const runSpeed = walkSpeed * SPRINT_MULTIPLIER;
  const movementState = visualState.localMovement;
  const isGrounded = movementState.isGrounded;
  const isSliding = movementState.isSliding;
  const targetSlideBlend = THREE.MathUtils.clamp(
    Math.max(isSliding ? 1 : 0, visualState.slideIntensity),
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
    walkSpeed * 0.92,
    runSpeed * 0.98
  );
  const targetRunBlend = targetMovementBlend * Math.max(
    speedRunBlend,
    movementState.isSprinting ? 1 : 0
  );
  const targetSpeedBlend = THREE.MathUtils.clamp(horizontalSpeed / runSpeed, 0, 1.35);

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
  const slideFrameDelta = THREE.MathUtils.clamp(delta, 0, PHANTOM_SLIDE_BLEND_MAX_DELTA_SECONDS);
  locomotion.slideBlend = THREE.MathUtils.damp(
    locomotion.slideBlend,
    targetSlideBlend,
    targetSlideBlend > locomotion.slideBlend
      ? PHANTOM_SLIDE_BLEND_IN_SPEED
      : PHANTOM_SLIDE_BLEND_OUT_SPEED,
    slideFrameDelta
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
  primaryReadyBlend = holdBlend,
  primaryShotExtension = shotPulse,
  shieldCastPose,
  locomotion,
}: {
  camera: THREE.Camera;
  elapsedSeconds: number;
  actionBlend: number;
  targetingBlend: number;
  side: -1 | 1;
  holdBlend: number;
  shotPulse: number;
  primaryReadyBlend?: number;
  primaryShotExtension?: number;
  shieldCastPose?: PhantomShieldCastPose;
  locomotion?: ViewmodelLocomotionPose;
}): THREE.Matrix4 {
  const rootTransform = viewmodelRootTransformScratch;
  writeViewmodelRootTransform(rootTransform, elapsedSeconds, actionBlend, targetingBlend);
  composeTransformMatrix(viewmodelRootMatrix, rootTransform.position, rootTransform.rotation);

  matrixPosition.copy(DEFAULT_VIEWMODEL_ROOT_OFFSET);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(viewmodelOffsetMatrix, matrixPosition, matrixEuler);

  const poseTarget = phantomPrimaryPalmPoseTarget;
  writePhantomHandPose(
    poseTarget,
    side,
    holdBlend,
    shotPulse,
    elapsedSeconds,
    locomotion,
    primaryReadyBlend,
    primaryShotExtension
  );
  if (shieldCastPose) {
    applyPhantomShieldCastHandPose(poseTarget, side, shieldCastPose, elapsedSeconds);
  }

  composeTransformMatrix(viewmodelArmMatrix, poseTarget.arm.position, poseTarget.arm.rotation);
  composeTransformMatrix(viewmodelWristMatrix, poseTarget.wrist.position, poseTarget.wrist.rotation);
  composeTransformMatrix(viewmodelPalmMatrix, poseTarget.palm.position, poseTarget.palm.rotation);

  matrixPosition.copy(PHANTOM_PALM_SOCKET_OFFSET);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(viewmodelSocketMatrix, matrixPosition, matrixEuler);

  camera.updateMatrixWorld();
  viewmodelWorldMatrix
    .copy(camera.matrixWorld)
    .multiply(viewmodelRootMatrix)
    .multiply(viewmodelOffsetMatrix)
    .multiply(viewmodelArmMatrix)
    .multiply(viewmodelWristMatrix)
    .multiply(viewmodelPalmMatrix)
    .multiply(viewmodelSocketMatrix);

  return viewmodelWorldMatrix;
}

function samplePhantomPrimaryPalmSocket(
  context: PhantomPrimaryPoseSampleContext,
  side: -1 | 1,
  actionBlend: number,
  targetingBlend: number,
  locomotion?: ViewmodelLocomotionPose
): ViewmodelSocketPoseDraft {
  const attackTimeSeconds = context.actionTimeSeconds ?? PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS;
  const timestampMs = context.timestampMs ?? Date.now();
  const shieldCastPose = getPhantomShieldCastPose(timestampMs);
  const primaryHoldBlend = context.holdBlend ?? getPhantomPrimaryHeldBlend(timestampMs);
  const holdBlend = Math.max(primaryHoldBlend, shieldCastPose.blend);
  const shotPulse = context.shotPulse ?? getPhantomPrimaryShotPulse(attackTimeSeconds);
  const worldMatrix = composePhantomPrimaryPalmMatrix({
    camera: context.camera,
    elapsedSeconds: context.elapsedSeconds,
    actionBlend,
    targetingBlend,
    side,
    holdBlend,
    shotPulse,
    primaryReadyBlend: primaryHoldBlend,
    primaryShotExtension: shotPulse,
    shieldCastPose,
    locomotion,
  });

  return writeViewmodelPoseDraftFromMatrix(
    viewmodelSocketPoseDraftScratch,
    viewmodelSocketPoseDraftScaleScratch,
    worldMatrix,
    timestampMs
  );
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
  const rootTransform = viewmodelRootTransformScratch;
  writeViewmodelRootTransform(rootTransform, elapsedSeconds, actionBlend, targetingBlend);
  composeTransformMatrix(viewmodelRootMatrix, rootTransform.position, rootTransform.rotation);

  matrixPosition.copy(DEFAULT_VIEWMODEL_ROOT_OFFSET);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(viewmodelOffsetMatrix, matrixPosition, matrixEuler);

  matrixPosition.copy(PHANTOM_VOID_RAY_RELEASE_ORIGIN_POSITION);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(viewmodelSocketMatrix, matrixPosition, matrixEuler);

  camera.updateMatrixWorld();
  viewmodelWorldMatrix
    .copy(camera.matrixWorld)
    .multiply(viewmodelRootMatrix)
    .multiply(viewmodelOffsetMatrix)
    .multiply(viewmodelSocketMatrix);

  return viewmodelWorldMatrix;
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

  return writeViewmodelPoseDraftFromMatrix(
    viewmodelSocketPoseDraftScratch,
    viewmodelSocketPoseDraftScaleScratch,
    worldMatrix,
    timestampMs
  );
}

function PhantomAnimatedForearm({
  side,
  materials,
  skinId,
  primaryAttackRef,
  voidRayReleaseRef,
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  skinId?: HeroSkinId | string | null;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
  voidRayReleaseRef: MutableRefObject<PhantomVoidRayReleaseState | null>;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
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
    const reloadPose = getPhantomReloadPoseFrame(nowMs, state.clock.elapsedTime, side);
    const chargePose = getPhantomVoidRayChargePoseFrame(nowMs, state.clock.elapsedTime);
    const veilGlowOpacity = getPhantomVeilArmGlowOpacityFrame(nowMs, state.clock.elapsedTime);
    const veilCastPose = reloadPose.active || chargePose.active
      ? null
      : getPhantomVeilCastPose(nowMs);

    if (veilCastPose?.active) {
      forearm.visible = true;
      writePhantomForearmPose(
        forearm,
        side,
        0,
        0,
        state.clock.elapsedTime,
        VIEWMODEL_STILL_LOCOMOTION_POSE,
        0,
        0
      );
      reloadGlowMaterial.opacity = Math.max(veilGlowOpacity, veilCastPose.blend * 0.46);
      return;
    }

    forearm.visible = true;

    const shieldCastPose = reloadPose.active || chargePose.active
      ? null
      : getPhantomShieldCastPose(nowMs);
    const voidRayReleasePulse = reloadPose.active
      ? 0
      : getPhantomVoidRayReleasePulse(voidRayReleaseRef.current, nowMs);
    const voidRayReleaseExtensionBlend = reloadPose.active
      ? 0
      : getPhantomVoidRayReleaseExtensionBlend(voidRayReleaseRef.current, nowMs);
    const baseHoldBlend = reloadPose.active || chargePose.active ? 0 : getPhantomPrimaryHeldBlend(nowMs);
    const holdBlend = Math.max(
      baseHoldBlend,
      shieldCastPose?.blend ?? 0,
      voidRayReleasePulse,
      voidRayReleaseExtensionBlend * 0.78
    );
    const primaryShotPulse = getPhantomPrimaryShotPulse(attackTimeSeconds);
    const shotPulse = reloadPose.active ? 0 : Math.max(primaryShotPulse, voidRayReleasePulse);
    writePhantomForearmPose(
      forearm,
      side,
      holdBlend,
      shotPulse,
      state.clock.elapsedTime,
      locomotionRef.current,
      baseHoldBlend,
      primaryShotPulse
    );
    if (shieldCastPose) {
      applyPhantomShieldCastForearmPose(forearm, side, shieldCastPose);
    }
    applyPhantomVoidRayChargeForearmPose(forearm, side, chargePose, 0.92);
    applyPhantomVoidRayReleaseForearmPose(forearm, side, voidRayReleaseExtensionBlend);
    applyPhantomReloadMotion(forearm, side, reloadPose, 0.82);
    reloadGlowMaterial.opacity = Math.max(
      reloadPose.glowOpacity * 0.42,
      (shieldCastPose?.blend ?? 0) * 0.38,
      chargePose.glowOpacity * 0.58,
      voidRayReleasePulse * 0.36,
      voidRayReleaseExtensionBlend * 0.24,
      veilGlowOpacity * 0.72
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
      <ViewmodelSkinOverlay skinId={skinId} side={side} materials={materials} attach="forearm" />
    </group>
  );
}

function PhantomPoseableHand({
  side,
  materials,
  skinId,
  primaryAttackRef,
  voidRayReleaseRef,
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  skinId?: HeroSkinId | string | null;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
  voidRayReleaseRef: MutableRefObject<PhantomVoidRayReleaseState | null>;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
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
  // Reused pose-targets object so the per-frame applyPhantom* calls don't each
  // allocate a fresh literal (with conditional closedHand spread). The joint refs
  // are stable groups; only the closedHand field is set/cleared per frame.
  const poseTargetsRef = useRef<PhantomHandPoseTargets | null>(null);

  useRegisteredViewmodelSocket(PHANTOM_PRIMARY_PALM_SOCKET_NAMES[side], socketRef);

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
    const fingers = resolveFingerTargets(fingerRefs.current);
    if (!arm || !wrist || !palm || !thumb || !fingers) return;

    let poseTargets = poseTargetsRef.current;
    if (!poseTargets) {
      poseTargets = { arm, wrist, palm, thumb, fingers };
      poseTargetsRef.current = poseTargets;
    }
    poseTargets.arm = arm;
    poseTargets.wrist = wrist;
    poseTargets.palm = palm;
    poseTargets.thumb = thumb;
    poseTargets.fingers = fingers;
    poseTargets.closedHand = closedVisual ?? undefined;

    const nowMs = Date.now();
    const attack = primaryAttackRef.current;
    const attackTimeSeconds = attack?.side === side
      ? (nowMs - attack.startTimeMs) / 1000
      : Number.POSITIVE_INFINITY;
    const reloadPose = getPhantomReloadPoseFrame(nowMs, state.clock.elapsedTime, side);
    const chargePose = getPhantomVoidRayChargePoseFrame(nowMs, state.clock.elapsedTime);
    const veilGlowOpacity = getPhantomVeilArmGlowOpacityFrame(nowMs, state.clock.elapsedTime);
    const veilCastPose = reloadPose.active || chargePose.active
      ? null
      : getPhantomVeilCastPose(nowMs);

    if (veilCastPose?.active) {
      if (closedVisual) {
        closedVisual.visible = true;
        closedVisual.scale.setScalar(1);
      }
      if (openVisual) {
        openVisual.visible = false;
        openVisual.scale.setScalar(0.001);
      }
      writePhantomHandPose(
        poseTargets,
        side,
        0,
        0,
        state.clock.elapsedTime,
        VIEWMODEL_STILL_LOCOMOTION_POSE,
        0,
        0
      );
      reloadGlowMaterial.opacity = Math.max(veilGlowOpacity, veilCastPose.blend * 0.62);
      return;
    }

    const shieldCastPose = reloadPose.active || chargePose.active
      ? null
      : getPhantomShieldCastPose(nowMs);
    const voidRayReleasePulse = reloadPose.active
      ? 0
      : getPhantomVoidRayReleasePulse(voidRayReleaseRef.current, nowMs);
    const voidRayReleaseExtensionBlend = reloadPose.active
      ? 0
      : getPhantomVoidRayReleaseExtensionBlend(voidRayReleaseRef.current, nowMs);
    const baseHoldBlend = reloadPose.active || chargePose.active ? 0 : getPhantomPrimaryHeldBlend(nowMs);
    const holdBlend = Math.max(
      baseHoldBlend,
      shieldCastPose?.blend ?? 0,
      voidRayReleasePulse,
      voidRayReleaseExtensionBlend * 0.82
    );
    const primaryShotPulse = getPhantomPrimaryShotPulse(attackTimeSeconds);
    const shotPulse = reloadPose.active ? 0 : Math.max(primaryShotPulse, voidRayReleasePulse);
    const chargeOpenBlend = reloadPose.active ? 0 : chargePose.blend;
    const shieldOpenBlend = shieldCastPose?.blend ?? 0;
    const openVisualBlend = THREE.MathUtils.smoothstep(
      Math.max(holdBlend, chargeOpenBlend, shieldOpenBlend),
      0.02,
      0.72
    );
    const closedVisualBlend = 1 - THREE.MathUtils.smoothstep(
      Math.max(holdBlend, chargeOpenBlend, shieldOpenBlend),
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
      poseTargets,
      side,
      holdBlend,
      shotPulse,
      state.clock.elapsedTime,
      locomotionRef.current,
      baseHoldBlend,
      primaryShotPulse
    );
    if (shieldCastPose) {
      applyPhantomShieldCastHandPose(
        poseTargets,
        side,
        shieldCastPose,
        state.clock.elapsedTime
      );
    }
    applyPhantomVoidRayChargeHandPose(
      poseTargets,
      side,
      chargePose,
      state.clock.elapsedTime
    );
    applyPhantomVoidRayReleaseHandPose(
      poseTargets,
      side,
      voidRayReleaseExtensionBlend
    );
    applyPhantomReloadMotion(arm, side, reloadPose);
    if (closedVisual) {
      applyPhantomReloadMotion(closedVisual, side, reloadPose);
    }
    reloadGlowMaterial.opacity = Math.max(
      reloadPose.glowOpacity * 0.62,
      (shieldCastPose?.blend ?? 0) * 0.54,
      chargePose.glowOpacity * 0.86,
      voidRayReleasePulse * 0.5,
      voidRayReleaseExtensionBlend * 0.34,
      veilGlowOpacity
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
          <ViewmodelSkinOverlay skinId={skinId} side={side} materials={materials} attach="hand" />
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
  return createAdditiveGlowMaterial(color);
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

    const chargePose = getPhantomVoidRayChargePoseFrame(Date.now(), state.clock.elapsedTime);
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

function PhantomVeilViewmodelSplit() {
  const groupRef = useRef<THREE.Group>(null);
  const material = useMemo(createPhantomVeilSplitMaterial, []);

  useEffect(() => () => {
    material.dispose();
  }, [material]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) return;

    const veilPose = getPhantomVeilCastPose(Date.now());
    const intensity = veilPose.contact * veilPose.blend;
    group.visible = intensity > 0.01;

    if (!group.visible) {
      updatePhantomVeilSplitMaterial(material, 0, 0, 0, delta);
      return;
    }

    const progress = THREE.MathUtils.clamp(veilPose.contact + veilPose.pulse * 0.28, 0, 1);
    group.position.copy(PHANTOM_VEIL_SPLIT_POSITION);
    group.scale.set(
      PHANTOM_VEIL_SPLIT_BASE_SCALE.x * (0.7 + progress * 0.3),
      PHANTOM_VEIL_SPLIT_BASE_SCALE.y * (0.82 + progress * 0.18),
      PHANTOM_VEIL_SPLIT_BASE_SCALE.z
    );
    updatePhantomVeilSplitMaterial(material, progress, intensity, veilPose.contact, delta);
  });

  return (
    <group ref={groupRef} visible={false} renderOrder={26}>
      <mesh geometry={SHARED_GEOMETRIES.plane} material={material} frustumCulled={false} />
    </group>
  );
}

function PhantomViewmodel({
  materials,
  skinId,
  primaryAttackRef,
  voidRayReleaseRef,
  locomotionRef,
}: {
  materials: ViewmodelMaterialSet;
  skinId?: HeroSkinId | string | null;
  primaryAttackRef: MutableRefObject<PhantomPrimaryAttackState | null>;
  voidRayReleaseRef: MutableRefObject<PhantomVoidRayReleaseState | null>;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
}) {
  return (
    <group position={[
      DEFAULT_VIEWMODEL_ROOT_OFFSET.x,
      DEFAULT_VIEWMODEL_ROOT_OFFSET.y,
      DEFAULT_VIEWMODEL_ROOT_OFFSET.z,
    ]}>
      <PhantomAnimatedForearm side={-1} materials={materials} skinId={skinId} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomAnimatedForearm side={1} materials={materials} skinId={skinId} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomPoseableHand side={-1} materials={materials} skinId={skinId} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomPoseableHand side={1} materials={materials} skinId={skinId} primaryAttackRef={primaryAttackRef} voidRayReleaseRef={voidRayReleaseRef} locomotionRef={locomotionRef} />
      <PhantomVoidRayChargeOrb />
      <PhantomVeilViewmodelSplit />
    </group>
  );
}

function HookshotPhantomForearm({
  side,
  materials,
  primaryFireRef,
  secondaryFireRef,
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryFireRef: MutableRefObject<HookshotPrimaryFireState | null>;
  secondaryFireRef: MutableRefObject<HookshotSecondaryFireState | null>;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
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
    writePhantomForearmPose(
      forearm,
      side,
      0,
      0,
      state.clock.elapsedTime,
      locomotionRef.current
    );
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
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  primaryFireRef: MutableRefObject<HookshotPrimaryFireState | null>;
  secondaryFireRef: MutableRefObject<HookshotSecondaryFireState | null>;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
}) {
  const armRef = useRef<THREE.Group>(null);
  const wristRef = useRef<THREE.Group>(null);
  const palmRef = useRef<THREE.Group>(null);
  const thumbRef = useRef<THREE.Group>(null);
  const hookSocketRef = useRef<THREE.Group>(null);
  const hookVisualRef = useRef<THREE.Group>(null);
  const fingerRefs = useRef<(THREE.Group | null)[]>([]);
  const hookMaterials = getHookshotMaterials();

  useRegisteredViewmodelSocket(HOOKSHOT_HOOK_SOCKET_NAMES[side], hookSocketRef);

  const isHookProjectileDetached = useGameStore(
    useShallow(state => {
      const localPlayerId = state.localPlayer?.id;
      return Boolean(localPlayerId && (
        hasOwnedProjectileOnSide(state.hookProjectiles, localPlayerId, side) ||
        hasOwnedProjectileOnSide(state.dragHooks, localPlayerId, side) ||
        hasOwnedActiveGrappleLineOnSide(state, localPlayerId, side)
      ));
    })
  );

  useFrame((state) => {
    const arm = armRef.current;
    const wrist = wristRef.current;
    const palm = palmRef.current;
    const thumb = thumbRef.current;
    const fingers = resolveFingerTargets(fingerRefs.current);
    if (!arm || !wrist || !palm || !thumb || !fingers) return;

    const secondaryPulse = getHookshotSecondaryPosePulse(secondaryFireRef.current, Date.now());
    if (hookVisualRef.current) {
      const isSecondaryShotHookHidden = side === 1 && secondaryPulse > 0.01;
      hookVisualRef.current.visible = !isLocalHookshotHookDetached(side) && !isSecondaryShotHookHidden;
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
      state.clock.elapsedTime,
      locomotionRef.current
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
  locomotionRef,
}: {
  materials: ViewmodelMaterialSet;
  primaryFireRef: MutableRefObject<HookshotPrimaryFireState | null>;
  secondaryFireRef: MutableRefObject<HookshotSecondaryFireState | null>;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
}) {
  return (
    <group position={[
      DEFAULT_VIEWMODEL_ROOT_OFFSET.x,
      DEFAULT_VIEWMODEL_ROOT_OFFSET.y,
      DEFAULT_VIEWMODEL_ROOT_OFFSET.z,
    ]}>
      <HookshotPhantomForearm
        side={-1}
        materials={materials}
        primaryFireRef={primaryFireRef}
        secondaryFireRef={secondaryFireRef}
        locomotionRef={locomotionRef}
      />
      <HookshotPhantomForearm
        side={1}
        materials={materials}
        primaryFireRef={primaryFireRef}
        secondaryFireRef={secondaryFireRef}
        locomotionRef={locomotionRef}
      />
      <HookshotSimpleHookHand
        side={-1}
        materials={materials}
        primaryFireRef={primaryFireRef}
        secondaryFireRef={secondaryFireRef}
        locomotionRef={locomotionRef}
      />
      <HookshotSimpleHookHand
        side={1}
        materials={materials}
        primaryFireRef={primaryFireRef}
        secondaryFireRef={secondaryFireRef}
        locomotionRef={locomotionRef}
      />
    </group>
  );
}

function applyBlazeRocketPoseToForearm(
  target: MutableTransformTarget,
  side: -1 | 1,
  holdBlend: number
): void {
  if (side !== 1 || holdBlend <= 0) return;

  target.position.x += side * -0.014 * holdBlend;
  target.position.y += 0.018 * holdBlend;
  target.position.z -= 0.096 * holdBlend;
  target.rotation.x -= 0.116 * holdBlend;
  target.rotation.y += side * -0.024 * holdBlend;
  target.rotation.z += side * 0.046 * holdBlend;
}

function applyBlazeRocketPoseToHand(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  holdBlend: number
): void {
  if (side !== 1 || holdBlend <= 0) return;

  targets.arm.position.x += side * -0.018 * holdBlend;
  targets.arm.position.y += 0.022 * holdBlend;
  targets.arm.position.z -= 0.112 * holdBlend;
  targets.arm.rotation.x -= 0.122 * holdBlend;
  targets.arm.rotation.y += side * -0.028 * holdBlend;
  targets.arm.rotation.z += side * 0.062 * holdBlend;

  targets.wrist.position.z -= 0.022 * holdBlend;
  targets.wrist.rotation.x -= 0.156 * holdBlend;
  targets.wrist.rotation.y += side * -0.03 * holdBlend;
  targets.wrist.rotation.z += side * 0.034 * holdBlend;

  targets.palm.position.y += 0.004 * holdBlend;
  targets.palm.position.z -= 0.026 * holdBlend;
  targets.palm.rotation.x -= 0.112 * holdBlend;
  targets.palm.rotation.y += side * -0.018 * holdBlend;
  targets.palm.rotation.z += side * 0.02 * holdBlend;

  if (targets.closedHand) {
    targets.closedHand.position.x += side * -0.018 * holdBlend;
    targets.closedHand.position.y += 0.022 * holdBlend;
    targets.closedHand.position.z -= 0.124 * holdBlend;
    targets.closedHand.rotation.x -= 0.178 * holdBlend;
    targets.closedHand.rotation.y += side * -0.038 * holdBlend;
    targets.closedHand.rotation.z += side * 0.052 * holdBlend;
  }
}

function getBlazeRocketJumpPoseAmount(pose: BlazeRocketJumpStaffSlamPose): number {
  if (!pose.active) return 0;
  return THREE.MathUtils.clamp(
    Math.max(pose.readyBlend, pose.strikeBlend) + pose.impactPulse * 0.18,
    0,
    1
  );
}

function applyBlazeRocketJumpPoseToForearm(
  target: MutableTransformTarget,
  side: -1 | 1,
  pose: BlazeRocketJumpStaffSlamPose
): void {
  if (!pose.active) return;

  const ready = pose.readyBlend;
  const strike = pose.strikeBlend;
  const impact = pose.impactPulse;
  const poseAmount = THREE.MathUtils.clamp(ready + strike * 0.85 + impact * 0.18, 0, 1);
  const depthCorrection = side === -1 ? -0.12 * poseAmount : 0.018 * poseAmount;

  target.position.x += side * -0.158 * ready;
  target.position.y += 0.07 * ready - 0.16 * strike - 0.012 * impact;
  target.position.z += depthCorrection - 0.028 * ready - 0.004 * strike;
  target.rotation.x += -0.045 * ready + 0.07 * strike + 0.012 * impact;
  target.rotation.y += side * -0.052 * ready + side * 0.01 * strike;
  target.rotation.z += side * 0.08 * ready + side * 0.014 * strike;
}

function applyBlazeRocketJumpPoseToHand(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  pose: BlazeRocketJumpStaffSlamPose
): void {
  if (!pose.active) return;

  const ready = pose.readyBlend;
  const strike = pose.strikeBlend;
  const impact = pose.impactPulse;
  const poseAmount = THREE.MathUtils.clamp(ready + strike * 0.85 + impact * 0.18, 0, 1);
  const gripSeparationY = (side === -1 ? 0.032 : -0.032) * (ready + strike * 0.65);
  const depthCorrection = side === -1 ? -0.138 * poseAmount : 0.018 * poseAmount;
  const gripSeparationZ = (side === -1 ? -0.012 : 0.012) * ready;
  const centerX = side * -0.178 * ready;
  const liftY = 0.086 * ready - 0.182 * strike - 0.014 * impact + gripSeparationY;
  const reachZ = depthCorrection - 0.024 * ready - 0.004 * strike + gripSeparationZ;
  const pitch = -0.055 * ready + 0.085 * strike + 0.012 * impact;
  const yaw = side * -0.06 * ready + side * 0.012 * strike;
  const roll = side * 0.095 * ready + side * 0.014 * strike;

  targets.arm.position.x += centerX;
  targets.arm.position.y += liftY;
  targets.arm.position.z += reachZ;
  targets.arm.rotation.x += pitch;
  targets.arm.rotation.y += yaw;
  targets.arm.rotation.z += roll;

  targets.wrist.position.y += 0.012 * ready - 0.02 * strike;
  targets.wrist.position.z -= 0.008 * ready;
  targets.wrist.rotation.x += -0.018 * ready + 0.036 * strike;
  targets.wrist.rotation.y += side * -0.012 * ready;
  targets.wrist.rotation.z += side * 0.018 * ready + side * 0.01 * strike;

  targets.palm.position.x += side * -0.008 * ready;
  targets.palm.position.y += 0.008 * ready - 0.018 * strike;
  targets.palm.position.z -= 0.012 * ready;
  targets.palm.rotation.x += -0.012 * ready + 0.03 * strike;
  targets.palm.rotation.y += side * -0.01 * ready;
  targets.palm.rotation.z += side * 0.014 * ready + side * 0.008 * strike;

  if (targets.closedHand) {
    targets.closedHand.position.x += centerX + side * -0.004 * ready;
    targets.closedHand.position.y += liftY - 0.004 * strike;
    targets.closedHand.position.z += reachZ - 0.004 * ready;
    targets.closedHand.rotation.x += -0.012 * ready + 0.025 * strike + 0.006 * impact;
    targets.closedHand.rotation.y += side * -0.01 * ready + side * 0.004 * strike;
    targets.closedHand.rotation.z += side * 0.026 * ready + side * 0.006 * strike;
  }
}

function writeBlazeStaffPose(
  target: MutableTransformTarget,
  holdBlend: number,
  rocketJumpPose: BlazeRocketJumpStaffSlamPose = getBlazeRocketJumpStaffSlamPose()
): void {
  const rocketJumpAmount = getBlazeRocketJumpPoseAmount(rocketJumpPose);
  const adjustedHoldBlend = holdBlend * (1 - rocketJumpAmount);
  const ready = rocketJumpPose.readyBlend;
  const strike = rocketJumpPose.strikeBlend;
  const impact = rocketJumpPose.impactPulse;

  target.position.copy(BLAZE_STAFF_POSITION);
  target.position.y += 0.012 * adjustedHoldBlend;
  target.position.z -= 0.052 * adjustedHoldBlend;
  target.rotation.copy(BLAZE_STAFF_ROTATION);
  target.rotation.x -= 0.255 * adjustedHoldBlend;
  target.rotation.y -= 0.038 * adjustedHoldBlend;
  target.rotation.z += 0.024 * adjustedHoldBlend;

  target.position.x -= 0.03 * ready;
  target.position.y += 0.09 * ready - 0.255 * strike - 0.02 * impact;
  target.position.z -= 0.018 * ready + 0.008 * strike;
  target.rotation.x += 0.006 * ready + 0.004 * strike;
  target.rotation.y += 0.004 * ready;
  target.rotation.z -= 0.006 * ready;
}

function composeBlazeRocketStaffTipMatrix({
  camera,
  elapsedSeconds,
  actionBlend,
  targetingBlend,
  holdBlend,
  rocketJumpPose,
  locomotion,
}: {
  camera: THREE.Camera;
  elapsedSeconds: number;
  actionBlend: number;
  targetingBlend: number;
  holdBlend: number;
  rocketJumpPose: BlazeRocketJumpStaffSlamPose;
  locomotion?: ViewmodelLocomotionPose;
}): THREE.Matrix4 {
  const adjustedHoldBlend = holdBlend * (1 - getBlazeRocketJumpPoseAmount(rocketJumpPose));
  const rootTransform = viewmodelRootTransformScratch;
  writeViewmodelRootTransform(rootTransform, elapsedSeconds, actionBlend, targetingBlend);
  composeTransformMatrix(viewmodelRootMatrix, rootTransform.position, rootTransform.rotation);

  matrixPosition.copy(DEFAULT_VIEWMODEL_ROOT_OFFSET);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(viewmodelOffsetMatrix, matrixPosition, matrixEuler);

  const poseTarget = blazeRocketHandPoseTarget;
  writePhantomHandPose(
    poseTarget,
    1,
    BLAZE_RIGHT_HAND_READY_BLEND,
    0,
    elapsedSeconds,
    locomotion
  );
  applyBlazeRocketPoseToHand(poseTarget, 1, adjustedHoldBlend);
  applyBlazeRocketJumpPoseToHand(poseTarget, 1, rocketJumpPose);
  composeTransformMatrix(
    viewmodelArmMatrix,
    poseTarget.closedHand.position,
    poseTarget.closedHand.rotation
  );

  matrixPosition.set(0, 0, -PHANTOM_CLOSED_HAND_WRIST_PIVOT_Z);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(blazeClosedHandInnerMatrix, matrixPosition, matrixEuler);

  writeBlazeStaffPose({
    position: blazeStaffPositionScratch,
    rotation: blazeStaffRotationScratch,
  }, holdBlend, rocketJumpPose);
  composeTransformMatrix(blazeStaffMatrix, blazeStaffPositionScratch, blazeStaffRotationScratch);

  matrixPosition.copy(BLAZE_STAFF_TIP_LOCAL_POSITION);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(blazeStaffTipMatrix, matrixPosition, matrixEuler);

  camera.updateMatrixWorld();
  viewmodelWorldMatrix
    .copy(camera.matrixWorld)
    .multiply(viewmodelRootMatrix)
    .multiply(viewmodelOffsetMatrix)
    .multiply(viewmodelArmMatrix)
    .multiply(blazeClosedHandInnerMatrix)
    .multiply(blazeStaffMatrix)
    .multiply(blazeStaffTipMatrix);

  return viewmodelWorldMatrix;
}

function sampleBlazeRocketStaffTipSocket(
  context: BlazeRocketStaffPoseSampleContext,
  actionBlend: number,
  targetingBlend: number,
  locomotion?: ViewmodelLocomotionPose
): ViewmodelSocketPoseDraft {
  const timestampMs = context.timestampMs ?? Date.now();
  const holdBlend = context.holdBlend ?? getBlazeStaffHeldBlend(timestampMs);
  const rocketJumpPose = getBlazeRocketJumpStaffSlamPose(timestampMs);
  const worldMatrix = composeBlazeRocketStaffTipMatrix({
    camera: context.camera,
    elapsedSeconds: context.elapsedSeconds,
    actionBlend,
    targetingBlend,
    holdBlend,
    rocketJumpPose,
    locomotion,
  });

  return writeViewmodelPoseDraftFromMatrix(
    viewmodelSocketPoseDraftScratch,
    viewmodelSocketPoseDraftScaleScratch,
    worldMatrix,
    timestampMs
  );
}

function createBlazeStaffChargeGlowMaterial(color: number): THREE.MeshBasicMaterial {
  return createAdditiveGlowMaterial(color);
}

function BlazePhantomForearm({
  side,
  materials,
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
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
    const nowMs = Date.now();
    const rocketJumpPose = getBlazeRocketJumpStaffSlamPose(nowMs);
    const staffHoldBlend = getBlazeStaffHeldBlend(nowMs) * (1 - getBlazeRocketJumpPoseAmount(rocketJumpPose));
    writePhantomForearmPose(
      forearm,
      side,
      side === 1 ? BLAZE_RIGHT_FOREARM_READY_BLEND : 0,
      0,
      state.clock.elapsedTime,
      locomotionRef.current
    );
    applyBlazeRocketPoseToForearm(forearm, side, staffHoldBlend);
    applyBlazeRocketJumpPoseToForearm(forearm, side, rocketJumpPose);
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

function BlazeWizardStaff({
  materials,
}: {
  materials: ViewmodelMaterialSet;
}) {
  const staffRef = useRef<THREE.Group>(null);
  const socketRef = useRef<THREE.Group>(null);
  const chargeGlowRef = useRef<THREE.Group>(null);
  const chargeCoreRef = useRef<THREE.Mesh>(null);
  const chargeHaloRef = useRef<THREE.Mesh>(null);
  const chargeRingRef = useRef<THREE.Mesh>(null);
  const tipFlareRef = useRef<THREE.Group>(null);
  const shockwaveRef = useRef<THREE.Group>(null);
  const shockwaveShellRef = useRef<THREE.Mesh>(null);
  const shockwaveRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const shockwaveStartMsRef = useRef(0);
  const processedShockwaveRevisionRef = useRef(0);
  const processedReloadBlastStartRef = useRef(0);
  // True while the reload pipeline has non-rest visuals that still need to be
  // settled back to zero once reloading stops. Lets us skip the whole reload
  // pipeline on frames where it is provably at rest (not reloading + already settled).
  const reloadNeedsSettleRef = useRef(false);
  const reloadShaftGlowRef = useRef<THREE.Mesh>(null);
  const reloadShaftRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const reloadFlameRefs = useRef<(THREE.Group | null)[]>([]);
  const reloadBurstRef = useRef<THREE.Group>(null);
  const reloadBurstCoreRef = useRef<THREE.Mesh>(null);
  const reloadBurstShellRef = useRef<THREE.Mesh>(null);
  const reloadBurstRingRefs = useRef<(THREE.Mesh | null)[]>([]);
  const reloadBurstRayRefs = useRef<(THREE.Group | null)[]>([]);
  const reloadBurstSparkRefs = useRef<(THREE.Group | null)[]>([]);
  const chargeCoreMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xff4a16), []);
  const chargeHaloMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xff6f1f), []);
  const tipFlareMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xffcf3a), []);
  const shockwaveMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xff5a18), []);
  const reloadShaftMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xff5a18), []);
  const reloadShaftRingMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xffa11d), []);
  const reloadFlameOuterMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xff6418), []);
  const reloadFlameCoreMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xfff08a), []);
  const reloadBurstCoreMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xfff1a0), []);
  const reloadBurstShellMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xff7a18), []);
  const reloadBurstRayMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xffa21d), []);
  const reloadBurstRingMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xffd65a), []);
  const reloadBurstSparkMaterial = useMemo(() => createBlazeStaffChargeGlowMaterial(0xfff7bc), []);

  useRegisteredViewmodelSocket(BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME, socketRef);

  useEffect(() => () => {
    chargeCoreMaterial.dispose();
    chargeHaloMaterial.dispose();
    tipFlareMaterial.dispose();
    shockwaveMaterial.dispose();
    reloadShaftMaterial.dispose();
    reloadShaftRingMaterial.dispose();
    reloadFlameOuterMaterial.dispose();
    reloadFlameCoreMaterial.dispose();
    reloadBurstCoreMaterial.dispose();
    reloadBurstShellMaterial.dispose();
    reloadBurstRayMaterial.dispose();
    reloadBurstRingMaterial.dispose();
    reloadBurstSparkMaterial.dispose();
  }, [
    chargeCoreMaterial,
    chargeHaloMaterial,
    reloadBurstCoreMaterial,
    reloadBurstRayMaterial,
    reloadBurstRingMaterial,
    reloadBurstShellMaterial,
    reloadBurstSparkMaterial,
    reloadFlameCoreMaterial,
    reloadFlameOuterMaterial,
    reloadShaftMaterial,
    reloadShaftRingMaterial,
    shockwaveMaterial,
    tipFlareMaterial,
  ]);

  useFrame((state) => {
    const staff = staffRef.current;
    if (!staff) return;

    const nowMs = Date.now();
    const rocketJumpPose = getBlazeRocketJumpStaffSlamPose(nowMs);
    const holdBlend = getBlazeStaffHeldBlend(nowMs);
    writeBlazeStaffPose(staff, holdBlend, rocketJumpPose);

    const tipFlare = tipFlareRef.current;
    if (tipFlare) {
      const idlePulse = 1 + Math.sin(state.clock.elapsedTime * 10.75) * 0.035;
      const flareScale = idlePulse + holdBlend * 0.1 + rocketJumpPose.impactPulse * 0.18;
      tipFlare.rotation.y = state.clock.elapsedTime * (0.32 + holdBlend * 0.72);
      tipFlare.scale.setScalar(flareScale);
      tipFlareMaterial.opacity = THREE.MathUtils.clamp(
        0.34 + holdBlend * 0.32 + rocketJumpPose.impactPulse * 0.28,
        0.26,
        0.88
      );
    }

    const chargeGlow = chargeGlowRef.current;
    if (!chargeGlow) return;

    const visible = holdBlend > 0.012;
    chargeGlow.visible = visible;
    if (!visible) {
      chargeCoreMaterial.opacity = 0;
      chargeHaloMaterial.opacity = 0;
    } else {
      const pulse = 1 + Math.sin(state.clock.elapsedTime * 14.5) * 0.06 * holdBlend;
      const coreScale = THREE.MathUtils.lerp(0.02, 0.058, holdBlend) * pulse;
      const haloScale = THREE.MathUtils.lerp(0.045, 0.132, holdBlend) * (1 + Math.sin(state.clock.elapsedTime * 9.5) * 0.045 * holdBlend);
      const ringScale = THREE.MathUtils.lerp(0.058, 0.15, holdBlend);

      chargeCoreRef.current?.scale.setScalar(coreScale);
      chargeHaloRef.current?.scale.setScalar(haloScale);
      chargeRingRef.current?.scale.set(ringScale, ringScale, 1);
      chargeCoreMaterial.opacity = THREE.MathUtils.clamp(holdBlend * 0.9, 0, 0.9);
      chargeHaloMaterial.opacity = THREE.MathUtils.clamp(holdBlend * 0.48, 0, 0.48);
    }

    const shockwaveEvent = getBlazeStaffShockwaveEvent();
    if (
      shockwaveEvent.revision > 0 &&
      shockwaveEvent.revision !== processedShockwaveRevisionRef.current
    ) {
      processedShockwaveRevisionRef.current = shockwaveEvent.revision;
      shockwaveStartMsRef.current = shockwaveEvent.startedAtMs || nowMs;
    }

    const shockwave = shockwaveRef.current;
    if (shockwave && shockwaveStartMsRef.current > 0) {
      const progress = THREE.MathUtils.clamp(
        (nowMs - shockwaveStartMsRef.current) / BLAZE_STAFF_SHOCKWAVE_DURATION_MS,
        0,
        1
      );
      const shockwaveVisible = progress < 1;
      shockwave.visible = shockwaveVisible;
      if (shockwaveVisible) {
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        const shockwaveScale = THREE.MathUtils.lerp(0.06, 0.74, easedProgress);
        const shockwaveOpacity = (1 - THREE.MathUtils.smoothstep(progress, 0.18, 1)) * 0.62;
        shockwaveShellRef.current?.scale.setScalar(shockwaveScale);
        shockwaveRingRefs.current.forEach((ring) => {
          ring?.scale.set(shockwaveScale, shockwaveScale, 1);
        });
        shockwaveMaterial.opacity = THREE.MathUtils.clamp(shockwaveOpacity, 0, 0.62);
      } else {
        shockwaveMaterial.opacity = 0;
      }
    } else {
      shockwaveMaterial.opacity = 0;
    }

    const {
      blazePrimaryReloading,
      blazePrimaryReloadStart,
      blazePrimaryReloadEnd,
    } = useGameStore.getState();
    // The reload pipeline is the last work in this frame. When not reloading and
    // everything is already settled to its rest (all opacities 0, nodes hidden),
    // there is nothing to do — skip it entirely. The frame reloading ends still
    // runs once (ref is still true) to settle values, then subsequent idle frames
    // bail here.
    if (!blazePrimaryReloading && !reloadNeedsSettleRef.current) {
      return;
    }
    reloadNeedsSettleRef.current = blazePrimaryReloading;
    const reloadDuration = Math.max(
      1,
      blazePrimaryReloadEnd - blazePrimaryReloadStart || BLAZE_PRIMARY_RELOAD_MS
    );
    const reloadProgress = blazePrimaryReloading
      ? THREE.MathUtils.clamp((nowMs - blazePrimaryReloadStart) / reloadDuration, 0, 1)
      : 0;
    const reloadHead = THREE.MathUtils.smoothstep(reloadProgress, 0.02, BLAZE_STAFF_RELOAD_BURST_START);
    const reloadActiveAmount = blazePrimaryReloading
      ? THREE.MathUtils.smoothstep(reloadProgress, 0, 0.12) *
        (1 - THREE.MathUtils.smoothstep(reloadProgress, 0.86, 1))
      : 0;
    const shaftWaveY = THREE.MathUtils.lerp(
      BLAZE_STAFF_RELOAD_SHAFT_START_Y,
      BLAZE_STAFF_RELOAD_SHAFT_END_Y,
      reloadHead
    );
    const shaftGlow = reloadShaftGlowRef.current;
    if (shaftGlow) {
      shaftGlow.visible = reloadActiveAmount > 0.025;
      if (shaftGlow.visible) {
        const shaftPulse = 1 + Math.sin(state.clock.elapsedTime * 18.5) * 0.08;
        const shaftHeight = THREE.MathUtils.clamp(
          shaftWaveY - BLAZE_STAFF_RELOAD_SHAFT_START_Y + 0.12,
          0.1,
          BLAZE_STAFF_RELOAD_SHAFT_END_Y - BLAZE_STAFF_RELOAD_SHAFT_START_Y + 0.12
        );
        shaftGlow.position.y = BLAZE_STAFF_RELOAD_SHAFT_START_Y + shaftHeight * 0.5;
        shaftGlow.rotation.y = state.clock.elapsedTime * 0.9;
        shaftGlow.scale.set(0.052 * shaftPulse, shaftHeight, 0.052 * shaftPulse);
      }
    }
    reloadShaftMaterial.opacity = THREE.MathUtils.clamp(reloadActiveAmount * 0.42, 0, 0.42);
    const reloadShaftRings = reloadShaftRingRefs.current;
    for (let index = 0; index < reloadShaftRings.length; index++) {
      const ring = reloadShaftRings[index];
      if (!ring) continue;
      const trailingY = shaftWaveY - index * 0.115;
      const ringVisible =
        reloadActiveAmount > 0.04 &&
        trailingY > BLAZE_STAFF_RELOAD_SHAFT_START_Y + 0.01 &&
        trailingY < BLAZE_STAFF_RELOAD_SHAFT_END_Y + 0.06;
      ring.visible = ringVisible;
      if (!ringVisible) continue;

      const ringPulse = 1 + Math.sin(state.clock.elapsedTime * 24 + index * 1.9) * 0.08;
      ring.position.y = trailingY;
      ring.rotation.z = state.clock.elapsedTime * (1.5 + index * 0.28);
      ring.scale.setScalar((0.061 - index * 0.006) * ringPulse);
    }
    reloadShaftRingMaterial.opacity = THREE.MathUtils.clamp(reloadActiveAmount * 0.62, 0, 0.62);
    let strongestFlame = 0;

    for (let index = 0; index < BLAZE_STAFF_RELOAD_FLAMES.length; index++) {
      const flame = BLAZE_STAFF_RELOAD_FLAMES[index];
      const flameNode = reloadFlameRefs.current[index];
      if (!flameNode) continue;

      const ignite = THREE.MathUtils.smoothstep(reloadHead, flame.progress - 0.11, flame.progress + 0.03);
      const extinguish = 1 - THREE.MathUtils.smoothstep(reloadHead, flame.progress + 0.16, flame.progress + 0.34);
      const waveProximity = 1 - THREE.MathUtils.clamp(Math.abs(flame.progress - reloadHead) / 0.2, 0, 1);
      const endFade = 1 - THREE.MathUtils.smoothstep(reloadProgress, 0.84, 0.96);
      const amount = blazePrimaryReloading
        ? THREE.MathUtils.clamp((ignite * extinguish * 0.9 + waveProximity * 0.58) * endFade, 0, 1)
        : 0;
      strongestFlame = Math.max(strongestFlame, amount);
      flameNode.visible = amount > 0.018;
      if (!flameNode.visible) continue;

      const flicker = 1 + Math.sin(state.clock.elapsedTime * 29 + index * 1.77) * 0.16;
      const wobbleAngle = flame.angle + Math.sin(state.clock.elapsedTime * 12 + index * 0.84) * 0.16 * amount;
      const flameRadius = 0.035 + amount * 0.013;
      flameNode.position.set(
        Math.sin(wobbleAngle) * flameRadius,
        flame.y + Math.sin(state.clock.elapsedTime * 18 + index) * 0.009 * amount,
        Math.cos(wobbleAngle) * flameRadius
      );
      flameNode.rotation.y = wobbleAngle + state.clock.elapsedTime * (0.7 + amount * 1.85);
      flameNode.scale.set(
        THREE.MathUtils.lerp(0.72, 1.82, amount) * flame.size * flicker,
        THREE.MathUtils.lerp(0.58, 2.18, amount) * flame.size,
        THREE.MathUtils.lerp(0.72, 1.82, amount) * flame.size * flicker
      );
    }
    reloadFlameOuterMaterial.opacity = THREE.MathUtils.clamp(strongestFlame * 0.94, 0, 0.94);
    reloadFlameCoreMaterial.opacity = THREE.MathUtils.clamp(strongestFlame * 0.86, 0, 0.86);

    const burst = reloadBurstRef.current;
    const burstProgress = blazePrimaryReloading
      ? THREE.MathUtils.clamp((reloadProgress - BLAZE_STAFF_RELOAD_BURST_START) / (1 - BLAZE_STAFF_RELOAD_BURST_START), 0, 1)
      : 0;
    if (
      blazePrimaryReloading &&
      blazePrimaryReloadStart > 0 &&
      burstProgress > 0 &&
      processedReloadBlastStartRef.current !== blazePrimaryReloadStart
    ) {
      processedReloadBlastStartRef.current = blazePrimaryReloadStart;
      void playSharedSound('blazeReloadBlast');
    } else if (!blazePrimaryReloading && reloadProgress === 0) {
      processedReloadBlastStartRef.current = 0;
    }
    const burstIgnite = THREE.MathUtils.smoothstep(burstProgress, 0, 0.1);
    const burstFade = 1 - THREE.MathUtils.smoothstep(burstProgress, 0.34, 1);
    const burstAmount = burstIgnite * burstFade;
    const burstExpansion = 1 - Math.pow(1 - burstProgress, 3);
    const burstVisible = burstProgress > 0 && burstProgress < 1;
    if (burst) {
      burst.visible = burstVisible;
      if (burst.visible) {
        burst.rotation.y = state.clock.elapsedTime * 1.9;
        burst.rotation.z = Math.sin(state.clock.elapsedTime * 18) * 0.08 * burstAmount;
      }
    }
    reloadBurstCoreRef.current?.scale.setScalar(THREE.MathUtils.lerp(0.055, 0.17, burstAmount));
    reloadBurstShellRef.current?.scale.setScalar(THREE.MathUtils.lerp(0.12, 0.42, burstExpansion));
    const reloadBurstRings = reloadBurstRingRefs.current;
    for (let index = 0; index < reloadBurstRings.length; index++) {
      const ring = reloadBurstRings[index];
      if (!ring) continue;
      ring.visible = burstVisible;
      if (!ring.visible) continue;
      const ringScale = THREE.MathUtils.lerp(0.07, 0.38 + index * 0.06, burstExpansion);
      ring.scale.set(ringScale, ringScale, 1);
      ring.rotation.z += 0.01 * (index + 1);
    }
    const reloadBurstRays = reloadBurstRayRefs.current;
    for (let index = 0; index < reloadBurstRays.length; index++) {
      const ray = reloadBurstRays[index];
      if (!ray) continue;
      const rayDelay = index % 2 === 0 ? 0 : 0.045;
      const rayProgress = THREE.MathUtils.clamp((burstProgress - rayDelay) / 0.48, 0, 1);
      const rayAmount =
        THREE.MathUtils.smoothstep(rayProgress, 0, 0.16) *
        (1 - THREE.MathUtils.smoothstep(rayProgress, 0.52, 1));
      ray.visible = rayAmount > 0.02;
      if (!ray.visible) continue;
      const rayLength = BLAZE_STAFF_RELOAD_BURST_RAYS[index]?.length ?? 1;
      ray.position.y = Math.sin(rayProgress * Math.PI) * 0.018;
      ray.scale.set(
        THREE.MathUtils.lerp(0.4, 1.35, rayAmount) * rayLength,
        THREE.MathUtils.lerp(0.52, 1.8, rayAmount) * rayLength,
        THREE.MathUtils.lerp(0.4, 1.35, rayAmount) * rayLength
      );
    }
    const reloadBurstSparks = reloadBurstSparkRefs.current;
    for (let index = 0; index < reloadBurstSparks.length; index++) {
      const sparkNode = reloadBurstSparks[index];
      if (!sparkNode) continue;
      const spark = BLAZE_STAFF_RELOAD_BURST_SPARKS[index];
      if (!spark) continue;

      const sparkProgress = THREE.MathUtils.clamp((burstProgress - spark.delay) / (1 - spark.delay), 0, 1);
      const sparkAmount = Math.sin(sparkProgress * Math.PI);
      sparkNode.visible = burstProgress > spark.delay && sparkProgress < 1 && sparkAmount > 0.02;
      if (!sparkNode.visible) continue;

      const sparkEase = 1 - Math.pow(1 - sparkProgress, 2);
      const sparkDistance = THREE.MathUtils.lerp(0.034, spark.distance, sparkEase);
      sparkNode.position.set(
        Math.sin(spark.angle) * sparkDistance,
        spark.lift * Math.sin(sparkProgress * Math.PI * 0.86) + sparkProgress * 0.028,
        Math.cos(spark.angle) * sparkDistance
      );
      sparkNode.scale.setScalar(spark.size * (0.45 + sparkAmount * 1.25));
    }
    reloadBurstCoreMaterial.opacity = burstVisible ? THREE.MathUtils.clamp(burstAmount * 0.96, 0, 0.96) : 0;
    reloadBurstShellMaterial.opacity = burstVisible
      ? THREE.MathUtils.clamp((1 - THREE.MathUtils.smoothstep(burstProgress, 0.2, 1)) * 0.5, 0, 0.5)
      : 0;
    reloadBurstRayMaterial.opacity = burstVisible ? THREE.MathUtils.clamp(burstAmount * 0.86, 0, 0.86) : 0;
    reloadBurstRingMaterial.opacity = burstVisible
      ? THREE.MathUtils.clamp((1 - THREE.MathUtils.smoothstep(burstProgress, 0.18, 1)) * 0.72, 0, 0.72)
      : 0;
    reloadBurstSparkMaterial.opacity = burstVisible
      ? THREE.MathUtils.clamp((1 - THREE.MathUtils.smoothstep(burstProgress, 0.45, 1)) * 0.92, 0, 0.92)
      : 0;
  });

  return (
    <group
      ref={staffRef}
      position={[
        BLAZE_STAFF_POSITION.x,
        BLAZE_STAFF_POSITION.y,
        BLAZE_STAFF_POSITION.z,
      ]}
      rotation={[
        BLAZE_STAFF_ROTATION.x,
        BLAZE_STAFF_ROTATION.y,
        BLAZE_STAFF_ROTATION.z,
      ]}
    >
      <mesh
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={materials.dark}
        position={[0, 0.01, 0]}
        scale={[0.023, 0.82, 0.023]}
      />
      <mesh
        geometry={SHARED_GEOMETRIES.cylinder8}
        material={materials.metal}
        position={[0, 0.01, 0]}
        scale={[0.014, 0.86, 0.014]}
      />
      {[-0.28, -0.06, 0.22, 0.38].map(y => (
        <mesh
          key={y}
          geometry={SHARED_GEOMETRIES.cylinder12}
          material={materials.accent}
          position={[0, y, 0]}
          scale={[0.032, 0.016, 0.032]}
        />
      ))}

      <mesh
        ref={reloadShaftGlowRef}
        geometry={SHARED_GEOMETRIES.cylinderOpen16}
        material={reloadShaftMaterial}
        visible={false}
        position={[0, -0.34, 0]}
        scale={[0.001, 0.001, 0.001]}
      />
      {[0, 1, 2].map(index => (
        <mesh
          key={`reload-shaft-ring-${index}`}
          ref={(node) => {
            reloadShaftRingRefs.current[index] = node;
          }}
          geometry={SHARED_GEOMETRIES.ring24}
          material={reloadShaftRingMaterial}
          visible={false}
          rotation={[Math.PI / 2, 0, 0]}
          scale={[0.001, 0.001, 1]}
        />
      ))}

      <group>
        {BLAZE_STAFF_RELOAD_FLAMES.map((flame, index) => (
          <group
            key={`reload-flame-${flame.y}`}
            ref={(node) => {
              reloadFlameRefs.current[index] = node;
            }}
            visible={false}
            position={[Math.sin(flame.angle) * 0.026, flame.y, Math.cos(flame.angle) * 0.026]}
            rotation={[0, flame.angle, 0]}
          >
            <mesh
              geometry={SHARED_GEOMETRIES.cone6}
              material={reloadFlameOuterMaterial}
              position={[0, 0.038, 0]}
              scale={[0.026, 0.132, 0.026]}
            />
            <mesh
              geometry={SHARED_GEOMETRIES.cone6}
              material={reloadFlameCoreMaterial}
              position={[0, 0.048, 0]}
              scale={[0.012, 0.1, 0.012]}
            />
            <mesh
              geometry={SHARED_GEOMETRIES.sphere8}
              material={reloadFlameOuterMaterial}
              position={[0, 0.006, 0]}
              scale={0.026}
            />
            <mesh
              geometry={SHARED_GEOMETRIES.sphere8}
              material={reloadFlameCoreMaterial}
              position={[0, 0.012, 0]}
              scale={0.012}
            />
          </group>
        ))}
      </group>

      <group ref={reloadBurstRef} visible={false} position={[0, 0.588, 0]}>
        <mesh ref={reloadBurstCoreRef} geometry={SHARED_GEOMETRIES.sphere16} material={reloadBurstCoreMaterial} scale={0.001} />
        <mesh ref={reloadBurstShellRef} geometry={SHARED_GEOMETRIES.sphere16} material={reloadBurstShellMaterial} scale={0.001} />
        {[
          [Math.PI / 2, 0, 0],
          [0, Math.PI / 2, 0],
          [0, 0, Math.PI / 2],
        ].map((rotation, index) => (
          <mesh
            key={`reload-burst-ring-${index}`}
            ref={(node) => {
              reloadBurstRingRefs.current[index] = node;
            }}
            geometry={SHARED_GEOMETRIES.ring24}
            material={reloadBurstRingMaterial}
            rotation={rotation as [number, number, number]}
            scale={[0.001, 0.001, 1]}
          />
        ))}
        {BLAZE_STAFF_RELOAD_BURST_RAYS.map((ray, index) => (
          <group
            key={`reload-burst-ray-${ray.angle}`}
            ref={(node) => {
              reloadBurstRayRefs.current[index] = node;
            }}
            visible={false}
            rotation={[0, ray.angle, 0]}
          >
            <mesh
              geometry={SHARED_GEOMETRIES.cone6}
              material={reloadBurstRayMaterial}
              position={[0, 0.034, 0.082]}
              rotation={[ray.pitch, 0, 0]}
              scale={[0.024, 0.148, 0.024]}
            />
            <mesh
              geometry={SHARED_GEOMETRIES.cone6}
              material={reloadBurstCoreMaterial}
              position={[0, 0.036, 0.084]}
              rotation={[ray.pitch, 0, 0]}
              scale={[0.01, 0.108, 0.01]}
            />
          </group>
        ))}
        {BLAZE_STAFF_RELOAD_BURST_SPARKS.map((spark, index) => (
          <group
            key={`reload-burst-spark-${spark.angle}`}
            ref={(node) => {
              reloadBurstSparkRefs.current[index] = node;
            }}
            visible={false}
          >
            <mesh geometry={SHARED_GEOMETRIES.sphere8} material={reloadBurstSparkMaterial} scale={1} />
          </group>
        ))}
      </group>

      <group position={[0, 0.49, 0]}>
        <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.metal} position={[0, -0.048, 0]} scale={[0.056, 0.026, 0.056]} />
        <mesh geometry={SHARED_GEOMETRIES.cylinderOpen12} material={materials.glow} position={[0, -0.012, 0]} scale={[0.056, 0.068, 0.056]} />
        <mesh geometry={SHARED_GEOMETRIES.cone8} material={materials.glass} position={[0, 0.031, 0]} scale={[0.05, 0.074, 0.05]} />
        <mesh geometry={SHARED_GEOMETRIES.cone8} material={materials.glass} position={[0, -0.033, 0]} rotation={[Math.PI, 0, 0]} scale={[0.04, 0.054, 0.04]} />
        <mesh geometry={SHARED_GEOMETRIES.cone8} material={materials.glow} position={[0, 0.061, 0]} scale={[0.031, 0.082, 0.031]} />
        <mesh geometry={SHARED_GEOMETRIES.ring24} material={materials.accent} rotation={[Math.PI / 2, 0, 0]} scale={[0.082, 0.082, 1]} />
        <mesh geometry={SHARED_GEOMETRIES.ring16} material={materials.glow} position={[0, 0.034, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[0.064, 0.064, 1]} />
        {BLAZE_STAFF_TIP_PRONG_ANGLES.map(angle => (
          <group key={`prong-${angle}`} rotation={[0, angle, 0]}>
            <mesh
              geometry={SHARED_GEOMETRIES.box}
              material={materials.metal}
              position={[0, 0.006, 0.058]}
              rotation={[-0.34, 0, 0]}
              scale={[0.016, 0.112, 0.022]}
            />
            <mesh
              geometry={SHARED_GEOMETRIES.box}
              material={materials.accent}
              position={[0, 0.05, 0.062]}
              rotation={[-0.34, 0, 0]}
              scale={[0.009, 0.04, 0.012]}
            />
          </group>
        ))}
        <group ref={tipFlareRef}>
          {BLAZE_STAFF_TIP_FLAME_ANGLES.map(angle => (
            <group key={`flare-${angle}`} rotation={[0, angle, 0]}>
              <mesh
                geometry={SHARED_GEOMETRIES.cone6}
                material={tipFlareMaterial}
                position={[0, 0.034, 0.066]}
                rotation={[-0.54, 0, 0]}
                scale={[0.013, 0.068, 0.013]}
              />
            </group>
          ))}
        </group>
        <group ref={chargeGlowRef} visible={false}>
          <mesh ref={chargeCoreRef} geometry={SHARED_GEOMETRIES.sphere16} material={chargeCoreMaterial} scale={0.001} />
          <mesh ref={chargeHaloRef} geometry={SHARED_GEOMETRIES.sphere16} material={chargeHaloMaterial} scale={0.001} />
          <mesh ref={chargeRingRef} geometry={SHARED_GEOMETRIES.ring24} material={chargeHaloMaterial} rotation={[Math.PI / 2, 0, 0]} scale={[0.001, 0.001, 1]} />
        </group>
        <group ref={shockwaveRef} visible={false}>
          <mesh ref={shockwaveShellRef} geometry={SHARED_GEOMETRIES.sphere16} material={shockwaveMaterial} scale={0.001} />
          {[
            [Math.PI / 2, 0, 0],
            [0, Math.PI / 2, 0],
            [0, 0, Math.PI / 2],
          ].map((rotation, index) => (
            <mesh
              key={index}
              ref={(node) => {
                shockwaveRingRefs.current[index] = node;
              }}
              geometry={SHARED_GEOMETRIES.ring24}
              material={shockwaveMaterial}
              rotation={rotation as [number, number, number]}
              scale={[0.001, 0.001, 1]}
            />
          ))}
        </group>
        <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0.069, -0.014, 0]} rotation={[0, 0, 0.22]} scale={[0.012, 0.074, 0.018]} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[-0.069, -0.014, 0]} rotation={[0, 0, -0.22]} scale={[0.012, 0.074, 0.018]} />
      </group>

      <group position={[0, -0.43, 0]}>
        <mesh geometry={SHARED_GEOMETRIES.cylinder12} material={materials.accent} scale={[0.032, 0.032, 0.032]} />
        <mesh geometry={SHARED_GEOMETRIES.sphere8} material={materials.metal} scale={0.034} />
      </group>

      <group
        ref={socketRef}
        name={BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME}
        position={[
          BLAZE_STAFF_TIP_LOCAL_POSITION.x,
          BLAZE_STAFF_TIP_LOCAL_POSITION.y,
          BLAZE_STAFF_TIP_LOCAL_POSITION.z,
        ]}
      />
    </group>
  );
}

function BlazePhantomHand({
  side,
  materials,
  locomotionRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
}) {
  const closedVisualRef = useRef<THREE.Group>(null);
  const armRef = useRef<THREE.Group>(null);
  const wristRef = useRef<THREE.Group>(null);
  const palmRef = useRef<THREE.Group>(null);
  const thumbRef = useRef<THREE.Group>(null);
  const fingerRefs = useRef<(THREE.Group | null)[]>([]);

  useFrame((state) => {
    const closedHand = closedVisualRef.current;
    const arm = armRef.current;
    const wrist = wristRef.current;
    const palm = palmRef.current;
    const thumb = thumbRef.current;
    const fingers = resolveFingerTargets(fingerRefs.current);
    if (!closedHand || !arm || !wrist || !palm || !thumb || !fingers) return;

    const nowMs = Date.now();
    const rocketJumpPose = getBlazeRocketJumpStaffSlamPose(nowMs);
    const staffHoldBlend = getBlazeStaffHeldBlend(nowMs) * (1 - getBlazeRocketJumpPoseAmount(rocketJumpPose));
    writePhantomHandPose(
      {
        closedHand,
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      side === 1 ? BLAZE_RIGHT_HAND_READY_BLEND : 0,
      0,
      state.clock.elapsedTime,
      locomotionRef.current
    );
    applyBlazeRocketPoseToHand(
      {
        closedHand,
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      staffHoldBlend
    );
    applyBlazeRocketJumpPoseToHand(
      {
        closedHand,
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      rocketJumpPose
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
          {side === 1 && <BlazeWizardStaff materials={materials} />}
        </group>
      </group>

      <group ref={armRef} visible={false}>
        <group ref={wristRef}>
          <group ref={palmRef}>
            <group ref={thumbRef} />
            {PHANTOM_OPEN_FINGER_SLOTS.map((slot, index) => (
              <group
                key={slot}
                ref={(node) => {
                  fingerRefs.current[index] = node;
                }}
              />
            ))}
          </group>
        </group>
      </group>
    </group>
  );
}

function BlazeViewmodel({
  materials,
  locomotionRef,
}: {
  materials: ViewmodelMaterialSet;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
}) {
  return (
    <group position={[
      DEFAULT_VIEWMODEL_ROOT_OFFSET.x,
      DEFAULT_VIEWMODEL_ROOT_OFFSET.y,
      DEFAULT_VIEWMODEL_ROOT_OFFSET.z,
    ]}>
      <group position={[0.06, -0.035, 0.18]}>
        <BlazePhantomForearm
          side={-1}
          materials={materials}
          locomotionRef={locomotionRef}
        />
        <BlazePhantomHand
          side={-1}
          materials={materials}
          locomotionRef={locomotionRef}
        />
      </group>
      <BlazePhantomForearm
        side={1}
        materials={materials}
        locomotionRef={locomotionRef}
      />
      <BlazePhantomHand
        side={1}
        materials={materials}
        locomotionRef={locomotionRef}
      />
    </group>
  );
}

function createChronosMovementBobRuntime(): ChronosMovementBobRuntime {
  return {
    phase: 0,
    movementBlend: 0,
    runBlend: 0,
    slideBlend: 0,
    previousCameraPosition: new THREE.Vector3(),
    hasPreviousCameraPosition: false,
  };
}

function updateChronosMovementBobRuntime(
  runtime: ChronosMovementBobRuntime,
  locomotion: ViewmodelLocomotionPose,
  camera: THREE.Camera,
  delta: number
): ChronosMovementBobOffset {
  const frameDelta = THREE.MathUtils.clamp(delta, 0, CHRONOS_MOVEMENT_BOB_MAX_DELTA_SECONDS);
  const previousPosition = runtime.previousCameraPosition;
  if (!runtime.hasPreviousCameraPosition) {
    previousPosition.copy(camera.position);
    runtime.hasPreviousCameraPosition = true;
    return { horizontalX: 0, verticalY: 0, slideBlend: 0 };
  }

  const dx = camera.position.x - previousPosition.x;
  const dz = camera.position.z - previousPosition.z;
  const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
  previousPosition.copy(camera.position);

  const frameSeconds = Math.max(delta, 1 / 120);
  const horizontalSpeed = horizontalDistance > PHANTOM_LOCOMOTION_TELEPORT_DISTANCE
    ? 0
    : horizontalDistance / frameSeconds;
  const visualState = visualStore.getState();
  const movementState = visualState.localMovement;
  const localMovement = visualState.localViewmodelMovement;
  const isLocalMovementFresh = Date.now() - localMovement.updatedAtMs <= CHRONOS_MOVEMENT_INPUT_FRESH_MS;
  const localHorizontalSpeed = isLocalMovementFresh ? localMovement.horizontalSpeed : 0;
  const localInputMoveBlend = isLocalMovementFresh && localMovement.hasMovementInput ? 1 : 0;
  const targetSlideBlend = THREE.MathUtils.clamp(
    Math.max(movementState.isSliding ? 1 : 0, visualState.slideIntensity),
    0,
    1
  );
  runtime.slideBlend = THREE.MathUtils.damp(
    runtime.slideBlend,
    targetSlideBlend,
    targetSlideBlend > runtime.slideBlend
      ? CHRONOS_SLIDE_PULLBACK_IN_SPEED
      : CHRONOS_SLIDE_PULLBACK_OUT_SPEED,
    frameDelta
  );
  const cameraMoveBlend = THREE.MathUtils.smoothstep(
    horizontalSpeed,
    PHANTOM_LOCOMOTION_MOVE_START_SPEED,
    PHANTOM_LOCOMOTION_FULL_WALK_SPEED
  );
  const velocityMoveBlend = THREE.MathUtils.smoothstep(
    localHorizontalSpeed,
    PHANTOM_LOCOMOTION_MOVE_START_SPEED,
    PHANTOM_LOCOMOTION_FULL_WALK_SPEED
  );
  const locomotionMoveBlend = THREE.MathUtils.clamp(locomotion.movementBlend, 0, 1);
  const targetMovementBlend = THREE.MathUtils.smoothstep(
    Math.max(cameraMoveBlend, localInputMoveBlend, locomotionMoveBlend, velocityMoveBlend),
    0,
    1
  ) * (1 - runtime.slideBlend * 0.85);
  const walkSpeed = HERO_DEFINITIONS.chronos.stats.moveSpeed;
  const runSpeed = walkSpeed * SPRINT_MULTIPLIER;
  const locomotionRunBlend = THREE.MathUtils.clamp(locomotion.runBlend, 0, 1);
  const targetRunBlend = Math.max(
    THREE.MathUtils.smoothstep(horizontalSpeed, walkSpeed * 0.92, runSpeed * 0.98),
    THREE.MathUtils.smoothstep(localHorizontalSpeed, walkSpeed * 0.92, runSpeed * 0.98),
    locomotionRunBlend,
    movementState?.isSprinting || (isLocalMovementFresh && localMovement.isSprinting) ? 1 : 0
  ) * targetMovementBlend;

  runtime.movementBlend = THREE.MathUtils.damp(
    runtime.movementBlend,
    targetMovementBlend,
    8,
    frameDelta
  );
  runtime.runBlend = THREE.MathUtils.damp(
    runtime.runBlend,
    targetRunBlend,
    6,
    frameDelta
  );

  if (runtime.movementBlend <= 0.002 && targetMovementBlend <= 0.002) {
    return { horizontalX: 0, verticalY: 0, slideBlend: runtime.slideBlend };
  }

  const runScale = THREE.MathUtils.lerp(1, 1.12, runtime.runBlend);
  const arcSpeed = THREE.MathUtils.lerp(
    CHRONOS_MOVEMENT_BOB_WALK_SPEED,
    CHRONOS_MOVEMENT_BOB_RUN_SPEED,
    runtime.runBlend
  );
  runtime.phase = (runtime.phase + frameDelta * arcSpeed) % (Math.PI * 2);

  const sideTravel = Math.sin(runtime.phase);
  const arcLift = 1 - sideTravel * sideTravel;
  const movementScale = runScale * runtime.movementBlend;
  return {
    horizontalX: sideTravel * CHRONOS_MOVEMENT_BOB_X * movementScale,
    verticalY: arcLift * CHRONOS_MOVEMENT_BOB_Y * movementScale,
    slideBlend: runtime.slideBlend,
  };
}

function writeChronosTriangleForearmPose(
  target: MutableTransformTarget,
  side: -1 | 1,
  elapsedSeconds: number,
  movementBob: ChronosMovementBobOffset,
  aegisPose: ChronosAegisPose
): void {
  writePhantomForearmPose(
    target,
    side,
    CHRONOS_FOREARM_READY_BLEND,
    0,
    elapsedSeconds,
    VIEWMODEL_STILL_LOCOMOTION_POSE
  );

  const breath = Math.sin(elapsedSeconds * 1.2 + side * 0.65) * 0.002;
  const spread = aegisPose.spread;
  const recoil = aegisPose.recoil;
  target.position.x += side * -0.062 + movementBob.horizontalX;
  target.position.y += 0.018 + breath + movementBob.verticalY;
  target.position.z +=
    CHRONOS_FOREARM_CAMERA_PULLBACK_Z +
    movementBob.slideBlend * CHRONOS_FOREARM_SLIDE_CAMERA_PULLBACK_Z;
  target.rotation.x -= 0.062;
  target.rotation.y += side * 0.018;
  target.rotation.z += side * 0.18;

  target.position.x += side * 0.088 * spread;
  target.position.y += 0.018 * spread;
  target.position.z -= 0.036 * spread;
  target.rotation.x -= 0.052 * spread;
  target.rotation.y += side * -0.075 * spread;
  target.rotation.z += side * -0.15 * spread;

  target.position.x += side * -0.018 * recoil;
  target.position.y -= 0.026 * recoil;
  target.position.z += 0.128 * recoil;
  target.rotation.x += 0.11 * recoil;
  target.rotation.y += side * 0.034 * recoil;
  target.rotation.z += side * 0.08 * recoil;
}

function writeChronosTriangleHandPose(
  targets: PhantomHandPoseTargets,
  side: -1 | 1,
  elapsedSeconds: number,
  movementBob: ChronosMovementBobOffset,
  aegisPose: ChronosAegisPose
): void {
  writePhantomHandPose(
    targets,
    side,
    CHRONOS_HAND_READY_BLEND,
    0,
    elapsedSeconds,
    VIEWMODEL_STILL_LOCOMOTION_POSE
  );

  const innerSide = -side;
  const breath = Math.sin(elapsedSeconds * 1.42 + side * 0.58) * 0.0025;
  const spread = aegisPose.spread;
  const recoil = aegisPose.recoil;
  targets.arm.position.x += side * -0.074 + movementBob.horizontalX;
  targets.arm.position.y += 0.024 + breath + movementBob.verticalY;
  targets.arm.position.z +=
    CHRONOS_HAND_CAMERA_PULLBACK_Z +
    movementBob.slideBlend * CHRONOS_HAND_SLIDE_CAMERA_PULLBACK_Z;
  targets.arm.rotation.x -= 0.074;
  targets.arm.rotation.y += side * 0.026;
  targets.arm.rotation.z += side * 0.19;

  targets.arm.position.x += side * 0.118 * spread;
  targets.arm.position.y += 0.036 * spread;
  targets.arm.position.z -= 0.07 * spread;
  targets.arm.rotation.x -= 0.08 * spread;
  targets.arm.rotation.y += side * -0.16 * spread;
  targets.arm.rotation.z += side * -0.24 * spread;
  targets.arm.position.x += side * -0.024 * recoil;
  targets.arm.position.y -= 0.034 * recoil;
  targets.arm.position.z += 0.168 * recoil;
  targets.arm.rotation.x += 0.14 * recoil;
  targets.arm.rotation.y += side * 0.052 * recoil;
  targets.arm.rotation.z += side * 0.11 * recoil;

  targets.wrist.position.z -= 0.004;
  targets.wrist.rotation.x -= 0.012;
  targets.wrist.rotation.y += side * 0.016;
  targets.wrist.rotation.z += side * 0.04;
  targets.wrist.position.y += 0.01 * spread;
  targets.wrist.position.z -= 0.018 * spread;
  targets.wrist.rotation.x -= 0.034 * spread;
  targets.wrist.rotation.y += side * -0.07 * spread;
  targets.wrist.position.y -= 0.012 * recoil;
  targets.wrist.position.z += 0.052 * recoil;
  targets.wrist.rotation.x += 0.066 * recoil;
  targets.wrist.rotation.z += side * 0.04 * recoil;

  targets.palm.position.x += side * -0.002;
  targets.palm.position.y += 0.002;
  targets.palm.position.z -= 0.01;
  targets.palm.rotation.x -= 0.028;
  targets.palm.rotation.y += side * -0.01;
  targets.palm.rotation.z += side * 0.018;
  targets.palm.position.x += side * 0.014 * spread;
  targets.palm.position.y += 0.012 * spread;
  targets.palm.position.z -= 0.022 * spread;
  targets.palm.rotation.x -= 0.04 * spread;
  targets.palm.rotation.y += side * -0.1 * spread;
  targets.palm.rotation.z += side * 0.045 * spread;
  targets.palm.position.y -= 0.014 * recoil;
  targets.palm.position.z += 0.064 * recoil;
  targets.palm.rotation.x += 0.072 * recoil;
  targets.palm.rotation.y += side * 0.036 * recoil;

  targets.thumb.position.set(innerSide * 0.064, -0.026, -0.032);
  targets.thumb.rotation.set(0.035, innerSide * 0.05, innerSide * 0.48);

  for (let index = 0; index < targets.fingers.length; index++) {
    const finger = targets.fingers[index];
    const fingerSpread = index - 1.5;
    const heldFingerSlot = fingerSpread * (0.034 + 0.01 * spread);
    const fanRotation = fingerSpread * (0.04 + 0.055 * spread);
    finger.position.set(
      heldFingerSlot,
      0.056 + 0.014 * spread,
      -0.032 - 0.02 * spread
    );
    finger.rotation.set(
      -0.05 - 0.035 * spread,
      innerSide * (0.012 + 0.02 * spread),
      -innerSide * 0.18 + fanRotation
    );
  }
}

function composeChronosWeaponSocketLocalMatrix({
  targetMatrix,
  side,
  elapsedSeconds,
  movementBob,
  aegisPose,
}: {
  targetMatrix: THREE.Matrix4;
  side: -1 | 1;
  elapsedSeconds: number;
  movementBob: ChronosMovementBobOffset;
  aegisPose: ChronosAegisPose;
}): THREE.Matrix4 {
  const poseTarget = chronosHandPoseTarget;
  writeChronosTriangleHandPose(
    poseTarget,
    side,
    elapsedSeconds,
    movementBob,
    aegisPose
  );

  composeTransformMatrix(viewmodelArmMatrix, poseTarget.arm.position, poseTarget.arm.rotation);
  composeTransformMatrix(viewmodelWristMatrix, poseTarget.wrist.position, poseTarget.wrist.rotation);
  composeTransformMatrix(viewmodelPalmMatrix, poseTarget.palm.position, poseTarget.palm.rotation);

  const innerSide = -side;
  matrixPosition.set(
    innerSide * CHRONOS_WEAPON_SOCKET_INWARD_X,
    CHRONOS_WEAPON_SOCKET_Y,
    CHRONOS_WEAPON_SOCKET_Z
  );
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(viewmodelSocketMatrix, matrixPosition, matrixEuler);

  targetMatrix
    .copy(viewmodelArmMatrix)
    .multiply(viewmodelWristMatrix)
    .multiply(viewmodelPalmMatrix)
    .multiply(viewmodelSocketMatrix);

  return targetMatrix;
}

function composeChronosPrimaryOrbMatrix({
  camera,
  elapsedSeconds,
  actionBlend,
  targetingBlend,
  movementBob,
  aegisPose,
}: {
  camera: THREE.Camera;
  elapsedSeconds: number;
  actionBlend: number;
  targetingBlend: number;
  movementBob: ChronosMovementBobOffset;
  aegisPose: ChronosAegisPose;
}): THREE.Matrix4 {
  const rootTransform = viewmodelRootTransformScratch;
  writeViewmodelRootTransform(rootTransform, elapsedSeconds, actionBlend, targetingBlend);
  composeTransformMatrix(viewmodelRootMatrix, rootTransform.position, rootTransform.rotation);

  matrixPosition.copy(DEFAULT_VIEWMODEL_ROOT_OFFSET);
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(viewmodelOffsetMatrix, matrixPosition, matrixEuler);

  composeChronosWeaponSocketLocalMatrix({
    targetMatrix: chronosLeftSocketMatrix,
    side: -1,
    elapsedSeconds,
    movementBob,
    aegisPose,
  });
  chronosLeftSocketMatrix.decompose(chronosLeftSocketPosition, viewmodelWorldQuaternion, viewmodelWorldScale);

  composeChronosWeaponSocketLocalMatrix({
    targetMatrix: chronosRightSocketMatrix,
    side: 1,
    elapsedSeconds,
    movementBob,
    aegisPose,
  });
  chronosRightSocketMatrix.decompose(chronosRightSocketPosition, viewmodelWorldQuaternion, viewmodelWorldScale);

  const spread = aegisPose.spread;
  const shield = aegisPose.shield;
  const recoil = aegisPose.recoil;
  chronosWeaponPositionScratch
    .copy(chronosLeftSocketPosition)
    .add(chronosRightSocketPosition)
    .multiplyScalar(0.5);
  chronosWeaponPositionScratch.y += CHRONOS_WEAPON_BIND_LIFT_Y + 0.03 * spread - 0.034 * recoil;
  chronosWeaponPositionScratch.z += CHRONOS_WEAPON_BIND_FORWARD_Z - 0.105 * shield + 0.18 * recoil;
  chronosWeaponRotationScratch.set(
    Math.sin(elapsedSeconds * 0.74) * 0.024 + 0.12 * recoil,
    Math.sin(elapsedSeconds * 0.51) * 0.034,
    Math.sin(elapsedSeconds * 0.88) * 0.026 - 0.045 * recoil
  );
  composeTransformMatrix(chronosWeaponMatrix, chronosWeaponPositionScratch, chronosWeaponRotationScratch);

  chronosOrbPositionScratch.set(
    0,
    CHRONOS_WEAPON_ORB_BASE_Y + Math.sin(elapsedSeconds * 1.55 + 0.6) * CHRONOS_WEAPON_ORB_HOVER_Y,
    0.048
  );
  matrixEuler.set(0, 0, 0);
  composeTransformMatrix(chronosOrbMatrix, chronosOrbPositionScratch, matrixEuler);

  camera.updateMatrixWorld();
  chronosRootMatrix
    .copy(camera.matrixWorld)
    .multiply(viewmodelRootMatrix)
    .multiply(viewmodelOffsetMatrix);

  viewmodelWorldMatrix
    .copy(chronosRootMatrix)
    .multiply(chronosWeaponMatrix)
    .multiply(chronosOrbMatrix);

  return viewmodelWorldMatrix;
}

function sampleChronosPrimaryOrbSocket(
  context: ChronosPrimaryOrbPoseSampleContext,
  actionBlend: number,
  targetingBlend: number,
  movementBob: ChronosMovementBobOffset = CHRONOS_STILL_MOVEMENT_BOB,
  aegisPose: ChronosAegisPose = CHRONOS_AEGIS_IDLE_POSE
): ViewmodelSocketPoseDraft {
  const timestampMs = context.timestampMs ?? Date.now();
  const worldMatrix = composeChronosPrimaryOrbMatrix({
    camera: context.camera,
    elapsedSeconds: context.elapsedSeconds,
    actionBlend,
    targetingBlend,
    movementBob,
    aegisPose,
  });

  return writeViewmodelPoseDraftFromMatrix(
    viewmodelSocketPoseDraftScratch,
    viewmodelSocketPoseDraftScaleScratch,
    worldMatrix,
    timestampMs
  );
}

function ChronosPhantomForearm({
  side,
  materials,
  movementBobRef,
  aegisPoseRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  movementBobRef: MutableRefObject<ChronosMovementBobOffset>;
  aegisPoseRef: MutableRefObject<ChronosAegisPose>;
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
    writeChronosTriangleForearmPose(
      forearm,
      side,
      state.clock.elapsedTime,
      movementBobRef.current,
      aegisPoseRef.current
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
      <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[side * -0.024, thickness * 0.76, -0.104]} scale={[0.026, Math.max(0.012, thickness * 0.16), length * 0.34]} />
    </group>
  );
}

function ChronosTriangleHand({
  side,
  materials,
  movementBobRef,
  aegisPoseRef,
  weaponSocketRef,
}: {
  side: -1 | 1;
  materials: ViewmodelMaterialSet;
  movementBobRef: MutableRefObject<ChronosMovementBobOffset>;
  aegisPoseRef: MutableRefObject<ChronosAegisPose>;
  weaponSocketRef?: MutableRefObject<THREE.Group | null>;
}) {
  const armRef = useRef<THREE.Group>(null);
  const wristRef = useRef<THREE.Group>(null);
  const palmRef = useRef<THREE.Group>(null);
  const thumbRef = useRef<THREE.Group>(null);
  const fingerRefs = useRef<(THREE.Group | null)[]>([]);
  const innerSide = -side;

  useFrame((state) => {
    const arm = armRef.current;
    const wrist = wristRef.current;
    const palm = palmRef.current;
    const thumb = thumbRef.current;
    const fingers = resolveFingerTargets(fingerRefs.current);
    if (!arm || !wrist || !palm || !thumb || !fingers) return;

    writeChronosTriangleHandPose(
      {
        arm,
        wrist,
        palm,
        thumb,
        fingers,
      },
      side,
      state.clock.elapsedTime,
      movementBobRef.current,
      aegisPoseRef.current
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
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, -0.07, 0.088]} scale={[0.07, 0.062, 0.084]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.104, 0.142]} scale={[0.058, 0.044, 0.104]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.028, -0.094, 0.082]} scale={[0.016, 0.044, 0.058]} />

          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} scale={[0.108, 0.132, 0.054]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[side * 0.014, 0.002, 0.012]} scale={[0.088, 0.106, 0.038]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.accent} position={[side * -0.058, -0.004, -0.018]} scale={[0.018, 0.09, 0.03]} />
          <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[0, 0.012, -0.05]} scale={[0.06, 0.076, 0.014]} />
          <mesh geometry={SHARED_GEOMETRIES.ring16} material={materials.glow} position={[0, 0.006, -0.062]} scale={[0.062, 0.062, 1]} />
          <group
            ref={weaponSocketRef}
            position={[
              innerSide * CHRONOS_WEAPON_SOCKET_INWARD_X,
              CHRONOS_WEAPON_SOCKET_Y,
              CHRONOS_WEAPON_SOCKET_Z,
            ]}
          />

          {PHANTOM_OPEN_FINGER_SLOTS.map((slot, index) => {
            const segmentLength = 0.094;
            const fingerSpread = index - 1.5;
            const heldFingerSlot = fingerSpread * 0.034;
            const fanRotation = fingerSpread * 0.04;

            return (
              <group
                key={slot}
                ref={(node) => {
                  fingerRefs.current[index] = node;
                }}
                position={[heldFingerSlot, 0.056, -0.032]}
                rotation={[-0.05, innerSide * 0.012, -innerSide * 0.18 + fanRotation]}
              >
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, -0.006, 0.012]} scale={[0.028, 0.024, 0.024]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[0, segmentLength * 0.5, 0]} scale={[0.025, segmentLength, 0.024]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[0, segmentLength * 0.36, 0.006]} scale={[0.028, segmentLength * 0.42, 0.026]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[0, segmentLength * 0.5, -0.012]} scale={[0.013, segmentLength * 0.62, 0.011]} />
                <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, segmentLength + 0.014, -0.001]} scale={[0.023, 0.028, 0.024]} />
              </group>
            );
          })}

          <group
            ref={thumbRef}
            position={[innerSide * 0.064, -0.026, -0.032]}
            rotation={[0.035, innerSide * 0.05, innerSide * 0.48]}
          >
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[0, 0, 0.006]} scale={[0.026, 0.03, 0.022]} />
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[innerSide * 0.034, 0.002, 0]} scale={[0.066, 0.026, 0.024]} />
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.armor} position={[innerSide * 0.036, 0.008, 0.007]} scale={[0.048, 0.017, 0.024]} />
            <mesh geometry={SHARED_GEOMETRIES.box} material={materials.glow} position={[innerSide * 0.038, 0.004, -0.01]} scale={[0.04, 0.01, 0.01]} />
            <group position={[innerSide * 0.066, 0.006, 0]} rotation={[0, 0, innerSide * 0.04]}>
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.dark} position={[innerSide * 0.02, 0, 0]} scale={[0.04, 0.022, 0.023]} />
              <mesh geometry={SHARED_GEOMETRIES.box} material={materials.metal} position={[innerSide * 0.044, 0, -0.001]} scale={[0.02, 0.02, 0.022]} />
            </group>
          </group>

          <mesh
            geometry={SHARED_GEOMETRIES.box}
            material={materials.dark}
            position={[0, 0, 0.06]}
            scale={[0.076, 0.09, 0.032]}
          />
        </group>
      </group>
    </group>
  );
}

function ChronosFloatingPyramidWeapon({
  rootRef,
  leftSocketRef,
  rightSocketRef,
  aegisPoseRef,
}: {
  rootRef: MutableRefObject<THREE.Group | null>;
  leftSocketRef: MutableRefObject<THREE.Group | null>;
  rightSocketRef: MutableRefObject<THREE.Group | null>;
  aegisPoseRef: MutableRefObject<ChronosAegisPose>;
}) {
  const weaponRef = useRef<THREE.Group>(null);
  const pyramidRef = useRef<THREE.Group>(null);
  const orbRef = useRef<THREE.Group>(null);
  const orbLightRef = useRef<THREE.PointLight>(null);
  const reloadAuraPuffRefs = useRef<(THREE.Sprite | null)[]>([]);
  const reloadAuraMoteRefs = useRef<(THREE.Sprite | null)[]>([]);
  const primarySpinPhaseRef = useRef(0);
  const leftSocketWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const rightSocketWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const weaponWorldPosition = useMemo(() => new THREE.Vector3(), []);
  const weaponLocalPosition = useMemo(() => new THREE.Vector3(), []);
  const orbCoreIdleColor = useMemo(() => new THREE.Color(HERO_MATERIAL_COLORS.chronos.glow), []);
  const orbCoreHeldColor = useMemo(() => new THREE.Color(0xcaffdc), []);
  const orbGlowIdleColor = useMemo(() => new THREE.Color(HERO_MATERIAL_COLORS.chronos.accent), []);
  const orbGlowHeldColor = useMemo(() => new THREE.Color(0xa3ffc4), []);
  const pyramidFaceIdleColor = useMemo(() => new THREE.Color(0x123b2d), []);
  const pyramidFaceGlowColor = useMemo(() => new THREE.Color(0x3dff98), []);
  const pyramidWireIdleColor = useMemo(() => new THREE.Color(HERO_MATERIAL_COLORS.chronos.glow), []);
  const pyramidWireGlowColor = useMemo(() => new THREE.Color(0xcaffdc), []);
  const pyramidFaceMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: 0x123b2d,
    emissive: HERO_MATERIAL_COLORS.chronos.accent,
    emissiveIntensity: CHRONOS_WEAPON_PYRAMID_EMISSIVE_BASE_INTENSITY,
    transparent: true,
    opacity: CHRONOS_WEAPON_PYRAMID_FACE_BASE_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
    metalness: 0.12,
    roughness: 0.24,
    toneMapped: false,
  }), []);
  const pyramidWireMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: HERO_MATERIAL_COLORS.chronos.glow,
    wireframe: true,
    transparent: true,
    opacity: CHRONOS_WEAPON_PYRAMID_WIRE_BASE_OPACITY,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const orbCoreMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: HERO_MATERIAL_COLORS.chronos.glow,
    toneMapped: false,
  }), []);
  const orbGlowMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: HERO_MATERIAL_COLORS.chronos.accent,
    transparent: true,
    opacity: CHRONOS_WEAPON_ORB_GLOW_BASE_OPACITY,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const reloadAuraTexture = useMemo(createChronosReloadAuraTexture, []);
  const reloadAuraPuffMaterial = useMemo(
    () => createChronosReloadAuraMaterial(reloadAuraTexture, 0x32ff91),
    [reloadAuraTexture]
  );
  const reloadAuraMoteMaterial = useMemo(
    () => createChronosReloadAuraMaterial(reloadAuraTexture, 0xd6ffe5),
    [reloadAuraTexture]
  );

  useRegisteredViewmodelSocket(CHRONOS_PRIMARY_ORB_SOCKET_NAME, orbRef);

  useEffect(() => () => {
    reloadAuraPuffMaterial.dispose();
    reloadAuraMoteMaterial.dispose();
    reloadAuraTexture.dispose();
  }, [reloadAuraMoteMaterial, reloadAuraPuffMaterial, reloadAuraTexture]);

  useFrame((state, delta) => {
    const weapon = weaponRef.current;
    const root = rootRef.current;
    const leftSocket = leftSocketRef.current;
    const rightSocket = rightSocketRef.current;
    if (!weapon || !root || !leftSocket || !rightSocket) return;

    const t = state.clock.elapsedTime;
    const nowMs = Date.now();
    const aegisPose = aegisPoseRef.current;
    const aegisGlow = THREE.MathUtils.smoothstep(aegisPose.blend, 0, 1);
    const primaryHeldBlend = getChronosPrimaryHeldBlend(nowMs);
    const primaryShotGlow = getChronosPrimaryShotGlowBlend(nowMs);
    const {
      chronosPrimaryReloading,
      chronosPrimaryReloadStart,
      chronosPrimaryReloadEnd,
    } = useGameStore.getState();
    const reloadDuration = Math.max(
      1,
      chronosPrimaryReloadEnd - chronosPrimaryReloadStart || CHRONOS_PRIMARY_RELOAD_MS
    );
    const reloadProgress = chronosPrimaryReloading
      ? THREE.MathUtils.clamp((nowMs - chronosPrimaryReloadStart) / reloadDuration, 0, 1)
      : 0;
    const reloadIntensity = chronosPrimaryReloading
      ? THREE.MathUtils.smoothstep(reloadProgress, 0, 0.14) *
        (1 - THREE.MathUtils.smoothstep(reloadProgress, 0.86, 1))
      : 0;
    const reloadFlicker = 1 + Math.sin(t * 38.5) * 0.1 * reloadIntensity + Math.sin(t * 71.0) * 0.045 * reloadIntensity;
    const orbGlow = Math.max(
      aegisGlow,
      primaryHeldBlend * CHRONOS_WEAPON_ORB_PRIMARY_HOLD_GLOW,
      primaryShotGlow,
      reloadIntensity * 0.98
    );
    const glowFlicker = 1 + Math.sin(t * 12.5) * 0.055 * orbGlow;
    const spread = aegisPose.spread;
    const shield = aegisPose.shield;
    const recoil = aegisPose.recoil;
    const spinBoost = aegisPose.spinBoost;
    const heartbeat = aegisPose.heartbeat;
    // The sockets are descendants of root, so updating each socket's world matrix
    // (with its ancestor chain) refreshes root.matrixWorld too — enough for the
    // socket world reads and the root.worldToLocal below — without forcing a
    // recursive recompute of the entire viewmodel subtree every frame.
    leftSocket.updateWorldMatrix(true, false);
    rightSocket.updateWorldMatrix(true, false);
    leftSocket.getWorldPosition(leftSocketWorldPosition);
    rightSocket.getWorldPosition(rightSocketWorldPosition);
    weaponWorldPosition
      .copy(leftSocketWorldPosition)
      .add(rightSocketWorldPosition)
      .multiplyScalar(0.5);
    weaponLocalPosition.copy(weaponWorldPosition);
    root.worldToLocal(weaponLocalPosition);
    weaponLocalPosition.y += CHRONOS_WEAPON_BIND_LIFT_Y + 0.03 * spread - 0.034 * recoil;
    weaponLocalPosition.z += CHRONOS_WEAPON_BIND_FORWARD_Z - 0.105 * shield + 0.18 * recoil;
    weapon.position.copy(weaponLocalPosition);
    weapon.rotation.set(
      Math.sin(t * 0.74) * 0.024 + 0.12 * recoil,
      Math.sin(t * 0.51) * 0.034,
      Math.sin(t * 0.88) * 0.026 - 0.045 * recoil
    );

    if (pyramidRef.current) {
      const pyramidScale = 1 +
        CHRONOS_AEGIS_PYRAMID_GROWTH * spread +
        0.18 * shield +
        0.08 * recoil +
        CHRONOS_WEAPON_PYRAMID_HEARTBEAT_GROWTH * heartbeat +
        reloadIntensity * 0.12;
      primarySpinPhaseRef.current +=
        Math.min(delta, 0.05) * (
          CHRONOS_WEAPON_PYRAMID_PRIMARY_SPIN_BOOST * (primaryHeldBlend + recoil * 2.4 + spinBoost * 3.8) +
          CHRONOS_WEAPON_PYRAMID_RELOAD_SPIN_BOOST * reloadIntensity
        );
      pyramidRef.current.rotation.set(
        CHRONOS_WEAPON_PYRAMID_FORWARD_TILT_X - 0.08 * shield + Math.sin(t * 0.42) * 0.02 + 0.16 * recoil + 0.04 * reloadIntensity,
        Math.PI / 4 +
          t * (CHRONOS_WEAPON_PYRAMID_SPIN_SPEED + 0.5 * spread + 1.7 * spinBoost + 3.2 * reloadIntensity) +
          primarySpinPhaseRef.current,
        Math.sin(t * (0.5 + reloadIntensity * 2.2)) * (0.018 + reloadIntensity * 0.035)
      );
      pyramidRef.current.scale.setScalar(pyramidScale);
    }
    const pyramidGlow = Math.max(aegisGlow, spinBoost, heartbeat, reloadIntensity);
    const pyramidFaceMaxOpacity = CHRONOS_WEAPON_PYRAMID_FACE_GLOW_OPACITY + reloadIntensity * 0.18;
    pyramidFaceMaterial.opacity = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(
        CHRONOS_WEAPON_PYRAMID_FACE_BASE_OPACITY,
        pyramidFaceMaxOpacity,
        pyramidGlow
      ) * glowFlicker * reloadFlicker,
      0,
      pyramidFaceMaxOpacity
    );
    pyramidFaceMaterial.emissiveIntensity = THREE.MathUtils.lerp(
      CHRONOS_WEAPON_PYRAMID_EMISSIVE_BASE_INTENSITY,
      CHRONOS_WEAPON_PYRAMID_EMISSIVE_GLOW_INTENSITY + reloadIntensity * 1.15,
      pyramidGlow
    ) * glowFlicker * reloadFlicker;
    pyramidFaceMaterial.color
      .copy(pyramidFaceIdleColor)
      .lerp(pyramidFaceGlowColor, pyramidGlow * 0.76);
    pyramidFaceMaterial.emissive.copy(orbGlowIdleColor).lerp(orbGlowHeldColor, pyramidGlow);
    pyramidWireMaterial.opacity = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(
        CHRONOS_WEAPON_PYRAMID_WIRE_BASE_OPACITY,
        CHRONOS_WEAPON_PYRAMID_WIRE_GLOW_OPACITY,
        pyramidGlow
      ) * glowFlicker * reloadFlicker,
      0,
      CHRONOS_WEAPON_PYRAMID_WIRE_GLOW_OPACITY
    );
    pyramidWireMaterial.color.copy(pyramidWireIdleColor).lerp(pyramidWireGlowColor, pyramidGlow);

    if (orbRef.current) {
      orbRef.current.position.y =
        CHRONOS_WEAPON_ORB_BASE_Y + Math.sin(t * 1.55 + 0.6) * CHRONOS_WEAPON_ORB_HOVER_Y;
      orbRef.current.scale.setScalar(1);
    }
    orbGlowMaterial.opacity = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(
        CHRONOS_WEAPON_ORB_GLOW_BASE_OPACITY,
        CHRONOS_WEAPON_ORB_GLOW_HELD_OPACITY,
        orbGlow
      ) * glowFlicker,
      0,
      CHRONOS_WEAPON_ORB_GLOW_HELD_OPACITY
    );
    orbGlowMaterial.color.copy(orbGlowIdleColor).lerp(orbGlowHeldColor, orbGlow);
    orbCoreMaterial.color.copy(orbCoreIdleColor).lerp(orbCoreHeldColor, orbGlow * 0.88);
    if (orbLightRef.current) {
      orbLightRef.current.intensity = THREE.MathUtils.lerp(
        CHRONOS_WEAPON_ORB_LIGHT_BASE_INTENSITY,
        CHRONOS_WEAPON_ORB_LIGHT_HELD_INTENSITY,
        orbGlow
      ) + reloadIntensity * 0.48;
    }

    const reloadVisible = reloadIntensity > 0.02;
    // Guard the per-sprite work up front: when not reloading the shared aura
    // materials are forced to opacity 0 below, so the sprites are invisible
    // regardless of their .visible flag and the loops would be pure no-ops.
    if (reloadVisible) {
      const puffNodes = reloadAuraPuffRefs.current;
      for (let index = 0; index < puffNodes.length; index++) {
        const puffNode = puffNodes[index];
        if (!puffNode) continue;
        const puff = CHRONOS_WEAPON_RELOAD_AURA_PUFFS[index];
        if (!puff) continue;

        const localProgress = (reloadProgress * puff.speed + puff.offset) % 1;
        const easedProgress = THREE.MathUtils.smoothstep(localProgress, 0, 1);
        const puffAmount = reloadIntensity * Math.sin(localProgress * Math.PI);
        puffNode.visible = puffAmount > 0.035;
        if (!puffNode.visible) continue;

        const angle = puff.angle + puff.swirl * easedProgress + t * (0.18 + puff.speed * 0.06);
        const radius = THREE.MathUtils.lerp(puff.radius, 0.045, easedProgress);
        const scale = puff.size * THREE.MathUtils.lerp(0.14, 0.035, easedProgress) * (0.82 + puffAmount * 0.24);
        puffNode.position.set(
          Math.sin(angle) * radius,
          THREE.MathUtils.lerp(puff.y, 0, easedProgress) + Math.sin(t * 4.5 + index) * 0.008 * puffAmount,
          Math.cos(angle) * radius
        );
        puffNode.scale.set(scale, scale, 1);
      }

      const moteNodes = reloadAuraMoteRefs.current;
      for (let index = 0; index < moteNodes.length; index++) {
        const moteNode = moteNodes[index];
        if (!moteNode) continue;
        const mote = CHRONOS_WEAPON_RELOAD_AURA_MOTES[index];
        if (!mote) continue;

        const localProgress = (reloadProgress * mote.speed + mote.offset) % 1;
        const easedProgress = THREE.MathUtils.smoothstep(localProgress, 0, 1);
        const moteAmount = reloadIntensity * Math.sin(localProgress * Math.PI);
        moteNode.visible = moteAmount > 0.04;
        if (!moteNode.visible) continue;

        const angle = mote.angle + mote.drift * easedProgress + t * (0.58 + mote.speed * 0.18);
        const radius = THREE.MathUtils.lerp(mote.radius, 0.018, easedProgress);
        moteNode.position.set(
          Math.sin(angle) * radius,
          THREE.MathUtils.lerp(mote.y, 0, easedProgress) + Math.sin(t * 8 + index) * 0.01 * moteAmount,
          Math.cos(angle) * radius
        );
        const moteScale = mote.size * THREE.MathUtils.lerp(0.042, 0.012, easedProgress) * (0.78 + moteAmount * 0.28);
        moteNode.scale.set(moteScale, moteScale, 1);
      }
    }
    reloadAuraPuffMaterial.opacity = reloadVisible
      ? THREE.MathUtils.clamp(reloadIntensity * 0.42, 0, 0.42)
      : 0;
    reloadAuraMoteMaterial.opacity = reloadVisible
      ? THREE.MathUtils.clamp(reloadIntensity * 0.82, 0, 0.82)
      : 0;
  });

  return (
    <group
      ref={weaponRef}
      position={[
        CHRONOS_WEAPON_IDLE_POSITION.x,
        CHRONOS_WEAPON_IDLE_POSITION.y,
        CHRONOS_WEAPON_IDLE_POSITION.z,
      ]}
    >
      <group ref={pyramidRef} rotation={[0, Math.PI / 4, 0]}>
        <mesh
          geometry={SHARED_GEOMETRIES.cone4}
          material={pyramidFaceMaterial}
          scale={[0.135, 0.205, 0.135]}
        />
        <mesh
          geometry={SHARED_GEOMETRIES.cone4}
          material={pyramidWireMaterial}
          scale={[0.143, 0.213, 0.143]}
        />
      </group>

      {CHRONOS_WEAPON_RELOAD_AURA_PUFFS.map((puff, index) => (
        <sprite
          key={`chronos-reload-aura-puff-${puff.angle}`}
          ref={(node) => {
            reloadAuraPuffRefs.current[index] = node;
          }}
          material={reloadAuraPuffMaterial}
          visible={false}
          scale={[0.001, 0.001, 1]}
        />
      ))}

      {CHRONOS_WEAPON_RELOAD_AURA_MOTES.map((mote, index) => (
        <sprite
          key={`chronos-reload-aura-mote-${mote.angle}`}
          ref={(node) => {
            reloadAuraMoteRefs.current[index] = node;
          }}
          material={reloadAuraMoteMaterial}
          visible={false}
          scale={[0.001, 0.001, 1]}
        />
      ))}

      <group ref={orbRef} name={CHRONOS_PRIMARY_ORB_SOCKET_NAME} position={[0, CHRONOS_WEAPON_ORB_BASE_Y, 0.048]}>
        <mesh
          geometry={SHARED_GEOMETRIES.sphere16}
          material={orbGlowMaterial}
          scale={0.032}
        />
        <mesh
          geometry={SHARED_GEOMETRIES.sphere12}
          material={orbCoreMaterial}
          scale={0.022}
        />
        <BudgetedPointLight
          ref={orbLightRef}
          budgetPriority={0.18}
          color={HERO_MATERIAL_COLORS.chronos.glow}
          intensity={CHRONOS_WEAPON_ORB_LIGHT_BASE_INTENSITY}
          distance={0.72}
          decay={2}
        />
      </group>
    </group>
  );
}

function ChronosAegisViewmodelShield({
  aegisPoseRef,
}: {
  aegisPoseRef: MutableRefObject<ChronosAegisPose>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const braceRef = useRef<THREE.Group>(null);
  const crackRef = useRef<THREE.Group>(null);
  const fillGeometry = useMemo(
    () => createChronosAegisPanelGeometry(
      CHRONOS_AEGIS_VIEWMODEL_WIDTH,
      CHRONOS_AEGIS_VIEWMODEL_HEIGHT,
      0.2,
      -1
    ),
    []
  );
  const wireGeometry = useMemo(
    () => createChronosAegisPanelGeometry(
      CHRONOS_AEGIS_VIEWMODEL_WIDTH * 0.96,
      CHRONOS_AEGIS_VIEWMODEL_HEIGHT * 0.94,
      0.18,
      -1,
      6,
      5
    ),
    []
  );
  const fillMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: HERO_MATERIAL_COLORS.chronos.accent,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }), []);
  const edgeMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: HERO_MATERIAL_COLORS.chronos.glow,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  }), []);
  const wireMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: HERO_MATERIAL_COLORS.chronos.glow,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    wireframe: true,
    toneMapped: false,
  }), []);
  const crackMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: CHRONOS_AEGIS_CRACK_COLOR,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  }), []);
  const fillFreshColor = useMemo(() => new THREE.Color(HERO_MATERIAL_COLORS.chronos.accent), []);
  const fillDamagedColor = useMemo(() => new THREE.Color(CHRONOS_AEGIS_DAMAGE_FILL_COLOR), []);
  const edgeFreshColor = useMemo(() => new THREE.Color(HERO_MATERIAL_COLORS.chronos.glow), []);
  const edgeDamagedColor = useMemo(() => new THREE.Color(CHRONOS_AEGIS_DAMAGE_EDGE_COLOR), []);
  useEffect(() => () => {
    fillGeometry.dispose();
    wireGeometry.dispose();
    fillMaterial.dispose();
    edgeMaterial.dispose();
    wireMaterial.dispose();
    crackMaterial.dispose();
  }, [crackMaterial, edgeMaterial, fillGeometry, fillMaterial, wireGeometry, wireMaterial]);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;

    const shield = THREE.MathUtils.smoothstep(aegisPoseRef.current.shield, 0, 1);
    if (shield <= 0.01) {
      group.visible = false;
      return;
    }

    const t = state.clock.elapsedTime;
    const durability = THREE.MathUtils.clamp(aegisPoseRef.current.durabilityRatio, 0, 1);
    const damage = 1 - durability;
    const shieldScale = THREE.MathUtils.lerp(0.52, 0.98, shield);
    const opacityPulse = 0.92 + Math.sin(t * 5.8) * 0.08;
    group.visible = true;
    group.position.set(0, -0.2 + 0.018 * shield, CHRONOS_AEGIS_VIEWMODEL_SHIELD_Z - 0.2 * shield);
    group.rotation.set(
      Math.sin(t * 1.15) * 0.012,
      Math.sin(t * 0.8) * 0.018,
      Math.sin(t * 1.7) * 0.014
    );
    group.scale.set(shieldScale, shieldScale, 1);

    fillMaterial.color.copy(fillFreshColor).lerp(fillDamagedColor, damage * 0.74);
    edgeMaterial.color.copy(edgeFreshColor).lerp(edgeDamagedColor, damage * 0.86);
    wireMaterial.color.copy(edgeFreshColor).lerp(edgeDamagedColor, damage * 0.68);

    fillMaterial.opacity = (0.08 + durability * 0.1) * shield * opacityPulse;
    edgeMaterial.opacity = (0.28 + durability * 0.44) * shield;
    wireMaterial.opacity = (0.07 + durability * 0.17) * shield;

    if (fillRef.current) fillRef.current.scale.set(1, 1 + Math.sin(t * 4.1) * 0.006, 1);
    if (wireRef.current) wireRef.current.scale.setScalar(0.985 + Math.sin(t * 5.6) * (0.004 + damage * 0.014));
    if (braceRef.current) braceRef.current.position.z = -0.018 + Math.sin(t * 3.8) * (0.006 + damage * 0.018);
    if (crackRef.current) {
      const crackPulse = 0.76 + Math.sin(t * 13.2) * 0.18;
      crackMaterial.opacity = shield * THREE.MathUtils.smoothstep(damage, 0.08, 0.74) * crackPulse;
      crackRef.current.position.x = Math.sin(t * 19.5) * damage * 0.018;
      crackRef.current.position.y = Math.cos(t * 15.5) * damage * 0.012;
    }
  });

  const halfWidth = CHRONOS_AEGIS_VIEWMODEL_WIDTH * 0.5;
  const halfHeight = CHRONOS_AEGIS_VIEWMODEL_HEIGHT * 0.5;
  const edgeThickness = CHRONOS_AEGIS_VIEWMODEL_EDGE_THICKNESS;

  return (
    <group ref={groupRef} visible={false} frustumCulled={false} renderOrder={24}>
      <mesh ref={fillRef} geometry={fillGeometry} material={fillMaterial} frustumCulled={false} />
      <mesh ref={wireRef} geometry={wireGeometry} material={wireMaterial} frustumCulled={false} />
      <group ref={braceRef}>
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[0, halfHeight, 0.012]} scale={[CHRONOS_AEGIS_VIEWMODEL_WIDTH + edgeThickness * 1.8, edgeThickness, 0.024]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[0, -halfHeight, 0.012]} scale={[CHRONOS_AEGIS_VIEWMODEL_WIDTH + edgeThickness * 1.8, edgeThickness, 0.024]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[-halfWidth, 0, 0.012]} scale={[edgeThickness, CHRONOS_AEGIS_VIEWMODEL_HEIGHT + edgeThickness * 1.8, 0.024]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[halfWidth, 0, 0.012]} scale={[edgeThickness, CHRONOS_AEGIS_VIEWMODEL_HEIGHT + edgeThickness * 1.8, 0.024]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[-halfWidth, halfHeight, 0.018]} scale={[edgeThickness * 2.2, edgeThickness * 2.2, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[halfWidth, halfHeight, 0.018]} scale={[edgeThickness * 2.2, edgeThickness * 2.2, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[-halfWidth, -halfHeight, 0.018]} scale={[edgeThickness * 2.2, edgeThickness * 2.2, 0.03]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={edgeMaterial} position={[halfWidth, -halfHeight, 0.018]} scale={[edgeThickness * 2.2, edgeThickness * 2.2, 0.03]} frustumCulled={false} />
      </group>
      <group ref={crackRef} position={[0, 0, -0.03]}>
        <mesh geometry={SHARED_GEOMETRIES.box} material={crackMaterial} position={[-1.1, 0.42, 0]} rotation={[0, 0, -0.58]} scale={[0.022, 1.15, 0.016]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={crackMaterial} position={[0.72, -0.18, 0]} rotation={[0, 0, 0.72]} scale={[0.018, 0.9, 0.016]} frustumCulled={false} />
        <mesh geometry={SHARED_GEOMETRIES.box} material={crackMaterial} position={[1.48, 0.48, 0]} rotation={[0, 0, -0.32]} scale={[0.016, 0.7, 0.016]} frustumCulled={false} />
      </group>
    </group>
  );
}

function ChronosViewmodel({
  materials,
  locomotionRef,
  actionBlendRef,
  targetingBlendRef,
}: {
  materials: ViewmodelMaterialSet;
  locomotionRef: MutableRefObject<ViewmodelLocomotionPose>;
  actionBlendRef: MutableRefObject<number>;
  targetingBlendRef: MutableRefObject<number>;
}) {
  const { camera } = useThree();
  const rootRef = useRef<THREE.Group>(null);
  const leftWeaponSocketRef = useRef<THREE.Group>(null);
  const rightWeaponSocketRef = useRef<THREE.Group>(null);
  const bobRuntimeRef = useRef<ChronosMovementBobRuntime>(createChronosMovementBobRuntime());
  const movementBobRef = useRef<ChronosMovementBobOffset>({
    horizontalX: 0,
    verticalY: 0,
    slideBlend: 0,
  });
  const aegisPoseRef = useRef<ChronosAegisPose>({ ...CHRONOS_AEGIS_IDLE_POSE });

  useEffect(() => (
    registerViewmodelPoseSamplers([
      {
        socketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
        sampler: (context: ChronosPrimaryOrbPoseSampleContext) => sampleChronosPrimaryOrbSocket(
          context,
          actionBlendRef.current,
          targetingBlendRef.current,
          movementBobRef.current,
          aegisPoseRef.current
        ),
      },
    ])
  ), [actionBlendRef, targetingBlendRef]);

  useFrame((_, delta) => {
    const now = Date.now();
    const movementBob = updateChronosMovementBobRuntime(
      bobRuntimeRef.current,
      locomotionRef.current,
      camera,
      delta
    );
    movementBobRef.current.horizontalX = movementBob.horizontalX;
    movementBobRef.current.verticalY = movementBob.verticalY;
    movementBobRef.current.slideBlend = movementBob.slideBlend;

    const localPlayerId = useGameStore.getState().localPlayer?.id;
    const aegisVisualState = localPlayerId
      ? visualStore.getState().chronosAegisStates.get(localPlayerId)
      : null;
    const active = Boolean(
      aegisVisualState?.active &&
      now - aegisVisualState.updatedAtMs <= CHRONOS_AEGIS_VISUAL_STALE_MS
    );
    const aegisPose = aegisPoseRef.current;
    const frameDelta = Math.min(delta, CHRONOS_MOVEMENT_BOB_MAX_DELTA_SECONDS);
    aegisPose.aegisBlend = THREE.MathUtils.damp(
      aegisPose.aegisBlend,
      active ? 1 : 0,
      active ? CHRONOS_AEGIS_BLEND_IN_SPEED : CHRONOS_AEGIS_BLEND_OUT_SPEED,
      frameDelta
    );
    const aegisSpread = THREE.MathUtils.smoothstep(
      aegisPose.aegisBlend,
      CHRONOS_AEGIS_SPREAD_START,
      CHRONOS_AEGIS_SPREAD_END
    );
    const lifelinePose = getChronosLifelineConduitPose(now);
    const lifelineQueuedPose = getChronosLifelineQueuedPose(now);
    const timebreakPose = getChronosTimebreakPose(now);
    const ascendantPose = getChronosAscendantParadoxPose(now);

    aegisPose.active = active || lifelinePose.glow > 0.01 || lifelineQueuedPose.glow > 0.01 || timebreakPose.glow > 0.01;
    aegisPose.blend = Math.max(aegisPose.aegisBlend, lifelinePose.glow, lifelineQueuedPose.glow, timebreakPose.glow);
    aegisPose.spread = Math.max(aegisSpread, lifelinePose.spread, timebreakPose.spread);
    aegisPose.recoil = timebreakPose.recoil;
    aegisPose.shield = THREE.MathUtils.smoothstep(
      aegisPose.aegisBlend,
      CHRONOS_AEGIS_SHIELD_START,
      1
    );
    aegisPose.spinBoost = ascendantPose.spinBoost;
    aegisPose.heartbeat = lifelineQueuedPose.heartbeat;
    aegisPose.durabilityRatio = aegisVisualState?.durabilityRatio ?? 1;
  });

  return (
    <group
      ref={rootRef}
      position={[
        DEFAULT_VIEWMODEL_ROOT_OFFSET.x,
        DEFAULT_VIEWMODEL_ROOT_OFFSET.y,
        DEFAULT_VIEWMODEL_ROOT_OFFSET.z,
      ]}
    >
      <ChronosPhantomForearm
        side={-1}
        materials={materials}
        movementBobRef={movementBobRef}
        aegisPoseRef={aegisPoseRef}
      />
      <ChronosPhantomForearm
        side={1}
        materials={materials}
        movementBobRef={movementBobRef}
        aegisPoseRef={aegisPoseRef}
      />
      <ChronosTriangleHand
        side={-1}
        materials={materials}
        movementBobRef={movementBobRef}
        aegisPoseRef={aegisPoseRef}
        weaponSocketRef={leftWeaponSocketRef}
      />
      <ChronosTriangleHand
        side={1}
        materials={materials}
        movementBobRef={movementBobRef}
        aegisPoseRef={aegisPoseRef}
        weaponSocketRef={rightWeaponSocketRef}
      />
      <ChronosFloatingPyramidWeapon
        rootRef={rootRef}
        leftSocketRef={leftWeaponSocketRef}
        rightSocketRef={rightWeaponSocketRef}
        aegisPoseRef={aegisPoseRef}
      />
      <ChronosAegisViewmodelShield aegisPoseRef={aegisPoseRef} />
    </group>
  );
}

const HeroViewmodelInner = memo(function HeroViewmodelInner({ heroId, skinId, action, config }: HeroViewmodelProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const rootRef = useRef<THREE.Group>(null);
  const actionBlendRef = useRef(action.active ? 1 : 0);
  const targetingBlendRef = useRef(action.targeting ? 1 : 0);
  const phantomPrimaryAttackRef = useRef<PhantomPrimaryAttackState | null>(null);
  const phantomVoidRayReleaseRef = useRef<PhantomVoidRayReleaseState | null>(null);
  const hookshotPrimaryFireRef = useRef<HookshotPrimaryFireState | null>(null);
  const hookshotSecondaryFireRef = useRef<HookshotSecondaryFireState | null>(null);
  const viewmodelLocomotionRef = useRef<ViewmodelLocomotionRuntime>(createViewmodelLocomotionRuntime());
  const processedPhantomPrimaryEventIdRef = useRef<string | null>(null);
  const processedPhantomVoidRayEventIdRef = useRef<string | null>(null);
  const processedHookshotPrimaryEventIdRef = useRef<string | null>(null);
  const processedHookshotSecondaryEventIdRef = useRef<string | null>(null);
  const phantomCloakOpacityRef = useRef(1);
  const materials = useMemo(() => getViewmodelMaterialsForSkin(heroId, skinId), [heroId, skinId]);

  useEffect(() => {
    const accentBase = config.allowDecorativeGlows ? 0.34 : 0.12;
    const glassBase = config.allowDecorativeGlows ? 0.26 : 0.06;
    materials.accent.emissiveIntensity = accentBase;
    materials.glass.emissiveIntensity = glassBase;
    materials.glow.opacity = config.allowDecorativeGlows ? 1 : 0.62;
  }, [config.allowDecorativeGlows, materials]);

  useEffect(() => () => {
    const glowOpacity = config.allowDecorativeGlows ? 1 : 0.62;
    for (const [token, material] of Object.entries(materials)) {
      material.opacity = token === 'glow' ? glowOpacity : 1;
      material.transparent = token === 'glow';
      material.depthWrite = true;
      material.needsUpdate = true;
    }
  }, [config.allowDecorativeGlows, materials]);

  useEffect(() => {
    if (heroId !== 'phantom') return undefined;

    return registerViewmodelPoseSamplers([
      {
        socketName: PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1],
        sampler: (context: PhantomPrimaryPoseSampleContext) => samplePhantomPrimaryPalmSocket(
          context,
          -1,
          actionBlendRef.current,
          targetingBlendRef.current,
          viewmodelLocomotionRef.current
        ),
      },
      {
        socketName: PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1],
        sampler: (context: PhantomPrimaryPoseSampleContext) => samplePhantomPrimaryPalmSocket(
          context,
          1,
          actionBlendRef.current,
          targetingBlendRef.current,
          viewmodelLocomotionRef.current
        ),
      },
      {
        socketName: PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
        sampler: (context: PhantomVoidRayOrbPoseSampleContext) => samplePhantomVoidRayOrbSocket(
          context,
          actionBlendRef.current,
          targetingBlendRef.current
        ),
      },
    ]);
  }, [heroId]);

  useEffect(() => {
    if (heroId !== 'blaze') return undefined;

    return registerViewmodelPoseSamplers([
      {
        socketName: BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
        sampler: (context: BlazeRocketStaffPoseSampleContext) => sampleBlazeRocketStaffTipSocket(
          context,
          actionBlendRef.current,
          targetingBlendRef.current,
          viewmodelLocomotionRef.current
        ),
      },
    ]);
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

    updateViewmodelLocomotionRuntime(viewmodelLocomotionRef.current, camera, delta, heroId);

    if (heroId === 'phantom') {
      const store = useGameStore.getState();
      const nowMs = Date.now();
      const decoyAbility = store.localPlayer?.abilities?.phantom_umbral_decoy;
      const cloakTargetOpacity = isPhantomUmbralDecoyCloaked(decoyAbility, nowMs) ? 0.34 : 1;
      phantomCloakOpacityRef.current = THREE.MathUtils.damp(
        phantomCloakOpacityRef.current,
        cloakTargetOpacity,
        cloakTargetOpacity < 1 ? 14 : 9,
        delta,
      );
      const glowOpacity = config.allowDecorativeGlows ? 1 : 0.62;
      for (const [token, material] of Object.entries(materials)) {
        const nextOpacity = (token === 'glow' ? glowOpacity : 1) * phantomCloakOpacityRef.current;
        const shouldBeTransparent = token === 'glow' || phantomCloakOpacityRef.current < 0.999;
        material.opacity = nextOpacity;
        if (material.transparent !== shouldBeTransparent) {
          material.transparent = shouldBeTransparent;
          material.needsUpdate = true;
        }
        material.depthWrite = phantomCloakOpacityRef.current >= 0.999;
      }
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

        for (let index = store.riftBolts.length - 1; index >= 0; index--) {
          const bolt = store.riftBolts[index];
          if (bolt.ownerId !== localPlayerId) continue;

          if (processedPhantomVoidRayEventIdRef.current !== bolt.id) {
            processedPhantomVoidRayEventIdRef.current = bolt.id;
            phantomVoidRayReleaseRef.current = {
              eventId: bolt.id,
              startTimeMs: bolt.startTime - PHANTOM_PRIMARY_FIRE_POSE_TIME_SECONDS * 1000,
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

        let latestSecondaryEvent: { id: string; startTime: number } | null = null;

        for (let index = store.dragHooks.length - 1; index >= 0; index--) {
          const hook = store.dragHooks[index];
          if (hook.ownerId !== localPlayerId) continue;

          latestSecondaryEvent = { id: hook.id, startTime: hook.startTime };
          break;
        }

        for (let index = store.grappleLines.length - 1; index >= 0; index--) {
          const line = store.grappleLines[index];
          if (line.ownerId !== localPlayerId) continue;
          if (line.state === 'done') continue;

          if (!latestSecondaryEvent || line.startTime > latestSecondaryEvent.startTime) {
            latestSecondaryEvent = { id: line.id, startTime: line.startTime };
          }
          break;
        }

        if (
          latestSecondaryEvent &&
          processedHookshotSecondaryEventIdRef.current !== latestSecondaryEvent.id
        ) {
          processedHookshotSecondaryEventIdRef.current = latestSecondaryEvent.id;
          hookshotSecondaryFireRef.current = {
            eventId: latestSecondaryEvent.id,
            startTimeMs: latestSecondaryEvent.startTime,
          };
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
            skinId={skinId}
            primaryAttackRef={phantomPrimaryAttackRef}
            voidRayReleaseRef={phantomVoidRayReleaseRef}
            locomotionRef={viewmodelLocomotionRef}
          />
        )}
        {heroId === 'hookshot' && (
          <HookshotViewmodel
            materials={materials}
            primaryFireRef={hookshotPrimaryFireRef}
            secondaryFireRef={hookshotSecondaryFireRef}
            locomotionRef={viewmodelLocomotionRef}
          />
        )}
        {heroId === 'blaze' && (
          <BlazeViewmodel
            materials={materials}
            locomotionRef={viewmodelLocomotionRef}
          />
        )}
        {heroId === 'chronos' && (
          <ChronosViewmodel
            materials={materials}
            locomotionRef={viewmodelLocomotionRef}
            actionBlendRef={actionBlendRef}
            targetingBlendRef={targetingBlendRef}
          />
        )}
        <ViewmodelBurnOverlay />
      </group>
    </group>
  );
});

export function HeroViewmodel({ config }: { config: ViewmodelQualityConfig }) {
  const {
    heroId,
    skinId,
    playerState,
    gamePhase,
    actionActive,
    actionCharging,
    actionTargeting,
    matchPerspective,
  } = useGameStore(
    useShallow(state => {
      const currentHeroId = state.localPlayer?.heroId ?? null;
      const viewmodelHeroId = isViewmodelHero(currentHeroId) ? currentHeroId : null;
      const localPlayerId = state.localPlayer?.id;

      return {
        heroId: viewmodelHeroId,
        skinId: state.localPlayer?.skinId ?? null,
        playerState: state.localPlayer?.state ?? 'dead',
        gamePhase: state.gamePhase,
        matchPerspective: state.matchPerspective,
        actionActive: isViewmodelActionActive(viewmodelHeroId, state, localPlayerId),
        actionCharging: viewmodelHeroId === 'phantom' && state.voidRayCharging,
        actionTargeting: Boolean(
          viewmodelHeroId &&
          viewmodelHeroId === 'blaze' &&
          state.bombTargeting
        ),
      };
    })
  );

  const isPlaying = gamePhase === 'playing' || gamePhase === 'countdown' || gamePhase === 'deployment';
  if (!heroId || !isPlaying || playerState !== 'alive' || matchPerspective === 'third_person') return null;

  return (
    <HeroViewmodelInner
      key={`${heroId}:${skinId ?? 'default'}`}
      heroId={heroId}
      skinId={skinId}
      config={config}
      action={{
        active: actionActive,
        charging: actionCharging,
        targeting: actionTargeting,
      }}
    />
  );
}
