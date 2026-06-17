import assert from 'node:assert/strict';
import { PhantomVoidRayChargeTracker } from '../rooms/phantomVoidRayCharge';

const playerId = 'phantom-player';

{
  const tracker = new PhantomVoidRayChargeTracker();

  tracker.start(playerId, 1_000);
  assert.equal(tracker.isCharging(playerId), true);
  assert.equal(tracker.getStartedAt(playerId), 1_000);
  assert.equal(tracker.isResolvedForPress(playerId), false);
}

{
  const tracker = new PhantomVoidRayChargeTracker();

  tracker.start(playerId, 1_000);
  tracker.markResolvedForPress(playerId);
  assert.equal(tracker.isCharging(playerId), true);
  assert.equal(tracker.isResolvedForPress(playerId), true);

  tracker.start(playerId, 2_000);
  assert.equal(tracker.getStartedAt(playerId), 2_000);
  assert.equal(tracker.isResolvedForPress(playerId), false);
}

{
  const tracker = new PhantomVoidRayChargeTracker();

  tracker.start(playerId, 3_000);
  tracker.markResolvedForPress(playerId);

  assert.equal(tracker.clear(playerId), true);
  assert.equal(tracker.isCharging(playerId), false);
  assert.equal(tracker.getStartedAt(playerId), undefined);
  assert.equal(tracker.isResolvedForPress(playerId), false);
  assert.equal(tracker.clear(playerId), false);
}

console.log('phantom void ray charge tests passed');
