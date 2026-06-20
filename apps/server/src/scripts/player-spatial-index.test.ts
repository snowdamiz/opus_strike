import assert from 'node:assert/strict';
import { PlayerSpatialIndex } from '../rooms/PlayerSpatialIndex';
import type { Player } from '../rooms/schema/Player';
import type { Team } from '@voxel-strike/shared';

function makePlayer(id: string, team: Team, x: number, z: number, state: Player['state'] = 'alive'): Player {
  return {
    id,
    team,
    state,
    position: { x, y: 1, z },
  } as unknown as Player;
}

const index = new PlayerSpatialIndex(8);
const players = [
  makePlayer('red-a', 'red', 0, 0),
  makePlayer('red-b', 'red', 7.9, 0),
  makePlayer('blue-a', 'blue', 8.1, 0),
  makePlayer('blue-b', 'blue', 18, 0),
  makePlayer('blue-dead', 'blue', 2, 0, 'dead'),
];

index.rebuild(players);

assert.deepEqual(index.getAlivePlayers().map((player) => player.id), ['red-a', 'red-b', 'blue-a', 'blue-b']);
assert.deepEqual(index.getTeamPlayers('red').map((player) => player.id), ['red-a', 'red-b']);
assert.deepEqual(index.getTeamPlayers('blue').map((player) => player.id), ['blue-a', 'blue-b']);
assert.deepEqual(index.getEnemyPlayers('red').map((player) => player.id), ['blue-a', 'blue-b']);
assert.equal(index.getEnemyPlayers('red'), index.getEnemyPlayers('red'));

const radiusResults: Player[] = [];
index.queryRadius({ x: 0, z: 0 }, 9, radiusResults, { team: 'blue' });
assert.deepEqual(radiusResults.map((player) => player.id), ['blue-a']);

index.queryRadius({ x: 0, z: 0 }, 9, radiusResults, { team: 'red', excludeId: 'red-a' });
assert.deepEqual(radiusResults.map((player) => player.id), ['red-b']);

index.queryConeCandidates({ x: 0, z: 0 }, 20, radiusResults, { team: 'blue' });
assert.deepEqual(radiusResults.map((player) => player.id).sort(), ['blue-a', 'blue-b']);

players.push(makePlayer('br-a', 'br_01', 5, 0));
index.rebuild(players);
index.queryRadius({ x: 0, z: 0 }, 9, radiusResults, { excludeTeam: 'red' });
assert.deepEqual(radiusResults.map((player) => player.id).sort(), ['blue-a', 'br-a']);
assert.deepEqual(index.getEnemyPlayers('red').map((player) => player.id), ['blue-a', 'blue-b', 'br-a']);

players[2].position.x = 40;
index.rebuild(players);
index.queryRadius({ x: 0, z: 0 }, 9, radiusResults, { team: 'blue' });
assert.deepEqual(radiusResults.map((player) => player.id), []);

console.log('player-spatial-index tests passed');
