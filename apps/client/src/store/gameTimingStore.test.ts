import assert from 'node:assert/strict';
import {
  gameTimingStore,
  resetGameTiming,
  setGameTiming,
} from './gameTimingStore';

resetGameTiming();
assert.deepEqual(gameTimingStore.getState(), { tick: 0, serverTime: 0 });

let notifications = 0;
const unsubscribe = gameTimingStore.subscribe(() => {
  notifications++;
});

setGameTiming(0, 0);
assert.equal(notifications, 0);

setGameTiming(42, 1234);
assert.deepEqual(gameTimingStore.getState(), { tick: 42, serverTime: 1234 });
assert.equal(notifications, 1);

setGameTiming(42, 1234);
assert.equal(notifications, 1);

resetGameTiming();
assert.deepEqual(gameTimingStore.getState(), { tick: 0, serverTime: 0 });
assert.equal(notifications, 2);

unsubscribe();
console.log('game timing store tests passed');
