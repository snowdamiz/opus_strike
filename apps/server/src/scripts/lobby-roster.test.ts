import assert from 'node:assert/strict';
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
    isObserver: false,
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
    paymentStatus: '',
    paymentWalletAddress: '',
    depositSignature: '',
    refundSignature: '',
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
    paymentStatus: 'credited',
    paymentWalletAddress: 'wallet-a',
    depositSignature: 'deposit-a',
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
    paymentStatus: 'settled',
    refundSignature: 'refund-b',
  })],
  ['observer-human', lobbyPlayer({
    id: 'observer-human',
    name: 'Observer Human',
    isObserver: true,
    paymentStatus: 'credited',
  })],
  ['spectator-bot', lobbyPlayer({
    id: 'spectator-bot',
    name: 'Spectator Bot',
    isBot: true,
    isObserver: true,
  })],
]);

{
  const snapshots = buildLobbyPlayerSnapshots(roster);

  assert.equal(snapshots.length, 5);
  assert.equal(snapshots[0].id, 'red-human');
  assert.equal(snapshots[0].name, 'Red Human');
  assert.equal(snapshots[0].isHost, true);
  assert.equal(snapshots[0].rank.tier, 'bronze');
  assert.equal(snapshots[0].rank.division, 2);
  assert.equal(snapshots[0].paymentWalletAddress, 'wallet-a');
  assert.equal(snapshots[0].depositSignature, 'deposit-a');
}

{
  const counts = countLobbyRoster(roster);

  assert.deepEqual(counts, {
    human: 2,
    lobbyHuman: 3,
    bot: 2,
    observer: 2,
    combatParticipant: 3,
    team: { red: 2, blue: 1 },
    paidHuman: 2,
    paidHumanByTeam: { red: 1, blue: 1 },
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
