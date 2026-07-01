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
});

assert.deepEqual(counts, {
  humanCount: 2,
  combatHumanCount: 2,
  regularObserverCount: 0,
  botCount: 1,
  npcCount: 2,
  participantCount: 3,
  entityCount: 5,
});

assert.deepEqual(
  getRoomPopulationCounts({
    players: [],
    npcIds: new Set(),
  }),
  {
    humanCount: 0,
    combatHumanCount: 0,
    regularObserverCount: 0,
    botCount: 0,
    npcCount: 0,
    participantCount: 0,
    entityCount: 0,
  }
);

assert.equal(
  getRoomPopulationCounts({
    players: [{ id: 'npc-human', isBot: false }],
    npcIds: new Set(['npc-human']),
  }).humanCount,
  0
);

assert.deepEqual(
  getRoomPopulationCounts({
    players: [
      { id: 'combat-human', isBot: false, role: 'player' },
      { id: 'regular-observer', isBot: false, role: 'observer' },
      { id: 'combat-human-default' },
    ],
    npcIds: new Set(),
  }),
  {
    humanCount: 3,
    combatHumanCount: 2,
    regularObserverCount: 1,
    botCount: 0,
    npcCount: 0,
    participantCount: 3,
    entityCount: 3,
  }
);

console.log('room population tests passed');
