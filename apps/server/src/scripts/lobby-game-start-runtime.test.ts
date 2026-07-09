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
      player({
        id: 'observer-a',
        name: 'Observer A',
        role: 'observer',
        team: '',
        heroId: 'phantom',
        skinId: 'phantom.default',
      }),
    ],
  });

  assert.deepEqual(assignments.playerAssignments, [
    {
      playerId: 'observer-a',
      playerName: 'Observer A',
      role: 'observer',
      isBot: false,
    },
  ]);
  assert.deepEqual(assignments.botAssignments, []);
  assert.equal(assignments.reservedHumanPlayers, 1);
  assert.deepEqual(assignments.gameStartingAssignments, assignments.playerAssignments);
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
      role: 'combat',
      team: 'red',
      isBot: false,
      heroId: 'phantom',
      skinId: 'phantom.default',
      botDifficulty: undefined,
      botProfileId: undefined,
    },
    {
      playerId: 'red-b',
      playerName: 'Red B',
      role: 'combat',
      team: 'red',
      isBot: false,
      heroId: undefined,
      skinId: undefined,
      botDifficulty: undefined,
      botProfileId: undefined,
    },
    {
      playerId: 'red-bot',
      playerName: 'Red Bot',
      role: 'combat',
      team: 'red',
      isBot: true,
      heroId: 'hookshot',
      skinId: 'hookshot.default',
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
      player({
        id: 'red-bot',
        name: 'Red Bot',
        team: 'red',
        isBot: true,
        heroId: 'phantom',
      }),
      player({ id: 'red-human', name: 'Red Human', team: 'red', heroId: 'phantom' }),
    ],
    heroIds: ['phantom', 'hookshot'],
    random: () => 0,
  });

  assert.deepEqual(assignments.playerAssignments, [
    {
      playerId: 'red-bot',
      playerName: 'Red Bot',
      role: 'combat',
      team: 'red',
      isBot: true,
      heroId: 'hookshot',
      skinId: 'hookshot.default',
      botDifficulty: 'normal',
      botProfileId: undefined,
    },
    {
      playerId: 'red-human',
      playerName: 'Red Human',
      role: 'combat',
      team: 'red',
      isBot: false,
      heroId: 'phantom',
      skinId: 'phantom.default',
      botDifficulty: undefined,
      botProfileId: undefined,
    },
  ]);
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
    role: 'combat',
    assignedTeam: 'red',
    selectedHero: 'phantom',
    selectedSkinId: 'phantom.default',
  });
  assert.equal(ticketInputs.size, 1);
}

{
  const assignments = createLobbyGameStartAssignments({
    players: [
      player({ id: 'red-a', name: 'Red A', team: 'red', heroId: 'phantom' }),
      player({ id: 'blue-a', name: 'Blue A', team: 'blue', heroId: 'blaze' }),
    ],
  });
  const ticketInputs = buildGameEntryTicketInputs({
    lobbyId: 'lobby-ranked',
    gameRoomId: 'game-ranked',
    matchPerspective: 'first_person',
    playerAssignments: assignments.playerAssignments,
    authContexts: new Map([
      ['red-a', { userId: 'user-red', displayName: 'Red' }],
      ['blue-a', { userId: 'user-blue', displayName: 'Blue' }],
    ]),
    matchmakingTickets: new Map([
      ['red-a', { mode: 'ranked', rankedRewardEligible: true } as any],
      ['blue-a', { mode: 'ranked', rankedRewardEligible: false } as any],
    ]),
  });

  assert.equal(ticketInputs.get('red-a')?.rankedRewardEligible, true);
  assert.equal(ticketInputs.get('blue-a')?.rankedRewardEligible, undefined);
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
        role: 'combat',
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
        role: 'combat',
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
    pregeneratedMapId: null,
    mapArtifactId: null,
  });
}

{
  const payload = buildGameStartingPayload({
    gameRoomId: 'game-b',
    players: [],
    gameplayMode: 'battle_royal',
    matchPerspective: 'third_person',
    mapThemeId: 'verdant',
    mapSize: 'large',
    mapProfileId: 'battle_royal_large',
    pregeneratedMapId: 'pgmap_start',
    mapArtifactId: 'pgartifact_start',
  });

  assert.equal(payload.pregeneratedMapId, 'pgmap_start');
  assert.equal(payload.mapArtifactId, 'pgartifact_start');
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
