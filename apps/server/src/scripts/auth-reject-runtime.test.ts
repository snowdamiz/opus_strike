import assert from 'node:assert/strict';
import {
  buildAuthRejectRecord,
  getAuthRejectSeverity,
} from '../rooms/authRejectRuntime';

{
  assert.equal(getAuthRejectSeverity('direct_join_disabled'), 'critical');
  assert.equal(getAuthRejectSeverity('entry_ticket_nonce_replay'), 'critical');
  assert.equal(getAuthRejectSeverity('invalid_entry_ticket'), 'high');
  assert.equal(getAuthRejectSeverity('account_banned'), 'high');
}

{
  assert.deepEqual(buildAuthRejectRecord({
    reason: 'entry_ticket_nonce_replay',
    userId: 'user-a',
    playerSessionId: 'session-a',
    details: { lobbyId: 'lobby-a' },
  }), {
    eventType: 'auth.entry_ticket_nonce_replay',
    category: 'auth',
    source: 'game_room_auth',
    userId: 'user-a',
    playerSessionId: 'session-a',
    severity: 'critical',
    confidence: 0.98,
    reason: 'entry_ticket_nonce_replay',
    details: { lobbyId: 'lobby-a' },
    retentionClass: 'extended',
  });
}

{
  assert.deepEqual(buildAuthRejectRecord({
    reason: 'invalid_entry_ticket',
    userId: null,
    playerSessionId: 'session-a',
  }), {
    eventType: 'auth.invalid_entry_ticket',
    category: 'auth',
    source: 'game_room_auth',
    userId: null,
    playerSessionId: 'session-a',
    severity: 'high',
    confidence: 0.98,
    reason: 'invalid_entry_ticket',
    details: {},
    retentionClass: 'extended',
  });
}

console.log('auth reject runtime tests passed');
