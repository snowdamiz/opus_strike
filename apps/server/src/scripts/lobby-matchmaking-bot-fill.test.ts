import assert from 'node:assert/strict';
import { getGameplayModeRules } from '@voxel-strike/shared';
import {
  getMatchmakingBotFillPriorityTeams,
  getMatchmakingBotFillRequiredParticipants,
} from '../rooms/LobbyRoom';

{
  const requiredParticipants = getMatchmakingBotFillRequiredParticipants({
    gameplayMode: 'team_deathmatch',
    rules: getGameplayModeRules('team_deathmatch'),
    expectedPartyParticipantCount: 2,
    largestTeamCount: 2,
  });

  assert.equal(requiredParticipants, 4);
}

{
  const requiredParticipants = getMatchmakingBotFillRequiredParticipants({
    gameplayMode: 'capture_the_flag',
    rules: getGameplayModeRules('capture_the_flag'),
    expectedPartyParticipantCount: 1,
    largestTeamCount: 1,
  });

  assert.equal(requiredParticipants, 2);
}

{
  const rules = getGameplayModeRules('battle_royal');
  const requiredParticipants = getMatchmakingBotFillRequiredParticipants({
    gameplayMode: 'battle_royal',
    rules,
    expectedPartyParticipantCount: 2,
    largestTeamCount: 2,
  });

  assert.equal(requiredParticipants, Math.min(rules.maxPlayers, rules.maxTeams * rules.maxTeamSize));
}

assert.deepEqual(
  getMatchmakingBotFillPriorityTeams({
    gameplayMode: 'battle_royal',
    partyTeam: 'br_01',
    partyTeamCount: 1,
    maxTeamSize: 3,
    missingParticipants: 9,
  }),
  ['br_01', 'br_01']
);

assert.deepEqual(
  getMatchmakingBotFillPriorityTeams({
    gameplayMode: 'battle_royal',
    partyTeam: 'br_01',
    partyTeamCount: 2,
    maxTeamSize: 3,
    missingParticipants: 1,
  }),
  ['br_01']
);

assert.deepEqual(
  getMatchmakingBotFillPriorityTeams({
    gameplayMode: 'battle_royal',
    partyTeam: 'br_01',
    partyTeamCount: 3,
    maxTeamSize: 3,
    missingParticipants: 7,
  }),
  []
);

assert.deepEqual(
  getMatchmakingBotFillPriorityTeams({
    gameplayMode: 'team_deathmatch',
    partyTeam: 'red',
    partyTeamCount: 1,
    maxTeamSize: 4,
    missingParticipants: 3,
  }),
  []
);

console.log('lobby matchmaking bot fill tests passed');
