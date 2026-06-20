import assert from 'node:assert/strict';
import { AttackCooldownTracker } from '../rooms/attackCooldownTracker';

const playerId = 'player-a';

{
  const tracker = new AttackCooldownTracker();

  tracker.setFromDuration(playerId, 'primary', 1_000, 500);

  assert.equal(tracker.getUntil(playerId, 'primary'), 1_500);
  assert.equal(tracker.isCoolingDown(playerId, 'primary', 1_499), true);
  assert.equal(tracker.isCoolingDown(playerId, 'primary', 1_500), false);
  assert.equal(tracker.isCoolingDown(playerId, 'secondary', 1_100), false);
}

{
  const tracker = new AttackCooldownTracker();

  tracker.setUntil(playerId, 'primary', 2_000);
  tracker.setUntil(playerId, 'secondary', 3_000);

  assert.equal(tracker.clear(playerId, 'primary'), true);
  assert.equal(tracker.getUntil(playerId, 'primary'), undefined);
  assert.equal(tracker.getUntil(playerId, 'secondary'), 3_000);
  assert.equal(tracker.clear(playerId, 'primary'), false);

  tracker.clearPlayer(playerId);
  assert.equal(tracker.getUntil(playerId, 'secondary'), undefined);
}

{
  const tracker = new AttackCooldownTracker();

  tracker.setUntil(playerId, 'primary', 2_000);
  tracker.adjust(playerId, 'primary', 250, 1_000);
  assert.equal(tracker.getUntil(playerId, 'primary'), 1_750);

  tracker.adjust(playerId, 'primary', -500, 1_000);
  assert.equal(tracker.getUntil(playerId, 'primary'), 2_250);
}

{
  const tracker = new AttackCooldownTracker();

  tracker.setUntil(playerId, 'primary', 2_000);
  tracker.adjust(playerId, 'primary', 1_100, 1_000);
  assert.equal(tracker.getUntil(playerId, 'primary'), undefined);
}

{
  const tracker = new AttackCooldownTracker();

  tracker.setUntil(playerId, 'primary', 900);
  tracker.adjust(playerId, 'primary', 250, 1_000);
  assert.equal(tracker.getUntil(playerId, 'primary'), 900);
  assert.equal(tracker.isCoolingDown(playerId, 'primary', 1_000), false);
}

console.log('attack cooldown tracker tests passed');
