import assert from 'node:assert/strict';
import {
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_PRIMARY_RELOAD_MS,
} from '@voxel-strike/shared';
import { PhantomPrimaryMagazineTracker } from '../rooms/phantomPrimaryMagazine';

const playerId = 'phantom-player';

{
  const tracker = new PhantomPrimaryMagazineTracker();
  const now = 1_000;

  assert.deepEqual(tracker.getClientState(playerId, now), {
    ammo: PHANTOM_PRIMARY_MAGAZINE_SIZE,
    reloading: false,
    reloadStartedAt: 0,
    reloadUntil: 0,
    serverTime: now,
  });

  for (let shot = 1; shot < PHANTOM_PRIMARY_MAGAZINE_SIZE; shot++) {
    const result = tracker.consumeShot(playerId, now + shot);
    assert.equal(result.consumed, true);
    assert.equal(result.startedReload, false);
    assert.equal(result.magazine.ammo, PHANTOM_PRIMARY_MAGAZINE_SIZE - shot);
  }

  const finalShotAt = now + PHANTOM_PRIMARY_MAGAZINE_SIZE;
  const finalShot = tracker.consumeShot(playerId, finalShotAt);
  assert.equal(finalShot.consumed, true);
  assert.equal(finalShot.startedReload, true);
  assert.equal(finalShot.magazine.ammo, 0);
  assert.equal(finalShot.magazine.reloadStartedAt, finalShotAt);
  assert.equal(finalShot.magazine.reloadUntil, finalShotAt + PHANTOM_PRIMARY_RELOAD_MS);

  const blocked = tracker.consumeShot(playerId, finalShotAt + 1);
  assert.equal(blocked.consumed, false);
  assert.equal(blocked.blockedByReload, true);

  const earlyCompletion = tracker.completeReloadIfReady(
    playerId,
    finalShotAt + PHANTOM_PRIMARY_RELOAD_MS - 1
  );
  assert.equal(earlyCompletion.completed, false);

  const completed = tracker.completeReloadIfReady(playerId, finalShotAt + PHANTOM_PRIMARY_RELOAD_MS);
  assert.equal(completed.completed, true);
  assert.equal(completed.magazine.ammo, PHANTOM_PRIMARY_MAGAZINE_SIZE);
  assert.equal(completed.magazine.reloadStartedAt, 0);
  assert.equal(completed.magazine.reloadUntil, 0);
}

{
  const tracker = new PhantomPrimaryMagazineTracker();
  const now = 5_000;

  assert.equal(tracker.reload(playerId, now).alreadyFull, true);

  tracker.consumeShot(playerId, now + 1);
  const reload = tracker.reload(playerId, now + 2);
  assert.equal(reload.started, true);
  assert.equal(reload.magazine.reloadStartedAt, now + 2);
  assert.equal(reload.magazine.reloadUntil, now + 2 + PHANTOM_PRIMARY_RELOAD_MS);

  const duplicateReload = tracker.reload(playerId, now + 3);
  assert.equal(duplicateReload.started, false);
  assert.equal(duplicateReload.blockedByReload, true);

  const adjusted = tracker.adjustActiveReload(playerId, 250, now + 4);
  assert.equal(adjusted.adjusted, true);
  assert.equal(adjusted.magazine?.reloadUntil, now + 2 + PHANTOM_PRIMARY_RELOAD_MS - 250);

  assert.equal(tracker.clear(playerId), true);
  assert.equal(tracker.get(playerId), undefined);
  assert.equal(tracker.clear(playerId), false);
}

{
  const tracker = new PhantomPrimaryMagazineTracker();
  const now = 10_000;

  tracker.reset(playerId).ammo = 1;
  const shot = tracker.consumeShot(playerId, now);
  assert.equal(shot.startedReload, true);

  const afterAutoComplete = tracker.consumeShot(playerId, now + PHANTOM_PRIMARY_RELOAD_MS);
  assert.equal(afterAutoComplete.consumed, true);
  assert.equal(afterAutoComplete.magazine.ammo, PHANTOM_PRIMARY_MAGAZINE_SIZE - 1);
  assert.equal(afterAutoComplete.magazine.reloadUntil, 0);
}

console.log('phantom primary magazine tests passed');
