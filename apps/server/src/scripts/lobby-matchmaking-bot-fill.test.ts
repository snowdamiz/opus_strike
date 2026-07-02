import assert from 'node:assert/strict';
import { assignTeamByCapacity, getGameplayModeRules } from '@voxel-strike/shared';
import {
  getMatchmakingBotFillPriorityTeams,
  getMatchmakingBotFillRequiredParticipants,
  getMatchmakingJoinCapacity,
  shouldCancelExpectedPartyMatchmakingQueue,
} from '../rooms/LobbyRoom';

{
  const requiredParticipants = getMatchmakingBotFillRequiredParticipants({
    gameplayMode: 'team_deathmatch',
    rules: getGameplayModeRules('team_deathmatch'),
    expectedPartyParticipantCount: 1,
    largestTeamCount: 1,
  });

  assert.equal(requiredParticipants, 2);
}

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

assert.equal(
  getMatchmakingJoinCapacity({
    botFillEnabled: true,
    status: 'matchmaking',
    requiredPlayers: 2,
    maxPlayers: 8,
  }),
  8
);

assert.equal(
  getMatchmakingJoinCapacity({
    botFillEnabled: true,
    status: 'map_vote',
    requiredPlayers: 2,
    maxPlayers: 8,
  }),
  2
);

assert.equal(
  getMatchmakingJoinCapacity({
    botFillEnabled: false,
    status: 'matchmaking',
    requiredPlayers: 8,
    maxPlayers: 8,
  }),
  8
);

{
  const rules = getGameplayModeRules('team_deathmatch');
  const players = new Map([
    ['leader', { team: 'red' }],
    ['member', { team: 'red' }],
  ]);
  const firstBotTeam = assignTeamByCapacity({
    players: players.values(),
    teamIds: ['red', 'blue'],
    maxTeamSize: rules.maxTeamSize,
  });
  players.set('bot-a', { team: firstBotTeam });
  const secondBotTeam = assignTeamByCapacity({
    players: players.values(),
    teamIds: ['red', 'blue'],
    maxTeamSize: rules.maxTeamSize,
  });

  assert.equal(firstBotTeam, 'blue');
  assert.equal(secondBotTeam, 'blue');
}

assert.equal(
  shouldCancelExpectedPartyMatchmakingQueue({
    status: 'matchmaking',
    leavingUserId: 'leader',
    expectedPartyLeaderUserId: 'leader',
    expectedHumanUserCount: 2,
  }),
  true
);

assert.equal(
  shouldCancelExpectedPartyMatchmakingQueue({
    status: 'matchmaking',
    leavingUserId: 'member',
    expectedPartyLeaderUserId: 'leader',
    expectedHumanUserCount: 2,
  }),
  false
);

assert.equal(
  shouldCancelExpectedPartyMatchmakingQueue({
    status: 'matchmaking',
    leavingUserId: 'leader',
    expectedPartyLeaderUserId: 'leader',
    expectedHumanUserCount: 1,
  }),
  false
);

assert.equal(
  shouldCancelExpectedPartyMatchmakingQueue({
    status: 'map_vote',
    leavingUserId: 'leader',
    expectedPartyLeaderUserId: 'leader',
    expectedHumanUserCount: 2,
  }),
  false
);

console.log('lobby matchmaking bot fill tests passed');
