import assert from 'node:assert/strict';
import {
  ALL_HERO_IDS,
  type HeroId,
} from '@voxel-strike/shared';
import {
  getRoomHeroLockParticipants,
  isPlayerTeamHeroAvailable,
  selectAvailableRoomHero,
  type RoomHeroLockParticipant,
} from '../rooms/roomHeroSelection';

function participant(
  id: string,
  team: string | null,
  heroId: string | null
): RoomHeroLockParticipant {
  return { id, team, heroId };
}

const firstHero = ALL_HERO_IDS[0] as HeroId;
const secondHero = ALL_HERO_IDS[1] as HeroId;
const thirdHero = ALL_HERO_IDS[2] as HeroId;

{
  const players = [
    participant('red-human', 'red', firstHero),
    participant('red-npc', 'red', secondHero),
    participant('blue-human', 'blue', firstHero),
  ];

  assert.deepEqual(
    getRoomHeroLockParticipants(players, new Set(['red-npc'])),
    [
      participant('red-human', 'red', firstHero),
      participant('blue-human', 'blue', firstHero),
    ]
  );
}

{
  const players = [
    participant('red-phantom', 'red', firstHero),
    participant('red-blaze', 'red', secondHero),
    participant('blue-phantom', 'blue', firstHero),
  ];

  assert.equal(isPlayerTeamHeroAvailable({
    players,
    team: 'red',
    heroId: firstHero,
    playerId: 'new-red',
  }), false);
  assert.equal(isPlayerTeamHeroAvailable({
    players,
    team: 'red',
    heroId: firstHero,
    playerId: 'red-phantom',
  }), true);
  assert.equal(isPlayerTeamHeroAvailable({
    players,
    team: 'blue',
    heroId: secondHero,
    playerId: 'new-blue',
  }), true);
  assert.equal(isPlayerTeamHeroAvailable({
    players,
    team: 'spectator',
    heroId: firstHero,
    playerId: 'observer',
  }), true);
}

{
  const players = [
    participant('red-first', 'red', firstHero),
    participant('red-third', 'red', thirdHero),
  ];

  assert.equal(selectAvailableRoomHero({
    players,
    team: 'red',
    playerId: 'new-red',
    random: () => 0,
  }), secondHero);
}

{
  const players = ALL_HERO_IDS.map((heroId, index) => participant(`red-${index}`, 'red', heroId));

  assert.equal(selectAvailableRoomHero({
    players,
    team: 'red',
    playerId: 'new-red',
    random: () => 0,
  }), 'phantom');
}

{
  const randomIndex = Math.floor(0.75 * ALL_HERO_IDS.length);
  assert.equal(selectAvailableRoomHero({
    players: [],
    team: 'observer',
    playerId: 'observer',
    random: () => 0.75,
  }), ALL_HERO_IDS[randomIndex] ?? 'phantom');
}

console.log('room hero selection tests passed');
