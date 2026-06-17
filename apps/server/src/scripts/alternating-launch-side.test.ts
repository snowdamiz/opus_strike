import assert from 'node:assert/strict';
import { AlternatingLaunchSideTracker } from '../rooms/alternatingLaunchSide';

const tracker = new AlternatingLaunchSideTracker();

assert.equal(tracker.getPrevious('player-a'), undefined);
assert.equal(tracker.next('player-a'), 1);
assert.equal(tracker.getPrevious('player-a'), 1);
assert.equal(tracker.next('player-a'), -1);
assert.equal(tracker.next('player-a'), 1);

assert.equal(tracker.next('player-b'), 1);
assert.equal(tracker.getPrevious('player-a'), 1);
assert.equal(tracker.getPrevious('player-b'), 1);

assert.equal(tracker.clear('player-a'), true);
assert.equal(tracker.clear('player-a'), false);
assert.equal(tracker.next('player-a'), 1);

console.log('alternating launch side tests passed');
