import assert from 'node:assert/strict';
import {
  PlayerPressStateTracker,
  createEmptyPlayerPressState,
} from '../rooms/playerPressState';

const playerId = 'same-session-id';

assert.deepEqual(createEmptyPlayerPressState(), {
  primaryFire: false,
  secondaryFire: false,
  reload: false,
  ability1: false,
  ability2: false,
  ultimate: false,
});

{
  const tracker = new PlayerPressStateTracker();
  const state = tracker.getOrCreate(playerId);
  assert.equal(state.primaryFire, false);

  const updated = tracker.applyInput(playerId, {
    primaryFire: true,
    secondaryFire: true,
    reload: true,
    ability1: true,
    ability2: false,
    ultimate: true,
  });

  assert.equal(updated, state);
  assert.deepEqual(tracker.get(playerId), {
    primaryFire: true,
    secondaryFire: true,
    reload: true,
    ability1: true,
    ability2: false,
    ultimate: true,
  });

  tracker.reset(playerId);
  assert.deepEqual(tracker.get(playerId), createEmptyPlayerPressState());

  assert.equal(tracker.clear(playerId), true);
  assert.equal(tracker.get(playerId), undefined);
  assert.equal(tracker.clear(playerId), false);
}

{
  const roomA = new PlayerPressStateTracker();
  const roomB = new PlayerPressStateTracker();

  roomA.applyInput(playerId, {
    primaryFire: true,
    secondaryFire: false,
    reload: false,
    ability1: false,
    ability2: false,
    ultimate: false,
  });

  assert.equal(roomA.get(playerId)?.primaryFire, true);
  assert.equal(roomB.getOrCreate(playerId).primaryFire, false);
}

console.log('player press state tests passed');
