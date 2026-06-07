import type { VoxelMapTheme } from './types.js';
import { hashSeed } from './rng.js';

export const VOXEL_MAP_THEMES: VoxelMapTheme[] = [
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
];

export function getVoxelMapTheme(seed: number): VoxelMapTheme {
  return VOXEL_MAP_THEMES[hashSeed(seed) % VOXEL_MAP_THEMES.length];
}
