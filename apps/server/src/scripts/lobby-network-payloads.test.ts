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
  paymentStatus: 'credited',
  paymentWalletAddress: 'wallet-a',
  depositSignature: 'deposit-a',
  refundSignature: 'refund-a',
});

{
  assert.deepEqual(buildLobbyPlayerJoinedPayload('session-a', rankedHuman), {
    playerId: 'session-a',
    playerName: 'Ranked Human',
    isHost: true,
    isReady: true,
    team: 'red',
    isObserver: false,
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
    paymentStatus: 'credited',
    paymentWalletAddress: 'wallet-a',
    depositSignature: 'deposit-a',
    refundSignature: 'refund-a',
  });
}

{
  const botPayload = buildLobbyPlayerJoinedPayload(
    'bot-a',
    lobbyPlayer({
      name: 'Bot A',
      team: 'blue',
      isReady: true,
      isBot: true,
      botDifficulty: 'hard',
      botProfileId: 'atlas',
      paymentStatus: 'not_required',
    }),
    { includePaymentDetails: false }
  );

  assert.deepEqual(botPayload, {
    playerId: 'bot-a',
    playerName: 'Bot A',
    isHost: false,
    isReady: true,
    team: 'blue',
    isObserver: false,
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
    paymentStatus: 'not_required',
  });
  assert.equal(Object.hasOwn(botPayload, 'paymentWalletAddress'), false);
  assert.equal(Object.hasOwn(botPayload, 'depositSignature'), false);
  assert.equal(Object.hasOwn(botPayload, 'refundSignature'), false);
}

{
  const roster = new Map<string, LobbyRosterPlayer>([
    ['session-a', rankedHuman],
    ['bot-a', lobbyPlayer({ isBot: true, team: 'blue', name: 'Bot A' })],
    ['observer-a', lobbyPlayer({ isObserver: true, name: 'Observer A' })],
  ]);
  const wager = { enabled: true, potLamports: '123' };
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
    observersEnabled: true,
    maxObservers: 2,
    wager,
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
  assert.equal(payload.observerCount, 1);
  assert.equal(payload.humanCount, 1);
  assert.equal(payload.botCount, 1);
  assert.equal(payload.wager, wager);
  assert.equal(payload.requiredPlayers, 6);
  assert.equal(payload.rankBandId, 3);
  assert.equal(payload.capacityBlocked, false);
  assert.deepEqual(payload.players.map((player) => player.id), ['session-a', 'bot-a', 'observer-a']);
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
    observersEnabled: false,
    maxObservers: 0,
    wager: { enabled: false },
    requiredPlayers: undefined,
  });

  assert.equal(Object.hasOwn(payload, 'requiredPlayers'), true);
  assert.equal(payload.requiredPlayers, undefined);
  assert.deepEqual(payload.players, []);
  assert.equal(payload.observerCount, 0);
  assert.equal(payload.humanCount, 0);
  assert.equal(payload.botCount, 0);
}

console.log('lobby network payload tests passed');
