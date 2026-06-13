import type { VoxelMapTheme } from './types.js';
import { hashSeed } from './rng.js';

export const STANDARD_VOXEL_MAP_THEMES: VoxelMapTheme[] = [
  {
    id: 'verdant',
    name: 'Verdant Mesa',
    skyColor: '#8ec9ff',
    ambientColor: '#f2f8ff',
    sunColor: '#fff1c7',
    fogColor: '#a6d7ff',
    ground: {
      top: '#52b85a',
      side: '#48883d',
      dirt: '#8c6640',
      stone: '#7b8188',
    },
    structures: {
      metal: '#536575',
      glass: '#7bdfff',
      barrier: '#323943',
      accent: '#ffe076',
    },
  },
  {
    id: 'basalt',
    name: 'Basalt Circuit',
    skyColor: '#5e7aa6',
    ambientColor: '#dce8ff',
    sunColor: '#b9dcff',
    fogColor: '#6f83a8',
    ground: {
      top: '#4f555d',
      side: '#383e45',
      dirt: '#2f3338',
      stone: '#646b73',
    },
    structures: {
      metal: '#202b3a',
      glass: '#74f0ff',
      barrier: '#171d24',
      accent: '#64f5d2',
    },
  },
  {
    id: 'desert',
    name: 'Sunstone Canyon',
    skyColor: '#9fd7ff',
    ambientColor: '#fff4dc',
    sunColor: '#fff0b8',
    fogColor: '#efd39b',
    ground: {
      top: '#d8b663',
      side: '#bd8b4d',
      dirt: '#9b643a',
      stone: '#b98961',
    },
    structures: {
      metal: '#73695b',
      glass: '#7ee8dd',
      barrier: '#3d3429',
      accent: '#ffcf6a',
    },
  },
  {
    id: 'frost',
    name: 'Frostline Vault',
    skyColor: '#bfe8ff',
    ambientColor: '#f6fbff',
    sunColor: '#d8f3ff',
    fogColor: '#d7efff',
    ground: {
      top: '#b8e6ef',
      side: '#7fb8c9',
      dirt: '#6f8795',
      stone: '#8fa9b8',
    },
    structures: {
      metal: '#4c6373',
      glass: '#d6fbff',
      barrier: '#24313a',
      accent: '#95e8ff',
    },
  },
  {
    id: 'crystal',
    name: 'Crystal Grove',
    skyColor: '#b7c8ff',
    ambientColor: '#f0edff',
    sunColor: '#ffe2fb',
    fogColor: '#cbbcff',
    ground: {
      top: '#7cb57c',
      side: '#5c8d76',
      dirt: '#6a5575',
      stone: '#877fa0',
    },
    structures: {
      metal: '#46415c',
      glass: '#d1a8ff',
      barrier: '#2a2538',
      accent: '#ff9df2',
    },
  },
  {
    id: 'volcanic',
    name: 'Cinder Caldera',
    skyColor: '#7d6a61',
    ambientColor: '#ffd7b5',
    sunColor: '#ffae5f',
    fogColor: '#8f5d4c',
    ground: {
      top: '#5f5c58',
      side: '#423c39',
      dirt: '#3b3633',
      stone: '#28272b',
    },
    structures: {
      metal: '#332e32',
      glass: '#ff914d',
      barrier: '#171316',
      accent: '#ff642e',
    },
  },
  {
    id: 'sakura',
    name: 'Sakura Shrine',
    skyColor: '#f6cddd',
    ambientColor: '#fff2f6',
    sunColor: '#ffe3b4',
    fogColor: '#ffd5e5',
    ground: {
      top: '#79b86b',
      side: '#5f8a56',
      dirt: '#8b6a4e',
      stone: '#827a78',
    },
    structures: {
      metal: '#5b5156',
      glass: '#ffd2e5',
      barrier: '#2d2528',
      accent: '#ff8fbd',
    },
  },
];

export const GOLDEN_VOXEL_MAP_THEME: VoxelMapTheme = {
  id: 'golden',
  name: 'Golden Treasury',
  skyColor: '#ffd978',
  ambientColor: '#fff5cc',
  sunColor: '#fff0a8',
  fogColor: '#f7c85f',
  ground: {
    top: '#e7b93f',
    side: '#b9822f',
    dirt: '#6d5635',
    stone: '#c8943b',
  },
  structures: {
    metal: '#5d4630',
    glass: '#ffeaa3',
    barrier: '#2d2418',
    accent: '#fff36b',
  },
};

export const VOXEL_MAP_THEMES: VoxelMapTheme[] = STANDARD_VOXEL_MAP_THEMES;
export const ALL_VOXEL_MAP_THEMES: VoxelMapTheme[] = [...STANDARD_VOXEL_MAP_THEMES, GOLDEN_VOXEL_MAP_THEME];
export const GOLDEN_VOXEL_MAP_THEME_ID = GOLDEN_VOXEL_MAP_THEME.id;

export function getVoxelMapThemeById(themeId: VoxelMapTheme['id']): VoxelMapTheme {
  return ALL_VOXEL_MAP_THEMES.find((theme) => theme.id === themeId) ?? STANDARD_VOXEL_MAP_THEMES[0];
}

export function getVoxelMapTheme(seed: number, themeId?: VoxelMapTheme['id'] | null): VoxelMapTheme {
  if (themeId) return getVoxelMapThemeById(themeId);
  return VOXEL_MAP_THEMES[hashSeed(seed) % VOXEL_MAP_THEMES.length];
}
