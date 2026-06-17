import assert from 'node:assert/strict';
import { getVoxelMapTheme } from '@voxel-strike/shared';
import {
  POST_GAME_RESET_DELAY_MS,
  buildPostGameResetStatePatch,
  resetPostGamePlayer,
  type PostGameResetPlayer,
} from '../rooms/postGameResetRuntime';

assert.equal(POST_GAME_RESET_DELAY_MS, 10_000);

{
  assert.deepEqual(buildPostGameResetStatePatch(123), {
    phase: 'waiting',
    mapSeed: 123,
    mapThemeId: getVoxelMapTheme(123).id,
    mapSize: 'medium',
    redScore: 0,
    blueScore: 0,
  });
}

{
  let clearCount = 0;
  const player: PostGameResetPlayer = {
    state: 'alive',
    heroId: 'phantom',
    isReady: true,
    kills: 9,
    deaths: 3,
    assists: 4,
    flagCaptures: 2,
    flagReturns: 1,
    ultimateCharge: 87,
    abilities: {
      clear: () => {
        clearCount++;
      },
    },
  };

  resetPostGamePlayer(player);

  assert.deepEqual(player, {
    state: 'selecting',
    heroId: '',
    isReady: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    flagCaptures: 0,
    flagReturns: 0,
    ultimateCharge: 0,
    abilities: player.abilities,
  });
  assert.equal(clearCount, 1);
}

console.log('post-game reset runtime tests passed');
