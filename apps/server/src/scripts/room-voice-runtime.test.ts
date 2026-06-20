import assert from 'node:assert/strict';
import {
  normalizeVoiceTeam,
  prepareMatchVoiceTokenRequest,
  type VoiceTokenPlayerSnapshot,
} from '../rooms/roomVoiceRuntime';

const player: VoiceTokenPlayerSnapshot = {
  name: 'Player A',
  team: 'red',
  state: 'alive',
  isBot: false,
};

{
  assert.equal(normalizeVoiceTeam('red'), 'red');
  assert.equal(normalizeVoiceTeam('blue'), 'blue');
  assert.equal(normalizeVoiceTeam(''), null);
  assert.equal(normalizeVoiceTeam('spectator'), null);
}

{
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: null,
    player,
    identity: 'user-a',
  }), {
    ok: false,
    requestId: 'invalid',
    reason: 'invalid voice token request',
  });
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: { requestId: 'voice-1', scope: 'party' },
    player,
    identity: 'user-a',
  }), {
    ok: false,
    requestId: 'voice-1',
    reason: 'unsupported voice scope',
  });
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: { requestId: 'voice-1' },
    player: null,
    identity: 'user-a',
  }), {
    ok: false,
    requestId: 'voice-1',
    reason: 'not in game room',
  });
}

{
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: { requestId: 'voice-1' },
    player: { ...player, isBot: true },
    identity: 'user-a',
  }), {
    ok: false,
    requestId: 'voice-1',
    reason: 'bots cannot join voice',
  });
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: { requestId: 'voice-1' },
    player: { ...player, team: '' },
    identity: 'user-a',
  }), {
    ok: false,
    requestId: 'voice-1',
    reason: 'player has no voice team',
  });
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: { requestId: 'voice-1' },
    player,
    identity: null,
  }), {
    ok: false,
    requestId: 'voice-1',
    reason: 'Authentication required',
  });
}

{
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: { requestId: ' voice-1 ', scope: 'match' },
    player,
    identity: 'user-a',
  }), {
    ok: true,
    requestId: 'voice-1',
    identity: 'user-a',
    displayName: 'Player A',
    team: 'red',
    human: true,
    canPublish: true,
  });
  assert.deepEqual(prepareMatchVoiceTokenRequest({
    payload: { requestId: 'voice-1' },
    player: { ...player, state: 'spectating' },
    identity: 'user-a',
  }), {
    ok: true,
    requestId: 'voice-1',
    identity: 'user-a',
    displayName: 'Player A',
    team: 'red',
    human: true,
    canPublish: false,
  });
}

console.log('room voice runtime tests passed');
