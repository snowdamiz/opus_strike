import type { Room } from 'colyseus.js';
import {
  DEFAULT_GAMEPLAY_MODE,
  isGameplayMode,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type PublicRankSnapshot,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import type {
  LobbyPlayer,
  LobbyWagerState,
  MapVoteOption,
  MapVoteRecord,
  WagerPaymentIntent,
} from '../store/types';
import { prepareVoxelMapCpu } from '../utils/mapWarmup/mapPrepCache';
import { prebuildPreparedVoxelMapGeometry } from '../utils/mapWarmup/mapGeometryWarmup';
import { disconnectVoice } from '../voice/voiceControls';
import { loggers } from '../utils/logger';

type GameStoreState = ReturnType<typeof useGameStore.getState>;
type MatchmakingStatusState = Parameters<GameStoreState['setMatchmakingStatus']>[0];

type JoinGameRoomFromLobby = (
  gameRoomId: string,
  playerName: string,
  team?: string,
  entryTicket?: string,
  observer?: boolean
) => Promise<void>;

interface SetupLobbyListenersOptions {
  playerName: string;
  joinGameRoom: JoinGameRoomFromLobby;
  leaveLobby: () => void;
}

interface MatchmakingStatusMessage {
  matchMode?: LobbyWagerState['matchMode'];
  rankBandId?: number;
  rankBandLabel?: string;
  averageCompetitiveRating?: number;
  averageVisibleRank?: string;
  rankSearchDistance?: number;
  queuedHumanCount?: number;
  provisionalHumanCount?: number;
  requiredPlayers?: number;
  capacityBlocked?: boolean;
  capacityMaxPlayers?: number;
  rankedCoverChargeLamports?: string;
  rankedEntryQuoteId?: string;
}

interface LobbyPlayerWire {
  id: string;
  name: string;
  isHost: boolean;
  isReady?: boolean;
  team?: string;
  isObserver?: boolean;
  heroId?: HeroId | '';
  isBot?: boolean;
  botDifficulty?: BotDifficulty | '';
  botProfileId?: string;
  paymentStatus?: LobbyPlayer['paymentStatus'];
  paymentWalletAddress?: string;
  depositSignature?: string;
  refundSignature?: string;
  rank?: PublicRankSnapshot;
}

interface LobbyStateMessage extends MatchmakingStatusMessage {
  lobbyId: string;
  name: string;
  gameplayMode?: GameplayMode;
  hostId: string;
  status: string;
  players: LobbyPlayerWire[];
  observersEnabled?: boolean;
  maxObservers?: number;
  wager?: LobbyWagerState;
}

interface PlayerJoinedMessage {
  playerId: string;
  playerName: string;
  isHost: boolean;
  isReady?: boolean;
  team?: string;
  isObserver?: boolean;
  heroId?: HeroId | '';
  isBot?: boolean;
  botDifficulty?: BotDifficulty | '';
  botProfileId?: string;
  paymentStatus?: LobbyPlayer['paymentStatus'];
  paymentWalletAddress?: string;
  depositSignature?: string;
  refundSignature?: string;
  rank?: PublicRankSnapshot;
}

interface PaymentStatusChangedMessage {
  lobbyId: string;
  userId: string;
  lobbyPlayerId: string | null;
  status: LobbyPlayer['paymentStatus'];
  amountLamports: string;
  walletAddress: string;
  depositSignature?: string | null;
  refundSignature?: string | null;
  refundReason?: string | null;
  refundGrossLamports?: string | null;
  refundOutboundFeeLamports?: string | null;
  refundNetLamports?: string | null;
  refundFeeSource?: string | null;
  potLamports: string;
}

interface GameStartingMessage {
  gameRoomId: string;
  players: { playerId: string; playerName: string; team?: string; isBot?: boolean; isObserver?: boolean }[];
  entryTicket?: string;
  gameplayMode?: GameplayMode;
  mapSize?: VoxelMapSizeId | null;
}

function toMatchmakingStatus(data: MatchmakingStatusMessage): MatchmakingStatusState {
  return {
    matchMode: data.matchMode ?? null,
    rankBandId: typeof data.rankBandId === 'number' ? data.rankBandId : null,
    rankBandLabel: data.rankBandLabel ?? null,
    averageCompetitiveRating: typeof data.averageCompetitiveRating === 'number' ? data.averageCompetitiveRating : null,
    averageVisibleRank: data.averageVisibleRank ?? null,
    rankSearchDistance: typeof data.rankSearchDistance === 'number' ? data.rankSearchDistance : null,
    queuedHumanCount: typeof data.queuedHumanCount === 'number' ? data.queuedHumanCount : null,
    provisionalHumanCount: typeof data.provisionalHumanCount === 'number' ? data.provisionalHumanCount : null,
    requiredPlayers: typeof data.requiredPlayers === 'number' ? data.requiredPlayers : null,
    capacityBlocked: data.capacityBlocked === true,
    capacityMaxPlayers: typeof data.capacityMaxPlayers === 'number' ? data.capacityMaxPlayers : null,
    rankedCoverChargeLamports: data.rankedCoverChargeLamports ?? null,
    rankedEntryQuoteId: data.rankedEntryQuoteId ?? null,
  };
}

function toLobbyPlayer(player: LobbyPlayerWire): LobbyPlayer {
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    isReady: player.isReady ?? false,
    team: player.team || '',
    isObserver: Boolean(player.isObserver),
    heroId: player.heroId || '',
    isBot: Boolean(player.isBot),
    botDifficulty: player.botDifficulty || '',
    botProfileId: player.botProfileId,
    paymentStatus: player.paymentStatus || '',
    paymentWalletAddress: player.paymentWalletAddress || '',
    depositSignature: player.depositSignature || '',
    refundSignature: player.refundSignature || '',
    rank: player.rank,
  };
}

function toJoinedLobbyPlayer(data: PlayerJoinedMessage): LobbyPlayer {
  return toLobbyPlayer({
    id: data.playerId,
    name: data.playerName,
    isHost: data.isHost,
    isReady: data.isReady,
    team: data.team,
    isObserver: data.isObserver,
    heroId: data.heroId,
    isBot: data.isBot,
    botDifficulty: data.botDifficulty,
    botProfileId: data.botProfileId,
    paymentStatus: data.paymentStatus,
    paymentWalletAddress: data.paymentWalletAddress,
    depositSignature: data.depositSignature,
    refundSignature: data.refundSignature,
    rank: data.rank,
  });
}

export function setupLobbyListeners(
  room: Room,
  { playerName, joinGameRoom, leaveLobby }: SetupLobbyListenersOptions
): void {
  const {
    setCurrentLobby,
    setCurrentLobbyWager,
    setLobbyPlayers,
    updateLobbyPlayer,
    removeLobbyPlayer,
    setIsLobbyHost,
    setLobbyObserverSettings,
    setLobbyError,
    setMatchmakingStatus,
    setAppPhase,
    setMapVoteState,
    setMapVotes,
    clearMapVote,
    setMapSeed,
    setMapThemeId,
    setMapSize,
    resetLobby,
  } = useGameStore.getState();

  const updateLobbyPlayerPatch = (playerId: string, patch: Partial<LobbyPlayer>) => {
    const player = useGameStore.getState().lobbyPlayers.get(playerId);
    if (player) {
      updateLobbyPlayer(playerId, { ...player, ...patch });
    }
  };

  room.onMessage('lobbyState', (data: LobbyStateMessage) => {
    loggers.network.debug('received lobby state', data);
    setCurrentLobby(data.lobbyId, data.name);
    useGameStore.setState({
      gameplayMode: isGameplayMode(data.gameplayMode) ? data.gameplayMode : DEFAULT_GAMEPLAY_MODE,
    });
    const currentWager = useGameStore.getState().currentLobbyWager;
    const nextWager = data.wager ?? { enabled: false };
    setCurrentLobbyWager({
      ...nextWager,
      rankedEntryQuoteExpiresAt: nextWager.rankedEntryQuoteExpiresAt ?? currentWager.rankedEntryQuoteExpiresAt ?? null,
    });
    setIsLobbyHost(data.hostId === room.sessionId);
    setLobbyObserverSettings(Boolean(data.observersEnabled), typeof data.maxObservers === 'number' ? data.maxObservers : 0);
    setMatchmakingStatus(toMatchmakingStatus({
      ...data,
      rankedEntryQuoteId: data.rankedEntryQuoteId ?? data.wager?.rankedEntryQuoteId ?? undefined,
    }));
    if (data.status === 'map_vote') {
      setAppPhase('map_vote');
    } else if (data.status === 'matchmaking') {
      setAppPhase('matchmaking');
    }

    const playersMap = new Map<string, LobbyPlayer>();
    for (const player of data.players) {
      playersMap.set(player.id, toLobbyPlayer(player));
    }
    setLobbyPlayers(playersMap);
  });

  room.onMessage('matchmakingStatus', (data: MatchmakingStatusMessage) => {
    setMatchmakingStatus(toMatchmakingStatus(data));
  });

  room.onMessage('mapVoteStarted', (data: {
    options: MapVoteOption[];
    votes: MapVoteRecord[];
    phaseEndTime: number | null;
  }) => {
    loggers.network.info('map vote started', data.options.map((option) => option.seed));
    setMapVoteState(data.options, data.votes, data.phaseEndTime);
    setAppPhase('map_vote');
  });

  room.onMessage('mapVoteTimerStarted', (data: { phaseEndTime: number }) => {
    useGameStore.setState({ mapVotePhaseEndTime: data.phaseEndTime });
  });

  room.onMessage('mapVoteUpdated', (data: { votes: MapVoteRecord[] }) => {
    setMapVotes(data.votes);
  });

  room.onMessage('mapVoteFinalized', (data: {
    selectedOptionId: string;
    mapSeed: number;
    mapThemeId?: VoxelMapTheme['id'] | null;
    mapSize?: VoxelMapSizeId | null;
    votes: MapVoteRecord[];
  }) => {
    loggers.network.info('map vote finalized', data.mapSeed);
    setMapVotes(data.votes, data.selectedOptionId);
    setMapSeed(data.mapSeed);
    setMapThemeId(data.mapThemeId ?? null);
    setMapSize(data.mapSize);
    try {
      const preparedMap = prepareVoxelMapCpu({
        seed: data.mapSeed,
        themeId: data.mapThemeId ?? null,
        mapSize: data.mapSize,
        source: 'mapVoteFinalized',
      });
      prebuildPreparedVoxelMapGeometry(preparedMap, { frameBudgetMs: 3, label: 'map-vote-finalized' });
    } catch (error) {
      loggers.network.warn('selected map CPU prep failed', error);
    }
  });

  room.onMessage('mapVoteCancelled', (data: { reason?: string; status?: string }) => {
    loggers.network.warn('map vote cancelled', data.reason || 'unknown');
    clearMapVote();
    setAppPhase(data.status === 'matchmaking' ? 'matchmaking' : 'in_lobby');
  });

  room.onMessage('playerJoined', (data: PlayerJoinedMessage) => {
    loggers.network.debug('player joined lobby', data.playerName);
    updateLobbyPlayer(data.playerId, toJoinedLobbyPlayer(data));
  });

  room.onMessage('paymentStatusChanged', (data: PaymentStatusChangedMessage) => {
    loggers.network.debug('payment status changed', data.status);
    if (data.lobbyPlayerId) {
      updateLobbyPlayerPatch(data.lobbyPlayerId, {
        paymentStatus: data.status,
        paymentWalletAddress: data.walletAddress,
        depositSignature: data.depositSignature || '',
        refundSignature: data.refundSignature || '',
      });
    }
    const currentWager = useGameStore.getState().currentLobbyWager;
    if (currentWager.enabled) {
      setCurrentLobbyWager({
        ...currentWager,
        potLamports: data.potLamports,
      });
    }
  });

  room.onMessage('paymentIntentCreated', (data: { intent: WagerPaymentIntent }) => {
    loggers.network.debug('payment intent created', data.intent.intentId);
  });

  room.onMessage('paymentIntentUpdated', (data: { intent: WagerPaymentIntent }) => {
    loggers.network.debug('payment intent updated', data.intent.status);
  });

  room.onMessage('paymentIntentError', (data: { message: string }) => {
    loggers.network.error('payment intent error', data.message);
  });

  room.onMessage('wagerStartBlocked', (data: { message: string; unpaidPlayers?: Array<{ name: string }> }) => {
    loggers.network.warn('wager start blocked', data.message, data.unpaidPlayers?.map((player) => player.name));
  });

  room.onMessage('playerLeft', (data: { playerId: string }) => {
    loggers.network.debug('player left lobby', data.playerId);
    removeLobbyPlayer(data.playerId);
  });

  room.onMessage('playerReady', (data: { playerId: string; ready: boolean }) => {
    updateLobbyPlayerPatch(data.playerId, { isReady: data.ready });
  });

  room.onMessage('playerTeamChanged', (data: { playerId: string; team: string }) => {
    updateLobbyPlayerPatch(data.playerId, { team: data.team });
  });

  room.onMessage('playerObserverChanged', (data: { playerId: string; isObserver: boolean; team?: string; isReady?: boolean }) => {
    const player = useGameStore.getState().lobbyPlayers.get(data.playerId);
    if (player) {
      updateLobbyPlayer(data.playerId, {
        ...player,
        isObserver: data.isObserver,
        team: data.team ?? player.team,
        isReady: data.isReady ?? player.isReady,
      });
    }
  });

  room.onMessage('botDifficultyChanged', (data: { playerId: string; difficulty: BotDifficulty }) => {
    updateLobbyPlayerPatch(data.playerId, { botDifficulty: data.difficulty });
  });

  room.onMessage('botHeroChanged', (data: { playerId: string; heroId: HeroId | '' }) => {
    updateLobbyPlayerPatch(data.playerId, { heroId: data.heroId });
  });

  room.onMessage('hostChanged', (data: { newHostId: string; newHostName: string }) => {
    loggers.network.debug('host changed', data.newHostName);
    setIsLobbyHost(data.newHostId === room.sessionId);

    const updatedPlayers = new Map<string, LobbyPlayer>();
    useGameStore.getState().lobbyPlayers.forEach((player, id) => {
      updatedPlayers.set(id, { ...player, isHost: id === data.newHostId });
    });
    setLobbyPlayers(updatedPlayers);
  });

  let isJoiningGame = false;
  room.onMessage('gameStarting', async (data: GameStartingMessage) => {
    if (isJoiningGame) {
      loggers.network.debug('ignoring duplicate gameStarting message');
      return;
    }
    isJoiningGame = true;

    loggers.network.info('game starting', data.gameRoomId);
    const myAssignment = data.players.find((player) => player.playerId === room.sessionId);
    const isObserver = myAssignment?.isObserver === true;
    const myTeam = myAssignment?.team || 'red';
    useGameStore.setState({
      gameplayMode: isGameplayMode(data.gameplayMode) ? data.gameplayMode : DEFAULT_GAMEPLAY_MODE,
    });
    setMapSize(data.mapSize);

    try {
      await joinGameRoom(data.gameRoomId, playerName, myTeam, data.entryTicket, isObserver);
    } catch (error) {
      loggers.network.error('failed to join game room', error);
      isJoiningGame = false;
    }
  });

  room.onMessage('kicked', (data: { reason: string }) => {
    loggers.network.warn('kicked from lobby', data.reason);
    disconnectVoice('lobby_kicked');
    leaveLobby();
  });

  room.onMessage('duplicateSession', (data: { reason: string }) => {
    loggers.network.warn('duplicate session detected in lobby', data.reason);
    disconnectVoice('duplicate_lobby_session');
  });

  room.onMessage('error', (data: { message: string }) => {
    loggers.network.error('lobby error', data.message);
    setLobbyError(data.message || 'Lobby action failed');
  });

  room.onError((code, message) => {
    loggers.network.error('lobby room error', code, message);
  });

  room.onLeave((code) => {
    loggers.network.debug('left lobby room', code);
    disconnectVoice('left_lobby');
    resetLobby();
  });
}
