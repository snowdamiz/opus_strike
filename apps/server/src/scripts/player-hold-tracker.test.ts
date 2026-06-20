import assert from 'node:assert/strict';
import { PlayerHoldTracker } from '../rooms/playerHoldTracker';

const playerId = 'player-a';

{
  const tracker = new PlayerHoldTracker();

  tracker.update(playerId, true, false, 1_000);
  assert.equal(tracker.getStartedAt(playerId), 1_000);
  assert.equal(tracker.isReady(playerId, 1_099, 100), false);
  assert.equal(tracker.isReady(playerId, 1_100, 100), true);

  tracker.update(playerId, true, true, 1_500);
  assert.equal(tracker.getStartedAt(playerId), 1_000);
}

{
  const tracker = new PlayerHoldTracker();

  tracker.update(playerId, true, true, 2_000);
  assert.equal(tracker.getStartedAt(playerId), 2_000);
}

{
  const tracker = new PlayerHoldTracker();

  tracker.update(playerId, true, false, 3_000);
  tracker.update(playerId, false, true, 3_100);
  assert.equal(tracker.getStartedAt(playerId), undefined);
  assert.equal(tracker.isReady(playerId, 4_000, 100), false);
  assert.equal(tracker.clear(playerId), false);
}

{
  const tracker = new PlayerHoldTracker();

  tracker.update(playerId, true, false, 4_000);
  assert.equal(tracker.clear(playerId), true);
  assert.equal(tracker.getStartedAt(playerId), undefined);
}

console.log('player hold tracker tests passed');
