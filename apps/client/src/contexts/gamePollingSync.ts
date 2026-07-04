import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  isGameplayMode,
  normalizeVoxelMapSizeId,
  type MapProfileId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import { loggers } from '../utils/logger';
import { seedMapPrepCacheFromManifest } from '../utils/mapWarmup/mapPrepCache';
import { prebuildPreparedMapGeometryDeferred } from '../utils/mapWarmup/deferredMapGeometryWarmup';
import { requestMatchMapManifest } from '../utils/mapWarmup/mapManifestLoader';
import { normalizeGamePhase } from './gamePhase';
import type { GameStoreActions } from './gameMessageHandlers';
import type { GameMessageBus } from './gameMessageBus';

type PollableGameMessageBus = GameMessageBus & {
  state?: {
    phase?: unknown;
    mapSeed?: unknown;
    mapThemeId?: unknown;
    mapSize?: unknown;
    mapProfileId?: unknown;
    pregeneratedMapId?: unknown;
    mapArtifactId?: unknown;
    gameplayMode?: unknown;
  };
};

export function setupPollingSync(
  room: PollableGameMessageBus,
  actions: Pick<GameStoreActions, 'setGamePhase'>
): ReturnType<typeof setInterval> {
  const FALLBACK_POLL_INTERVAL_MS = 250;

  return setInterval(() => {
    if (!room.state?.phase) return;

    const store = useGameStore.getState();
    const nextMapThemeId = typeof room.state.mapThemeId === 'string'
      ? room.state.mapThemeId as VoxelMapTheme['id']
      : null;
    const nextMapSize = normalizeVoxelMapSizeId(
      typeof room.state.mapSize === 'string' ? room.state.mapSize : DEFAULT_VOXEL_MAP_SIZE_ID
    );
    const nextMapProfileId = typeof room.state.mapProfileId === 'string'
      ? room.state.mapProfileId as MapProfileId
      : null;
    const nextPregeneratedMapId = typeof room.state.pregeneratedMapId === 'string' && room.state.pregeneratedMapId
      ? room.state.pregeneratedMapId
      : null;
    const nextMapArtifactId = typeof room.state.mapArtifactId === 'string' && room.state.mapArtifactId
      ? room.state.mapArtifactId
      : null;

    if (
      typeof room.state.mapSeed === 'number'
      && (
        room.state.mapSeed !== store.mapSeed
        || nextMapThemeId !== store.mapThemeId
        || nextMapSize !== store.mapSize
        || nextMapProfileId !== store.mapProfileId
        || nextPregeneratedMapId !== store.pregeneratedMapId
        || nextMapArtifactId !== store.mapArtifactId
      )
    ) {
      const mapSeed = room.state.mapSeed;
      store.setMapSeed(mapSeed);
      store.setMapThemeId(nextMapThemeId);
      store.setMapSize(nextMapSize);
      store.setMapProfileId(nextMapProfileId);
      store.setPregeneratedMapIdentity(nextPregeneratedMapId, nextMapArtifactId);
      void requestMatchMapManifest({
        seed: mapSeed,
        themeId: nextMapThemeId,
        mapSize: nextMapSize,
        mapProfileId: nextMapProfileId,
        pregeneratedMapId: nextPregeneratedMapId,
      })
        .then(({ manifest }) => {
          const preparedMap = seedMapPrepCacheFromManifest(mapSeed, manifest, 'match', nextPregeneratedMapId);
          prebuildPreparedMapGeometryDeferred(preparedMap, { frameBudgetMs: 2, label: 'fallback-poll' });
        })
        .catch((error) => {
          loggers.network.warn('fallback poll map worker prep failed', error);
        });
    }

    if (room.state.phase !== store.gamePhase) {
      actions.setGamePhase(normalizeGamePhase(String(room.state.phase), store.gamePhase));
    }
    if (isGameplayMode(room.state.gameplayMode) && room.state.gameplayMode !== store.gameplayMode) {
      useGameStore.setState({ gameplayMode: room.state.gameplayMode });
    }
  }, FALLBACK_POLL_INTERVAL_MS);
}
