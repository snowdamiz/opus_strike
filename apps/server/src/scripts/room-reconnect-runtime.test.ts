import assert from 'node:assert/strict';
import {
  buildReconnectParticipantSyncPayload,
  buildRunningGameReconnectTicketRequest,
  canAcceptRunningGameReconnect,
} from '../rooms/roomReconnectRuntime';

{
  assert.equal(canAcceptRunningGameReconnect({
    lobbyId: null,
    matchCancelled: false,
    phase: 'playing',
  }), false);
  assert.equal(canAcceptRunningGameReconnect({
    lobbyId: 'lobby-a',
    matchCancelled: true,
    phase: 'playing',
  }), false);
  assert.equal(canAcceptRunningGameReconnect({
    lobbyId: 'lobby-a',
    matchCancelled: false,
    phase: 'game_end',
  }), false);
  assert.equal(canAcceptRunningGameReconnect({
    lobbyId: 'lobby-a',
    matchCancelled: false,
    phase: 'playing',
  }), true);
}

{
  const base = {
    reconnectToRunningGame: true,
    userId: 'user-a',
    lobbyId: 'lobby-a',
    gameRoomId: 'room-a',
    matchCancelled: false,
    phase: 'playing' as const,
    now: 5_000,
  };

  assert.equal(buildRunningGameReconnectTicketRequest({ ...base, reconnectToRunningGame: false }), null);
  assert.equal(buildRunningGameReconnectTicketRequest({ ...base, lobbyId: null }), null);
  assert.equal(buildRunningGameReconnectTicketRequest({ ...base, matchCancelled: true }), null);
  assert.equal(buildRunningGameReconnectTicketRequest({ ...base, phase: 'game_end' }), null);
  assert.deepEqual(buildRunningGameReconnectTicketRequest(base), {
    userId: 'user-a',
    lobbyId: 'lobby-a',
    gameRoomId: 'room-a',
    issuedAt: 5_000,
    ttlMs: 60_000,
  });
}

{
  assert.deepEqual(
    buildReconnectParticipantSyncPayload({
      id: 'session-a',
      name: 'Player A',
      team: 'red',
      heroId: 'phantom',
    }),
    {
      sessionId: 'session-a',
      displayName: 'Player A',
      assignedTeam: 'red',
      selectedHero: 'phantom',
      observer: false,
    }
  );
  assert.deepEqual(
    buildReconnectParticipantSyncPayload({
      id: 'session-b',
      name: null,
      team: 'blue',
      heroId: 'unknown',
    }),
    {
      sessionId: 'session-b',
      displayName: null,
      assignedTeam: 'blue',
      selectedHero: undefined,
      observer: false,
    }
  );
}

console.log('room reconnect runtime tests passed');
