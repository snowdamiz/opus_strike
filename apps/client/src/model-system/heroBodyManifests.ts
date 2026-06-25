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
  type HeroSkinId,
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

export const VOID_MONARCH_COLORS: Record<MaterialKind, string> = {
  armor: '#171127',
  dark: '#05030a',
  metal: '#3d3557',
  accent: '#8b5cf6',
  glow: '#e9d5ff',
  glass: '#32224e',
  skin: '#160d22',
  void: '#010006',
  edge: '#6d5a9b',
  eye: '#fff7ff',
  mist: '#7c3aed',
};

export const TIDEBREAKER_COLORS: Record<MaterialKind, string> = {
  armor: '#17324f',
  dark: '#07111d',
  metal: '#c9a95d',
  accent: '#f59e0b',
  glow: '#67e8f9',
  glass: '#0f766e',
  skin: '#172a38',
  void: '#030910',
  edge: '#8a6f37',
  eye: '#e0ffff',
  mist: '#22d3ee',
};

export const SOLAR_FORGE_COLORS: Record<MaterialKind, string> = {
  armor: '#6b1d14',
  dark: '#140807',
  metal: '#f6d58c',
  accent: '#ef4444',
  glow: '#fff7ad',
  glass: '#fb7185',
  skin: '#35130f',
  void: '#090302',
  edge: '#b45309',
  eye: '#fff6d0',
  mist: '#ffb703',
};

export const EPOCH_REGENT_COLORS: Record<MaterialKind, string> = {
  armor: '#10362f',
  dark: '#06110f',
  metal: '#d6b36a',
  accent: '#2563eb',
  glow: '#7dd3fc',
  glass: '#34d399',
  skin: '#173029',
  void: '#020807',
  edge: '#8b5cf6',
  eye: '#ecfeff',
  mist: '#2dd4bf',
};

export const NIGHTGLASS_WRAITH_COLORS: Record<MaterialKind, string> = {
  armor: '#1f2937',
  dark: '#030712',
  metal: '#475569',
  accent: '#a855f7',
  glow: '#bae6fd',
  glass: '#111827',
  skin: '#171024',
  void: '#01030a',
  edge: '#64748b',
  eye: '#f0f9ff',
  mist: '#38bdf8',
};

export const ASTRAL_EXECUTIONER_COLORS: Record<MaterialKind, string> = {
  armor: '#1e1b4b',
  dark: '#050414',
  metal: '#f0abfc',
  accent: '#22d3ee',
  glow: '#f5d0fe',
  glass: '#312e81',
  skin: '#19112c',
  void: '#020113',
  edge: '#c084fc',
  eye: '#ecfeff',
  mist: '#818cf8',
};

export const ECLIPSE_SERAPH_COLORS: Record<MaterialKind, string> = {
  armor: '#f8fafc',
  dark: '#09090b',
  metal: '#facc15',
  accent: '#c084fc',
  glow: '#ffffff',
  glass: '#1e1b4b',
  skin: '#1f1235',
  void: '#020006',
  edge: '#a78bfa',
  eye: '#fefce8',
  mist: '#f0abfc',
};

export const IRON_LEVIATHAN_COLORS: Record<MaterialKind, string> = {
  armor: '#1f2937',
  dark: '#07111d',
  metal: '#94a3b8',
  accent: '#f97316',
  glow: '#93c5fd',
  glass: '#0f172a',
  skin: '#172033',
  void: '#020617',
  edge: '#475569',
  eye: '#dbeafe',
  mist: '#60a5fa',
};

export const ABYSSAL_CORSAIR_COLORS: Record<MaterialKind, string> = {
  armor: '#0f172a',
  dark: '#020617',
  metal: '#a3e635',
  accent: '#06b6d4',
  glow: '#a7f3d0',
  glass: '#164e63',
  skin: '#12242e',
  void: '#01080c',
  edge: '#7c3aed',
  eye: '#ecfeff',
  mist: '#22d3ee',
};

export const KRAKEN_SOVEREIGN_COLORS: Record<MaterialKind, string> = {
  armor: '#172554',
  dark: '#020617',
  metal: '#fbbf24',
  accent: '#2dd4bf',
  glow: '#ccfbf1',
  glass: '#0f766e',
  skin: '#11223f',
  void: '#010313',
  edge: '#818cf8',
  eye: '#f0fdfa',
  mist: '#67e8f9',
};

export const ASHEN_VANGUARD_COLORS: Record<MaterialKind, string> = {
  armor: '#3f1d18',
  dark: '#09090b',
  metal: '#9ca3af',
  accent: '#ef4444',
  glow: '#f97316',
  glass: '#7f1d1d',
  skin: '#231614',
  void: '#030202',
  edge: '#57534e',
  eye: '#fed7aa',
  mist: '#fb923c',
};

export const INFERNO_ARCHON_COLORS: Record<MaterialKind, string> = {
  armor: '#7f1d1d',
  dark: '#16040b',
  metal: '#fef08a',
  accent: '#e879f9',
  glow: '#fdba74',
  glass: '#fb7185',
  skin: '#3a111a',
  void: '#09020a',
  edge: '#f43f5e',
  eye: '#fff7ed',
  mist: '#f0abfc',
};

export const STARFALL_PHOENIX_COLORS: Record<MaterialKind, string> = {
  armor: '#451a03',
  dark: '#09090b',
  metal: '#fde68a',
  accent: '#38bdf8',
  glow: '#fff7ad',
  glass: '#f97316',
  skin: '#2d1508',
  void: '#020617',
  edge: '#fb923c',
  eye: '#fefce8',
  mist: '#facc15',
};

export const PARADOX_SENTINEL_COLORS: Record<MaterialKind, string> = {
  armor: '#1e3a5f',
  dark: '#06111d',
  metal: '#c08457',
  accent: '#60a5fa',
  glow: '#bbf7d0',
  glass: '#1d4ed8',
  skin: '#14283a',
  void: '#020817',
  edge: '#38bdf8',
  eye: '#ecfeff',
  mist: '#34d399',
};

export const MERIDIAN_ORACLE_COLORS: Record<MaterialKind, string> = {
  armor: '#ecfeff',
  dark: '#082f49',
  metal: '#a7f3d0',
  accent: '#2563eb',
  glow: '#ccfbf1',
  glass: '#67e8f9',
  skin: '#12343a',
  void: '#03121a',
  edge: '#f0abfc',
  eye: '#ffffff',
  mist: '#7dd3fc',
};

export const ETERNITY_SOVEREIGN_COLORS: Record<MaterialKind, string> = {
  armor: '#f8fafc',
  dark: '#08111f',
  metal: '#facc15',
  accent: '#22c55e',
  glow: '#ffffff',
  glass: '#a78bfa',
  skin: '#17302b',
  void: '#020617',
  edge: '#38bdf8',
  eye: '#fefce8',
  mist: '#34d399',
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
  { material: 'void', position: [-0.14, 0.37, 0.02], scale: [0.14, 0.66, 0.17], bone: 'leftShin' },
  { material: 'void', position: [0.14, 0.37, 0.02], scale: [0.14, 0.66, 0.17], bone: 'rightShin' },
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
  { material: 'void', position: [0, 0.75, 0.02], scale: [0.34, 0.24, 0.25] },
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

export const VOID_MONARCH_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.62, 0.012, 0.62], transparent: true },
  { material: 'edge', position: [0, 1.88, -0.22], scale: [0.38, 0.045, 0.035], emissive: true },
  { material: 'armor', position: [-0.16, 1.94, -0.05], scale: [0.1, 0.18, 0.18], rotation: [0, 0, 0.22] },
  { material: 'armor', position: [0.16, 1.94, -0.05], scale: [0.1, 0.18, 0.18], rotation: [0, 0, -0.22] },
  { material: 'edge', position: [0, 2.0, -0.045], scale: [0.1, 0.24, 0.18] },
  { material: 'glow', position: [0, 1.78, -0.236], scale: [0.24, 0.026, 0.022], emissive: true },
  { material: 'metal', position: [-0.34, 1.38, -0.225], scale: [0.18, 0.045, 0.034] },
  { material: 'metal', position: [0.34, 1.38, -0.225], scale: [0.18, 0.045, 0.034] },
  { material: 'edge', position: [-0.34, 1.46, -0.18], scale: [0.16, 0.04, 0.04] },
  { material: 'edge', position: [0.34, 1.46, -0.18], scale: [0.16, 0.04, 0.04] },
  { material: 'metal', position: [0, 1.32, -0.244], scale: [0.3, 0.035, 0.026], emissive: true },
  { material: 'edge', position: [0, 1.08, -0.255], scale: [0.22, 0.032, 0.024], emissive: true },
  { material: 'metal', position: [-0.43, 0.78, -0.405], scale: [0.08, 0.026, 0.03], bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.78, -0.405], scale: [0.08, 0.026, 0.03], bone: 'rightForearm' },
  { material: 'glow', position: [-0.43, 0.72, -0.385], scale: [0.034, 0.034, 0.018], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.43, 0.72, -0.385], scale: [0.034, 0.034, 0.018], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
  { material: 'metal', position: [0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
  { material: 'edge', position: [-0.15, 0.25, -0.07], scale: [0.1, 0.025, 0.026] },
  { material: 'edge', position: [0.15, 0.25, -0.07], scale: [0.1, 0.025, 0.026] },
], 'phantom.voidMonarch.body');

export const TIDEBREAKER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.66, 0.012, 0.66], transparent: true },
  { material: 'metal', position: [-0.37, 1.42, -0.19], scale: [0.18, 0.044, 0.034] },
  { material: 'metal', position: [0.37, 1.42, -0.19], scale: [0.18, 0.044, 0.034] },
  { material: 'edge', position: [-0.35, 1.34, -0.225], scale: [0.16, 0.034, 0.03] },
  { material: 'edge', position: [0.35, 1.34, -0.225], scale: [0.16, 0.034, 0.03] },
  { material: 'accent', position: [0, 1.22, -0.262], scale: [0.28, 0.034, 0.026], emissive: true },
  { material: 'glow', position: [0, 1.09, -0.268], scale: [0.16, 0.026, 0.024], emissive: true },
  { material: 'metal', position: [-0.6, 0.96, -0.305], scale: [0.17, 0.046, 0.034], bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.98, -0.305], scale: [0.17, 0.046, 0.034], bone: 'rightForearm' },
  { material: 'accent', position: [-0.6, 0.7, -0.675], scale: [0.042, 0.05, 0.17], emissive: true, bone: 'leftForearm' },
  { material: 'accent', position: [0.6, 0.73, -0.675], scale: [0.042, 0.05, 0.17], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [-0.6, 0.7, -0.565], scale: [0.068, 0.068, 0.068], emissive: true, bone: 'leftForearm' },
  { material: 'glow', kind: 'sphere', position: [0.6, 0.73, -0.565], scale: [0.072, 0.072, 0.072], emissive: true, bone: 'rightForearm' },
  { material: 'edge', position: [0, 1.78, -0.225], scale: [0.34, 0.038, 0.032], emissive: true },
  { material: 'metal', position: [-0.16, 1.89, -0.03], scale: [0.08, 0.18, 0.16], rotation: [0, 0, 0.28] },
  { material: 'metal', position: [0.16, 1.89, -0.03], scale: [0.08, 0.18, 0.16], rotation: [0, 0, -0.28] },
], 'hookshot.tidebreaker.body');

export const SOLAR_FORGE_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.58, 0.012, 0.58], transparent: true },
  { material: 'metal', position: [-0.28, 1.39, -0.225], scale: [0.14, 0.044, 0.034] },
  { material: 'metal', position: [0.28, 1.39, -0.225], scale: [0.14, 0.044, 0.034] },
  { material: 'accent', position: [0, 1.28, -0.262], scale: [0.28, 0.044, 0.032], emissive: true },
  { material: 'glow', position: [0, 1.1, -0.265], scale: [0.12, 0.24, 0.028], emissive: true },
  { material: 'metal', position: [-0.17, 0.45, -0.085], scale: [0.12, 0.032, 0.03] },
  { material: 'metal', position: [0.17, 0.45, -0.085], scale: [0.12, 0.032, 0.03] },
  { material: 'edge', position: [-0.17, 0.25, -0.085], scale: [0.11, 0.026, 0.026] },
  { material: 'edge', position: [0.17, 0.25, -0.085], scale: [0.11, 0.026, 0.026] },
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.5, -0.38], scale: [0.115, 0.028, 0.115], emissive: true, bone: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.37, -0.38], scale: [0.1, 0.024, 0.1], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.7, -0.38], scale: [0.16, 0.16, 0.16], emissive: true, bone: 'rightForearm' },
  { material: 'edge', position: [-0.43, 0.52, -0.15], scale: [0.08, 0.026, 0.024], bone: 'leftArm' },
  { material: 'edge', position: [0.43, 0.82, -0.39], scale: [0.08, 0.026, 0.024], bone: 'rightForearm' },
  { material: 'metal', kind: 'cone', position: [0.02, 2.4, -0.02], scale: [0.18, 0.24, 0.18], rotation: [0, 0, -0.12] },
  { material: 'glow', kind: 'sphere', position: [0.08, 2.54, -0.02], scale: [0.06, 0.06, 0.06], emissive: true },
], 'blaze.solarForge.body');

export const EPOCH_REGENT_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.66, 0.012, 0.66], transparent: true },
  { material: 'metal', position: [-0.3, 1.42, -0.225], scale: [0.14, 0.044, 0.034] },
  { material: 'metal', position: [0.3, 1.42, -0.225], scale: [0.14, 0.044, 0.034] },
  { material: 'edge', position: [0, 1.5, 0.23], scale: [0.56, 0.046, 0.042], emissive: true },
  { material: 'accent', position: [0, 1.16, -0.266], scale: [0.24, 0.034, 0.026], emissive: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.16, -0.278], scale: [0.22, 0.016, 0.22], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', position: [-0.14, 0.45, -0.08], scale: [0.1, 0.032, 0.03] },
  { material: 'metal', position: [0.14, 0.45, -0.08], scale: [0.1, 0.032, 0.03] },
  { material: 'edge', position: [-0.14, 0.25, -0.08], scale: [0.09, 0.026, 0.026] },
  { material: 'edge', position: [0.14, 0.25, -0.08], scale: [0.09, 0.026, 0.026] },
  { material: 'metal', position: [-0.43, 0.78, -0.38], scale: [0.08, 0.026, 0.026], bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.78, -0.38], scale: [0.08, 0.026, 0.026], bone: 'rightForearm' },
  { material: 'glow', position: [-0.43, 0.71, -0.37], scale: [0.034, 0.034, 0.018], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.43, 0.71, -0.37], scale: [0.034, 0.034, 0.018], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [0, 1.9, -0.04], scale: [0.08, 0.22, 0.17] },
  { material: 'glow', position: [0, 1.75, -0.225], scale: [0.22, 0.026, 0.022], emissive: true },
], 'chronos.epochRegent.body');

export const NIGHTGLASS_WRAITH_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.6, 0.012, 0.6], transparent: true },
  { material: 'glass', position: [-0.33, 1.42, -0.19], scale: [0.13, 0.18, 0.032], rotation: [0, 0, -0.34], transparent: true },
  { material: 'glass', position: [0.33, 1.42, -0.19], scale: [0.13, 0.18, 0.032], rotation: [0, 0, 0.34], transparent: true },
  { material: 'metal', position: [-0.3, 1.28, -0.225], scale: [0.18, 0.04, 0.03] },
  { material: 'metal', position: [0.3, 1.28, -0.225], scale: [0.18, 0.04, 0.03] },
  { material: 'edge', position: [0, 1.18, -0.262], scale: [0.22, 0.032, 0.024], emissive: true },
  { material: 'glow', position: [0, 1.02, -0.262], scale: [0.12, 0.05, 0.024], emissive: true },
  { material: 'glass', position: [0, 1.79, -0.235], scale: [0.28, 0.038, 0.026], transparent: true },
  { material: 'edge', position: [0, 1.9, -0.06], scale: [0.1, 0.18, 0.16] },
  { material: 'glow', position: [-0.43, 0.73, -0.405], scale: [0.032, 0.08, 0.022], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.43, 0.73, -0.405], scale: [0.032, 0.08, 0.022], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.15, 0.46, -0.09], scale: [0.1, 0.03, 0.028] },
  { material: 'metal', position: [0.15, 0.46, -0.09], scale: [0.1, 0.03, 0.028] },
], 'phantom.nightglassWraith.body');

export const ASTRAL_EXECUTIONER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.7, 0.012, 0.7], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.92, -0.1], scale: [0.34, 0.018, 0.34], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', position: [-0.16, 1.98, -0.04], scale: [0.08, 0.2, 0.16], rotation: [0, 0, 0.22] },
  { material: 'metal', position: [0.16, 1.98, -0.04], scale: [0.08, 0.2, 0.16], rotation: [0, 0, -0.22] },
  { material: 'accent', position: [0, 1.24, -0.268], scale: [0.32, 0.038, 0.024], emissive: true },
  { material: 'glow', position: [0, 1.12, -0.276], scale: [0.1, 0.24, 0.024], emissive: true },
  { material: 'glass', kind: 'sphere', position: [-0.2, 1.22, -0.285], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [0.2, 1.22, -0.285], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true },
  { material: 'edge', position: [-0.5, 0.8, -0.54], scale: [0.042, 0.07, 0.23], rotation: [0, 0.22, 0], emissive: true, bone: 'leftForearm' },
  { material: 'edge', position: [0.5, 0.8, -0.54], scale: [0.042, 0.07, 0.23], rotation: [0, -0.22, 0], emissive: true, bone: 'rightForearm' },
  { material: 'glow', position: [-0.5, 0.63, -0.62], scale: [0.028, 0.048, 0.16], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.5, 0.63, -0.62], scale: [0.028, 0.048, 0.16], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.2, 0.4, -0.08], scale: [0.13, 0.03, 0.028] },
  { material: 'metal', position: [0.2, 0.4, -0.08], scale: [0.13, 0.03, 0.028] },
], 'phantom.astralExecutioner.body');

export const ECLIPSE_SERAPH_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.82, 0.012, 0.82], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 2.06, -0.08], scale: [0.42, 0.014, 0.42], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', kind: 'cylinder', position: [0, 1.98, -0.08], scale: [0.26, 0.016, 0.26], rotation: [Math.PI / 2, 0, 0], emissive: true },
  { material: 'metal', position: [-0.18, 1.92, -0.04], scale: [0.08, 0.24, 0.17], rotation: [0, 0, 0.32] },
  { material: 'metal', position: [0.18, 1.92, -0.04], scale: [0.08, 0.24, 0.17], rotation: [0, 0, -0.32] },
  { material: 'glow', position: [-0.52, 1.38, 0.2], scale: [0.08, 0.6, 0.028], rotation: [0, 0, -0.46], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.52, 1.38, 0.2], scale: [0.08, 0.6, 0.028], rotation: [0, 0, 0.46], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [-0.68, 1.17, 0.22], scale: [0.06, 0.46, 0.026], rotation: [0, 0, -0.72], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0.68, 1.17, 0.22], scale: [0.06, 0.46, 0.026], rotation: [0, 0, 0.72], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.34, -0.266], scale: [0.36, 0.036, 0.024], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.12, -0.286], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [-0.32, 1.2, -0.29], scale: [0.052, 0.052, 0.052], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [0.32, 1.2, -0.29], scale: [0.052, 0.052, 0.052], emissive: true, transparent: true },
  { material: 'metal', position: [-0.48, 0.78, -0.42], scale: [0.1, 0.03, 0.026], bone: 'leftForearm' },
  { material: 'metal', position: [0.48, 0.78, -0.42], scale: [0.1, 0.03, 0.026], bone: 'rightForearm' },
  { material: 'glow', position: [-0.48, 0.66, -0.46], scale: [0.03, 0.08, 0.038], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.48, 0.66, -0.46], scale: [0.03, 0.08, 0.038], emissive: true, bone: 'rightForearm' },
], 'phantom.eclipseSeraph.body');

export const IRON_LEVIATHAN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.64, 0.012, 0.64], transparent: true },
  { material: 'metal', position: [-0.42, 1.36, -0.08], scale: [0.22, 0.18, 0.08], rotation: [0, 0, -0.18] },
  { material: 'metal', position: [0.42, 1.36, -0.08], scale: [0.22, 0.18, 0.08], rotation: [0, 0, 0.18] },
  { material: 'edge', position: [-0.42, 1.22, -0.2], scale: [0.2, 0.042, 0.032] },
  { material: 'edge', position: [0.42, 1.22, -0.2], scale: [0.2, 0.042, 0.032] },
  { material: 'accent', position: [0, 1.15, -0.268], scale: [0.26, 0.036, 0.026], emissive: true },
  { material: 'metal', kind: 'cone', position: [0, 1.9, -0.04], scale: [0.18, 0.22, 0.18], rotation: [0, 0, Math.PI] },
  { material: 'glow', position: [-0.6, 0.7, -0.76], scale: [0.038, 0.046, 0.16], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.6, 0.73, -0.76], scale: [0.038, 0.046, 0.16], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.6, 0.88, -0.36], scale: [0.2, 0.042, 0.034], bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.9, -0.36], scale: [0.2, 0.042, 0.034], bone: 'rightForearm' },
  { material: 'edge', position: [-0.19, 0.5, -0.12], scale: [0.12, 0.03, 0.026] },
  { material: 'edge', position: [0.19, 0.5, -0.12], scale: [0.12, 0.03, 0.026] },
], 'hookshot.ironLeviathan.body');

export const ABYSSAL_CORSAIR_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.72, 0.012, 0.72], transparent: true },
  { material: 'metal', position: [-0.23, 1.86, -0.04], scale: [0.16, 0.07, 0.18], rotation: [0, 0, -0.42] },
  { material: 'metal', position: [0.23, 1.86, -0.04], scale: [0.16, 0.07, 0.18], rotation: [0, 0, 0.42] },
  { material: 'edge', position: [0, 1.9, -0.05], scale: [0.16, 0.15, 0.16] },
  { material: 'accent', position: [0, 1.22, -0.272], scale: [0.34, 0.034, 0.024], emissive: true },
  { material: 'glow', kind: 'sphere', position: [-0.2, 1.14, -0.288], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0.2, 1.14, -0.288], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { material: 'glass', kind: 'cylinder', position: [-0.6, 0.7, -0.62], scale: [0.062, 0.18, 0.062], emissive: true, transparent: true, bone: 'leftForearm' },
  { material: 'glass', kind: 'cylinder', position: [0.6, 0.73, -0.62], scale: [0.062, 0.18, 0.062], emissive: true, transparent: true, bone: 'rightForearm' },
  { material: 'edge', position: [-0.72, 0.7, -0.78], scale: [0.036, 0.044, 0.14], rotation: [0, 0.52, 0], emissive: true, bone: 'leftForearm' },
  { material: 'edge', position: [0.72, 0.73, -0.78], scale: [0.036, 0.044, 0.14], rotation: [0, -0.52, 0], emissive: true, bone: 'rightForearm' },
  { material: 'accent', position: [-0.54, 1.08, 0.19], scale: [0.05, 0.34, 0.026], rotation: [0, 0, -0.34], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0.54, 1.08, 0.19], scale: [0.05, 0.34, 0.026], rotation: [0, 0, 0.34], emissive: true, bone: 'torso' },
], 'hookshot.abyssalCorsair.body');

export const KRAKEN_SOVEREIGN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.86, 0.012, 0.86], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.98, -0.09], scale: [0.38, 0.014, 0.38], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', position: [-0.2, 1.94, -0.03], scale: [0.09, 0.24, 0.18], rotation: [0, 0, 0.28] },
  { material: 'metal', position: [0.2, 1.94, -0.03], scale: [0.09, 0.24, 0.18], rotation: [0, 0, -0.28] },
  { material: 'metal', position: [-0.48, 1.42, -0.09], scale: [0.24, 0.2, 0.08], rotation: [0, 0, -0.24] },
  { material: 'metal', position: [0.48, 1.42, -0.09], scale: [0.24, 0.2, 0.08], rotation: [0, 0, 0.24] },
  { material: 'glow', position: [-0.74, 1.14, 0.2], scale: [0.06, 0.52, 0.026], rotation: [0, 0, -0.56], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.74, 1.14, 0.2], scale: [0.06, 0.52, 0.026], rotation: [0, 0, 0.56], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0, 1.2, -0.282], scale: [0.38, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.06, -0.3], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
  { material: 'metal', position: [-0.6, 0.92, -0.38], scale: [0.22, 0.046, 0.036], bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.94, -0.38], scale: [0.22, 0.046, 0.036], bone: 'rightForearm' },
  { material: 'glow', position: [-0.75, 0.7, -0.82], scale: [0.048, 0.052, 0.18], rotation: [0, 0.54, 0], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [-0.45, 0.7, -0.82], scale: [0.048, 0.052, 0.18], rotation: [0, -0.54, 0], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.45, 0.73, -0.82], scale: [0.048, 0.052, 0.18], rotation: [0, 0.54, 0], emissive: true, bone: 'rightForearm' },
  { material: 'glow', position: [0.75, 0.73, -0.82], scale: [0.048, 0.052, 0.18], rotation: [0, -0.54, 0], emissive: true, bone: 'rightForearm' },
], 'hookshot.krakenSovereign.body');

export const ASHEN_VANGUARD_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.58, 0.012, 0.58], transparent: true },
  { material: 'metal', position: [-0.31, 1.38, -0.215], scale: [0.16, 0.05, 0.036] },
  { material: 'metal', position: [0.31, 1.38, -0.215], scale: [0.16, 0.05, 0.036] },
  { material: 'edge', position: [0, 1.28, -0.266], scale: [0.3, 0.036, 0.026], emissive: true },
  { material: 'glow', position: [0, 1.08, -0.27], scale: [0.12, 0.18, 0.026], emissive: true },
  { material: 'metal', position: [-0.18, 0.48, -0.095], scale: [0.13, 0.032, 0.03] },
  { material: 'metal', position: [0.18, 0.48, -0.095], scale: [0.13, 0.032, 0.03] },
  { material: 'edge', position: [-0.43, 0.5, -0.15], scale: [0.085, 0.032, 0.028], bone: 'leftArm' },
  { material: 'edge', position: [0.43, 0.82, -0.39], scale: [0.085, 0.032, 0.028], bone: 'rightForearm' },
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.12, 0.03, 0.12], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.7, -0.38], scale: [0.13, 0.13, 0.13], emissive: true, bone: 'rightForearm' },
  { material: 'metal', kind: 'cone', position: [0.02, 2.36, -0.02], scale: [0.16, 0.2, 0.16], rotation: [0, 0, -0.12] },
], 'blaze.ashenVanguard.body');

export const INFERNO_ARCHON_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.72, 0.012, 0.72], transparent: true },
  { material: 'metal', position: [-0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, 0.36] },
  { material: 'metal', position: [0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, -0.36] },
  { material: 'glow', position: [-0.55, 1.32, 0.2], scale: [0.07, 0.5, 0.026], rotation: [0, 0, -0.5], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.55, 1.32, 0.2], scale: [0.07, 0.5, 0.026], rotation: [0, 0, 0.5], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [-0.67, 1.08, 0.22], scale: [0.05, 0.36, 0.024], rotation: [0, 0, -0.74], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0.67, 1.08, 0.22], scale: [0.05, 0.36, 0.024], rotation: [0, 0, 0.74], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.32, -0.27], scale: [0.34, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.292], scale: [0.08, 0.08, 0.08], emissive: true, transparent: true },
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.14, 0.03, 0.14], emissive: true, bone: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.62, -0.38], scale: [0.18, 0.024, 0.18], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.8, -0.38], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true, bone: 'rightForearm' },
  { material: 'edge', position: [-0.43, 0.5, -0.15], scale: [0.09, 0.04, 0.03], bone: 'leftArm' },
  { material: 'edge', position: [0.43, 0.82, -0.39], scale: [0.09, 0.04, 0.03], bone: 'rightForearm' },
], 'blaze.infernoArchon.body');

export const STARFALL_PHOENIX_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.86, 0.012, 0.86], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 2.14, -0.04], scale: [0.34, 0.014, 0.34], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', kind: 'cone', position: [0.02, 2.44, -0.02], scale: [0.2, 0.28, 0.2], rotation: [0, 0, -0.12] },
  { material: 'glow', kind: 'sphere', position: [0.08, 2.6, -0.02], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true },
  { material: 'glow', position: [-0.58, 1.42, 0.2], scale: [0.08, 0.62, 0.028], rotation: [0, 0, -0.42], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.58, 1.42, 0.2], scale: [0.08, 0.62, 0.028], rotation: [0, 0, 0.42], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [-0.78, 1.18, 0.22], scale: [0.06, 0.5, 0.026], rotation: [0, 0, -0.72], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0.78, 1.18, 0.22], scale: [0.06, 0.5, 0.026], rotation: [0, 0, 0.72], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.34, -0.274], scale: [0.38, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.12, -0.298], scale: [0.1, 0.1, 0.1], emissive: true, transparent: true },
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.5, -0.38], scale: [0.16, 0.03, 0.16], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.82, -0.38], scale: [0.12, 0.12, 0.12], emissive: true, transparent: true, bone: 'rightForearm' },
  { material: 'accent', position: [0.52, 1.95, -0.38], scale: [0.07, 0.16, 0.07], emissive: true, bone: 'rightForearm' },
], 'blaze.starfallPhoenix.body');

export const PARADOX_SENTINEL_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.64, 0.012, 0.64], transparent: true },
  { material: 'metal', position: [-0.32, 1.4, -0.22], scale: [0.15, 0.046, 0.034] },
  { material: 'metal', position: [0.32, 1.4, -0.22], scale: [0.15, 0.046, 0.034] },
  { material: 'edge', position: [0, 1.5, 0.24], scale: [0.58, 0.05, 0.044], emissive: true },
  { material: 'accent', position: [0, 1.16, -0.27], scale: [0.26, 0.036, 0.026], emissive: true },
  { material: 'glass', kind: 'cylinder', position: [0, 1.16, -0.286], scale: [0.22, 0.016, 0.22], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', position: [-0.16, 0.45, -0.08], scale: [0.12, 0.032, 0.03] },
  { material: 'metal', position: [0.16, 0.45, -0.08], scale: [0.12, 0.032, 0.03] },
  { material: 'metal', position: [-0.43, 0.78, -0.38], scale: [0.09, 0.032, 0.028], bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.78, -0.38], scale: [0.09, 0.032, 0.028], bone: 'rightForearm' },
  { material: 'glow', kind: 'cylinder', position: [-0.43, 0.69, -0.37], scale: [0.06, 0.014, 0.06], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'leftForearm' },
  { material: 'glow', kind: 'cylinder', position: [0.43, 0.69, -0.37], scale: [0.06, 0.014, 0.06], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [0, 1.9, -0.04], scale: [0.08, 0.18, 0.16] },
], 'chronos.paradoxSentinel.body');

export const MERIDIAN_ORACLE_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.74, 0.012, 0.74], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.94, -0.08], scale: [0.36, 0.014, 0.36], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', position: [-0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, 0.28] },
  { material: 'metal', position: [0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, -0.28] },
  { material: 'edge', position: [-0.46, 1.32, 0.22], scale: [0.06, 0.44, 0.026], rotation: [0, 0, -0.34], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.46, 1.32, 0.22], scale: [0.06, 0.44, 0.026], rotation: [0, 0, 0.34], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0, 1.18, -0.276], scale: [0.32, 0.036, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [-0.24, 1.18, -0.298], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0.24, 1.18, -0.298], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  { material: 'glass', kind: 'cylinder', position: [0, 1.04, -0.29], scale: [0.24, 0.014, 0.24], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', position: [-0.43, 0.78, -0.38], scale: [0.09, 0.03, 0.028], bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.78, -0.38], scale: [0.09, 0.03, 0.028], bone: 'rightForearm' },
  { material: 'glow', position: [-0.43, 0.68, -0.38], scale: [0.032, 0.09, 0.02], emissive: true, bone: 'leftForearm' },
  { material: 'glow', position: [0.43, 0.68, -0.38], scale: [0.032, 0.09, 0.02], emissive: true, bone: 'rightForearm' },
], 'chronos.meridianOracle.body');

export const ETERNITY_SOVEREIGN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.88, 0.012, 0.88], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 2.04, -0.08], scale: [0.44, 0.014, 0.44], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', kind: 'cylinder', position: [0, 1.96, -0.08], scale: [0.26, 0.016, 0.26], rotation: [Math.PI / 2, 0, 0], emissive: true },
  { material: 'metal', position: [-0.2, 1.94, -0.04], scale: [0.09, 0.25, 0.18], rotation: [0, 0, 0.3] },
  { material: 'metal', position: [0.2, 1.94, -0.04], scale: [0.09, 0.25, 0.18], rotation: [0, 0, -0.3] },
  { material: 'glow', position: [-0.56, 1.44, 0.24], scale: [0.07, 0.58, 0.028], rotation: [0, 0, -0.4], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.56, 1.44, 0.24], scale: [0.07, 0.58, 0.028], rotation: [0, 0, 0.4], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [-0.74, 1.2, 0.24], scale: [0.06, 0.48, 0.026], rotation: [0, 0, -0.68], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0.74, 1.2, 0.24], scale: [0.06, 0.48, 0.026], rotation: [0, 0, 0.68], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.32, -0.28], scale: [0.38, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.304], scale: [0.092, 0.092, 0.092], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [-0.28, 1.2, -0.3], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [0.28, 1.2, -0.3], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { material: 'metal', position: [-0.43, 0.78, -0.38], scale: [0.1, 0.03, 0.028], bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.78, -0.38], scale: [0.1, 0.03, 0.028], bone: 'rightForearm' },
  { material: 'glow', kind: 'cylinder', position: [-0.43, 0.66, -0.38], scale: [0.07, 0.014, 0.07], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'leftForearm' },
  { material: 'glow', kind: 'cylinder', position: [0.43, 0.66, -0.38], scale: [0.07, 0.014, 0.07], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'rightForearm' },
], 'chronos.eternitySovereign.body');

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

export function copyMovementProfile(
  target: HeroMovementProfile,
  source: HeroMovementProfile
): HeroMovementProfile {
  target.cycleSpeed = source.cycleSpeed;
  target.legPitch = source.legPitch;
  target.legStrafeRoll = source.legStrafeRoll;
  target.legStride = source.legStride;
  target.legStrafe = source.legStrafe;
  target.legLift = source.legLift;
  target.armPitch = source.armPitch;
  target.armStrafeRoll = source.armStrafeRoll;
  target.armArcScale = source.armArcScale;
  target.kneeBend = source.kneeBend;
  target.supportKneeBend = source.supportKneeBend;
  target.rootPitch = source.rootPitch;
  target.rootRoll = source.rootRoll;
  target.rootBob = source.rootBob;
  target.rootSway = source.rootSway;
  target.glowPulse = source.glowPulse;
  return target;
}

export function lerpMovementProfileInto(
  target: HeroMovementProfile,
  from: HeroMovementProfile,
  to: HeroMovementProfile,
  amount: number
): HeroMovementProfile {
  const t = easeInOutSine(amount);
  target.cycleSpeed = THREE.MathUtils.lerp(from.cycleSpeed, to.cycleSpeed, t);
  target.legPitch = THREE.MathUtils.lerp(from.legPitch, to.legPitch, t);
  target.legStrafeRoll = THREE.MathUtils.lerp(from.legStrafeRoll, to.legStrafeRoll, t);
  target.legStride = THREE.MathUtils.lerp(from.legStride, to.legStride, t);
  target.legStrafe = THREE.MathUtils.lerp(from.legStrafe, to.legStrafe, t);
  target.legLift = THREE.MathUtils.lerp(from.legLift, to.legLift, t);
  target.armPitch = THREE.MathUtils.lerp(from.armPitch, to.armPitch, t);
  target.armStrafeRoll = THREE.MathUtils.lerp(from.armStrafeRoll, to.armStrafeRoll, t);
  target.armArcScale = THREE.MathUtils.lerp(from.armArcScale, to.armArcScale, t);
  target.kneeBend = THREE.MathUtils.lerp(from.kneeBend, to.kneeBend, t);
  target.supportKneeBend = THREE.MathUtils.lerp(from.supportKneeBend, to.supportKneeBend, t);
  target.rootPitch = THREE.MathUtils.lerp(from.rootPitch, to.rootPitch, t);
  target.rootRoll = THREE.MathUtils.lerp(from.rootRoll, to.rootRoll, t);
  target.rootBob = THREE.MathUtils.lerp(from.rootBob, to.rootBob, t);
  target.rootSway = THREE.MathUtils.lerp(from.rootSway, to.rootSway, t);
  target.glowPulse = THREE.MathUtils.lerp(from.glowPulse, to.glowPulse, t);
  return target;
}

export function lerpMovementProfile(
  from: HeroMovementProfile,
  to: HeroMovementProfile,
  amount: number
): HeroMovementProfile {
  return lerpMovementProfileInto({} as HeroMovementProfile, from, to, amount);
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

function createSkinBodyManifest(
  heroId: HeroId,
  extraParts: readonly VoxelPart[],
  materialPalette: Record<MaterialKind, string>,
  auraPulse: number
): HeroBodyManifest {
  const base = HERO_BODY_MANIFESTS[heroId];

  return {
    ...base,
    parts: [
      ...base.parts,
      ...extraParts,
    ],
    materialPalette,
    idleProfile: {
      ...base.idleProfile,
      auraPulse,
    },
  };
}

export const HERO_SKIN_BODY_MANIFESTS: Record<HeroSkinId, HeroBodyManifest> = {
  'phantom.default': HERO_BODY_MANIFESTS.phantom,
  'hookshot.default': HERO_BODY_MANIFESTS.hookshot,
  'blaze.default': HERO_BODY_MANIFESTS.blaze,
  'chronos.default': HERO_BODY_MANIFESTS.chronos,
  'phantom.void-monarch': createSkinBodyManifest('phantom', VOID_MONARCH_EXTRA_PARTS, VOID_MONARCH_COLORS, 0.15),
  'phantom.nightglass-wraith': createSkinBodyManifest('phantom', NIGHTGLASS_WRAITH_EXTRA_PARTS, NIGHTGLASS_WRAITH_COLORS, 0.16),
  'phantom.astral-executioner': createSkinBodyManifest('phantom', ASTRAL_EXECUTIONER_EXTRA_PARTS, ASTRAL_EXECUTIONER_COLORS, 0.19),
  'phantom.eclipse-seraph': createSkinBodyManifest('phantom', ECLIPSE_SERAPH_EXTRA_PARTS, ECLIPSE_SERAPH_COLORS, 0.23),
  'hookshot.tidebreaker': createSkinBodyManifest('hookshot', TIDEBREAKER_EXTRA_PARTS, TIDEBREAKER_COLORS, 0.11),
  'hookshot.iron-leviathan': createSkinBodyManifest('hookshot', IRON_LEVIATHAN_EXTRA_PARTS, IRON_LEVIATHAN_COLORS, 0.12),
  'hookshot.abyssal-corsair': createSkinBodyManifest('hookshot', ABYSSAL_CORSAIR_EXTRA_PARTS, ABYSSAL_CORSAIR_COLORS, 0.15),
  'hookshot.kraken-sovereign': createSkinBodyManifest('hookshot', KRAKEN_SOVEREIGN_EXTRA_PARTS, KRAKEN_SOVEREIGN_COLORS, 0.19),
  'blaze.solar-forge': createSkinBodyManifest('blaze', SOLAR_FORGE_EXTRA_PARTS, SOLAR_FORGE_COLORS, 0.14),
  'blaze.ashen-vanguard': createSkinBodyManifest('blaze', ASHEN_VANGUARD_EXTRA_PARTS, ASHEN_VANGUARD_COLORS, 0.15),
  'blaze.inferno-archon': createSkinBodyManifest('blaze', INFERNO_ARCHON_EXTRA_PARTS, INFERNO_ARCHON_COLORS, 0.19),
  'blaze.starfall-phoenix': createSkinBodyManifest('blaze', STARFALL_PHOENIX_EXTRA_PARTS, STARFALL_PHOENIX_COLORS, 0.23),
  'chronos.epoch-regent': createSkinBodyManifest('chronos', EPOCH_REGENT_EXTRA_PARTS, EPOCH_REGENT_COLORS, 0.17),
  'chronos.paradox-sentinel': createSkinBodyManifest('chronos', PARADOX_SENTINEL_EXTRA_PARTS, PARADOX_SENTINEL_COLORS, 0.18),
  'chronos.meridian-oracle': createSkinBodyManifest('chronos', MERIDIAN_ORACLE_EXTRA_PARTS, MERIDIAN_ORACLE_COLORS, 0.21),
  'chronos.eternity-sovereign': createSkinBodyManifest('chronos', ETERNITY_SOVEREIGN_EXTRA_PARTS, ETERNITY_SOVEREIGN_COLORS, 0.25),
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
