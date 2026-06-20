import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  getVoxelMapTheme,
  type GamePhase,
  type VoxelMapSizeId,
} from '@voxel-strike/shared';

export const POST_GAME_RESET_DELAY_MS = 10_000;

export interface PostGameResetStatePatch {
  phase: GamePhase;
  mapSeed: number;
  mapThemeId: string;
  mapSize: VoxelMapSizeId;
  redScore: number;
  blueScore: number;
}

export interface PostGameResetPlayer {
  state: string;
  heroId: string;
  isReady: boolean;
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
  ultimateCharge: number;
  abilities: { clear(): void };
}

export function buildPostGameResetStatePatch(mapSeed: number): PostGameResetStatePatch {
  return {
    phase: 'waiting',
    mapSeed,
    mapThemeId: getVoxelMapTheme(mapSeed).id,
    mapSize: DEFAULT_VOXEL_MAP_SIZE_ID,
    redScore: 0,
    blueScore: 0,
  };
}

export function resetPostGamePlayer(player: PostGameResetPlayer): void {
  player.state = 'selecting';
  player.heroId = '';
  player.isReady = false;
  player.kills = 0;
  player.deaths = 0;
  player.assists = 0;
  player.flagCaptures = 0;
  player.flagReturns = 0;
  player.ultimateCharge = 0;
  player.abilities.clear();
}
