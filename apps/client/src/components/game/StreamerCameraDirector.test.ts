import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  selectStreamerCameraLookLeadDirection,
  selectStreamerCameraShot,
  type StreamerCameraSelectablePlayer,
} from './StreamerCameraDirector';

const players: StreamerCameraSelectablePlayer[] = [
  {
    id: 'bot-a',
    role: 'player',
    state: 'alive',
    isBot: true,
    health: 100,
    maxHealth: 100,
    position: { x: 0, y: 1, z: 0 },
  },
  {
    id: 'human-a',
    role: 'player',
    state: 'alive',
    isBot: false,
    health: 40,
    maxHealth: 100,
    position: { x: 4, y: 1, z: 0 },
  },
  {
    id: 'observer-a',
    role: 'observer',
    state: 'spectating',
    isBot: false,
    position: { x: 8, y: 1, z: 0 },
  },
  {
    id: 'dead-a',
    role: 'player',
    state: 'dead',
    isBot: false,
    position: { x: 12, y: 1, z: 0 },
  },
];

const firstShot = selectStreamerCameraShot({
  players,
  shotIndex: 0,
});

assert.equal(firstShot.targetId, 'human-a');
assert.ok(['first_person', 'close_chase', 'chase', 'side_track', 'orbit', 'crane', 'aerial'].includes(firstShot.shotKind));

const secondShot = selectStreamerCameraShot({
  players,
  previousTargetId: 'human-a',
  shotIndex: 0,
});

assert.equal(secondShot.targetId, 'bot-a');

const emptyShot = selectStreamerCameraShot({
  players: players.filter((player) => player.role === 'observer' || player.state === 'dead'),
  shotIndex: 0,
});

assert.deepEqual(emptyShot, {
  targetId: null,
  shotKind: 'aerial',
});

const fixedAerialPatrolShot = selectStreamerCameraShot({
  players,
  shotIndex: 0,
  cameraMode: 'fixed_aerial',
});

assert.deepEqual(fixedAerialPatrolShot, {
  targetId: null,
  shotKind: 'aerial',
});

const fixedAerialChaseShot = selectStreamerCameraShot({
  players,
  shotIndex: 1,
  cameraMode: 'fixed_aerial',
});

assert.equal(fixedAerialChaseShot.targetId, 'human-a');
assert.equal(fixedAerialChaseShot.shotKind, 'close_chase');

const fixedAerialNoFirstPersonShot = selectStreamerCameraShot({
  players,
  shotIndex: 4,
  cameraMode: 'fixed_aerial',
});

assert.equal(fixedAerialNoFirstPersonShot.shotKind, 'crane');
assert.notEqual(fixedAerialNoFirstPersonShot.shotKind, 'first_person');
assert.notEqual(fixedAerialNoFirstPersonShot.shotKind, 'orbit');

const viewForward = new THREE.Vector3(1, 0, 0);
const followForward = new THREE.Vector3(0, 0, -1);

assert.equal(
  selectStreamerCameraLookLeadDirection('first_person', viewForward, followForward),
  viewForward
);
assert.equal(
  selectStreamerCameraLookLeadDirection('chase', viewForward, followForward),
  followForward
);
assert.equal(
  selectStreamerCameraLookLeadDirection('close_chase', viewForward, followForward),
  followForward
);
assert.equal(
  selectStreamerCameraLookLeadDirection('side_track', viewForward, followForward),
  followForward
);
assert.equal(
  selectStreamerCameraLookLeadDirection('crane', viewForward, followForward),
  followForward
);

console.log('streamer camera director tests passed');
