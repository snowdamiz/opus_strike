import {
  CONSTRUCTED_MAP_MANIFEST_VERSION,
  DEFAULT_VOXEL_MAP_SIZE_ID,
  TUTORIAL_MAP_SEED,
  isTutorialMapSeed,
  normalizeVoxelMapSizeId,
  type MapProfileId,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';

export interface MapPrepCacheKeyInput {
  seed: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | string | null;
  mapProfileId?: MapProfileId | string | null;
  generatorVersion?: number;
}

export function getMapPrepCacheKey({
  seed,
  themeId,
  mapSize,
  mapProfileId,
  generatorVersion = CONSTRUCTED_MAP_MANIFEST_VERSION,
}: MapPrepCacheKeyInput): string {
  if (isTutorialMapSeed(seed)) {
    return `tutorial-v${generatorVersion}:${TUTORIAL_MAP_SEED}`;
  }

  const themeSuffix = themeId ? `:${themeId}` : '';
  const profileSuffix = mapProfileId ? `:${mapProfileId}` : '';
  const normalizedMapSize = normalizeVoxelMapSizeId(mapSize);
  const sizeSuffix = normalizedMapSize === DEFAULT_VOXEL_MAP_SIZE_ID ? '' : `:${normalizedMapSize}`;
  return `procedural-v${generatorVersion}:${seed >>> 0}${themeSuffix}${profileSuffix}${sizeSuffix}`;
}
