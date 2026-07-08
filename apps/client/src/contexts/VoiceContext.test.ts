import assert from 'node:assert/strict';
import { computeVoiceConnectRetryDelayMs } from './VoiceContext';

assert.equal(computeVoiceConnectRetryDelayMs(0, 0), 1000);
assert.equal(computeVoiceConnectRetryDelayMs(1, 0), 2000);
assert.equal(computeVoiceConnectRetryDelayMs(2, 1), 5000);
assert.equal(computeVoiceConnectRetryDelayMs(99, 0), 15000);
assert.equal(computeVoiceConnectRetryDelayMs(-1, 0.5), 1125);

console.log('voice context tests passed');
