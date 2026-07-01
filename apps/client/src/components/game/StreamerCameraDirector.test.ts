import assert from 'node:assert/strict';
import {
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
assert.ok(['first_person', 'chase', 'orbit', 'aerial'].includes(firstShot.shotKind));

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

console.log('streamer camera director tests passed');
