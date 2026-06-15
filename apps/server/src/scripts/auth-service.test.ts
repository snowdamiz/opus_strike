import assert from 'node:assert/strict';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'auth-service-test-secret';

type SessionModule = typeof import('../auth/session');
type OAuthStateModule = typeof import('../auth/oauthState');
type ReturnToModule = typeof import('../auth/returnTo');
type RateLimitModule = typeof import('../auth/rateLimit');

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
  assert.equal(verifyPendingAuthToken(legacyPendingToken), null);
}

function makeRateLimitRequest(ip: string, forwardedFor: string): Request {
  return {
    ip,
    socket: { remoteAddress: ip },
    headers: { 'x-forwarded-for': forwardedFor },
  } as unknown as Request;
}

function testRateLimitIdentity(rateLimit: RateLimitModule): void {
  rateLimit.clearRateLimitBucketsForTests();

  const first = rateLimit.consumeRateLimit(makeRateLimitRequest('10.0.0.5', '198.51.100.10'), {
    keyPrefix: 'auth-test',
    limit: 1,
    windowMs: 60_000,
  });
  assert.deepEqual(first, { ok: true });

  const spoofedForwardedFor = rateLimit.consumeRateLimit(makeRateLimitRequest('10.0.0.5', '203.0.113.20'), {
    keyPrefix: 'auth-test',
    limit: 1,
    windowMs: 60_000,
  });
  assert.equal(spoofedForwardedFor.ok, false, 'x-forwarded-for must not bypass IP rate limits');
}

async function main(): Promise<void> {
  const [session, oauthState, returnTo, rateLimit] = await Promise.all([
    import('../auth/session'),
    import('../auth/oauthState'),
    import('../auth/returnTo'),
    import('../auth/rateLimit'),
  ]);

  testReturnToValidation(returnTo);
  testOAuthStateLifecycle(oauthState);
  testSessionTokens(session);
  testRateLimitIdentity(rateLimit);

  console.log('auth-service tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
