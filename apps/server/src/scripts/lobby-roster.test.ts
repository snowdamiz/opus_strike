import assert from 'node:assert/strict';
import { createTeamCountMap } from '@voxel-strike/shared';
import {
  buildLobbyPlayerSnapshots,
  countLobbyRoster,
  countLobbyTeamMembers,
  countLobbyTeamMembersExcluding,
  type LobbyRosterPlayer,
} from '../rooms/lobbyRoster';

function lobbyPlayer(overrides: Partial<LobbyRosterPlayer> = {}): LobbyRosterPlayer {
  return {
    id: 'player-a',
    name: 'Player A',
    isHost: false,
    isReady: false,
    team: '',
    heroId: '',
    isBot: false,
    botDifficulty: '',
    botProfileId: '',
    rankTier: 'unranked',
    rankTierLabel: 'Unranked',
    rankDivision: 0,
    rankDivisionIndex: -1,
    rankLabel: 'Unranked',
    rankIconKey: 'unranked',
    rankIsRanked: false,
    rankPlacementRemaining: 5,
    ...overrides,
  };
}

const roster = new Map<string, LobbyRosterPlayer>([
  ['red-human', lobbyPlayer({
    id: 'schema-red-human',
    name: 'Red Human',
    isHost: true,
    isReady: true,
    team: 'red',
    heroId: 'phantom',
    rankTier: 'bronze',
    rankTierLabel: 'Bronze',
    rankDivision: 2,
    rankDivisionIndex: 1,
    rankLabel: 'Bronze II',
    rankIconKey: 'bronze',
    rankIsRanked: true,
    rankPlacementRemaining: 0,
  })],
  ['red-bot', lobbyPlayer({
    id: 'red-bot',
    name: 'Red Bot',
    team: 'red',
    isBot: true,
    botDifficulty: 'hard',
    botProfileId: 'bot-profile',
  })],
  ['blue-human', lobbyPlayer({
    id: 'blue-human',
    name: 'Blue Human',
    team: 'blue',
  })],
]);

{
  const snapshots = buildLobbyPlayerSnapshots(roster);

  assert.equal(snapshots.length, 3);
  assert.equal(snapshots[0].id, 'red-human');
  assert.equal(snapshots[0].name, 'Red Human');
  assert.equal(snapshots[0].isHost, true);
  assert.equal(snapshots[0].rank.tier, 'bronze');
  assert.equal(snapshots[0].rank.division, 2);
}

{
  const counts = countLobbyRoster(roster);

  assert.deepEqual(counts, {
    human: 2,
    lobbyHuman: 2,
    bot: 1,
    combatParticipant: 3,
    team: { ...createTeamCountMap(), red: 2, blue: 1 },
  });
}

{
  assert.equal(countLobbyTeamMembers(roster.values(), 'red'), 2);
  assert.equal(countLobbyTeamMembers(roster.values(), 'blue'), 1);
  assert.equal(countLobbyTeamMembers(roster.values(), 'green'), 0);
  assert.equal(countLobbyTeamMembersExcluding(roster, 'red', 'red-bot'), 1);
  assert.equal(countLobbyTeamMembersExcluding(roster, 'red', 'missing'), 2);
  assert.equal(countLobbyTeamMembersExcluding(roster, 'green', 'red-bot'), 0);
}

console.log('lobby roster tests passed');
