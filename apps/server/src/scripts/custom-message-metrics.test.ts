import assert from 'node:assert/strict';
import { estimateCustomMessageBytes } from '../rooms/customMessageMetrics';
import { RoomMetrics } from '../rooms/roomMetrics';

const singleTransform = {
  version: 2,
  tick: 120,
  serverTime: 1_725_000_000_000,
  streamEpoch: 3,
  full: false,
  players: [
    [1, 128, 64, -256, 8, 0, -2, 1024, 0, 3, 0, 0, 255],
  ],
};

const multiTransform = {
  ...singleTransform,
  players: [
    ...singleTransform.players,
    [2, 256, 64, -512, 6, 0, -4, 2048, 0, 1, 0, 0, 255],
  ],
};

const hiddenTransform = {
  ...singleTransform,
  players: [],
  hiddenPlayerIds: ['enemy-a', 'enemy-b'],
};

const interestUpdate = {
  tick: 120,
  serverTime: 1_725_000_000_000,
  players: [
    { playerId: 'enemy-a', state: 'hidden', reason: 'distance_cutoff' },
    { playerId: 'enemy-b', state: 'last_known', reason: 'last_known', lastKnownPosition: { x: 4, y: 1, z: -2 } },
  ],
};

const singleBytes = estimateCustomMessageBytes('playerTransformsV2', singleTransform);
const multiBytes = estimateCustomMessageBytes('playerTransformsV2', multiTransform);
const hiddenBytes = estimateCustomMessageBytes('playerTransformsV2', hiddenTransform);

assert.ok(singleBytes > 0);
assert.ok(multiBytes > singleBytes);
assert.ok(hiddenBytes > estimateCustomMessageBytes('playerTransformsV2', { ...singleTransform, players: [] }));
assert.ok(estimateCustomMessageBytes('playerInterest', interestUpdate) > 0);

const cyclic: Record<string, unknown> = { type: 'diagnostic' };
cyclic.self = cyclic;
assert.ok(estimateCustomMessageBytes('diagnostic', cyclic) > 0);

const roomMetrics = new RoomMetrics(3);
assert.equal(roomMetrics.getTickDurationPercentile(0.95), 0);
roomMetrics.recordTickDuration(12);
roomMetrics.recordTickDuration(-4);
roomMetrics.recordTickDuration(30);
roomMetrics.recordTickDuration(18);
assert.equal(roomMetrics.getTickDurationPercentile(0), 0);
assert.equal(roomMetrics.getTickDurationPercentile(0.5), 18);
assert.equal(roomMetrics.getTickDurationPercentile(1), 30);

roomMetrics.recordCustomMessage('playerTransformsV2', singleTransform, 2);
roomMetrics.recordCustomMessage('playerVitals', { players: [{ playerId: 'a' }], removedPlayerIds: [] }, 1);
roomMetrics.recordCustomMessage('ignored', { ok: true }, 0);

const metricsSnapshot = roomMetrics.getCustomMessageMetricsSnapshot();
assert.equal(metricsSnapshot.playerTransformsV2.messages, 1);
assert.equal(metricsSnapshot.playerTransformsV2.recipients, 2);
assert.equal(metricsSnapshot.playerTransformsV2.bytes, singleBytes * 2);
assert.equal(metricsSnapshot.ignored, undefined);
assert.equal(roomMetrics.getCustomMessageMetric('playerTransformsV2')?.bytes, singleBytes * 2);

const messageTotals = roomMetrics.getCustomMessageTotals();
assert.equal(messageTotals.messages, 2);
assert.ok(messageTotals.bytes > singleBytes * 2);

console.log('custom message metrics tests passed');
