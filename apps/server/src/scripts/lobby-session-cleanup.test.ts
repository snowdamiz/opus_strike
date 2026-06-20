import assert from 'node:assert/strict';
import { cleanupLobbySession } from '../rooms/lobbySessionCleanup';

function cleanupFixture() {
  const clearedScopes: string[] = [];
  const players = new Map([['old-session', { name: 'Old' }]]);
  const playerAuthContexts = new Map([['old-session', { userId: 'user-a' }]]);
  const playerMatchmakingTickets = new Map([['old-session', { ticket: true }]]);
  const playerCompetitiveRatings = new Map([['old-session', 800]]);
  const sessionIdToIdentity = new Map([['old-session', 'user-a']]);
  const identityToSessionId = new Map([['user-a', 'old-session']]);
  const mapVoteSession = {
    votes: new Map([['old-session', 'map_1']]),
    previewReadyPlayerIds: new Set(['old-session']),
  };

  return {
    clearedScopes,
    players,
    playerAuthContexts,
    playerMatchmakingTickets,
    playerCompetitiveRatings,
    sessionIdToIdentity,
    identityToSessionId,
    mapVoteSession,
  };
}

{
  const fixture = cleanupFixture();
  const result = cleanupLobbySession({
    sessionId: 'old-session',
    players: fixture.players,
    playerAuthContexts: fixture.playerAuthContexts,
    playerMatchmakingTickets: fixture.playerMatchmakingTickets,
    playerCompetitiveRatings: fixture.playerCompetitiveRatings,
    sessionIdToIdentity: fixture.sessionIdToIdentity,
    identityToSessionId: fixture.identityToSessionId,
    mapVoteSession: fixture.mapVoteSession,
    clearRateLimitScope: (scope) => fixture.clearedScopes.push(scope),
  });

  assert.deepEqual(result, {
    removedPlayer: true,
    removedVote: true,
    removedPreviewReady: true,
    identity: 'user-a',
    removedIdentityMapping: true,
  });
  assert.equal(fixture.players.has('old-session'), false);
  assert.equal(fixture.playerAuthContexts.has('old-session'), false);
  assert.equal(fixture.playerMatchmakingTickets.has('old-session'), false);
  assert.equal(fixture.playerCompetitiveRatings.has('old-session'), false);
  assert.equal(fixture.sessionIdToIdentity.has('old-session'), false);
  assert.equal(fixture.identityToSessionId.has('user-a'), false);
  assert.equal(fixture.mapVoteSession.votes.has('old-session'), false);
  assert.equal(fixture.mapVoteSession.previewReadyPlayerIds.has('old-session'), false);
  assert.deepEqual(fixture.clearedScopes, ['old-session']);
}

{
  const fixture = cleanupFixture();
  fixture.identityToSessionId.set('user-a', 'new-session');

  const result = cleanupLobbySession({
    sessionId: 'old-session',
    players: fixture.players,
    playerAuthContexts: fixture.playerAuthContexts,
    playerMatchmakingTickets: fixture.playerMatchmakingTickets,
    playerCompetitiveRatings: fixture.playerCompetitiveRatings,
    sessionIdToIdentity: fixture.sessionIdToIdentity,
    identityToSessionId: fixture.identityToSessionId,
    mapVoteSession: fixture.mapVoteSession,
    clearRateLimitScope: (scope) => fixture.clearedScopes.push(scope),
  });

  assert.equal(result.identity, 'user-a');
  assert.equal(result.removedIdentityMapping, false);
  assert.equal(fixture.identityToSessionId.get('user-a'), 'new-session');
  assert.equal(fixture.sessionIdToIdentity.has('old-session'), false);
}

{
  const fixture = cleanupFixture();
  const result = cleanupLobbySession({
    sessionId: 'missing-session',
    players: fixture.players,
    playerAuthContexts: fixture.playerAuthContexts,
    playerMatchmakingTickets: fixture.playerMatchmakingTickets,
    playerCompetitiveRatings: fixture.playerCompetitiveRatings,
    sessionIdToIdentity: fixture.sessionIdToIdentity,
    identityToSessionId: fixture.identityToSessionId,
    mapVoteSession: null,
    clearRateLimitScope: (scope) => fixture.clearedScopes.push(scope),
  });

  assert.deepEqual(result, {
    removedPlayer: false,
    removedVote: false,
    removedPreviewReady: false,
    identity: undefined,
    removedIdentityMapping: false,
  });
  assert.deepEqual(fixture.clearedScopes, ['missing-session']);
}

console.log('lobby session cleanup tests passed');
