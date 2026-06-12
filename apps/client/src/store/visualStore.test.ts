import assert from 'node:assert/strict';
import {
  MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS,
} from '@voxel-strike/shared';
import {
  addRemoteTransformSnapshot,
  clearVisualState,
  pruneRemoteTransformHistories,
  sampleRemoteTransformInto,
  visualStore,
  type SampledRemoteTransform,
} from './visualStore';

function makeTarget(): SampledRemoteTransform {
  return {
    position: { x: 0, y: 0, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
    lookYaw: 0,
    lookPitch: 0,
    movementBits: 0,
    wallRunSide: 0,
    movementEpoch: 0,
    extrapolatedMs: 0,
    stale: false,
  };
}

function addSnapshot(serverTime: number, x: number): void {
  addRemoteTransformSnapshot('remote-a', {
    serverTick: serverTime / 50,
    serverTime,
    position: { x, y: 1, z: 0 },
    velocity: { x: 1, y: 0, z: 0 },
    lookYaw: x,
    lookPitch: 0,
    movementBits: x,
    wallRunSide: 0,
    movementEpoch: 1,
  });
}

clearVisualState();
addSnapshot(1200, 12);
addSnapshot(1000, 10);
addSnapshot(1100, 11);

const history = visualStore.getState().remoteTransformHistories.get('remote-a');
assert.ok(history);
assert.deepEqual(history.snapshots.map((snapshot) => snapshot.serverTime), [1000, 1100, 1200]);

const target = makeTarget();
const sampled = sampleRemoteTransformInto(
  'remote-a',
  target,
  history.latestReceivedAtMs + MOVEMENT_REMOTE_INTERPOLATION_DELAY_MS - 50
);
assert.equal(sampled, true);
assert.equal(target.position.x, 11.5);
assert.equal(target.velocity.x, 1);
assert.equal(target.movementBits, 12);
assert.equal(target.movementEpoch, 1);
assert.equal(target.stale, false);

addRemoteTransformSnapshot('remote-b', {
  serverTick: 25,
  serverTime: 1250,
  position: { x: 20, y: 1, z: 0 },
  velocity: { x: 0, y: 0, z: 0 },
  lookYaw: 0,
  lookPitch: 0,
  movementBits: 0,
  wallRunSide: 0,
  movementEpoch: 1,
});
assert.equal(visualStore.getState().remoteTransformHistories.has('remote-b'), true);

pruneRemoteTransformHistories(new Set(['remote-a']));
assert.equal(visualStore.getState().remoteTransformHistories.has('remote-a'), true);
assert.equal(visualStore.getState().remoteTransformHistories.has('remote-b'), false);

const missingTarget = makeTarget();
assert.equal(sampleRemoteTransformInto('missing', missingTarget), false);

console.log('visualStore remote transform tests passed');
