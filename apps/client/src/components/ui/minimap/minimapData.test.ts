import assert from 'node:assert/strict';
import type { Team, Vec3 } from '@voxel-strike/shared';
import {
  classifyMinimapBlockId,
  createMinimapProjection,
  getBoundaryBounds,
  isWorldPointInsideBoundary,
  minimapToWorld,
  selectVisibleTeammates,
  worldToMinimap,
  type MinimapPlayerLike,
} from './minimapData';

const boundary = [
  { x: -10, z: -20 },
  { x: 10, z: -20 },
  { x: 10, z: 20 },
  { x: -10, z: 20 },
];

const bounds = getBoundaryBounds(boundary);
const projection = createMinimapProjection(bounds, 100, 10);

assert.deepEqual(bounds, {
  minX: -10,
  maxX: 10,
  minZ: -20,
  maxZ: 20,
  width: 20,
  depth: 40,
});

assert.deepEqual(worldToMinimap(projection, { x: -10, z: -20 }), { x: 30, y: 10 });
assert.deepEqual(worldToMinimap(projection, { x: 10, z: 20 }), { x: 70, y: 90 });

const centerWorld = minimapToWorld(projection, { x: 50, y: 50 });
assert.equal(centerWorld.x, 0);
assert.equal(centerWorld.z, 0);

assert.equal(isWorldPointInsideBoundary({ x: 0, z: 0 }, boundary), true);
assert.equal(isWorldPointInsideBoundary({ x: 12, z: 0 }, boundary), false);

assert.equal(classifyMinimapBlockId('spawn_pad_red'), 'spawnRed');
assert.equal(classifyMinimapBlockId('spawn_pad_blue'), 'spawnBlue');
assert.equal(classifyMinimapBlockId('metal'), 'structure');
assert.equal(classifyMinimapBlockId('grass'), 'terrain');

function player(
  id: string,
  team: Team,
  state: MinimapPlayerLike['state'] = 'alive',
  position: Vec3 = { x: 0, y: 0, z: 0 }
): MinimapPlayerLike {
  return {
    id,
    team,
    state,
    position,
    lookYaw: 0,
  };
}

const local = player('local', 'red');
const visible = selectVisibleTeammates(local, [
  local,
  player('teammate-a', 'red'),
  player('enemy', 'blue'),
  player('dead-teammate', 'red', 'dead'),
  player('selecting-teammate', 'red', 'selecting'),
  player('teammate-b', 'red', 'spawning'),
]);

assert.deepEqual(
  visible.map((entry) => entry.id),
  ['teammate-a', 'teammate-b'],
  'minimap should show only living/spawning teammates and never the local player or enemies'
);

const teammateScratch = [player('stale-entry', 'red')];
const reusedVisible = selectVisibleTeammates(local, [
  player('teammate-c', 'red'),
  player('hidden-enemy', 'blue'),
], teammateScratch);
assert.equal(reusedVisible, teammateScratch, 'minimap teammate selection should reuse the provided scratch array');
assert.deepEqual(
  reusedVisible.map((entry) => entry.id),
  ['teammate-c'],
  'minimap teammate selection should clear stale scratch entries before reuse'
);
