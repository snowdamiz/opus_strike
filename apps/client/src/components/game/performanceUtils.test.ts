import assert from 'node:assert/strict';
import { FrameTimeHistogram } from './adaptiveQualityHistogram';
import { GameplayFrameScheduler } from './systems/gameplayFrameScheduler';
import { createFrameUpdaterRegistry } from './systems/frameUpdaterRegistry';

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
assert.equal(scheduler.activeCallbackCount, 1);
assert.equal(scheduler.getCallbacksBySystem().testSystem, 1);
unregister();
assert.equal(scheduler.activeCallbackCount, 0);

const registry = createFrameUpdaterRegistry<number>();
let registryTotal = 0;
const unregisterOld = registry.register('effect-a', (value) => {
  registryTotal += value;
});
const unregisterReplacement = registry.register('effect-a', (value) => {
  registryTotal += value * 10;
});
registry.register('effect-b', (value) => {
  registryTotal += value * 100;
});
assert.equal(registry.size, 2);
unregisterOld();
assert.equal(registry.size, 2);
registry.run(2, 0);
assert.equal(registryTotal, 220);
unregisterReplacement();
assert.equal(registry.size, 1);

console.log('game performance utility tests passed');
