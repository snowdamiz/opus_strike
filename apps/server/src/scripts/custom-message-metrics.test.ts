import assert from 'node:assert/strict';
import { estimateCustomMessageBytes } from '../rooms/customMessageMetrics';
import { GameRoom } from '../rooms/GameRoom';
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

const combatBatchBytes = estimateCustomMessageBytes('playerEventBatch', {
  events: [
    { type: 'abilityUsed', payload: { playerId: 'bot-a', abilityId: 'phantom_primary' } },
    { type: 'playerDamaged', payload: { targetId: 'bot-b', damage: 24 } },
    { type: 'playerKilled', payload: { victimId: 'bot-b', killerId: 'bot-a' } },
  ],
});
assert.ok(
  combatBatchBytes >
    estimateCustomMessageBytes('abilityUsed', {}) +
    estimateCustomMessageBytes('playerDamaged', {}) +
    estimateCustomMessageBytes('playerKilled', {})
);

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

{
  const sent: Array<{ type: string; payload: unknown }> = [];
  type BatchTestClient = {
    send(type: string, payload: unknown): void;
  };
  const client: BatchTestClient = {
    send(type: string, payload: unknown) {
      sent.push({ type, payload });
    },
  };
  const room = Object.create(GameRoom.prototype) as {
    state: { phase: string };
    tickInProgress: boolean;
    roomMetrics: { recordCustomMessage(type: string, payload: unknown, recipients: number): void };
    deferredTrackedMessages: Array<{ client: BatchTestClient; type: string; payload: unknown }>;
    deferredPlayerEventBatches: Map<BatchTestClient, Array<{ type: string; payload: unknown }>>;
    deferredPlayerEventBatchClients: BatchTestClient[];
    sendTrackedAfterGameplayWork(client: BatchTestClient, type: string, payload: unknown): void;
    flushDeferredTrackedMessages(): void;
  };
  room.state = { phase: 'playing' };
  room.tickInProgress = true;
  room.roomMetrics = { recordCustomMessage: () => undefined };
  room.deferredTrackedMessages = [];
  room.deferredPlayerEventBatches = new Map();
  room.deferredPlayerEventBatchClients = [];

  room.sendTrackedAfterGameplayWork(client, 'abilityUsed', { playerId: 'bot-a', abilityId: 'phantom_primary' });
  room.sendTrackedAfterGameplayWork(client, 'playerDamaged', { targetId: 'bot-b', damage: 24 });
  assert.equal(sent.length, 0);

  room.flushDeferredTrackedMessages();
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.type, 'playerEventBatch');
  assert.deepEqual(sent[0]?.payload, {
    events: [
      { type: 'abilityUsed', payload: { playerId: 'bot-a', abilityId: 'phantom_primary' } },
      { type: 'playerDamaged', payload: { targetId: 'bot-b', damage: 24 } },
    ],
  });
  room.flushDeferredTrackedMessages();
  assert.equal(sent.length, 1);
}

console.log('custom message metrics tests passed');
