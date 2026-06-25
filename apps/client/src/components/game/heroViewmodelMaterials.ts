import * as THREE from 'three';
import {
  HERO_SKIN_CATALOG,
  getDefaultHeroSkinId,
  type HeroId,
  type HeroSkinId,
  type ViewmodelModelDocument,
} from '@voxel-strike/shared';
import { getHookshotMaterials } from './effectResources';
import {
  VIEWMODEL_MATERIAL_TOKENS,
  VIEWMODEL_MODEL_DOCUMENTS,
  type ViewmodelMaterialToken,
} from '../../viewmodel/viewmodelManifests';
import { resolveHeroSkinModel } from '../../model-system/heroSkinModelResolver';

export type ViewmodelHeroId = keyof typeof VIEWMODEL_MODEL_DOCUMENTS & HeroId;

export interface ViewmodelMaterialSet {
  armor: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  glass: THREE.MeshStandardMaterial;
}

const VIEWMODEL_HEROES = new Set<HeroId>(Object.keys(VIEWMODEL_MODEL_DOCUMENTS) as HeroId[]);
const materialCache = new Map<string, ViewmodelMaterialSet>();

type ViewmodelMaterialColorNumbers = Record<ViewmodelMaterialToken, number>;

function getMaterialDescriptor(heroId: ViewmodelHeroId, token: ViewmodelMaterialToken) {
  const descriptor = VIEWMODEL_MODEL_DOCUMENTS[heroId].materials.find((material) => material.token === token);
  if (!descriptor) {
    throw new Error(`Viewmodel material "${token}" is missing for ${heroId}`);
  }
  return descriptor;
}

function getSkinMaterialDescriptor(viewmodel: ViewmodelModelDocument, token: ViewmodelMaterialToken) {
  const descriptor = viewmodel.materials.find((material) => material.token === token);
  if (!descriptor) {
    throw new Error(`Viewmodel material "${token}" is missing`);
  }
  return descriptor;
}

function getMaterialColorNumber(heroId: ViewmodelHeroId, token: ViewmodelMaterialToken): number {
  return new THREE.Color(getMaterialDescriptor(heroId, token).color).getHex();
}

export const HERO_MATERIAL_COLORS: Record<ViewmodelHeroId, ViewmodelMaterialColorNumbers> = (
  Object.keys(VIEWMODEL_MODEL_DOCUMENTS) as ViewmodelHeroId[]
).reduce((colorsByHero, heroId) => {
  colorsByHero[heroId] = VIEWMODEL_MATERIAL_TOKENS.reduce((colors, token) => {
    colors[token] = getMaterialColorNumber(heroId, token);
    return colors;
  }, {} as ViewmodelMaterialColorNumbers);
  return colorsByHero;
}, {} as Record<ViewmodelHeroId, ViewmodelMaterialColorNumbers>);

export function isViewmodelHero(heroId: HeroId | '' | null | undefined): heroId is ViewmodelHeroId {
  return Boolean(heroId && VIEWMODEL_HEROES.has(heroId));
}

export function getViewmodelMaterials(heroId: ViewmodelHeroId): ViewmodelMaterialSet {
  return getViewmodelMaterialsForSkin(heroId, getDefaultHeroSkinId(heroId));
}

export function getViewmodelMaterialsForSkin(
  heroId: ViewmodelHeroId,
  requestedSkinId?: HeroSkinId | string | null
): ViewmodelMaterialSet {
  const resolved = resolveHeroSkinModel(heroId, requestedSkinId);
  const skinId = resolved.skinId;
  const cached = materialCache.get(skinId);
  if (cached) return cached;

  const viewmodel = resolved.document.viewmodel ?? VIEWMODEL_MODEL_DOCUMENTS[heroId];
  const descriptor = (token: ViewmodelMaterialToken) => getSkinMaterialDescriptor(viewmodel, token);
  const colors = VIEWMODEL_MATERIAL_TOKENS.reduce((colorMap, token) => {
    colorMap[token] = new THREE.Color(descriptor(token).color).getHex();
    return colorMap;
  }, {} as ViewmodelMaterialColorNumbers);
  const materials: ViewmodelMaterialSet = {
    armor: new THREE.MeshStandardMaterial({
      color: colors.armor,
      metalness: descriptor('armor').metalness ?? 0.3,
      roughness: descriptor('armor').roughness ?? 0.42,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: colors.dark,
      metalness: descriptor('dark').metalness ?? 0.24,
      roughness: descriptor('dark').roughness ?? 0.6,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: colors.metal,
      metalness: descriptor('metal').metalness ?? 0.76,
      roughness: descriptor('metal').roughness ?? 0.25,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: colors.accent,
      emissive: colors.accent,
      emissiveIntensity: descriptor('accent').emissiveIntensity ?? 0.34,
      metalness: descriptor('accent').metalness ?? 0.2,
      roughness: descriptor('accent').roughness ?? 0.32,
    }),
    glow: new THREE.MeshBasicMaterial({
      color: colors.glow,
      transparent: descriptor('glow').transparent ?? true,
      opacity: descriptor('glow').opacity ?? 1,
      toneMapped: descriptor('glow').toneMapped ?? false,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: colors.glass,
      emissive: colors.glass,
      emissiveIntensity: descriptor('glass').emissiveIntensity ?? 0.26,
      metalness: descriptor('glass').metalness ?? 0.1,
      roughness: descriptor('glass').roughness ?? 0.18,
    }),
  };

  materialCache.set(skinId, materials);
  return materials;
}

export function getHeroViewmodelGpuPrewarmMaterials(): THREE.Material[] {
  const materials: THREE.Material[] = [];
  for (const skin of HERO_SKIN_CATALOG) {
    const heroId = skin.heroId;
    if (!isViewmodelHero(heroId)) continue;
    const materialSet = getViewmodelMaterialsForSkin(heroId, skin.id);
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
