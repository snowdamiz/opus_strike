import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'auth-service-test-secret';

type SessionModule = typeof import('../auth/session');
type OAuthStateModule = typeof import('../auth/oauthState');
type ReturnToModule = typeof import('../auth/returnTo');

function testReturnToValidation(returnTo: ReturnToModule): void {
  const { appendAuthStatus, sanitizeReturnTo } = returnTo;

  assert.equal(sanitizeReturnTo('/play?tab=lobbies#top'), '/play?tab=lobbies#top');
  assert.equal(sanitizeReturnTo('https://evil.example/play'), '/');
  assert.equal(sanitizeReturnTo('//evil.example/play'), '/');
  assert.equal(sanitizeReturnTo('/\\evil'), '/');
  assert.equal(
    appendAuthStatus('/play?tab=lobbies#top', { auth: 'success', provider: 'discord' }),
    '/play?tab=lobbies&auth=success&provider=discord#top'
  );
}

function testOAuthStateLifecycle(oauthState: OAuthStateModule): void {
  const {
    clearOAuthStatesForTests,
    consumeOAuthState,
    createOAuthState,
    expireOAuthStateForTests,
  } = oauthState;

  clearOAuthStatesForTests();

  const record = createOAuthState({
    provider: 'discord',
    mode: 'login',
    returnTo: '/play',
  });

  assert.equal(record.provider, 'discord');
  assert.equal(record.mode, 'login');
  assert.equal(record.returnTo, '/play');
  assert.ok(record.state.length >= 32);

  const firstConsume = consumeOAuthState(record.state);
  assert.equal(firstConsume.ok, true);

  const secondConsume = consumeOAuthState(record.state);
  assert.deepEqual(secondConsume, { ok: false, reason: 'used' });

  const expiredRecord = createOAuthState({
    provider: 'discord',
    mode: 'link',
    returnTo: '/settings',
    linkUserId: 'user_1',
  });
  expireOAuthStateForTests(expiredRecord.state);
  assert.deepEqual(consumeOAuthState(expiredRecord.state), { ok: false, reason: 'expired' });
  assert.deepEqual(consumeOAuthState('missing'), { ok: false, reason: 'missing' });
}

function testSessionTokens(session: SessionModule): void {
  const {
    createAuthToken,
    createPendingAuthToken,
    verifyAuthToken,
    verifyPendingAuthToken,
  } = session;

  const authToken = createAuthToken({
    userId: 'user_discord',
    provider: 'discord',
  });
  assert.deepEqual(verifyAuthToken(authToken), {
    userId: 'user_discord',
    sessionVersion: 1,
    provider: 'discord',
    walletAddress: undefined,
    pending: false,
  });

  const pendingDiscordToken = createPendingAuthToken({
    provider: 'discord',
    providerAccountId: '123456789',
    displayName: 'Snow',
    avatarUrl: 'https://cdn.discordapp.com/avatar.png',
    emailHash: 'hash',
  });
  assert.deepEqual(verifyPendingAuthToken(pendingDiscordToken), {
    pending: true,
    provider: 'discord',
    providerAccountId: '123456789',
    displayName: 'Snow',
    avatarUrl: 'https://cdn.discordapp.com/avatar.png',
    emailHash: 'hash',
    walletAddress: null,
  });

  const legacyWalletToken = jwt.sign(
    { userId: 'user_phantom', walletAddress: 'wallet_123' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );
  assert.deepEqual(verifyAuthToken(legacyWalletToken), {
    userId: 'user_phantom',
    sessionVersion: 0,
    provider: undefined,
    walletAddress: 'wallet_123',
    pending: false,
  });

  const legacyPendingToken = jwt.sign(
    { pending: true, walletAddress: 'wallet_123' },
    process.env.JWT_SECRET!,
    { expiresIn: '1h' }
  );
  assert.deepEqual(verifyPendingAuthToken(legacyPendingToken), {
    pending: true,
    provider: 'phantom',
    providerAccountId: 'wallet_123',
    walletAddress: 'wallet_123',
    displayName: 'wallet_123',
    avatarUrl: null,
    emailHash: null,
  });
}

async function main(): Promise<void> {
  const [session, oauthState, returnTo] = await Promise.all([
    import('../auth/session'),
    import('../auth/oauthState'),
    import('../auth/returnTo'),
  ]);

  testReturnToValidation(returnTo);
  testOAuthStateLifecycle(oauthState);
  testSessionTokens(session);

  console.log('auth-service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
