import assert from 'node:assert/strict';
import { getRoomPopulationCounts } from '../rooms/roomPopulation';

const counts = getRoomPopulationCounts({
  players: [
    { id: 'human-a', isBot: false },
    { id: 'human-b' },
    { id: 'bot-a', isBot: true },
    { id: 'npc-a', isBot: true },
    { id: 'npc-b', isBot: false },
  ],
  npcIds: new Set(['npc-a', 'npc-b']),
  observerCount: 2,
});

assert.deepEqual(counts, {
  humanCount: 2,
  botCount: 1,
  observerCount: 2,
  npcCount: 2,
  participantCount: 3,
  entityCount: 5,
});

assert.deepEqual(
  getRoomPopulationCounts({
    players: [],
    npcIds: new Set(),
    observerCount: -2,
  }),
  {
    humanCount: 0,
    botCount: 0,
    observerCount: 0,
    npcCount: 0,
    participantCount: 0,
    entityCount: 0,
  }
);

assert.equal(
  getRoomPopulationCounts({
    players: [{ id: 'npc-human', isBot: false }],
    npcIds: new Set(['npc-human']),
    observerCount: 0,
  }).humanCount,
  0
);

console.log('room population tests passed');
