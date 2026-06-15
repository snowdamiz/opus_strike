import assert from 'node:assert/strict';
import {
  SERVER_LATENCY_THRESHOLDS,
  averageLatencySamples,
  classifyServerLatency,
  latencyProbeUrl,
} from './serverLatency';

assert.equal(classifyServerLatency(null), 'checking');
assert.equal(classifyServerLatency(SERVER_LATENCY_THRESHOLDS.fairPingMs - 1), 'good');
assert.equal(classifyServerLatency(SERVER_LATENCY_THRESHOLDS.fairPingMs), 'fair');
assert.equal(classifyServerLatency(SERVER_LATENCY_THRESHOLDS.highPingMs - 1), 'fair');
assert.equal(classifyServerLatency(SERVER_LATENCY_THRESHOLDS.highPingMs), 'high');

assert.equal(averageLatencySamples([]), null);
assert.equal(averageLatencySamples([101, 102, 103]), 102);
assert.equal(averageLatencySamples([140, 141]), 141);

const url = latencyProbeUrl('https://example.com/health?existing=1', 123);
assert.equal(url, 'https://example.com/health?existing=1&_latency=123');
