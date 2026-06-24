import type { Room } from 'colyseus.js';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  isGameplayMode,
  isMatchPerspective,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type HeroSkinId,
  type MapProfileId,
  type MatchPerspective,
  type PublicRankSnapshot,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { useGameStore } from '../store/gameStore';
import type {
  LobbyPlayer,
  MapVoteOption,
  MapVoteRecord,
} from '../store/types';
import { useChatStore } from '../store/chatStore';
import { seedMapPrepCacheFromManifest, type PrepareVoxelMapOptions } from '../utils/mapWarmup/mapPrepCache';
import { prebuildPreparedMapGeometryDeferred } from '../utils/mapWarmup/deferredMapGeometryWarmup';
import { requestMapPreviewManifest } from '../utils/mapPreview/mapPreviewManifestClient';
import { disconnectVoice } from '../voice/voiceControls';
import { loggers } from '../utils/logger';

type GameStoreState = ReturnType<typeof useGameStore.getState>;
type MatchmakingStatusState = Parameters<GameStoreState['setMatchmakingStatus']>[0];

type JoinGameRoomFromLobby = (
  gameRoomId: string,
  playerName: string,
  team?: string,
  entryTicket?: string,
  reconnectToRunningGame?: boolean,
  seatReservation?: unknown
) => Promise<void>;

const GAME_START_TIMEOUT_MS = 90_000;
const GAME_JOIN_RETRY_DELAYS_MS = [450, 1_200] as const;

interface SetupLobbyListenersOptions {
  playerName: string;
  joinGameRoom: JoinGameRoomFromLobby;
  leaveLobby: () => void;
}

interface MatchmakingStatusMessage {
  matchMode?: 'quick_play' | 'ranked' | 'custom';
  gameplayMode?: GameplayMode;
  botFillMode?: 'manual' | 'fill_even';
  matchPerspective?: MatchPerspective;
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
}

interface LobbyPlayerWire {
  id: string;
  name: string;
  isHost: boolean;
  isReady?: boolean;
  team?: string;
  heroId?: HeroId | '';
  skinId?: HeroSkinId | '';
  isBot?: boolean;
  botDifficulty?: BotDifficulty | '';
  botProfileId?: string;
  rank?: PublicRankSnapshot;
}

interface LobbyStateMessage extends MatchmakingStatusMessage {
  lobbyId: string;
  name: string;
  gameplayMode?: GameplayMode;
  matchPerspective?: MatchPerspective;
  hostId: string;
  status: string;
  players: LobbyPlayerWire[];
}

interface PlayerJoinedMessage {
  playerId: string;
  playerName: string;
  isHost: boolean;
  isReady?: boolean;
  team?: string;
  heroId?: HeroId | '';
  skinId?: HeroSkinId | '';
  isBot?: boolean;
  botDifficulty?: BotDifficulty | '';
  botProfileId?: string;
  rank?: PublicRankSnapshot;
}

interface GameStartingMessage {
  gameRoomId: string;
  players: { playerId: string; playerName: string; team?: string; isBot?: boolean }[];
  entryTicket?: string;
  seatReservation?: unknown;
  gameplayMode?: GameplayMode;
  matchPerspective?: MatchPerspective;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
}

interface SelectedMapMessage {
  mapSeed: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  gameplayMode?: GameplayMode;
}

function toMatchmakingStatus(data: MatchmakingStatusMessage): MatchmakingStatusState {
  return {
    matchMode: data.matchMode ?? null,
    gameplayMode: isGameplayMode(data.gameplayMode) ? data.gameplayMode : null,
    botFillMode: data.botFillMode === 'fill_even' ? 'fill_even' : data.botFillMode === 'manual' ? 'manual' : null,
    matchPerspective: isMatchPerspective(data.matchPerspective) ? data.matchPerspective : null,
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
  };
}

function toLobbyPlayer(player: LobbyPlayerWire): LobbyPlayer {
  return {
    id: player.id,
    name: player.name,
    isHost: player.isHost,
    isReady: player.isReady ?? false,
    team: player.team || '',
    heroId: player.heroId || '',
    skinId: player.skinId || '',
    isBot: Boolean(player.isBot),
    botDifficulty: player.botDifficulty || '',
    botProfileId: player.botProfileId,
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
    heroId: data.heroId,
    skinId: data.skinId,
    isBot: data.isBot,
    botDifficulty: data.botDifficulty,
    botProfileId: data.botProfileId,
    rank: data.rank,
  });
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Unknown error';
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}

export function setupLobbyListeners(
  room: Room,
  { playerName, joinGameRoom, leaveLobby }: SetupLobbyListenersOptions
): void {
  const {
    setCurrentLobby,
    setLobbyPlayers,
    updateLobbyPlayer,
    removeLobbyPlayer,
    setIsLobbyHost,
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

  let isAwaitingGameStart = false;
  let isJoiningGame = false;
  let hasJoinedGame = false;
  let hasFailedGameStart = false;
  let gameStartTimeout: number | null = null;

  const clearGameStartTimeout = () => {
    if (gameStartTimeout === null) return;
    window.clearTimeout(gameStartTimeout);
    gameStartTimeout = null;
  };

  const failPendingGameStart = (message: string) => {
    isAwaitingGameStart = false;
    isJoiningGame = false;
    hasJoinedGame = false;
    hasFailedGameStart = true;
    clearGameStartTimeout();
    resetLobby();
    setLobbyError(message);
    setAppPhase('menu');
  };

  const armGameStartTimeout = () => {
    clearGameStartTimeout();
    gameStartTimeout = window.setTimeout(() => {
      if (useGameStore.getState().appPhase === 'in_game') {
        clearGameStartTimeout();
        return;
      }
      failPendingGameStart('Game start timed out. Please try queueing again.');
    }, GAME_START_TIMEOUT_MS);
  };

  const joinGameRoomWithRetry = async (
    gameRoomId: string,
    team: string,
    entryTicket?: string,
    seatReservation?: unknown
  ) => {
    if (seatReservation) {
      await joinGameRoom(gameRoomId, playerName, team, entryTicket, false, seatReservation);
      return;
    }

    let lastError: unknown = null;

    for (let attempt = 0; attempt <= GAME_JOIN_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await joinGameRoom(gameRoomId, playerName, team, entryTicket);
        return;
      } catch (error) {
        lastError = error;
        const retryDelay = GAME_JOIN_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined) break;
        loggers.network.warn('game room join failed; retrying launch handoff', {
          gameRoomId,
          attempt: attempt + 1,
          retryDelay,
          error,
        });
        await waitForRetry(retryDelay);
      }
    }

    throw lastError ?? new Error('Failed to join game room');
  };

  const prepareSelectedMap = (
    data: SelectedMapMessage,
    cacheLabel: NonNullable<PrepareVoxelMapOptions['source']>
  ) => {
    if (isGameplayMode(data.gameplayMode)) {
      useGameStore.setState({ gameplayMode: data.gameplayMode });
    }
    isAwaitingGameStart = true;
    hasJoinedGame = false;
    hasFailedGameStart = false;
    armGameStartTimeout();
    setMapSeed(data.mapSeed);
    setMapThemeId(data.mapThemeId ?? null);
    setMapSize(data.mapSize);
    useGameStore.getState().setMapProfileId(data.mapProfileId);
    setAppPhase('match_loading');

    void requestMapPreviewManifest({
      seed: data.mapSeed,
      themeId: data.mapThemeId ?? null,
      mapSize: data.mapSize,
      mapProfileId: data.mapProfileId,
    })
      .then((manifest) => {
        const preparedMap = seedMapPrepCacheFromManifest(
          data.mapSeed,
          manifest,
          cacheLabel
        );
        prebuildPreparedMapGeometryDeferred(preparedMap, { frameBudgetMs: 3, label: cacheLabel });
      })
      .catch((error) => {
        loggers.network.warn('selected map worker prep failed', error);
      });
  };

  const cancelPendingMapStart = (data: { reason?: string; status?: string; gameplayMode?: GameplayMode }) => {
    if (isGameplayMode(data.gameplayMode)) {
      useGameStore.setState({ gameplayMode: data.gameplayMode });
    }
    isAwaitingGameStart = false;
    isJoiningGame = false;
    hasJoinedGame = false;
    hasFailedGameStart = false;
    clearGameStartTimeout();
    clearMapVote();
    setAppPhase(data.status === 'matchmaking' ? 'matchmaking' : 'in_lobby');
  };

  room.onMessage('lobbyState', (data: LobbyStateMessage) => {
    loggers.network.debug('received lobby state', data);
    setCurrentLobby(data.lobbyId, data.name);
    useGameStore.setState({
      gameplayMode: isGameplayMode(data.gameplayMode) ? data.gameplayMode : DEFAULT_GAMEPLAY_MODE,
      matchPerspective: isMatchPerspective(data.matchPerspective) ? data.matchPerspective : DEFAULT_MATCH_PERSPECTIVE,
    });
    setIsLobbyHost(data.hostId === room.sessionId);
    setMatchmakingStatus(toMatchmakingStatus(data));
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
    gameplayMode?: GameplayMode;
  }) => {
    loggers.network.info('map vote started', data.options.map((option) => option.seed));
    if (isGameplayMode(data.gameplayMode)) {
      useGameStore.setState({ gameplayMode: data.gameplayMode });
    }
    setMapVoteState(data.options, data.votes, data.phaseEndTime);
    setAppPhase('map_vote');
  });

  room.onMessage('mapVoteTimerStarted', (data: { phaseEndTime: number; gameplayMode?: GameplayMode }) => {
    if (isGameplayMode(data.gameplayMode)) {
      useGameStore.setState({ gameplayMode: data.gameplayMode });
    }
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
    mapProfileId?: MapProfileId | null;
    gameplayMode?: GameplayMode;
    votes: MapVoteRecord[];
  }) => {
    loggers.network.info('map vote finalized', data.mapSeed);
    setMapVotes(data.votes, data.selectedOptionId);
    prepareSelectedMap(data, 'mapVoteFinalized');
  });

  room.onMessage('mapGenerationStarted', (data: SelectedMapMessage) => {
    loggers.network.info('map generation started', {
      seed: data.mapSeed,
      mapSize: data.mapSize,
      mapProfileId: data.mapProfileId,
    });
    clearMapVote();
    prepareSelectedMap(data, 'mapGenerationStarted');
  });

  room.onMessage('mapVoteCancelled', (data: { reason?: string; status?: string; gameplayMode?: GameplayMode }) => {
    loggers.network.warn('map vote cancelled', data.reason || 'unknown');
    cancelPendingMapStart(data);
  });

  room.onMessage('mapGenerationCancelled', (data: { reason?: string; status?: string; gameplayMode?: GameplayMode }) => {
    loggers.network.warn('map generation cancelled', data.reason || 'unknown');
    cancelPendingMapStart(data);
  });

  room.onMessage('playerJoined', (data: PlayerJoinedMessage) => {
    loggers.network.debug('player joined lobby', data.playerName);
    updateLobbyPlayer(data.playerId, toJoinedLobbyPlayer(data));
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

  room.onMessage('botDifficultyChanged', (data: { playerId: string; difficulty: BotDifficulty }) => {
    updateLobbyPlayerPatch(data.playerId, { botDifficulty: data.difficulty });
  });

  room.onMessage('botHeroChanged', (data: { playerId: string; heroId: HeroId | ''; skinId?: HeroSkinId | '' }) => {
    updateLobbyPlayerPatch(data.playerId, { heroId: data.heroId, skinId: data.skinId || '' });
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

  room.onMessage('chat', (data: unknown) => {
    useChatStore.getState().addIncomingMessage('lobby', data);
  });

  room.onMessage('gameStarting', async (data: GameStartingMessage) => {
    if (isJoiningGame) {
      loggers.network.debug('ignoring duplicate gameStarting message');
      return;
    }
    isJoiningGame = true;
    isAwaitingGameStart = false;

    loggers.network.info('game starting', data.gameRoomId);
    const myAssignment = data.players.find((player) => player.playerId === room.sessionId);
    const myTeam = myAssignment?.team || 'red';
    useGameStore.setState({
      gameplayMode: isGameplayMode(data.gameplayMode) ? data.gameplayMode : DEFAULT_GAMEPLAY_MODE,
      matchPerspective: isMatchPerspective(data.matchPerspective) ? data.matchPerspective : DEFAULT_MATCH_PERSPECTIVE,
    });
    setMapSize(data.mapSize);
    useGameStore.getState().setMapProfileId(data.mapProfileId);

    try {
      await joinGameRoomWithRetry(data.gameRoomId, myTeam, data.entryTicket, data.seatReservation);
      hasJoinedGame = true;
      hasFailedGameStart = false;
      isJoiningGame = false;
      clearGameStartTimeout();
    } catch (error) {
      loggers.network.error('failed to join game room', error);
      failPendingGameStart(`Failed to join game: ${getErrorMessage(error)}`);
    }
  });

  room.onMessage('kicked', (data: { reason: string }) => {
    loggers.network.warn('kicked from lobby', data.reason);
    isAwaitingGameStart = false;
    isJoiningGame = false;
    hasJoinedGame = false;
    hasFailedGameStart = false;
    clearGameStartTimeout();
    disconnectVoice('lobby_kicked');
    leaveLobby();
  });

  room.onMessage('partyQueueCancelled', (data: { reason?: string }) => {
    loggers.network.info('party matchmaking cancelled', data.reason ?? 'party leader left matchmaking');
    isAwaitingGameStart = false;
    isJoiningGame = false;
    hasJoinedGame = false;
    hasFailedGameStart = false;
    clearGameStartTimeout();
    disconnectVoice('party_queue_cancelled');
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
    if (hasJoinedGame || hasFailedGameStart) return;
    if (isJoiningGame || isAwaitingGameStart) {
      armGameStartTimeout();
      return;
    }
    disconnectVoice('left_lobby');
    clearGameStartTimeout();
    resetLobby();
    const phase = useGameStore.getState().appPhase;
    if (phase === 'map_vote' || phase === 'in_lobby' || phase === 'matchmaking') {
      setAppPhase('menu');
    }
  });
}
