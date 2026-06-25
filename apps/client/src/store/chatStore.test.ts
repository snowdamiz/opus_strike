import assert from 'node:assert/strict';
import { parseIncomingChatMessage, useChatStore } from './chatStore';

{
  assert.equal(parseIncomingChatMessage('game', null), null);
  assert.equal(parseIncomingChatMessage('game', { message: '   ' }), null);
}

{
  const parsed = parseIncomingChatMessage('game', {
    playerId: 'player-1',
    playerName: '  Player   One  ',
    message: '  hello   lobby  ',
    teamOnly: true,
    timestamp: 1234,
  });

  assert.deepEqual(parsed && {
    scope: parsed.scope,
    playerId: parsed.playerId,
    playerName: parsed.playerName,
    message: parsed.message,
    teamOnly: parsed.teamOnly,
    timestamp: parsed.timestamp,
  }, {
    scope: 'game',
    playerId: 'player-1',
    playerName: 'Player One',
    message: 'hello lobby',
    teamOnly: true,
    timestamp: 1234,
  });
}

{
  const store = useChatStore.getState();
  store.clearMessages();

  for (let index = 0; index < 85; index += 1) {
    useChatStore.getState().addIncomingMessage('game', {
      playerId: `player-${index}`,
      playerName: 'Player',
      message: `message-${index}`,
      timestamp: index + 1,
    });
  }

  const messages = useChatStore.getState().messages;
  assert.equal(messages.length, 80);
  assert.equal(messages[0].message, 'message-5');
  assert.equal(messages[79].message, 'message-84');
  useChatStore.getState().clearMessages();
}

console.log('chat store tests passed');
