import { createContext, useContext, useRef, useCallback, useState, ReactNode } from 'react';
import { Client, Room } from 'colyseus.js';
import { useGameStore, LobbyPlayer, LobbyWagerState, MapVoteOption, MapVoteRecord, WagerPaymentIntent, WagerPaymentTransaction } from '../store/gameStore';
import { config } from '../config/environment';
import { getClientId } from '../utils/clientId';
import {
  createRandomSeed,
  getHeroStats,
  MOVEMENT_PROTOCOL_VERSION,
  type AbilityCastOriginHint,
  type BotDifficulty,
  type GameEndEvent,
  type HeroId,
  type Team,
  type PublicRankSnapshot,
  type MovementCommandPacket,
  type PlayerPingRequestMessage,
  type PlayerPingsMessage,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import type { VoiceScope, VoiceTokenResponse } from '../voice/types';
import { disconnectVoice } from '../voice/voiceControls';
import { prepareVoxelMapCpu } from '../utils/mapWarmup/mapPrepCache';

// Import extracted handlers
import {
  createDefaultLocalPlayer,
  syncPlayerFromSchema,
  setupPlayerJoinedHandler,
  setupPlayerTransformsHandler,
  setupPlayerInterestHandler,
  setupSelfMovementAuthorityHandler,
  setupPlayerVitalsHandler,
  setupMatchSnapshotHandler,
  setupVoidZoneHandlers,
  setupCombatHandlers,
  setupPollingSync,
  forgetPlayerNetId,
  stopRemotePhantomCharge,
} from './gameMessageHandlers';
import { loggers } from '../utils/logger';
import {
  movementStateFromPlayer,
  resetLocalMovementPrediction,
} from '../movement/localPrediction';
import { measureFrameWork } from '../movement/networkDiagnostics';
import { projectileInitialState } from '../store/slices/projectiles';
import { resetGameTiming } from '../store/gameTimingStore';

type CreateLobbyWagerOptions = { enabled: boolean; coverChargeLamports?: string; token?: 'SOL' };
type CreateLobbyOptions = {
  initialBotCount?: number;
  botFillMode?: 'manual' | 'fill_even' | 'fill_empty';
  defaultBotDifficulty?: BotDifficulty;
  wager?: CreateLobbyWagerOptions;
  mapSeed?: number;
  forceGoldenMapOption?: boolean;
  observersEnabled?: boolean;
};
type StartPracticeGameOptions = { mapSeed?: number };

// ============================================================================
// CONTEXT TYPE
// ============================================================================

interface NetworkContextType {
  // Lobby operations
  createLobby: (
    playerName: string,
    lobbyName?: string,
    options?: CreateLobbyOptions
  ) => Promise<void>;
  quickPlay: (playerName: string) => Promise<void>;
  rankedPlay: (playerName: string) => Promise<void>;
  getRankedTokenHoldStatus: () => Promise<RankedTokenHoldStatus>;
  startPracticeGame: (playerName?: string, options?: StartPracticeGameOptions) => void;
  joinLobby: (playerName: string, lobbyId: string) => Promise<void>;
  leaveLobby: () => void;
  setLobbyReady: (ready: boolean) => void;
  setLobbyTeam: (team: string) => void;
  setLobbyObserver: (observer: boolean) => void;
  devSetLobbyObserver: (observer: boolean) => void;
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
  createWagerPaymentIntent: (lobbyId: string, walletAddress: string, lobbyPlayerId?: string | null, rankedEntryQuoteId?: string | null) => Promise<WagerPaymentIntent>;
  createWagerPaymentTransaction: (intentId: string) => Promise<WagerPaymentTransaction>;
  submitWagerSignedPaymentTransaction: (intentId: string, signedTransactionBase64: string) => Promise<WagerPaymentIntent>;
  submitWagerPaymentSignature: (intentId: string, signature: string) => Promise<WagerPaymentIntent>;

  // Game operations
  joinGameRoom: (gameRoomId: string, playerName: string, team?: string, entryTicket?: string, observer?: boolean) => Promise<void>;
  leaveGame: () => void;
  disconnect: () => void;
  sendMovementCommands: (packet: MovementCommandPacket) => void;
  requestBlazeBombDrop: (payload?: { abilityCastHints?: AbilityCastOriginHint[] }) => void;
  selectHero: (heroId: HeroId) => void;
  devSetHero: (heroId: HeroId) => void;
  devFillUltimate: () => void;
  devEndGame: () => void;
  devSetGameObserver: () => void;
  setDevImmune: (enabled: boolean) => void;
  setDevTimeFrozen: (enabled: boolean) => void;
  setDevBotsRooted: (enabled: boolean) => void;
  setDevBotBrainEnabled: (enabled: boolean) => void;
  addGameBot: (heroId: HeroId, team: Team) => void;
  selectTeam: (team: Team) => void;
  setReady: (ready: boolean) => void;
  matchStartGateKey: number | null;
  reportMatchSceneReady: () => void;
  reportPlayer: (targetPlayerId: string, reason?: string, details?: string) => Promise<void>;
  requestVoiceToken: (scope?: VoiceScope) => Promise<VoiceTokenResponse>;

  // NPC/Bot operations (for testing)
  spawnNpc: (heroId: HeroId, team?: Team, position?: { x: number; y: number; z: number }, name?: string) => void;
  damageNpc: (npcId: string, damage: number) => void;
  killNpc: (npcId: string) => void;
  killAllNpcs: () => void;
}

interface QuickPlayTicketResponse {
  ticket: string;
  mode: 'quick_play';
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: unknown;
  isGuest: boolean;
  targetRankDivisionIndex: number;
  targetRankLabel: string;
}

export interface RankedTokenHoldStatus {
  eligible: boolean;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenDecimals: number | null;
  usdCents: number;
  tokenUsdPrice: string;
  tokenUsdPriceMicroUsd: string;
  requiredTokenBaseUnits: string;
  balanceTokenBaseUnits: string;
  cluster: string;
  priceSource: string;
  checkedAt: string;
}

interface RankedTicketResponse {
  ticket: string;
  mode: 'ranked';
  competitiveRating: number;
  rankDivisionIndex: number;
  rank: unknown;
  isGuest: false;
  targetRankDivisionIndex: number;
  targetRankLabel: string;
  tokenHold: RankedTokenHoldStatus;
}

interface PlayerReportResultMessage {
  requestId?: string | null;
  ok: boolean;
  reportId?: string;
  error?: string;
}

interface MatchStartGateMessage {
  key: number;
  serverTime?: number;
  mapSeed?: number;
  mapThemeId?: VoxelMapTheme['id'] | null;
  position?: { x: number; y: number; z: number };
}

interface MatchCancelledMessage {
  reason?: string;
  message?: string;
  roomId?: string;
  requiredHumanPlayers?: number;
  connectedHumanPlayers?: number;
  refundedWager?: boolean;
  serverTime?: number;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

function measureNetworkMessage<T>(type: string, handler: (data: T) => void): (data: T) => void {
  return (data) => {
    measureFrameWork(`network.${type}`, () => handler(data));
  };
}

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

async function requestRankedTicket(): Promise<RankedTicketResponse> {
  const response = await fetch(`${getHttpUrl()}/matchmaking/ranked-ticket`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Failed to issue ranked ticket' }));
    throw new Error(payload.error || 'Failed to issue ranked ticket');
  }

  return response.json();
}

async function requestRankedTokenHoldStatus(): Promise<RankedTokenHoldStatus> {
  const response = await fetch(`${getHttpUrl()}/matchmaking/ranked-token-hold-status`, {
    credentials: 'include',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Failed to check ranked token holding' }));
    throw new Error(payload.error || 'Failed to check ranked token holding');
  }

  const payload = await response.json() as { tokenHold: RankedTokenHoldStatus };
  return payload.tokenHold;
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

function createPracticePlayerId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `practice:${crypto.randomUUID()}`;
  }

  return `practice:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function resolvePracticePlayerName(playerName?: string): string {
  const requestedName = playerName?.trim();
  if (requestedName) return requestedName;

  const storeName = useGameStore.getState().playerName.trim();
  return storeName || 'Practice';
}

function runAfterNextPaint(callback: () => void): void {
  if (typeof window === 'undefined') {
    setTimeout(callback, 0);
    return;
  }

  let hasRun = false;
  const runOnce = () => {
    if (hasRun) return;
    hasRun = true;
    callback();
  };

  if (typeof window.requestAnimationFrame !== 'function') {
    window.setTimeout(runOnce, 0);
    return;
  }

  const fallbackTimeout = window.setTimeout(runOnce, 100);
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      window.clearTimeout(fallbackTimeout);
      runOnce();
    }, 0);
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
  const practiceStartTokenRef = useRef(0);
  const [matchStartGateKey, setMatchStartGateKeyState] = useState<number | null>(null);
  const matchStartGateKeyRef = useRef<number | null>(null);
  const voiceTokenRequestsRef = useRef(new Map<string, {
    resolve: (response: VoiceTokenResponse) => void;
    reject: (error: Error) => void;
    timeoutId: number;
  }>());
  const playerReportRequestsRef = useRef(new Map<string, {
    resolve: () => void;
    reject: (error: Error) => void;
    timeoutId: number;
  }>());

  const {
    setConnected,
    setLoading,
    setRoomId,
    setPlayerId,
    setPlayerName,
    setPracticeMode,
    setPracticePreparing,
    setAppPhase,
    setGamePhase,
    setPhaseEndTime,
    setMapSeed,
    setMapThemeId,
    setLocalPlayer,
    updatePlayer,
    removePlayer,
    setCurrentLobby,
    setCurrentLobbyWager,
    setLobbyPlayers,
    updateLobbyPlayer,
    removeLobbyPlayer,
    setIsLobbyHost,
    setLobbyObserverSettings,
    setObserverMode,
    setMatchmakingStatus,
    setMatchSummary,
    setPlayerPings,
    setMapVoteState,
    setMapVotes,
    clearMapVote,
    clearMatchSummary,
    reset,
    resetLobby,
  } = useGameStore.getState();

  const setMatchStartGateKey = useCallback((key: number | null) => {
    matchStartGateKeyRef.current = key;
    setMatchStartGateKeyState((current) => (current === key ? current : key));
  }, []);

  // ==================== CLIENT INITIALIZATION ====================

  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new Client(config.serverUrl);
    }
    return clientRef.current;
  }, []);

  // ==================== LOBBY OPERATIONS ====================

  const rejectPendingVoiceTokenRequests = useCallback((message: string) => {
    voiceTokenRequestsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
    });
    voiceTokenRequestsRef.current.clear();
  }, []);

  const rejectPendingPlayerReportRequests = useCallback((message: string) => {
    playerReportRequestsRef.current.forEach((pending) => {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error(message));
    });
    playerReportRequestsRef.current.clear();
  }, []);

  const cleanupExistingConnections = useCallback(() => {
    practiceStartTokenRef.current += 1;
    isJoiningGameRef.current = false;
    disconnectVoice('network_cleanup');
    rejectPendingVoiceTokenRequests('connection cleaned up before voice token response');
    rejectPendingPlayerReportRequests('connection cleaned up before report response');
    setObserverMode(false);

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
  }, [rejectPendingPlayerReportRequests, rejectPendingVoiceTokenRequests, setObserverMode]);

  const startPracticeGame = useCallback((playerName?: string, options?: StartPracticeGameOptions) => {
    const name = resolvePracticePlayerName(playerName);

    cleanupExistingConnections();
    resetLobby();
    rejectPendingVoiceTokenRequests('practice mode started');
    setPlayerName(name);
    setPracticeMode(true);
    setLoading(false);
    setPracticePreparing(true);

    const startToken = ++practiceStartTokenRef.current;

    runAfterNextPaint(() => {
      if (practiceStartTokenRef.current !== startToken) return;

      try {
        const seed = typeof options?.mapSeed === 'number'
          ? options.mapSeed >>> 0
          : createRandomSeed();
        const preparedMap = prepareVoxelMapCpu({ seed, source: 'match' });
        const spawnPoints = [
          ...preparedMap.manifest.spawnPoints.red,
          ...preparedMap.manifest.spawnPoints.blue,
        ];
        const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)] ?? { x: 0, y: 1, z: 0 };
        const playerId = createPracticePlayerId();
        const player = createDefaultLocalPlayer(playerId, name);

        player.state = 'selecting';
        player.position = { ...spawn };
        player.team = 'red';
        player.isReady = false;
        player.heroId = null;
        player.hasFlag = false;

        useGameStore.setState({
          ...projectileInitialState,
          isConnected: false,
          isLoading: false,
          isPracticeMode: true,
          isPracticePreparing: false,
          roomId: null,
          playerId,
          appPhase: 'in_game',
          gamePhase: 'hero_select',
          matchSummary: null,
          appliedExperienceMatchId: null,
          mapSeed: seed,
          mapThemeId: null,
          redScore: 0,
          blueScore: 0,
          redFlag: null,
          blueFlag: null,
          players: new Map([[playerId, player]]),
          localPlayer: player,
          playerPings: new Map(),
          roundTimeRemaining: 0,
          phaseEndTime: null,
          pendingInputs: [],
          lastProcessedTick: 0,
          ultimateEffectActive: false,
          ultimateEffectType: null,
          ultimateEffectEndTime: 0,
          clientCooldowns: {},
          clientCharges: {},
          unstuckCooldownUntil: 0,
          unstuckRequestId: 0,
          slideIntensity: 0,
          isObserverMode: false,
        });
        resetGameTiming(Date.now());
        resetLocalMovementPrediction(movementStateFromPlayer(player), 0, player.id);
        setRoomId(null);
        setConnected(false);

        loggers.network.info('started local practice', seed);
      } catch (error) {
        loggers.network.error('failed to start local practice', error);
        practiceStartTokenRef.current += 1;
        useGameStore.setState({
          isPracticePreparing: false,
          isPracticeMode: false,
          appPhase: 'menu',
          gamePhase: 'waiting',
        });
      }
    });
  }, [
    cleanupExistingConnections,
    rejectPendingVoiceTokenRequests,
    resetLobby,
    setConnected,
    setLoading,
    setPlayerName,
    setPracticePreparing,
    setPracticeMode,
    setRoomId,
  ]);

  const setupLobbyListeners = useCallback((room: Room, playerName: string) => {
    room.onMessage('lobbyState', (data: {
      lobbyId: string;
      name: string;
      matchMode?: LobbyWagerState['matchMode'];
      hostId: string;
      status: string;
      players: any[];
      observersEnabled?: boolean;
      maxObservers?: number;
      rankBandId?: number;
      rankBandLabel?: string;
      averageCompetitiveRating?: number;
      averageVisibleRank?: string;
      rankSearchDistance?: number;
      queuedHumanCount?: number;
      provisionalHumanCount?: number;
      requiredPlayers?: number;
      rankedCoverChargeLamports?: string;
      rankedEntryQuoteId?: string;
      wager?: LobbyWagerState;
    }) => {
      loggers.network.debug('received lobby state', data);
      setCurrentLobby(data.lobbyId, data.name);
      const currentWager = useGameStore.getState().currentLobbyWager;
      const nextWager = data.wager ?? { enabled: false };
      setCurrentLobbyWager({
        ...nextWager,
        rankedEntryQuoteExpiresAt: nextWager.rankedEntryQuoteExpiresAt ?? currentWager.rankedEntryQuoteExpiresAt ?? null,
      });
      setIsLobbyHost(data.hostId === room.sessionId);
      setLobbyObserverSettings(Boolean(data.observersEnabled), typeof data.maxObservers === 'number' ? data.maxObservers : 0);
      setMatchmakingStatus({
        matchMode: data.matchMode ?? null,
        rankBandId: typeof data.rankBandId === 'number' ? data.rankBandId : null,
        rankBandLabel: data.rankBandLabel ?? null,
        averageCompetitiveRating: typeof data.averageCompetitiveRating === 'number' ? data.averageCompetitiveRating : null,
        averageVisibleRank: data.averageVisibleRank ?? null,
        rankSearchDistance: typeof data.rankSearchDistance === 'number' ? data.rankSearchDistance : null,
        queuedHumanCount: typeof data.queuedHumanCount === 'number' ? data.queuedHumanCount : null,
        provisionalHumanCount: typeof data.provisionalHumanCount === 'number' ? data.provisionalHumanCount : null,
        requiredPlayers: typeof data.requiredPlayers === 'number' ? data.requiredPlayers : null,
        rankedCoverChargeLamports: data.rankedCoverChargeLamports ?? null,
        rankedEntryQuoteId: data.rankedEntryQuoteId ?? data.wager?.rankedEntryQuoteId ?? null,
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
          isObserver: Boolean(p.isObserver),
          heroId: p.heroId || '',
          isBot: Boolean(p.isBot),
          botDifficulty: p.botDifficulty || '',
          botProfileId: p.botProfileId,
          paymentStatus: p.paymentStatus || '',
          paymentWalletAddress: p.paymentWalletAddress || '',
          depositSignature: p.depositSignature || '',
          refundSignature: p.refundSignature || '',
          rank: p.rank,
        });
      }
      setLobbyPlayers(playersMap);
    });

    room.onMessage('matchmakingStatus', (data: {
      matchMode?: LobbyWagerState['matchMode'];
      rankBandId?: number;
      rankBandLabel?: string;
      averageCompetitiveRating?: number;
      averageVisibleRank?: string;
      rankSearchDistance?: number;
      queuedHumanCount?: number;
      provisionalHumanCount?: number;
      requiredPlayers?: number;
      rankedCoverChargeLamports?: string;
      rankedEntryQuoteId?: string;
    }) => {
      setMatchmakingStatus({
        matchMode: data.matchMode ?? null,
        rankBandId: typeof data.rankBandId === 'number' ? data.rankBandId : null,
        rankBandLabel: data.rankBandLabel ?? null,
        averageCompetitiveRating: typeof data.averageCompetitiveRating === 'number' ? data.averageCompetitiveRating : null,
        averageVisibleRank: data.averageVisibleRank ?? null,
        rankSearchDistance: typeof data.rankSearchDistance === 'number' ? data.rankSearchDistance : null,
        queuedHumanCount: typeof data.queuedHumanCount === 'number' ? data.queuedHumanCount : null,
        provisionalHumanCount: typeof data.provisionalHumanCount === 'number' ? data.provisionalHumanCount : null,
        requiredPlayers: typeof data.requiredPlayers === 'number' ? data.requiredPlayers : null,
        rankedCoverChargeLamports: data.rankedCoverChargeLamports ?? null,
        rankedEntryQuoteId: data.rankedEntryQuoteId ?? null,
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
      mapThemeId?: VoxelMapTheme['id'] | null;
      votes: MapVoteRecord[];
    }) => {
      loggers.network.info('map vote finalized', data.mapSeed);
      setMapVotes(data.votes, data.selectedOptionId);
      setMapSeed(data.mapSeed);
      setMapThemeId(data.mapThemeId ?? null);
      try {
        prepareVoxelMapCpu({ seed: data.mapSeed, themeId: data.mapThemeId ?? null, source: 'mapVoteFinalized' });
      } catch (error) {
        loggers.network.warn('selected map CPU prep failed', error);
      }
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
    }) => {
      loggers.network.debug('player joined lobby', data.playerName);
      updateLobbyPlayer(data.playerId, {
        id: data.playerId,
        name: data.playerName,
        isHost: data.isHost,
        isReady: data.isReady ?? false,
        team: data.team || '',
        isObserver: Boolean(data.isObserver),
        heroId: data.heroId || '',
        isBot: Boolean(data.isBot),
        botDifficulty: data.botDifficulty || '',
        botProfileId: data.botProfileId,
        paymentStatus: data.paymentStatus || '',
        paymentWalletAddress: data.paymentWalletAddress || '',
        depositSignature: data.depositSignature || '',
        refundSignature: data.refundSignature || '',
        rank: data.rank,
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
      refundReason?: string | null;
      refundGrossLamports?: string | null;
      refundOutboundFeeLamports?: string | null;
      refundNetLamports?: string | null;
      refundFeeSource?: string | null;
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

    room.onMessage('playerObserverChanged', (data: { playerId: string; isObserver: boolean; team?: string; isReady?: boolean }) => {
      const store = useGameStore.getState();
      const player = store.lobbyPlayers.get(data.playerId);
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
      players: { playerId: string; playerName: string; team?: string; isBot?: boolean; isObserver?: boolean }[];
      entryTicket?: string;
    }) => {
      if (isJoiningGame) {
        loggers.network.debug('ignoring duplicate gameStarting message');
        return;
      }
      isJoiningGame = true;

      loggers.network.info('game starting', data.gameRoomId);
      const myAssignment = data.players.find(p => p.playerId === room.sessionId);
      const isObserver = myAssignment?.isObserver === true;
      const myTeam = myAssignment?.team || 'red';

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
    });

    room.onError((code, message) => {
      loggers.network.error('lobby room error', code, message);
    });

    room.onLeave((code) => {
      loggers.network.debug('left lobby room', code);
      disconnectVoice('left_lobby');
      resetLobby();
    });
  }, [setCurrentLobby, setCurrentLobbyWager, setIsLobbyHost, setLobbyObserverSettings, setMatchmakingStatus, setLobbyPlayers, updateLobbyPlayer, removeLobbyPlayer, setAppPhase, setMapVoteState, setMapVotes, setMapSeed, setMapThemeId, clearMapVote, resetLobby]);

  const createLobby = useCallback(async (
    playerName: string,
    lobbyName?: string,
    options?: CreateLobbyOptions
  ) => {
    setLoading(true);

    try {
      await preflightWageredLobby(options?.wager);
      cleanupExistingConnections();
      setPracticeMode(false);

      const client = getClient();
      const clientId = getClientId();

      loggers.network.debug('creating lobby with client id', clientId);

      lobbyRoomRef.current = await client.create('lobby_room', {
        playerName,
        lobbyName: lobbyName || `${playerName}'s Lobby`,
        isPrivate: true,
        clientId,
        initialBotCount: options?.initialBotCount || 0,
        botFillMode: options?.botFillMode || 'manual',
        defaultBotDifficulty: options?.defaultBotDifficulty || 'normal',
        wager: options?.wager,
        mapSeed: config.isDev && typeof options?.mapSeed === 'number'
          ? options.mapSeed >>> 0
          : undefined,
        forceGoldenMapOption: config.isDev && options?.forceGoldenMapOption === true,
        observersEnabled: config.isDev && options?.observersEnabled === true,
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
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setCurrentLobby, setIsLobbyHost, setAppPhase, setConnected, setPracticeMode]);

  const quickPlay = useCallback(async (playerName: string) => {
    setLoading(true);

    try {
      cleanupExistingConnections();
      setPracticeMode(false);

      const client = getClient();
      const clientId = getClientId();
      const matchmakingTicket = await requestQuickPlayTicket();

      loggers.network.debug('quick play matchmaking with client id', clientId, matchmakingTicket.targetRankLabel);

      lobbyRoomRef.current = await client.joinOrCreate('lobby_room', {
        playerName,
        lobbyName: 'Quick Play',
        isPrivate: false,
        matchmakingMode: true,
        matchMode: 'quick_play',
        matchmakingTicket: matchmakingTicket.ticket,
        rankBandId: matchmakingTicket.targetRankDivisionIndex,
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
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setAppPhase, setConnected, setPracticeMode]);

  const rankedPlay = useCallback(async (playerName: string) => {
    setLoading(true);

    try {
      const rankedTicket = await requestRankedTicket();
      const client = getClient();
      const clientId = getClientId();

      cleanupExistingConnections();
      setPracticeMode(false);

      loggers.network.debug('ranked matchmaking with client id', clientId, rankedTicket.targetRankLabel, rankedTicket.tokenHold.requiredTokenBaseUnits);

      lobbyRoomRef.current = await client.joinOrCreate('lobby_room', {
        playerName,
        lobbyName: 'Ranked',
        isPrivate: false,
        matchmakingMode: true,
        matchMode: 'ranked',
        matchmakingTicket: rankedTicket.ticket,
        rankBandId: rankedTicket.targetRankDivisionIndex,
        clientId,
        initialBotCount: 0,
        botFillMode: 'manual',
        defaultBotDifficulty: 'normal',
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      setCurrentLobbyWager({
        enabled: false,
        matchMode: 'ranked',
        token: 'SOL',
      });
      setMatchmakingStatus({
        matchMode: 'ranked',
        rankBandId: rankedTicket.targetRankDivisionIndex,
        rankBandLabel: rankedTicket.targetRankLabel,
        averageCompetitiveRating: rankedTicket.competitiveRating,
        averageVisibleRank: null,
        rankSearchDistance: null,
        queuedHumanCount: 0,
        provisionalHumanCount: 1,
        requiredPlayers: null,
        rankedCoverChargeLamports: null,
        rankedEntryQuoteId: null,
      });
      setAppPhase('matchmaking');
      setConnected(true);
      setLoading(false);

      loggers.network.info('ranked joined lobby', lobbyRoomRef.current.id);
    } catch (error) {
      loggers.network.error('ranked matchmaking failed', error);
      setLoading(false);
      throw error;
    }
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setCurrentLobbyWager, setMatchmakingStatus, setAppPhase, setConnected, setPracticeMode]);

  const getRankedTokenHoldStatus = useCallback(() => requestRankedTokenHoldStatus(), []);

  const joinLobby = useCallback(async (playerName: string, lobbyId: string) => {
    setLoading(true);

    try {
      cleanupExistingConnections();
      setPracticeMode(false);

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
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setAppPhase, setConnected, setPracticeMode]);

  const leaveLobby = useCallback(() => {
    disconnectVoice('leave_lobby');
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.leave();
      lobbyRoomRef.current = null;
    }
    isJoiningGameRef.current = false;
    resetLobby();
    setAppPhase('menu');
    setConnected(false);
  }, [resetLobby, setAppPhase, setConnected]);

  const setLobbyReady = useCallback((ready: boolean) => {
    lobbyRoomRef.current?.send('ready', { ready });
  }, []);

  const setLobbyTeam = useCallback((team: string) => {
    lobbyRoomRef.current?.send('setTeam', { team });
  }, []);

  const setLobbyObserver = useCallback((observer: boolean) => {
    lobbyRoomRef.current?.send('setObserver', { observer });
  }, []);

  const devSetLobbyObserver = useCallback((observer: boolean) => {
    if (!config.isDev) return;
    lobbyRoomRef.current?.send('devSetObserver', { observer });
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
    lobbyPlayerId?: string | null,
    rankedEntryQuoteId?: string | null
  ): Promise<WagerPaymentIntent> => {
    const response = await wagerApiRequest<{ intent: WagerPaymentIntent }>(
      `/wagers/lobbies/${encodeURIComponent(lobbyId)}/intents`,
      {
        method: 'POST',
        body: JSON.stringify({ walletAddress, lobbyPlayerId, rankedEntryQuoteId }),
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

  const enterObserverMode = useCallback((sessionId: string) => {
    stopRemotePhantomCharge(sessionId);
    forgetPlayerNetId(sessionId);
    removePlayer(sessionId);
    resetLocalMovementPrediction();
    setObserverMode(true);
    setMatchStartGateKey(null);
    useGameStore.setState({
      playerId: sessionId,
      localPlayer: null,
      pendingInputs: [],
      lastProcessedTick: 0,
      clientCooldowns: {},
      clientCharges: {},
      unstuckCooldownUntil: 0,
      unstuckRequestId: 0,
      slideIntensity: 0,
    });
  }, [removePlayer, setMatchStartGateKey, setObserverMode]);

  const setupGameListeners = useCallback((room: Room, playerName: string, observer = false) => {
    const sessionId = room.sessionId;
    let localPlayerName = observer ? '' : playerName;

    setObserverMode(observer);

    if (observer) {
      enterObserverMode(sessionId);
    } else {
      // Create default local player
      setLocalPlayer(createDefaultLocalPlayer(sessionId, playerName));

      // Cleanup ghost players
      useGameStore.getState().cleanupGhostPlayers();
    }

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
      ? setupPollingSync(room, { setGamePhase })
      : null;

    // Set up message handlers
    room.onMessage('phaseChange', measureNetworkMessage('phaseChange', (data: { phase: string; endTime: number; mapSeed?: number; mapThemeId?: VoxelMapTheme['id'] | null }) => {
      loggers.network.debug('phase change message', data.phase);
      if (typeof data.mapSeed === 'number') {
        setMapSeed(data.mapSeed);
        setMapThemeId(data.mapThemeId ?? null);
        try {
          prepareVoxelMapCpu({ seed: data.mapSeed, themeId: data.mapThemeId ?? null, source: 'match' });
        } catch (error) {
          loggers.network.warn('phase map CPU prep failed', error);
        }
      }
      setGamePhase(data.phase as any);
      setPhaseEndTime(data.endTime);
      if (data.phase !== 'hero_select') {
        setMatchStartGateKey(null);
      }
    }));

    room.onMessage('matchStartGate', measureNetworkMessage('matchStartGate', (data: MatchStartGateMessage) => {
      if (!data || typeof data.key !== 'number' || !Number.isInteger(data.key)) return;

      if (typeof data.mapSeed === 'number') {
        setMapSeed(data.mapSeed);
        setMapThemeId(data.mapThemeId ?? null);
      }

      const position = data.position;
      const hasSpawnPosition = Boolean(
        position &&
        Number.isFinite(position.x) &&
        Number.isFinite(position.y) &&
        Number.isFinite(position.z)
      );

      const localPlayer = useGameStore.getState().localPlayer;
      if (localPlayer && hasSpawnPosition && position) {
        const nextPlayer = {
          ...localPlayer,
          state: 'spawning' as const,
          position: { ...position },
          velocity: { x: 0, y: 0, z: 0 },
        };
        setLocalPlayer(nextPlayer);
        resetLocalMovementPrediction(movementStateFromPlayer(nextPlayer), 0, nextPlayer.id);
      }

      setMatchStartGateKey(data.key);
    }));

    room.onMessage('gameEnd', measureNetworkMessage('gameEnd', (data: GameEndEvent) => {
      loggers.network.info('game ended', data.finalScore);
      setMatchSummary(data);
      setGamePhase('game_end' as any);
      setPhaseEndTime(null);
    }));

    room.onMessage('matchCancelled', measureNetworkMessage('matchCancelled', (data: MatchCancelledMessage) => {
      loggers.network.warn('match cancelled', {
        reason: data.reason,
        message: data.message,
        roomId: data.roomId,
        requiredHumanPlayers: data.requiredHumanPlayers,
        connectedHumanPlayers: data.connectedHumanPlayers,
        refundedWager: data.refundedWager,
      });
      disconnectVoice('match_cancelled');
      rejectPendingVoiceTokenRequests(data.message || 'match cancelled before start');
      rejectPendingPlayerReportRequests(data.message || 'match cancelled before start');
      setMatchStartGateKey(null);
      clearMatchSummary();
      setPhaseEndTime(null);
      setLoading(false);
      setPracticeMode(false);
      setGamePhase('waiting');
      resetLobby();
      setAppPhase('menu');
    }));

    setupPlayerJoinedHandler(room, sessionId, localPlayerName, updatePlayer);
    setupPlayerTransformsHandler(room, sessionId, localPlayerName, { setLocalPlayer });
    setupPlayerInterestHandler(room, sessionId);
    setupSelfMovementAuthorityHandler(room);
    setupPlayerVitalsHandler(room, sessionId, localPlayerName);
    setupMatchSnapshotHandler(room);
    setupVoidZoneHandlers(room, sessionId);
    setupCombatHandlers(room);

    room.onMessage('playerPingRequest', measureNetworkMessage('playerPingRequest', (data: PlayerPingRequestMessage) => {
      if (!data || typeof data.nonce !== 'string') return;
      room.send('playerPingResponse', { nonce: data.nonce });
    }));

    room.onMessage('playerPings', measureNetworkMessage('playerPings', (data: PlayerPingsMessage) => {
      setPlayerPings(data);
    }));

    room.onMessage('playerLeft', measureNetworkMessage('playerLeft', (data: { playerId: string }) => {
      loggers.network.debug('player left', data.playerId);
      stopRemotePhantomCharge(data.playerId);
      forgetPlayerNetId(data.playerId);
      removePlayer(data.playerId);
    }));

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

    room.onMessage('playerReportResult', (data: PlayerReportResultMessage) => {
      const requestId = typeof data.requestId === 'string' ? data.requestId : '';
      const pending = requestId ? playerReportRequestsRef.current.get(requestId) : null;
      if (!pending) {
        loggers.network.debug('received unmatched player report response', requestId);
        return;
      }

      window.clearTimeout(pending.timeoutId);
      playerReportRequestsRef.current.delete(requestId);
      if (data.ok) {
        pending.resolve();
      } else {
        pending.reject(new Error(data.error || 'Report failed'));
      }
    });

    room.onMessage('voiceTeamChanged', () => {
      disconnectVoice('voice_team_changed');
    });

    room.onMessage('devHeroChanged', measureNetworkMessage('devHeroChanged', (data: { heroId: HeroId; health: number; maxHealth: number }) => {
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
    }));

    room.onMessage('observerModeStarted', measureNetworkMessage('observerModeStarted', (data: { playerId?: string }) => {
      const observerPlayerId = data.playerId || sessionId;
      loggers.network.debug('observer mode started', observerPlayerId);
      localPlayerName = '';
      enterObserverMode(observerPlayerId);
    }));

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
      rejectPendingPlayerReportRequests('game room left before report response');
      disconnectVoice('left_game_room');
      if (gameRoomRef.current === room) {
        gameRoomRef.current = null;
      }
      isJoiningGameRef.current = false;
      setLoading(false);
      setConnected(false);
      setRoomId(null);
      setPracticeMode(false);
      setMatchStartGateKey(null);
      setObserverMode(false);
      setGamePhase('waiting');
      resetLobby();
      setAppPhase('menu');
    });

    setConnected(true);
  }, [setConnected, setLoading, setGamePhase, setPhaseEndTime, setMapSeed, setMapThemeId, setLocalPlayer, updatePlayer, removePlayer, setAppPhase, setRoomId, setPracticeMode, resetLobby, rejectPendingVoiceTokenRequests, rejectPendingPlayerReportRequests, setMatchSummary, clearMatchSummary, setPlayerPings, setMatchStartGateKey, setObserverMode, enterObserverMode]);

  const joinGameRoom = useCallback(async (gameRoomId: string, playerName: string, team?: string, entryTicket?: string, observer = false) => {
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
      setPracticeMode(false);
      setMatchStartGateKey(null);
      setObserverMode(observer);
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
        clientBuildId: config.buildId,
        movementProtocolVersion: MOVEMENT_PROTOCOL_VERSION,
      });

      setupGameListeners(gameRoomRef.current, playerName, observer);

      setRoomId(gameRoomRef.current.id);
      setPlayerId(gameRoomRef.current.sessionId);
      setAppPhase('in_game');
      setLoading(false);

      loggers.network.info('joined game room', gameRoomRef.current.id);
    } catch (error) {
      loggers.network.error('failed to join game room', error);
      setLoading(false);
      setObserverMode(false);
      isJoiningGameRef.current = false;
      throw error;
    }
  }, [getClient, setupGameListeners, setLoading, setRoomId, setPlayerId, setAppPhase, clearMatchSummary, setPracticeMode, setMatchStartGateKey, setObserverMode, setGamePhase, setPhaseEndTime]);

  const leaveGame = useCallback(() => {
    disconnectVoice('leave_game');
    rejectPendingVoiceTokenRequests('left game before voice token response');
    rejectPendingPlayerReportRequests('left game before report response');
    gameRoomRef.current?.leave();
    gameRoomRef.current = null;
    lobbyRoomRef.current?.leave();
    lobbyRoomRef.current = null;
    isJoiningGameRef.current = false;
    setRoomId(null);
    setPlayerId(null);
    setConnected(false);
    setPracticeMode(false);
    setMatchStartGateKey(null);
    useGameStore.setState({
      ...projectileInitialState,
      redScore: 0,
      blueScore: 0,
      mapThemeId: null,
      redFlag: null,
      blueFlag: null,
      players: new Map(),
      localPlayer: null,
      playerPings: new Map(),
      roundTimeRemaining: 0,
      phaseEndTime: null,
      pendingInputs: [],
      lastProcessedTick: 0,
      ultimateEffectActive: false,
      ultimateEffectType: null,
      ultimateEffectEndTime: 0,
      clientCooldowns: {},
      clientCharges: {},
      unstuckCooldownUntil: 0,
      unstuckRequestId: 0,
      slideIntensity: 0,
      isObserverMode: false,
    });
    resetLocalMovementPrediction();
    resetLobby();
    clearMatchSummary();
    setGamePhase('waiting' as any);
    setAppPhase('menu');
  }, [setRoomId, setPlayerId, setConnected, setPracticeMode, setMatchStartGateKey, resetLobby, clearMatchSummary, setGamePhase, setAppPhase, rejectPendingVoiceTokenRequests, rejectPendingPlayerReportRequests]);

  const disconnect = useCallback(() => {
    disconnectVoice('network_disconnect');
    rejectPendingVoiceTokenRequests('network disconnected before voice token response');
    rejectPendingPlayerReportRequests('network disconnected before report response');
    gameRoomRef.current?.leave();
    gameRoomRef.current = null;
    lobbyRoomRef.current?.leave();
    lobbyRoomRef.current = null;
    clientRef.current = null;
    isJoiningGameRef.current = false;
    setMatchStartGateKey(null);
    reset();
  }, [reset, setMatchStartGateKey, rejectPendingPlayerReportRequests, rejectPendingVoiceTokenRequests]);

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

  const sendMovementCommands = useCallback((packet: MovementCommandPacket) => {
    if (packet.commands.length === 0) return;
    gameRoomRef.current?.send('movementCommands', packet);
  }, []);

  const requestBlazeBombDrop = useCallback((payload: { abilityCastHints?: AbilityCastOriginHint[] } = {}) => {
    gameRoomRef.current?.send('blazeBombDrop', payload);
  }, []);

  const reportPlayer = useCallback((targetPlayerId: string, reason = 'cheating', details = ''): Promise<void> => {
    const room = gameRoomRef.current;
    const store = useGameStore.getState();
    if (store.isPracticeMode) {
      return Promise.reject(new Error('Reports are not available in practice mode'));
    }
    if (!room) {
      return Promise.reject(new Error('Not connected to a game room'));
    }

    const requestId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return new Promise<void>((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        playerReportRequestsRef.current.delete(requestId);
        reject(new Error('Report request timed out'));
      }, 8000);

      playerReportRequestsRef.current.set(requestId, { resolve, reject, timeoutId });
      room.send('playerReport', {
        requestId,
        targetPlayerId,
        reason,
        details,
      });
    });
  }, []);

  const selectHero = useCallback((heroId: HeroId) => {
    const store = useGameStore.getState();
    if (store.isPracticeMode) {
      const localPlayer = store.localPlayer;
      if (!localPlayer) return;

      const heroStats = getHeroStats(heroId);
      store.updateLocalPlayer({
        heroId,
        health: heroStats.maxHealth,
        maxHealth: heroStats.maxHealth,
        ultimateCharge: 100,
        isReady: false,
      });
      return;
    }

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

  const devSetGameObserver = useCallback(() => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('devSetObserver', {});
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

  const setDevBotBrainEnabled = useCallback((enabled: boolean) => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('setDevBotBrainEnabled', { enabled });
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
    const store = useGameStore.getState();
    if (store.isPracticeMode) {
      const localPlayer = store.localPlayer;
      if (!localPlayer) return;

      const heroId = localPlayer.heroId ?? 'phantom';
      const heroStats = getHeroStats(heroId);
      const nextPlayer = {
        ...localPlayer,
        heroId,
        isReady: ready,
        state: ready ? 'alive' as const : 'selecting' as const,
        health: heroStats.maxHealth,
        maxHealth: heroStats.maxHealth,
        ultimateCharge: 100,
      };

      store.setLocalPlayer(nextPlayer);
      if (ready) {
        resetLocalMovementPrediction(movementStateFromPlayer(nextPlayer), 0, nextPlayer.id);
        setGamePhase('playing');
      } else {
        setGamePhase('hero_select');
      }
      setPhaseEndTime(null);
      return;
    }

    loggers.network.debug('sending ready', ready);
    gameRoomRef.current?.send('ready', { ready });
  }, [setGamePhase, setPhaseEndTime]);

  const reportMatchSceneReady = useCallback(() => {
    const key = matchStartGateKeyRef.current;
    if (key === null || useGameStore.getState().isPracticeMode) return;

    gameRoomRef.current?.send('matchSceneReady', { key });
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
      createLobby,
      quickPlay,
      rankedPlay,
      getRankedTokenHoldStatus,
      startPracticeGame,
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
      sendMovementCommands,
      requestBlazeBombDrop,
      selectHero,
      devSetHero,
      devFillUltimate,
      devEndGame,
      devSetGameObserver,
      setDevImmune,
      setDevTimeFrozen,
      setDevBotsRooted,
      setDevBotBrainEnabled,
      addGameBot,
      selectTeam,
      setReady,
      setLobbyObserver,
      devSetLobbyObserver,
      matchStartGateKey,
      reportMatchSceneReady,
      reportPlayer,
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
