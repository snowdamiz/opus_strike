import assert from 'node:assert/strict';
import {
  BLAZE_FLAMETHROWER_BURN_INTERVAL_MS,
  BLAZE_FLAMETHROWER_BURN_TICKS,
} from '@voxel-strike/shared';
import { BlazeBurnEffectTracker } from '../rooms/blazeBurnEffects';

const targetId = 'target';
const sourceId = 'source';
const burnDurationMs = BLAZE_FLAMETHROWER_BURN_INTERVAL_MS * BLAZE_FLAMETHROWER_BURN_TICKS;

{
  const tracker = new BlazeBurnEffectTracker();
  const sourcePosition = { x: 1, y: 2, z: 3 };
  const sourceDirection = { x: 0, y: 0, z: -1 };

  tracker.ignite(targetId, sourceId, 1_000, sourcePosition, sourceDirection);
  sourcePosition.x = 99;
  sourceDirection.z = 99;

  assert.equal(tracker.getBurnUntil(targetId), 1_000 + burnDurationMs);

  const ticks: unknown[] = [];
  tracker.update(1_500, {
    isTargetDamageable: () => true,
    hasSource: () => true,
    applyTick: (tick) => {
      ticks.push(tick);
      return false;
    },
  });

  assert.deepEqual(ticks, [{
    targetId,
    sourceId,
    sourcePosition: { x: 1, y: 2, z: 3 },
    sourceDirection: { x: 0, y: 0, z: -1 },
    tickCount: 1,
  }]);
}

{
  const tracker = new BlazeBurnEffectTracker();

  tracker.ignite(targetId, sourceId, 1_000, null, null);
  tracker.ignite(targetId, 'source-b', 1_300, null, null);

  assert.equal(tracker.getBurnUntil(targetId), 1_000 + burnDurationMs);
}

{
  const tracker = new BlazeBurnEffectTracker();
  const ticks: unknown[] = [];

  tracker.ignite(targetId, sourceId, 1_000, null, null);
  tracker.update(1_499, {
    isTargetDamageable: () => true,
    hasSource: () => true,
    applyTick: (tick) => {
      ticks.push(tick);
      return false;
    },
  });
  assert.equal(ticks.length, 0);

  tracker.update(2_500, {
    isTargetDamageable: () => true,
    hasSource: () => true,
    applyTick: (tick) => {
      ticks.push(tick);
      return false;
    },
  });

  assert.equal(ticks.length, 1);
  assert.deepEqual(ticks, [{
    targetId,
    sourceId,
    sourcePosition: null,
    sourceDirection: null,
    tickCount: 3,
  }]);
  assert.equal(tracker.getBurnUntil(targetId), 1_000 + burnDurationMs);
}

{
  const tracker = new BlazeBurnEffectTracker();
  const sourceIds: Array<string | null> = [];

  tracker.ignite(targetId, 'missing-source', 1_000, null, null);
  tracker.update(1_500, {
    isTargetDamageable: () => true,
    hasSource: () => false,
    applyTick: (tick) => {
      sourceIds.push(tick.sourceId);
      return false;
    },
  });

  assert.deepEqual(sourceIds, [null]);
}

{
  const tracker = new BlazeBurnEffectTracker();
  let alive = true;
  let tickCount = 0;

  tracker.ignite(targetId, sourceId, 1_000, null, null);
  tracker.update(2_500, {
    isTargetDamageable: () => alive,
    hasSource: () => true,
    applyTick: () => {
      tickCount++;
      alive = false;
      return true;
    },
  });

  assert.equal(tickCount, 1);
  assert.equal(tracker.getBurnUntil(targetId), null);
}

{
  const tracker = new BlazeBurnEffectTracker();
  const targetStates = new Map([[targetId, 'downed']]);
  const ticks: unknown[] = [];

  tracker.ignite(targetId, sourceId, 1_000, null, null);
  tracker.update(1_500, {
    isTargetDamageable: (id) => targetStates.get(id) === 'alive' || targetStates.get(id) === 'downed',
    hasSource: () => true,
    applyTick: (tick) => {
      ticks.push(tick);
      targetStates.set(targetId, 'dead');
      return true;
    },
  });

  assert.deepEqual(ticks, [{
    targetId,
    sourceId,
    sourcePosition: null,
    sourceDirection: null,
    tickCount: 1,
  }]);
  assert.equal(tracker.getBurnUntil(targetId), null);
}

{
  const tracker = new BlazeBurnEffectTracker();

  tracker.ignite('player-a', 'source', 1_000, null, null);
  tracker.ignite('target-b', 'player-a', 1_000, null, null);
  tracker.clearTarget('player-a');

  assert.equal(tracker.getBurnUntil('player-a'), null);
  assert.equal(tracker.getBurnUntil('target-b'), 1_000 + burnDurationMs);

  tracker.clearPlayer('player-a');
  assert.equal(tracker.getBurnUntil('target-b'), null);
}

{
  const tracker = new BlazeBurnEffectTracker();

  tracker.ignite(targetId, sourceId, 1_000, null, null);
  tracker.clearAll();
  assert.equal(tracker.getBurnUntil(targetId), null);
}

console.log('blaze burn effect tests passed');
