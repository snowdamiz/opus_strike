import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileWalletHandoffScreen } from './MobileWalletHandoffScreen';

const successMarkup = renderToStaticMarkup(
  <MobileWalletHandoffScreen status="success" providerId="phantom" />
);
assert.match(successMarkup, /role="dialog"/);
assert.match(successMarkup, /aria-modal="true"/);
assert.match(successMarkup, /Return to Slop Heroes/);
assert.match(successMarkup, /Close this Phantom browser/);
assert.match(successMarkup, /Open Slop Heroes from your Home Screen/);
assert.doesNotMatch(successMarkup, /<a\b/i, 'handoff screen must not offer browser navigation');
assert.doesNotMatch(successMarkup, /<button\b/i, 'handoff screen must not be dismissible');

const errorMarkup = renderToStaticMarkup(
  <MobileWalletHandoffScreen status="error" providerId="solflare" errorCode="wallet_denied" />
);
assert.match(errorMarkup, /Wallet sign-in didn’t finish/);
assert.match(errorMarkup, /The wallet request was canceled/);
assert.match(errorMarkup, /Close this Solflare browser/);

console.log('mobile-wallet-handoff screen tests passed');
