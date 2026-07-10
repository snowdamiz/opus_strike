import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {
  buildMobileWalletConnectUrl,
  buildMobileWalletSignMessageUrl,
  createMobileWalletDeepLinkState,
  decryptMobileWalletConnectResponse,
  decryptMobileWalletSignMessageResponse,
} from '../auth/mobileWalletDeepLink';
import {
  consumeMobileWalletHandoffResult,
  forceLocalMobileWalletDeepLinkStoreForTests,
  readMobileWalletDeepLinkState,
  resetMobileWalletDeepLinkStoreForTests,
  storeMobileWalletDeepLinkState,
  storeMobileWalletHandoffResult,
  MOBILE_WALLET_HANDOFF_TTL_MS,
  type MobileWalletDeepLinkState,
} from '../auth/mobileWalletDeepLinkStore';
import {
  buildMobileWalletHandoffPage,
  buildMobileWalletHandoffResponse,
} from '../auth/mobileWalletHandoffPage';

function encryptWalletResponse(input: {
  dappPublicKey: string;
  walletSecretKey: Uint8Array;
  payload: Record<string, unknown>;
}): { nonce: string; data: string } {
  const sharedSecret = nacl.box.before(bs58.decode(input.dappPublicKey), input.walletSecretKey);
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = new TextEncoder().encode(JSON.stringify(input.payload));
  const encrypted = nacl.box.after(plaintext, nonce, sharedSecret);

  return {
    nonce: bs58.encode(nonce),
    data: bs58.encode(encrypted),
  };
}

function decryptWalletRequest(input: {
  dappPublicKey: string;
  walletSecretKey: Uint8Array;
  nonce: string;
  payload: string;
}): Record<string, unknown> {
  const sharedSecret = nacl.box.before(bs58.decode(input.dappPublicKey), input.walletSecretKey);
  const decrypted = nacl.box.open.after(
    bs58.decode(input.payload),
    bs58.decode(input.nonce),
    sharedSecret
  );

  assert.ok(decrypted, 'wallet request should decrypt');
  return JSON.parse(new TextDecoder().decode(decrypted)) as Record<string, unknown>;
}

function runMobileWalletDeepLinkTests(): void {
  const state = createMobileWalletDeepLinkState({
    providerId: 'phantom',
    returnTo: '/ranked?auth=old#queue',
    authToken: 'existing-auth-token',
    now: 1234,
  });
  assert.equal(state.providerId, 'phantom');
  assert.equal(state.phase, 'connect');
  assert.equal(state.returnTo, '/ranked?auth=old#queue');
  assert.equal(state.authToken, 'existing-auth-token');

  const connectUrl = new URL(buildMobileWalletConnectUrl({
    state,
    appUrl: 'https://slopheroes.xyz',
    redirectLink: 'https://api.slopheroes.xyz/auth/mobile-wallet/phantom/connect?state=test-state',
    cluster: 'mainnet-beta',
  }));
  assert.equal(connectUrl.origin + connectUrl.pathname, 'https://phantom.app/ul/v1/connect');
  assert.equal(connectUrl.searchParams.get('app_url'), 'https://slopheroes.xyz');
  assert.equal(connectUrl.searchParams.get('dapp_encryption_public_key'), state.dappPublicKey);
  assert.equal(connectUrl.searchParams.get('cluster'), 'mainnet-beta');

  const walletEncryptionKeyPair = nacl.box.keyPair();
  const walletSigningKeyPair = nacl.sign.keyPair();
  const walletAddress = bs58.encode(walletSigningKeyPair.publicKey);
  const encryptedConnect = encryptWalletResponse({
    dappPublicKey: state.dappPublicKey,
    walletSecretKey: walletEncryptionKeyPair.secretKey,
    payload: {
      public_key: walletAddress,
      session: 'mobile-session-token',
    },
  });
  const connectParams = new URLSearchParams({
    phantom_encryption_public_key: bs58.encode(walletEncryptionKeyPair.publicKey),
    nonce: encryptedConnect.nonce,
    data: encryptedConnect.data,
  });
  const connectResponse = decryptMobileWalletConnectResponse(state, connectParams);
  assert.equal(connectResponse.walletEncryptionPublicKey, bs58.encode(walletEncryptionKeyPair.publicKey));
  assert.deepEqual(connectResponse.data, {
    public_key: walletAddress,
    session: 'mobile-session-token',
  });

  const signState: MobileWalletDeepLinkState = {
    ...state,
    phase: 'sign',
    walletEncryptionPublicKey: connectResponse.walletEncryptionPublicKey,
    walletAddress,
    walletSession: connectResponse.data.session,
    authNonce: 'auth-nonce',
  };
  const signUrl = new URL(buildMobileWalletSignMessageUrl({
    state: signState,
    message: 'Slop Heroes wallet auth test',
    redirectLink: 'https://api.slopheroes.xyz/auth/mobile-wallet/phantom/sign?state=test-state',
  }));
  assert.equal(signUrl.origin + signUrl.pathname, 'https://phantom.app/ul/v1/signMessage');
  assert.equal(signUrl.searchParams.get('dapp_encryption_public_key'), state.dappPublicKey);

  const signRequestPayload = decryptWalletRequest({
    dappPublicKey: state.dappPublicKey,
    walletSecretKey: walletEncryptionKeyPair.secretKey,
    nonce: signUrl.searchParams.get('nonce') ?? '',
    payload: signUrl.searchParams.get('payload') ?? '',
  });
  assert.equal(signRequestPayload.session, 'mobile-session-token');
  assert.equal(signRequestPayload.display, 'utf8');
  assert.equal(
    new TextDecoder().decode(bs58.decode(String(signRequestPayload.message))),
    'Slop Heroes wallet auth test'
  );

  const encryptedSignature = encryptWalletResponse({
    dappPublicKey: state.dappPublicKey,
    walletSecretKey: walletEncryptionKeyPair.secretKey,
    payload: { signature: 'signed-message-base58' },
  });
  const signatureResponse = decryptMobileWalletSignMessageResponse(signState, new URLSearchParams({
    nonce: encryptedSignature.nonce,
    data: encryptedSignature.data,
  }));
  assert.deepEqual(signatureResponse, { signature: 'signed-message-base58' });

  const solflareState = createMobileWalletDeepLinkState({
    providerId: 'solflare',
    returnTo: '/',
    authToken: null,
  });
  const solflareConnectUrl = new URL(buildMobileWalletConnectUrl({
    state: solflareState,
    appUrl: 'https://slopheroes.xyz',
    redirectLink: 'https://api.slopheroes.xyz/auth/mobile-wallet/solflare/connect?state=test-state',
  }));
  assert.equal(solflareConnectUrl.origin + solflareConnectUrl.pathname, 'https://solflare.com/ul/v1/connect');
}

function runMobileWalletHandoffPageTests(): void {
  assert.deepEqual(buildMobileWalletHandoffResponse({
    success: true,
    providerId: 'phantom',
  }), {
    action: 'handoff',
    status: 'success',
    providerId: 'phantom',
  });
  assert.deepEqual(buildMobileWalletHandoffResponse({
    success: false,
    providerId: 'solflare',
    errorCode: 'wallet_denied',
  }), {
    action: 'handoff',
    status: 'error',
    providerId: 'solflare',
    errorCode: 'wallet_denied',
  });

  const successPage = buildMobileWalletHandoffPage({
    success: true,
    providerId: 'phantom',
  });
  assert.match(successPage, /role="dialog"/);
  assert.match(successPage, /aria-modal="true"/);
  assert.match(successPage, /Return to Slop Heroes/);
  assert.match(successPage, /Close this Phantom browser/);
  assert.match(successPage, /Open Slop Heroes from your Home Screen/);
  assert.doesNotMatch(successPage, /<a\b/i, 'handoff dialog must not offer browser navigation');
  assert.doesNotMatch(successPage, /<button\b/i, 'handoff dialog must not be dismissible');

  const errorPage = buildMobileWalletHandoffPage({
    success: false,
    providerId: 'solflare',
    errorCode: 'wallet_denied',
  });
  assert.match(errorPage, /Wallet sign-in didn’t finish/);
  assert.match(errorPage, /The wallet request was canceled/);
  assert.match(errorPage, /Close this Solflare browser/);
}

async function runMobileWalletHandoffTests(): Promise<void> {
  forceLocalMobileWalletDeepLinkStoreForTests();

  try {
    // handoff flag defaults off and survives the store round-trip when set
    const plainState = createMobileWalletDeepLinkState({
      providerId: 'phantom',
      returnTo: '/',
      authToken: null,
    });
    assert.equal(plainState.handoff, undefined);

    const handoffState = createMobileWalletDeepLinkState({
      providerId: 'phantom',
      returnTo: '/lobby',
      authToken: null,
      handoff: true,
    });
    assert.equal(handoffState.handoff, true);

    await storeMobileWalletDeepLinkState(handoffState);
    const readState = await readMobileWalletDeepLinkState(handoffState.id);
    assert.ok(readState, 'handoff state should be readable');
    assert.equal(readState.handoff, true);
    assert.equal(readState.returnTo, '/lobby');

    // success result: single-use consume
    const stored = await storeMobileWalletHandoffResult({
      stateId: handoffState.id,
      status: 'success',
      sessionToken: 'session-jwt',
      sessionKind: 'auth',
      payload: { authenticated: true, isNewUser: false, provider: 'wallet' },
      createdAt: Date.now(),
    });
    assert.equal(stored, true);

    const consumed = await consumeMobileWalletHandoffResult(handoffState.id);
    assert.ok(consumed, 'handoff result should be consumable once');
    assert.equal(consumed.status, 'success');
    assert.equal(consumed.sessionToken, 'session-jwt');
    assert.equal(consumed.sessionKind, 'auth');
    assert.deepEqual(consumed.payload, { authenticated: true, isNewUser: false, provider: 'wallet' });

    const consumedAgain = await consumeMobileWalletHandoffResult(handoffState.id);
    assert.equal(consumedAgain, null, 'handoff result must be single-use');

    // error result round-trip
    await storeMobileWalletHandoffResult({
      stateId: 'error-state',
      status: 'error',
      errorCode: 'wallet_denied',
      createdAt: Date.now(),
    });
    const errorResult = await consumeMobileWalletHandoffResult('error-state');
    assert.ok(errorResult);
    assert.equal(errorResult.status, 'error');
    assert.equal(errorResult.errorCode, 'wallet_denied');

    // expiry: a result stored in the past is not claimable
    const staleStoredAt = Date.now() - MOBILE_WALLET_HANDOFF_TTL_MS - 1;
    await storeMobileWalletHandoffResult({
      stateId: 'stale-state',
      status: 'success',
      sessionToken: 'stale-jwt',
      sessionKind: 'pending',
      createdAt: staleStoredAt,
    }, staleStoredAt);
    const staleResult = await consumeMobileWalletHandoffResult('stale-state');
    assert.equal(staleResult, null, 'expired handoff result must not be claimable');

    // unknown state id
    assert.equal(await consumeMobileWalletHandoffResult('missing-state'), null);
  } finally {
    resetMobileWalletDeepLinkStoreForTests();
  }
}

runMobileWalletDeepLinkTests();
runMobileWalletHandoffPageTests();
runMobileWalletHandoffTests()
  .then(() => {
    console.log('mobile-wallet-deeplink tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
