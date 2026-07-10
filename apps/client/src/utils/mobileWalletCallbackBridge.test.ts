import assert from 'node:assert/strict';
import { parseMobileWalletCallbackBridgeResponse } from './mobileWalletCallbackBridge';

assert.deepEqual(parseMobileWalletCallbackBridgeResponse({
  action: 'handoff',
  status: 'success',
  providerId: 'phantom',
}), {
  action: 'handoff',
  status: 'success',
  providerId: 'phantom',
});

assert.deepEqual(parseMobileWalletCallbackBridgeResponse({
  action: 'handoff',
  status: 'error',
  providerId: 'solflare',
  errorCode: 'wallet_denied',
}), {
  action: 'handoff',
  status: 'error',
  providerId: 'solflare',
  errorCode: 'wallet_denied',
});

assert.equal(parseMobileWalletCallbackBridgeResponse({
  action: 'handoff',
  status: 'success',
  providerId: 'unknown',
}), null);
assert.equal(parseMobileWalletCallbackBridgeResponse({ action: 'complete' }), null);

console.log('mobile-wallet callback bridge tests passed');
