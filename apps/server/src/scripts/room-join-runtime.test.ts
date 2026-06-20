import assert from 'node:assert/strict';
import {
  resolveRoomJoinPlayerName,
  shouldActivateJoinedPlayer,
  shouldRejectRoomJoinForCapacity,
} from '../rooms/roomJoinRuntime';

{
  assert.equal(shouldRejectRoomJoinForCapacity({
    playerCount: 8,
    maxPlayers: 8,
  }), true);
  assert.equal(shouldRejectRoomJoinForCapacity({
    playerCount: 7,
    maxPlayers: 8,
  }), false);
}

{
  assert.equal(resolveRoomJoinPlayerName({
    ticketDisplayName: 'Ticket Name',
    authDisplayName: 'Auth Name',
    playerNumber: 3,
  }), 'Ticket Name');
  assert.equal(resolveRoomJoinPlayerName({
    ticketDisplayName: '',
    authDisplayName: 'Auth Name',
    playerNumber: 3,
  }), 'Auth Name');
  assert.equal(resolveRoomJoinPlayerName({
    ticketDisplayName: null,
    authDisplayName: '',
    playerNumber: 3,
  }), 'Player3');
}

{
  assert.equal(shouldActivateJoinedPlayer({
    phase: 'countdown',
    heroId: 'phantom',
  }), true);
  assert.equal(shouldActivateJoinedPlayer({
    phase: 'playing',
    heroId: 'blaze',
  }), true);
  assert.equal(shouldActivateJoinedPlayer({
    phase: 'deployment',
    heroId: 'chronos',
  }), true);
  assert.equal(shouldActivateJoinedPlayer({
    phase: 'hero_select',
    heroId: 'phantom',
  }), false);
  assert.equal(shouldActivateJoinedPlayer({
    phase: 'playing',
    heroId: '',
  }), false);
}

console.log('room join runtime tests passed');
