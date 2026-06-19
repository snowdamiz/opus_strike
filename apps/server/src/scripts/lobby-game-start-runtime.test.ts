import assert from 'node:assert/strict';
import {
  buildGameEntryTicketInputs,
  buildGameStartingPayload,
  createLobbyGameStartAssignments,
  serializeGameSeatReservation,
  type LobbyGameStartPlayer,
} from '../rooms/lobbyGameStartRuntime';

function player(overrides: Partial<LobbyGameStartPlayer> = {}): LobbyGameStartPlayer {
  return {
    id: 'player-a',
    name: 'Player A',
    team: 'red',
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
  assert.deepEqual(assignments.botAssignments, [assignments.playerAssignments[2]]);
  assert.equal(assignments.reservedHumanPlayers, 2);
  assert.deepEqual(assignments.gameStartingAssignments, assignments.playerAssignments);
}

{
  const assignments = createLobbyGameStartAssignments({
    players: [
      player({ id: 'red-a', name: 'Red A', team: 'red', heroId: 'phantom' }),
    ],
  });
  const ticketInputs = buildGameEntryTicketInputs({
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    matchPerspective: 'third_person',
    playerAssignments: assignments.playerAssignments,
    authContexts: new Map([
      ['red-a', { userId: 'user-red', displayName: '' }],
    ]),
  });

  assert.deepEqual(ticketInputs.get('red-a'), {
    lobbyId: 'lobby-a',
    gameRoomId: 'game-a',
    lobbyPlayerId: 'red-a',
    userId: 'user-red',
    displayName: 'Red A',
    matchPerspective: 'third_person',
    assignedTeam: 'red',
    selectedHero: 'phantom',
  });
  assert.equal(ticketInputs.size, 1);
}

{
  const assignments = createLobbyGameStartAssignments({
    players: [player({ id: 'red-a', name: 'Red A', team: 'red' })],
  });

  assert.throws(
    () => buildGameEntryTicketInputs({
      lobbyId: 'lobby-a',
      gameRoomId: 'game-a',
      matchPerspective: 'first_person',
      playerAssignments: assignments.playerAssignments,
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
    seatReservation: {
      sessionId: 'seat-a',
      room: {
        name: 'game_room',
        roomId: 'game-a',
        processId: 'process-a',
        publicAddress: 'localhost:2567',
      },
    },
    gameplayMode: 'capture_the_flag',
    matchPerspective: 'third_person',
    mapThemeId: 'golden',
    mapSize: 'small',
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
    seatReservation: {
      sessionId: 'seat-a',
      room: {
        name: 'game_room',
        roomId: 'game-a',
        processId: 'process-a',
        publicAddress: 'localhost:2567',
      },
    },
    gameplayMode: 'capture_the_flag',
    matchPerspective: 'third_person',
    mapThemeId: 'golden',
    mapSize: 'small',
    mapProfileId: 'ctf_arena',
  });
}

{
  assert.deepEqual(serializeGameSeatReservation({
    sessionId: 'seat-a',
    devMode: true,
    room: {
      name: 'game_room',
      roomId: 'game-a',
      processId: 'process-a',
      publicAddress: 'localhost:2567',
    },
  }), {
    sessionId: 'seat-a',
    devMode: true,
    room: {
      name: 'game_room',
      roomId: 'game-a',
      processId: 'process-a',
      publicAddress: 'localhost:2567',
    },
  });
}

{
  assert.throws(
    () => serializeGameSeatReservation({
      sessionId: 'seat-a',
      room: {
        roomId: 'game-a',
        processId: 'process-a',
      },
    }),
    /Cannot serialize incomplete game seat reservation/
  );
}

console.log('lobby game start runtime tests passed');
