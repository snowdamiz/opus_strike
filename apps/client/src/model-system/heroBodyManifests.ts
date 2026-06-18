import {
  BLAZE_ROCKET_STAFF_SOCKET,
  BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
  CHRONOS_PRIMARY_ORB_SOCKET,
  CHRONOS_PRIMARY_ORB_SOCKET_NAME,
  HOOKSHOT_CHAIN_SOCKET,
  HOOKSHOT_HOOK_SOCKET_NAMES,
  PHANTOM_DIRE_BALL_SOCKET,
  PHANTOM_PRIMARY_PALM_SOCKET_NAMES,
  PHANTOM_VOID_RAY_ORB_SOCKET_NAME,
  PHANTOM_VOID_RAY_SOCKET,
  TEAM_CATALOG,
  type HeroId,
  type Team,
} from '@voxel-strike/shared';
import * as THREE from 'three';
import type {
  HeroBodyManifest,
  HeroBoneName,
  HeroIdleProfile,
  HeroMovementPose,
  HeroMovementProfile,
  HeroWalkDirection,
  MaterialKind,
  RemoteBodySocketMarker,
  TeamAccentPart,
  VoxelPart,
  VoxelPartDraft,
} from './heroBodyTypes';
import { addVoxelPartMetadata } from './heroRig';

function easeInOutSine(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return 0.5 - Math.cos(t * Math.PI) * 0.5;
}

export const TEAM_COLORS: Record<Team, string> = Object.fromEntries(
  TEAM_CATALOG.map((team) => [team.id, team.color])
) as Record<Team, string>;

export const TEAM_BODY_GLOW_OUTLINE_SCALE = 1.11;
export const TEAM_BODY_GLOW_OUTLINE_OPACITY = 0.64;
export const TEAM_BODY_GLOW_EMISSIVE_MULTIPLIER = 1.55;
export const TEAM_BODY_GLOW_TRANSPARENT_OPACITY_MULTIPLIER = 1.45;

export function getHeroBodyMaterialEmissiveIntensity(kind: MaterialKind, hasFlag: boolean) {
  const flagBoost = hasFlag ? 0.35 : 0;
  if (kind === 'glow') return 0.78 + flagBoost;
  if (kind === 'eye') return 0.9 + flagBoost;
  if (kind === 'accent') return 0.32 + flagBoost * 0.6;
  if (kind === 'mist') return 0.42 + flagBoost * 0.4;
  return flagBoost * 0.35;
}

export function getTeamBodyGlowEmissiveIntensity(part: Pick<TeamAccentPart, 'emissiveIntensity'>): number {
  return part.emissiveIntensity * TEAM_BODY_GLOW_EMISSIVE_MULTIPLIER;
}

export function getTeamBodyGlowOpacity(part: Pick<TeamAccentPart, 'opacity' | 'transparent'>): number {
  const opacity = part.opacity ?? 1;
  if (!part.transparent && part.opacity === undefined) return opacity;
  return Math.min(1, opacity * TEAM_BODY_GLOW_TRANSPARENT_OPACITY_MULTIPLIER);
}

export const HERO_COLORS: Record<HeroId, Record<MaterialKind, string>> = {
  phantom: {
    armor: '#302447',
    dark: '#090612',
    metal: '#211833',
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
    metal: '#9ca3af',
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
    metal: '#374151',
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
    metal: '#9b7a34',
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

type TeamAccentPartDraft = Omit<TeamAccentPart, 'id' | 'bone'> & {
  id?: string;
  bone?: TeamAccentPart['bone'];
};

type RemoteBodySocketMarkerDraft = Omit<RemoteBodySocketMarker, 'id'> & {
  id?: string;
};

function addRemoteSocketMarkerIds(
  markers: readonly RemoteBodySocketMarkerDraft[],
  idPrefix: string
): RemoteBodySocketMarker[] {
  return markers.map((marker) => ({
    ...marker,
    id: marker.id ?? `${idPrefix}.${marker.socketName.replace(/[^a-zA-Z0-9]+/g, '.')}`,
  }));
}

export function createPhantomBlazeArmParts(side: -1 | 1): VoxelPartDraft[] {
  const upperBone: HeroBoneName = side < 0 ? 'leftArm' : 'rightArm';
  const lowerBone: HeroBoneName = side < 0 ? 'leftForearm' : 'rightForearm';

  return [
    {
      material: 'dark',
      position: [side * 0.43, 1.1, 0],
      scale: [0.13, 0.42, 0.16],
      bone: upperBone,
    },
    {
      material: 'edge',
      position: [side * 0.43, 0.88, -0.03],
      scale: [0.16, 0.12, 0.15],
      bone: lowerBone,
    },
    {
      material: 'armor',
      position: [side * 0.43, 0.88, -0.18],
      scale: [0.13, 0.1, 0.18],
      bone: lowerBone,
    },
    {
      material: 'edge',
      position: [side * 0.43, 0.88, -0.32],
      scale: [0.13, 0.13, 0.12],
      bone: lowerBone,
    },
    {
      material: 'glow',
      position: [side * 0.43, 0.77, -0.36],
      scale: [0.05, 0.055, 0.032],
      emissive: true,
      bone: lowerBone,
    },
  ];
}

export const PHANTOM_PARTS: VoxelPart[] = addVoxelPartMetadata([
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
], 'phantom.body');

export const HOOKSHOT_PARTS: VoxelPart[] = addVoxelPartMetadata([
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
  { material: 'armor', position: [-0.36, 1.32, -0.01], scale: [0.24, 0.22, 0.31], bone: 'torso' },
  { material: 'armor', position: [0.36, 1.32, -0.01], scale: [0.24, 0.22, 0.31], bone: 'torso' },
  { material: 'dark', position: [-0.43, 1.02, 0], scale: [0.13, 0.4, 0.16] },
  { material: 'dark', position: [0.44, 1.02, 0], scale: [0.14, 0.4, 0.16] },
  { material: 'edge', position: [-0.5, 0.82, -0.06], scale: [0.18, 0.34, 0.16], bone: 'leftForearm' },
  { material: 'accent', position: [-0.57, 0.83, -0.2], scale: [0.15, 0.22, 0.056], emissive: true, bone: 'leftForearm' },
  { material: 'dark', position: [-0.6, 0.84, -0.34], scale: [0.18, 0.17, 0.18], bone: 'leftForearm' },
  { material: 'edge', position: [-0.6, 0.84, -0.49], scale: [0.13, 0.13, 0.15], bone: 'leftForearm' },
  { material: 'glow', position: [-0.6, 0.84, -0.585], scale: [0.074, 0.074, 0.04], emissive: true, bone: 'leftForearm' },
  { material: 'edge', kind: 'cylinder', position: [-0.6, 0.7, -0.42], scale: [0.024, 0.34, 0.024], rotation: [Math.PI / 2, 0, 0], bone: 'leftForearm' },
  { material: 'glow', position: [-0.6, 0.7, -0.66], scale: [0.048, 0.056, 0.048], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [-0.68, 0.7, -0.72], scale: [0.038, 0.044, 0.115], rotation: [0, 0.42, 0], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [-0.52, 0.7, -0.72], scale: [0.038, 0.044, 0.115], rotation: [0, -0.42, 0], emissive: true, bone: 'leftForearm' },
  { material: 'edge', position: [0.5, 0.83, -0.06], scale: [0.18, 0.36, 0.16], bone: 'rightForearm' },
  { material: 'accent', position: [0.57, 0.84, -0.2], scale: [0.16, 0.25, 0.056], emissive: true, bone: 'rightForearm' },
  { material: 'dark', position: [0.6, 0.86, -0.34], scale: [0.19, 0.18, 0.18], bone: 'rightForearm' },
  { material: 'edge', position: [0.6, 0.86, -0.49], scale: [0.14, 0.14, 0.16], bone: 'rightForearm' },
  { material: 'glow', position: [0.6, 0.86, -0.585], scale: [0.082, 0.082, 0.042], emissive: true, bone: 'rightForearm' },
  { material: 'edge', kind: 'cylinder', position: [0.6, 0.73, -0.42], scale: [0.024, 0.38, 0.024], rotation: [Math.PI / 2, 0, 0], bone: 'rightForearm' },
  { material: 'glow', position: [0.6, 0.73, -0.66], scale: [0.05, 0.06, 0.05], emissive: true, bone: 'rightForearm' },
  { material: 'glow', position: [0.52, 0.73, -0.72], scale: [0.04, 0.045, 0.12], rotation: [0, 0.42, 0], emissive: true, bone: 'rightForearm' },
  { material: 'glow', position: [0.68, 0.73, -0.72], scale: [0.04, 0.045, 0.12], rotation: [0, -0.42, 0], emissive: true, bone: 'rightForearm' },

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
], 'hookshot.body');

export const BLAZE_PARTS: VoxelPart[] = addVoxelPartMetadata([
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
  { material: 'dark', position: [-0.43, 1.1, 0], scale: [0.13, 0.42, 0.16], bone: 'leftArm' },
  { material: 'dark', position: [0.43, 1.1, 0], scale: [0.13, 0.42, 0.16], bone: 'rightArm' },
  { material: 'edge', position: [-0.43, 0.88, -0.03], scale: [0.16, 0.12, 0.15], bone: 'leftArm' },
  { material: 'edge', position: [0.43, 0.88, -0.03], scale: [0.16, 0.12, 0.15], bone: 'rightForearm' },
  { material: 'armor', position: [-0.43, 0.72, -0.02], scale: [0.12, 0.2, 0.14], bone: 'leftArm' },
  { material: 'armor', position: [0.43, 0.88, -0.18], scale: [0.13, 0.1, 0.18], bone: 'rightForearm' },
  { material: 'edge', position: [-0.43, 0.57, -0.04], scale: [0.13, 0.13, 0.12], bone: 'leftArm' },
  { material: 'edge', position: [0.43, 0.88, -0.32], scale: [0.13, 0.13, 0.12], bone: 'rightForearm' },
  { material: 'glow', position: [-0.43, 0.47, -0.12], scale: [0.05, 0.055, 0.032], emissive: true, bone: 'leftArm' },
  { material: 'glow', position: [0.43, 0.77, -0.36], scale: [0.05, 0.055, 0.032], emissive: true, bone: 'rightForearm' },

  { material: 'dark', kind: 'cylinder', position: [0.52, 0.95, -0.38], scale: [0.05, 1.3, 0.05], bone: 'rightForearm' },
  { material: 'edge', kind: 'cylinder', position: [0.52, 0.33, -0.38], scale: [0.078, 0.08, 0.078], bone: 'rightForearm' },
  { material: 'edge', kind: 'cylinder', position: [0.52, 1.49, -0.38], scale: [0.086, 0.08, 0.086], bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.63, -0.38], scale: [0.13, 0.13, 0.13], emissive: true, bone: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.63, -0.38], scale: [0.16, 0.028, 0.16], emissive: true, bone: 'rightForearm' },
  { material: 'glow', position: [0.52, 1.76, -0.38], scale: [0.055, 0.12, 0.055], emissive: true, bone: 'rightForearm' },

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
], 'blaze.body');

export const CHRONOS_PARTS: VoxelPart[] = addVoxelPartMetadata([
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
], 'chronos.body');

export const HERO_PARTS: Record<HeroId, VoxelPart[]> = {
  phantom: PHANTOM_PARTS,
  hookshot: HOOKSHOT_PARTS,
  blaze: BLAZE_PARTS,
  chronos: CHRONOS_PARTS,
};

export const IDLE_SPEED_MULTIPLIER = 1.68;
export const WALK_CYCLE_SPEED = 9.2;
export const WALK_LEG_PITCH = 0.34;
export const WALK_LEG_STRAFE_ROLL = 0.17;
export const WALK_LEG_STRIDE = 0.086;
export const WALK_LEG_STRAFE = 0.036;
export const WALK_LEG_LIFT = 0.043;
export const WALK_ARM_PITCH = 0.46;
export const WALK_ARM_STRAFE_ROLL = 0.25;
export const CHRONOS_WALK_ARM_ARC_SCALE = 0.58;
export const WALK_KNEE_BEND = 0.27;
export const WALK_SUPPORT_KNEE_BEND = 0.07;
export const SLIDE_KNEE_HINGE_SPEED = 8.2;
export const JUMP_CYCLE_DURATION = 1.16;
export const JUMP_HEIGHT = 0.5;
export const DEFAULT_WALK_DIRECTION: HeroWalkDirection = { forward: 1, right: 0 };
export const BLAZE_ATTACK_RAMP_DURATION = 0.28;
export const BLAZE_ATTACK_HOLD_DURATION = 2;
export const BLAZE_ATTACK_RELEASE_DURATION = 0.22;
export const BLAZE_ATTACK_DURATION =
  BLAZE_ATTACK_RAMP_DURATION + BLAZE_ATTACK_HOLD_DURATION + BLAZE_ATTACK_RELEASE_DURATION;
export const HERO_ATTACK_DURATIONS: Record<HeroId, number> = {
  phantom: BLAZE_ATTACK_DURATION,
  hookshot: 0.46,
  blaze: BLAZE_ATTACK_DURATION,
  chronos: BLAZE_ATTACK_DURATION,
};

export function lerpMovementProfile(
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

export const HERO_MOVEMENT_PROFILES: Record<HeroMovementPose, HeroMovementProfile> = {
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
    rootPitch: 0.064,
    rootRoll: 0.058,
    rootBob: 0.028,
    rootSway: 0.016,
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
    cycleSpeed: 13.1,
    legPitch: 0.58,
    legStrafeRoll: 0.21,
    legStride: 0.142,
    legStrafe: 0.046,
    legLift: 0.072,
    armPitch: 0.78,
    armStrafeRoll: 0.3,
    armArcScale: 1,
    kneeBend: 0.46,
    supportKneeBend: 0.105,
    rootPitch: 0.125,
    rootRoll: 0.068,
    rootBob: 0.062,
    rootSway: 0.034,
    glowPulse: 0.12,
  },
};

export const CHRONOS_WALK_MOVEMENT_PROFILE: HeroMovementProfile = {
  ...HERO_MOVEMENT_PROFILES.walk,
  armArcScale: CHRONOS_WALK_ARM_ARC_SCALE,
};

export function getHeroMovementProfile(heroId: HeroId, pose: HeroMovementPose): HeroMovementProfile {
  if (heroId === 'chronos' && pose === 'walk') {
    return CHRONOS_WALK_MOVEMENT_PROFILE;
  }

  return HERO_MOVEMENT_PROFILES[pose];
}

export const REMOTE_BODY_SOCKET_MARKERS: Record<HeroId, RemoteBodySocketMarker[]> = {
  phantom: addRemoteSocketMarkerIds([
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
  ], 'phantom.remoteSocket'),
  hookshot: addRemoteSocketMarkerIds([
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
  ], 'hookshot.remoteSocket'),
  blaze: addRemoteSocketMarkerIds([
    {
      socketName: BLAZE_ROCKET_STAFF_TIP_SOCKET_NAME,
      bone: 'rightForearm',
      position: [0.02, 0.86, -0.32],
    },
  ], 'blaze.remoteSocket'),
  chronos: addRemoteSocketMarkerIds([
    {
      socketName: CHRONOS_PRIMARY_ORB_SOCKET_NAME,
      bone: 'torso',
      position: [0, -0.16, -0.42],
    },
  ], 'chronos.remoteSocket'),
};


export const HERO_IDLE_PROFILES: Record<HeroId, HeroIdleProfile> = {
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


function teamAccentPart(part: VoxelPartDraft & Partial<TeamAccentPart>): TeamAccentPartDraft {
  const transparent = part.transparent || part.opacity !== undefined;
  return {
    emissiveIntensity: part.emissiveIntensity ?? (transparent ? 0.24 : 0.45),
    roughness: part.roughness ?? (transparent ? 0.62 : 0.38),
    metalness: part.metalness ?? (transparent ? 0.12 : 0.18),
    depthWrite: part.depthWrite ?? !transparent,
    toneMapped: part.toneMapped ?? false,
    opacity: part.opacity,
    ...part,
  };
}

export const TEAM_ACCENT_PARTS: Record<HeroId, TeamAccentPart[]> = {
  phantom: addVoxelPartMetadata([
    teamAccentPart({ material: 'accent', position: [-0.19, 1.37, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 }),
    teamAccentPart({ material: 'accent', position: [0.19, 1.37, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2 }),
    teamAccentPart({ material: 'accent', position: [-0.43, 0.77, -0.36], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.45, roughness: 0.32, metalness: 0.15, toneMapped: false, bone: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.77, -0.36], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.45, roughness: 0.32, metalness: 0.15, toneMapped: false, bone: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.43, 0.88, -0.4], scale: [0.032, 0.1, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.16, bone: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.88, -0.4], scale: [0.032, 0.1, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.16, bone: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.16, 0.18, -0.19], scale: [0.075, 0.055, 0.032], emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.1 }),
    teamAccentPart({ material: 'accent', position: [0.16, 0.18, -0.19], scale: [0.075, 0.055, 0.032], emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.1 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.44, 0.014, 0.44], transparent: true, opacity: 0.16, emissiveIntensity: 0.22, roughness: 0.65, depthWrite: false }),
  ], 'phantom.teamAccent'),
  hookshot: addVoxelPartMetadata([
    teamAccentPart({ material: 'accent', position: [-0.18, 1.39, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.18, 1.39, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.63, 0.91, -0.245], scale: [0.058, 0.26, 0.036], emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.2, toneMapped: false, bone: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.63, 0.66, -0.47], scale: [0.04, 0.052, 0.18], emissiveIntensity: 0.42, roughness: 0.4, metalness: 0.14, bone: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [0.63, 0.93, -0.245], scale: [0.058, 0.28, 0.036], emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.2, toneMapped: false, bone: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [0.63, 0.68, -0.47], scale: [0.04, 0.052, 0.18], emissiveIntensity: 0.42, roughness: 0.4, metalness: 0.14, bone: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.2, 0.2, -0.205], scale: [0.08, 0.05, 0.032], emissiveIntensity: 0.42, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.2, 0.2, -0.205], scale: [0.08, 0.05, 0.032], emissiveIntensity: 0.42, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.46, 0.014, 0.46], transparent: true, opacity: 0.16, emissiveIntensity: 0.22, roughness: 0.65, depthWrite: false }),
  ], 'hookshot.teamAccent'),
  blaze: addVoxelPartMetadata([
    teamAccentPart({ material: 'accent', position: [-0.26, 1.38, -0.215], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.5, roughness: 0.34, metalness: 0.22, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.26, 1.38, -0.215], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.5, roughness: 0.34, metalness: 0.22, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.19, 1.01, -0.252], scale: [0.06, 0.13, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.18 }),
    teamAccentPart({ material: 'accent', position: [0.19, 1.01, -0.252], scale: [0.06, 0.13, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.18 }),
    teamAccentPart({ material: 'accent', position: [-0.43, 0.47, -0.15], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.14, bone: 'leftArm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.77, -0.36], scale: [0.034, 0.08, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.14, bone: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.17, 0.24, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.17, 0.24, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0, 1.88, -0.282], scale: [0.28, 0.036, 0.03], emissiveIntensity: 0.48, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', kind: 'cylinder', position: [0.52, 1.51, -0.38], scale: [0.12, 0.034, 0.12], emissiveIntensity: 0.46, roughness: 0.35, metalness: 0.18, toneMapped: false, bone: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [0.43, 0.88, -0.4], scale: [0.032, 0.1, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.16, bone: 'rightForearm' }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.42, 0.014, 0.42], transparent: true, opacity: 0.16, emissiveIntensity: 0.24, roughness: 0.65, depthWrite: false }),
  ], 'blaze.teamAccent'),
  chronos: addVoxelPartMetadata([
    teamAccentPart({ material: 'accent', position: [-0.22, 1.38, -0.225], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.48, roughness: 0.34, metalness: 0.18, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.22, 1.38, -0.225], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.48, roughness: 0.34, metalness: 0.18, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.16, 0.2, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.16, 0.2, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.5, 0.014, 0.5], transparent: true, opacity: 0.15, emissiveIntensity: 0.23, roughness: 0.65, depthWrite: false }),
  ], 'chronos.teamAccent'),
};

export const EMPTY_TEAM_ACCENT_PARTS: TeamAccentPart[] = [];

export const HERO_BODY_MANIFESTS: Record<HeroId, HeroBodyManifest> = {
  phantom: {
    heroId: 'phantom',
    parts: PHANTOM_PARTS,
    teamAccentParts: TEAM_ACCENT_PARTS.phantom,
    remoteSocketMarkers: REMOTE_BODY_SOCKET_MARKERS.phantom,
    materialPalette: HERO_COLORS.phantom,
    idleProfile: HERO_IDLE_PROFILES.phantom,
    attackDurationSeconds: HERO_ATTACK_DURATIONS.phantom,
  },
  hookshot: {
    heroId: 'hookshot',
    parts: HOOKSHOT_PARTS,
    teamAccentParts: TEAM_ACCENT_PARTS.hookshot,
    remoteSocketMarkers: REMOTE_BODY_SOCKET_MARKERS.hookshot,
    materialPalette: HERO_COLORS.hookshot,
    idleProfile: HERO_IDLE_PROFILES.hookshot,
    attackDurationSeconds: HERO_ATTACK_DURATIONS.hookshot,
  },
  blaze: {
    heroId: 'blaze',
    parts: BLAZE_PARTS,
    teamAccentParts: TEAM_ACCENT_PARTS.blaze,
    remoteSocketMarkers: REMOTE_BODY_SOCKET_MARKERS.blaze,
    materialPalette: HERO_COLORS.blaze,
    idleProfile: HERO_IDLE_PROFILES.blaze,
    attackDurationSeconds: HERO_ATTACK_DURATIONS.blaze,
  },
  chronos: {
    heroId: 'chronos',
    parts: CHRONOS_PARTS,
    teamAccentParts: TEAM_ACCENT_PARTS.chronos,
    remoteSocketMarkers: REMOTE_BODY_SOCKET_MARKERS.chronos,
    materialPalette: HERO_COLORS.chronos,
    idleProfile: HERO_IDLE_PROFILES.chronos,
    attackDurationSeconds: HERO_ATTACK_DURATIONS.chronos,
  },
};

export const HERO_DEFAULT_FALLBACK_SOCKETS = {
  phantom: {
    primaryPalm: PHANTOM_DIRE_BALL_SOCKET,
    voidRayOrb: PHANTOM_VOID_RAY_SOCKET,
  },
  hookshot: {
    hookTip: HOOKSHOT_CHAIN_SOCKET,
  },
  blaze: {
    staffTip: BLAZE_ROCKET_STAFF_SOCKET,
  },
  chronos: {
    chronosPrimaryOrb: CHRONOS_PRIMARY_ORB_SOCKET,
  },
} as const;
