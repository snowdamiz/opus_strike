import assert from 'node:assert/strict';
import { getGameplayModeRules } from '@voxel-strike/shared';
import { getMatchmakingBotFillRequiredParticipants } from '../rooms/LobbyRoom';

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
  const requiredParticipants = getMatchmakingBotFillRequiredParticipants({
    gameplayMode: 'battle_royal',
    rules: getGameplayModeRules('battle_royal'),
    expectedPartyParticipantCount: 2,
    largestTeamCount: 2,
  });

  assert.equal(requiredParticipants, getGameplayModeRules('battle_royal').minPlayers);
}

console.log('lobby matchmaking bot fill tests passed');
