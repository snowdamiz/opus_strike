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

const singleBytes = estimateCustomMessageBytes('playerTransformsV2', singleTransform);
const multiBytes = estimateCustomMessageBytes('playerTransformsV2', multiTransform);

assert.ok(singleBytes > 0);
assert.ok(multiBytes > singleBytes);

const cyclic: Record<string, unknown> = { type: 'diagnostic' };
cyclic.self = cyclic;
assert.ok(estimateCustomMessageBytes('diagnostic', cyclic) > 0);

console.log('custom message metrics tests passed');
