import * as THREE from 'three';
import type { HeroId } from '@voxel-strike/shared';
import {
  BLAZE_COLORS,
  HOOKSHOT_COLORS,
  PHANTOM_COLORS,
  getHookshotMaterials,
} from './effectResources';

export type ViewmodelHeroId = Extract<HeroId, 'phantom' | 'hookshot' | 'blaze' | 'chronos'>;

export interface ViewmodelMaterialSet {
  armor: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
}

const VIEWMODEL_HEROES = new Set<HeroId>(['phantom', 'hookshot', 'blaze', 'chronos']);
const materialCache = new Map<ViewmodelHeroId, ViewmodelMaterialSet>();

export const HERO_MATERIAL_COLORS: Record<ViewmodelHeroId, {
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
  chronos: {
    armor: 0x123b2d,
    dark: 0x07130f,
    metal: 0x9b7a34,
    accent: 0x22c55e,
    glow: 0xa7f3d0,
    glass: 0xb91c1c,
  },
};

export function isViewmodelHero(heroId: HeroId | '' | null | undefined): heroId is ViewmodelHeroId {
  return Boolean(heroId && VIEWMODEL_HEROES.has(heroId));
}

export function getViewmodelMaterials(heroId: ViewmodelHeroId): ViewmodelMaterialSet {
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
      transparent: true,
      opacity: 1,
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

export function getHeroViewmodelGpuPrewarmMaterials(): THREE.Material[] {
  const materials: THREE.Material[] = [];
  for (const heroId of VIEWMODEL_HEROES) {
    if (!isViewmodelHero(heroId)) continue;
    const materialSet = getViewmodelMaterials(heroId);
    materials.push(
      materialSet.armor,
      materialSet.dark,
      materialSet.metal,
      materialSet.accent,
      materialSet.glow,
      materialSet.glass
    );
  }
  return materials;
}

export function prewarmHeroViewmodelResources(): void {
  getHeroViewmodelGpuPrewarmMaterials();
  getHookshotMaterials();
}
