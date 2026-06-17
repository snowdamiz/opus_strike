import assert from 'node:assert/strict';
import type { RoomAuthContext } from '../auth/session';
import type { GameEntryTicketClaims } from '../security/entryTickets';
import { RoomParticipantRegistry } from '../rooms/roomParticipantRegistry';

function auth(userId: string): RoomAuthContext {
  return {
    userId,
    displayName: userId,
  } as RoomAuthContext;
}

function ticket(input: Partial<GameEntryTicketClaims> = {}): GameEntryTicketClaims {
  return {
    version: 1,
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    lobbyPlayerId: 'lobby-player-a',
    userId: 'user-a',
    displayName: 'User A',
    assignedTeam: 'red',
    selectedHero: 'phantom',
    issuedAt: 1_000,
    expiresAt: 2_000,
    nonce: 'nonce-a',
    ...input,
  };
}

{
  const registry = new RoomParticipantRegistry();

  registry.setSession('session-a', auth('user-a'));
  assert.equal(registry.getAuthUserId('session-a'), 'user-a');
  assert.equal(registry.getDurableUserId('session-a'), 'user-a');
  assert.equal(registry.hasEntryTicket('session-a'), false);
  assert.deepEqual(Array.from(registry.getAuthContexts()).map((context) => context.userId), ['user-a']);

  registry.clearSession('session-a');
  assert.equal(registry.getAuthUserId('session-a'), undefined);
  assert.equal(registry.getDurableUserId('session-a'), null);
}

{
  const registry = new RoomParticipantRegistry();

  registry.setSession('session-a', auth('auth-user'), ticket({ userId: 'ticket-user' }));
  assert.equal(registry.hasEntryTicket('session-a'), true);
  assert.equal(registry.getDurableUserId('session-a'), 'auth-user');
}

{
  const registry = new RoomParticipantRegistry();
  const originalTicket = ticket();

  registry.rememberReconnectParticipant(originalTicket);
  assert.deepEqual(registry.getReconnectIdentityKeys(), ['user-a']);
  assert.deepEqual(
    registry.createRunningGameReconnectTicket({
      userId: 'user-a',
      lobbyId: 'lobby-a',
      gameRoomId: 'game-a',
      issuedAt: 5_000,
      ttlMs: 60_000,
    }),
    {
      version: 1,
      lobbyId: 'lobby-a',
      gameRoomId: 'game-a',
      lobbyPlayerId: 'lobby-player-a',
      userId: 'user-a',
      displayName: 'User A',
      assignedTeam: 'red',
      selectedHero: 'phantom',
      observer: undefined,
      issuedAt: 5_000,
      expiresAt: 65_000,
      nonce: 'reconnect:user-a:5000',
    }
  );

  assert.equal(registry.createRunningGameReconnectTicket({
    userId: 'missing-user',
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    issuedAt: 5_000,
    ttlMs: 60_000,
  }), null);
}

{
  const registry = new RoomParticipantRegistry();

  registry.rememberReconnectParticipant(ticket({ observer: true }));
  registry.setSession('session-a', auth('user-a'));
  registry.syncReconnectParticipant({
    sessionId: 'session-a',
    displayName: 'Renamed',
    assignedTeam: 'blue',
    selectedHero: 'hookshot',
    observer: false,
  });

  const reconnectTicket = registry.createRunningGameReconnectTicket({
    userId: 'user-a',
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    issuedAt: 8_000,
    ttlMs: 1_000,
  });

  assert.equal(reconnectTicket?.displayName, 'Renamed');
  assert.equal(reconnectTicket?.assignedTeam, 'blue');
  assert.equal(reconnectTicket?.selectedHero, 'hookshot');
  assert.equal(reconnectTicket?.observer, undefined);
}

console.log('room participant registry tests passed');
