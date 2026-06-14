import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FrameTimeHistogram } from './adaptiveQualityHistogram';
import { addEffect, getGlobalEffectStats } from './Effects';
import {
  getMovementNetworkDiagnosticsSnapshot,
  resetMovementNetworkDiagnostics,
} from '../../movement/networkDiagnostics';
import { GameplayFrameScheduler } from './systems/gameplayFrameScheduler';

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

const effectStartedAt = Date.now();
addEffect({
  type: 'hit',
  position: new THREE.Vector3(1, 2, 3),
  duration: 50,
});
assert.equal(getGlobalEffectStats(effectStartedAt).active, 1);
assert.equal(getGlobalEffectStats(effectStartedAt + 100).active, 0);

resetMovementNetworkDiagnostics();
const scheduler = new GameplayFrameScheduler();
let scheduledRuns = 0;
const unregister = scheduler.register({
  system: 'testSystem',
  label: 'frame.testSystem',
  cadence: { kind: 'intervalMs', intervalMs: 20 },
  callback: () => {
    scheduledRuns++;
  },
});
scheduler.run({ deltaSeconds: 0.01, deltaMs: 10, nowMs: 10, elapsedSeconds: 0.01 });
assert.equal(scheduledRuns, 0);
scheduler.run({ deltaSeconds: 0.01, deltaMs: 10, nowMs: 20, elapsedSeconds: 0.02 });
assert.equal(scheduledRuns, 1);
assert.equal(getMovementNetworkDiagnosticsSnapshot().frameScheduler.activeCallbacks, 1);
assert.equal(getMovementNetworkDiagnosticsSnapshot().frameScheduler.callbacksBySystem.testSystem, 1);
unregister();
assert.equal(getMovementNetworkDiagnosticsSnapshot().frameScheduler.activeCallbacks, 0);

console.log('game performance utility tests passed');
