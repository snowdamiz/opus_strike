import assert from 'node:assert/strict';
import {
  createMapWarmupSnapshot,
  isMapWarmupReadyForMatchStart,
  isTerminalMapWarmupState,
  reduceMapWarmup,
} from './mapWarmupCoordinator';

const initial = createMapWarmupSnapshot('procedural-v2:123', 123);
assert.equal(initial.state, 'idle');
assert.equal(initial.canAcceptInput, false);
assert.equal(initial.canHideLoadingScreen, false);

let snapshot = reduceMapWarmup(initial, { type: 'startCpu', key: initial.key, mapSeed: initial.mapSeed });
assert.equal(snapshot.state, 'preparingCpu');
assert.equal(snapshot.canShowGameplayObjects, false);

snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'resources', durationMs: 12 });
snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'map', durationMs: 24 });
snapshot = reduceMapWarmup(snapshot, { type: 'stageProgress', stage: 'colliders', progress: 0.5, detail: 'Loading collision' });
assert.equal(snapshot.stages.colliders.partialProgress, 0.5);
assert.equal(snapshot.stages.colliders.detail, 'Loading collision');
snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'colliders', durationMs: 6 });
assert.equal(isMapWarmupReadyForMatchStart(snapshot, initial.key), false);
snapshot = reduceMapWarmup(snapshot, { type: 'stageProgress', stage: 'meshes', progress: 0.25, detail: '4/16 starter terrain regions' });
assert.equal(snapshot.stages.meshes.partialProgress, 0.25);
snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'meshes', durationMs: 42 });
assert.equal(snapshot.stages.meshes.done, true);
assert.equal(snapshot.canAcceptInput, false);
assert.equal(isMapWarmupReadyForMatchStart(snapshot, initial.key), true);
assert.equal(isMapWarmupReadyForMatchStart(snapshot, 'different-key'), false);

snapshot = reduceMapWarmup(snapshot, { type: 'startGpu' });
assert.equal(snapshot.state, 'preparingGpu');
assert.equal(snapshot.canShowGameplayObjects, true);

snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'textures', durationMs: 5 });
snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'shaders', durationMs: 8 });
snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'shadowsReflections', durationMs: 4 });
snapshot = reduceMapWarmup(snapshot, { type: 'stageDone', stage: 'gameplayObjects', durationMs: 1 });
snapshot = reduceMapWarmup(snapshot, { type: 'gpuReady' });
assert.equal(snapshot.state, 'settling');
assert.equal(snapshot.canAcceptInput, false);

snapshot = reduceMapWarmup(snapshot, { type: 'settlingFrame' });
assert.equal(snapshot.state, 'settling');
assert.equal(snapshot.canAcceptInput, false);

snapshot = reduceMapWarmup(snapshot, { type: 'settlingFrame' });
assert.equal(snapshot.state, 'ready');
assert.equal(snapshot.progress, 1);
assert.equal(snapshot.canAcceptInput, true);
assert.equal(snapshot.canHideLoadingScreen, true);
assert.equal(isTerminalMapWarmupState(snapshot.state), true);

const fallback = reduceMapWarmup(initial, { type: 'fallback', reason: 'warmup-timeout' });
assert.equal(fallback.state, 'failedWithFallback');
assert.equal(fallback.canAcceptInput, true);
assert.equal(fallback.fallbackReason, 'warmup-timeout');
