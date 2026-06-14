import assert from 'node:assert/strict';
import {
  DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE,
  createNetworkQualityState,
  evaluatePlayerNetworkQuality,
  recordNetworkQualitySample,
} from '../rooms/networkQualityGate';

const config = DEFAULT_COMPETITIVE_NETWORK_QUALITY_GATE;
const player = { playerId: 'player-a', playerName: 'Player A' };

function evaluate(samples: Array<number | null>, now = 10_000) {
  const state = createNetworkQualityState(now - config.minObservationMs);
  samples.forEach((pingMs, index) => {
    recordNetworkQualitySample(state, {
      at: now - (samples.length - index) * 500,
      pingMs,
      timedOut: pingMs === null,
    }, config);
  });

  return evaluatePlayerNetworkQuality({
    ...player,
    state,
    now,
    config,
  });
}

{
  const state = createNetworkQualityState(1_000);
  recordNetworkQualitySample(state, { at: 1_000, pingMs: 42 }, config);
  const result = evaluatePlayerNetworkQuality({
    ...player,
    state,
    now: 2_000,
    config,
  });

  assert.equal(result.status, 'pending');
  assert.equal(result.reason, 'collecting_network_samples');
}

{
  const result = evaluate([190, 205, 215]);

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'average_ping_high');
}

{
  const result = evaluate([44, 210, 48]);

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'jitter_high');
}

{
  const result = evaluate([58, null, 62, 65]);

  assert.equal(result.status, 'ready');
}

{
  const result = evaluate([58, null, 62, null, 65]);

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'network_timeouts');
}

console.log('network quality gate tests passed');
