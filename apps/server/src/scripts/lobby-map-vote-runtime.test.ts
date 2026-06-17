import assert from 'node:assert/strict';
import {
  DEFAULT_VOXEL_MAP_SIZE_ID,
  GOLDEN_VOXEL_MAP_THEME_ID,
  VOXEL_MAP_SIZE_IDS,
} from '@voxel-strike/shared';
import {
  buildMapVoteStartedPayload,
  buildMapVoteUpdatedPayload,
  createMapVoteOption,
  createMapVoteOptions,
  getMapVoteRecords,
  getWinningMapOption,
  type MapVoteOption,
} from '../rooms/lobbyMapVoteRuntime';

function option(id: string): MapVoteOption {
  return {
    ...createMapVoteOption(1000 + Number(id.replace('map_', '')), Number(id.replace('map_', '')) - 1),
    id,
  };
}

{
  const options = createMapVoteOptions({
    customMapSeed: -1,
    forceGoldenMapOption: true,
    source: 123,
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].id, 'map_1');
  assert.equal(options[0].seed, 0xffffffff);
  assert.equal(options[0].mapThemeId, GOLDEN_VOXEL_MAP_THEME_ID);
  assert.equal(options[0].mapSize, DEFAULT_VOXEL_MAP_SIZE_ID);
}

{
  const options = createMapVoteOptions({
    customMapSeed: null,
    forceGoldenMapOption: true,
    source: 0x12345678,
  });

  assert.equal(options.length, VOXEL_MAP_SIZE_IDS.length);
  assert.deepEqual(options.map((mapOption) => mapOption.id), VOXEL_MAP_SIZE_IDS.map((_, index) => `map_${index + 1}`));
  assert.deepEqual(options.map((mapOption) => mapOption.mapSize), VOXEL_MAP_SIZE_IDS);
  assert.equal(options.filter((mapOption) => mapOption.mapThemeId === GOLDEN_VOXEL_MAP_THEME_ID).length, 1);
}

{
  const votes = new Map<string, string>([
    ['player-a', 'map_2'],
    ['player-b', 'map_1'],
  ]);

  assert.deepEqual(getMapVoteRecords(votes), [
    { playerId: 'player-a', optionId: 'map_2' },
    { playerId: 'player-b', optionId: 'map_1' },
  ]);
}

{
  const options = [option('map_1'), option('map_2'), option('map_3')];
  const votes = new Map<string, string>([
    ['host', 'map_2'],
    ['player-a', 'map_1'],
  ]);

  assert.equal(getWinningMapOption({ options, votes, hostId: 'host' }).id, 'map_2');
}

{
  const options = [option('map_1'), option('map_2'), option('map_3')];
  const votes = new Map<string, string>([
    ['host', 'map_2'],
    ['player-a', 'map_3'],
    ['player-b', 'map_3'],
  ]);

  assert.equal(getWinningMapOption({ options, votes, hostId: 'host' }).id, 'map_3');
}

{
  assert.throws(
    () => getWinningMapOption({ options: [], votes: [], hostId: 'host' }),
    /Cannot choose map without map options/
  );
}

{
  const options = [option('map_1'), option('map_2')];
  const votes = new Map<string, string>([['player-a', 'map_2']]);
  const started = buildMapVoteStartedPayload({
    options,
    votes,
    phaseEndTime: 12345,
  });
  const updated = buildMapVoteUpdatedPayload(votes);

  assert.deepEqual(started, {
    options,
    votes: [{ playerId: 'player-a', optionId: 'map_2' }],
    phaseEndTime: 12345,
  });
  assert.deepEqual(updated, {
    votes: [{ playerId: 'player-a', optionId: 'map_2' }],
  });
}

console.log('lobby map vote runtime tests passed');
