import type { VoxelMapTheme, VoxelSkyVariantId } from './types.js';
import { hashSeed } from './rng.js';

type VoxelMapThemeId = VoxelMapTheme['id'];
type VoxelSkyPalette = Pick<VoxelMapTheme, 'skyVariantId' | 'skyColor' | 'ambientColor' | 'sunColor' | 'fogColor'>;

const SKY_PALETTES: Record<VoxelSkyVariantId, VoxelSkyPalette> = {
  clear_day: {
    skyVariantId: 'clear_day',
    skyColor: '#8ec9ff',
    ambientColor: '#f2f8ff',
    sunColor: '#fff1c7',
    fogColor: '#a6d7ff',
  },
  late_day: {
    skyVariantId: 'late_day',
    skyColor: '#e88d6d',
    ambientColor: '#ffe2c4',
    sunColor: '#ffc66f',
    fogColor: '#d79f74',
  },
  stormfront: {
    skyVariantId: 'stormfront',
    skyColor: '#5e7aa6',
    ambientColor: '#dce8ff',
    sunColor: '#b9dcff',
    fogColor: '#6f83a8',
  },
  desert_heat: {
    skyVariantId: 'desert_heat',
    skyColor: '#9fd7ff',
    ambientColor: '#fff4dc',
    sunColor: '#fff0b8',
    fogColor: '#efd39b',
  },
  frost_glow: {
    skyVariantId: 'frost_glow',
    skyColor: '#bfe8ff',
    ambientColor: '#f6fbff',
    sunColor: '#d8f3ff',
    fogColor: '#d7efff',
  },
  crystal_dusk: {
    skyVariantId: 'crystal_dusk',
    skyColor: '#b7c8ff',
    ambientColor: '#f0edff',
    sunColor: '#ffe2fb',
    fogColor: '#cbbcff',
  },
  ember_haze: {
    skyVariantId: 'ember_haze',
    skyColor: '#7d6a61',
    ambientColor: '#ffd7b5',
    sunColor: '#ffae5f',
    fogColor: '#8f5d4c',
  },
  sakura_dawn: {
    skyVariantId: 'sakura_dawn',
    skyColor: '#f6cddd',
    ambientColor: '#fff2f6',
    sunColor: '#ffe3b4',
    fogColor: '#ffd5e5',
  },
  treasury_glow: {
    skyVariantId: 'treasury_glow',
    skyColor: '#ffd978',
    ambientColor: '#fff5cc',
    sunColor: '#fff0a8',
    fogColor: '#f7c85f',
  },
  independence_dusk: {
    skyVariantId: 'independence_dusk',
    skyColor: '#141a4a',
    ambientColor: '#c2ccf5',
    sunColor: '#ffb15e',
    fogColor: '#b5546e',
  },
};

export const STANDARD_VOXEL_MAP_THEMES: VoxelMapTheme[] = [
  {
    id: 'verdant',
    name: 'Verdant Mesa',
    ...SKY_PALETTES.clear_day,
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
    ...SKY_PALETTES.stormfront,
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
    ...SKY_PALETTES.desert_heat,
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
    ...SKY_PALETTES.frost_glow,
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
    ...SKY_PALETTES.crystal_dusk,
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
    ...SKY_PALETTES.ember_haze,
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
    ...SKY_PALETTES.sakura_dawn,
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
  ...SKY_PALETTES.treasury_glow,
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

// Temporary 4th-of-July event biome. Like GOLDEN_VOXEL_MAP_THEME it is deliberately
// excluded from the standard rotation (VOXEL_MAP_THEMES) so it can only appear when an
// operator explicitly opts in — here, via the admin "Event Biome" toggle which forces it
// onto one of the three map-vote options. Heavy red/white/blue with a dusk fireworks sky.
export const INDEPENDENCE_VOXEL_MAP_THEME: VoxelMapTheme = {
  id: 'independence',
  name: 'Independence Day',
  ...SKY_PALETTES.independence_dusk,
  ground: {
    top: '#4f6fb0',
    side: '#3c5590',
    dirt: '#6b5a86',
    stone: '#9aa6c8',
  },
  structures: {
    metal: '#b03a4a',
    glass: '#eef2ff',
    barrier: '#1c2550',
    accent: '#f2f6ff',
  },
};

export const VOXEL_MAP_THEMES: VoxelMapTheme[] = STANDARD_VOXEL_MAP_THEMES;
export const ALL_VOXEL_MAP_THEMES: VoxelMapTheme[] = [
  ...STANDARD_VOXEL_MAP_THEMES,
  GOLDEN_VOXEL_MAP_THEME,
  INDEPENDENCE_VOXEL_MAP_THEME,
];
export const GOLDEN_VOXEL_MAP_THEME_ID = GOLDEN_VOXEL_MAP_THEME.id;
export const INDEPENDENCE_VOXEL_MAP_THEME_ID = INDEPENDENCE_VOXEL_MAP_THEME.id;

const SKY_VARIANTS_BY_THEME = {
  verdant: ['clear_day', 'late_day', 'stormfront', 'desert_heat', 'frost_glow', 'crystal_dusk', 'sakura_dawn'],
  basalt: ['stormfront', 'frost_glow', 'crystal_dusk', 'ember_haze'],
  desert: ['clear_day', 'desert_heat', 'stormfront', 'sakura_dawn', 'ember_haze'],
  frost: ['clear_day', 'stormfront', 'frost_glow', 'crystal_dusk'],
  crystal: ['clear_day', 'stormfront', 'frost_glow', 'crystal_dusk', 'sakura_dawn'],
  volcanic: ['stormfront', 'crystal_dusk', 'ember_haze'],
  sakura: ['clear_day', 'stormfront', 'frost_glow', 'crystal_dusk', 'sakura_dawn'],
  golden: ['clear_day', 'desert_heat', 'sakura_dawn', 'treasury_glow'],
  independence: ['independence_dusk'],
} satisfies Record<VoxelMapThemeId, readonly VoxelSkyVariantId[]>;

const SKY_VARIANT_SALTS = {
  verdant: 0x1a71c9,
  basalt: 0xba5a17,
  desert: 0xde5e27,
  frost: 0xf7057,
  crystal: 0xc2757a1,
  volcanic: 0x701ca11c,
  sakura: 0x5a4a12a,
  golden: 0x906d3a,
  independence: 0x1776_1204,
} satisfies Record<VoxelMapThemeId, number>;

const VOXEL_MAP_THEME_BY_ID = Object.fromEntries(
  ALL_VOXEL_MAP_THEMES.map((theme) => [theme.id, theme])
) as Record<VoxelMapThemeId, VoxelMapTheme>;

function getSkyVariantId(themeId: VoxelMapThemeId, seed: number): VoxelSkyVariantId {
  const variants = SKY_VARIANTS_BY_THEME[themeId];
  return variants[hashSeed(seed ^ SKY_VARIANT_SALTS[themeId]) % variants.length];
}

function withSeededSky(theme: VoxelMapTheme, seed: number): VoxelMapTheme {
  return {
    ...theme,
    ...SKY_PALETTES[getSkyVariantId(theme.id, seed)],
  };
}

export function withVoxelSkyVariant(theme: VoxelMapTheme, skyVariantId: VoxelSkyVariantId): VoxelMapTheme {
  return {
    ...theme,
    ...SKY_PALETTES[skyVariantId],
  };
}

export function getVoxelMapThemeById(themeId: VoxelMapThemeId, seed = 0): VoxelMapTheme {
  return withSeededSky(VOXEL_MAP_THEME_BY_ID[themeId], seed);
}

export function getVoxelMapTheme(seed: number, themeId?: VoxelMapThemeId | null): VoxelMapTheme {
  if (themeId) return getVoxelMapThemeById(themeId, seed);
  return withSeededSky(VOXEL_MAP_THEMES[hashSeed(seed) % VOXEL_MAP_THEMES.length], seed);
}
