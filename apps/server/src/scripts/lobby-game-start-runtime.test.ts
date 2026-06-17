import assert from 'node:assert/strict';
import {
  buildGameEntryTicketInputs,
  buildGameStartingPayload,
  createLobbyGameStartAssignments,
  type LobbyGameStartPlayer,
} from '../rooms/lobbyGameStartRuntime';

function player(overrides: Partial<LobbyGameStartPlayer> = {}): LobbyGameStartPlayer {
  return {
    id: 'player-a',
    name: 'Player A',
    team: 'red',
    isObserver: false,
    isBot: false,
    heroId: '',
    botDifficulty: '',
    botProfileId: '',
    ...overrides,
  };
}

{
  assert.throws(
    () => createLobbyGameStartAssignments({
      players: [player({ team: '' })],
    }),
    /Cannot create assignments with unassigned players/
  );
}

{
  const assignments = createLobbyGameStartAssignments({
    players: [
      player({ id: 'red-a', name: 'Red A', team: 'red', heroId: 'phantom' }),
      player({ id: 'red-b', name: 'Red B', team: 'red', heroId: 'phantom' }),
      player({
        id: 'red-bot',
        name: 'Red Bot',
        team: 'red',
        isBot: true,
        heroId: '',
        botDifficulty: 'hard',
        botProfileId: 'atlas',
      }),
      player({
        id: 'observer-a',
        name: 'Observer A',
        team: '',
        isObserver: true,
      }),
      player({
        id: 'observer-bot',
        name: 'Observer Bot',
        team: '',
        isObserver: true,
        isBot: true,
      }),
    ],
    heroIds: ['phantom', 'hookshot'],
    random: () => 0,
  });

  assert.deepEqual(assignments.playerAssignments, [
    {
      playerId: 'red-a',
      playerName: 'Red A',
      team: 'red',
      isBot: false,
      heroId: 'phantom',
      botDifficulty: undefined,
      botProfileId: undefined,
    },
    {
      playerId: 'red-b',
      playerName: 'Red B',
      team: 'red',
      isBot: false,
      heroId: undefined,
      botDifficulty: undefined,
      botProfileId: undefined,
    },
    {
      playerId: 'red-bot',
      playerName: 'Red Bot',
      team: 'red',
      isBot: true,
      heroId: 'hookshot',
      botDifficulty: 'hard',
      botProfileId: 'atlas',
    },
  ]);
  assert.deepEqual(assignments.observerAssignments, [
    {
      playerId: 'observer-a',
      playerName: 'Observer A',
      isBot: false,
      isObserver: true,
    },
  ]);
  assert.deepEqual(assignments.botAssignments, [assignments.playerAssignments[2]]);
  assert.equal(assignments.reservedHumanPlayers, 2);
  assert.deepEqual(assignments.gameStartingAssignments, [
    ...assignments.playerAssignments,
    ...assignments.observerAssignments,
  ]);
}

{
  const assignments = createLobbyGameStartAssignments({
    players: [
      player({ id: 'red-a', name: 'Red A', team: 'red', heroId: 'phantom' }),
      player({ id: 'observer-a', name: 'Observer A', team: '', isObserver: true }),
    ],
  });
  const ticketInputs = buildGameEntryTicketInputs({
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    playerAssignments: assignments.playerAssignments,
    observerAssignments: assignments.observerAssignments,
    authContexts: new Map([
      ['red-a', { userId: 'user-red', displayName: '' }],
      ['observer-a', { userId: 'user-observer', displayName: 'Spectator' }],
    ]),
  });

  assert.deepEqual(ticketInputs.get('red-a'), {
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    lobbyPlayerId: 'red-a',
    userId: 'user-red',
    displayName: 'Red A',
    assignedTeam: 'red',
    selectedHero: 'phantom',
  });
  assert.deepEqual(ticketInputs.get('observer-a'), {
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    lobbyPlayerId: 'observer-a',
    userId: 'user-observer',
    displayName: 'Spectator',
    observer: true,
  });
}

{
  const assignments = createLobbyGameStartAssignments({
    players: [player({ id: 'red-a', name: 'Red A', team: 'red' })],
  });

  assert.throws(
    () => buildGameEntryTicketInputs({
      lobbyId: 'lobby-a',
      gameRoomId: 'game-a',
      playerAssignments: assignments.playerAssignments,
      observerAssignments: [],
      authContexts: new Map(),
    }),
    /Authenticated player context missing/
  );
}

{
  const payload = buildGameStartingPayload({
    gameRoomId: 'game-a',
    players: [
      {
        playerId: 'red-a',
        playerName: 'Red A',
        team: 'red',
        isBot: false,
      },
    ],
    entryTicket: 'ticket-a',
    gameplayMode: 'capture_the_flag',
    mapThemeId: 'golden',
    mapSize: 'small',
    wager: { locked: true },
  });

  assert.deepEqual(payload, {
    gameRoomId: 'game-a',
    players: [
      {
        playerId: 'red-a',
        playerName: 'Red A',
        team: 'red',
        isBot: false,
      },
    ],
    entryTicket: 'ticket-a',
    gameplayMode: 'capture_the_flag',
    mapThemeId: 'golden',
    mapSize: 'small',
    wager: { locked: true },
  });
}

console.log('lobby game start runtime tests passed');
