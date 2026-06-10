import { memo, useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { HeroId, Team } from '@voxel-strike/shared';
import { BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME } from '../../viewmodel/blazePose';
import { CHRONOS_PRIMARY_ORB_SOCKET_NAME } from '../../viewmodel/chronosPose';
import { HOOKSHOT_HOOK_SOCKET_NAMES } from '../../viewmodel/hookshotPose';
import {
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
} from '../../viewmodel/phantomPrimaryPose';
import { registerRemoteModelSocket } from '../../viewmodel/remoteModelSocketRegistry';

type PartKind = 'box' | 'sphere' | 'cylinder' | 'cone';
type MaterialKind = 'armor' | 'dark' | 'accent' | 'glow' | 'glass' | 'skin' | 'void' | 'edge' | 'eye' | 'mist';
type HeroBoneName =
  | 'aura'
  | 'hips'
  | 'torso'
  | 'head'
  | 'leftLeg'
  | 'rightLeg'
  | 'leftKnee'
  | 'rightKnee'
  | 'leftShin'
  | 'rightShin'
  | 'leftArm'
  | 'rightArm'
  | 'leftForearm'
  | 'rightForearm';
type HeroBoneOverride = HeroBoneName | 'static';

export type HeroAnimationMode = 'idle' | 'walk' | 'jump' | 'crouch' | 'crouchWalk' | 'crouchWalkLoop' | 'run' | 'slide' | 'attack';

export type HeroMovementPose = 'walk' | 'crouchWalk' | 'run';

export interface HeroWalkDirection {
  forward: number;
  right: number;
}

interface VoxelPart {
  kind?: PartKind;
  material: MaterialKind;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  emissive?: boolean;
  transparent?: boolean;
  limb?: HeroBoneOverride;
}

interface HeroVoxelBodyProps {
  heroId: HeroId | null;
  team: Team;
  height: number;
  isBot?: boolean;
  isMoving?: boolean;
  isMovingRef?: MutableRefObject<boolean>;
  isJumping?: boolean;
  isJumpingRef?: MutableRefObject<boolean>;
  isCrouching?: boolean;
  isCrouchingRef?: MutableRefObject<boolean>;
  isSliding?: boolean;
  isSlidingRef?: MutableRefObject<boolean>;
  isAttacking?: boolean;
  isAttackingRef?: MutableRefObject<boolean>;
  attackStartedAtMs?: number | null;
  attackStartedAtMsRef?: MutableRefObject<number | null>;
  attackSide?: -1 | 1;
  attackSideRef?: MutableRefObject<-1 | 1>;
  movementPose?: HeroMovementPose;
  movementPoseRef?: MutableRefObject<HeroMovementPose>;
  walkDirection?: HeroWalkDirection;
  walkDirectionRef?: MutableRefObject<HeroWalkDirection>;
  hasFlag?: boolean;
  postureScaleY?: number;
  postureScaleYRef?: MutableRefObject<number>;
  idleIntensity?: number;
  showTeamAccents?: boolean;
  castShadow?: boolean;
  socketOwnerId?: string;
}

interface RiggedVoxelPart<TPart extends VoxelPart = VoxelPart> {
  part: TPart;
  bone: HeroBoneName;
  meshOffset: [number, number, number];
}

interface TeamAccentPart extends VoxelPart {
  emissiveIntensity: number;
  roughness: number;
  metalness: number;
  opacity?: number;
  toneMapped?: boolean;
  depthWrite?: boolean;
}

interface RemoteBodySocketMarker {
  socketName: string;
  bone: HeroBoneName;
  position: [number, number, number];
}

const TEAM_COLORS: Record<Team, string> = {
  red: '#ef4444',
  blue: '#06b6d4',
};

const HERO_COLORS: Record<HeroId, Record<MaterialKind, string>> = {
  phantom: {
    armor: '#302447',
    dark: '#090612',
    accent: '#7c3aed',
    glow: '#c084fc',
    glass: '#251a3a',
    skin: '#22162c',
    void: '#020106',
    edge: '#5b4a7c',
    eye: '#f4d7ff',
    mist: '#9f67ff',
  },
  hookshot: {
    armor: '#1f3b4a',
    dark: '#10242e',
    accent: '#14b8a6',
    glow: '#67e8f9',
    glass: '#22d3ee',
    skin: '#20313a',
    void: '#07151c',
    edge: '#2f6474',
    eye: '#d7ffff',
    mist: '#38e4ff',
  },
  blaze: {
    armor: '#7c2d12',
    dark: '#1f130d',
    accent: '#f97316',
    glow: '#facc15',
    glass: '#fb923c',
    skin: '#3a2118',
    void: '#160804',
    edge: '#b5531b',
    eye: '#fff0b0',
    mist: '#ff8f3d',
  },
  chronos: {
    armor: '#123c2a',
    dark: '#07120f',
    accent: '#dc2626',
    glow: '#22c55e',
    glass: '#34d399',
    skin: '#1d3327',
    void: '#050a08',
    edge: '#7f1d1d',
    eye: '#bbf7d0',
    mist: '#16a34a',
  },
};

function createPhantomBlazeArmParts(side: -1 | 1): VoxelPart[] {
  const upperLimb: HeroBoneName = side < 0 ? 'leftArm' : 'rightArm';
  const lowerLimb: HeroBoneName = side < 0 ? 'leftForearm' : 'rightForearm';

  return [
    {
      material: 'dark',
      position: [side * 0.43, 1.1, 0],
      scale: [0.13, 0.42, 0.16],
      limb: upperLimb,
    },
    {
      material: 'edge',
      position: [side * 0.43, 0.88, -0.03],
      scale: [0.16, 0.12, 0.15],
      limb: lowerLimb,
    },
    {
      material: 'armor',
      position: [side * 0.43, 0.88, -0.18],
      scale: [0.13, 0.1, 0.18],
      limb: lowerLimb,
    },
    {
      material: 'edge',
      position: [side * 0.43, 0.88, -0.32],
      scale: [0.13, 0.13, 0.12],
      limb: lowerLimb,
    },
    {
      material: 'glow',
      position: [side * 0.43, 0.77, -0.36],
      scale: [0.05, 0.055, 0.032],
      emissive: true,
      limb: lowerLimb,
    },
  ];
}

const PHANTOM_PARTS: VoxelPart[] = [
  { material: 'mist', kind: 'cylinder', position: [0, 0.015, 0], scale: [0.5, 0.024, 0.5], transparent: true },
  { material: 'void', position: [-0.14, 0.36, 0], scale: [0.14, 0.64, 0.17] },
  { material: 'void', position: [0.14, 0.36, 0], scale: [0.14, 0.64, 0.17] },
  { material: 'edge', position: [-0.15, 0.055, -0.04], scale: [0.21, 0.09, 0.24] },
  { material: 'edge', position: [0.15, 0.055, -0.04], scale: [0.21, 0.09, 0.24] },
  { material: 'glow', position: [-0.14, 0.14, -0.17], scale: [0.07, 0.06, 0.032], emissive: true },
  { material: 'glow', position: [0.14, 0.14, -0.17], scale: [0.07, 0.06, 0.032], emissive: true },
  { material: 'dark', position: [0, 1.06, 0], scale: [0.42, 0.56, 0.29] },
  { material: 'armor', position: [0, 1.18, -0.17], scale: [0.44, 0.42, 0.06] },
  { material: 'accent', position: [0, 1.14, -0.225], scale: [0.07, 0.28, 0.034], emissive: true },
  { material: 'glow', position: [-0.12, 1.19, -0.235], scale: [0.08, 0.04, 0.032], emissive: true },
  { material: 'glow', position: [0.12, 1.19, -0.235], scale: [0.08, 0.04, 0.032], emissive: true },
  { material: 'glow', position: [0, 1.0, -0.235], scale: [0.14, 0.06, 0.032], emissive: true },
  { material: 'void', position: [0, 0.72, -0.09], scale: [0.34, 0.22, 0.18] },
  { material: 'edge', position: [0, 0.82, -0.19], scale: [0.42, 0.08, 0.04] },
  { material: 'dark', position: [0, 0.93, 0.2], scale: [0.34, 0.56, 0.08] },
  { material: 'armor', position: [-0.2, 0.9, 0.19], scale: [0.08, 0.48, 0.08] },
  { material: 'armor', position: [0.2, 0.9, 0.19], scale: [0.08, 0.48, 0.08] },
  { material: 'edge', position: [0, 0.66, 0.18], scale: [0.3, 0.12, 0.08] },
  { material: 'edge', position: [0, 1.39, -0.01], scale: [0.56, 0.13, 0.38] },
  { material: 'armor', position: [-0.31, 1.31, -0.01], scale: [0.15, 0.19, 0.27] },
  { material: 'armor', position: [0.31, 1.31, -0.01], scale: [0.15, 0.19, 0.27] },
  ...createPhantomBlazeArmParts(-1),
  ...createPhantomBlazeArmParts(1),
  { material: 'void', position: [0, 1.64, 0.01], scale: [0.34, 0.3, 0.3] },
  { material: 'dark', position: [0, 1.64, -0.18], scale: [0.3, 0.18, 0.044] },
  { material: 'eye', position: [-0.09, 1.68, -0.215], scale: [0.07, 0.038, 0.032], emissive: true },
  { material: 'eye', position: [0.09, 1.68, -0.215], scale: [0.07, 0.038, 0.032], emissive: true },
  { material: 'armor', position: [0, 1.8, -0.06], scale: [0.46, 0.14, 0.36] },
  { material: 'edge', position: [0, 1.74, -0.2], scale: [0.38, 0.06, 0.07] },
  { material: 'armor', position: [-0.12, 1.89, -0.05], scale: [0.22, 0.13, 0.36] },
  { material: 'edge', position: [0.18, 1.86, -0.02], scale: [0.24, 0.11, 0.32] },
  { material: 'armor', position: [0, 1.66, 0.18], scale: [0.32, 0.22, 0.09] },
];

const HOOKSHOT_PARTS: VoxelPart[] = [
  { material: 'mist', kind: 'cylinder', position: [0, 0.016, 0], scale: [0.54, 0.024, 0.54], transparent: true },
  { material: 'dark', position: [-0.18, 0.36, 0], scale: [0.16, 0.62, 0.17] },
  { material: 'dark', position: [0.18, 0.36, 0], scale: [0.16, 0.62, 0.17] },
  { material: 'armor', position: [-0.19, 0.11, -0.04], scale: [0.24, 0.13, 0.24] },
  { material: 'armor', position: [0.19, 0.11, -0.04], scale: [0.24, 0.13, 0.24] },
  { material: 'edge', position: [-0.19, 0.49, -0.15], scale: [0.18, 0.08, 0.04] },
  { material: 'edge', position: [0.19, 0.49, -0.15], scale: [0.18, 0.08, 0.04] },
  { material: 'glow', position: [-0.2, 0.16, -0.18], scale: [0.07, 0.055, 0.034], emissive: true },
  { material: 'glow', position: [0.2, 0.16, -0.18], scale: [0.07, 0.055, 0.034], emissive: true },

  { material: 'dark', position: [0, 0.76, 0.02], scale: [0.42, 0.28, 0.28] },
  { material: 'edge', position: [0, 0.68, -0.15], scale: [0.46, 0.08, 0.052] },
  { material: 'armor', position: [0, 1.06, 0], scale: [0.5, 0.58, 0.32] },
  { material: 'dark', position: [0, 1.14, -0.18], scale: [0.34, 0.36, 0.064] },
  { material: 'accent', position: [0, 1.18, -0.23], scale: [0.12, 0.24, 0.038], emissive: true },
  { material: 'glow', position: [-0.12, 1.23, -0.238], scale: [0.08, 0.045, 0.034], emissive: true },
  { material: 'glow', position: [0.12, 1.23, -0.238], scale: [0.08, 0.045, 0.034], emissive: true },
  { material: 'edge', position: [-0.14, 1.05, -0.225], scale: [0.065, 0.44, 0.034], rotation: [0, 0, -0.52] },
  { material: 'edge', position: [0.14, 1.05, -0.225], scale: [0.065, 0.44, 0.034], rotation: [0, 0, 0.52] },
  { material: 'void', position: [0, 0.91, 0.2], scale: [0.34, 0.5, 0.09] },

  { material: 'edge', position: [0, 1.43, -0.01], scale: [0.58, 0.12, 0.38] },
  { material: 'armor', position: [-0.36, 1.32, -0.01], scale: [0.24, 0.22, 0.31], limb: 'static' },
  { material: 'armor', position: [0.36, 1.32, -0.01], scale: [0.24, 0.22, 0.31], limb: 'static' },
  { material: 'dark', position: [-0.43, 1.02, 0], scale: [0.13, 0.4, 0.16] },
  { material: 'dark', position: [0.44, 1.02, 0], scale: [0.14, 0.4, 0.16] },
  { material: 'edge', position: [-0.5, 0.82, -0.06], scale: [0.18, 0.34, 0.16], limb: 'leftForearm' },
  { material: 'accent', position: [-0.57, 0.83, -0.2], scale: [0.15, 0.22, 0.056], emissive: true, limb: 'leftForearm' },
  { material: 'dark', position: [-0.6, 0.84, -0.34], scale: [0.18, 0.17, 0.18], limb: 'leftForearm' },
  { material: 'edge', position: [-0.6, 0.84, -0.49], scale: [0.13, 0.13, 0.15], limb: 'leftForearm' },
  { material: 'glow', position: [-0.6, 0.84, -0.585], scale: [0.074, 0.074, 0.04], emissive: true, limb: 'leftForearm' },
  { material: 'edge', kind: 'cylinder', position: [-0.6, 0.7, -0.42], scale: [0.024, 0.34, 0.024], rotation: [Math.PI / 2, 0, 0], limb: 'leftForearm' },
  { material: 'glow', position: [-0.6, 0.7, -0.66], scale: [0.048, 0.056, 0.048], emissive: true, limb: 'leftForearm' },
  { material: 'glow', position: [-0.68, 0.7, -0.72], scale: [0.038, 0.044, 0.115], rotation: [0, 0.42, 0], emissive: true, limb: 'leftForearm' },
  { material: 'glow', position: [-0.52, 0.7, -0.72], scale: [0.038, 0.044, 0.115], rotation: [0, -0.42, 0], emissive: true, limb: 'leftForearm' },
  { material: 'edge', position: [0.5, 0.83, -0.06], scale: [0.18, 0.36, 0.16], limb: 'rightForearm' },
  { material: 'accent', position: [0.57, 0.84, -0.2], scale: [0.16, 0.25, 0.056], emissive: true, limb: 'rightForearm' },
  { material: 'dark', position: [0.6, 0.86, -0.34], scale: [0.19, 0.18, 0.18], limb: 'rightForearm' },
  { material: 'edge', position: [0.6, 0.86, -0.49], scale: [0.14, 0.14, 0.16], limb: 'rightForearm' },
  { material: 'glow', position: [0.6, 0.86, -0.585], scale: [0.082, 0.082, 0.042], emissive: true, limb: 'rightForearm' },
  { material: 'edge', kind: 'cylinder', position: [0.6, 0.73, -0.42], scale: [0.024, 0.38, 0.024], rotation: [Math.PI / 2, 0, 0], limb: 'rightForearm' },
  { material: 'glow', position: [0.6, 0.73, -0.66], scale: [0.05, 0.06, 0.05], emissive: true, limb: 'rightForearm' },
  { material: 'glow', position: [0.52, 0.73, -0.72], scale: [0.04, 0.045, 0.12], rotation: [0, 0.42, 0], emissive: true, limb: 'rightForearm' },
  { material: 'glow', position: [0.68, 0.73, -0.72], scale: [0.04, 0.045, 0.12], rotation: [0, -0.42, 0], emissive: true, limb: 'rightForearm' },

  { material: 'void', position: [0, 1.64, 0.01], scale: [0.34, 0.29, 0.31] },
  { material: 'armor', position: [0, 1.77, -0.03], scale: [0.44, 0.18, 0.34] },
  { material: 'dark', position: [0, 1.62, -0.18], scale: [0.34, 0.16, 0.052] },
  { material: 'eye', position: [0, 1.65, -0.22], scale: [0.25, 0.05, 0.034], emissive: true },
  { material: 'glow', position: [-0.15, 1.65, -0.232], scale: [0.055, 0.032, 0.028], emissive: true },
  { material: 'glow', position: [0.15, 1.65, -0.232], scale: [0.055, 0.032, 0.028], emissive: true },
  { material: 'edge', position: [0, 1.54, -0.2], scale: [0.28, 0.06, 0.05] },
  { material: 'armor', position: [-0.25, 1.62, 0.02], scale: [0.08, 0.22, 0.24] },
  { material: 'armor', position: [0.25, 1.62, 0.02], scale: [0.08, 0.22, 0.24] },
  { material: 'edge', position: [0.24, 1.86, 0.02], scale: [0.16, 0.09, 0.2], rotation: [0, 0, -0.34] },
];

const BLAZE_PARTS: VoxelPart[] = [
  { material: 'mist', kind: 'cylinder', position: [0, 0.014, 0], scale: [0.48, 0.022, 0.48], transparent: true },
  { material: 'dark', position: [-0.16, 0.38, 0.02], scale: [0.15, 0.66, 0.17] },
  { material: 'dark', position: [0.16, 0.38, 0.02], scale: [0.15, 0.66, 0.17] },
  { material: 'armor', position: [-0.17, 0.5, -0.08], scale: [0.16, 0.32, 0.15] },
  { material: 'armor', position: [0.17, 0.5, -0.08], scale: [0.16, 0.32, 0.15] },
  { material: 'edge', position: [-0.17, 0.13, -0.04], scale: [0.21, 0.11, 0.24] },
  { material: 'edge', position: [0.17, 0.13, -0.04], scale: [0.21, 0.11, 0.24] },
  { material: 'glow', position: [-0.17, 0.08, 0.12], scale: [0.07, 0.05, 0.065], emissive: true },
  { material: 'glow', position: [0.17, 0.08, 0.12], scale: [0.07, 0.05, 0.065], emissive: true },
  { material: 'glow', position: [-0.17, 0.16, -0.18], scale: [0.08, 0.048, 0.032], emissive: true },
  { material: 'glow', position: [0.17, 0.16, -0.18], scale: [0.08, 0.048, 0.032], emissive: true },

  { material: 'dark', position: [0, 0.77, 0.02], scale: [0.36, 0.22, 0.26] },
  { material: 'edge', position: [0, 0.66, -0.15], scale: [0.43, 0.08, 0.05] },
  { material: 'edge', position: [0, 0.74, 0.18], scale: [0.3, 0.1, 0.07] },
  { material: 'armor', position: [0, 1.08, 0], scale: [0.46, 0.6, 0.31] },
  { material: 'dark', position: [0, 1.14, -0.18], scale: [0.32, 0.38, 0.06] },
  { material: 'edge', position: [0, 1.35, -0.195], scale: [0.42, 0.068, 0.048] },
  { material: 'edge', position: [0, 0.9, -0.2], scale: [0.36, 0.068, 0.048] },
  { material: 'glow', position: [0, 1.15, -0.235], scale: [0.13, 0.23, 0.034], emissive: true },
  { material: 'glow', position: [-0.13, 1.18, -0.24], scale: [0.06, 0.046, 0.032], emissive: true },
  { material: 'glow', position: [0.13, 1.18, -0.24], scale: [0.06, 0.046, 0.032], emissive: true },
  { material: 'accent', position: [0, 1.02, -0.245], scale: [0.24, 0.05, 0.032], emissive: true },
  { material: 'void', position: [0, 0.96, 0.2], scale: [0.28, 0.44, 0.09] },
  { material: 'edge', position: [-0.22, 1.06, 0.19], scale: [0.06, 0.4, 0.07] },
  { material: 'edge', position: [0.22, 1.06, 0.19], scale: [0.06, 0.4, 0.07] },

  { material: 'edge', position: [0, 1.43, -0.01], scale: [0.52, 0.11, 0.34] },
  { material: 'armor', position: [-0.31, 1.31, -0.01], scale: [0.15, 0.19, 0.27] },
  { material: 'armor', position: [0.31, 1.31, -0.01], scale: [0.15, 0.19, 0.27] },
  { material: 'dark', position: [-0.43, 1.1, 0], scale: [0.13, 0.42, 0.16], limb: 'leftArm' },
  { material: 'dark', position: [0.43, 1.1, 0], scale: [0.13, 0.42, 0.16], limb: 'rightArm' },
  { material: 'edge', position: [-0.43, 0.88, -0.03], scale: [0.16, 0.12, 0.15], limb: 'leftArm' },
  { material: 'edge', position: [0.43, 0.88, -0.03], scale: [0.16, 0.12, 0.15], limb: 'rightForearm' },
  { material: 'armor', position: [-0.43, 0.72, -0.02], scale: [0.12, 0.2, 0.14], limb: 'leftArm' },
  { material: 'armor', position: [0.43, 0.88, -0.18], scale: [0.13, 0.1, 0.18], limb: 'rightForearm' },
  { material: 'edge', position: [-0.43, 0.57, -0.04], scale: [0.13, 0.13, 0.12], limb: 'leftArm' },
  { material: 'edge', position: [0.43, 0.88, -0.32], scale: [0.13, 0.13, 0.12], limb: 'rightForearm' },
  { material: 'glow', position: [-0.43, 0.47, -0.12], scale: [0.05, 0.055, 0.032], emissive: true, limb: 'leftArm' },
  { material: 'glow', position: [0.43, 0.77, -0.36], scale: [0.05, 0.055, 0.032], emissive: true, limb: 'rightForearm' },

  { material: 'dark', kind: 'cylinder', position: [0.52, 0.95, -0.38], scale: [0.05, 1.3, 0.05], limb: 'rightForearm' },
  { material: 'edge', kind: 'cylinder', position: [0.52, 0.33, -0.38], scale: [0.078, 0.08, 0.078], limb: 'rightForearm' },
  { material: 'edge', kind: 'cylinder', position: [0.52, 1.49, -0.38], scale: [0.086, 0.08, 0.086], limb: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.63, -0.38], scale: [0.13, 0.13, 0.13], emissive: true, limb: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.63, -0.38], scale: [0.16, 0.028, 0.16], emissive: true, limb: 'rightForearm' },
  { material: 'glow', position: [0.52, 1.76, -0.38], scale: [0.055, 0.12, 0.055], emissive: true, limb: 'rightForearm' },

  { material: 'void', position: [0, 1.63, 0.02], scale: [0.32, 0.29, 0.3] },
  { material: 'armor', position: [0, 1.76, -0.02], scale: [0.4, 0.16, 0.3] },
  { material: 'dark', position: [0, 1.62, -0.18], scale: [0.32, 0.15, 0.05] },
  { material: 'eye', position: [-0.08, 1.65, -0.22], scale: [0.07, 0.045, 0.032], emissive: true },
  { material: 'eye', position: [0.08, 1.65, -0.22], scale: [0.07, 0.045, 0.032], emissive: true },
  { material: 'glow', position: [0, 1.58, -0.222], scale: [0.15, 0.036, 0.03], emissive: true },
  { material: 'armor', position: [-0.23, 1.64, 0.02], scale: [0.075, 0.2, 0.21] },
  { material: 'armor', position: [0.23, 1.64, 0.02], scale: [0.075, 0.2, 0.21] },
  { material: 'edge', kind: 'cylinder', position: [0, 1.84, -0.02], scale: [0.58, 0.052, 0.38] },
  { material: 'dark', kind: 'cone', position: [0.02, 2.08, -0.02], scale: [0.5, 0.56, 0.5], rotation: [0, 0, -0.12] },
  { material: 'armor', kind: 'cone', position: [0.035, 2.1, -0.02], scale: [0.38, 0.5, 0.38], rotation: [0, 0, -0.12] },
  { material: 'accent', position: [0, 1.88, -0.245], scale: [0.32, 0.045, 0.034], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0.075, 2.39, -0.02], scale: [0.055, 0.055, 0.055], emissive: true },
];

const CHRONOS_PARTS: VoxelPart[] = [
  { material: 'mist', kind: 'cylinder', position: [0, 0.016, 0], scale: [0.58, 0.024, 0.58], transparent: true },

  { material: 'dark', position: [-0.15, 0.37, 0.02], scale: [0.14, 0.66, 0.15] },
  { material: 'dark', position: [0.15, 0.37, 0.02], scale: [0.14, 0.66, 0.15] },
  { material: 'armor', position: [-0.16, 0.18, -0.08], scale: [0.17, 0.28, 0.15] },
  { material: 'armor', position: [0.16, 0.18, -0.08], scale: [0.17, 0.28, 0.15] },
  { material: 'edge', position: [-0.16, 0.07, -0.04], scale: [0.2, 0.1, 0.23] },
  { material: 'edge', position: [0.16, 0.07, -0.04], scale: [0.2, 0.1, 0.23] },
  { material: 'glow', position: [-0.16, 0.14, -0.18], scale: [0.065, 0.048, 0.032], emissive: true },
  { material: 'glow', position: [0.16, 0.14, -0.18], scale: [0.065, 0.048, 0.032], emissive: true },

  { material: 'edge', position: [0, 1.02, 0.28], scale: [0.56, 0.82, 0.055] },
  { material: 'edge', position: [0, 0.56, 0.3], scale: [0.64, 0.38, 0.05] },
  { material: 'edge', position: [-0.31, 0.75, 0.28], scale: [0.12, 0.62, 0.05], rotation: [0, 0, -0.08] },
  { material: 'edge', position: [0.31, 0.75, 0.28], scale: [0.12, 0.62, 0.05], rotation: [0, 0, 0.08] },
  { material: 'accent', position: [0, 1.43, 0.18], scale: [0.48, 0.14, 0.08] },

  { material: 'dark', position: [0, 0.75, 0.02], scale: [0.38, 0.24, 0.25] },
  { material: 'armor', position: [0, 1.07, 0], scale: [0.43, 0.64, 0.29] },
  { material: 'dark', position: [0, 1.12, -0.17], scale: [0.3, 0.42, 0.06] },
  { material: 'glow', position: [0, 1.16, -0.225], scale: [0.1, 0.26, 0.032], emissive: true },
  { material: 'glow', position: [-0.12, 1.22, -0.232], scale: [0.06, 0.042, 0.03], emissive: true },
  { material: 'glow', position: [0.12, 1.22, -0.232], scale: [0.06, 0.042, 0.03], emissive: true },
  { material: 'accent', position: [0, 0.92, -0.232], scale: [0.26, 0.048, 0.032], emissive: true },
  { material: 'glass', kind: 'cylinder', position: [0, 1.16, -0.245], scale: [0.17, 0.026, 0.17], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'void', position: [0, 0.94, 0.18], scale: [0.25, 0.46, 0.08] },
  { material: 'edge', position: [0, 0.67, -0.15], scale: [0.42, 0.08, 0.05] },
  { material: 'edge', position: [0, 1.41, -0.01], scale: [0.54, 0.12, 0.34] },
  { material: 'accent', position: [-0.28, 1.33, -0.01], scale: [0.13, 0.17, 0.25] },
  { material: 'accent', position: [0.28, 1.33, -0.01], scale: [0.13, 0.17, 0.25] },

  ...createPhantomBlazeArmParts(-1),
  ...createPhantomBlazeArmParts(1),

  { material: 'void', position: [0, 1.62, 0.02], scale: [0.31, 0.28, 0.29] },
  { material: 'armor', position: [0, 1.75, -0.02], scale: [0.4, 0.16, 0.3] },
  { material: 'dark', position: [0, 1.61, -0.18], scale: [0.3, 0.15, 0.05] },
  { material: 'eye', position: [-0.08, 1.65, -0.22], scale: [0.065, 0.04, 0.03], emissive: true },
  { material: 'eye', position: [0.08, 1.65, -0.22], scale: [0.065, 0.04, 0.03], emissive: true },
  { material: 'glow', position: [0, 1.57, -0.222], scale: [0.13, 0.032, 0.028], emissive: true },
  { material: 'edge', kind: 'cylinder', position: [0, 1.82, -0.02], scale: [0.46, 0.046, 0.32] },
];

const HERO_PARTS: Record<HeroId, VoxelPart[]> = {
  phantom: PHANTOM_PARTS,
  hookshot: HOOKSHOT_PARTS,
  blaze: BLAZE_PARTS,
  chronos: CHRONOS_PARTS,
};

const IDLE_SPEED_MULTIPLIER = 1.68;
const WALK_CYCLE_SPEED = 7.4;
const WALK_LEG_PITCH = 0.18;
const WALK_LEG_STRAFE_ROLL = 0.12;
const WALK_LEG_STRIDE = 0.045;
const WALK_LEG_STRAFE = 0.025;
const WALK_LEG_LIFT = 0.018;
const WALK_ARM_PITCH = 0.3;
const WALK_ARM_STRAFE_ROLL = 0.18;
const CHRONOS_WALK_ARM_ARC_SCALE = 0.58;
const WALK_KNEE_BEND = 0.14;
const WALK_SUPPORT_KNEE_BEND = 0.035;
const SLIDE_KNEE_HINGE_SPEED = 8.2;
const JUMP_CYCLE_DURATION = 1.16;
const JUMP_HEIGHT = 0.5;
const DEFAULT_WALK_DIRECTION: HeroWalkDirection = { forward: 1, right: 0 };
const BLAZE_ATTACK_RAMP_DURATION = 0.28;
const BLAZE_ATTACK_HOLD_DURATION = 2;
const BLAZE_ATTACK_RELEASE_DURATION = 0.22;
const BLAZE_ATTACK_DURATION =
  BLAZE_ATTACK_RAMP_DURATION + BLAZE_ATTACK_HOLD_DURATION + BLAZE_ATTACK_RELEASE_DURATION;
const HERO_ATTACK_DURATIONS: Record<HeroId, number> = {
  phantom: BLAZE_ATTACK_DURATION,
  hookshot: 0.46,
  blaze: BLAZE_ATTACK_DURATION,
  chronos: BLAZE_ATTACK_DURATION,
};
interface HeroMovementProfile {
  cycleSpeed: number;
  legPitch: number;
  legStrafeRoll: number;
  legStride: number;
  legStrafe: number;
  legLift: number;
  armPitch: number;
  armStrafeRoll: number;
  armArcScale: number;
  kneeBend: number;
  supportKneeBend: number;
  rootPitch: number;
  rootRoll: number;
  rootBob: number;
  rootSway: number;
  glowPulse: number;
}

function lerpMovementProfile(
  from: HeroMovementProfile,
  to: HeroMovementProfile,
  amount: number
): HeroMovementProfile {
  const t = easeInOutSine(amount);
  return {
    cycleSpeed: THREE.MathUtils.lerp(from.cycleSpeed, to.cycleSpeed, t),
    legPitch: THREE.MathUtils.lerp(from.legPitch, to.legPitch, t),
    legStrafeRoll: THREE.MathUtils.lerp(from.legStrafeRoll, to.legStrafeRoll, t),
    legStride: THREE.MathUtils.lerp(from.legStride, to.legStride, t),
    legStrafe: THREE.MathUtils.lerp(from.legStrafe, to.legStrafe, t),
    legLift: THREE.MathUtils.lerp(from.legLift, to.legLift, t),
    armPitch: THREE.MathUtils.lerp(from.armPitch, to.armPitch, t),
    armStrafeRoll: THREE.MathUtils.lerp(from.armStrafeRoll, to.armStrafeRoll, t),
    armArcScale: THREE.MathUtils.lerp(from.armArcScale, to.armArcScale, t),
    kneeBend: THREE.MathUtils.lerp(from.kneeBend, to.kneeBend, t),
    supportKneeBend: THREE.MathUtils.lerp(from.supportKneeBend, to.supportKneeBend, t),
    rootPitch: THREE.MathUtils.lerp(from.rootPitch, to.rootPitch, t),
    rootRoll: THREE.MathUtils.lerp(from.rootRoll, to.rootRoll, t),
    rootBob: THREE.MathUtils.lerp(from.rootBob, to.rootBob, t),
    rootSway: THREE.MathUtils.lerp(from.rootSway, to.rootSway, t),
    glowPulse: THREE.MathUtils.lerp(from.glowPulse, to.glowPulse, t),
  };
}

const HERO_MOVEMENT_PROFILES: Record<HeroMovementPose, HeroMovementProfile> = {
  walk: {
    cycleSpeed: WALK_CYCLE_SPEED,
    legPitch: WALK_LEG_PITCH,
    legStrafeRoll: WALK_LEG_STRAFE_ROLL,
    legStride: WALK_LEG_STRIDE,
    legStrafe: WALK_LEG_STRAFE,
    legLift: WALK_LEG_LIFT,
    armPitch: WALK_ARM_PITCH,
    armStrafeRoll: WALK_ARM_STRAFE_ROLL,
    armArcScale: 1,
    kneeBend: WALK_KNEE_BEND,
    supportKneeBend: WALK_SUPPORT_KNEE_BEND,
    rootPitch: 0.035,
    rootRoll: 0.04,
    rootBob: 0.012,
    rootSway: 0.006,
    glowPulse: 0.035,
  },
  crouchWalk: {
    cycleSpeed: 6.3,
    legPitch: 0.18,
    legStrafeRoll: 0.08,
    legStride: 0.038,
    legStrafe: 0.018,
    legLift: 0.012,
    armPitch: 0.16,
    armStrafeRoll: 0.1,
    armArcScale: 1,
    kneeBend: 0.08,
    supportKneeBend: 0.025,
    rootPitch: 0.02,
    rootRoll: 0.025,
    rootBob: 0.01,
    rootSway: 0.01,
    glowPulse: 0.045,
  },
  run: {
    cycleSpeed: 11.6,
    legPitch: 0.38,
    legStrafeRoll: 0.16,
    legStride: 0.086,
    legStrafe: 0.034,
    legLift: 0.04,
    armPitch: 0.58,
    armStrafeRoll: 0.23,
    armArcScale: 1,
    kneeBend: 0.27,
    supportKneeBend: 0.055,
    rootPitch: 0.09,
    rootRoll: 0.052,
    rootBob: 0.042,
    rootSway: 0.022,
    glowPulse: 0.12,
  },
};

const CHRONOS_WALK_MOVEMENT_PROFILE: HeroMovementProfile = {
  ...HERO_MOVEMENT_PROFILES.walk,
  armArcScale: CHRONOS_WALK_ARM_ARC_SCALE,
};

function getHeroMovementProfile(heroId: HeroId, pose: HeroMovementPose): HeroMovementProfile {
  if (heroId === 'chronos' && pose === 'walk') {
    return CHRONOS_WALK_MOVEMENT_PROFILE;
  }

  return HERO_MOVEMENT_PROFILES[pose];
}
const HERO_BONE_PIVOTS: Record<HeroBoneName, [number, number, number]> = {
  aura: [0, 0, 0],
  hips: [0, 0.72, 0.02],
  torso: [0, 1.06, 0],
  head: [0, 1.6, 0],
  leftLeg: [-0.18, 0.72, 0.02],
  rightLeg: [0.18, 0.72, 0.02],
  leftKnee: [-0.18, 0.44, 0.02],
  rightKnee: [0.18, 0.44, 0.02],
  leftShin: [-0.18, 0.44, 0.02],
  rightShin: [0.18, 0.44, 0.02],
  leftArm: [-0.48, 1.32, 0],
  rightArm: [0.48, 1.32, 0],
  leftForearm: [-0.5, 0.9, -0.06],
  rightForearm: [0.5, 0.9, -0.06],
};
const EMPTY_RIGGED_PARTS: RiggedVoxelPart[] = [];
const EMPTY_REMOTE_SOCKET_MARKERS: RemoteBodySocketMarker[] = [];

const REMOTE_BODY_SOCKET_MARKERS: Record<HeroId, RemoteBodySocketMarker[]> = {
  phantom: [
    {
      socketName: PHANTOM_PRIMARY_PALM_SOCKET_NAMES[-1],
      bone: 'leftForearm',
      position: [0.07, -0.13, -0.34],
    },
    {
      socketName: PHANTOM_PRIMARY_PALM_SOCKET_NAMES[1],
      bone: 'rightForearm',
      position: [-0.07, -0.13, -0.34],
    },
    {
      socketName: PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
      bone: 'torso',
      position: [0, -0.16, -0.42],
    },
  ],
  hookshot: [
    {
      socketName: HOOKSHOT_HOOK_SOCKET_NAMES[-1],
      bone: 'leftForearm',
      position: [-0.1, -0.2, -0.66],
    },
    {
      socketName: HOOKSHOT_HOOK_SOCKET_NAMES[1],
      bone: 'rightForearm',
      position: [0.1, -0.17, -0.66],
    },
  ],
  blaze: [
    {
      socketName: BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
      bone: 'rightForearm',
      position: [0.02, 0.86, -0.32],
    },
  ],
  chronos: [
    {
      socketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
      bone: 'torso',
      position: [0, -0.16, -0.42],
    },
  ],
};

interface HeroIdleProfile {
  cycleSpeed: number;
  phase: number;
  breathingAmplitude: number;
  swayAmplitude: number;
  twistAmplitude: number;
  auraPulse: number;
}

interface HeroJumpPose {
  rootLift: number;
  crouch: number;
  extension: number;
  tuck: number;
  land: number;
  armReach: number;
  pitch: number;
}

const HERO_IDLE_PROFILES: Record<HeroId, HeroIdleProfile> = {
  phantom: {
    cycleSpeed: 1.66,
    phase: 0.2,
    breathingAmplitude: 0.013,
    swayAmplitude: 0.024,
    twistAmplitude: 0.035,
    auraPulse: 0.118,
  },
  hookshot: {
    cycleSpeed: 1.32,
    phase: 1.1,
    breathingAmplitude: 0.018,
    swayAmplitude: 0.03,
    twistAmplitude: 0.025,
    auraPulse: 0.078,
  },
  blaze: {
    cycleSpeed: 1.96,
    phase: 2.0,
    breathingAmplitude: 0.021,
    swayAmplitude: 0.029,
    twistAmplitude: 0.024,
    auraPulse: 0.108,
  },
  chronos: {
    cycleSpeed: 1.18,
    phase: 2.7,
    breathingAmplitude: 0.016,
    swayAmplitude: 0.018,
    twistAmplitude: 0.02,
    auraPulse: 0.14,
  },
};

const HERO_PART_GEOMETRIES = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 10, 8),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
  cone: new THREE.ConeGeometry(0.5, 1, 8),
} satisfies Record<PartKind, THREE.BufferGeometry>;

function getPartGeometry(part: VoxelPart): THREE.BufferGeometry {
  switch (part.kind) {
    case 'sphere':
      return HERO_PART_GEOMETRIES.sphere;
    case 'cylinder':
      return HERO_PART_GEOMETRIES.cylinder;
    case 'cone':
      return HERO_PART_GEOMETRIES.cone;
    default:
      return HERO_PART_GEOMETRIES.box;
  }
}

function inferStaticBone(part: VoxelPart): HeroBoneName {
  const [, y] = part.position;
  if (part.material === 'mist' || (part.kind === 'cylinder' && y < 0.08)) return 'aura';
  if (y >= 1.52) return 'head';
  if (y >= 0.7) return 'torso';
  return 'hips';
}

function classifyHeroBone(part: VoxelPart): HeroBoneName {
  if (part.limb) {
    return part.limb === 'static' ? inferStaticBone(part) : part.limb;
  }

  const [x, y, z] = part.position;
  const absX = Math.abs(x);

  if (part.material === 'mist' || (part.kind === 'cylinder' && y < 0.08)) {
    return 'aura';
  }

  if (y >= 1.52 && absX <= 0.38) {
    return 'head';
  }

  if (
    absX >= 0.06 &&
    ((y <= 0.56 && absX <= 0.43) || (y <= 0.74 && absX <= 0.32))
  ) {
    if (y <= 0.56) {
      return x < 0 ? 'leftShin' : 'rightShin';
    }

    return x < 0 ? 'leftLeg' : 'rightLeg';
  }

  if (absX >= 0.34 && absX <= 1.05 && y >= 0.46 && y <= 1.52) {
    return x < 0 ? 'leftArm' : 'rightArm';
  }

  if (y >= 0.64 || z > 0.28) {
    return 'torso';
  }

  return 'hips';
}

function createRiggedPart<TPart extends VoxelPart>(part: TPart): RiggedVoxelPart<TPart> {
  const bone = classifyHeroBone(part);
  const [x, y, z] = part.position;
  const pivot = HERO_BONE_PIVOTS[bone];

  return {
    part,
    bone,
    meshOffset: [x - pivot[0], y - pivot[1], z - pivot[2]],
  };
}

function groupRiggedParts<TPart extends VoxelPart>(
  parts: readonly TPart[]
): Record<HeroBoneName, RiggedVoxelPart<TPart>[]> {
  const grouped: Record<HeroBoneName, RiggedVoxelPart<TPart>[]> = {
    aura: [],
    hips: [],
    torso: [],
    head: [],
    leftLeg: [],
    rightLeg: [],
    leftKnee: [],
    rightKnee: [],
    leftShin: [],
    rightShin: [],
    leftArm: [],
    rightArm: [],
    leftForearm: [],
    rightForearm: [],
  };

  parts.forEach((part) => {
    const riggedPart = createRiggedPart(part);
    grouped[riggedPart.bone].push(riggedPart);
  });

  return grouped;
}

function getNormalizedWalkDirection(direction: HeroWalkDirection): HeroWalkDirection {
  const length = Math.sqrt(direction.forward * direction.forward + direction.right * direction.right);
  if (length < 0.001) {
    return DEFAULT_WALK_DIRECTION;
  }

  return {
    forward: direction.forward / length,
    right: direction.right / length,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeInOutSine(value: number): number {
  const t = clamp01(value);
  return 0.5 - Math.cos(t * Math.PI) * 0.5;
}

function smoothPulse(phase: number, start: number, peak: number, end: number): number {
  if (phase <= start || phase >= end) return 0;
  if (phase <= peak) return easeInOutSine((phase - start) / (peak - start));
  return 1 - easeInOutSine((phase - peak) / (end - peak));
}

function getJumpPose(time: number): HeroJumpPose {
  const phase = (time % JUMP_CYCLE_DURATION) / JUMP_CYCLE_DURATION;
  const airProgress = clamp01((phase - 0.32) / 0.5);
  const isAirborne = phase > 0.32 && phase < 0.82;
  const rootLift = isAirborne ? Math.sin(airProgress * Math.PI) * JUMP_HEIGHT : 0;
  const anticipation = smoothPulse(phase, 0, 0.17, 0.32);
  const launch = smoothPulse(phase, 0.25, 0.36, 0.48);
  const tuck = smoothPulse(phase, 0.42, 0.58, 0.78);
  const land = smoothPulse(phase, 0.78, 0.86, 0.98);
  const armSwing = smoothPulse(phase, 0.24, 0.38, 0.84);

  return {
    rootLift: rootLift - anticipation * 0.035 - land * 0.045,
    crouch: anticipation + land * 0.65,
    extension: launch,
    tuck,
    land,
    armReach: armSwing * 0.72,
    pitch: launch * 0.065 - anticipation * 0.05 - land * 0.035,
  };
}

type HeroBoneRefs = Partial<Record<HeroBoneName, THREE.Group | null>>;

function getChildBonePosition(bone: HeroBoneName, parent: HeroBoneName): [number, number, number] {
  const bonePivot = HERO_BONE_PIVOTS[bone];
  const parentPivot = HERO_BONE_PIVOTS[parent];
  return [
    bonePivot[0] - parentPivot[0],
    bonePivot[1] - parentPivot[1],
    bonePivot[2] - parentPivot[2],
  ];
}

function setBoneBasePose(bones: HeroBoneRefs): void {
  bones.aura?.position.set(...HERO_BONE_PIVOTS.aura);
  bones.hips?.position.set(...HERO_BONE_PIVOTS.hips);
  bones.torso?.position.set(...HERO_BONE_PIVOTS.torso);
  bones.leftLeg?.position.set(...HERO_BONE_PIVOTS.leftLeg);
  bones.rightLeg?.position.set(...HERO_BONE_PIVOTS.rightLeg);
  bones.leftKnee?.position.set(...getChildBonePosition('leftKnee', 'leftLeg'));
  bones.rightKnee?.position.set(...getChildBonePosition('rightKnee', 'rightLeg'));
  bones.leftShin?.position.set(...getChildBonePosition('leftShin', 'leftKnee'));
  bones.rightShin?.position.set(...getChildBonePosition('rightShin', 'rightKnee'));
  bones.head?.position.set(...getChildBonePosition('head', 'torso'));
  bones.leftArm?.position.set(...getChildBonePosition('leftArm', 'torso'));
  bones.rightArm?.position.set(...getChildBonePosition('rightArm', 'torso'));
  bones.leftForearm?.position.set(...getChildBonePosition('leftForearm', 'leftArm'));
  bones.rightForearm?.position.set(...getChildBonePosition('rightForearm', 'rightArm'));

  (Object.keys(HERO_BONE_PIVOTS) as HeroBoneName[]).forEach((bone) => {
    const group = bones[bone];
    if (!group) return;
    group.rotation.set(0, 0, 0);
    group.scale.set(1, 1, 1);
  });
}

function applyIdleBonePose(
  bones: HeroBoneRefs,
  profile: HeroIdleProfile,
  primary: number,
  secondary: number,
  tertiary: number,
  amount: number
): void {
  if (amount <= 0.001) return;

  const breathe = primary * profile.breathingAmplitude * amount;
  const widthBreath = breathe * 0.3;
  const rawSway = secondary * profile.swayAmplitude;
  const hipSway = rawSway * amount;
  const shoulderSway = rawSway * 1.15 * amount;
  const twist = tertiary * profile.twistAmplitude * amount;

  if (bones.hips) {
    bones.hips.position.x += hipSway * 0.1;
    bones.hips.position.z += twist * 0.025;
    bones.hips.rotation.y += -twist * 0.18;
    bones.hips.rotation.z += -hipSway * 0.26;
  }

  if (bones.torso) {
    bones.torso.position.x += -hipSway * 0.06;
    bones.torso.position.y += breathe * 0.1;
    bones.torso.rotation.x += secondary * profile.swayAmplitude * 0.4 * amount;
    bones.torso.rotation.y += twist * 0.62;
    bones.torso.rotation.z += shoulderSway * 0.5;
    bones.torso.scale.set(1 - widthBreath, 1 + breathe, 1 - widthBreath);
  }

  if (bones.head) {
    bones.head.position.x += -hipSway * 0.035;
    bones.head.position.y += primary * 0.01 * amount;
    bones.head.rotation.x += -secondary * 0.024 * amount;
    bones.head.rotation.y += tertiary * 0.045 * amount;
    bones.head.rotation.z += secondary * 0.019 * amount;
  }

  if (bones.leftArm) {
    bones.leftArm.position.y += primary * 0.005 * amount;
    bones.leftArm.position.x += -Math.abs(hipSway) * 0.045;
    bones.leftArm.rotation.x += (secondary * 0.034 + tertiary * 0.012) * amount;
    bones.leftArm.rotation.y += twist * 0.16;
    bones.leftArm.rotation.z += (0.036 + primary * 0.038) * amount + shoulderSway * 0.42;
  }
  if (bones.rightArm) {
    bones.rightArm.position.y += primary * 0.005 * amount;
    bones.rightArm.position.x += Math.abs(hipSway) * 0.045;
    bones.rightArm.rotation.x += (secondary * 0.034 - tertiary * 0.012) * amount;
    bones.rightArm.rotation.y += twist * 0.16;
    bones.rightArm.rotation.z -= (0.036 + primary * 0.038) * amount - shoulderSway * 0.42;
  }

  if (bones.leftLeg) {
    bones.leftLeg.position.x += hipSway * 0.025;
    bones.leftLeg.rotation.x += -primary * 0.013 * amount;
    bones.leftLeg.rotation.y += -twist * 0.12;
    bones.leftLeg.rotation.z += secondary * 0.012 * amount;
  }
  if (bones.leftKnee) {
    bones.leftKnee.position.y += primary * 0.005 * amount;
    bones.leftKnee.position.x += hipSway * 0.018;
  }
  if (bones.leftShin) {
    bones.leftShin.rotation.x += primary * 0.018 * amount;
    bones.leftShin.rotation.z += -secondary * 0.008 * amount;
  }
  if (bones.rightLeg) {
    bones.rightLeg.position.x += hipSway * 0.025;
    bones.rightLeg.rotation.x += primary * 0.013 * amount;
    bones.rightLeg.rotation.y += -twist * 0.12;
    bones.rightLeg.rotation.z += secondary * 0.012 * amount;
  }
  if (bones.rightKnee) {
    bones.rightKnee.position.y += -primary * 0.005 * amount;
    bones.rightKnee.position.x += hipSway * 0.018;
  }
  if (bones.rightShin) {
    bones.rightShin.rotation.x += -primary * 0.018 * amount;
    bones.rightShin.rotation.z += -secondary * 0.008 * amount;
  }

  if (bones.aura) {
    const pulse = 1 + (0.5 + 0.5 * tertiary) * profile.auraPulse * amount;
    bones.aura.scale.set(pulse, 1, pulse);
    bones.aura.rotation.y += tertiary * 0.052 * amount;
  }
}

function applyWalkLimbPose(
  bone: THREE.Group | null | undefined,
  isLeft: boolean,
  cycleTime: number,
  amount: number,
  direction: HeroWalkDirection,
  isLeg: boolean,
  profile: HeroMovementProfile
): void {
  if (!bone || amount <= 0.001) return;

  const phaseOffset = isLeft ? 0 : Math.PI;
  const phase = Math.sin(cycleTime + phaseOffset);

  if (isLeg) {
    const lift = Math.max(0, Math.cos(cycleTime + phaseOffset));
    bone.rotation.x += direction.forward * phase * profile.legPitch * amount;
    bone.rotation.y += direction.right * phase * 0.08 * amount;
    bone.rotation.z += -direction.right * phase * profile.legStrafeRoll * amount;
    bone.position.x += direction.right * phase * profile.legStrafe * amount;
    bone.position.y += lift * profile.legLift * amount;
    bone.position.z += -direction.forward * phase * profile.legStride * amount;
    return;
  }

  const armAmount = amount * profile.armArcScale;
  bone.rotation.x += direction.forward * phase * profile.armPitch * armAmount;
  bone.rotation.z += direction.right * phase * profile.armStrafeRoll * armAmount;
  bone.position.x += direction.right * phase * 0.035 * armAmount;
  bone.position.z += -direction.forward * phase * 0.045 * armAmount;
}

function applyWalkLegPose(
  upperLeg: THREE.Group | null | undefined,
  knee: THREE.Group | null | undefined,
  shin: THREE.Group | null | undefined,
  isLeft: boolean,
  cycleTime: number,
  amount: number,
  direction: HeroWalkDirection,
  profile: HeroMovementProfile
): void {
  if (amount <= 0.001) return;

  const side = isLeft ? -1 : 1;
  const phaseOffset = isLeft ? 0 : Math.PI;
  const phase = Math.sin(cycleTime + phaseOffset);
  const footLift = Math.max(0, Math.cos(cycleTime + phaseOffset));
  const supportBend = Math.max(0, -Math.cos(cycleTime + phaseOffset));

  if (upperLeg) {
    upperLeg.rotation.x += direction.forward * phase * profile.legPitch * amount;
    upperLeg.rotation.y += direction.right * phase * 0.025 * amount;
    upperLeg.rotation.z += -direction.right * phase * profile.legStrafeRoll * amount;
    upperLeg.position.x += direction.right * phase * profile.legStrafe * amount;
    upperLeg.position.y += footLift * profile.legLift * amount;
    upperLeg.position.z += -direction.forward * phase * profile.legStride * amount;
  }

  if (knee) {
    knee.position.x += side * footLift * 0.018 * amount;
    knee.position.y += (footLift * 0.01 - supportBend * 0.006) * amount;
    knee.position.z += -direction.forward * footLift * 0.008 * amount;
    knee.rotation.z += side * footLift * 0.035 * amount;
  }

  if (shin) {
    const bend = profile.supportKneeBend * supportBend + profile.kneeBend * footLift;
    shin.rotation.x += bend * amount;
    shin.rotation.z += side * footLift * 0.07 * amount - direction.right * phase * 0.012 * amount;
    shin.position.z += -direction.forward * footLift * 0.006 * amount;
  }
}

function applyWalkingBonePose(
  bones: HeroBoneRefs,
  cycleTime: number,
  amount: number,
  direction: HeroWalkDirection,
  profile: HeroMovementProfile
): void {
  applyWalkLegPose(bones.leftLeg, bones.leftKnee, bones.leftShin, true, cycleTime, amount, direction, profile);
  applyWalkLegPose(bones.rightLeg, bones.rightKnee, bones.rightShin, false, cycleTime, amount, direction, profile);
  applyWalkLimbPose(bones.leftArm, false, cycleTime, amount, direction, false, profile);
  applyWalkLimbPose(bones.rightArm, true, cycleTime, amount, direction, false, profile);
}

function applyCrouchBonePose(bones: HeroBoneRefs, time: number, amount: number): void {
  if (amount <= 0.001) return;

  const breathe = Math.sin(time * 2.2) * 0.025 * amount;
  const brace = 1 + Math.max(0, Math.sin(time * 3.4)) * 0.035;

  if (bones.hips) {
    bones.hips.position.y += -0.085 * amount;
    bones.hips.position.z += 0.03 * amount;
    bones.hips.rotation.x += 0.14 * amount;
  }

  if (bones.torso) {
    bones.torso.position.y += (-0.044 + breathe * 0.18) * amount;
    bones.torso.position.z += -0.028 * amount;
    bones.torso.rotation.x += -0.25 * amount;
    bones.torso.rotation.z += Math.sin(time * 1.3) * 0.01 * amount;
    bones.torso.scale.y *= 1 - 0.01 * amount;
    bones.torso.scale.x *= 1 + 0.006 * amount;
  }

  if (bones.head) {
    bones.head.position.y += -0.006 * amount;
    bones.head.position.z += -0.014 * amount;
    bones.head.rotation.x += -0.085 * amount;
    bones.head.rotation.y += Math.sin(time * 1.6) * 0.018 * amount;
    bones.head.scale.y *= 1 + 0.035 * amount;
  }

  if (bones.leftLeg) {
    bones.leftLeg.rotation.x += 0.72 * amount;
    bones.leftLeg.rotation.z += -0.08 * amount;
    bones.leftLeg.position.y += -0.034 * amount;
    bones.leftLeg.position.x += -0.025 * amount;
    bones.leftLeg.position.z += 0.018 * amount;
  }

  if (bones.rightLeg) {
    bones.rightLeg.rotation.x += 0.72 * amount;
    bones.rightLeg.rotation.z += 0.08 * amount;
    bones.rightLeg.position.y += -0.034 * amount;
    bones.rightLeg.position.x += 0.025 * amount;
    bones.rightLeg.position.z += 0.018 * amount;
  }

  if (bones.leftKnee) {
    bones.leftKnee.position.y += -0.052 * amount;
    bones.leftKnee.position.z += -0.018 * amount;
  }

  if (bones.rightKnee) {
    bones.rightKnee.position.y += -0.052 * amount;
    bones.rightKnee.position.z += -0.018 * amount;
  }

  if (bones.leftShin) {
    bones.leftShin.rotation.x += -0.86 * amount;
    bones.leftShin.rotation.z += 0.055 * amount;
    bones.leftShin.position.z += 0.026 * amount;
  }

  if (bones.rightShin) {
    bones.rightShin.rotation.x += -0.86 * amount;
    bones.rightShin.rotation.z += -0.055 * amount;
    bones.rightShin.position.z += 0.026 * amount;
  }

  if (bones.leftArm) {
    bones.leftArm.rotation.x += -0.13 * brace * amount;
    bones.leftArm.rotation.z += 0.38 * amount;
    bones.leftArm.position.x += -0.028 * amount;
    bones.leftArm.position.y += -0.052 * amount;
    bones.leftArm.position.z += -0.026 * amount;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += -0.13 * brace * amount;
    bones.rightArm.rotation.z -= 0.38 * amount;
    bones.rightArm.position.x += 0.028 * amount;
    bones.rightArm.position.y += -0.052 * amount;
    bones.rightArm.position.z += -0.026 * amount;
  }

  if (bones.aura) {
    const pulse = 1 + (0.04 + Math.max(0, breathe) * 0.8) * amount;
    bones.aura.scale.x *= pulse;
    bones.aura.scale.z *= pulse;
  }
}

function applyChronosArmPose(bones: HeroBoneRefs, amount: number): void {
  if (amount <= 0.001) return;

  if (bones.leftArm) {
    bones.leftArm.rotation.x += 0.72 * amount;
    bones.leftArm.rotation.z += 0.48 * amount;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += 0.72 * amount;
    bones.rightArm.rotation.z -= 0.48 * amount;
  }

  if (bones.leftForearm) {
    bones.leftForearm.rotation.x -= 0.18 * amount;
    bones.leftForearm.rotation.y -= 0.32 * amount;
  }

  if (bones.rightForearm) {
    bones.rightForearm.rotation.x -= 0.18 * amount;
    bones.rightForearm.rotation.y += 0.32 * amount;
  }
}

function applySlideBonePose(bones: HeroBoneRefs, time: number, amount: number): void {
  if (amount <= 0.001) return;

  const reach = 1 + Math.sin(time * 4.2) * 0.025;
  const legHinge = Math.sin(time * SLIDE_KNEE_HINGE_SPEED) * 0.1;

  if (bones.hips) {
    bones.hips.position.y += -0.095 * amount;
    bones.hips.position.z += 0.06 * amount;
    bones.hips.rotation.x += 0.13 * amount;
    bones.hips.rotation.z += 0.045 * amount;
  }

  if (bones.torso) {
    bones.torso.position.y += -0.034 * amount;
    bones.torso.position.z += 0.12 * amount;
    bones.torso.rotation.x += 0.29 * amount;
    bones.torso.rotation.y += -0.03 * amount;
    bones.torso.rotation.z += 0.035 * amount;
  }

  if (bones.head) {
    bones.head.position.y += -0.01 * amount;
    bones.head.position.z += 0.014 * amount;
    bones.head.rotation.x += -0.13 * amount;
    bones.head.rotation.y += -0.018 * amount;
    bones.head.rotation.z += 0.022 * amount;
  }

  if (bones.leftLeg) {
    bones.leftLeg.rotation.x += 0.86 * amount;
    bones.leftLeg.rotation.y += -0.035 * amount;
    bones.leftLeg.rotation.z += -0.18 * amount;
    bones.leftLeg.position.y += -0.026 * amount;
    bones.leftLeg.position.z += -0.012 * amount;
  }

  if (bones.leftKnee) {
    bones.leftKnee.position.y += -0.045 * amount;
    bones.leftKnee.position.z += -0.045 * amount;
    bones.leftKnee.rotation.z += -0.05 * amount;
  }

  if (bones.leftShin) {
    bones.leftShin.rotation.x += -1.28 * amount;
    bones.leftShin.rotation.z += 0.16 * amount;
    bones.leftShin.position.z += 0.02 * amount;
  }

  if (bones.rightLeg) {
    bones.rightLeg.rotation.x += 1.03 * amount;
    bones.rightLeg.rotation.y += 0.018 * amount;
    bones.rightLeg.rotation.z += 0.05 * amount;
    bones.rightLeg.position.y += -0.024 * amount;
    bones.rightLeg.position.z += -0.16 * amount;
  }

  if (bones.rightKnee) {
    bones.rightKnee.rotation.z += 0.016 * amount;
  }

  if (bones.rightShin) {
    bones.rightShin.rotation.x += (-0.62 + legHinge) * amount;
    bones.rightShin.rotation.z += -0.02 * amount;
  }

  if (bones.leftArm) {
    bones.leftArm.rotation.x += -0.95 * amount;
    bones.leftArm.rotation.y += -0.08 * amount;
    bones.leftArm.rotation.z += 0.28 * amount;
    bones.leftArm.position.y += -0.07 * amount;
    bones.leftArm.position.z += 0.09 * amount;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += 0.68 * reach * amount;
    bones.rightArm.rotation.y += 0.035 * amount;
    bones.rightArm.rotation.z += -0.22 * amount;
    bones.rightArm.position.y += -0.018 * amount;
    bones.rightArm.position.z += -0.12 * amount;
  }

  if (bones.aura) {
    bones.aura.scale.x *= 1 + 0.08 * amount;
    bones.aura.scale.z *= 1 + 0.14 * amount;
    bones.aura.rotation.y += time * 0.025 * amount;
  }
}

function applyJumpBonePose(bones: HeroBoneRefs, pose: HeroJumpPose, amount: number): void {
  if (amount <= 0.001) return;

  const crouch = pose.crouch * amount;
  const extension = pose.extension * amount;
  const tuck = pose.tuck * amount;
  const land = pose.land * amount;
  const armReach = pose.armReach * amount;

  if (bones.hips) {
    bones.hips.position.y += (-0.055 * crouch + 0.025 * extension - 0.025 * land);
    bones.hips.rotation.x += 0.08 * crouch - 0.055 * extension + 0.04 * land;
  }

  if (bones.torso) {
    bones.torso.position.y += (-0.035 * crouch + 0.025 * extension - 0.025 * land);
    bones.torso.rotation.x += -0.16 * crouch + 0.1 * extension - 0.06 * tuck - 0.08 * land;
    bones.torso.rotation.z += 0.018 * Math.sin(tuck * Math.PI);
  }

  if (bones.head) {
    bones.head.position.y += (-0.018 * crouch + 0.04 * extension - 0.018 * land);
    bones.head.rotation.x += -0.11 * crouch + 0.08 * extension - 0.035 * land;
  }

  if (bones.leftLeg) {
    bones.leftLeg.rotation.x += 0.56 * crouch - 0.18 * extension + 0.1 * tuck + 0.18 * land;
    bones.leftLeg.position.y += -0.018 * crouch + 0.008 * extension;
    bones.leftLeg.position.z += -0.012 * crouch + 0.008 * extension;
  }

  if (bones.leftKnee) {
    bones.leftKnee.position.y += -0.025 * crouch + 0.012 * tuck - 0.014 * land;
    bones.leftKnee.position.z += -0.012 * crouch - 0.01 * tuck + 0.012 * extension;
  }

  if (bones.leftShin) {
    bones.leftShin.rotation.x += -0.74 * crouch + 0.2 * extension - 0.28 * tuck - 0.24 * land;
    bones.leftShin.position.y += 0.006 * extension + 0.008 * tuck;
    bones.leftShin.position.z += 0.008 * crouch + 0.008 * tuck;
  }

  if (bones.rightLeg) {
    bones.rightLeg.rotation.x += 0.56 * crouch - 0.18 * extension + 0.1 * tuck + 0.18 * land;
    bones.rightLeg.position.y += -0.018 * crouch + 0.008 * extension;
    bones.rightLeg.position.z += -0.012 * crouch + 0.008 * extension;
  }

  if (bones.rightKnee) {
    bones.rightKnee.position.y += -0.025 * crouch + 0.012 * tuck - 0.014 * land;
    bones.rightKnee.position.z += -0.012 * crouch - 0.01 * tuck + 0.012 * extension;
  }

  if (bones.rightShin) {
    bones.rightShin.rotation.x += -0.74 * crouch + 0.2 * extension - 0.28 * tuck - 0.24 * land;
    bones.rightShin.position.y += 0.006 * extension + 0.008 * tuck;
    bones.rightShin.position.z += 0.008 * crouch + 0.008 * tuck;
  }

  if (bones.leftArm) {
    bones.leftArm.rotation.x += -0.48 * armReach + 0.11 * crouch - 0.055 * land;
    bones.leftArm.rotation.z += 0.22 * armReach + 0.055 * crouch;
    bones.leftArm.position.y += 0.017 * armReach - 0.008 * land;
  }

  if (bones.rightArm) {
    bones.rightArm.rotation.x += -0.48 * armReach + 0.11 * crouch - 0.055 * land;
    bones.rightArm.rotation.z -= 0.22 * armReach + 0.055 * crouch;
    bones.rightArm.position.y += 0.017 * armReach - 0.008 * land;
  }

  if (bones.aura) {
    const pulse = 1 + (pose.extension * 0.12 + land * 0.18) * amount;
    bones.aura.scale.x *= pulse;
    bones.aura.scale.z *= pulse;
  }
}

function applyPhantomAttackPose(bones: HeroBoneRefs, progress: number, amount: number): void {
  if (amount <= 0.001) return;

  const poseAmount = getBlazeAttackPoseAmount(progress);
  const aim = poseAmount * amount;
  const settle = poseAmount * amount;

  if (bones.torso) {
    bones.torso.rotation.x += -0.035 * aim;
    bones.torso.rotation.y += -0.055 * aim;
  }

  if (bones.leftArm) {
    bones.leftArm.position.x -= 0.018 * aim;
    bones.leftArm.position.y += -0.035 * aim;
    bones.leftArm.position.z += -0.08 * aim;
    bones.leftArm.rotation.x += (0.48 + settle * 0.08) * aim;
    bones.leftArm.rotation.y -= 0.08 * aim;
    bones.leftArm.rotation.z += 0.1 * aim;
    bones.leftArm.scale.y *= 1 + 0.065 * aim;
  }

  if (bones.rightArm) {
    bones.rightArm.position.x += 0.018 * aim;
    bones.rightArm.position.y += -0.035 * aim;
    bones.rightArm.position.z += -0.08 * aim;
    bones.rightArm.rotation.x += (0.48 + settle * 0.08) * aim;
    bones.rightArm.rotation.y += 0.08 * aim;
    bones.rightArm.rotation.z -= 0.1 * aim;
    bones.rightArm.scale.y *= 1 + 0.065 * aim;
  }

  if (bones.leftForearm) {
    bones.leftForearm.position.z += -0.048 * aim;
    bones.leftForearm.rotation.x -= (0.48 + poseAmount * 0.13) * aim;
    bones.leftForearm.rotation.y -= 0.035 * aim;
  }

  if (bones.rightForearm) {
    bones.rightForearm.position.z += -0.048 * aim;
    bones.rightForearm.rotation.x -= (0.48 + poseAmount * 0.13) * aim;
    bones.rightForearm.rotation.y += 0.035 * aim;
  }
}

function getBlazeAttackPoseAmount(progress: number): number {
  const elapsed = clamp01(progress) * BLAZE_ATTACK_DURATION;

  if (elapsed <= BLAZE_ATTACK_RAMP_DURATION) {
    return easeInOutSine(elapsed / BLAZE_ATTACK_RAMP_DURATION);
  }

  if (elapsed <= BLAZE_ATTACK_RAMP_DURATION + BLAZE_ATTACK_HOLD_DURATION) {
    return 1;
  }

  return 1 - easeInOutSine(
    (elapsed - BLAZE_ATTACK_RAMP_DURATION - BLAZE_ATTACK_HOLD_DURATION) /
      BLAZE_ATTACK_RELEASE_DURATION
  );
}

function applyBlazeAttackPose(bones: HeroBoneRefs, progress: number, amount: number): void {
  if (amount <= 0.001) return;

  const poseAmount = getBlazeAttackPoseAmount(progress);
  const aim = poseAmount * amount;
  const settle = poseAmount * amount;

  if (bones.torso) {
    bones.torso.rotation.x += -0.035 * aim;
    bones.torso.rotation.y += -0.055 * aim;
  }

  if (bones.leftArm) {
    bones.leftArm.position.x += 0.025 * aim;
    bones.leftArm.position.y += -0.035 * aim;
    bones.leftArm.position.z += -0.045 * aim;
    bones.leftArm.rotation.x += 0.2 * aim;
    bones.leftArm.rotation.z += 0.18 * aim;
  }

  if (bones.rightArm) {
    bones.rightArm.position.x += 0.018 * aim;
    bones.rightArm.position.y += -0.035 * aim;
    bones.rightArm.position.z += -0.08 * aim;
    bones.rightArm.rotation.x += (0.36 + settle * 0.05) * aim;
    bones.rightArm.rotation.y += 0.08 * aim;
    bones.rightArm.rotation.z -= 0.1 * aim;
    bones.rightArm.scale.y *= 1 + 0.065 * aim;
  }

  if (bones.rightForearm) {
    bones.rightForearm.position.z += -0.035 * aim;
    bones.rightForearm.rotation.x -= (0.34 + poseAmount * 0.1) * aim;
    bones.rightForearm.rotation.y += 0.035 * aim;
  }
}

function applyHookshotAttackPose(
  bones: HeroBoneRefs,
  progress: number,
  amount: number,
  side: -1 | 1
): void {
  if (amount <= 0.001) return;

  const activeForearm = side < 0 ? bones.leftForearm : bones.rightForearm;
  const activeUpperArm = side < 0 ? bones.leftArm : bones.rightArm;
  const braceForearm = side < 0 ? bones.rightForearm : bones.leftForearm;
  const recoil = smoothPulse(progress, 0, 0.44, 0.98) * 0.64 * amount;

  if (bones.torso) {
    bones.torso.rotation.y += side * 0.01 * recoil;
    bones.torso.rotation.z += -side * 0.006 * recoil;
  }

  if (activeUpperArm) {
    activeUpperArm.position.z += 0.024 * recoil;
    activeUpperArm.rotation.x -= 0.2 * recoil;
    activeUpperArm.rotation.z += -side * 0.016 * recoil;
  }

  if (activeForearm) {
    activeForearm.position.z += 0.018 * recoil;
    activeForearm.rotation.x += 0.36 * recoil;
    activeForearm.rotation.y += side * 0.022 * recoil;
    activeForearm.rotation.z += -side * 0.032 * recoil;
    activeForearm.scale.z *= 1 - 0.022 * recoil;
  }

  if (braceForearm) {
    braceForearm.rotation.x += 0.055 * recoil;
    braceForearm.rotation.z += side * 0.016 * recoil;
  }
}

function applyHeroAttackPose(
  heroId: HeroId,
  bones: HeroBoneRefs,
  progress: number,
  amount: number,
  side: -1 | 1
): void {
  switch (heroId) {
    case 'phantom':
      applyPhantomAttackPose(bones, progress, amount);
      return;
    case 'blaze':
      applyBlazeAttackPose(bones, progress, amount);
      return;
    case 'hookshot':
      applyHookshotAttackPose(bones, progress, amount, side);
      return;
    case 'chronos':
      applyPhantomAttackPose(bones, progress, amount);
      return;
  }
}

function getMaterialEmissiveIntensity(kind: MaterialKind, hasFlag: boolean) {
  const flagBoost = hasFlag ? 1.35 : 1;
  switch (kind) {
    case 'eye':
      return 1.65 * flagBoost;
    case 'glow':
      return 0.78 * flagBoost;
    case 'glass':
      return 0.28 * flagBoost;
    case 'mist':
      return 0.34 * flagBoost;
    case 'accent':
      return 0.12 * flagBoost;
    default:
      return 0;
  }
}

function teamAccentPart(part: VoxelPart & Partial<TeamAccentPart>): TeamAccentPart {
  const transparent = part.transparent || part.opacity !== undefined;
  return {
    emissiveIntensity: part.emissiveIntensity ?? (transparent ? 0.24 : 0.45),
    roughness: part.roughness ?? (transparent ? 0.62 : 0.38),
    metalness: part.metalness ?? (transparent ? 0.12 : 0.18),
    depthWrite: part.depthWrite ?? !transparent,
    toneMapped: part.toneMapped,
    opacity: part.opacity,
    ...part,
  };
}

const TEAM_ACCENT_PARTS: Record<HeroId, TeamAccentPart[]> = {
  phantom: [
    teamAccentPart({ material: 'accent', position: [-0.19, 1.37, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 }),
    teamAccentPart({ material: 'accent', position: [0.19, 1.37, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 }),
    teamAccentPart({ material: 'accent', position: [-0.43, 0.77, -0.36], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.45, roughness: 0.32, metalness: 0.15, toneMapped: false, limb: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.77, -0.36], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.45, roughness: 0.32, metalness: 0.15, toneMapped: false, limb: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.43, 0.88, -0.4], scale: [0.032, 0.1, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.16, limb: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.88, -0.4], scale: [0.032, 0.1, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.16, limb: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.16, 0.18, -0.19], scale: [0.075, 0.055, 0.032], emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.1 }),
    teamAccentPart({ material: 'accent', position: [0.16, 0.18, -0.19], scale: [0.075, 0.055, 0.032], emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.1 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.44, 0.014, 0.44], transparent: true, opacity: 0.16, emissiveIntensity: 0.22, roughness: 0.65, depthWrite: false }),
  ],
  hookshot: [
    teamAccentPart({ material: 'accent', position: [-0.18, 1.39, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.18, 1.39, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.63, 0.91, -0.245], scale: [0.058, 0.26, 0.036], emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.2, toneMapped: false, limb: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.63, 0.66, -0.47], scale: [0.04, 0.052, 0.18], emissiveIntensity: 0.42, roughness: 0.4, metalness: 0.14, limb: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [0.63, 0.93, -0.245], scale: [0.058, 0.28, 0.036], emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.2, toneMapped: false, limb: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [0.63, 0.68, -0.47], scale: [0.04, 0.052, 0.18], emissiveIntensity: 0.42, roughness: 0.4, metalness: 0.14, limb: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.2, 0.2, -0.205], scale: [0.08, 0.05, 0.032], emissiveIntensity: 0.42, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.2, 0.2, -0.205], scale: [0.08, 0.05, 0.032], emissiveIntensity: 0.42, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.46, 0.014, 0.46], transparent: true, opacity: 0.16, emissiveIntensity: 0.22, roughness: 0.65, depthWrite: false }),
  ],
  blaze: [
    teamAccentPart({ material: 'accent', position: [-0.26, 1.38, -0.215], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.5, roughness: 0.34, metalness: 0.22, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.26, 1.38, -0.215], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.5, roughness: 0.34, metalness: 0.22, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.19, 1.01, -0.252], scale: [0.06, 0.13, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.18 }),
    teamAccentPart({ material: 'accent', position: [0.19, 1.01, -0.252], scale: [0.06, 0.13, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.18 }),
    teamAccentPart({ material: 'accent', position: [-0.43, 0.47, -0.15], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.14, limb: 'leftArm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.77, -0.36], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.14, limb: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.17, 0.24, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.17, 0.24, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0, 1.88, -0.282], scale: [0.28, 0.036, 0.03], emissiveIntensity: 0.48, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', kind: 'cylinder', position: [0.52, 1.51, -0.38], scale: [0.12, 0.034, 0.12], emissiveIntensity: 0.46, roughness: 0.35, metalness: 0.18, toneMapped: false, limb: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.88, -0.4], scale: [0.032, 0.1, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.16, limb: 'rightForearm' }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.42, 0.014, 0.42], transparent: true, opacity: 0.16, emissiveIntensity: 0.24, roughness: 0.65, depthWrite: false }),
  ],
  chronos: [
    teamAccentPart({ material: 'accent', position: [-0.22, 1.38, -0.225], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.48, roughness: 0.34, metalness: 0.18, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.22, 1.38, -0.225], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.48, roughness: 0.34, metalness: 0.18, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.16, 0.2, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.16, 0.2, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.5, 0.014, 0.5], transparent: true, opacity: 0.15, emissiveIntensity: 0.23, roughness: 0.65, depthWrite: false }),
  ],
};

const EMPTY_TEAM_ACCENT_PARTS: TeamAccentPart[] = [];

function TeamAccentMaterial({ part, teamColor }: { part: TeamAccentPart; teamColor: string }) {
  const transparent = part.transparent || part.opacity !== undefined;
  return (
    <meshStandardMaterial
      color={teamColor}
      emissive={teamColor}
      emissiveIntensity={part.emissiveIntensity}
      roughness={part.roughness}
      metalness={part.metalness}
      transparent={transparent}
      opacity={part.opacity ?? 1}
      depthWrite={part.depthWrite ?? !transparent}
      toneMapped={part.toneMapped}
    />
  );
}

export const HeroVoxelBody = memo(function HeroVoxelBody({
  heroId,
  team,
  height,
  isBot = false,
  isMoving = false,
  isMovingRef,
  isJumping = false,
  isJumpingRef,
  isCrouching = false,
  isCrouchingRef,
  isSliding = false,
  isSlidingRef,
  isAttacking = false,
  isAttackingRef,
  attackStartedAtMs = null,
  attackStartedAtMsRef,
  attackSide,
  attackSideRef,
  movementPose = 'walk',
  movementPoseRef,
  walkDirection = DEFAULT_WALK_DIRECTION,
  walkDirectionRef,
  hasFlag = false,
  postureScaleY = 1,
  postureScaleYRef,
  idleIntensity = 1,
  showTeamAccents = true,
  castShadow = true,
  socketOwnerId,
}: HeroVoxelBodyProps) {
  const resolvedHero = heroId || 'phantom';
  const groupRef = useRef<THREE.Group>(null);
  const boneRefs = useRef<HeroBoneRefs>({});
  const socketRefs = useRef<Record<string, THREE.Group | null>>({});
  const idleBlendRef = useRef(isMoving || isJumping || isCrouching || isSliding || isAttacking ? 0 : 1);
  const movementBlendRef = useRef(isMoving && !isJumping && !isSliding ? 1 : 0);
  const crouchBlendRef = useRef(isCrouching && !isJumping && !isSliding ? 1 : 0);
  const jumpBlendRef = useRef(isJumping ? 1 : 0);
  const slideBlendRef = useRef(isSliding && !isJumping ? 1 : 0);
  const attackBlendRef = useRef(isAttacking ? 1 : 0);
  const targetMovementPoseRef = useRef<HeroMovementPose>(movementPose);
  const previousMovementProfileRef = useRef<HeroMovementProfile>(
    getHeroMovementProfile(resolvedHero, movementPose)
  );
  const currentMovementProfileRef = useRef<HeroMovementProfile>(
    getHeroMovementProfile(resolvedHero, movementPose)
  );
  const movementProfileBlendRef = useRef(1);
  const movementCycleRef = useRef(0);
  const wasJumpingRef = useRef(false);
  const jumpStartedAtRef = useRef<number | null>(null);
  const scale = height / 1.8;
  const initialVerticalScale = Math.max(0.45, Math.min(1, postureScaleY));
  const teamColor = TEAM_COLORS[team];
  const parts = HERO_PARTS[resolvedHero];
  const teamAccentParts = showTeamAccents ? TEAM_ACCENT_PARTS[resolvedHero] : EMPTY_TEAM_ACCENT_PARTS;
  const riggedPartsByBone = useMemo(() => groupRiggedParts(parts), [parts]);
  const riggedTeamAccentPartsByBone = useMemo(() => groupRiggedParts(teamAccentParts), [teamAccentParts]);
  const socketMarkersByBone = useMemo(() => {
    const grouped: Partial<Record<HeroBoneName, RemoteBodySocketMarker[]>> = {};
    for (const marker of REMOTE_BODY_SOCKET_MARKERS[resolvedHero] ?? EMPTY_REMOTE_SOCKET_MARKERS) {
      (grouped[marker.bone] ??= []).push(marker);
    }
    return grouped;
  }, [resolvedHero]);
  const colors = HERO_COLORS[resolvedHero];
  const idleProfile = HERO_IDLE_PROFILES[resolvedHero];

  const materials = useMemo(() => {
    const materialByKind = new Map<MaterialKind, THREE.MeshStandardMaterial>();
    (Object.keys(colors) as MaterialKind[]).forEach((kind) => {
      const baseColor = kind === 'accent' && isBot ? teamColor : colors[kind];
      const emissiveIntensity = getMaterialEmissiveIntensity(kind, hasFlag);
      const isTranslucent = kind === 'glass' || kind === 'mist';
      materialByKind.set(kind, new THREE.MeshStandardMaterial({
        color: baseColor,
        emissive: emissiveIntensity > 0 ? new THREE.Color(baseColor) : new THREE.Color('#000000'),
        emissiveIntensity,
        roughness: kind === 'glass' ? 0.18 : kind === 'eye' || kind === 'glow' ? 0.28 : kind === 'void' ? 0.92 : 0.68,
        metalness: kind === 'armor' || kind === 'accent' || kind === 'edge' ? 0.28 : 0.05,
        transparent: isTranslucent,
        opacity: kind === 'mist' ? 0.22 : kind === 'glass' ? 0.68 : 1,
        depthWrite: !isTranslucent,
        toneMapped: kind !== 'eye' && kind !== 'glow',
      }));
    });
    return materialByKind;
  }, [colors, hasFlag, isBot, teamColor]);

  useEffect(() => {
    return () => {
      materials.forEach((material) => material.dispose());
    };
  }, [materials]);

  useEffect(() => {
    if (!socketOwnerId) return undefined;

    const cleanups: Array<() => void> = [];
    for (const marker of REMOTE_BODY_SOCKET_MARKERS[resolvedHero] ?? EMPTY_REMOTE_SOCKET_MARKERS) {
      const socketObject = socketRefs.current[marker.socketName];
      if (!socketObject) continue;
      cleanups.push(registerRemoteModelSocket(
        socketOwnerId,
        marker.socketName,
        socketObject,
        'fullBody'
      ));
    }

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [resolvedHero, socketOwnerId]);

  useEffect(() => {
    const moving = isMovingRef?.current ?? isMoving;
    const jumping = isJumpingRef?.current ?? isJumping;
    const crouching = isCrouchingRef?.current ?? isCrouching;
    const sliding = isSlidingRef?.current ?? isSliding;
    const attacking = isAttackingRef?.current ?? isAttacking;
    const nextMovementPose = movementPoseRef?.current ?? movementPose;
    const nextMovementProfile = getHeroMovementProfile(resolvedHero, nextMovementPose);
    idleBlendRef.current = idleIntensity > 0 && !moving && !jumping && !crouching && !sliding && !attacking ? 1 : 0;
    movementBlendRef.current = moving && !jumping && !sliding ? 1 : 0;
    crouchBlendRef.current = crouching && !jumping && !sliding ? 1 : 0;
    jumpBlendRef.current = jumping ? 1 : 0;
    slideBlendRef.current = sliding && !jumping ? 1 : 0;
    attackBlendRef.current = attacking ? 1 : 0;
    targetMovementPoseRef.current = nextMovementPose;
    previousMovementProfileRef.current = nextMovementProfile;
    currentMovementProfileRef.current = nextMovementProfile;
    movementProfileBlendRef.current = 1;
    movementCycleRef.current = 0;
    jumpStartedAtRef.current = null;
    wasJumpingRef.current = false;
  }, [idleIntensity, resolvedHero]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const frameDelta = Math.min(delta, 0.05);
    const verticalScale = Math.max(0.45, Math.min(1, postureScaleYRef?.current ?? postureScaleY));
    const baseScaleY = scale * verticalScale;
    const t = state.clock.elapsedTime;
    const moving = isMovingRef?.current ?? isMoving;
    const jumping = isJumpingRef?.current ?? isJumping;
    const crouching = isCrouchingRef?.current ?? isCrouching;
    const sliding = isSlidingRef?.current ?? isSliding;
    let attacking = isAttackingRef?.current ?? isAttacking;
    const attackDuration = HERO_ATTACK_DURATIONS[resolvedHero];
    const providedAttackStartedAtMs = attackStartedAtMsRef?.current ?? attackStartedAtMs;
    let attackProgress = 1;
    const configuredAttackSide = attackSideRef?.current ?? attackSide ?? 1;
    let activeAttackSide = configuredAttackSide;

    if (attacking && providedAttackStartedAtMs && providedAttackStartedAtMs > 0) {
      attackProgress = clamp01((Date.now() - providedAttackStartedAtMs) / (attackDuration * 1000));
      attacking = attackProgress < 1;
    } else if (attacking) {
      const attackCycle = t / attackDuration;
      const attackCycleIndex = Math.floor(attackCycle);
      attackProgress = attackCycle - attackCycleIndex;

      if (!attackSideRef && attackSide === undefined && resolvedHero === 'hookshot') {
        activeAttackSide = attackCycleIndex % 2 === 0 ? 1 : -1;
      }
    }

    const targetMovementPose = movementPoseRef?.current ?? movementPose;
    if (targetMovementPoseRef.current !== targetMovementPose) {
      previousMovementProfileRef.current = currentMovementProfileRef.current;
      targetMovementPoseRef.current = targetMovementPose;
      movementProfileBlendRef.current = 0;
    }

    movementProfileBlendRef.current = THREE.MathUtils.damp(
      movementProfileBlendRef.current,
      1,
      6.5,
      frameDelta
    );
    const movementProfile = lerpMovementProfile(
      previousMovementProfileRef.current,
      getHeroMovementProfile(resolvedHero, targetMovementPoseRef.current),
      movementProfileBlendRef.current
    );
    currentMovementProfileRef.current = movementProfile;
    const rawWalkDirection = walkDirectionRef?.current ?? walkDirection;
    const normalizedWalkDirection = getNormalizedWalkDirection(rawWalkDirection);
    const bones = boneRefs.current;
    setBoneBasePose(bones);

    if (jumping) {
      if (!wasJumpingRef.current || jumpStartedAtRef.current === null) {
        jumpStartedAtRef.current = t;
      }
    } else if (jumpBlendRef.current <= 0.001) {
      jumpStartedAtRef.current = null;
    }
    wasJumpingRef.current = jumping;

    const targetMovementBlend = moving && !jumping && !sliding ? 1 : 0;
    const targetCrouchBlend = crouching && !jumping && !sliding ? 1 : 0;
    const targetJumpBlend = jumping ? 1 : 0;
    const targetSlideBlend = sliding && !jumping ? 1 : 0;
    const targetAttackBlend = attacking ? 1 : 0;
    movementBlendRef.current = THREE.MathUtils.damp(
      movementBlendRef.current,
      targetMovementBlend,
      targetMovementBlend > movementBlendRef.current ? 7.5 : 8.5,
      frameDelta
    );
    crouchBlendRef.current = THREE.MathUtils.damp(
      crouchBlendRef.current,
      targetCrouchBlend,
      targetCrouchBlend > crouchBlendRef.current ? 8 : 7,
      frameDelta
    );
    jumpBlendRef.current = THREE.MathUtils.damp(
      jumpBlendRef.current,
      targetJumpBlend,
      targetJumpBlend > jumpBlendRef.current ? 9.5 : 7.5,
      frameDelta
    );
    slideBlendRef.current = THREE.MathUtils.damp(
      slideBlendRef.current,
      targetSlideBlend,
      targetSlideBlend > slideBlendRef.current ? 11 : 7.5,
      frameDelta
    );
    attackBlendRef.current = THREE.MathUtils.damp(
      attackBlendRef.current,
      targetAttackBlend,
      targetAttackBlend > attackBlendRef.current ? 14 : 8.5,
      frameDelta
    );

    if (
      idleIntensity <= 0 &&
      !moving &&
      !jumping &&
      !crouching &&
      !sliding &&
      !attacking &&
      movementBlendRef.current <= 0.001 &&
      crouchBlendRef.current <= 0.001 &&
      jumpBlendRef.current <= 0.001 &&
      slideBlendRef.current <= 0.001 &&
      attackBlendRef.current <= 0.001
    ) {
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.rotation.set(0, 0, 0);
      groupRef.current.scale.set(scale, baseScaleY, scale);
      materials.forEach((material, kind) => {
        material.emissiveIntensity = getMaterialEmissiveIntensity(kind, hasFlag);
      });

      return;
    }

    const targetIdleBlend = moving || jumping || crouching || sliding || attacking ? 0 : 1;
    idleBlendRef.current = THREE.MathUtils.damp(
      idleBlendRef.current,
      targetIdleBlend,
      moving || jumping || crouching || sliding || attacking ? 9.5 : 5.5,
      frameDelta
    );

    const slideAmount = easeInOutSine(slideBlendRef.current);
    const runSlideCrossfadeAmount = targetMovementPoseRef.current === 'run' ? slideAmount : 0;
    const attackAmount = easeInOutSine(attackBlendRef.current);
    const attackPosePulse = resolvedHero === 'blaze' || resolvedHero === 'phantom'
      ? getBlazeAttackPoseAmount(attackProgress)
      : Math.sin(attackProgress * Math.PI);
    const attackPulse = attackPosePulse * attackAmount;
    const rootAttackPulse = resolvedHero === 'phantom' ? 0 : attackPulse;
    const idleAmount = idleBlendRef.current * idleIntensity;
    const movingAmount = movementBlendRef.current * (1 - runSlideCrossfadeAmount);
    const jumpAmount = jumpBlendRef.current;
    const crouchAmount = crouchBlendRef.current;
    const poseCrouchAmount = crouchAmount;
    const jumpTime = jumpStartedAtRef.current === null ? 0 : t - jumpStartedAtRef.current;
    const jumpPose = getJumpPose(jumpTime);
    if (movingAmount > 0.001) {
      movementCycleRef.current = (
        movementCycleRef.current + frameDelta * movementProfile.cycleSpeed
      ) % (Math.PI * 2);
    }
    const movementCycleTime = movementCycleRef.current;
    const movementStep = 0.5 + 0.5 * Math.sin(movementCycleTime * 2);
    const movementSway = Math.sin(movementCycleTime);
    const idleTime = t * IDLE_SPEED_MULTIPLIER;
    const primary = Math.sin(idleTime * idleProfile.cycleSpeed + idleProfile.phase);
    const secondary = Math.sin(idleTime * idleProfile.cycleSpeed * 0.57 + idleProfile.phase + 1.1);
    const tertiary = Math.sin(idleTime * idleProfile.cycleSpeed * 1.31 + idleProfile.phase * 0.5);

    const slideSkid = Math.sin(t * 8.5) * 0.012 * slideAmount;
    groupRef.current.position.set(
      0,
      jumpPose.rootLift * jumpAmount +
      movementStep * movementProfile.rootBob * movingAmount -
      0.09 * poseCrouchAmount +
      Math.sin(t * 2.2) * 0.006 * poseCrouchAmount -
      0.31 * slideAmount +
      0.012 * rootAttackPulse,
      -0.24 * slideAmount + slideSkid - 0.035 * rootAttackPulse
    );
    groupRef.current.rotation.x =
      secondary * idleProfile.swayAmplitude * 0.08 * idleAmount -
      normalizedWalkDirection.forward * movementProfile.rootPitch * movingAmount +
      jumpPose.pitch * jumpAmount +
      -0.025 * poseCrouchAmount +
      0.6 * slideAmount -
      0.035 * rootAttackPulse;
    groupRef.current.rotation.y =
      tertiary * idleProfile.twistAmplitude * 0.12 * idleAmount +
      activeAttackSide * 0.025 * rootAttackPulse;
    groupRef.current.rotation.z =
      secondary * idleProfile.swayAmplitude * 0.12 * idleAmount -
      normalizedWalkDirection.right * movementProfile.rootRoll * movingAmount +
      movementSway * movementProfile.rootSway * movingAmount +
      0.055 * slideAmount -
      activeAttackSide * 0.018 * rootAttackPulse;

    const jumpSquash = jumpPose.crouch * 0.035 + jumpPose.land * 0.026;
    const jumpStretch = jumpPose.extension * 0.026;
    const jumpScaleY = 1 - jumpSquash + jumpStretch;
    const jumpScaleXZ = 1 + jumpSquash * 0.45 - jumpStretch * 0.28;
    const crouchScaleY = 1 - 0.055 * poseCrouchAmount;
    const crouchScaleXZ = 1 + 0.012 * poseCrouchAmount;
    groupRef.current.scale.set(
      scale * THREE.MathUtils.lerp(1, jumpScaleXZ, jumpAmount) * crouchScaleXZ,
      baseScaleY * THREE.MathUtils.lerp(1, jumpScaleY, jumpAmount) * crouchScaleY,
      scale * THREE.MathUtils.lerp(1, jumpScaleXZ, jumpAmount) * crouchScaleXZ
    );
    applyIdleBonePose(bones, idleProfile, primary, secondary, tertiary, idleAmount);
    applyJumpBonePose(bones, jumpPose, jumpAmount);
    applyCrouchBonePose(bones, t, poseCrouchAmount);
    if (resolvedHero === 'chronos') {
      applyChronosArmPose(bones, 1 - slideAmount);
    }

    const glowPulse =
      (0.5 + 0.5 * tertiary) * idleProfile.auraPulse * idleAmount +
      (jumpPose.extension * 0.18 + jumpPose.land * 0.14) * jumpAmount +
      movementStep * movementProfile.glowPulse * movingAmount +
      0.035 * poseCrouchAmount +
      0.09 * slideAmount +
      0.16 * attackPulse;
    materials.forEach((material, kind) => {
      const baseEmissiveIntensity = getMaterialEmissiveIntensity(kind, hasFlag);
      material.emissiveIntensity = baseEmissiveIntensity * (1 + glowPulse);
    });

    applyWalkingBonePose(bones, movementCycleTime, movingAmount, normalizedWalkDirection, movementProfile);
    applySlideBonePose(bones, t, slideAmount);
    applyHeroAttackPose(resolvedHero, bones, attackProgress, attackAmount, activeAttackSide);
  });

  const renderPartsForBone = (bone: HeroBoneName) => (
    <>
      {(riggedPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).map((riggedPart, index) => (
        <mesh
          key={`${resolvedHero}-${bone}-${index}`}
          position={riggedPart.meshOffset}
          rotation={riggedPart.part.rotation}
          scale={riggedPart.part.scale}
          castShadow={castShadow}
          geometry={getPartGeometry(riggedPart.part)}
        >
          <primitive object={materials.get(riggedPart.part.material)!} attach="material" />
        </mesh>
      ))}

      {(riggedTeamAccentPartsByBone[bone] ?? EMPTY_RIGGED_PARTS).map((riggedPart, index) => (
        <mesh
          key={`${resolvedHero}-team-${bone}-${index}`}
          position={riggedPart.meshOffset}
          rotation={riggedPart.part.rotation}
          scale={riggedPart.part.scale}
          castShadow={castShadow}
          geometry={getPartGeometry(riggedPart.part)}
        >
          <TeamAccentMaterial part={riggedPart.part as TeamAccentPart} teamColor={teamColor} />
        </mesh>
      ))}
    </>
  );

  const renderSocketMarkersForBone = (bone: HeroBoneName) => (
    (socketMarkersByBone[bone] ?? EMPTY_REMOTE_SOCKET_MARKERS).map((marker) => (
      <group
        key={`${resolvedHero}-socket-${marker.socketName}`}
        ref={(node) => {
          socketRefs.current[marker.socketName] = node;
        }}
        position={marker.position}
      />
    ))
  );

  const renderKneeJoint = (side: 'left' | 'right') => (
    <>
      <mesh
        key={`${resolvedHero}-${side}-knee-cap`}
        position={[0, 0.015, -0.185]}
        scale={[0.18, 0.08, 0.05]}
        castShadow={castShadow}
        geometry={HERO_PART_GEOMETRIES.box}
      >
        <primitive object={materials.get('edge')!} attach="material" />
      </mesh>
      <mesh
        key={`${resolvedHero}-${side}-knee-glow`}
        position={[0, 0.018, -0.222]}
        scale={[0.105, 0.028, 0.026]}
        castShadow={castShadow}
        geometry={HERO_PART_GEOMETRIES.box}
      >
        <primitive object={materials.get('accent')!} attach="material" />
      </mesh>
    </>
  );

  const renderUpperLegLink = (side: 'left' | 'right') => (
    <mesh
      key={`${resolvedHero}-${side}-upper-leg-link`}
      position={[0, -0.15, -0.018]}
      scale={[0.17, 0.3, 0.13]}
      castShadow={castShadow}
      geometry={HERO_PART_GEOMETRIES.box}
    >
      <primitive object={materials.get('dark')!} attach="material" />
    </mesh>
  );

  return (
    <group ref={groupRef} scale={[scale, scale * initialVerticalScale, scale]}>
      <group
        ref={(node) => {
          boneRefs.current.aura = node;
        }}
        position={HERO_BONE_PIVOTS.aura}
      >
        {renderPartsForBone('aura')}
        {renderSocketMarkersForBone('aura')}
      </group>

      <group
        ref={(node) => {
          boneRefs.current.hips = node;
        }}
        position={HERO_BONE_PIVOTS.hips}
      >
        {renderPartsForBone('hips')}
        {renderSocketMarkersForBone('hips')}
      </group>

      <group
        ref={(node) => {
          boneRefs.current.leftLeg = node;
        }}
        position={HERO_BONE_PIVOTS.leftLeg}
      >
        {renderUpperLegLink('left')}
        {renderPartsForBone('leftLeg')}
        {renderSocketMarkersForBone('leftLeg')}

        <group
          ref={(node) => {
            boneRefs.current.leftKnee = node;
          }}
          position={getChildBonePosition('leftKnee', 'leftLeg')}
        >
          {renderKneeJoint('left')}
          {renderSocketMarkersForBone('leftKnee')}

          <group
            ref={(node) => {
              boneRefs.current.leftShin = node;
            }}
            position={getChildBonePosition('leftShin', 'leftKnee')}
          >
            {renderPartsForBone('leftShin')}
            {renderSocketMarkersForBone('leftShin')}
          </group>
        </group>
      </group>

      <group
        ref={(node) => {
          boneRefs.current.rightLeg = node;
        }}
        position={HERO_BONE_PIVOTS.rightLeg}
      >
        {renderUpperLegLink('right')}
        {renderPartsForBone('rightLeg')}
        {renderSocketMarkersForBone('rightLeg')}

        <group
          ref={(node) => {
            boneRefs.current.rightKnee = node;
          }}
          position={getChildBonePosition('rightKnee', 'rightLeg')}
        >
          {renderKneeJoint('right')}
          {renderSocketMarkersForBone('rightKnee')}

          <group
            ref={(node) => {
              boneRefs.current.rightShin = node;
            }}
            position={getChildBonePosition('rightShin', 'rightKnee')}
          >
            {renderPartsForBone('rightShin')}
            {renderSocketMarkersForBone('rightShin')}
          </group>
        </group>
      </group>

      <group
        ref={(node) => {
          boneRefs.current.torso = node;
        }}
        position={HERO_BONE_PIVOTS.torso}
      >
        {renderPartsForBone('torso')}
        {renderSocketMarkersForBone('torso')}

        <group
          ref={(node) => {
            boneRefs.current.head = node;
          }}
          position={getChildBonePosition('head', 'torso')}
        >
          {renderPartsForBone('head')}
          {renderSocketMarkersForBone('head')}
        </group>

        <group
          ref={(node) => {
            boneRefs.current.leftArm = node;
          }}
          position={getChildBonePosition('leftArm', 'torso')}
        >
          {renderPartsForBone('leftArm')}
          {renderSocketMarkersForBone('leftArm')}

          <group
            ref={(node) => {
              boneRefs.current.leftForearm = node;
            }}
            position={getChildBonePosition('leftForearm', 'leftArm')}
          >
            {renderPartsForBone('leftForearm')}
            {renderSocketMarkersForBone('leftForearm')}
          </group>
        </group>

        <group
          ref={(node) => {
            boneRefs.current.rightArm = node;
          }}
          position={getChildBonePosition('rightArm', 'torso')}
        >
          {renderPartsForBone('rightArm')}
          {renderSocketMarkersForBone('rightArm')}

          <group
            ref={(node) => {
              boneRefs.current.rightForearm = node;
            }}
            position={getChildBonePosition('rightForearm', 'rightArm')}
          >
            {renderPartsForBone('rightForearm')}
            {renderSocketMarkersForBone('rightForearm')}
          </group>
        </group>
      </group>

      {isBot && (
        <mesh
          position={[0, 1.98, 0]}
          scale={[0.14, 0.04, 0.14]}
          castShadow={castShadow}
          geometry={HERO_PART_GEOMETRIES.box}
        >
          <meshStandardMaterial color={teamColor} emissive={teamColor} emissiveIntensity={0.75} />
        </mesh>
      )}
    </group>
  );
});
