import assert from 'node:assert/strict';
import { getBoundedRoomTickSchedule } from '../rooms/roomTickSchedule';

{
  const plan = getBoundedRoomTickSchedule({
    nowMs: 1_005,
    scheduledTickAtMs: 1_000,
    tickIntervalMs: 50,
    maxRetainedTicks: 4,
  });

  assert.deepEqual(plan, {
    scheduledTickAtMs: 1_000,
    nextTickAtMs: 1_050,
    droppedTickCount: 0,
    hasCatchupTick: false,
  });
}

{
  const plan = getBoundedRoomTickSchedule({
    nowMs: 1_200,
    scheduledTickAtMs: 1_000,
    tickIntervalMs: 50,
    maxRetainedTicks: 4,
  });

  assert.deepEqual(plan, {
    scheduledTickAtMs: 1_050,
    nextTickAtMs: 1_100,
    droppedTickCount: 1,
    hasCatchupTick: true,
  });
}

{
  const retainedTicks: number[] = [];
  let scheduledTickAtMs = 1_000;
  const nowMs = 1_500;

  while (true) {
    const plan = getBoundedRoomTickSchedule({
      nowMs,
      scheduledTickAtMs,
      tickIntervalMs: 50,
      maxRetainedTicks: 4,
    });
    retainedTicks.push(plan.scheduledTickAtMs);
    scheduledTickAtMs = plan.nextTickAtMs;
    if (!plan.hasCatchupTick) break;
  }

  assert.deepEqual(retainedTicks, [1_350, 1_400, 1_450, 1_500]);
}

console.log('room tick schedule tests passed');
