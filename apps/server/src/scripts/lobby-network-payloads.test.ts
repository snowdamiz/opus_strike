import assert from 'node:assert/strict';
import {
  buildLobbyPlayerJoinedPayload,
  buildLobbyStatePayload,
} from '../rooms/lobbyNetworkPayloads';
import type { LobbyRosterPlayer } from '../rooms/lobbyRoster';

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

const rankedHuman = lobbyPlayer({
  id: 'schema-id',
  name: 'Ranked Human',
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
});

{
  assert.deepEqual(buildLobbyPlayerJoinedPayload('session-a', rankedHuman), {
    playerId: 'session-a',
    playerName: 'Ranked Human',
    isHost: true,
    isReady: true,
    team: 'red',
    heroId: 'phantom',
    isBot: false,
    botDifficulty: '',
    botProfileId: '',
    rank: {
      tier: 'bronze',
      tierLabel: 'Bronze',
      division: 2,
      divisionIndex: 1,
      label: 'Bronze II',
      iconKey: 'bronze',
      isRanked: true,
      placementRemaining: 0,
    },
  });
}

{
  const botPayload = buildLobbyPlayerJoinedPayload('bot-a', lobbyPlayer({
    name: 'Bot A',
    team: 'blue',
    isReady: true,
    isBot: true,
    botDifficulty: 'hard',
    botProfileId: 'atlas',
  }));

  assert.deepEqual(botPayload, {
    playerId: 'bot-a',
    playerName: 'Bot A',
    isHost: false,
    isReady: true,
    team: 'blue',
    heroId: '',
    isBot: true,
    botDifficulty: 'hard',
    botProfileId: 'atlas',
    rank: {
      tier: 'unranked',
      tierLabel: 'Unranked',
      division: null,
      divisionIndex: null,
      label: 'Unranked',
      iconKey: 'unranked',
      isRanked: false,
      placementRemaining: 5,
    },
  });
}

{
  const roster = new Map<string, LobbyRosterPlayer>([
    ['session-a', rankedHuman],
    ['bot-a', lobbyPlayer({ isBot: true, team: 'blue', name: 'Bot A' })],
  ]);
  const payload = buildLobbyStatePayload({
    lobbyId: 'lobby-a',
    name: 'Lobby A',
    matchMode: 'ranked',
    gameplayMode: 'capture_the_flag',
    hostId: 'session-a',
    status: 'matchmaking',
    players: roster,
    maxPlayers: 8,
    maxParticipants: 6,
    requiredPlayers: 4,
    matchmakingStatus: {
      requiredPlayers: 6,
      rankBandId: 3,
      capacityBlocked: false,
    },
  });

  assert.equal(payload.lobbyId, 'lobby-a');
  assert.equal(payload.matchMode, 'ranked');
  assert.equal(payload.gameplayMode, 'capture_the_flag');
  assert.equal(payload.humanCount, 1);
  assert.equal(payload.botCount, 1);
  assert.equal(payload.requiredPlayers, 6);
  assert.equal(payload.rankBandId, 3);
  assert.equal(payload.capacityBlocked, false);
  assert.deepEqual(payload.players.map((player) => player.id), ['session-a', 'bot-a']);
  assert.equal(payload.players[0].rank.tier, 'bronze');
}

{
  const payload = buildLobbyStatePayload({
    lobbyId: 'custom-lobby',
    name: 'Custom',
    matchMode: 'custom',
    gameplayMode: 'team_deathmatch',
    hostId: 'host-a',
    status: 'waiting',
    players: [],
    maxPlayers: 8,
    maxParticipants: 8,
    requiredPlayers: undefined,
  });

  assert.equal(Object.hasOwn(payload, 'requiredPlayers'), true);
  assert.equal(payload.requiredPlayers, undefined);
  assert.deepEqual(payload.players, []);
  assert.equal(payload.humanCount, 0);
  assert.equal(payload.botCount, 0);
}

console.log('lobby network payload tests passed');
