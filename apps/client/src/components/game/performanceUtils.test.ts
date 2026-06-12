import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FrameTimeHistogram } from './adaptiveQualityHistogram';
import { addEffect, getGlobalEffectStats } from './Effects';
import { selectRemoteFullBodyIds, type RemoteLodCandidate } from './remotePlayerLod';

const histogram = new FrameTimeHistogram();
for (let i = 0; i < 95; i++) histogram.record(16);
for (let i = 0; i < 5; i++) histogram.record(48);
assert.equal(histogram.sampleCount, 100);
assert.equal(histogram.percentile(0.5), 16);
assert.equal(histogram.percentile(0.95), 16);
assert.equal(histogram.percentile(0.99), 48);
histogram.reset();
assert.equal(histogram.sampleCount, 0);
assert.equal(histogram.percentile(0.95), 0);

const candidates: RemoteLodCandidate[] = [
  { id: 'far', position: { x: 100, y: 0, z: 0 } },
  { id: 'near-b', position: { x: 5, y: 0, z: 0 } },
  { id: 'carrier', hasFlag: true, position: { x: 70, y: 0, z: 0 } },
  { id: 'near-a', position: { x: 3, y: 0, z: 0 } },
];
const ids: string[] = [];
const distances: number[] = [];
selectRemoteFullBodyIds(candidates, { x: 0, y: 0, z: 0 }, 2, new Set(), ids, distances);
assert.deepEqual(ids, ['carrier', 'near-a']);

selectRemoteFullBodyIds(candidates, { x: 0, y: 0, z: 0 }, 3, new Set(), ids, distances);
assert.ok(ids.includes('carrier'), 'objective carrier should stay eligible for high detail when budget allows');

const stickyPrevious = new Set(['near-b']);
selectRemoteFullBodyIds([
  { id: 'near-a', position: { x: 4.8, y: 0, z: 0 } },
  { id: 'near-b', position: { x: 5, y: 0, z: 0 } },
], { x: 0, y: 0, z: 0 }, 1, stickyPrevious, ids, distances);
assert.deepEqual(ids, ['near-b']);

const effectStartedAt = Date.now();
addEffect({
  type: 'hit',
  position: new THREE.Vector3(1, 2, 3),
  duration: 50,
});
assert.equal(getGlobalEffectStats(effectStartedAt).active, 1);
assert.equal(getGlobalEffectStats(effectStartedAt + 100).active, 0);

console.log('game performance utility tests passed');
