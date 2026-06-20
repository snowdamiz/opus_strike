import assert from 'node:assert/strict';
import {
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  buildLobbyChatPayload,
  buildRoomChatPayload,
  getRoomChatRecipientIds,
  normalizeLobbyChatMessage,
  normalizeRoomChatMessage,
} from '../rooms/roomChatRuntime';

{
  assert.equal(normalizeRoomChatMessage(''), null);
  assert.equal(normalizeRoomChatMessage('   \t\n  '), null);
}

{
  assert.equal(normalizeRoomChatMessage('  hold spacing  '), '  hold spacing  ');

  const longMessage = 'x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 12);
  assert.equal(normalizeRoomChatMessage(longMessage), 'x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH));
}

{
  assert.equal(normalizeLobbyChatMessage(''), null);
  assert.equal(normalizeLobbyChatMessage('   \t\n  '), null);
  assert.equal(normalizeLobbyChatMessage('  trim spacing  '), 'trim spacing');

  const longMessage = ` ${'x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 12)} `;
  assert.equal(normalizeLobbyChatMessage(longMessage), 'x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH));
}

{
  const players = new Map([
    ['red-a', { team: 'red' }],
    ['red-b', { team: 'red' }],
    ['blue-a', { team: 'blue' }],
    ['spectator-a', { team: 'spectating' }],
  ]);

  assert.deepEqual(getRoomChatRecipientIds({
    players,
    senderTeam: 'red',
    teamOnly: true,
  }), ['red-a', 'red-b']);

  assert.deepEqual(getRoomChatRecipientIds({
    players,
    senderTeam: 'red',
    teamOnly: false,
  }), ['red-a', 'red-b', 'blue-a', 'spectator-a']);

  assert.deepEqual(getRoomChatRecipientIds({
    players,
    senderTeam: null,
    teamOnly: true,
  }), []);
}

{
  assert.deepEqual(
    buildRoomChatPayload({
      playerId: 'player-1',
      playerName: 'Player One',
      message: 'hello squad',
      teamOnly: true,
      timestamp: 12_345,
    }),
    {
      playerId: 'player-1',
      playerName: 'Player One',
      message: 'hello squad',
      teamOnly: true,
      timestamp: 12_345,
    }
  );

  assert.equal(
    buildRoomChatPayload({
      playerId: 'player-1',
      playerName: 'Player One',
      message: '   ',
      teamOnly: false,
      timestamp: 12_345,
    }),
    null
  );
}

{
  assert.deepEqual(
    buildLobbyChatPayload({
      playerId: 'player-2',
      playerName: 'Player Two',
      message: '  hello lobby  ',
      timestamp: 67_890,
    }),
    {
      playerId: 'player-2',
      playerName: 'Player Two',
      message: 'hello lobby',
      timestamp: 67_890,
    }
  );

  assert.equal(
    buildLobbyChatPayload({
      playerId: 'player-2',
      playerName: 'Player Two',
      message: '   ',
      timestamp: 67_890,
    }),
    null
  );
}

console.log('room chat runtime tests passed');
