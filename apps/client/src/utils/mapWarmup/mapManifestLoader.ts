import { normalizeVoxelMapSizeId, type MapProfileId, type VoxelMapManifest, type VoxelMapSizeId, type VoxelMapTheme } from '@voxel-strike/shared';
import { requestPregeneratedMapManifest } from '../../contexts/networkApi';
import { requestMapPreviewManifest } from '../mapPreview/mapPreviewManifestClient';
import { loggers } from '../logger';

export interface MatchMapManifestRequest {
  seed: number;
  themeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | string | null;
  mapProfileId?: MapProfileId | string | null;
  pregeneratedMapId?: string | null;
}

export interface MatchMapManifestResult {
  manifest: VoxelMapManifest;
  loadedFromCatalog: boolean;
}

export async function requestMatchMapManifest(input: MatchMapManifestRequest): Promise<MatchMapManifestResult> {
  if (input.pregeneratedMapId) {
    try {
      const { manifest } = await requestPregeneratedMapManifest(input.pregeneratedMapId);
      return { manifest, loadedFromCatalog: true };
    } catch (error) {
      loggers.network.warn('pregenerated map artifact load failed; falling back to seed generation', {
        mapId: input.pregeneratedMapId,
        seed: input.seed,
        error,
      });
    }
  }

  const manifest = await requestMapPreviewManifest({
    seed: input.seed,
    themeId: input.themeId ?? null,
    mapSize: normalizeVoxelMapSizeId(input.mapSize),
    mapProfileId: input.mapProfileId,
  });
  return { manifest, loadedFromCatalog: false };
}
