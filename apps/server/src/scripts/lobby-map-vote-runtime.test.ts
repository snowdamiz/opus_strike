import assert from 'node:assert/strict';
import {
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
    source: 123,
  });

  assert.equal(options.length, VOXEL_MAP_SIZE_IDS.length);
  assert.deepEqual(options.map((mapOption) => mapOption.id), VOXEL_MAP_SIZE_IDS.map((_, index) => `map_${index + 1}`));
  assert.deepEqual(options.map((mapOption) => mapOption.mapSize), VOXEL_MAP_SIZE_IDS);
  assert.equal(options.every((mapOption) => mapOption.mapThemeId === null), true);
}

{
  const options = createMapVoteOptions({
    gameplayMode: 'battle_royal',
    source: 0x51f15eed,
  });

  assert.equal(options.length, 2);
  assert.deepEqual(options.map((mapOption) => mapOption.mapSize), ['large', 'large']);
  assert.equal(options.every((mapOption) => mapOption.mapProfileId === 'battle_royal_large'), true);
  assert.equal(options.every((mapOption) => mapOption.preview.labelTags.includes('Battle Royal')), true);
  assert.equal(Object.keys(options[0].preview.thumbnailSilhouette.objectives.spawns).length, 10);
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
