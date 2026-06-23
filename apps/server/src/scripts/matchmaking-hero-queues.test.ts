import assert from 'node:assert/strict';
import type { HeroId, Team } from '@voxel-strike/shared';
import {
  buildMatchmakingHeroQueueState,
  readMatchmakingHeroQueueStateFromMetadata,
  resolveMatchmakingHeroTeam,
} from '../matchmaking/heroQueues';

const teamIds: Team[] = ['red', 'blue'];

const queueState = buildMatchmakingHeroQueueState({
  teamIds,
  players: [
    { id: 'red-phantom', team: 'red', heroId: 'phantom' },
    { id: 'red-invalid', team: 'red', heroId: 'not-a-hero' },
    { id: 'blue-hookshot', team: 'blue', heroId: 'hookshot' },
    { id: 'spectator', team: '', heroId: 'blaze' },
  ],
});

assert.deepEqual(queueState.teamCounts, { red: 2, blue: 1 });
assert.deepEqual(queueState.teamHeroIds, {
  red: ['phantom'],
  blue: ['hookshot'],
});

assert.equal(resolveMatchmakingHeroTeam({
  teamIds,
  maxTeamSize: 4,
  teamCounts: { red: 1, blue: 1 },
  teamHeroIds: { red: ['phantom'], blue: ['hookshot'] },
  selectedHero: 'phantom',
}), 'blue');

assert.equal(resolveMatchmakingHeroTeam({
  teamIds,
  maxTeamSize: 4,
  teamCounts: { red: 1, blue: 1 },
  teamHeroIds: { red: ['phantom'], blue: ['phantom'] },
  selectedHero: 'phantom',
}), null);

assert.equal(resolveMatchmakingHeroTeam({
  teamIds,
  maxTeamSize: 4,
  teamCounts: { red: 1, blue: 0 },
  teamHeroIds: { red: ['phantom'], blue: [] },
  selectedHero: 'phantom',
}), 'blue');

assert.equal(resolveMatchmakingHeroTeam({
  teamIds,
  maxTeamSize: 4,
  teamCounts: { red: 1, blue: 0 },
  teamHeroIds: { red: ['hookshot'], blue: [] },
  selectedHero: 'phantom',
  preferredTeam: 'red',
  requirePreferredTeam: true,
}), 'red');

assert.equal(resolveMatchmakingHeroTeam({
  teamIds,
  maxTeamSize: 4,
  teamCounts: { red: 1, blue: 0 },
  teamHeroIds: { red: ['phantom'], blue: [] },
  selectedHero: 'phantom',
  preferredTeam: 'red',
  requirePreferredTeam: true,
}), null);

const metadataState = readMatchmakingHeroQueueStateFromMetadata({
  teamIds,
  metadata: {
    matchmakingTeamCounts: { red: 2, blue: 1, ignored: 99 },
    matchmakingTeamHeroIds: {
      red: ['phantom', 'phantom', 'invalid'],
      blue: ['blaze'],
    },
  },
});

assert.deepEqual(metadataState, {
  teamCounts: { red: 2, blue: 1 },
  teamHeroIds: {
    red: ['phantom' as HeroId],
    blue: ['blaze' as HeroId],
  },
});

console.log('matchmaking hero queue tests passed');
