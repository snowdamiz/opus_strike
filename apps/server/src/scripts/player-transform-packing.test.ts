import assert from 'node:assert/strict';
import type { PackedPlayerTransform } from '@voxel-strike/shared';
import {
  DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS,
  TRANSFORM_HEARTBEAT_INTERVAL_MS,
  getPackedTransformHeartbeatInterval,
  havePackedTransformsChanged,
  selectPackedTransformDelta,
  shouldSendPackedTransformUpdate,
} from '../rooms/playerTransformPacking';

function transform(overrides: { px?: number } = {}): PackedPlayerTransform {
  return [1, overrides.px ?? 10, 20, 30, 0, 0, 0, 90, 0, 0, 0, 1, 0];
}

{
  const current = transform();
  assert.equal(havePackedTransformsChanged(undefined, current), true);
  assert.equal(havePackedTransformsChanged(transform(), current), false);
  assert.equal(havePackedTransformsChanged(transform({ px: 11 }), current), true);
}

{
  assert.equal(getPackedTransformHeartbeatInterval(true), TRANSFORM_HEARTBEAT_INTERVAL_MS);
  assert.equal(getPackedTransformHeartbeatInterval(false), DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS);
}

{
  const state = {
    signatures: new Map<string, PackedPlayerTransform>(),
    heartbeatAt: new Map<string, number>(),
  };
  const current = transform();
  const delta = selectPackedTransformDelta({
    state,
    playerId: 'player-a',
    getSnapshot: () => ({ transform: current, signature: current }),
    exactStateVisible: true,
    force: false,
    getHighRelevance: () => true,
    now: 1_000,
  });

  assert.deepEqual(delta, { kind: 'visible', transform: current });
  assert.equal(state.signatures.get('player-a'), current);
  assert.equal(state.heartbeatAt.get('player-a'), 1_000);

  assert.equal(selectPackedTransformDelta({
    state,
    playerId: 'player-a',
    getSnapshot: () => ({ transform: current, signature: current }),
    exactStateVisible: true,
    force: false,
    getHighRelevance: () => true,
    now: 1_000 + TRANSFORM_HEARTBEAT_INTERVAL_MS - 1,
  }), null);

  assert.deepEqual(selectPackedTransformDelta({
    state,
    playerId: 'player-a',
    getSnapshot: () => ({ transform: current, signature: current }),
    exactStateVisible: true,
    force: false,
    getHighRelevance: () => true,
    now: 1_000 + TRANSFORM_HEARTBEAT_INTERVAL_MS,
  }), { kind: 'visible', transform: current });
}

{
  let snapshotCalls = 0;
  let highRelevanceCalls = 0;
  const state = {
    signatures: new Map<string, PackedPlayerTransform>([['player-a', transform()]]),
    heartbeatAt: new Map<string, number>([['player-a', 1_000]]),
  };

  assert.deepEqual(selectPackedTransformDelta({
    state,
    playerId: 'player-a',
    getSnapshot: () => {
      snapshotCalls++;
      return { transform: transform(), signature: transform() };
    },
    exactStateVisible: false,
    force: false,
    getHighRelevance: () => {
      highRelevanceCalls++;
      return true;
    },
    now: 1_100,
  }), { kind: 'hidden', playerId: 'player-a' });
  assert.equal(snapshotCalls, 0);
  assert.equal(highRelevanceCalls, 0);
  assert.equal(state.signatures.has('player-a'), false);
  assert.equal(state.heartbeatAt.has('player-a'), false);

  assert.equal(selectPackedTransformDelta({
    state,
    playerId: 'player-a',
    getSnapshot: () => {
      snapshotCalls++;
      return { transform: transform(), signature: transform() };
    },
    exactStateVisible: false,
    force: false,
    getHighRelevance: () => {
      highRelevanceCalls++;
      return true;
    },
    now: 1_200,
  }), null);
  assert.equal(snapshotCalls, 0);
  assert.equal(highRelevanceCalls, 0);

  assert.deepEqual(selectPackedTransformDelta({
    state,
    playerId: 'player-a',
    getSnapshot: () => {
      snapshotCalls++;
      return { transform: transform(), signature: transform() };
    },
    exactStateVisible: false,
    force: true,
    getHighRelevance: () => {
      highRelevanceCalls++;
      return true;
    },
    now: 1_300,
  }), { kind: 'hidden', playerId: 'player-a' });
  assert.equal(snapshotCalls, 0);
  assert.equal(highRelevanceCalls, 0);
}

{
  const previousSignature = transform();
  const signature = transform();

  assert.equal(shouldSendPackedTransformUpdate({
    force: true,
    highRelevance: false,
    previousSignature,
    signature,
    lastHeartbeatAt: 1_000,
    now: 1_001,
  }), true);

  assert.equal(shouldSendPackedTransformUpdate({
    force: false,
    highRelevance: true,
    previousSignature,
    signature: transform({ px: 11 }),
    lastHeartbeatAt: 1_000,
    now: 1_001,
  }), true);

  assert.equal(shouldSendPackedTransformUpdate({
    force: false,
    highRelevance: false,
    previousSignature,
    signature: transform({ px: 11 }),
    lastHeartbeatAt: 1_000,
    now: 1_001,
  }), false);

  assert.equal(shouldSendPackedTransformUpdate({
    force: false,
    highRelevance: false,
    previousSignature,
    signature,
    lastHeartbeatAt: 1_000,
    now: 1_000 + DISTANT_TRANSFORM_HEARTBEAT_INTERVAL_MS,
  }), true);

  assert.equal(shouldSendPackedTransformUpdate({
    force: false,
    highRelevance: true,
    previousSignature,
    signature,
    lastHeartbeatAt: 1_000,
    now: 1_000 + TRANSFORM_HEARTBEAT_INTERVAL_MS - 1,
  }), false);
}

console.log('player transform packing tests passed');
