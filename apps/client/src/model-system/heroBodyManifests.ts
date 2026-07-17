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

// Golden founder skins — granted to the first 50 ranked players. All four share a
// solid-gold core (bright gold metal/accents over a warm-dark base) with a small
// per-hero hue shift in the secondary glow/mist so each keeps a whisper of its
// hero identity.
export const PHANTOM_GOLDEN_COLORS: Record<MaterialKind, string> = {
  armor: '#e0a92a',
  dark: '#241803',
  metal: '#ffd700',
  accent: '#ffe9a0',
  glow: '#fff3c0',
  glass: '#6b4e12',
  skin: '#332208',
  void: '#0a0702',
  edge: '#c9a227',
  eye: '#fff7e0',
  mist: '#ffd76a',
};

export const HOOKSHOT_GOLDEN_COLORS: Record<MaterialKind, string> = {
  armor: '#d9a82f',
  dark: '#1f1804',
  metal: '#ffd700',
  accent: '#ffe98a',
  glow: '#fff4b0',
  glass: '#5f4a10',
  skin: '#2c2207',
  void: '#080602',
  edge: '#c7a02a',
  eye: '#fffbe6',
  mist: '#f5cf3a',
};

export const BLAZE_GOLDEN_COLORS: Record<MaterialKind, string> = {
  armor: '#e5a521',
  dark: '#2a1602',
  metal: '#ffd700',
  accent: '#ffdf6e',
  glow: '#ffe89a',
  glass: '#8a5510',
  skin: '#3a2306',
  void: '#0b0602',
  edge: '#d4951f',
  eye: '#fff4d0',
  mist: '#ffb733',
};

export const CHRONOS_GOLDEN_COLORS: Record<MaterialKind, string> = {
  armor: '#dcab2d',
  dark: '#1c1804',
  metal: '#ffd700',
  accent: '#ffe98a',
  glow: '#fff3b0',
  glass: '#5c4f12',
  skin: '#2a2807',
  void: '#080702',
  edge: '#c5a82a',
  eye: '#fffbe6',
  mist: '#f0d24a',
};

export const UMBRAL_REAVER_COLORS: Record<MaterialKind, string> = {
  armor: '#1a1230',
  dark: '#070411',
  metal: '#322a4a',
  accent: '#22c55e',
  glow: '#86efac',
  glass: '#1e1b3a',
  skin: '#160d22',
  void: '#010006',
  edge: '#4ade80',
  eye: '#dcfce7',
  mist: '#34d399',
};

export const OBSIDIAN_REVENANT_COLORS: Record<MaterialKind, string> = {
  armor: '#0b1020',
  dark: '#04060d',
  metal: '#1e293b',
  accent: '#06b6d4',
  glow: '#67e8f9',
  glass: '#0e1726',
  skin: '#0c1424',
  void: '#01040a',
  edge: '#22d3ee',
  eye: '#cffafe',
  mist: '#22d3ee',
};

export const CORAL_WARDEN_COLORS: Record<MaterialKind, string> = {
  armor: '#14463f',
  dark: '#06140f',
  metal: '#7fb8a4',
  accent: '#f59e0b',
  glow: '#5eead4',
  glass: '#0d9488',
  skin: '#13302a',
  void: '#03100c',
  edge: '#fb7185',
  eye: '#ccfbf1',
  mist: '#2dd4bf',
};

export const MAELSTROM_WARLORD_COLORS: Record<MaterialKind, string> = {
  armor: '#11294d',
  dark: '#050b18',
  metal: '#7c93b8',
  accent: '#38bdf8',
  glow: '#bae6fd',
  glass: '#1e3a8a',
  skin: '#101f38',
  void: '#02060f',
  edge: '#22d3ee',
  eye: '#e0f2fe',
  mist: '#60a5fa',
};

export const CINDER_WARDEN_COLORS: Record<MaterialKind, string> = {
  armor: '#2b1410',
  dark: '#0f0705',
  metal: '#52525b',
  accent: '#f97316',
  glow: '#fb923c',
  glass: '#7c2d12',
  skin: '#241310',
  void: '#080302',
  edge: '#ea580c',
  eye: '#fed7aa',
  mist: '#f97316',
};

export const PYRE_TYRANT_COLORS: Record<MaterialKind, string> = {
  armor: '#1c0a06',
  dark: '#0a0402',
  metal: '#3f3f46',
  accent: '#ef4444',
  glow: '#f59e0b',
  glass: '#dc2626',
  skin: '#1c0d08',
  void: '#060201',
  edge: '#fb923c',
  eye: '#fed7aa',
  mist: '#ef4444',
};

export const CLOCKWORK_MARSHAL_COLORS: Record<MaterialKind, string> = {
  armor: '#3a2a12',
  dark: '#120c05',
  metal: '#c79a4b',
  accent: '#f59e0b',
  glow: '#fcd34d',
  glass: '#b45309',
  skin: '#231a0c',
  void: '#070502',
  edge: '#a16207',
  eye: '#fef3c7',
  mist: '#eab308',
};

export const QUANTUM_ARBITER_COLORS: Record<MaterialKind, string> = {
  armor: '#1e1b4b',
  dark: '#070617',
  metal: '#a5b4fc',
  accent: '#8b5cf6',
  glow: '#c4b5fd',
  glass: '#6d28d9',
  skin: '#16143a',
  void: '#020114',
  edge: '#a78bfa',
  eye: '#ede9fe',
  mist: '#818cf8',
};

export const PHANTOM_LIBERTY_WRAITH_COLORS: Record<MaterialKind, string> = {
  armor: '#1d2b5f',
  dark: '#070b1c',
  metal: '#d6dbe8',
  accent: '#b22234',
  glow: '#f8fafc',
  glass: '#2f4fa3',
  skin: '#151c3d',
  void: '#020512',
  edge: '#f1f5ff',
  eye: '#ffffff',
  mist: '#d21f3c',
};

export const HOOKSHOT_LIBERTY_ANCHOR_COLORS: Record<MaterialKind, string> = {
  armor: '#173b6d',
  dark: '#071526',
  metal: '#f2f2f2',
  accent: '#b22234',
  glow: '#e6f0ff',
  glass: '#2455a4',
  skin: '#142943',
  void: '#030912',
  edge: '#bf1e2e',
  eye: '#ffffff',
  mist: '#4d79ff',
};

export const BLAZE_LIBERTY_FLARE_COLORS: Record<MaterialKind, string> = {
  armor: '#9b1c2c',
  dark: '#17070c',
  metal: '#eef2ff',
  accent: '#1f4aa8',
  glow: '#ffffff',
  glass: '#f3f7ff',
  skin: '#3a111a',
  void: '#09020a',
  edge: '#f8fafc',
  eye: '#ffffff',
  mist: '#ff334a',
};

export const CHRONOS_LIBERTY_SENTINEL_COLORS: Record<MaterialKind, string> = {
  armor: '#172b5c',
  dark: '#060c1a',
  metal: '#e5e7eb',
  accent: '#b22234',
  glow: '#ffffff',
  glass: '#3c5fb8',
  skin: '#142044',
  void: '#020513',
  edge: '#dbeafe',
  eye: '#ffffff',
  mist: '#c81e3a',
};

export const STATIC_WRAITH_COLORS: Record<MaterialKind, string> = {
  armor: '#1c1530',
  dark: '#07040f',
  metal: '#3f3860',
  accent: '#f472b6',
  glow: '#22d3ee',
  glass: '#231a3d',
  skin: '#180f26',
  void: '#020108',
  edge: '#38bdf8',
  eye: '#cffafe',
  mist: '#e879f9',
};

export const CRIMSON_LOTUS_COLORS: Record<MaterialKind, string> = {
  armor: '#2a0f1d',
  dark: '#0b0308',
  metal: '#52242f',
  accent: '#f43f5e',
  glow: '#fda4af',
  glass: '#3f0d20',
  skin: '#220a12',
  void: '#050103',
  edge: '#9f1239',
  eye: '#ffe4e6',
  mist: '#fb7185',
};

export const GLACIER_BREAKER_COLORS: Record<MaterialKind, string> = {
  armor: '#1d3b57',
  dark: '#0a1826',
  metal: '#cbd5e1',
  accent: '#38bdf8',
  glow: '#e0f2fe',
  glass: '#7dd3fc',
  skin: '#16283a',
  void: '#040c14',
  edge: '#94a3b8',
  eye: '#f0f9ff',
  mist: '#bae6fd',
};

export const VOID_ANGLER_COLORS: Record<MaterialKind, string> = {
  armor: '#141227',
  dark: '#060411',
  metal: '#2e2a4a',
  accent: '#a3e635',
  glow: '#bef264',
  glass: '#1e1b3a',
  skin: '#120e20',
  void: '#02010a',
  edge: '#4c4470',
  eye: '#f7fee7',
  mist: '#84cc16',
};

export const FROSTFIRE_HERALD_COLORS: Record<MaterialKind, string> = {
  armor: '#1c2f54',
  dark: '#0a1122',
  metal: '#64748b',
  accent: '#38bdf8',
  glow: '#a5f3fc',
  glass: '#60a5fa',
  skin: '#152238',
  void: '#03060e',
  edge: '#3b82f6',
  eye: '#e0f7ff',
  mist: '#7dd3fc',
};

export const EMBER_DRAKE_COLORS: Record<MaterialKind, string> = {
  armor: '#1a3323',
  dark: '#08120a',
  metal: '#4d7c0f',
  accent: '#34d399',
  glow: '#6ee7b7',
  glass: '#065f46',
  skin: '#132416',
  void: '#030905',
  edge: '#65a30d',
  eye: '#d1fae5',
  mist: '#10b981',
};

export const DUNE_PROPHET_COLORS: Record<MaterialKind, string> = {
  armor: '#4d3a22',
  dark: '#171008',
  metal: '#d9b56c',
  accent: '#f59e0b',
  glow: '#fcd34d',
  glass: '#b45309',
  skin: '#33261a',
  void: '#0a0603',
  edge: '#a16207',
  eye: '#fef3c7',
  mist: '#fbbf24',
};

export const ZODIAC_WEAVER_COLORS: Record<MaterialKind, string> = {
  armor: '#1e1b4b',
  dark: '#0b0a1f',
  metal: '#e2e8f0',
  accent: '#818cf8',
  glow: '#fef08a',
  glass: '#312e81',
  skin: '#161437',
  void: '#040317',
  edge: '#a5b4fc',
  eye: '#fefce8',
  mist: '#c7d2fe',
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
  // Base polish: swept cowl peak, focal chest core, and knee guards give the
  // silhouette more read at distance without changing proportions.
  { material: 'dark', position: [0, 1.85, 0.15], scale: [0.2, 0.16, 0.18], rotation: [0.4, 0, 0] },
  { material: 'edge', position: [0, 1.95, 0.12], scale: [0.12, 0.06, 0.1], rotation: [0.4, 0, 0] },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.235], scale: [0.055, 0.07, 0.04], emissive: true, transparent: true },
  { material: 'armor', position: [-0.16, 0.52, -0.1], scale: [0.11, 0.14, 0.09] },
  { material: 'armor', position: [0.16, 0.52, -0.1], scale: [0.11, 0.14, 0.09] },
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
  { material: 'metal', position: [-0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
  { material: 'metal', position: [0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
  { material: 'edge', position: [-0.15, 0.25, -0.07], scale: [0.1, 0.025, 0.026] },
  { material: 'edge', position: [0.15, 0.25, -0.07], scale: [0.1, 0.025, 0.026] },
  // Royal regalia: tall crown spire with side prongs, broad sovereign pauldrons,
  // and a short back mantle — gives the Monarch a distinct crowned silhouette.
  { material: 'metal', position: [0, 2.12, -0.02], scale: [0.05, 0.22, 0.05] },
  { material: 'glow', kind: 'sphere', position: [0, 2.26, -0.02], scale: [0.05, 0.05, 0.05], emissive: true },
  { material: 'metal', position: [-0.13, 2.04, -0.02], scale: [0.04, 0.13, 0.045], rotation: [0, 0, 0.26] },
  { material: 'metal', position: [0.13, 2.04, -0.02], scale: [0.04, 0.13, 0.045], rotation: [0, 0, -0.26] },
  { material: 'metal', position: [-0.34, 1.42, -0.02], scale: [0.18, 0.13, 0.26], rotation: [0, 0, -0.2], bone: 'torso' },
  { material: 'metal', position: [0.34, 1.42, -0.02], scale: [0.18, 0.13, 0.26], rotation: [0, 0, 0.2], bone: 'torso' },
  { material: 'edge', position: [-0.36, 1.52, -0.02], scale: [0.16, 0.05, 0.22], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.36, 1.52, -0.02], scale: [0.16, 0.05, 0.22], emissive: true, bone: 'torso' },
  { material: 'armor', position: [-0.26, 1.18, 0.21], scale: [0.16, 0.52, 0.05], rotation: [0, 0, -0.16], bone: 'torso' },
  { material: 'armor', position: [0.26, 1.18, 0.21], scale: [0.16, 0.52, 0.05], rotation: [0, 0, 0.16], bone: 'torso' },
  { material: 'accent', position: [0, 0.96, 0.24], scale: [0.42, 0.05, 0.03], emissive: true, bone: 'torso' },
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
  { material: 'edge', position: [0, 1.78, -0.225], scale: [0.34, 0.038, 0.032], emissive: true },
  { material: 'metal', position: [-0.16, 1.89, -0.03], scale: [0.08, 0.18, 0.16], rotation: [0, 0, 0.28] },
  { material: 'metal', position: [0.16, 1.89, -0.03], scale: [0.08, 0.18, 0.16], rotation: [0, 0, -0.28] },
  // Storm-forged trim: a brass crown fin, broad brass pauldrons, and swept
  // back storm-vanes that trail an amber charge line.
  { material: 'metal', position: [0, 1.99, -0.02], scale: [0.05, 0.16, 0.13] },
  { material: 'glow', kind: 'sphere', position: [0, 2.1, -0.02], scale: [0.05, 0.05, 0.05], emissive: true },
  { material: 'metal', position: [-0.35, 1.4, -0.02], scale: [0.17, 0.11, 0.24], rotation: [0, 0, -0.18], bone: 'torso' },
  { material: 'metal', position: [0.35, 1.4, -0.02], scale: [0.17, 0.11, 0.24], rotation: [0, 0, 0.18], bone: 'torso' },
  { material: 'metal', position: [-0.3, 1.36, 0.24], scale: [0.05, 0.42, 0.04], rotation: [0, 0, -0.32], bone: 'torso' },
  { material: 'metal', position: [0.3, 1.36, 0.24], scale: [0.05, 0.42, 0.04], rotation: [0, 0, 0.32], bone: 'torso' },
  { material: 'accent', position: [-0.4, 1.14, 0.25], scale: [0.04, 0.32, 0.03], rotation: [0, 0, -0.5], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0.4, 1.14, 0.25], scale: [0.04, 0.32, 0.03], rotation: [0, 0, 0.5], emissive: true, transparent: true, bone: 'torso' },
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
  { material: 'metal', kind: 'cone', position: [0.02, 2.4, -0.02], scale: [0.18, 0.24, 0.18], rotation: [0, 0, -0.12], attachmentMode: 'floating' },
  { material: 'glow', kind: 'sphere', position: [0.08, 2.54, -0.02], scale: [0.06, 0.06, 0.06], emissive: true, attachmentMode: 'floating' },
  // White-hot forge: a sun-disc halo behind the head, furnace shoulder rays, and
  // a brighter forge-gold collar across the chest.
  { material: 'glow', kind: 'cylinder', position: [0, 1.96, 0.06], scale: [0.46, 0.014, 0.46], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'metal', kind: 'cylinder', position: [0, 1.96, 0.05], scale: [0.3, 0.018, 0.3], rotation: [Math.PI / 2, 0, 0], emissive: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', position: [-0.38, 1.42, 0.18], scale: [0.05, 0.4, 0.03], rotation: [0, 0, -0.5], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.38, 1.42, 0.18], scale: [0.05, 0.4, 0.03], rotation: [0, 0, 0.5], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0, 1.32, -0.255], scale: [0.34, 0.05, 0.03], emissive: true },
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
  { material: 'metal', position: [0, 1.9, -0.04], scale: [0.08, 0.22, 0.17] },
  { material: 'glow', position: [0, 1.75, -0.225], scale: [0.22, 0.026, 0.022], emissive: true },
  // Gilded regent: a crown spire over a slow clockwork halo-gear, with a
  // paradox-blue timeglass set into the chest.
  { material: 'metal', position: [0, 2.12, -0.02], scale: [0.05, 0.2, 0.05] },
  { material: 'glow', kind: 'sphere', position: [0, 2.26, -0.02], scale: [0.05, 0.05, 0.05], emissive: true },
  { material: 'metal', position: [-0.13, 2.04, -0.02], scale: [0.04, 0.13, 0.045], rotation: [0, 0, 0.26] },
  { material: 'metal', position: [0.13, 2.04, -0.02], scale: [0.04, 0.13, 0.045], rotation: [0, 0, -0.26] },
  { material: 'metal', kind: 'cylinder', position: [0, 1.98, 0.04], scale: [0.36, 0.016, 0.36], rotation: [Math.PI / 2, 0, 0], emissive: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'cylinder', position: [0, 1.98, 0.05], scale: [0.44, 0.012, 0.44], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', kind: 'cone', position: [0, 1.18, -0.255], scale: [0.14, 0.12, 0.05], emissive: true },
  { material: 'accent', kind: 'cone', position: [0, 1.06, -0.255], scale: [0.14, 0.12, 0.05], rotation: [Math.PI, 0, 0], emissive: true },
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
  { material: 'metal', position: [-0.15, 0.46, -0.09], scale: [0.1, 0.03, 0.028] },
  { material: 'metal', position: [0.15, 0.46, -0.09], scale: [0.1, 0.03, 0.028] },
  // Smoked-crystal silhouette: jagged shard pauldrons, a fanned back crest of
  // glass shards, and a sharpened visor brow over the void mask.
  { material: 'glass', position: [-0.33, 1.52, -0.02], scale: [0.07, 0.34, 0.12], rotation: [0, 0, -0.42], transparent: true, bone: 'torso' },
  { material: 'glass', position: [0.33, 1.52, -0.02], scale: [0.07, 0.34, 0.12], rotation: [0, 0, 0.42], transparent: true, bone: 'torso' },
  { material: 'edge', position: [-0.31, 1.42, -0.05], scale: [0.05, 0.16, 0.08], rotation: [0, 0, -0.42], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.31, 1.42, -0.05], scale: [0.05, 0.16, 0.08], rotation: [0, 0, 0.42], emissive: true, bone: 'torso' },
  { material: 'glass', position: [0, 1.54, 0.2], scale: [0.05, 0.42, 0.06], transparent: true, bone: 'torso' },
  { material: 'glass', position: [-0.15, 1.44, 0.2], scale: [0.04, 0.3, 0.05], rotation: [0, 0, -0.22], transparent: true, bone: 'torso' },
  { material: 'glass', position: [0.15, 1.44, 0.2], scale: [0.04, 0.3, 0.05], rotation: [0, 0, 0.22], transparent: true, bone: 'torso' },
  { material: 'edge', position: [0, 1.56, 0.2], scale: [0.03, 0.2, 0.04], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glass', position: [0, 1.71, -0.235], scale: [0.26, 0.05, 0.03], rotation: [0.32, 0, 0], transparent: true },
  { material: 'edge', position: [0, 1.62, -0.245], scale: [0.06, 0.1, 0.03], rotation: [0.2, 0, 0], emissive: true },
], 'phantom.nightglassWraith.body');

export const ASTRAL_EXECUTIONER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.7, 0.012, 0.7], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.92, -0.1], scale: [0.34, 0.018, 0.34], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'metal', position: [-0.16, 1.98, -0.04], scale: [0.08, 0.2, 0.16], rotation: [0, 0, 0.22] },
  { material: 'metal', position: [0.16, 1.98, -0.04], scale: [0.08, 0.2, 0.16], rotation: [0, 0, -0.22] },
  { material: 'accent', position: [0, 1.24, -0.268], scale: [0.32, 0.038, 0.024], emissive: true },
  { material: 'glow', position: [0, 1.12, -0.276], scale: [0.1, 0.24, 0.024], emissive: true },
  { material: 'glass', kind: 'sphere', position: [-0.2, 1.22, -0.285], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [0.2, 1.22, -0.285], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true },
  { material: 'edge', position: [-0.5, 0.8, -0.54], scale: [0.042, 0.07, 0.23], rotation: [0, 0.22, 0], emissive: true, bone: 'leftForearm' },
  { material: 'edge', position: [0.5, 0.8, -0.54], scale: [0.042, 0.07, 0.23], rotation: [0, -0.22, 0], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.2, 0.4, -0.08], scale: [0.13, 0.03, 0.028] },
  { material: 'metal', position: [0.2, 0.4, -0.08], scale: [0.13, 0.03, 0.028] },
  // Starblade execution rig: tall blade spires off the shoulders, a radiant
  // star sigil on the chest, and slow orbital glass shards around the torso.
  { material: 'metal', position: [-0.3, 1.64, -0.02], scale: [0.05, 0.4, 0.06], rotation: [0, 0, -0.22], emissive: true, bone: 'torso' },
  { material: 'metal', position: [0.3, 1.64, -0.02], scale: [0.05, 0.4, 0.06], rotation: [0, 0, 0.22], emissive: true, bone: 'torso' },
  { material: 'edge', position: [-0.3, 1.84, -0.02], scale: [0.035, 0.12, 0.045], rotation: [0, 0, -0.22], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.3, 1.84, -0.02], scale: [0.035, 0.12, 0.045], rotation: [0, 0, 0.22], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0, 1.14, -0.27], scale: [0.08, 0.08, 0.05], emissive: true, transparent: true },
  { material: 'accent', position: [0, 1.14, -0.27], scale: [0.04, 0.26, 0.03], emissive: true, transparent: true },
  { material: 'accent', position: [0, 1.14, -0.27], scale: [0.26, 0.04, 0.03], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [-0.32, 1.78, -0.04], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'head' },
  { material: 'glass', kind: 'sphere', position: [0.32, 1.72, -0.04], scale: [0.04, 0.04, 0.04], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'head' },
], 'phantom.astralExecutioner.body');

export const ECLIPSE_SERAPH_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.82, 0.012, 0.82], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 2.06, -0.08], scale: [0.42, 0.014, 0.42], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'metal', kind: 'cylinder', position: [0, 1.98, -0.08], scale: [0.26, 0.016, 0.26], rotation: [Math.PI / 2, 0, 0], emissive: true, attachmentMode: 'floating' },
  { material: 'metal', position: [-0.18, 1.92, -0.04], scale: [0.08, 0.24, 0.17], rotation: [0, 0, 0.32] },
  { material: 'metal', position: [0.18, 1.92, -0.04], scale: [0.08, 0.24, 0.17], rotation: [0, 0, -0.32] },
  // Eclipse motif: a dark void disc fills the halo so the ring reads as a glowing
  // corona, ringed by prismatic glints. (Unique to this skin — replaces wings.)
  { material: 'void', kind: 'cylinder', position: [0, 2.06, -0.08], scale: [0.33, 0.01, 0.33], rotation: [Math.PI / 2, 0, 0], attachmentMode: 'floating' },
  { material: 'glow', kind: 'sphere', position: [0, 2.48, -0.08], scale: [0.032, 0.032, 0.032], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'accent', kind: 'sphere', position: [0, 1.64, -0.08], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'accent', kind: 'sphere', position: [-0.42, 2.06, -0.08], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'glow', kind: 'sphere', position: [0.42, 2.06, -0.08], scale: [0.032, 0.032, 0.032], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'metal', position: [0, 1.34, -0.266], scale: [0.36, 0.036, 0.024], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.12, -0.286], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [-0.32, 1.2, -0.29], scale: [0.052, 0.052, 0.052], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [0.32, 1.2, -0.29], scale: [0.052, 0.052, 0.052], emissive: true, transparent: true },
  // Eclipse ascension: upright prismatic shoulder crystals and a rayed crown for
  // the legendary read (replaces the old wing tier).
  { material: 'glass', position: [-0.2, 1.62, -0.04], scale: [0.05, 0.18, 0.05], rotation: [0, 0, 0.3], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glass', position: [0.2, 1.62, -0.04], scale: [0.05, 0.18, 0.05], rotation: [0, 0, -0.3], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [-0.2, 1.74, -0.04], scale: [0.03, 0.1, 0.03], rotation: [0, 0, 0.3], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0.2, 1.74, -0.04], scale: [0.03, 0.1, 0.03], rotation: [0, 0, -0.3], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 2.02, -0.04], scale: [0.04, 0.18, 0.05], emissive: true },
  { material: 'metal', position: [-0.14, 1.97, -0.04], scale: [0.035, 0.13, 0.045], rotation: [0, 0, 0.24], emissive: true },
  { material: 'metal', position: [0.14, 1.97, -0.04], scale: [0.035, 0.13, 0.045], rotation: [0, 0, -0.24], emissive: true },
  { material: 'glass', kind: 'sphere', position: [0, 1.14, -0.28], scale: [0.085, 0.095, 0.06], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.14, -0.26], scale: [0.05, 0.05, 0.04], emissive: true, transparent: true },
], 'phantom.eclipseSeraph.body');

export const IRON_LEVIATHAN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.64, 0.012, 0.64], transparent: true },
  { material: 'metal', position: [-0.42, 1.36, -0.08], scale: [0.22, 0.18, 0.08], rotation: [0, 0, -0.18] },
  { material: 'metal', position: [0.42, 1.36, -0.08], scale: [0.22, 0.18, 0.08], rotation: [0, 0, 0.18] },
  { material: 'edge', position: [-0.42, 1.22, -0.2], scale: [0.2, 0.042, 0.032] },
  { material: 'edge', position: [0.42, 1.22, -0.2], scale: [0.2, 0.042, 0.032] },
  { material: 'accent', position: [0, 1.15, -0.268], scale: [0.26, 0.036, 0.026], emissive: true },
  { material: 'metal', kind: 'cone', position: [0, 1.9, -0.04], scale: [0.18, 0.22, 0.18], rotation: [0, 0, Math.PI] },
  { material: 'metal', position: [-0.6, 0.88, -0.36], scale: [0.2, 0.042, 0.034], bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.9, -0.36], scale: [0.2, 0.042, 0.034], bone: 'rightForearm' },
  { material: 'edge', position: [-0.19, 0.5, -0.12], scale: [0.12, 0.03, 0.026] },
  { material: 'edge', position: [0.19, 0.5, -0.12], scale: [0.12, 0.03, 0.026] },
  // Heavy dive rig: tall keel spikes off the iron pauldrons, twin back dive-fins
  // venting blue furnace light, and a forward helm horn.
  { material: 'metal', position: [-0.43, 1.52, -0.04], scale: [0.08, 0.24, 0.1], rotation: [0, 0, -0.3], bone: 'torso' },
  { material: 'metal', position: [0.43, 1.52, -0.04], scale: [0.08, 0.24, 0.1], rotation: [0, 0, 0.3], bone: 'torso' },
  { material: 'metal', position: [-0.16, 1.34, 0.26], scale: [0.07, 0.46, 0.05], bone: 'torso' },
  { material: 'metal', position: [0.16, 1.34, 0.26], scale: [0.07, 0.46, 0.05], bone: 'torso' },
  { material: 'glow', position: [-0.16, 1.14, 0.28], scale: [0.04, 0.34, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.16, 1.14, 0.28], scale: [0.04, 0.34, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.98, -0.16], scale: [0.06, 0.07, 0.2], rotation: [0.5, 0, 0] },
], 'hookshot.ironLeviathan.body');

export const ABYSSAL_CORSAIR_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.72, 0.012, 0.72], transparent: true },
  { material: 'metal', position: [-0.23, 1.86, -0.04], scale: [0.16, 0.07, 0.18], rotation: [0, 0, -0.42] },
  { material: 'metal', position: [0.23, 1.86, -0.04], scale: [0.16, 0.07, 0.18], rotation: [0, 0, 0.42] },
  { material: 'edge', position: [0, 1.9, -0.05], scale: [0.16, 0.15, 0.16] },
  { material: 'accent', position: [0, 1.22, -0.272], scale: [0.34, 0.034, 0.024], emissive: true },
  { material: 'glow', kind: 'sphere', position: [-0.2, 1.14, -0.288], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0.2, 1.14, -0.288], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { material: 'edge', position: [-0.72, 0.7, -0.78], scale: [0.036, 0.044, 0.14], rotation: [0, 0.52, 0], emissive: true, bone: 'leftForearm' },
  { material: 'edge', position: [0.72, 0.73, -0.78], scale: [0.036, 0.044, 0.14], rotation: [0, -0.52, 0], emissive: true, bone: 'rightForearm' },
  { material: 'accent', position: [-0.54, 1.08, 0.19], scale: [0.05, 0.34, 0.026], rotation: [0, 0, -0.34], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0.54, 1.08, 0.19], scale: [0.05, 0.34, 0.026], rotation: [0, 0, 0.34], emissive: true, bone: 'torso' },
  // Deep-sea raider: a split corsair longcoat trailing off the hips, a swinging
  // hip lantern, and a wider tricorn brim with a bioluminescent trim.
  { material: 'armor', position: [-0.15, 0.46, 0.24], scale: [0.17, 0.62, 0.05], rotation: [0, 0, -0.04], bone: 'hips' },
  { material: 'armor', position: [0.15, 0.46, 0.24], scale: [0.17, 0.62, 0.05], rotation: [0, 0, 0.04], bone: 'hips' },
  { material: 'edge', position: [-0.15, 0.18, 0.25], scale: [0.16, 0.06, 0.04], emissive: true, bone: 'hips' },
  { material: 'edge', position: [0.15, 0.18, 0.25], scale: [0.16, 0.06, 0.04], emissive: true, bone: 'hips' },
  { material: 'metal', position: [0.26, 0.92, 0.24], scale: [0.06, 0.13, 0.06], bone: 'hips' },
  { material: 'glow', kind: 'sphere', position: [0.26, 0.84, 0.26], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true, bone: 'hips' },
  { material: 'metal', position: [0, 1.9, -0.2], scale: [0.34, 0.05, 0.14], rotation: [0.28, 0, 0] },
  { material: 'edge', position: [0, 1.88, -0.27], scale: [0.3, 0.03, 0.05], rotation: [0.28, 0, 0], emissive: true },
], 'hookshot.abyssalCorsair.body');

export const KRAKEN_SOVEREIGN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.86, 0.012, 0.86], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.98, -0.09], scale: [0.38, 0.014, 0.38], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'metal', position: [-0.2, 1.94, -0.03], scale: [0.09, 0.24, 0.18], rotation: [0, 0, 0.28] },
  { material: 'metal', position: [0.2, 1.94, -0.03], scale: [0.09, 0.24, 0.18], rotation: [0, 0, -0.28] },
  { material: 'metal', position: [-0.48, 1.42, -0.09], scale: [0.24, 0.2, 0.08], rotation: [0, 0, -0.24] },
  { material: 'metal', position: [0.48, 1.42, -0.09], scale: [0.24, 0.2, 0.08], rotation: [0, 0, 0.24] },
  // Abyssal lures: bioluminescent orbs drifting off the back instead of wings —
  // the kraken tentacles below carry this skin's silhouette.
  { material: 'glow', kind: 'sphere', position: [-0.4, 1.7, 0.22], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.46, 1.46, 0.2], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [-0.3, 1.28, 0.24], scale: [0.04, 0.04, 0.04], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', position: [0, 1.2, -0.282], scale: [0.38, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.06, -0.3], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
  { material: 'metal', position: [-0.6, 0.92, -0.38], scale: [0.22, 0.046, 0.036], bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.94, -0.38], scale: [0.22, 0.046, 0.036], bone: 'rightForearm' },
  // Sovereign of the abyss: a central crown spire and two curling kraken
  // tentacles that sweep down the back, each tipped with a spectral light.
  { material: 'metal', position: [0, 2.16, -0.04], scale: [0.05, 0.2, 0.05] },
  { material: 'glow', kind: 'sphere', position: [0, 2.3, -0.04], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true },
  { material: 'metal', position: [-0.34, 1.22, 0.24], scale: [0.08, 0.36, 0.08], rotation: [0.2, 0, -0.32], bone: 'torso' },
  { material: 'metal', position: [-0.46, 0.84, 0.27], scale: [0.06, 0.32, 0.06], rotation: [0.42, 0, -0.12], bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [-0.52, 0.58, 0.3], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0.34, 1.22, 0.24], scale: [0.08, 0.36, 0.08], rotation: [0.2, 0, 0.32], bone: 'torso' },
  { material: 'metal', position: [0.46, 0.84, 0.27], scale: [0.06, 0.32, 0.06], rotation: [0.42, 0, 0.12], bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.52, 0.58, 0.3], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true, bone: 'torso' },
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
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.12, 0.03, 0.12], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.7, -0.38], scale: [0.13, 0.13, 0.13], emissive: true, bone: 'rightForearm' },
  { material: 'metal', kind: 'cone', position: [0.02, 2.36, -0.02], scale: [0.16, 0.2, 0.16], rotation: [0, 0, -0.12], attachmentMode: 'floating' },
  // Charred frontline: blackened blocky pauldrons split by glowing ember cracks,
  // and a scorched back banner hanging from the shoulders.
  { material: 'dark', position: [-0.34, 1.4, -0.02], scale: [0.17, 0.16, 0.26], bone: 'torso' },
  { material: 'dark', position: [0.34, 1.4, -0.02], scale: [0.17, 0.16, 0.26], bone: 'torso' },
  { material: 'glow', position: [-0.34, 1.4, -0.16], scale: [0.14, 0.03, 0.04], emissive: true, bone: 'torso' },
  { material: 'glow', position: [0.34, 1.4, -0.16], scale: [0.14, 0.03, 0.04], emissive: true, bone: 'torso' },
  { material: 'dark', position: [0, 1.1, 0.22], scale: [0.3, 0.66, 0.04], bone: 'torso' },
  { material: 'edge', position: [0, 0.78, 0.23], scale: [0.26, 0.06, 0.04], emissive: true, bone: 'torso' },
  { material: 'glow', position: [0, 1.16, -0.255], scale: [0.05, 0.4, 0.03], emissive: true, transparent: true },
], 'blaze.ashenVanguard.body');

export const INFERNO_ARCHON_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.72, 0.012, 0.72], transparent: true },
  { material: 'metal', position: [-0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, 0.36] },
  { material: 'metal', position: [0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, -0.36] },
  // Ember jets: short upward flame vents off the shoulders instead of wings.
  { material: 'glow', kind: 'cone', position: [-0.38, 1.66, -0.02], scale: [0.1, 0.26, 0.1], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', kind: 'cone', position: [0.38, 1.66, -0.02], scale: [0.1, 0.26, 0.1], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', kind: 'sphere', position: [-0.38, 1.86, -0.02], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', kind: 'sphere', position: [0.38, 1.86, -0.02], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'metal', position: [0, 1.32, -0.27], scale: [0.34, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.292], scale: [0.08, 0.08, 0.08], emissive: true, transparent: true },
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.14, 0.03, 0.14], emissive: true, bone: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.62, -0.38], scale: [0.18, 0.024, 0.18], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.8, -0.38], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true, bone: 'rightForearm' },
  { material: 'edge', position: [-0.43, 0.5, -0.15], scale: [0.09, 0.04, 0.03], bone: 'leftArm' },
  // Flame-command archon: curved helm horns, a broader plasma wingspan, and
  // ember jets venting off the shoulders.
  { material: 'metal', position: [-0.2, 2.08, -0.02], scale: [0.05, 0.22, 0.06], rotation: [0, 0, 0.42] },
  { material: 'metal', position: [0.2, 2.08, -0.02], scale: [0.05, 0.22, 0.06], rotation: [0, 0, -0.42] },
  { material: 'accent', position: [-0.26, 2.2, -0.02], scale: [0.035, 0.1, 0.045], rotation: [0, 0, 0.6], emissive: true },
  { material: 'accent', position: [0.26, 2.2, -0.02], scale: [0.035, 0.1, 0.045], rotation: [0, 0, -0.6], emissive: true },
  { material: 'glow', kind: 'sphere', position: [-0.3, 1.96, 0.06], scale: [0.035, 0.035, 0.035], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', kind: 'sphere', position: [0.34, 2.04, 0.04], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [-0.34, 1.46, -0.04], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.34, 1.46, -0.04], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true, bone: 'torso' },
], 'blaze.infernoArchon.body');

export const STARFALL_PHOENIX_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.86, 0.012, 0.86], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 2.14, -0.04], scale: [0.34, 0.014, 0.34], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'metal', kind: 'cone', position: [0.02, 2.44, -0.02], scale: [0.2, 0.28, 0.2], rotation: [0, 0, -0.12], attachmentMode: 'floating' },
  { material: 'glow', kind: 'sphere', position: [0.08, 2.6, -0.02], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true, attachmentMode: 'floating' },
  // Stellar comet tail: glowing plumes trailing down off the lower back instead
  // of wings (paired with drifting star sparks below).
  { material: 'glow', position: [0, 0.92, 0.24], scale: [0.07, 0.66, 0.03], rotation: [0.3, 0, 0], emissive: true, transparent: true, bone: 'hips' },
  { material: 'accent', position: [-0.12, 0.78, 0.25], scale: [0.05, 0.5, 0.026], rotation: [0.34, 0, 0.12], emissive: true, transparent: true, bone: 'hips' },
  { material: 'accent', position: [0.12, 0.78, 0.25], scale: [0.05, 0.5, 0.026], rotation: [0.34, 0, -0.12], emissive: true, transparent: true, bone: 'hips' },
  { material: 'metal', position: [0, 1.34, -0.274], scale: [0.38, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.12, -0.298], scale: [0.1, 0.1, 0.1], emissive: true, transparent: true },
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.5, -0.38], scale: [0.16, 0.03, 0.16], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.82, -0.38], scale: [0.12, 0.12, 0.12], emissive: true, transparent: true, bone: 'rightForearm' },
  { material: 'accent', position: [0.52, 1.95, -0.38], scale: [0.07, 0.16, 0.07], emissive: true, bone: 'rightForearm' },
  // Stellar phoenix: a layered double plume wingspan and a star crown burning
  // above the helm for the legendary read.
  { material: 'glow', kind: 'sphere', position: [-0.22, 0.6, 0.28], scale: [0.04, 0.04, 0.04], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'hips' },
  { material: 'accent', kind: 'sphere', position: [0.2, 0.42, 0.3], scale: [0.035, 0.035, 0.035], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'hips' },
  { material: 'glow', kind: 'sphere', position: [0.04, 0.24, 0.32], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'hips' },
  { material: 'glow', kind: 'sphere', position: [0, 2.02, -0.02], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true },
  { material: 'metal', position: [0, 2.14, -0.02], scale: [0.035, 0.12, 0.04] },
  { material: 'metal', position: [-0.1, 2.08, -0.02], scale: [0.03, 0.09, 0.035], rotation: [0, 0, 0.4] },
  { material: 'metal', position: [0.1, 2.08, -0.02], scale: [0.03, 0.09, 0.035], rotation: [0, 0, -0.4] },
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
  { material: 'metal', position: [0, 1.9, -0.04], scale: [0.08, 0.18, 0.16] },
  // Sentinel guard: a back aegis tower-shield trimmed in paradox-blue with a
  // glowing cross, and a clock-face dial set into the chest.
  { material: 'metal', position: [0, 1.18, 0.31], scale: [0.42, 0.72, 0.05], bone: 'torso' },
  { material: 'edge', position: [0, 1.18, 0.34], scale: [0.46, 0.06, 0.04], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0, 1.5, 0.34], scale: [0.46, 0.06, 0.04], emissive: true, bone: 'torso' },
  { material: 'glow', position: [0, 1.18, 0.345], scale: [0.05, 0.5, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0, 1.18, 0.345], scale: [0.3, 0.05, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glass', kind: 'cylinder', position: [0, 1.08, -0.26], scale: [0.16, 0.014, 0.16], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'glow', position: [0, 1.08, -0.27], scale: [0.018, 0.12, 0.02], emissive: true },
  { material: 'glow', position: [0.05, 1.1, -0.27], scale: [0.09, 0.018, 0.02], emissive: true, rotation: [0, 0, 0.6] },
], 'chronos.paradoxSentinel.body');

export const MERIDIAN_ORACLE_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.74, 0.012, 0.74], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.94, -0.08], scale: [0.36, 0.014, 0.36], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'metal', position: [-0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, 0.28] },
  { material: 'metal', position: [0.18, 1.9, -0.04], scale: [0.08, 0.22, 0.16], rotation: [0, 0, -0.28] },
  { material: 'edge', position: [-0.46, 1.32, 0.22], scale: [0.06, 0.44, 0.026], rotation: [0, 0, -0.34], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.46, 1.32, 0.22], scale: [0.06, 0.44, 0.026], rotation: [0, 0, 0.34], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0, 1.18, -0.276], scale: [0.32, 0.036, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [-0.24, 1.18, -0.298], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0.24, 1.18, -0.298], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  { material: 'glass', kind: 'cylinder', position: [0, 1.04, -0.29], scale: [0.24, 0.014, 0.24], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  // Oracle astrolabe: crossed meridian rings orbit the frame and a head halo,
  // with paired prism orbs hovering at the shoulders.
  { material: 'glow', kind: 'cylinder', position: [0, 1.28, 0], scale: [0.66, 0.012, 0.66], rotation: [1.2, 0, 0.42], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', kind: 'cylinder', position: [0, 1.28, 0], scale: [0.62, 0.012, 0.62], rotation: [1.2, 0, -0.42], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'metal', kind: 'cylinder', position: [0, 1.82, -0.02], scale: [0.36, 0.012, 0.36], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'head' },
  { material: 'glass', kind: 'sphere', position: [-0.42, 1.5, 0], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [0.42, 1.5, 0], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
], 'chronos.meridianOracle.body');

export const ETERNITY_SOVEREIGN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.88, 0.012, 0.88], transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 2.04, -0.08], scale: [0.44, 0.014, 0.44], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'metal', kind: 'cylinder', position: [0, 1.96, -0.08], scale: [0.26, 0.016, 0.26], rotation: [Math.PI / 2, 0, 0], emissive: true, attachmentMode: 'floating' },
  { material: 'metal', position: [-0.2, 1.94, -0.04], scale: [0.09, 0.25, 0.18], rotation: [0, 0, 0.3] },
  { material: 'metal', position: [0.2, 1.94, -0.04], scale: [0.09, 0.25, 0.18], rotation: [0, 0, -0.3] },
  // Clockwork orbit: a tilted gold time-ring with orbiting gems instead of wings.
  { material: 'metal', kind: 'cylinder', position: [0, 1.4, 0.04], scale: [0.56, 0.014, 0.56], rotation: [1.1, 0, 0.3], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [-0.5, 1.56, 0.12], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [0.52, 1.24, 0.1], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'metal', position: [0, 1.32, -0.28], scale: [0.38, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.304], scale: [0.092, 0.092, 0.092], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [-0.28, 1.2, -0.3], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [0.28, 1.2, -0.3], scale: [0.062, 0.062, 0.062], emissive: true, transparent: true },
  // Eternal sovereign: a second tier of gold time-wings, an eternal crown spire,
  // and a triple-orb regalia orbiting above the crown.
  { material: 'glow', kind: 'cylinder', position: [0, 1.4, 0.04], scale: [0.4, 0.012, 0.4], rotation: [0.6, 0.5, 0], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'metal', position: [0, 2.04, -0.04], scale: [0.04, 0.18, 0.05], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 2.24, -0.02], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'glass', kind: 'sphere', position: [-0.18, 2.16, -0.02], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'glass', kind: 'sphere', position: [0.18, 2.16, -0.02], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating' },
], 'chronos.eternitySovereign.body');

// Shared gold regalia worn by every golden founder skin: floating halo, crown
// band with spikes, gilded pauldrons, a chest emblem, and forearm/boot trims.
// Per-hero flourishes are appended on top of this in each *_GOLDEN_EXTRA_PARTS.
function createGoldenRegaliaParts(): VoxelPartDraft[] {
  return [
    { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.82, 0.012, 0.82], transparent: true },
    // Floating double halo above the head
    { material: 'glow', kind: 'cylinder', position: [0, 2.06, -0.06], scale: [0.42, 0.014, 0.42], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
    { material: 'metal', kind: 'cylinder', position: [0, 1.98, -0.06], scale: [0.26, 0.016, 0.26], rotation: [Math.PI / 2, 0, 0], emissive: true, attachmentMode: 'floating' },
    // Crown band + spikes
    { material: 'metal', position: [0, 1.92, -0.02], scale: [0.4, 0.07, 0.38] },
    { material: 'edge', position: [0, 1.95, -0.225], scale: [0.36, 0.05, 0.04], emissive: true },
    { material: 'metal', position: [0, 2.08, -0.02], scale: [0.06, 0.2, 0.06] },
    { material: 'metal', position: [-0.17, 2.0, -0.02], scale: [0.05, 0.14, 0.05], rotation: [0, 0, 0.2] },
    { material: 'metal', position: [0.17, 2.0, -0.02], scale: [0.05, 0.14, 0.05], rotation: [0, 0, -0.2] },
    { material: 'metal', position: [-0.31, 1.95, -0.02], scale: [0.045, 0.1, 0.045], rotation: [0, 0, 0.36] },
    { material: 'metal', position: [0.31, 1.95, -0.02], scale: [0.045, 0.1, 0.045], rotation: [0, 0, -0.36] },
    { material: 'glow', kind: 'sphere', position: [0, 2.2, -0.02], scale: [0.04, 0.04, 0.04], emissive: true },
    // Gilded pauldrons
    { material: 'metal', position: [-0.34, 1.42, -0.03], scale: [0.18, 0.12, 0.22], rotation: [0, 0, -0.16] },
    { material: 'metal', position: [0.34, 1.42, -0.03], scale: [0.18, 0.12, 0.22], rotation: [0, 0, 0.16] },
    { material: 'edge', position: [-0.34, 1.5, -0.03], scale: [0.16, 0.05, 0.2], emissive: true },
    { material: 'edge', position: [0.34, 1.5, -0.03], scale: [0.16, 0.05, 0.2], emissive: true },
    // Chest emblem
    { material: 'metal', position: [0, 1.16, -0.2], scale: [0.2, 0.22, 0.03] },
    { material: 'glow', kind: 'sphere', position: [0, 1.16, -0.24], scale: [0.08, 0.08, 0.05], emissive: true, transparent: true },
    { material: 'accent', position: [0, 1.34, -0.272], scale: [0.34, 0.04, 0.026], emissive: true },
    // Forearm cuffs
    { material: 'metal', position: [-0.43, 0.8, -0.04], scale: [0.11, 0.06, 0.11], bone: 'leftForearm' },
    { material: 'metal', position: [0.43, 0.8, -0.04], scale: [0.11, 0.06, 0.11], bone: 'rightForearm' },
    { material: 'glow', kind: 'cylinder', position: [-0.43, 0.7, -0.04], scale: [0.07, 0.014, 0.07], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'leftForearm' },
    { material: 'glow', kind: 'cylinder', position: [0.43, 0.7, -0.04], scale: [0.07, 0.014, 0.07], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'rightForearm' },
    // Boot trims
    { material: 'edge', position: [-0.15, 0.1, -0.04], scale: [0.2, 0.05, 0.22], emissive: true },
    { material: 'edge', position: [0.15, 0.1, -0.04], scale: [0.2, 0.05, 0.22], emissive: true },
  ];
}

export const PHANTOM_GOLDEN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createGoldenRegaliaParts(),
  // Phantom sun-king: a radiant solar backplate behind the shoulders with a
  // gilded rim and three rising rays. (Unique to this skin — replaces wings.)
  { material: 'metal', kind: 'cylinder', position: [0, 1.46, 0.24], scale: [0.4, 0.012, 0.4], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', kind: 'cylinder', position: [0, 1.46, 0.235], scale: [0.47, 0.01, 0.47], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.92, 0.24], scale: [0.03, 0.18, 0.025], emissive: true, bone: 'torso' },
  { material: 'metal', position: [-0.25, 1.85, 0.24], scale: [0.026, 0.14, 0.024], rotation: [0, 0, 0.44], emissive: true, bone: 'torso' },
  { material: 'metal', position: [0.25, 1.85, 0.24], scale: [0.026, 0.14, 0.024], rotation: [0, 0, -0.44], emissive: true, bone: 'torso' },
  // Radiant chest sunburst.
  { material: 'glow', kind: 'sphere', position: [0, 1.16, -0.27], scale: [0.09, 0.09, 0.05], emissive: true, transparent: true },
  { material: 'metal', position: [0, 1.16, -0.27], scale: [0.05, 0.3, 0.03], emissive: true },
  { material: 'metal', position: [0, 1.16, -0.27], scale: [0.3, 0.05, 0.03], emissive: true },
], 'phantom.golden.body');

export const HOOKSHOT_GOLDEN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createGoldenRegaliaParts(),
  // Gold anchor crest below the chest emblem
  { material: 'metal', kind: 'cylinder', position: [0, 0.92, -0.22], scale: [0.05, 0.22, 0.05], rotation: [Math.PI / 2, 0, 0] },
  { material: 'metal', position: [0, 1.04, -0.24], scale: [0.18, 0.05, 0.04] },
  { material: 'glow', position: [-0.14, 0.82, -0.24], scale: [0.05, 0.05, 0.03], emissive: true },
  { material: 'glow', position: [0.14, 0.82, -0.24], scale: [0.05, 0.05, 0.03], emissive: true },
  // Gilded back anchor: a mounted gold anchor (stock, crossbar, flukes) instead
  // of anchor-wings — unique to the golden Hookshot.
  { material: 'metal', position: [0, 1.5, 0.24], scale: [0.05, 0.6, 0.04], emissive: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.74, 0.24], scale: [0.34, 0.05, 0.04], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0, 1.82, 0.24], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [-0.26, 1.12, 0.24], scale: [0.05, 0.18, 0.04], rotation: [0, 0, 0.7], emissive: true, bone: 'torso' },
  { material: 'metal', position: [0.26, 1.12, 0.24], scale: [0.05, 0.18, 0.04], rotation: [0, 0, -0.7], emissive: true, bone: 'torso' },
], 'hookshot.golden.body');

export const BLAZE_GOLDEN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createGoldenRegaliaParts(),
  // Floating solar crown above the halo
  { material: 'metal', kind: 'cone', position: [0.02, 2.4, -0.02], scale: [0.18, 0.26, 0.18], rotation: [0, 0, -0.1], attachmentMode: 'floating' },
  { material: 'glow', kind: 'sphere', position: [0.08, 2.56, -0.02], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true, attachmentMode: 'floating' },
  // Solar corona: a fan of gold sun-rays radiating around the helm instead of
  // wing fins — unique to the golden Blaze.
  { material: 'metal', position: [0, 2.26, -0.02], scale: [0.03, 0.18, 0.025], emissive: true, attachmentMode: 'floating' },
  { material: 'metal', position: [-0.34, 2.12, -0.02], scale: [0.026, 0.14, 0.024], rotation: [0, 0, 0.6], emissive: true, attachmentMode: 'floating' },
  { material: 'metal', position: [0.34, 2.12, -0.02], scale: [0.026, 0.14, 0.024], rotation: [0, 0, -0.6], emissive: true, attachmentMode: 'floating' },
  { material: 'metal', position: [-0.44, 1.92, -0.02], scale: [0.024, 0.12, 0.022], rotation: [0, 0, 1.0], emissive: true, attachmentMode: 'floating' },
  { material: 'metal', position: [0.44, 1.92, -0.02], scale: [0.024, 0.12, 0.022], rotation: [0, 0, -1.0], emissive: true, attachmentMode: 'floating' },
], 'blaze.golden.body');

export const CHRONOS_GOLDEN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createGoldenRegaliaParts(),
  // Floating gold time-ring with orbiting gems
  { material: 'glow', kind: 'cylinder', position: [0, 1.18, -0.3], scale: [0.26, 0.014, 0.26], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [-0.26, 1.2, -0.3], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  { material: 'glass', kind: 'sphere', position: [0.26, 1.2, -0.3], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  { material: 'glow', kind: 'cylinder', position: [0, 2.18, -0.06], scale: [0.3, 0.012, 0.3], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
  // Gilded chronometer: a floating gold clock-dial behind the shoulders with
  // hour marks and orbiting gems instead of time-wings — unique to golden Chronos.
  { material: 'metal', kind: 'cylinder', position: [0, 1.5, 0.24], scale: [0.4, 0.014, 0.4], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', kind: 'cylinder', position: [0, 1.5, 0.235], scale: [0.46, 0.01, 0.46], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.86, 0.24], scale: [0.024, 0.12, 0.022], emissive: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.14, 0.24], scale: [0.024, 0.12, 0.022], emissive: true, bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [-0.4, 1.5, 0.22], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [0.4, 1.5, 0.22], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
], 'chronos.golden.body');

function createIndependenceRegaliaParts(): VoxelPartDraft[] {
  return [
    { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.78, 0.012, 0.78], transparent: true },
    { material: 'glow', kind: 'cylinder', position: [0, 2.06, -0.06], scale: [0.38, 0.012, 0.38], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating' },
    { material: 'metal', position: [0, 1.92, -0.03], scale: [0.38, 0.06, 0.34] },
    { material: 'accent', position: [0, 1.96, -0.225], scale: [0.34, 0.038, 0.034], emissive: true },
    { material: 'glow', kind: 'sphere', position: [0, 2.18, -0.02], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating' },
    { material: 'metal', position: [-0.34, 1.42, -0.03], scale: [0.18, 0.1, 0.21], rotation: [0, 0, -0.16] },
    { material: 'metal', position: [0.34, 1.42, -0.03], scale: [0.18, 0.1, 0.21], rotation: [0, 0, 0.16] },
    { material: 'accent', position: [-0.34, 1.5, -0.03], scale: [0.16, 0.04, 0.19], emissive: true },
    { material: 'accent', position: [0.34, 1.5, -0.03], scale: [0.16, 0.04, 0.19], emissive: true },
    { material: 'armor', position: [0, 1.16, -0.205], scale: [0.24, 0.24, 0.032] },
    { material: 'edge', position: [0, 1.22, -0.246], scale: [0.24, 0.035, 0.026], emissive: true },
    { material: 'accent', position: [0, 1.13, -0.248], scale: [0.24, 0.035, 0.026], emissive: true },
    { material: 'edge', position: [0, 1.04, -0.246], scale: [0.24, 0.035, 0.026], emissive: true },
    { material: 'glow', kind: 'sphere', position: [-0.07, 1.29, -0.262], scale: [0.032, 0.032, 0.024], emissive: true, transparent: true },
    { material: 'glow', kind: 'sphere', position: [0.07, 1.29, -0.262], scale: [0.032, 0.032, 0.024], emissive: true, transparent: true },
    { material: 'metal', position: [-0.43, 0.8, -0.04], scale: [0.11, 0.055, 0.11], bone: 'leftForearm' },
    { material: 'metal', position: [0.43, 0.8, -0.04], scale: [0.11, 0.055, 0.11], bone: 'rightForearm' },
    { material: 'edge', position: [-0.43, 0.72, -0.04], scale: [0.09, 0.026, 0.1], emissive: true, bone: 'leftForearm' },
    { material: 'edge', position: [0.43, 0.72, -0.04], scale: [0.09, 0.026, 0.1], emissive: true, bone: 'rightForearm' },
    { material: 'accent', position: [-0.43, 0.66, -0.04], scale: [0.09, 0.026, 0.1], emissive: true, bone: 'leftForearm' },
    { material: 'accent', position: [0.43, 0.66, -0.04], scale: [0.09, 0.026, 0.1], emissive: true, bone: 'rightForearm' },
    { material: 'edge', position: [-0.15, 0.1, -0.04], scale: [0.2, 0.05, 0.22], emissive: true },
    { material: 'edge', position: [0.15, 0.1, -0.04], scale: [0.2, 0.05, 0.22], emissive: true },
    { material: 'accent', position: [-0.15, 0.18, -0.04], scale: [0.18, 0.035, 0.2], emissive: true },
    { material: 'accent', position: [0.15, 0.18, -0.04], scale: [0.18, 0.035, 0.2], emissive: true },
  ];
}

export const PHANTOM_LIBERTY_WRAITH_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createIndependenceRegaliaParts(),
  { material: 'glow', kind: 'cylinder', position: [0, 1.48, 0.24], scale: [0.46, 0.01, 0.46], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0, 1.82, 0.24], scale: [0.035, 0.18, 0.026], rotation: [0, 0, 0.1], emissive: true, bone: 'torso' },
  { material: 'edge', position: [-0.24, 1.74, 0.24], scale: [0.028, 0.14, 0.024], rotation: [0, 0, 0.55], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.24, 1.74, 0.24], scale: [0.028, 0.14, 0.024], rotation: [0, 0, -0.55], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0, 1.16, -0.29], scale: [0.085, 0.085, 0.05], emissive: true, transparent: true },
], 'phantom.libertyWraith.body');

export const HOOKSHOT_LIBERTY_ANCHOR_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createIndependenceRegaliaParts(),
  { material: 'metal', position: [0, 1.5, 0.24], scale: [0.05, 0.58, 0.04], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0, 1.74, 0.24], scale: [0.34, 0.05, 0.04], emissive: true, bone: 'torso' },
  { material: 'accent', position: [-0.25, 1.12, 0.24], scale: [0.05, 0.18, 0.04], rotation: [0, 0, 0.7], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0.25, 1.12, 0.24], scale: [0.05, 0.18, 0.04], rotation: [0, 0, -0.7], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0, 1.82, 0.24], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, bone: 'torso' },
], 'hookshot.libertyAnchor.body');

export const BLAZE_LIBERTY_FLARE_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createIndependenceRegaliaParts(),
  { material: 'metal', kind: 'cone', position: [0.02, 2.36, -0.02], scale: [0.16, 0.24, 0.16], rotation: [0, 0, -0.1], attachmentMode: 'floating' },
  { material: 'glow', kind: 'sphere', position: [0.08, 2.5, -0.02], scale: [0.07, 0.07, 0.07], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'edge', position: [0, 2.2, -0.02], scale: [0.03, 0.16, 0.024], emissive: true, attachmentMode: 'floating' },
  { material: 'accent', position: [-0.33, 2.04, -0.02], scale: [0.026, 0.13, 0.024], rotation: [0, 0, 0.65], emissive: true, attachmentMode: 'floating' },
  { material: 'accent', position: [0.33, 2.04, -0.02], scale: [0.026, 0.13, 0.024], rotation: [0, 0, -0.65], emissive: true, attachmentMode: 'floating' },
], 'blaze.libertyFlare.body');

export const CHRONOS_LIBERTY_SENTINEL_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  ...createIndependenceRegaliaParts(),
  { material: 'glow', kind: 'cylinder', position: [0, 1.18, -0.3], scale: [0.25, 0.012, 0.25], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'accent', kind: 'cylinder', position: [0, 1.18, -0.305], scale: [0.17, 0.01, 0.17], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', kind: 'cylinder', position: [0, 1.48, 0.24], scale: [0.4, 0.014, 0.4], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'torso' },
  { material: 'edge', position: [0, 1.84, 0.24], scale: [0.024, 0.12, 0.022], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0, 1.12, 0.24], scale: [0.024, 0.12, 0.022], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [-0.38, 1.48, 0.22], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.38, 1.48, 0.22], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
], 'chronos.libertySentinel.body');

export const UMBRAL_REAVER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.62, 0.012, 0.62], transparent: true },
  // Hooded reaper crest swept over the head with a sickle-green brow line.
  { material: 'dark', position: [0, 1.9, 0.05], scale: [0.36, 0.26, 0.32] },
  { material: 'edge', position: [0, 1.86, -0.22], scale: [0.34, 0.05, 0.04], emissive: true },
  { material: 'dark', position: [0, 2.04, 0.13], scale: [0.22, 0.16, 0.18], rotation: [0.5, 0, 0] },
  { material: 'glow', position: [0, 1.7, -0.236], scale: [0.2, 0.026, 0.022], emissive: true },
  // Scythe-blade shoulder spires.
  { material: 'metal', position: [-0.32, 1.6, -0.02], scale: [0.05, 0.46, 0.06], rotation: [0, 0, -0.32], bone: 'torso' },
  { material: 'metal', position: [0.32, 1.6, -0.02], scale: [0.05, 0.46, 0.06], rotation: [0, 0, 0.32], bone: 'torso' },
  { material: 'edge', position: [-0.42, 1.86, -0.02], scale: [0.06, 0.2, 0.05], rotation: [0, 0, -0.7], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.42, 1.86, -0.02], scale: [0.06, 0.2, 0.05], rotation: [0, 0, 0.7], emissive: true, bone: 'torso' },
  // Reaper gorget + chest soul rune.
  { material: 'metal', position: [0, 1.34, -0.244], scale: [0.3, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.14, -0.25], scale: [0.07, 0.09, 0.05], emissive: true, transparent: true },
  { material: 'accent', position: [0, 1.14, -0.25], scale: [0.03, 0.22, 0.028], emissive: true },
  // Tattered back mantle.
  { material: 'dark', position: [0, 1.12, 0.22], scale: [0.34, 0.66, 0.04], bone: 'torso' },
  { material: 'edge', position: [-0.1, 0.74, 0.23], scale: [0.1, 0.12, 0.04], rotation: [0, 0, 0.2], emissive: true, transparent: true, bone: 'torso' },
  { material: 'edge', position: [0.12, 0.78, 0.23], scale: [0.1, 0.12, 0.04], rotation: [0, 0, -0.2], emissive: true, transparent: true, bone: 'torso' },
  // Forearm reaper cuffs and knee guards.
  { material: 'metal', position: [-0.43, 0.96, -0.05], scale: [0.12, 0.07, 0.12], bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.96, -0.05], scale: [0.12, 0.07, 0.12], bone: 'rightForearm' },
  { material: 'metal', position: [-0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
  { material: 'metal', position: [0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
], 'phantom.umbralReaver.body');

export const OBSIDIAN_REVENANT_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.74, 0.012, 0.74], transparent: true },
  // Drifting shard storm: a scattered constellation of shattered glass shards
  // orbiting the frame (asymmetric, not wings) — this skin's signature read.
  { material: 'glass', position: [-0.5, 1.52, 0.16], scale: [0.06, 0.11, 0.04], rotation: [0.2, 0, -0.5], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', position: [0.54, 1.34, 0.1], scale: [0.05, 0.13, 0.04], rotation: [0, 0.3, 0.4], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', position: [-0.46, 1.06, 0.2], scale: [0.045, 0.09, 0.035], rotation: [0.3, 0, 0.2], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', position: [0.48, 1.62, 0.04], scale: [0.04, 0.08, 0.03], rotation: [0, 0, -0.3], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', position: [-0.54, 1.3, 0.18], scale: [0.026, 0.07, 0.022], rotation: [0, 0, -0.5], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', position: [0.5, 1.5, 0.12], scale: [0.024, 0.06, 0.02], rotation: [0, 0, 0.4], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Jagged shoulder shards.
  { material: 'glass', position: [-0.33, 1.5, -0.02], scale: [0.08, 0.3, 0.12], rotation: [0, 0, -0.4], transparent: true, bone: 'torso' },
  { material: 'glass', position: [0.33, 1.5, -0.02], scale: [0.08, 0.3, 0.12], rotation: [0, 0, 0.4], transparent: true, bone: 'torso' },
  // Soul-fire chest core sigil.
  { material: 'metal', position: [0, 1.32, -0.262], scale: [0.34, 0.036, 0.024], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.12, -0.28], scale: [0.1, 0.1, 0.07], emissive: true, transparent: true },
  { material: 'accent', position: [0, 1.12, -0.28], scale: [0.03, 0.26, 0.028], emissive: true, transparent: true },
  { material: 'accent', position: [0, 1.12, -0.28], scale: [0.26, 0.03, 0.028], emissive: true, transparent: true },
  // Revenant visor crown.
  { material: 'metal', position: [0, 1.92, -0.04], scale: [0.06, 0.18, 0.16] },
  { material: 'edge', position: [0, 1.72, -0.236], scale: [0.26, 0.026, 0.022], emissive: true },
  { material: 'glass', position: [-0.14, 1.96, -0.04], scale: [0.04, 0.14, 0.05], rotation: [0, 0, 0.3], transparent: true },
  { material: 'glass', position: [0.14, 1.96, -0.04], scale: [0.04, 0.14, 0.05], rotation: [0, 0, -0.3], transparent: true },
  // Drifting orbital shards around the head.
  { material: 'glass', kind: 'sphere', position: [-0.34, 1.74, -0.04], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'head' },
  { material: 'glass', kind: 'sphere', position: [0.34, 1.66, -0.04], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'head' },
  { material: 'glow', kind: 'sphere', position: [0, 2.16, -0.02], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating' },
  // Forearm gauntlet cuffs.
  { material: 'metal', position: [-0.43, 0.96, -0.05], scale: [0.12, 0.06, 0.12], emissive: true, bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.96, -0.05], scale: [0.12, 0.06, 0.12], emissive: true, bone: 'rightForearm' },
], 'phantom.obsidianRevenant.body');

export const CORAL_WARDEN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.64, 0.012, 0.64], transparent: true },
  // Coral-branch crown crest.
  { material: 'edge', position: [0, 1.96, -0.02], scale: [0.05, 0.16, 0.05], rotation: [0, 0, 0.2] },
  { material: 'edge', position: [-0.1, 2.0, -0.02], scale: [0.035, 0.12, 0.04], rotation: [0, 0, 0.6] },
  { material: 'edge', position: [0.1, 2.0, -0.02], scale: [0.035, 0.12, 0.04], rotation: [0, 0, -0.6] },
  { material: 'glow', kind: 'sphere', position: [0, 2.12, -0.02], scale: [0.05, 0.05, 0.05], emissive: true },
  // Jade reef pauldrons.
  { material: 'metal', position: [-0.4, 1.4, -0.06], scale: [0.2, 0.16, 0.1], rotation: [0, 0, -0.2] },
  { material: 'metal', position: [0.4, 1.4, -0.06], scale: [0.2, 0.16, 0.1], rotation: [0, 0, 0.2] },
  { material: 'edge', position: [-0.4, 1.5, -0.06], scale: [0.18, 0.04, 0.08], emissive: true },
  { material: 'edge', position: [0.4, 1.5, -0.06], scale: [0.18, 0.04, 0.08], emissive: true },
  // Amber chest lantern + collar.
  { material: 'accent', position: [0, 1.22, -0.262], scale: [0.28, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.06, -0.27], scale: [0.07, 0.07, 0.05], emissive: true, transparent: true },
  // Coral back vanes.
  { material: 'edge', position: [-0.26, 1.36, 0.24], scale: [0.05, 0.4, 0.04], rotation: [0, 0, -0.34], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.26, 1.36, 0.24], scale: [0.05, 0.4, 0.04], rotation: [0, 0, 0.34], emissive: true, bone: 'torso' },
  // Forearm reef clamps.
  { material: 'metal', position: [-0.6, 0.96, -0.3], scale: [0.18, 0.05, 0.036], bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.98, -0.3], scale: [0.18, 0.05, 0.036], bone: 'rightForearm' },
  // Swinging hip lantern.
  { material: 'metal', position: [-0.24, 0.92, 0.22], scale: [0.05, 0.11, 0.05], bone: 'hips' },
  { material: 'glow', kind: 'sphere', position: [-0.24, 0.84, 0.24], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true, bone: 'hips' },
], 'hookshot.coralWarden.body');

export const MAELSTROM_WARLORD_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.82, 0.012, 0.82], transparent: true },
  // Twin-pronged storm crown.
  { material: 'metal', position: [-0.12, 2.02, -0.02], scale: [0.05, 0.22, 0.06], rotation: [0, 0, 0.2] },
  { material: 'metal', position: [0.12, 2.02, -0.02], scale: [0.05, 0.22, 0.06], rotation: [0, 0, -0.2] },
  { material: 'glow', kind: 'sphere', position: [0, 2.18, -0.02], scale: [0.055, 0.055, 0.055], emissive: true, transparent: true },
  { material: 'accent', position: [0, 1.96, -0.04], scale: [0.06, 0.16, 0.14], emissive: true },
  // Twin cyclone arc: a second crossed-tilt storm ring instead of fin wings,
  // with arc sparks (pairs with the orbiting storm ring below).
  { material: 'accent', kind: 'cylinder', position: [0, 1.34, 0], scale: [0.52, 0.012, 0.52], rotation: [1.0, 0, -0.6], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [-0.46, 1.5, 0.06], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.5, 1.26, 0.1], scale: [0.04, 0.04, 0.04], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Storm pauldrons.
  { material: 'metal', position: [-0.46, 1.42, -0.08], scale: [0.22, 0.18, 0.08], rotation: [0, 0, -0.24] },
  { material: 'metal', position: [0.46, 1.42, -0.08], scale: [0.22, 0.18, 0.08], rotation: [0, 0, 0.24] },
  // Arc chest core + collar.
  { material: 'metal', position: [0, 1.32, -0.27], scale: [0.34, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.08, -0.29], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
  { material: 'accent', position: [0, 1.08, -0.29], scale: [0.03, 0.24, 0.028], emissive: true, transparent: true },
  // Orbiting storm ring.
  { material: 'glow', kind: 'cylinder', position: [0, 1.2, 0], scale: [0.6, 0.012, 0.6], rotation: [1.2, 0, 0.4], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Forearm arc clamps + back storm vents.
  { material: 'metal', position: [-0.6, 0.94, -0.36], scale: [0.2, 0.05, 0.036], emissive: true, bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.96, -0.36], scale: [0.2, 0.05, 0.036], emissive: true, bone: 'rightForearm' },
  { material: 'glow', position: [-0.16, 1.14, 0.28], scale: [0.04, 0.34, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.16, 1.14, 0.28], scale: [0.04, 0.34, 0.03], emissive: true, transparent: true, bone: 'torso' },
], 'hookshot.maelstromWarlord.body');

export const CINDER_WARDEN_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.6, 0.012, 0.6], transparent: true },
  // Brazier shoulder pauldrons venting ember light.
  { material: 'dark', position: [-0.34, 1.4, -0.02], scale: [0.18, 0.16, 0.24], bone: 'torso' },
  { material: 'dark', position: [0.34, 1.4, -0.02], scale: [0.18, 0.16, 0.24], bone: 'torso' },
  { material: 'glow', position: [-0.34, 1.48, -0.04], scale: [0.14, 0.03, 0.16], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.34, 1.48, -0.04], scale: [0.14, 0.03, 0.16], emissive: true, transparent: true, bone: 'torso' },
  // Helm crest.
  { material: 'metal', position: [0, 1.99, -0.02], scale: [0.05, 0.16, 0.13] },
  { material: 'glow', kind: 'sphere', position: [0, 2.1, -0.02], scale: [0.05, 0.05, 0.05], emissive: true },
  // Molten-crack chest plate.
  { material: 'metal', position: [0, 1.32, -0.262], scale: [0.3, 0.044, 0.03], emissive: true },
  { material: 'glow', position: [0, 1.1, -0.265], scale: [0.04, 0.34, 0.028], emissive: true, transparent: true },
  { material: 'glow', position: [-0.08, 1.16, -0.265], scale: [0.16, 0.028, 0.026], rotation: [0, 0, 0.5], emissive: true, transparent: true },
  { material: 'glow', position: [0.08, 1.04, -0.265], scale: [0.16, 0.028, 0.026], rotation: [0, 0, 0.5], emissive: true, transparent: true },
  // Ember-banded staff (rocket-staff arm).
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.12, 0.03, 0.12], emissive: true, bone: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.6, -0.38], scale: [0.15, 0.024, 0.15], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.74, -0.38], scale: [0.12, 0.12, 0.12], emissive: true, bone: 'rightForearm' },
  // Floating cinder above the crest + back ember bar + knee plates.
  { material: 'glow', kind: 'sphere', position: [0.075, 2.36, -0.02], scale: [0.05, 0.05, 0.05], emissive: true, attachmentMode: 'floating' },
  { material: 'glow', position: [0, 1.5, 0.23], scale: [0.3, 0.05, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [-0.17, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
  { material: 'metal', position: [0.17, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
], 'blaze.cinderWarden.body');

export const PYRE_TYRANT_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.82, 0.012, 0.82], transparent: true },
  // Molten crown over obsidian helm horns.
  { material: 'metal', position: [0, 2.06, -0.02], scale: [0.05, 0.2, 0.06] },
  { material: 'accent', position: [-0.14, 2.0, -0.02], scale: [0.04, 0.16, 0.05], rotation: [0, 0, 0.4], emissive: true },
  { material: 'accent', position: [0.14, 2.0, -0.02], scale: [0.04, 0.16, 0.05], rotation: [0, 0, -0.4], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 2.22, -0.02], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  { material: 'metal', position: [-0.18, 1.96, -0.04], scale: [0.05, 0.2, 0.06], rotation: [0, 0, 0.42] },
  { material: 'metal', position: [0.18, 1.96, -0.04], scale: [0.05, 0.2, 0.06], rotation: [0, 0, -0.42] },
  // Erupting back vents: vertical magma cracks venting up the back instead of
  // wing jets, with floating ember chunks.
  { material: 'glow', position: [-0.16, 1.46, 0.24], scale: [0.05, 0.5, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.16, 1.46, 0.24], scale: [0.05, 0.5, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0, 1.5, 0.25], scale: [0.045, 0.56, 0.026], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', kind: 'sphere', position: [-0.2, 1.84, 0.22], scale: [0.04, 0.04, 0.04], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.22, 1.96, 0.22], scale: [0.035, 0.035, 0.035], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Obsidian shoulder plates with magma vents.
  { material: 'metal', position: [-0.34, 1.4, -0.02], scale: [0.18, 0.16, 0.24], bone: 'torso' },
  { material: 'metal', position: [0.34, 1.4, -0.02], scale: [0.18, 0.16, 0.24], bone: 'torso' },
  { material: 'glow', position: [-0.34, 1.46, -0.04], scale: [0.14, 0.03, 0.18], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.34, 1.46, -0.04], scale: [0.14, 0.03, 0.18], emissive: true, transparent: true, bone: 'torso' },
  // Magma chest core.
  { material: 'metal', position: [0, 1.32, -0.27], scale: [0.34, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.292], scale: [0.09, 0.09, 0.09], emissive: true, transparent: true },
  // Pyre staff core (rocket-staff arm).
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.14, 0.03, 0.14], emissive: true, bone: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.62, -0.38], scale: [0.18, 0.024, 0.18], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.8, -0.38], scale: [0.1, 0.1, 0.1], emissive: true, transparent: true, bone: 'rightForearm' },
  // Floating pyre ember above the crown.
  { material: 'glow', kind: 'sphere', position: [0.075, 2.42, -0.02], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true, attachmentMode: 'floating' },
], 'blaze.pyreTyrant.body');

export const CLOCKWORK_MARSHAL_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.66, 0.012, 0.66], transparent: true },
  // Brass gear pauldrons.
  { material: 'metal', position: [-0.32, 1.4, -0.02], scale: [0.16, 0.14, 0.22], bone: 'torso' },
  { material: 'metal', position: [0.32, 1.4, -0.02], scale: [0.16, 0.14, 0.22], bone: 'torso' },
  { material: 'accent', kind: 'cylinder', position: [-0.34, 1.42, -0.04], scale: [0.1, 0.026, 0.1], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'torso' },
  { material: 'accent', kind: 'cylinder', position: [0.34, 1.42, -0.04], scale: [0.1, 0.026, 0.1], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'torso' },
  // Slow-turning back gear ring.
  { material: 'metal', kind: 'cylinder', position: [0, 1.3, 0.26], scale: [0.34, 0.04, 0.34], rotation: [Math.PI / 2, 0, 0], bone: 'torso' },
  { material: 'glow', kind: 'cylinder', position: [0, 1.3, 0.28], scale: [0.4, 0.012, 0.4], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'torso' },
  // Marshal crest.
  { material: 'metal', position: [0, 1.96, -0.02], scale: [0.05, 0.18, 0.13] },
  { material: 'glow', kind: 'sphere', position: [0, 2.08, -0.02], scale: [0.05, 0.05, 0.05], emissive: true },
  // Chest chrono-dial with hands.
  { material: 'accent', position: [0, 1.16, -0.266], scale: [0.24, 0.034, 0.026], emissive: true },
  { material: 'glow', kind: 'cylinder', position: [0, 1.16, -0.278], scale: [0.18, 0.014, 0.18], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true },
  { material: 'metal', position: [0, 1.16, -0.28], scale: [0.018, 0.12, 0.02], emissive: true },
  { material: 'metal', position: [0.05, 1.18, -0.28], scale: [0.09, 0.018, 0.02], rotation: [0, 0, 0.6], emissive: true },
  // Forearm gear cuffs + knee guards.
  { material: 'metal', kind: 'cylinder', position: [-0.43, 0.96, -0.04], scale: [0.09, 0.04, 0.09], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'leftForearm' },
  { material: 'metal', kind: 'cylinder', position: [0.43, 0.96, -0.04], scale: [0.09, 0.04, 0.09], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.16, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
  { material: 'metal', position: [0.16, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
], 'chronos.clockworkMarshal.body');

export const QUANTUM_ARBITER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.78, 0.012, 0.78], transparent: true },
  // Crossed prism orbital rings + head halo.
  { material: 'glow', kind: 'cylinder', position: [0, 1.28, 0], scale: [0.7, 0.012, 0.7], rotation: [1.2, 0, 0.42], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', kind: 'cylinder', position: [0, 1.28, 0], scale: [0.66, 0.012, 0.66], rotation: [1.2, 0, -0.42], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'cylinder', position: [0, 1.28, 0], scale: [0.62, 0.012, 0.62], rotation: [0.4, 0.5, 0], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'metal', kind: 'cylinder', position: [0, 1.86, -0.02], scale: [0.34, 0.012, 0.34], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'head' },
  // Shoulder spires.
  { material: 'metal', position: [-0.18, 1.92, -0.04], scale: [0.07, 0.24, 0.16], rotation: [0, 0, 0.3] },
  { material: 'metal', position: [0.18, 1.92, -0.04], scale: [0.07, 0.24, 0.16], rotation: [0, 0, -0.3] },
  // Singularity chest orb.
  { material: 'metal', position: [0, 1.32, -0.27], scale: [0.34, 0.04, 0.026], emissive: true },
  { material: 'glass', kind: 'sphere', position: [0, 1.1, -0.29], scale: [0.1, 0.1, 0.1], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.27], scale: [0.05, 0.05, 0.04], emissive: true, transparent: true },
  // Probability shards: drifting prism fragments instead of conduit wings
  // (complements the crossed orbital rings above).
  { material: 'glass', position: [-0.46, 1.56, 0.16], scale: [0.05, 0.1, 0.035], rotation: [0.2, 0, -0.5], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', position: [0.5, 1.3, 0.12], scale: [0.04, 0.11, 0.03], rotation: [0, 0.3, 0.4], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', position: [-0.42, 1.08, 0.18], scale: [0.04, 0.08, 0.03], rotation: [0.3, 0, 0.2], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.44, 1.62, 0.08], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Floating prism shoulder orbs.
  { material: 'glass', kind: 'sphere', position: [-0.42, 1.5, 0], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [0.42, 1.5, 0], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Crown spire.
  { material: 'metal', position: [0, 2.06, -0.02], scale: [0.045, 0.2, 0.05] },
  { material: 'glow', kind: 'sphere', position: [0, 2.2, -0.02], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true },
  // Forearm prism cuffs + chest collar dial.
  { material: 'glass', kind: 'cylinder', position: [-0.43, 0.96, -0.04], scale: [0.08, 0.04, 0.08], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'leftForearm' },
  { material: 'glass', kind: 'cylinder', position: [0.43, 0.96, -0.04], scale: [0.08, 0.04, 0.08], rotation: [Math.PI / 2, 0, 0], emissive: true, transparent: true, bone: 'rightForearm' },
  { material: 'accent', position: [0, 1.16, -0.276], scale: [0.26, 0.034, 0.026], emissive: true },
], 'chronos.quantumArbiter.body');

export const STATIC_WRAITH_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.6, 0.012, 0.6], transparent: true },
  // Broadcast antenna crest: a bent twin-aerial mast with a signal bead.
  { material: 'metal', position: [0.06, 2.08, -0.02], scale: [0.028, 0.26, 0.03], rotation: [0, 0, -0.14] },
  { material: 'metal', position: [-0.08, 2.02, -0.02], scale: [0.024, 0.18, 0.026], rotation: [0, 0, 0.3] },
  { material: 'glow', kind: 'sphere', position: [0.1, 2.24, -0.02], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true },
  // Scanline visor: a cyan sweep bar over the void mask with a magenta tear.
  { material: 'glow', position: [0, 1.66, -0.225], scale: [0.3, 0.026, 0.026], emissive: true },
  { material: 'accent', position: [0.05, 1.61, -0.225], scale: [0.18, 0.02, 0.024], emissive: true },
  // Displaced-frame pauldrons: each shoulder slab drags a magenta ghost frame
  // offset like a dropped video frame.
  { material: 'armor', position: [-0.34, 1.42, -0.02], scale: [0.16, 0.13, 0.24], bone: 'torso' },
  { material: 'armor', position: [0.34, 1.42, -0.02], scale: [0.16, 0.13, 0.24], bone: 'torso' },
  { material: 'accent', position: [-0.38, 1.46, 0.03], scale: [0.15, 0.12, 0.22], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [0.3, 1.38, -0.07], scale: [0.15, 0.12, 0.22], emissive: true, transparent: true, bone: 'torso' },
  // Interference chest bars: broken-signal strips of uneven width and offset.
  { material: 'glow', position: [-0.03, 1.24, -0.25], scale: [0.26, 0.028, 0.024], emissive: true },
  { material: 'accent', position: [0.05, 1.14, -0.25], scale: [0.18, 0.024, 0.024], emissive: true },
  { material: 'glow', position: [-0.06, 1.04, -0.25], scale: [0.12, 0.022, 0.024], emissive: true },
  // Static back panel with scan bars.
  { material: 'dark', position: [0, 1.16, 0.22], scale: [0.32, 0.6, 0.04], bone: 'torso' },
  { material: 'glow', position: [0.02, 1.34, 0.23], scale: [0.26, 0.024, 0.03], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', position: [-0.03, 1.08, 0.23], scale: [0.2, 0.02, 0.03], emissive: true, transparent: true, bone: 'torso' },
  // Drifting static shards: dead-pixel fragments hanging off the frame.
  { material: 'glass', position: [-0.46, 1.5, 0.1], scale: [0.05, 0.05, 0.05], rotation: [0.3, 0, 0.5], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', position: [0.5, 1.32, 0.14], scale: [0.035, 0.035, 0.035], rotation: [0, 0.4, 0.2], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', position: [-0.42, 1.1, 0.16], scale: [0.04, 0.04, 0.04], rotation: [0.5, 0.2, 0], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', position: [0.44, 1.6, 0.06], scale: [0.03, 0.06, 0.03], rotation: [0, 0, -0.4], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Signal-dead shin trim.
  { material: 'metal', position: [-0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
  { material: 'metal', position: [0.15, 0.46, -0.07], scale: [0.11, 0.03, 0.03] },
], 'phantom.staticWraith.body');

export const CRIMSON_LOTUS_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.74, 0.012, 0.74], transparent: true },
  // Thorn crown: three curved briar prongs sweeping back over the cowl.
  { material: 'metal', position: [0, 2.06, 0.02], scale: [0.04, 0.2, 0.05], rotation: [0.18, 0, 0] },
  { material: 'metal', position: [-0.13, 2.0, 0.02], scale: [0.035, 0.16, 0.045], rotation: [0.18, 0, 0.34] },
  { material: 'metal', position: [0.13, 2.0, 0.02], scale: [0.035, 0.16, 0.045], rotation: [0.18, 0, -0.34] },
  { material: 'accent', kind: 'sphere', position: [0, 2.2, 0.05], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true },
  // Layered petal mantle: overlapping crimson petals draped over the shoulders.
  { material: 'armor', position: [-0.32, 1.5, -0.02], scale: [0.14, 0.24, 0.2], rotation: [0, 0, -0.46], bone: 'torso' },
  { material: 'armor', position: [0.32, 1.5, -0.02], scale: [0.14, 0.24, 0.2], rotation: [0, 0, 0.46], bone: 'torso' },
  { material: 'accent', position: [-0.38, 1.38, -0.02], scale: [0.1, 0.2, 0.16], rotation: [0, 0, -0.62], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0.38, 1.38, -0.02], scale: [0.1, 0.2, 0.16], rotation: [0, 0, 0.62], emissive: true, bone: 'torso' },
  { material: 'edge', position: [-0.44, 1.26, -0.02], scale: [0.06, 0.14, 0.12], rotation: [0, 0, -0.74], emissive: true, bone: 'torso' },
  { material: 'edge', position: [0.44, 1.26, -0.02], scale: [0.06, 0.14, 0.12], rotation: [0, 0, 0.74], emissive: true, bone: 'torso' },
  // Blooming lotus chest sigil: a soul core wrapped in four angled petals.
  { material: 'glow', kind: 'sphere', position: [0, 1.12, -0.26], scale: [0.08, 0.08, 0.05], emissive: true, transparent: true },
  { material: 'accent', position: [-0.08, 1.2, -0.25], scale: [0.06, 0.12, 0.026], rotation: [0, 0, 0.5], emissive: true },
  { material: 'accent', position: [0.08, 1.2, -0.25], scale: [0.06, 0.12, 0.026], rotation: [0, 0, -0.5], emissive: true },
  { material: 'accent', position: [-0.08, 1.04, -0.25], scale: [0.06, 0.12, 0.026], rotation: [0, 0, -0.5], emissive: true },
  { material: 'accent', position: [0.08, 1.04, -0.25], scale: [0.06, 0.12, 0.026], rotation: [0, 0, 0.5], emissive: true },
  // Trailing petal skirt off the hips.
  { material: 'armor', position: [-0.18, 0.5, 0.22], scale: [0.14, 0.4, 0.045], rotation: [0.12, 0, -0.14], bone: 'hips' },
  { material: 'armor', position: [0.18, 0.5, 0.22], scale: [0.14, 0.4, 0.045], rotation: [0.12, 0, 0.14], bone: 'hips' },
  { material: 'edge', position: [0, 0.44, 0.24], scale: [0.12, 0.34, 0.04], rotation: [0.16, 0, 0], emissive: true, transparent: true, bone: 'hips' },
  // Drifting loose petals caught in the void draft.
  { material: 'accent', position: [-0.48, 1.44, 0.14], scale: [0.05, 0.08, 0.026], rotation: [0.4, 0.3, -0.5], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', position: [0.5, 1.2, 0.16], scale: [0.045, 0.07, 0.024], rotation: [0.2, -0.4, 0.5], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', position: [0.42, 1.58, 0.08], scale: [0.04, 0.06, 0.022], rotation: [0, 0.5, 0.3], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Thorn wrist cuffs and briar shin wraps.
  { material: 'metal', position: [-0.43, 0.96, -0.05], scale: [0.12, 0.06, 0.12], bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.96, -0.05], scale: [0.12, 0.06, 0.12], bone: 'rightForearm' },
  { material: 'edge', position: [-0.15, 0.44, -0.07], scale: [0.11, 0.028, 0.028] },
  { material: 'edge', position: [0.15, 0.44, -0.07], scale: [0.11, 0.028, 0.028] },
], 'phantom.crimsonLotus.body');

export const GLACIER_BREAKER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.64, 0.012, 0.64], transparent: true },
  // Ice-slab pauldrons capped in blue glacier glass.
  { material: 'metal', position: [-0.4, 1.42, -0.04], scale: [0.2, 0.16, 0.24], rotation: [0, 0, -0.16], bone: 'torso' },
  { material: 'metal', position: [0.4, 1.42, -0.04], scale: [0.2, 0.16, 0.24], rotation: [0, 0, 0.16], bone: 'torso' },
  { material: 'glass', position: [-0.42, 1.52, -0.04], scale: [0.16, 0.06, 0.2], rotation: [0, 0, -0.16], transparent: true, bone: 'torso' },
  { material: 'glass', position: [0.42, 1.52, -0.04], scale: [0.16, 0.06, 0.2], rotation: [0, 0, 0.16], transparent: true, bone: 'torso' },
  // Icicle fringe hanging off each pauldron.
  { material: 'glass', kind: 'cone', position: [-0.46, 1.28, -0.12], scale: [0.04, 0.12, 0.04], rotation: [Math.PI, 0, 0], transparent: true, bone: 'torso' },
  { material: 'glass', kind: 'cone', position: [-0.36, 1.26, 0.06], scale: [0.035, 0.16, 0.035], rotation: [Math.PI, 0, 0], transparent: true, bone: 'torso' },
  { material: 'glass', kind: 'cone', position: [0.46, 1.28, -0.12], scale: [0.04, 0.12, 0.04], rotation: [Math.PI, 0, 0], transparent: true, bone: 'torso' },
  { material: 'glass', kind: 'cone', position: [0.38, 1.26, 0.08], scale: [0.035, 0.15, 0.035], rotation: [Math.PI, 0, 0], transparent: true, bone: 'torso' },
  // Frost crest fin over the helm.
  { material: 'metal', position: [0, 1.97, -0.02], scale: [0.05, 0.16, 0.14] },
  { material: 'glass', position: [0, 2.08, -0.02], scale: [0.04, 0.1, 0.11], transparent: true },
  // Glacial chest core and frost collar.
  { material: 'accent', position: [0, 1.24, -0.262], scale: [0.3, 0.036, 0.026], emissive: true },
  { material: 'glass', kind: 'sphere', position: [0, 1.08, -0.275], scale: [0.08, 0.08, 0.055], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.08, -0.26], scale: [0.045, 0.045, 0.035], emissive: true, transparent: true },
  // Twin frost fins venting cold light down the back.
  { material: 'metal', position: [-0.16, 1.32, 0.25], scale: [0.06, 0.44, 0.045], rotation: [0, 0, -0.06], bone: 'torso' },
  { material: 'metal', position: [0.16, 1.32, 0.25], scale: [0.06, 0.44, 0.045], rotation: [0, 0, 0.06], bone: 'torso' },
  { material: 'glow', position: [-0.16, 1.14, 0.27], scale: [0.036, 0.3, 0.028], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.16, 1.14, 0.27], scale: [0.036, 0.3, 0.028], emissive: true, transparent: true, bone: 'torso' },
  // Icebreaker forearm clamps and frosted knee guards.
  { material: 'metal', position: [-0.6, 0.96, -0.305], scale: [0.18, 0.05, 0.036], bone: 'leftForearm' },
  { material: 'metal', position: [0.6, 0.98, -0.305], scale: [0.18, 0.05, 0.036], bone: 'rightForearm' },
  { material: 'metal', position: [-0.18, 0.5, -0.11], scale: [0.12, 0.04, 0.05] },
  { material: 'metal', position: [0.18, 0.5, -0.11], scale: [0.12, 0.04, 0.05] },
], 'hookshot.glacierBreaker.body');

export const VOID_ANGLER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.76, 0.012, 0.76], transparent: true },
  // Angler lure stalk: a bent mast arcing over the helm with a hanging lure
  // light drifting ahead of the visor — the skin's signature read.
  { material: 'metal', position: [0, 2.0, 0.04], scale: [0.035, 0.24, 0.04], rotation: [0.3, 0, 0] },
  { material: 'metal', position: [0, 2.14, -0.1], scale: [0.03, 0.05, 0.24], rotation: [0.16, 0, 0] },
  { material: 'glow', kind: 'sphere', position: [0, 2.04, -0.26], scale: [0.075, 0.075, 0.075], emissive: true, transparent: true, attachmentMode: 'floating' },
  { material: 'glass', kind: 'sphere', position: [0, 2.04, -0.26], scale: [0.11, 0.11, 0.11], transparent: true, attachmentMode: 'floating' },
  // Fang-hook collar: downward teeth ringing the gorget.
  { material: 'edge', kind: 'cone', position: [-0.14, 1.3, -0.24], scale: [0.04, 0.11, 0.04], rotation: [Math.PI, 0, 0] },
  { material: 'edge', kind: 'cone', position: [0.14, 1.3, -0.24], scale: [0.04, 0.11, 0.04], rotation: [Math.PI, 0, 0] },
  { material: 'edge', kind: 'cone', position: [-0.05, 1.32, -0.25], scale: [0.035, 0.14, 0.035], rotation: [Math.PI, 0, 0] },
  { material: 'edge', kind: 'cone', position: [0.05, 1.32, -0.25], scale: [0.035, 0.14, 0.035], rotation: [Math.PI, 0, 0] },
  // Dorsal fin spines stepping down the back.
  { material: 'metal', position: [0, 1.62, 0.24], scale: [0.05, 0.2, 0.07], rotation: [0.2, 0, 0], bone: 'torso' },
  { material: 'metal', position: [0, 1.4, 0.27], scale: [0.045, 0.16, 0.06], rotation: [0.24, 0, 0], bone: 'torso' },
  { material: 'metal', position: [0, 1.2, 0.29], scale: [0.04, 0.13, 0.05], rotation: [0.28, 0, 0], bone: 'torso' },
  { material: 'edge', position: [0, 0.94, 0.28], scale: [0.035, 0.1, 0.045], rotation: [0.3, 0, 0], emissive: true, bone: 'hips' },
  // Bioluminescent gill vents slanting along the ribs.
  { material: 'glow', position: [-0.2, 1.16, -0.26], scale: [0.09, 0.024, 0.024], rotation: [0, 0, 0.42], emissive: true },
  { material: 'glow', position: [-0.22, 1.06, -0.26], scale: [0.08, 0.022, 0.022], rotation: [0, 0, 0.42], emissive: true },
  { material: 'glow', position: [0.2, 1.16, -0.26], scale: [0.09, 0.024, 0.024], rotation: [0, 0, -0.42], emissive: true },
  { material: 'glow', position: [0.22, 1.06, -0.26], scale: [0.08, 0.022, 0.022], rotation: [0, 0, -0.42], emissive: true },
  // Deep-pressure chest light.
  { material: 'accent', position: [0, 1.26, -0.268], scale: [0.3, 0.034, 0.024], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.28], scale: [0.07, 0.07, 0.05], emissive: true, transparent: true },
  // Drifting plankton motes pulled along in the dark.
  { material: 'glow', kind: 'sphere', position: [-0.44, 1.48, 0.12], scale: [0.035, 0.035, 0.035], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [0.48, 1.3, 0.16], scale: [0.04, 0.04, 0.04], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.4, 1.62, 0.06], scale: [0.028, 0.028, 0.028], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Fang barbs riding beside the hook lines.
  { material: 'edge', position: [-0.7, 0.7, -0.76], scale: [0.034, 0.042, 0.13], rotation: [0, 0.5, 0], emissive: true, bone: 'leftForearm' },
  { material: 'edge', position: [0.7, 0.73, -0.76], scale: [0.034, 0.042, 0.13], rotation: [0, -0.5, 0], emissive: true, bone: 'rightForearm' },
], 'hookshot.voidAngler.body');

export const FROSTFIRE_HERALD_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.6, 0.012, 0.6], transparent: true },
  // Cryo shoulder vents burning cold blue flame.
  { material: 'dark', position: [-0.33, 1.4, -0.02], scale: [0.16, 0.14, 0.22], bone: 'torso' },
  { material: 'dark', position: [0.33, 1.4, -0.02], scale: [0.16, 0.14, 0.22], bone: 'torso' },
  { material: 'glow', kind: 'cone', position: [-0.33, 1.58, -0.02], scale: [0.09, 0.2, 0.09], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', kind: 'cone', position: [0.33, 1.58, -0.02], scale: [0.09, 0.2, 0.09], emissive: true, transparent: true, bone: 'torso' },
  // Helm crest with a hovering frost mote.
  { material: 'metal', position: [0, 1.98, -0.02], scale: [0.05, 0.15, 0.12] },
  { material: 'glow', kind: 'sphere', position: [0.06, 2.24, -0.02], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating' },
  // Cold-flame chest sigil: an azure center tongue flanked by angled licks.
  { material: 'glow', position: [0, 1.12, -0.265], scale: [0.05, 0.3, 0.026], emissive: true, transparent: true },
  { material: 'accent', position: [-0.09, 1.08, -0.262], scale: [0.04, 0.2, 0.024], rotation: [0, 0, 0.22], emissive: true, transparent: true },
  { material: 'accent', position: [0.09, 1.08, -0.262], scale: [0.04, 0.2, 0.024], rotation: [0, 0, -0.22], emissive: true, transparent: true },
  { material: 'metal', position: [0, 1.3, -0.258], scale: [0.3, 0.04, 0.026], emissive: true },
  // Coolant conduits running the flanks.
  { material: 'accent', position: [-0.24, 1.12, -0.24], scale: [0.026, 0.36, 0.022], emissive: true },
  { material: 'accent', position: [0.24, 1.12, -0.24], scale: [0.026, 0.36, 0.022], emissive: true },
  // Azure staff crystal on the rocket-staff arm.
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.12, 0.03, 0.12], emissive: true, bone: 'rightForearm' },
  { material: 'glass', kind: 'sphere', position: [0.52, 1.7, -0.38], scale: [0.14, 0.14, 0.14], emissive: true, transparent: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.7, -0.38], scale: [0.08, 0.08, 0.08], emissive: true, bone: 'rightForearm' },
  // Frost venting down the back.
  { material: 'glow', position: [-0.14, 1.24, 0.24], scale: [0.04, 0.32, 0.028], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.14, 1.24, 0.24], scale: [0.04, 0.32, 0.028], emissive: true, transparent: true, bone: 'torso' },
  // Iced knee plates.
  { material: 'metal', position: [-0.17, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
  { material: 'metal', position: [0.17, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
], 'blaze.frostfireHerald.body');

export const EMBER_DRAKE_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.76, 0.012, 0.76], transparent: true },
  // Drake horn crown: paired curved horns with emerald tips.
  { material: 'metal', position: [-0.16, 2.0, 0], scale: [0.05, 0.2, 0.06], rotation: [0.1, 0, 0.4] },
  { material: 'metal', position: [0.16, 2.0, 0], scale: [0.05, 0.2, 0.06], rotation: [0.1, 0, -0.4] },
  { material: 'accent', position: [-0.24, 2.12, 0.02], scale: [0.035, 0.12, 0.045], rotation: [0.1, 0, 0.62], emissive: true },
  { material: 'accent', position: [0.24, 2.12, 0.02], scale: [0.035, 0.12, 0.045], rotation: [0.1, 0, -0.62], emissive: true },
  // Drake brow visor ridge.
  { material: 'metal', position: [0, 1.76, -0.2], scale: [0.32, 0.05, 0.06], rotation: [0.2, 0, 0] },
  // Dorsal spine ridge stepping down the back.
  { material: 'metal', position: [0, 1.64, 0.22], scale: [0.05, 0.18, 0.07], rotation: [0.16, 0, 0], bone: 'torso' },
  { material: 'edge', position: [0, 1.44, 0.25], scale: [0.045, 0.15, 0.06], rotation: [0.2, 0, 0], emissive: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.24, 0.27], scale: [0.04, 0.12, 0.05], rotation: [0.24, 0, 0], bone: 'torso' },
  { material: 'edge', position: [0, 0.96, 0.27], scale: [0.035, 0.1, 0.045], rotation: [0.28, 0, 0], emissive: true, bone: 'hips' },
  // Layered scale pauldrons.
  { material: 'armor', position: [-0.35, 1.46, -0.02], scale: [0.17, 0.1, 0.24], rotation: [0, 0, -0.18], bone: 'torso' },
  { material: 'armor', position: [0.35, 1.46, -0.02], scale: [0.17, 0.1, 0.24], rotation: [0, 0, 0.18], bone: 'torso' },
  { material: 'metal', position: [-0.38, 1.36, -0.02], scale: [0.14, 0.08, 0.2], rotation: [0, 0, -0.26], bone: 'torso' },
  { material: 'metal', position: [0.38, 1.36, -0.02], scale: [0.14, 0.08, 0.2], rotation: [0, 0, 0.26], bone: 'torso' },
  // Drake-eye chest core: an emerald slit iris in a molten socket.
  { material: 'metal', position: [0, 1.3, -0.264], scale: [0.32, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.28], scale: [0.085, 0.085, 0.055], emissive: true, transparent: true },
  { material: 'dark', position: [0, 1.1, -0.295], scale: [0.024, 0.11, 0.02] },
  // Drakefire staff core on the rocket-staff arm.
  { material: 'metal', kind: 'cylinder', position: [0.52, 1.48, -0.38], scale: [0.13, 0.03, 0.13], emissive: true, bone: 'rightForearm' },
  { material: 'accent', kind: 'cylinder', position: [0.52, 1.6, -0.38], scale: [0.16, 0.024, 0.16], emissive: true, bone: 'rightForearm' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.76, -0.38], scale: [0.1, 0.1, 0.1], emissive: true, transparent: true, bone: 'rightForearm' },
  // Emberfly sparks drifting off the scales.
  { material: 'glow', kind: 'sphere', position: [-0.42, 1.52, 0.1], scale: [0.032, 0.032, 0.032], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', kind: 'sphere', position: [0.46, 1.3, 0.14], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [-0.36, 1.06, 0.18], scale: [0.026, 0.026, 0.026], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Scaled tail plate off the hips and clawed knee guards.
  { material: 'armor', position: [0, 0.56, 0.24], scale: [0.16, 0.34, 0.05], rotation: [0.2, 0, 0], bone: 'hips' },
  { material: 'metal', position: [-0.17, 0.5, -0.1], scale: [0.11, 0.04, 0.06] },
  { material: 'metal', position: [0.17, 0.5, -0.1], scale: [0.11, 0.04, 0.06] },
], 'blaze.emberDrake.body');

export const DUNE_PROPHET_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.68, 0.012, 0.68], transparent: true },
  // Chest hourglass: framed sand bulbs pinched around a falling amber thread.
  { material: 'glass', kind: 'cone', position: [0, 1.22, -0.258], scale: [0.13, 0.11, 0.05], rotation: [Math.PI, 0, 0], transparent: true },
  { material: 'glass', kind: 'cone', position: [0, 1.06, -0.258], scale: [0.13, 0.11, 0.05], transparent: true },
  { material: 'glow', position: [0, 1.14, -0.262], scale: [0.02, 0.14, 0.02], emissive: true },
  { material: 'metal', position: [0, 1.3, -0.258], scale: [0.16, 0.026, 0.05] },
  { material: 'metal', position: [0, 0.98, -0.258], scale: [0.16, 0.026, 0.05] },
  // Drifting sand ring circling the frame.
  { material: 'glow', kind: 'cylinder', position: [0, 1.22, 0], scale: [0.62, 0.012, 0.62], rotation: [1.24, 0, 0.3], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'accent', kind: 'sphere', position: [-0.5, 1.34, 0.08], scale: [0.035, 0.035, 0.035], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.52, 1.12, 0.1], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Prophet's head wrap and brow band.
  { material: 'armor', position: [0, 1.88, 0.02], scale: [0.34, 0.16, 0.3] },
  { material: 'edge', position: [0, 1.8, -0.21], scale: [0.3, 0.04, 0.04], emissive: true },
  { material: 'armor', position: [0, 1.7, 0.19], scale: [0.3, 0.3, 0.07] },
  // Bone-and-amber pauldrons.
  { material: 'metal', position: [-0.32, 1.42, -0.02], scale: [0.15, 0.12, 0.22], rotation: [0, 0, -0.14], bone: 'torso' },
  { material: 'metal', position: [0.32, 1.42, -0.02], scale: [0.15, 0.12, 0.22], rotation: [0, 0, 0.14], bone: 'torso' },
  { material: 'accent', position: [-0.34, 1.5, -0.02], scale: [0.12, 0.04, 0.18], rotation: [0, 0, -0.14], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0.34, 1.5, -0.02], scale: [0.12, 0.04, 0.18], rotation: [0, 0, 0.14], emissive: true, bone: 'torso' },
  // Sand trickle lines and drifting motes down the back.
  { material: 'glow', position: [-0.12, 1.2, 0.23], scale: [0.03, 0.44, 0.024], emissive: true, transparent: true, bone: 'torso' },
  { material: 'glow', position: [0.12, 1.2, 0.23], scale: [0.03, 0.44, 0.024], emissive: true, transparent: true, bone: 'torso' },
  { material: 'accent', kind: 'sphere', position: [-0.2, 0.84, 0.26], scale: [0.03, 0.03, 0.03], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'hips' },
  { material: 'glow', kind: 'sphere', position: [0.16, 0.66, 0.28], scale: [0.026, 0.026, 0.026], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'hips' },
  // Wrist dials and sandstone knee plates.
  { material: 'metal', kind: 'cylinder', position: [-0.43, 0.96, -0.04], scale: [0.085, 0.04, 0.085], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'leftForearm' },
  { material: 'metal', kind: 'cylinder', position: [0.43, 0.96, -0.04], scale: [0.085, 0.04, 0.085], rotation: [Math.PI / 2, 0, 0], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.16, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
  { material: 'metal', position: [0.16, 0.5, -0.1], scale: [0.11, 0.04, 0.05] },
], 'chronos.duneProphet.body');

export const ZODIAC_WEAVER_EXTRA_PARTS: VoxelPart[] = addVoxelPartMetadata([
  { material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.88, 0.012, 0.88], transparent: true },
  // Crossed zodiac bands with orbiting star gems.
  { material: 'metal', kind: 'cylinder', position: [0, 1.32, 0], scale: [0.68, 0.014, 0.68], rotation: [1.16, 0, 0.36], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'cylinder', position: [0, 1.32, 0], scale: [0.74, 0.012, 0.74], rotation: [1.16, 0, -0.36], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [-0.54, 1.5, 0.1], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glass', kind: 'sphere', position: [0.56, 1.2, 0.08], scale: [0.045, 0.045, 0.045], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.48, 1.56, 0.12], scale: [0.035, 0.035, 0.035], emissive: true, transparent: true, attachmentMode: 'floating', bone: 'torso' },
  // Silver starlight crown: a halo ring under a star-topped spire.
  { material: 'metal', kind: 'cylinder', position: [0, 2.0, -0.04], scale: [0.3, 0.014, 0.3], rotation: [Math.PI / 2, 0, 0], emissive: true, attachmentMode: 'floating' },
  { material: 'metal', position: [0, 2.12, -0.02], scale: [0.045, 0.2, 0.05] },
  { material: 'metal', position: [-0.12, 2.05, -0.02], scale: [0.035, 0.12, 0.045], rotation: [0, 0, 0.3] },
  { material: 'metal', position: [0.12, 2.05, -0.02], scale: [0.035, 0.12, 0.045], rotation: [0, 0, -0.3] },
  { material: 'glow', kind: 'sphere', position: [0, 2.28, -0.02], scale: [0.06, 0.06, 0.06], emissive: true, transparent: true },
  // Star-chart mantle: a midnight panel pinned with constellation lights.
  { material: 'dark', position: [0, 1.14, 0.23], scale: [0.36, 0.64, 0.04], bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [-0.1, 1.36, 0.25], scale: [0.026, 0.026, 0.026], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.08, 1.24, 0.25], scale: [0.03, 0.03, 0.03], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [-0.05, 1.06, 0.25], scale: [0.024, 0.024, 0.024], emissive: true, bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0.12, 0.94, 0.25], scale: [0.026, 0.026, 0.026], emissive: true, bone: 'torso' },
  { material: 'edge', position: [-0.01, 1.3, 0.25], scale: [0.02, 0.16, 0.016], rotation: [0, 0, 0.6], emissive: true, transparent: true, bone: 'torso' },
  { material: 'edge', position: [0.02, 1.15, 0.25], scale: [0.02, 0.14, 0.016], rotation: [0, 0, -0.5], emissive: true, transparent: true, bone: 'torso' },
  { material: 'edge', position: [0.04, 1.0, 0.25], scale: [0.018, 0.13, 0.016], rotation: [0, 0, 0.45], emissive: true, transparent: true, bone: 'torso' },
  // Constellation chest sigil: linked starlights over a silver collar.
  { material: 'metal', position: [0, 1.32, -0.27], scale: [0.36, 0.04, 0.026], emissive: true },
  { material: 'glow', kind: 'sphere', position: [-0.1, 1.18, -0.27], scale: [0.036, 0.036, 0.03], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [0.08, 1.1, -0.27], scale: [0.042, 0.042, 0.032], emissive: true, transparent: true },
  { material: 'glow', kind: 'sphere', position: [-0.03, 1.0, -0.27], scale: [0.032, 0.032, 0.028], emissive: true, transparent: true },
  { material: 'accent', position: [-0.01, 1.14, -0.27], scale: [0.018, 0.13, 0.016], rotation: [0, 0, 0.55], emissive: true, transparent: true },
  { material: 'accent', position: [0.03, 1.05, -0.27], scale: [0.016, 0.12, 0.016], rotation: [0, 0, -0.5], emissive: true, transparent: true },
  // Woven silver cuffs and starlit knee trim.
  { material: 'metal', position: [-0.43, 0.96, -0.05], scale: [0.12, 0.06, 0.12], emissive: true, bone: 'leftForearm' },
  { material: 'metal', position: [0.43, 0.96, -0.05], scale: [0.12, 0.06, 0.12], emissive: true, bone: 'rightForearm' },
  { material: 'metal', position: [-0.16, 0.48, -0.09], scale: [0.11, 0.032, 0.03] },
  { material: 'metal', position: [0.16, 0.48, -0.09], scale: [0.11, 0.032, 0.03] },
], 'chronos.zodiacWeaver.body');

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
  { material: 'edge', kind: 'cylinder', position: [-0.6, 0.7, -0.42], scale: [0.024, 0.34, 0.024], rotation: [Math.PI / 2, 0, 0], bone: 'leftForearm' },
  { material: 'edge', position: [0.5, 0.83, -0.06], scale: [0.18, 0.36, 0.16], bone: 'rightForearm' },
  { material: 'accent', position: [0.57, 0.84, -0.2], scale: [0.16, 0.25, 0.056], emissive: true, bone: 'rightForearm' },
  { material: 'dark', position: [0.6, 0.86, -0.34], scale: [0.19, 0.18, 0.18], bone: 'rightForearm' },
  { material: 'edge', position: [0.6, 0.86, -0.49], scale: [0.14, 0.14, 0.16], bone: 'rightForearm' },
  { material: 'edge', kind: 'cylinder', position: [0.6, 0.73, -0.42], scale: [0.024, 0.38, 0.024], rotation: [Math.PI / 2, 0, 0], bone: 'rightForearm' },

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
  // Base polish: a diver air-tank harness on the back, a chest anchor emblem,
  // a swept cowl, and knee guards — leans into the deep-sea grappler identity.
  { material: 'dark', kind: 'cylinder', position: [0, 1.16, 0.27], scale: [0.13, 0.46, 0.13], bone: 'torso' },
  { material: 'metal', kind: 'cylinder', position: [0, 1.4, 0.27], scale: [0.1, 0.06, 0.1], bone: 'torso' },
  { material: 'glow', kind: 'sphere', position: [0, 0.94, 0.3], scale: [0.05, 0.05, 0.05], emissive: true, transparent: true, bone: 'torso' },
  { material: 'metal', position: [0, 1.04, -0.235], scale: [0.04, 0.2, 0.03] },
  { material: 'metal', position: [0, 0.93, -0.235], scale: [0.16, 0.05, 0.03] },
  { material: 'accent', position: [0, 1.16, -0.236], scale: [0.1, 0.05, 0.03], emissive: true },
  { material: 'dark', position: [0, 1.84, 0.13], scale: [0.22, 0.14, 0.16], rotation: [0.34, 0, 0] },
  { material: 'metal', position: [-0.19, 0.5, -0.1], scale: [0.12, 0.13, 0.09] },
  { material: 'metal', position: [0.19, 0.5, -0.1], scale: [0.12, 0.13, 0.09] },
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
  { material: 'glow', kind: 'sphere', position: [0.075, 2.39, -0.02], scale: [0.055, 0.055, 0.055], emissive: true, attachmentMode: 'floating' },
  // Base polish: a molten chest core, flame-guard pauldrons with ember trim,
  // and knee plates give the assault chassis more bulk and read.
  { material: 'glow', kind: 'sphere', position: [0, 1.1, -0.235], scale: [0.06, 0.08, 0.04], emissive: true, transparent: true },
  { material: 'armor', position: [-0.32, 1.37, -0.02], scale: [0.14, 0.15, 0.24], rotation: [0, 0, -0.16], bone: 'torso' },
  { material: 'armor', position: [0.32, 1.37, -0.02], scale: [0.14, 0.15, 0.24], rotation: [0, 0, 0.16], bone: 'torso' },
  { material: 'accent', position: [-0.34, 1.46, -0.02], scale: [0.12, 0.04, 0.2], emissive: true, bone: 'torso' },
  { material: 'accent', position: [0.34, 1.46, -0.02], scale: [0.12, 0.04, 0.2], emissive: true, bone: 'torso' },
  { material: 'armor', position: [-0.17, 0.52, -0.1], scale: [0.11, 0.13, 0.09] },
  { material: 'armor', position: [0.17, 0.52, -0.1], scale: [0.11, 0.13, 0.09] },
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
  // Base polish: a swept cowl, bronze time-plate pauldrons, and knee guards add
  // structure to the temporal-support frame.
  { material: 'dark', position: [0, 1.83, 0.13], scale: [0.2, 0.14, 0.16], rotation: [0.34, 0, 0] },
  { material: 'metal', position: [-0.32, 1.36, -0.02], scale: [0.14, 0.12, 0.22], rotation: [0, 0, -0.16], bone: 'torso' },
  { material: 'metal', position: [0.32, 1.36, -0.02], scale: [0.14, 0.12, 0.22], rotation: [0, 0, 0.16], bone: 'torso' },
  { material: 'glow', position: [-0.34, 1.44, -0.02], scale: [0.12, 0.03, 0.18], emissive: true, bone: 'torso' },
  { material: 'glow', position: [0.34, 1.44, -0.02], scale: [0.12, 0.03, 0.18], emissive: true, bone: 'torso' },
  { material: 'metal', position: [-0.16, 0.5, -0.1], scale: [0.11, 0.13, 0.09] },
  { material: 'metal', position: [0.16, 0.5, -0.1], scale: [0.11, 0.13, 0.09] },
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
    teamAccentPart({ material: 'accent', position: [-0.16, 0.18, -0.19], scale: [0.075, 0.055, 0.032], emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.1 }),
    teamAccentPart({ material: 'accent', position: [0.16, 0.18, -0.19], scale: [0.075, 0.055, 0.032], emissiveIntensity: 0.45, roughness: 0.4, metalness: 0.1 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.44, 0.014, 0.44], transparent: true, opacity: 0.16, emissiveIntensity: 0.22, roughness: 0.65, depthWrite: false }),
  ], 'phantom.teamAccent'),
  hookshot: addVoxelPartMetadata([
    teamAccentPart({ material: 'accent', position: [-0.18, 1.39, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.18, 1.39, -0.235], scale: [0.12, 0.04, 0.035], emissiveIntensity: 0.5, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.63, 0.91, -0.245], scale: [0.058, 0.26, 0.036], emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.2, toneMapped: false, bone: 'leftForearm' }),
    teamAccentPart({ material: 'accent', position: [0.63, 0.93, -0.245], scale: [0.058, 0.28, 0.036], emissiveIntensity: 0.5, roughness: 0.32, metalness: 0.2, toneMapped: false, bone: 'rightForearm' }),
    teamAccentPart({ material: 'accent', position: [-0.2, 0.2, -0.205], scale: [0.08, 0.05, 0.032], emissiveIntensity: 0.42, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.2, 0.2, -0.205], scale: [0.08, 0.05, 0.032], emissiveIntensity: 0.42, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'mist', kind: 'cylinder', position: [0, 0.018, 0], scale: [0.46, 0.014, 0.46], transparent: true, opacity: 0.16, emissiveIntensity: 0.22, roughness: 0.65, depthWrite: false }),
  ], 'hookshot.teamAccent'),
  blaze: addVoxelPartMetadata([
    teamAccentPart({ material: 'accent', position: [-0.26, 1.38, -0.215], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.5, roughness: 0.34, metalness: 0.22, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [0.26, 1.38, -0.215], scale: [0.1, 0.038, 0.034], emissiveIntensity: 0.5, roughness: 0.34, metalness: 0.22, toneMapped: false }),
    teamAccentPart({ material: 'accent', position: [-0.19, 1.01, -0.252], scale: [0.06, 0.13, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.18 }),
    teamAccentPart({ material: 'accent', position: [0.19, 1.01, -0.252], scale: [0.06, 0.13, 0.03], emissiveIntensity: 0.42, roughness: 0.38, metalness: 0.18 }),
    teamAccentPart({ material: 'accent', position: [-0.17, 0.24, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0.17, 0.24, -0.205], scale: [0.065, 0.045, 0.03], emissiveIntensity: 0.4, roughness: 0.42, metalness: 0.12 }),
    teamAccentPart({ material: 'accent', position: [0, 1.88, -0.282], scale: [0.28, 0.036, 0.03], emissiveIntensity: 0.48, roughness: 0.36, metalness: 0.2, toneMapped: false }),
    teamAccentPart({ material: 'accent', kind: 'cylinder', position: [0.52, 1.51, -0.38], scale: [0.12, 0.034, 0.12], emissiveIntensity: 0.46, roughness: 0.35, metalness: 0.18, toneMapped: false, bone: 'rightForearm' }),
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
  'phantom.umbral-reaver': createSkinBodyManifest('phantom', UMBRAL_REAVER_EXTRA_PARTS, UMBRAL_REAVER_COLORS, 0.16),
  'phantom.obsidian-revenant': createSkinBodyManifest('phantom', OBSIDIAN_REVENANT_EXTRA_PARTS, OBSIDIAN_REVENANT_COLORS, 0.2),
  'hookshot.tidebreaker': createSkinBodyManifest('hookshot', TIDEBREAKER_EXTRA_PARTS, TIDEBREAKER_COLORS, 0.11),
  'hookshot.iron-leviathan': createSkinBodyManifest('hookshot', IRON_LEVIATHAN_EXTRA_PARTS, IRON_LEVIATHAN_COLORS, 0.12),
  'hookshot.abyssal-corsair': createSkinBodyManifest('hookshot', ABYSSAL_CORSAIR_EXTRA_PARTS, ABYSSAL_CORSAIR_COLORS, 0.15),
  'hookshot.kraken-sovereign': createSkinBodyManifest('hookshot', KRAKEN_SOVEREIGN_EXTRA_PARTS, KRAKEN_SOVEREIGN_COLORS, 0.19),
  'hookshot.coral-warden': createSkinBodyManifest('hookshot', CORAL_WARDEN_EXTRA_PARTS, CORAL_WARDEN_COLORS, 0.13),
  'hookshot.maelstrom-warlord': createSkinBodyManifest('hookshot', MAELSTROM_WARLORD_EXTRA_PARTS, MAELSTROM_WARLORD_COLORS, 0.2),
  'blaze.solar-forge': createSkinBodyManifest('blaze', SOLAR_FORGE_EXTRA_PARTS, SOLAR_FORGE_COLORS, 0.14),
  'blaze.ashen-vanguard': createSkinBodyManifest('blaze', ASHEN_VANGUARD_EXTRA_PARTS, ASHEN_VANGUARD_COLORS, 0.15),
  'blaze.inferno-archon': createSkinBodyManifest('blaze', INFERNO_ARCHON_EXTRA_PARTS, INFERNO_ARCHON_COLORS, 0.19),
  'blaze.starfall-phoenix': createSkinBodyManifest('blaze', STARFALL_PHOENIX_EXTRA_PARTS, STARFALL_PHOENIX_COLORS, 0.23),
  'blaze.cinder-warden': createSkinBodyManifest('blaze', CINDER_WARDEN_EXTRA_PARTS, CINDER_WARDEN_COLORS, 0.15),
  'blaze.pyre-tyrant': createSkinBodyManifest('blaze', PYRE_TYRANT_EXTRA_PARTS, PYRE_TYRANT_COLORS, 0.2),
  'chronos.epoch-regent': createSkinBodyManifest('chronos', EPOCH_REGENT_EXTRA_PARTS, EPOCH_REGENT_COLORS, 0.17),
  'chronos.paradox-sentinel': createSkinBodyManifest('chronos', PARADOX_SENTINEL_EXTRA_PARTS, PARADOX_SENTINEL_COLORS, 0.18),
  'chronos.meridian-oracle': createSkinBodyManifest('chronos', MERIDIAN_ORACLE_EXTRA_PARTS, MERIDIAN_ORACLE_COLORS, 0.21),
  'chronos.eternity-sovereign': createSkinBodyManifest('chronos', ETERNITY_SOVEREIGN_EXTRA_PARTS, ETERNITY_SOVEREIGN_COLORS, 0.25),
  'chronos.clockwork-marshal': createSkinBodyManifest('chronos', CLOCKWORK_MARSHAL_EXTRA_PARTS, CLOCKWORK_MARSHAL_COLORS, 0.17),
  'chronos.quantum-arbiter': createSkinBodyManifest('chronos', QUANTUM_ARBITER_EXTRA_PARTS, QUANTUM_ARBITER_COLORS, 0.22),
  'phantom.liberty-wraith': createSkinBodyManifest('phantom', PHANTOM_LIBERTY_WRAITH_EXTRA_PARTS, PHANTOM_LIBERTY_WRAITH_COLORS, 0.19),
  'hookshot.liberty-anchor': createSkinBodyManifest('hookshot', HOOKSHOT_LIBERTY_ANCHOR_EXTRA_PARTS, HOOKSHOT_LIBERTY_ANCHOR_COLORS, 0.19),
  'blaze.liberty-flare': createSkinBodyManifest('blaze', BLAZE_LIBERTY_FLARE_EXTRA_PARTS, BLAZE_LIBERTY_FLARE_COLORS, 0.2),
  'chronos.liberty-sentinel': createSkinBodyManifest('chronos', CHRONOS_LIBERTY_SENTINEL_EXTRA_PARTS, CHRONOS_LIBERTY_SENTINEL_COLORS, 0.2),
  'phantom.golden': createSkinBodyManifest('phantom', PHANTOM_GOLDEN_EXTRA_PARTS, PHANTOM_GOLDEN_COLORS, 0.24),
  'hookshot.golden': createSkinBodyManifest('hookshot', HOOKSHOT_GOLDEN_EXTRA_PARTS, HOOKSHOT_GOLDEN_COLORS, 0.24),
  'blaze.golden': createSkinBodyManifest('blaze', BLAZE_GOLDEN_EXTRA_PARTS, BLAZE_GOLDEN_COLORS, 0.24),
  'chronos.golden': createSkinBodyManifest('chronos', CHRONOS_GOLDEN_EXTRA_PARTS, CHRONOS_GOLDEN_COLORS, 0.24),
  'phantom.static-wraith': createSkinBodyManifest('phantom', STATIC_WRAITH_EXTRA_PARTS, STATIC_WRAITH_COLORS, 0.16),
  'phantom.crimson-lotus': createSkinBodyManifest('phantom', CRIMSON_LOTUS_EXTRA_PARTS, CRIMSON_LOTUS_COLORS, 0.2),
  'hookshot.glacier-breaker': createSkinBodyManifest('hookshot', GLACIER_BREAKER_EXTRA_PARTS, GLACIER_BREAKER_COLORS, 0.13),
  'hookshot.void-angler': createSkinBodyManifest('hookshot', VOID_ANGLER_EXTRA_PARTS, VOID_ANGLER_COLORS, 0.2),
  'blaze.frostfire-herald': createSkinBodyManifest('blaze', FROSTFIRE_HERALD_EXTRA_PARTS, FROSTFIRE_HERALD_COLORS, 0.15),
  'blaze.ember-drake': createSkinBodyManifest('blaze', EMBER_DRAKE_EXTRA_PARTS, EMBER_DRAKE_COLORS, 0.2),
  'chronos.dune-prophet': createSkinBodyManifest('chronos', DUNE_PROPHET_EXTRA_PARTS, DUNE_PROPHET_COLORS, 0.17),
  'chronos.zodiac-weaver': createSkinBodyManifest('chronos', ZODIAC_WEAVER_EXTRA_PARTS, ZODIAC_WEAVER_COLORS, 0.25),
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
