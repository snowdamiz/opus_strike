import { createContext, useContext, useRef, useCallback, ReactNode } from 'react';
import { Client, Room } from 'colyseus.js';
import { useGameStore, LobbyPlayer, LobbyInfo, LobbyWagerState, MapVoteOption, MapVoteRecord, WagerPaymentIntent, WagerPaymentTransaction } from '../store/gameStore';
import { config } from '../config/environment';
import { getClientId } from '../utils/clientId';
import type {
  BotDifficulty,
  GameEndEvent,
  HeroId,
  Team,
  PlayerInput,
  MovementCommandPacket,
  PlayerPingRequestMessage,
  PlayerPingsMessage,
} from '@voxel-strike/shared';
import type { VoiceScope, VoiceTokenResponse } from '../voice/types';
import { disconnectVoice } from '../voice/voiceControls';

// Import extracted handlers
import {
  createDefaultLocalPlayer,
  syncPlayerFromSchema,
  setupPlayerJoinedHandler,
  setupPlayerTransformsHandler,
  setupSelfMovementAuthorityHandler,
  setupPlayerVitalsHandler,
  setupMatchSnapshotHandler,
  setupPlayerStatesHandler,
  setupVoidZoneHandlers,
  setupCombatHandlers,
  setupPollingSync,
  stopRemotePhantomCharge,
} from './gameMessageHandlers';
import { loggers } from '../utils/logger';

type CreateLobbyWagerOptions = { enabled: boolean; coverChargeLamports?: string; token?: 'SOL' };

// ============================================================================
// CONTEXT TYPE
// ============================================================================

interface NetworkContextType {
  // Lobby operations
  fetchLobbies: () => Promise<LobbyInfo[]>;
  watchLobbies: () => () => void;
  createLobby: (
    playerName: string,
    lobbyName?: string,
    isPrivate?: boolean,
    options?: {
      initialBotCount?: number;
      botFillMode?: 'manual' | 'fill_even' | 'fill_empty';
      defaultBotDifficulty?: BotDifficulty;
      wager?: CreateLobbyWagerOptions;
    }
  ) => Promise<void>;
  quickPlay: (playerName: string) => Promise<void>;
  joinLobby: (playerName: string, lobbyId: string) => Promise<void>;
  leaveLobby: () => void;
  setLobbyReady: (ready: boolean) => void;
  setLobbyTeam: (team: string) => void;
  addLobbyBot: (options?: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }) => void;
  removeLobbyBot: (botId: string) => void;
  updateLobbyBotTeam: (botId: string, team: string) => void;
  updateLobbyBotDifficulty: (botId: string, difficulty: BotDifficulty) => void;
  updateLobbyBotHero: (botId: string, heroId: HeroId | '') => void;
  startGame: () => void;
  voteMap: (optionId: string) => void;
  reportMapVotePreviewsReady: () => void;
  finalizeMapVote: () => void;
  kickPlayer: (playerId: string) => void;
  createWagerPaymentIntent: (lobbyId: string, walletAddress: string, lobbyPlayerId?: string | null) => Promise<WagerPaymentIntent>;
  createWagerPaymentTransaction: (intentId: string) => Promise<WagerPaymentTransaction>;
  submitWagerSignedPaymentTransaction: (intentId: string, signedTransactionBase64: string) => Promise<WagerPaymentIntent>;
  submitWagerPaymentSignature: (intentId: string, signature: string) => Promise<WagerPaymentIntent>;

  // Game operations
  joinGameRoom: (gameRoomId: string, playerName: string, team?: string, entryTicket?: string) => Promise<void>;
  leaveGame: () => void;
  disconnect: () => void;
  sendInput: (input: PlayerInput) => void;
  sendMovementCommands: (packet: MovementCommandPacket) => void;
  requestBlazeBombDrop: () => void;
  reportBlazeRocketImpact: (rocketId: string, position: { x: number; y: number; z: number }) => void;
  selectHero: (heroId: HeroId) => void;
  devSetHero: (heroId: HeroId) => void;
  devFillUltimate: () => void;
  devEndGame: () => void;
  setDevFly: (enabled: boolean) => void;
  setDevImmune: (enabled: boolean) => void;
  setDevTimeFrozen: (enabled: boolean) => void;
  setDevBotsRooted: (enabled: boolean) => void;
  addGameBot: (heroId: HeroId, team: Team) => void;
  selectTeam: (team: Team) => void;
  setReady: (ready: boolean) => void;
  requestVoiceToken: (scope?: VoiceScope) => Promise<VoiceTokenResponse>;

  // NPC/Bot operations (for testing)
  spawnNpc: (heroId: HeroId, team?: Team, position?: { x: number; y: number; z: number }, name?: string) => void;
  damageNpc: (npcId: string, damage: number) => void;
  killNpc: (npcId: string) => void;
  killAllNpcs: () => void;
}

interface QuickPlayTicketResponse {
  ticket: string;
  skillRating: number;
  skillBucket: string;
  skillBucketLabel: string;
  targetSkillBucket: string;
  targetSkillBucketLabel: string;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

function getHttpUrl(): string {
  return config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
}

async function requestQuickPlayTicket(): Promise<QuickPlayTicketResponse> {
  const response = await fetch(`${getHttpUrl()}/matchmaking/quick-play-ticket`, {
    credentials: 'include',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Failed to issue matchmaking ticket' }));
    throw new Error(payload.error || 'Failed to issue matchmaking ticket');
  }

  return response.json();
}

async function wagerApiRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${getHttpUrl()}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Wager request failed' }));
    throw new Error(payload.error || 'Wager request failed');
  }

  return response.json();
}

async function preflightWageredLobby(wager: CreateLobbyWagerOptions | undefined): Promise<void> {
  if (!wager?.enabled) return;
  await wagerApiRequest('/wagers/lobbies/preflight', {
    method: 'POST',
    body: JSON.stringify({ wager }),
  });
}

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

export function NetworkProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<Client | null>(null);
  const lobbyRoomRef = useRef<Room | null>(null);
  const gameRoomRef = useRef<Room | null>(null);
  const isJoiningGameRef = useRef(false);
  const voiceTokenRequestsRef = useRef(new Map<string, {
    resolve: (response: VoiceTokenResponse) => void;
    reject: (error: Error) => void;
    timeoutId: number;
  }>());

  const {
    setConnected,
    setLoading,
    setRoomId,
    setPlayerId,
    setAppPhase,
    setGamePhase,
    setPhaseEndTime,
    setMapSeed,
    setLocalPlayer,
    updatePlayer,
    removePlayer,
    setAvailableLobbies,
    setCurrentLobby,
    setCurrentLobbyWager,
    setLobbyPlayers,
    updateLobbyPlayer,
    removeLobbyPlayer,
    setIsLobbyHost,
    setMatchmakingStatus,
    setMatchSummary,
    setPlayerPings,
    setMapVoteState,
    setMapVotes,
    clearMapVote,
    clearMatchSummary,
    reset,
    resetLobby,
  } = useGameStore();

  // ==================== CLIENT INITIALIZATION ====================

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new Client(config.serverUrl);
    }
    return clientRef.current;
  }, []);

  // ==================== LOBBY OPERATIONS ====================

  const fetchLobbies = useCallback(async (): Promise<LobbyInfo[]> => {
    try {
      const response = await fetch(`${getHttpUrl()}/lobbies`);
      const data = await response.json();
      const lobbies = data.lobbies || [];
      setAvailableLobbies(lobbies);
      return lobbies;
    } catch (error) {
      loggers.network.error('failed to fetch lobbies', error);
      return [];
    }
  }, [setAvailableLobbies]);

  const watchLobbies = useCallback(() => {
    if (typeof EventSource === 'undefined') {
      fetchLobbies();
      return () => {};
    }

    const events = new EventSource(`${getHttpUrl()}/lobbies/stream`);

    events.addEventListener('lobbies', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        setAvailableLobbies(data.lobbies || []);
      } catch (error) {
        loggers.network.error('failed to parse lobby stream event', error);
      }
    });

    events.addEventListener('error', () => {
      if (events.readyState === EventSource.CLOSED) {
        fetchLobbies();
      }
    });

    return () => events.close();
  }, [fetchLobbies, setAvailableLobbies]);

  const rejectPendingVoiceTokenRequests = useCallback((message: string) => {
    voiceTokenRequestsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
    });
    voiceTokenRequestsRef.current.clear();
  }, []);

  const cleanupExistingConnections = useCallback(() => {
    isJoiningGameRef.current = false;
    disconnectVoice('network_cleanup');
    rejectPendingVoiceTokenRequests('connection cleaned up before voice token response');

    if (lobbyRoomRef.current) {
      try {
        lobbyRoomRef.current.leave(false);
      } catch (e) {
        loggers.network.debug('error leaving old lobby room', e);
      }
      lobbyRoomRef.current = null;
    }
    if (gameRoomRef.current) {
      try {
        gameRoomRef.current.leave(false);
      } catch (e) {
        loggers.network.debug('error leaving old game room', e);
      }
      gameRoomRef.current = null;
    }
  }, [rejectPendingVoiceTokenRequests]);

  const setupLobbyListeners = useCallback((room: Room, playerName: string) => {
    room.onMessage('lobbyState', (data: {
      lobbyId: string;
      name: string;
      hostId: string;
      status: string;
      players: any[];
      skillBucket?: string;
      skillBucketLabel?: string;
      averageSkillRating?: number;
      skillSearchDistance?: number;
      wager?: LobbyWagerState;
    }) => {
      loggers.network.debug('received lobby state', data);
      setCurrentLobby(data.lobbyId, data.name);
      setCurrentLobbyWager(data.wager ?? { enabled: false });
      setIsLobbyHost(data.hostId === room.sessionId);
      setMatchmakingStatus({
        skillBucket: data.skillBucket ?? null,
        skillBucketLabel: data.skillBucketLabel ?? null,
        averageSkillRating: typeof data.averageSkillRating === 'number' ? data.averageSkillRating : null,
        skillSearchDistance: typeof data.skillSearchDistance === 'number' ? data.skillSearchDistance : null,
      });
      if (data.status === 'map_vote') {
        setAppPhase('map_vote');
      } else if (data.status === 'matchmaking') {
        setAppPhase('matchmaking');
      }

      const playersMap = new Map<string, LobbyPlayer>();
      for (const p of data.players) {
        playersMap.set(p.id, {
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          isReady: p.isReady,
          team: p.team,
          heroId: p.heroId || '',
          isBot: Boolean(p.isBot),
          botDifficulty: p.botDifficulty || '',
          botProfileId: p.botProfileId,
          paymentStatus: p.paymentStatus || '',
          paymentWalletAddress: p.paymentWalletAddress || '',
          depositSignature: p.depositSignature || '',
          refundSignature: p.refundSignature || '',
        });
      }
      setLobbyPlayers(playersMap);
    });

    room.onMessage('matchmakingStatus', (data: {
      skillBucket?: string;
      skillBucketLabel?: string;
      averageSkillRating?: number;
      skillSearchDistance?: number;
    }) => {
      setMatchmakingStatus({
        skillBucket: data.skillBucket ?? null,
        skillBucketLabel: data.skillBucketLabel ?? null,
        averageSkillRating: typeof data.averageSkillRating === 'number' ? data.averageSkillRating : null,
        skillSearchDistance: typeof data.skillSearchDistance === 'number' ? data.skillSearchDistance : null,
      });
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
      votes: MapVoteRecord[];
    }) => {
      loggers.network.info('map vote finalized', data.mapSeed);
      setMapVotes(data.votes, data.selectedOptionId);
      setMapSeed(data.mapSeed);
    });

    room.onMessage('mapVoteCancelled', (data: { reason?: string; status?: string }) => {
      loggers.network.warn('map vote cancelled', data.reason || 'unknown');
      clearMapVote();
      setAppPhase(data.status === 'matchmaking' ? 'matchmaking' : 'in_lobby');
    });

    room.onMessage('playerJoined', (data: {
      playerId: string;
      playerName: string;
      isHost: boolean;
      isReady?: boolean;
      team?: string;
      heroId?: HeroId | '';
      isBot?: boolean;
      botDifficulty?: BotDifficulty | '';
      botProfileId?: string;
      paymentStatus?: LobbyPlayer['paymentStatus'];
      paymentWalletAddress?: string;
      depositSignature?: string;
      refundSignature?: string;
    }) => {
      loggers.network.debug('player joined lobby', data.playerName);
      updateLobbyPlayer(data.playerId, {
        id: data.playerId,
        name: data.playerName,
        isHost: data.isHost,
        isReady: data.isReady ?? false,
        team: data.team || '',
        heroId: data.heroId || '',
        isBot: Boolean(data.isBot),
        botDifficulty: data.botDifficulty || '',
        botProfileId: data.botProfileId,
        paymentStatus: data.paymentStatus || '',
        paymentWalletAddress: data.paymentWalletAddress || '',
        depositSignature: data.depositSignature || '',
        refundSignature: data.refundSignature || '',
      });
    });

    room.onMessage('paymentStatusChanged', (data: {
      lobbyId: string;
      userId: string;
      lobbyPlayerId: string | null;
      status: LobbyPlayer['paymentStatus'];
      amountLamports: string;
      walletAddress: string;
      depositSignature?: string | null;
      refundSignature?: string | null;
      potLamports: string;
    }) => {
      loggers.network.debug('payment status changed', data.status);
      if (data.lobbyPlayerId) {
        const player = useGameStore.getState().lobbyPlayers.get(data.lobbyPlayerId);
        if (player) {
          updateLobbyPlayer(data.lobbyPlayerId, {
            ...player,
            paymentStatus: data.status,
            paymentWalletAddress: data.walletAddress,
            depositSignature: data.depositSignature || '',
            refundSignature: data.refundSignature || '',
          });
        }
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
      const store = useGameStore.getState();
      const player = store.lobbyPlayers.get(data.playerId);
      if (player) {
        updateLobbyPlayer(data.playerId, { ...player, isReady: data.ready });
      }
    });

    room.onMessage('playerTeamChanged', (data: { playerId: string; team: string }) => {
      const store = useGameStore.getState();
      const player = store.lobbyPlayers.get(data.playerId);
      if (player) {
        updateLobbyPlayer(data.playerId, { ...player, team: data.team });
      }
    });

    room.onMessage('botDifficultyChanged', (data: { playerId: string; difficulty: BotDifficulty }) => {
      const store = useGameStore.getState();
      const player = store.lobbyPlayers.get(data.playerId);
      if (player) {
        updateLobbyPlayer(data.playerId, { ...player, botDifficulty: data.difficulty });
      }
    });

    room.onMessage('botHeroChanged', (data: { playerId: string; heroId: HeroId | '' }) => {
      const store = useGameStore.getState();
      const player = store.lobbyPlayers.get(data.playerId);
      if (player) {
        updateLobbyPlayer(data.playerId, { ...player, heroId: data.heroId });
      }
    });

    room.onMessage('hostChanged', (data: { newHostId: string; newHostName: string }) => {
      loggers.network.debug('host changed', data.newHostName);
      setIsLobbyHost(data.newHostId === room.sessionId);

      const store = useGameStore.getState();
      const updatedPlayers = new Map<string, LobbyPlayer>();
      store.lobbyPlayers.forEach((p, id) => {
        updatedPlayers.set(id, { ...p, isHost: id === data.newHostId });
      });
      setLobbyPlayers(updatedPlayers);
    });

    let isJoiningGame = false;
    room.onMessage('gameStarting', async (data: {
      gameRoomId: string;
      players: { playerId: string; playerName: string; team: string; isBot?: boolean }[];
      entryTicket?: string;
    }) => {
      if (isJoiningGame) {
        loggers.network.debug('ignoring duplicate gameStarting message');
        return;
      }
      isJoiningGame = true;

      loggers.network.info('game starting', data.gameRoomId);
      const myAssignment = data.players.find(p => p.playerId === room.sessionId);
      const myTeam = myAssignment?.team || 'red';

      try {
        await joinGameRoom(data.gameRoomId, playerName, myTeam, data.entryTicket);
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
    });

    room.onError((code, message) => {
      loggers.network.error('lobby room error', code, message);
    });

    room.onLeave((code) => {
      loggers.network.debug('left lobby room', code);
      disconnectVoice('left_lobby');
      resetLobby();
    });
  }, [setCurrentLobby, setCurrentLobbyWager, setIsLobbyHost, setMatchmakingStatus, setLobbyPlayers, updateLobbyPlayer, removeLobbyPlayer, setAppPhase, setMapVoteState, setMapVotes, setMapSeed, clearMapVote, resetLobby]);

  const createLobby = useCallback(async (
    playerName: string,
    lobbyName?: string,
    isPrivate?: boolean,
    options?: {
      initialBotCount?: number;
      botFillMode?: 'manual' | 'fill_even' | 'fill_empty';
      defaultBotDifficulty?: BotDifficulty;
      wager?: CreateLobbyWagerOptions;
    }
  ) => {
    setLoading(true);

    try {
      await preflightWageredLobby(options?.wager);
      cleanupExistingConnections();

      const client = getClient();
      const clientId = getClientId();

      loggers.network.debug('creating lobby with client id', clientId);

      lobbyRoomRef.current = await client.create('lobby_room', {
        playerName,
        lobbyName: lobbyName || `${playerName}'s Lobby`,
        isPrivate: isPrivate || false,
        clientId,
        initialBotCount: options?.initialBotCount || 0,
        botFillMode: options?.botFillMode || 'manual',
        defaultBotDifficulty: options?.defaultBotDifficulty || 'normal',
        wager: options?.wager,
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      setCurrentLobby(lobbyRoomRef.current.id, lobbyName || `${playerName}'s Lobby`);
      setIsLobbyHost(true);
      setAppPhase('in_lobby');
      setConnected(true);
      setLoading(false);

      loggers.network.info('created lobby', lobbyRoomRef.current.id);
    } catch (error) {
      loggers.network.error('failed to create lobby', error);
      setLoading(false);
      throw error;
    }
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setCurrentLobby, setIsLobbyHost, setAppPhase, setConnected]);

  const quickPlay = useCallback(async (playerName: string) => {
    setLoading(true);

    try {
      cleanupExistingConnections();

      const client = getClient();
      const clientId = getClientId();
      const matchmakingTicket = await requestQuickPlayTicket();

      loggers.network.debug('quick play matchmaking with client id', clientId, matchmakingTicket.targetSkillBucket);

      lobbyRoomRef.current = await client.joinOrCreate('lobby_room', {
        playerName,
        lobbyName: 'Quick Play',
        isPrivate: false,
        matchmakingMode: true,
        matchmakingTicket: matchmakingTicket.ticket,
        skillBucket: matchmakingTicket.targetSkillBucket,
        clientId,
        initialBotCount: 0,
        botFillMode: 'manual',
        defaultBotDifficulty: 'normal',
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      setAppPhase('matchmaking');
      setConnected(true);
      setLoading(false);

      loggers.network.info('quick play joined lobby', lobbyRoomRef.current.id);
    } catch (error) {
      loggers.network.error('quick play matchmaking failed', error);
      setLoading(false);
      throw error;
    }
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setAppPhase, setConnected]);

  const joinLobby = useCallback(async (playerName: string, lobbyId: string) => {
    setLoading(true);

    try {
      cleanupExistingConnections();

      const client = getClient();
      const clientId = getClientId();

      loggers.network.debug('joining lobby with client id', clientId);

      lobbyRoomRef.current = await client.joinById(lobbyId, {
        playerName,
        clientId,
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      setAppPhase('in_lobby');
      setConnected(true);
      setLoading(false);

      loggers.network.info('joined lobby', lobbyRoomRef.current.id);
    } catch (error) {
      loggers.network.error('failed to join lobby', error);
      setLoading(false);
      throw error;
    }
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setAppPhase, setConnected]);

  const leaveLobby = useCallback(() => {
    disconnectVoice('leave_lobby');
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.leave();
      lobbyRoomRef.current = null;
    }
    isJoiningGameRef.current = false;
    resetLobby();
    setAppPhase('browsing_lobbies');
    setConnected(false);
  }, [resetLobby, setAppPhase, setConnected]);

  const setLobbyReady = useCallback((ready: boolean) => {
    lobbyRoomRef.current?.send('ready', { ready });
  }, []);

  const setLobbyTeam = useCallback((team: string) => {
    lobbyRoomRef.current?.send('setTeam', { team });
  }, []);

  const addLobbyBot = useCallback((options?: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }) => {
    lobbyRoomRef.current?.send('addBot', options || {});
  }, []);

  const removeLobbyBot = useCallback((botId: string) => {
    lobbyRoomRef.current?.send('removeBot', { botId });
  }, []);

  const updateLobbyBotTeam = useCallback((botId: string, team: string) => {
    lobbyRoomRef.current?.send('updateBotTeam', { botId, team });
  }, []);

  const updateLobbyBotDifficulty = useCallback((botId: string, difficulty: BotDifficulty) => {
    lobbyRoomRef.current?.send('updateBotDifficulty', { botId, difficulty });
  }, []);

  const updateLobbyBotHero = useCallback((botId: string, heroId: HeroId | '') => {
    lobbyRoomRef.current?.send('updateBotHero', { botId, heroId });
  }, []);

  const startGame = useCallback(() => {
    lobbyRoomRef.current?.send('startGame');
  }, []);

  const voteMap = useCallback((optionId: string) => {
    lobbyRoomRef.current?.send('voteMap', { optionId });
  }, []);

  const reportMapVotePreviewsReady = useCallback(() => {
    lobbyRoomRef.current?.send('mapVotePreviewsReady');
  }, []);

  const finalizeMapVote = useCallback(() => {
    lobbyRoomRef.current?.send('finalizeMapVote');
  }, []);

  const kickPlayer = useCallback((playerId: string) => {
    lobbyRoomRef.current?.send('kick', { playerId });
  }, []);

  const createWagerPaymentIntent = useCallback(async (
    lobbyId: string,
    walletAddress: string,
    lobbyPlayerId?: string | null
  ): Promise<WagerPaymentIntent> => {
    const response = await wagerApiRequest<{ intent: WagerPaymentIntent }>(
      `/wagers/lobbies/${encodeURIComponent(lobbyId)}/intents`,
      {
        method: 'POST',
        body: JSON.stringify({ walletAddress, lobbyPlayerId }),
      }
    );
    return response.intent;
  }, []);

  const submitWagerPaymentSignature = useCallback(async (
    intentId: string,
    signature: string
  ): Promise<WagerPaymentIntent> => {
    const response = await wagerApiRequest<{ intent: WagerPaymentIntent }>(
      `/wagers/intents/${encodeURIComponent(intentId)}/signature`,
      {
        method: 'POST',
        body: JSON.stringify({ signature }),
      }
    );
    return response.intent;
  }, []);

  const createWagerPaymentTransaction = useCallback(async (
    intentId: string
  ): Promise<WagerPaymentTransaction> => {
    const response = await wagerApiRequest<{ transaction: WagerPaymentTransaction }>(
      `/wagers/intents/${encodeURIComponent(intentId)}/transaction`,
      { method: 'POST' }
    );
    return response.transaction;
  }, []);

  const submitWagerSignedPaymentTransaction = useCallback(async (
    intentId: string,
    signedTransactionBase64: string
  ): Promise<WagerPaymentIntent> => {
    const response = await wagerApiRequest<{ intent: WagerPaymentIntent }>(
      `/wagers/intents/${encodeURIComponent(intentId)}/signed-transaction`,
      {
        method: 'POST',
        body: JSON.stringify({ signedTransactionBase64 }),
      }
    );
    return response.intent;
  }, []);

  // ==================== GAME ROOM OPERATIONS ====================

  const setupGameListeners = useCallback((room: Room, playerName: string) => {
    const sessionId = room.sessionId;
    const localPlayerName = playerName;

    // Create default local player
    setLocalPlayer(createDefaultLocalPlayer(sessionId, playerName));

    // Cleanup ghost players
    useGameStore.getState().cleanupGhostPlayers();

    // Store actions for handlers
    const actions = { setLocalPlayer, updatePlayer, removePlayer, setGamePhase };

    // Set up MapSchema callbacks
    const playersMap = room.state.players as any;
    if (playersMap && typeof playersMap.onAdd === 'function') {
      playersMap.onAdd((schemaPlayer: any, id: string) => {
        loggers.network.debug('player added via schema', id, schemaPlayer?.name);
        syncPlayerFromSchema(schemaPlayer, id, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });

        if (typeof schemaPlayer?.onChange === 'function') {
          schemaPlayer.onChange(() => {
            syncPlayerFromSchema(schemaPlayer, id, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });
          });
        }
      });

      playersMap.onRemove((_schemaPlayer: any, id: string) => {
        loggers.network.debug('player removed via schema', id);
        if (id !== sessionId) {
          removePlayer(id);
        }
      });
    }

    const enableFallbackPolling = import.meta.env.DEV && import.meta.env.VITE_ENABLE_SCHEMA_POLLING === '1';
    const syncInterval = enableFallbackPolling
      ? setupPollingSync(room, sessionId, localPlayerName, actions)
      : null;

    // Set up message handlers
    room.onMessage('phaseChange', (data: { phase: string; endTime: number; mapSeed?: number }) => {
      loggers.network.debug('phase change message', data.phase);
      if (typeof data.mapSeed === 'number') {
        setMapSeed(data.mapSeed);
      }
      setGamePhase(data.phase as any);
      setPhaseEndTime(data.endTime);
    });

    room.onMessage('gameEnd', (data: GameEndEvent) => {
      loggers.network.info('game ended', data.finalScore);
      setMatchSummary(data);
      setGamePhase('game_end' as any);
      setPhaseEndTime(null);
    });

    setupPlayerJoinedHandler(room, sessionId, localPlayerName, updatePlayer);
    setupPlayerTransformsHandler(room, sessionId, localPlayerName, { setLocalPlayer });
    setupSelfMovementAuthorityHandler(room, { setLocalPlayer });
    setupPlayerVitalsHandler(room, sessionId, localPlayerName, { setLocalPlayer, updatePlayer, removePlayer });
    setupMatchSnapshotHandler(room);
    setupPlayerStatesHandler(room, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });
    setupVoidZoneHandlers(room, sessionId);
    setupCombatHandlers(room);

    room.onMessage('playerPingRequest', (data: PlayerPingRequestMessage) => {
      if (!data || typeof data.nonce !== 'string') return;
      room.send('playerPingResponse', { nonce: data.nonce });
    });

    room.onMessage('playerPings', (data: PlayerPingsMessage) => {
      setPlayerPings(data);
    });

    room.onMessage('playerLeft', (data: { playerId: string }) => {
      loggers.network.debug('player left', data.playerId);
      stopRemotePhantomCharge(data.playerId);
      removePlayer(data.playerId);
    });

    room.onMessage('duplicateSession', (data: { reason: string }) => {
      loggers.network.warn('duplicate session detected', data.reason);
      disconnectVoice('duplicate_game_session');
    });

    room.onMessage('voiceToken', (data: VoiceTokenResponse) => {
      const pending = voiceTokenRequestsRef.current.get(data.requestId);
      if (!pending) {
        loggers.network.debug('received unmatched voice token response', data.requestId);
        return;
      }

      window.clearTimeout(pending.timeoutId);
      voiceTokenRequestsRef.current.delete(data.requestId);
      pending.resolve(data);
    });

    room.onMessage('voiceTeamChanged', () => {
      disconnectVoice('voice_team_changed');
    });

    room.onMessage('devHeroChanged', (data: { heroId: HeroId; health: number; maxHealth: number }) => {
      loggers.network.debug('developer hero switch confirmed', data.heroId);
      const store = useGameStore.getState();
      if (store.localPlayer) {
        setLocalPlayer({
          ...store.localPlayer,
          heroId: data.heroId,
          health: data.health,
          maxHealth: data.maxHealth,
        });
      }
    });

    room.onMessage('devCommandError', (data: { message: string }) => {
      loggers.network.error('developer command error:', data.message);
    });

    room.onError((code, message) => {
      loggers.network.error('room error:', code, message);
    });

    room.onLeave((code) => {
      loggers.network.debug('left room', code);
      if (syncInterval) clearInterval(syncInterval);
      rejectPendingVoiceTokenRequests('game room left before voice token response');
      disconnectVoice('left_game_room');
      if (gameRoomRef.current === room) {
        gameRoomRef.current = null;
      }
      isJoiningGameRef.current = false;
      setLoading(false);
      setConnected(false);
      setRoomId(null);
      setGamePhase('waiting');
      resetLobby();
      setAppPhase('browsing_lobbies');
    });

    setConnected(true);
  }, [setConnected, setLoading, setGamePhase, setPhaseEndTime, setMapSeed, setLocalPlayer, updatePlayer, removePlayer, setAppPhase, setRoomId, resetLobby, rejectPendingVoiceTokenRequests, setMatchSummary, setPlayerPings]);

  const joinGameRoom = useCallback(async (gameRoomId: string, playerName: string, team?: string, entryTicket?: string) => {
    if (isJoiningGameRef.current) {
      loggers.network.debug('already joining a game room, ignoring duplicate call');
      return;
    }
    isJoiningGameRef.current = true;

    setLoading(true);

    try {
      if (gameRoomRef.current) {
        loggers.network.debug('cleaning up existing game room');
        try {
          gameRoomRef.current.leave(false);
        } catch (e) {
          loggers.network.debug('error leaving old game room', e);
        }
        gameRoomRef.current = null;
      }

      useGameStore.getState().setPlayers(new Map());
      clearMatchSummary();
      setGamePhase('waiting');
      setPhaseEndTime(null);

      const client = getClient();
      const clientId = getClientId();

      loggers.network.debug('joining game room with client id', clientId);

      gameRoomRef.current = await client.joinById(gameRoomId, {
        playerName,
        preferredTeam: team,
        clientId,
        entryTicket,
      });

      setupGameListeners(gameRoomRef.current, playerName);

      setRoomId(gameRoomRef.current.id);
      setAppPhase('in_game');
      setLoading(false);

      loggers.network.info('joined game room', gameRoomRef.current.id);
    } catch (error) {
      loggers.network.error('failed to join game room', error);
      setLoading(false);
      isJoiningGameRef.current = false;
      throw error;
    }
  }, [getClient, setupGameListeners, setLoading, setRoomId, setAppPhase, clearMatchSummary, setGamePhase, setPhaseEndTime]);

  const leaveGame = useCallback(() => {
    disconnectVoice('leave_game');
    rejectPendingVoiceTokenRequests('left game before voice token response');
    gameRoomRef.current?.leave();
    gameRoomRef.current = null;
    lobbyRoomRef.current?.leave();
    lobbyRoomRef.current = null;
    isJoiningGameRef.current = false;
    setRoomId(null);
    setConnected(false);
    resetLobby();
    clearMatchSummary();
    setGamePhase('waiting' as any);
    setAppPhase('browsing_lobbies');
  }, [setRoomId, setConnected, resetLobby, clearMatchSummary, setGamePhase, setAppPhase, rejectPendingVoiceTokenRequests]);

  const disconnect = useCallback(() => {
    disconnectVoice('network_disconnect');
    rejectPendingVoiceTokenRequests('network disconnected before voice token response');
    gameRoomRef.current?.leave();
    gameRoomRef.current = null;
    lobbyRoomRef.current?.leave();
    lobbyRoomRef.current = null;
    clientRef.current = null;
    isJoiningGameRef.current = false;
    reset();
  }, [reset, rejectPendingVoiceTokenRequests]);

  const requestVoiceToken = useCallback((scope: VoiceScope = 'match'): Promise<VoiceTokenResponse> => {
    const room = gameRoomRef.current;
    if (!room) {
      return Promise.resolve({
        requestId: 'not-connected',
        enabled: false,
        scope,
        mode: 'team',
        reason: 'not connected to game room',
      });
    }

    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise<VoiceTokenResponse>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        voiceTokenRequestsRef.current.delete(requestId);
        reject(new Error('voice token request timed out'));
      }, 8000);

      voiceTokenRequestsRef.current.set(requestId, { resolve, reject, timeoutId });
      room.send('requestVoiceToken', { requestId, scope });
    });
  }, []);

  // ==================== GAME ACTIONS ====================

  const sendInput = useCallback((input: PlayerInput) => {
    gameRoomRef.current?.send('input', input);
  }, []);

  const sendMovementCommands = useCallback((packet: MovementCommandPacket) => {
    if (packet.commands.length === 0) return;
    gameRoomRef.current?.send('movementCommands', packet);
  }, []);

  const requestBlazeBombDrop = useCallback(() => {
    gameRoomRef.current?.send('blazeBombDrop', {});
  }, []);

  const reportBlazeRocketImpact = useCallback((rocketId: string, position: { x: number; y: number; z: number }) => {
    gameRoomRef.current?.send('blazeRocketImpact', { rocketId, position });
  }, []);

  const selectHero = useCallback((heroId: HeroId) => {
    loggers.network.debug('sending selectHero', heroId);
    gameRoomRef.current?.send('selectHero', { heroId });
  }, []);

  const devSetHero = useCallback((heroId: HeroId) => {
    if (!config.isDev) return;
    loggers.network.debug('sending development selectHero', heroId);
    gameRoomRef.current?.send('devSetHero', { heroId });
  }, []);

  const devFillUltimate = useCallback(() => {
    if (!config.isDev) return;
    loggers.network.debug('sending development ultimate fill');
    gameRoomRef.current?.send('devFillUltimate', {});
  }, []);

  const devEndGame = useCallback(() => {
    if (!config.isDev) return;
    loggers.network.debug('sending development game end');
    gameRoomRef.current?.send('devEndGame', {});
  }, []);

  const setDevFly = useCallback((enabled: boolean) => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('setDevFly', { enabled });
  }, []);

  const setDevImmune = useCallback((enabled: boolean) => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('setDevImmune', { enabled });
  }, []);

  const setDevTimeFrozen = useCallback((enabled: boolean) => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('setDevTimeFrozen', { enabled });
  }, []);

  const setDevBotsRooted = useCallback((enabled: boolean) => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('setDevBotsRooted', { enabled });
  }, []);

  const addGameBot = useCallback((heroId: HeroId, team: Team) => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('devAddBot', { heroId, team });
  }, []);

  const selectTeam = useCallback((team: Team) => {
    loggers.network.debug('sending selectTeam', team);
    gameRoomRef.current?.send('selectTeam', { team });
  }, []);

  const setReady = useCallback((ready: boolean) => {
    loggers.network.debug('sending ready', ready);
    gameRoomRef.current?.send('ready', { ready });
  }, []);

  // ==================== NPC OPERATIONS ====================

  const spawnNpc = useCallback((heroId: HeroId, team?: Team, position?: { x: number; y: number; z: number }, name?: string) => {
    if (gameRoomRef.current) {
      const data: any = { heroId, position, name };
      if (team) data.team = team;
      gameRoomRef.current.send('spawnNpc', data);
    }
  }, []);

  const damageNpc = useCallback((npcId: string, damage: number) => {
    gameRoomRef.current?.send('damageNpc', { npcId, damage });
  }, []);

  const killNpc = useCallback((npcId: string) => {
    gameRoomRef.current?.send('killNpc', { npcId });
  }, []);

  const killAllNpcs = useCallback(() => {
    gameRoomRef.current?.send('killAllNpcs', {});
  }, []);

  // ==================== RENDER ====================

  return (
    <NetworkContext.Provider value={{
      fetchLobbies,
      watchLobbies,
      createLobby,
      quickPlay,
      joinLobby,
      leaveLobby,
      setLobbyReady,
      setLobbyTeam,
      addLobbyBot,
      removeLobbyBot,
      updateLobbyBotTeam,
      updateLobbyBotDifficulty,
      updateLobbyBotHero,
      startGame,
      voteMap,
      reportMapVotePreviewsReady,
      finalizeMapVote,
      kickPlayer,
      createWagerPaymentIntent,
      createWagerPaymentTransaction,
      submitWagerSignedPaymentTransaction,
      submitWagerPaymentSignature,
      joinGameRoom,
      leaveGame,
      disconnect,
      sendInput,
      sendMovementCommands,
      requestBlazeBombDrop,
      reportBlazeRocketImpact,
      selectHero,
      devSetHero,
      devFillUltimate,
      devEndGame,
      setDevFly,
      setDevImmune,
      setDevTimeFrozen,
      setDevBotsRooted,
      addGameBot,
      selectTeam,
      setReady,
      requestVoiceToken,
      spawnNpc,
      damageNpc,
      killNpc,
      killAllNpcs,
    }}>
      {children}
    </NetworkContext.Provider>
  );
}

// ============================================================================
// HOOK
// ============================================================================

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
