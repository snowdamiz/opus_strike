import assert from 'node:assert/strict';

const storage = new Map<string, string>();
const assignedUrls: string[] = [];

const localStorage = {
  get length() {
    return storage.size;
  },
  clear: () => {
    storage.clear();
  },
  getItem: (key: string) => storage.get(key) ?? null,
  key: (index: number) => Array.from(storage.keys())[index] ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
};

(globalThis as any).window = {
  localStorage,
  location: {
    href: 'https://play.opus-strike.test/lobby?wallet_action=stale&data=old#join',
    assign: (url: string) => {
      assignedUrls.push(url);
    },
  },
  history: {
    replaceState: () => undefined,
  },
};

Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: {
    maxTouchPoints: 5,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  },
});

const {
  createMobileWalletDeepLinkUrl,
  startMobileWalletConnect,
} = await import('./mobileWalletDeepLink');

assert.equal(
  createMobileWalletDeepLinkUrl(
    'phantom',
    'signMessage',
    new URLSearchParams({ nonce: 'abc' }),
    { preferCustomScheme: false }
  ),
  'https://phantom.app/ul/v1/signMessage?nonce=abc'
);
assert.equal(
  createMobileWalletDeepLinkUrl('solflare', 'connect', new URLSearchParams({ request: '1' })),
  'https://solflare.com/ul/v1/connect?request=1'
);
assert.equal(
  createMobileWalletDeepLinkUrl('backpack', 'connect', new URLSearchParams({ request: '1' })),
  'https://backpack.app/ul/v1/connect?request=1'
);

startMobileWalletConnect('phantom', 'walletAuth');

assert.equal(assignedUrls.length, 1);

const openedUrl = new URL(assignedUrls[0]);
assert.equal(openedUrl.protocol, 'phantom:');
assert.equal(openedUrl.host, 'v1');
assert.equal(openedUrl.pathname, '/connect');
assert.equal(openedUrl.searchParams.get('app_url'), 'https://play.opus-strike.test');
assert.ok(openedUrl.searchParams.get('dapp_encryption_public_key'));

const redirectLink = openedUrl.searchParams.get('redirect_link');
assert.ok(redirectLink);

const redirectUrl = new URL(redirectLink);
assert.equal(redirectUrl.origin, 'https://play.opus-strike.test');
assert.equal(redirectUrl.pathname, '/lobby');
assert.equal(redirectUrl.hash, '#join');
assert.equal(redirectUrl.searchParams.get('wallet_provider'), 'phantom');
assert.equal(redirectUrl.searchParams.get('wallet_action'), 'connect');
assert.equal(redirectUrl.searchParams.has('data'), false);

const storedRequest = JSON.parse(storage.get('opusStrike.mobileWalletDeepLink.request') ?? '{}');
assert.equal(storedRequest.providerId, 'phantom');
assert.equal(storedRequest.action, 'connect');
assert.equal(storedRequest.purpose, 'walletAuth');
assert.equal(redirectUrl.searchParams.get('wallet_request'), storedRequest.requestId);

console.log('mobile wallet deep link tests passed');
