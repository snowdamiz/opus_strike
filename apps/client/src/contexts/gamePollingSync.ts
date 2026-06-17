import type { Room } from 'colyseus.js';
import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  isGameplayMode,
  normalizeVoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import { loggers } from '../utils/logger';
import { prebuildPreparedVoxelMapGeometry } from '../utils/mapWarmup/mapGeometryWarmup';
import { prepareVoxelMapCpu } from '../utils/mapWarmup/mapPrepCache';
import { normalizeGamePhase } from './gamePhase';
import type { GameStoreActions } from './gameMessageHandlers';

export function setupPollingSync(
  room: Room,
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

    if (
      typeof room.state.mapSeed === 'number'
      && (
        room.state.mapSeed !== store.mapSeed
        || nextMapThemeId !== store.mapThemeId
        || nextMapSize !== store.mapSize
      )
    ) {
      store.setMapSeed(room.state.mapSeed);
      store.setMapThemeId(nextMapThemeId);
      store.setMapSize(nextMapSize);
      try {
        const preparedMap = prepareVoxelMapCpu({
          seed: room.state.mapSeed,
          themeId: nextMapThemeId,
          mapSize: nextMapSize,
          source: 'match',
        });
        prebuildPreparedVoxelMapGeometry(preparedMap, { frameBudgetMs: 2, label: 'fallback-poll' });
      } catch (error) {
        loggers.network.warn('fallback poll map CPU prep failed', error);
      }
    }

    if (room.state.phase !== store.gamePhase) {
      actions.setGamePhase(normalizeGamePhase(room.state.phase, store.gamePhase));
    }
    if (isGameplayMode(room.state.gameplayMode) && room.state.gameplayMode !== store.gameplayMode) {
      useGameStore.setState({ gameplayMode: room.state.gameplayMode });
    }
  }, FALLBACK_POLL_INTERVAL_MS);
}
