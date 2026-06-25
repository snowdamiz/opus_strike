import assert from 'node:assert/strict';
import type { Team } from '@voxel-strike/shared';
import { PlayerSpatialIndex } from '../rooms/PlayerSpatialIndex';
import { PlayerSpatialQueries } from '../rooms/playerSpatialQueries';
import type { Player } from '../rooms/schema/Player';

function makePlayer(id: string, team: Team, x: number, z: number, state: Player['state'] = 'alive'): Player {
  return {
    id,
    team,
    state,
    position: { x, y: 1, z },
  } as unknown as Player;
}

const index = new PlayerSpatialIndex(8);
const queries = new PlayerSpatialQueries(index);
const players = [
  makePlayer('red-a', 'red', 0, 0),
  makePlayer('red-b', 'red', 4, 0),
  makePlayer('blue-a', 'blue', 6, 0),
  makePlayer('blue-b', 'blue', 18, 0),
  makePlayer('blue-downed', 'blue', 3, 0, 'downed'),
  makePlayer('blue-dead', 'blue', 2, 0, 'dead'),
];

index.rebuild(players);

const firstRadiusResults = queries.queryRadius({ x: 0, z: 0 }, 8, { team: 'blue' });
assert.deepEqual(firstRadiusResults.map((player) => player.id), ['blue-a']);

const downedRadiusResults = queries.queryRadius({ x: 0, z: 0 }, 8, { team: 'blue', includeDowned: true });
assert.equal(downedRadiusResults, firstRadiusResults);
assert.deepEqual(downedRadiusResults.map((player) => player.id).sort(), ['blue-a', 'blue-downed']);

const secondRadiusResults = queries.queryRadius({ x: 0, z: 0 }, 8, { team: 'red', excludeId: 'red-a' });
assert.equal(secondRadiusResults, firstRadiusResults);
assert.deepEqual(secondRadiusResults.map((player) => player.id), ['red-b']);

const coneCandidates = queries.queryConeCandidates({ x: 0, z: 0 }, 20, { team: 'blue' });
assert.equal(coneCandidates, firstRadiusResults);
assert.deepEqual(coneCandidates.map((player) => player.id).sort(), ['blue-a', 'blue-b']);

players.push(makePlayer('br-a', 'br_01', 5, 0));
index.rebuild(players);
assert.deepEqual(
  queries.queryRadius({ x: 0, z: 0 }, 8, { excludeTeam: 'red' }).map((player) => player.id).sort(),
  ['blue-a', 'br-a']
);

players[2].position.x = 40;
index.rebuild(players);
assert.deepEqual(queries.queryRadius({ x: 0, z: 0 }, 8, { team: 'blue' }), []);

const lazyPlayers = [
  makePlayer('lazy-red', 'red', 0, 0),
  makePlayer('lazy-blue', 'blue', 40, 0),
];
const lazyIndex = new PlayerSpatialIndex(8);
let lazyIndexDirty = true;
const lazyQueries = new PlayerSpatialQueries(lazyIndex, () => {
  if (!lazyIndexDirty) return;
  lazyIndex.rebuild(lazyPlayers);
  lazyIndexDirty = false;
});

assert.deepEqual(
  lazyQueries.queryRadius({ x: 0, z: 0 }, 8, { team: 'blue' }).map((player) => player.id),
  []
);

lazyPlayers[1].position.x = 4;
lazyIndexDirty = true;
assert.deepEqual(
  lazyQueries.queryRadius({ x: 0, z: 0 }, 8, { team: 'blue' }).map((player) => player.id),
  ['lazy-blue']
);

console.log('player spatial queries tests passed');
