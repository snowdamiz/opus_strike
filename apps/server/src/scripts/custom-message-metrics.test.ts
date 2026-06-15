import assert from 'node:assert/strict';
import { estimateCustomMessageBytes } from '../rooms/customMessageMetrics';

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

console.log('custom message metrics tests passed');
