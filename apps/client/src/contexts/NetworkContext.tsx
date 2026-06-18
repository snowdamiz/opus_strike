import { createContext, useContext, useRef, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Client, Room } from 'colyseus.js';
import { useGameStore } from '../store/gameStore';
import { config } from '../config/environment';
import {
  createRandomSeed,
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_VOXEL_MAP_SIZE_ID,
  TUTORIAL_MAP_SEED,
  createTutorialVoxelMapManifest,
  getGameplayModeLabel,
  getHeroStats,
  isGameplayMode,
  MOVEMENT_PROTOCOL_VERSION,
  POWERUP_HEALTH_RESTORE_RATIO,
  type BotDifficulty,
  type GameplayMode,
  type HeroId,
  type PartyLaunchPayload,
  type PartyMode,
  type PartyStateSnapshot,
  type Team,
  type MovementCommandPacket,
} from '@voxel-strike/shared';
import type { VoiceScope, VoiceTokenResponse } from '../voice/types';
import { disconnectVoice } from '../voice/voiceControls';
import { prepareVoxelMapCpu } from '../utils/mapWarmup/mapPrepCache';
import { prebuildPreparedVoxelMapGeometry } from '../utils/mapWarmup/mapGeometryWarmup';
import {
  clearRunningGameSession,
  loadRunningGameSession,
  saveRunningGameSession,
  type RunningGameSession,
} from '../utils/runningGameSession';
import {
  getDevTutorialBypassRoomOptions,
  requestQuickPlayTicket,
  requestRankedTicket,
  requestRankedTokenHoldStatus,
  requestRunningGameStatus,
  type RankedTokenHoldStatus,
} from './networkApi';
import { setupLobbyListeners as setupLobbyRoomListeners } from './lobbyListeners';
import { setupGameRoomListeners } from './gameRoomListeners';

// Import extracted handlers
import {
  createDefaultLocalPlayer,
} from './gameMessageHandlers';
import { loggers } from '../utils/logger';
import {
  movementStateFromPlayer,
  resetLocalMovementPrediction,
} from '../movement/localPrediction';
import { projectileInitialState } from '../store/slices/projectiles';
import { resetGameTiming } from '../store/gameTimingStore';
import { createPracticeAbilityStates } from './practiceAbilities';
import { usePartyStore } from '../store/partyStore';

export type { RankedTokenHoldStatus } from './networkApi';

type StartPracticeGameOptions = { mapSeed?: number; tutorial?: boolean };
const TUTORIAL_HERO_ID: HeroId = 'blaze';

function facingToLookYaw(facing: { x: number; z: number } | null | undefined): number {
  if (
    !facing ||
    !Number.isFinite(facing.x) ||
    !Number.isFinite(facing.z) ||
    Math.hypot(facing.x, facing.z) <= 0.001
  ) {
    return Math.PI;
  }

  return Math.atan2(-facing.x, -facing.z);
}

export interface RunningGameReconnectStatus {
  available: boolean;
  session: RunningGameSession | null;
  reason?: string;
}

// ============================================================================
// CONTEXT TYPE
// ============================================================================

interface NetworkContextType {
  // Lobby operations
  quickPlay: (playerName: string, gameplayMode?: GameplayMode, botFillEnabled?: boolean) => Promise<void>;
  rankedPlay: (playerName: string) => Promise<void>;
  getRankedTokenHoldStatus: () => Promise<RankedTokenHoldStatus>;
  startPracticeGame: (playerName?: string, options?: StartPracticeGameOptions) => void;
  startTutorialGame: (playerName?: string) => void;
  joinLobby: (playerName: string, lobbyId: string) => Promise<void>;
  joinMatchmakingLobby: (playerName: string, launch: PartyLaunchPayload) => Promise<void>;
  leaveLobby: () => void;
  ensureParty: (playerName: string, heroId?: HeroId) => Promise<string>;
  joinParty: (playerName: string, partyId: string, heroId?: HeroId) => Promise<void>;
  leaveParty: () => void;
  setPartyHero: (heroId: HeroId) => void;
  setPartyReady: (ready: boolean) => void;
  setPartyMode: (mode: PartyMode, gameplayMode?: GameplayMode) => void;
  setPartyBotFill: (gameplayMode: GameplayMode, enabled: boolean) => void;
  addPartyBot: (options?: { difficulty?: BotDifficulty; displayName?: string; heroId?: HeroId }) => void;
  kickPartyMember: (userId: string) => void;
  startParty: () => void;
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

  // Game operations
  joinGameRoom: (
    gameRoomId: string,
    playerName: string,
    team?: string,
    entryTicket?: string,
    reconnectToRunningGame?: boolean
  ) => Promise<void>;
  getRunningGameReconnect: () => Promise<RunningGameReconnectStatus>;
  reconnectRunningGame: () => Promise<void>;
  leaveGame: () => void;
  disconnect: () => void;
  sendMovementCommands: (packet: MovementCommandPacket) => void;
  selectHero: (heroId: HeroId) => void;
  devSetHero: (heroId: HeroId) => void;
  devFillUltimate: () => void;
  devEndGame: () => void;
  setDevImmune: (enabled: boolean) => void;
  setDevTimeFrozen: (enabled: boolean) => void;
  setDevBotsRooted: (enabled: boolean) => void;
  setDevBotBrainEnabled: (enabled: boolean) => void;
  addGameBot: (heroId: HeroId, team: Team) => void;
  devBotSkill: (heroId: HeroId, team: Team, skillKey: string) => void;
  devBotLook: (heroId: HeroId, team: Team, direction: 'up' | 'down') => void;
  selectTeam: (team: Team) => void;
  setReady: (ready: boolean) => void;
  matchStartGateKey: number | null;
  reportMatchSceneReady: () => void;
  reportPlayer: (targetPlayerId: string, reason?: string, details?: string) => Promise<void>;
  requestVoiceToken: (scope?: VoiceScope) => Promise<VoiceTokenResponse>;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

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
  const partyRoomRef = useRef<Room | null>(null);
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
  const joinGameRoomRef = useRef<NetworkContextType['joinGameRoom'] | null>(null);
  const leaveLobbyRef = useRef<NetworkContextType['leaveLobby'] | null>(null);

  const {
    setConnected,
    setLoading,
    setRoomId,
    setPlayerId,
    setPlayerName,
    setPracticeMode,
    setTutorialMode,
    setPracticePreparing,
    setAppPhase,
    setGamePhase,
    setPhaseEndTime,
    setLocalPlayer,
    setIsLobbyHost,
    setLobbyError,
    setMatchmakingStatus,
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
    if (partyRoomRef.current) {
      try {
        partyRoomRef.current.leave(false);
      } catch (e) {
        loggers.network.debug('error leaving old party room', e);
      }
      partyRoomRef.current = null;
      usePartyStore.getState().clearParty();
    }
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
  }, [rejectPendingPlayerReportRequests, rejectPendingVoiceTokenRequests]);

  const startPracticeGame = useCallback((playerName?: string, options?: StartPracticeGameOptions) => {
    const name = resolvePracticePlayerName(playerName);
    const isTutorial = options?.tutorial === true;

    cleanupExistingConnections();
    clearRunningGameSession();
    resetLobby();
    rejectPendingVoiceTokenRequests('practice mode started');
    setPlayerName(name);
    setPracticeMode(true);
    setTutorialMode(isTutorial);
    setLoading(false);
    setPracticePreparing(true);

    const startToken = ++practiceStartTokenRef.current;

    runAfterNextPaint(() => {
      if (practiceStartTokenRef.current !== startToken) return;

      try {
        const tutorialManifest = isTutorial ? createTutorialVoxelMapManifest() : null;
        const seed = isTutorial
          ? TUTORIAL_MAP_SEED
          : typeof options?.mapSeed === 'number'
          ? options.mapSeed >>> 0
          : createRandomSeed();
        const preparedMap = prepareVoxelMapCpu({
          seed,
          manifest: tutorialManifest ?? undefined,
          mapSize: tutorialManifest?.mapSize ?? DEFAULT_VOXEL_MAP_SIZE_ID,
          themeId: tutorialManifest?.themeId ?? null,
          mapProfileId: tutorialManifest?.profileId ?? null,
          source: 'match',
        });
        prebuildPreparedVoxelMapGeometry(preparedMap, { frameBudgetMs: 2, label: 'practice-start' });
        const spawnPoints = isTutorial
          ? preparedMap.manifest.spawnPoints.red
          : [
            ...preparedMap.manifest.spawnPoints.red,
            ...preparedMap.manifest.spawnPoints.blue,
          ];
        const spawn = isTutorial
          ? spawnPoints[0] ?? { x: 0, y: 1, z: 0 }
          : spawnPoints[Math.floor(Math.random() * spawnPoints.length)] ?? { x: 0, y: 1, z: 0 };
        const playerId = createPracticePlayerId();
        const player = createDefaultLocalPlayer(playerId, name);
        const tutorialHeroStats = isTutorial ? getHeroStats(TUTORIAL_HERO_ID) : null;

        player.state = isTutorial ? 'alive' : 'selecting';
        player.position = { ...spawn };
        player.team = 'red';
        if (isTutorial) {
          player.lookYaw = facingToLookYaw(preparedMap.manifest.gameplay.spawns.red.facing);
          player.lookPitch = 0;
        }
        player.isReady = isTutorial;
        player.heroId = isTutorial ? TUTORIAL_HERO_ID : null;
        if (tutorialHeroStats) {
          player.maxHealth = tutorialHeroStats.maxHealth;
          player.health = Math.max(
            1,
            tutorialHeroStats.maxHealth - Math.max(1, Math.round(tutorialHeroStats.maxHealth * POWERUP_HEALTH_RESTORE_RATIO))
          );
          player.ultimateCharge = 100;
          player.abilities = createPracticeAbilityStates(TUTORIAL_HERO_ID);
        }
        player.hasFlag = false;

        useGameStore.setState({
          ...projectileInitialState,
          isConnected: false,
          isLoading: false,
          isPracticeMode: true,
          isTutorialMode: isTutorial,
          isPracticePreparing: false,
          roomId: null,
          playerId,
          appPhase: 'in_game',
          gameplayMode: DEFAULT_GAMEPLAY_MODE,
          gamePhase: isTutorial ? 'playing' : 'hero_select',
          matchSummary: null,
          appliedExperienceMatchId: null,
          mapSeed: seed,
          mapThemeId: preparedMap.manifest.themeId,
          mapSize: preparedMap.manifest.mapSize,
          mapProfileId: preparedMap.manifest.profileId ?? null,
          redScore: 0,
          blueScore: 0,
          redFlag: isTutorial
            ? { position: { ...preparedMap.manifest.flagZones.red }, carrierId: null, isAtBase: true }
            : null,
          blueFlag: isTutorial
            ? { position: { ...preparedMap.manifest.flagZones.blue }, carrierId: null, isAtBase: true }
            : null,
          powerupPickups: new Map(preparedMap.manifest.gameplay.powerups.map((pickup) => [
            pickup.id,
            { pickupId: pickup.id, availableAt: 0 },
          ])),
          powerupPickupCollections: new Map(),
          players: new Map([[playerId, player]]),
          localPlayer: player,
          playerPings: new Map(),
          roundTimeRemaining: 0,
          phaseEndTime: null,
          ultimateEffectActive: false,
          ultimateEffectType: null,
          ultimateEffectEndTime: 0,
          clientCooldowns: {},
          clientCharges: {},
          lastSkillCastAt: 0,
          lastPrimaryFireAt: 0,
          slideIntensity: 0,
        });
        resetGameTiming(Date.now());
        resetLocalMovementPrediction(movementStateFromPlayer(player), 0, player.id);
        setRoomId(null);
        setConnected(false);

        loggers.network.info(isTutorial ? 'started local tutorial' : 'started local practice', seed);
      } catch (error) {
        loggers.network.error('failed to start local practice', error);
        practiceStartTokenRef.current += 1;
        useGameStore.setState({
          isPracticePreparing: false,
          isPracticeMode: false,
          isTutorialMode: false,
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
    setTutorialMode,
    setRoomId,
  ]);

  const startTutorialGame = useCallback((playerName?: string) => {
    startPracticeGame(playerName, { tutorial: true });
  }, [startPracticeGame]);

  const setupLobbyListeners = useCallback((room: Room, playerName: string) => {
    setupLobbyRoomListeners(room, {
      playerName,
      joinGameRoom: (...args) => {
        const joinGameRoom = joinGameRoomRef.current;
        if (!joinGameRoom) {
          return Promise.reject(new Error('Game room join handler is not ready'));
        }
        return joinGameRoom(...args);
      },
      leaveLobby: () => {
        leaveLobbyRef.current?.();
      },
    });
  }, []);

  const quickPlay = useCallback(async (
    playerName: string,
    gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE,
    botFillEnabled = false
  ) => {
    setLoading(true);

    try {
      cleanupExistingConnections();
      clearRunningGameSession();
      setPracticeMode(false);

      const client = getClient();
      const matchmakingTicket = await requestQuickPlayTicket();

      loggers.network.debug('quick play matchmaking', matchmakingTicket.targetRankLabel);

      const lobbyName = gameplayMode === DEFAULT_GAMEPLAY_MODE
        ? getGameplayModeLabel(DEFAULT_GAMEPLAY_MODE)
        : getGameplayModeLabel(gameplayMode);
      lobbyRoomRef.current = await client.joinOrCreate('lobby_room', {
        playerName,
        lobbyName,
        ...getDevTutorialBypassRoomOptions(),
        isPrivate: false,
        matchmakingMode: true,
        matchMode: 'quick_play',
        gameplayMode,
        matchmakingTicket: matchmakingTicket.ticket,
        rankBandId: matchmakingTicket.targetRankDivisionIndex,
        initialBotCount: 0,
        botFillMode: botFillEnabled ? 'fill_even' : 'manual',
        defaultBotDifficulty: 'normal',
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      useGameStore.setState({ gameplayMode });
      setMatchmakingStatus({
        matchMode: 'quick_play',
        gameplayMode,
        rankBandId: matchmakingTicket.targetRankDivisionIndex,
        rankBandLabel: matchmakingTicket.targetRankLabel,
        averageCompetitiveRating: matchmakingTicket.competitiveRating,
        averageVisibleRank: null,
        rankSearchDistance: null,
        queuedHumanCount: 0,
        provisionalHumanCount: 1,
        requiredPlayers: null,
        capacityBlocked: false,
        capacityMaxPlayers: null,
        rankedCoverChargeLamports: null,
        rankedEntryQuoteId: null,
      });
      setAppPhase('matchmaking');
      setConnected(true);
      setLoading(false);

      loggers.network.info('quick play joined lobby', lobbyRoomRef.current.id);
    } catch (error) {
      loggers.network.error('quick play matchmaking failed', error);
      setLoading(false);
      throw error;
    }
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setMatchmakingStatus, setAppPhase, setConnected, setPracticeMode]);

  const rankedPlay = useCallback(async (playerName: string) => {
    setLoading(true);

    try {
      const rankedTicket = await requestRankedTicket();
      const client = getClient();

      cleanupExistingConnections();
      clearRunningGameSession();
      setPracticeMode(false);

      loggers.network.debug('ranked matchmaking', rankedTicket.targetRankLabel, rankedTicket.tokenHold.requiredTokenBaseUnits);

      lobbyRoomRef.current = await client.joinOrCreate('lobby_room', {
        playerName,
        lobbyName: 'Ranked',
        ...getDevTutorialBypassRoomOptions(),
        isPrivate: false,
        matchmakingMode: true,
        matchMode: 'ranked',
        matchmakingTicket: rankedTicket.ticket,
        rankBandId: rankedTicket.targetRankDivisionIndex,
        initialBotCount: 0,
        botFillMode: 'manual',
        defaultBotDifficulty: 'normal',
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      setMatchmakingStatus({
        matchMode: 'ranked',
        gameplayMode: DEFAULT_GAMEPLAY_MODE,
        rankBandId: rankedTicket.targetRankDivisionIndex,
        rankBandLabel: rankedTicket.targetRankLabel,
        averageCompetitiveRating: rankedTicket.competitiveRating,
        averageVisibleRank: null,
        rankSearchDistance: null,
        queuedHumanCount: 0,
        provisionalHumanCount: 1,
        requiredPlayers: null,
        capacityBlocked: false,
        capacityMaxPlayers: null,
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
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setMatchmakingStatus, setAppPhase, setConnected, setPracticeMode]);

  const getRankedTokenHoldStatus = useCallback(() => requestRankedTokenHoldStatus(), []);

  const joinLobby = useCallback(async (playerName: string, lobbyId: string) => {
    setLoading(true);

    try {
      cleanupExistingConnections();
      clearRunningGameSession();
      setPracticeMode(false);

      const client = getClient();

      lobbyRoomRef.current = await client.joinById(lobbyId, {
        playerName,
        ...getDevTutorialBypassRoomOptions(),
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

  const joinMatchmakingLobby = useCallback(async (playerName: string, launch: PartyLaunchPayload) => {
    setLoading(true);

    try {
      cleanupExistingConnections();
      clearRunningGameSession();
      setPracticeMode(false);

      const client = getClient();
      const joinOptions: Record<string, unknown> = {
        playerName,
        ...getDevTutorialBypassRoomOptions(),
      };
      if (launch.matchmakingTicket) {
        joinOptions.matchmakingTicket = launch.matchmakingTicket;
      }

      lobbyRoomRef.current = await client.joinById(launch.lobbyId, joinOptions);

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      if (launch.matchMode === 'ranked' || launch.matchMode === 'quick_play') {
        setMatchmakingStatus({
          matchMode: launch.matchMode,
          gameplayMode: launch.gameplayMode,
          rankBandId: launch.targetRankDivisionIndex ?? null,
          rankBandLabel: launch.targetRankLabel ?? null,
          averageCompetitiveRating: null,
          averageVisibleRank: null,
          rankSearchDistance: null,
          queuedHumanCount: 0,
          provisionalHumanCount: 1,
          requiredPlayers: null,
          capacityBlocked: false,
          capacityMaxPlayers: null,
          rankedCoverChargeLamports: null,
          rankedEntryQuoteId: null,
        });
      }
      setAppPhase(launch.matchMode === 'custom' ? 'in_lobby' : 'matchmaking');
      setConnected(true);
      setLoading(false);

      loggers.network.info('joined party launch lobby', launch.lobbyId);
    } catch (error) {
      loggers.network.error('failed to join party launch lobby', error);
      setLoading(false);
      throw error;
    }
  }, [
    cleanupExistingConnections,
    getClient,
    setAppPhase,
    setConnected,
    setLoading,
    setMatchmakingStatus,
    setPlayerId,
    setPracticeMode,
    setupLobbyListeners,
  ]);

  const setupPartyListeners = useCallback((room: Room, playerNameForLaunch: string) => {
    const localUserId = useGameStore.getState().userId;
    usePartyStore.getState().setLocalUserId(localUserId);

    const logPartyNotification = (type: string, payload: unknown) => {
      loggers.network.debug(type, payload);
    };

    room.onMessage('partyState', (partyState: unknown) => {
      usePartyStore.getState().setPartyState(partyState as PartyStateSnapshot, useGameStore.getState().userId);
    });
    room.onMessage('partyMemberJoined', (payload: unknown) => {
      logPartyNotification('party member joined', payload);
    });
    room.onMessage('partyMemberLeft', (payload: unknown) => {
      logPartyNotification('party member left', payload);
    });
    room.onMessage('partyMemberUpdated', (payload: unknown) => {
      logPartyNotification('party member updated', payload);
    });
    room.onMessage('partyLeaderChanged', (payload: unknown) => {
      logPartyNotification('party leader changed', payload);
    });
    room.onMessage('partyKicked', (payload: unknown) => {
      const message = typeof payload === 'object' && payload && 'reason' in payload
        ? String((payload as { reason?: unknown }).reason || 'Kicked from party')
        : 'Kicked from party';
      usePartyStore.getState().clearParty();
      usePartyStore.getState().setLaunchError(message);
    });
    room.onMessage('partyLaunch', (launch: unknown) => {
      joinMatchmakingLobby(playerNameForLaunch, launch as PartyLaunchPayload).catch((error) => {
        usePartyStore.getState().setLaunchError(error instanceof Error ? error.message : 'Failed to join party launch');
      });
    });
    room.onMessage('error', (payload: unknown) => {
      const message = typeof payload === 'object' && payload && 'message' in payload
        ? String((payload as { message?: unknown }).message || 'Party action failed')
        : 'Party action failed';
      usePartyStore.getState().setLaunchError(message);
    });
    room.onLeave(() => {
      if (partyRoomRef.current === room) {
        partyRoomRef.current = null;
        usePartyStore.getState().clearParty();
      }
    });
  }, [joinMatchmakingLobby]);

  const joinParty = useCallback(async (playerName: string, partyId: string, heroId?: HeroId) => {
    const existingParty = usePartyStore.getState().party;
    if (partyRoomRef.current && existingParty?.partyId === partyId) return;

    if (partyRoomRef.current) {
      try {
        partyRoomRef.current.leave(false);
      } catch (error) {
        loggers.network.debug('error leaving old party room', error);
      }
      partyRoomRef.current = null;
      usePartyStore.getState().clearParty();
    }

    const client = getClient();
    partyRoomRef.current = await client.joinById(partyId, {
      playerName,
      heroId,
      ...getDevTutorialBypassRoomOptions(),
    });
    setupPartyListeners(partyRoomRef.current, playerName);
    setAppPhase('menu');
  }, [getClient, setAppPhase, setupPartyListeners]);

  const ensureParty = useCallback(async (playerName: string, heroId?: HeroId): Promise<string> => {
    const existingParty = usePartyStore.getState().party;
    if (partyRoomRef.current && existingParty) return existingParty.partyId;

    const client = getClient();
    partyRoomRef.current = await client.create('party_room', {
      playerName,
      heroId,
      ...getDevTutorialBypassRoomOptions(),
    });
    setupPartyListeners(partyRoomRef.current, playerName);
    setAppPhase('menu');
    return partyRoomRef.current.id;
  }, [getClient, setAppPhase, setupPartyListeners]);

  const leaveParty = useCallback(() => {
    if (partyRoomRef.current) {
      partyRoomRef.current.leave();
      partyRoomRef.current = null;
    }
    usePartyStore.getState().clearParty();
  }, []);

  const setPartyHero = useCallback((heroId: HeroId) => {
    partyRoomRef.current?.send('setHero', { heroId });
  }, []);

  const setPartyReady = useCallback((ready: boolean) => {
    partyRoomRef.current?.send('setReady', { ready });
  }, []);

  const setPartyMode = useCallback((mode: PartyMode, gameplayMode?: GameplayMode) => {
    partyRoomRef.current?.send('setMode', { mode, gameplayMode });
  }, []);

  const setPartyBotFill = useCallback((gameplayMode: GameplayMode, enabled: boolean) => {
    partyRoomRef.current?.send('setBotFill', { gameplayMode, enabled });
  }, []);

  const addPartyBot = useCallback((options?: { difficulty?: BotDifficulty; displayName?: string; heroId?: HeroId }) => {
    partyRoomRef.current?.send('addBot', options || {});
  }, []);

  const kickPartyMember = useCallback((userId: string) => {
    partyRoomRef.current?.send('kickMember', { userId });
  }, []);

  const startParty = useCallback(() => {
    partyRoomRef.current?.send('start');
  }, []);

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

  const addLobbyBot = useCallback((options?: { difficulty?: BotDifficulty; team?: string; name?: string; heroId?: HeroId | '' }) => {
    setLobbyError(null);
    lobbyRoomRef.current?.send('addBot', options || {});
  }, [setLobbyError]);

  const removeLobbyBot = useCallback((botId: string) => {
    setLobbyError(null);
    lobbyRoomRef.current?.send('removeBot', { botId });
  }, [setLobbyError]);

  const updateLobbyBotTeam = useCallback((botId: string, team: string) => {
    setLobbyError(null);
    lobbyRoomRef.current?.send('updateBotTeam', { botId, team });
  }, [setLobbyError]);

  const updateLobbyBotDifficulty = useCallback((botId: string, difficulty: BotDifficulty) => {
    setLobbyError(null);
    lobbyRoomRef.current?.send('updateBotDifficulty', { botId, difficulty });
  }, [setLobbyError]);

  const updateLobbyBotHero = useCallback((botId: string, heroId: HeroId | '') => {
    setLobbyError(null);
    lobbyRoomRef.current?.send('updateBotHero', { botId, heroId });
  }, [setLobbyError]);

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

  // ==================== GAME ROOM OPERATIONS ====================

  const setupGameListeners = useCallback((room: Room, playerName: string) => {
    setupGameRoomListeners(room, {
      playerName,
      gameRoomRef,
      isJoiningGameRef,
      voiceTokenRequestsRef,
      playerReportRequestsRef,
      rejectPendingVoiceTokenRequests,
      rejectPendingPlayerReportRequests,
      setMatchStartGateKey,
    });
  }, [rejectPendingVoiceTokenRequests, rejectPendingPlayerReportRequests, setMatchStartGateKey]);

  const getRunningGameReconnect = useCallback(async (): Promise<RunningGameReconnectStatus> => {
    const session = loadRunningGameSession();
    if (!session) return { available: false, session: null, reason: 'no_saved_game' };

    try {
      const status = await requestRunningGameStatus(session.roomId);
      if (!status.available) {
        clearRunningGameSession(session.roomId);
        return { available: false, session: null, reason: status.reason ?? 'unavailable' };
      }

      return { available: true, session };
    } catch (error) {
      loggers.network.warn('running game reconnect check failed', error);
      return { available: false, session: null, reason: 'check_failed' };
    }
  }, []);

  const joinGameRoom = useCallback(async (
    gameRoomId: string,
    playerName: string,
    team?: string,
    entryTicket?: string,
    reconnectToRunningGame = false
  ) => {
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
      setGamePhase('waiting');
      setPhaseEndTime(null);

      const client = getClient();

      gameRoomRef.current = await client.joinById(gameRoomId, {
        playerName,
        preferredTeam: team,
        entryTicket,
        reconnectToRunningGame,
        clientBuildId: config.buildId,
        movementProtocolVersion: MOVEMENT_PROTOCOL_VERSION,
      });

      setupGameListeners(gameRoomRef.current, playerName);

      setRoomId(gameRoomRef.current.id);
      setPlayerId(gameRoomRef.current.sessionId);
      setAppPhase('in_game');
      setLoading(false);
      saveRunningGameSession({
        roomId: gameRoomRef.current.id,
        playerName,
        team: team === 'red' || team === 'blue' ? team : undefined,
      });

      loggers.network.info('joined game room', gameRoomRef.current.id);
    } catch (error) {
      loggers.network.error('failed to join game room', error);
      setLoading(false);
      isJoiningGameRef.current = false;
      throw error;
    }
  }, [getClient, setupGameListeners, setLoading, setRoomId, setPlayerId, setAppPhase, clearMatchSummary, setPracticeMode, setMatchStartGateKey, setGamePhase, setPhaseEndTime]);

  joinGameRoomRef.current = joinGameRoom;
  leaveLobbyRef.current = leaveLobby;

  const reconnectRunningGame = useCallback(async () => {
    const status = await getRunningGameReconnect();
    if (!status.available || !status.session) {
      throw new Error('No running game is available to reconnect');
    }

    const fallbackName = useGameStore.getState().playerName;
    await joinGameRoom(
      status.session.roomId,
      status.session.playerName || fallbackName,
      status.session.team,
      undefined,
      true
    );
  }, [getRunningGameReconnect, joinGameRoom]);

  const leaveGame = useCallback(() => {
    clearRunningGameSession(useGameStore.getState().roomId);
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
      mapSize: DEFAULT_VOXEL_MAP_SIZE_ID,
      mapProfileId: null,
      gameplayMode: DEFAULT_GAMEPLAY_MODE,
      redFlag: null,
      blueFlag: null,
      players: new Map(),
      localPlayer: null,
      playerPings: new Map(),
      roundTimeRemaining: 0,
      phaseEndTime: null,
      ultimateEffectActive: false,
      ultimateEffectType: null,
      ultimateEffectEndTime: 0,
      clientCooldowns: {},
      clientCharges: {},
      lastSkillCastAt: 0,
      lastPrimaryFireAt: 0,
      slideIntensity: 0,
    });
    resetLocalMovementPrediction();
    resetLobby();
    clearMatchSummary();
    setGamePhase('waiting');
    setAppPhase('menu');
  }, [setRoomId, setPlayerId, setConnected, setPracticeMode, setMatchStartGateKey, resetLobby, clearMatchSummary, setGamePhase, setAppPhase, rejectPendingVoiceTokenRequests, rejectPendingPlayerReportRequests]);

  const disconnect = useCallback(() => {
    clearRunningGameSession();
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
        abilities: createPracticeAbilityStates(heroId),
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

  const devBotSkill = useCallback((heroId: HeroId, team: Team, skillKey: string) => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('devBotSkill', { heroId, team, skillKey });
  }, []);

  const devBotLook = useCallback((heroId: HeroId, team: Team, direction: 'up' | 'down') => {
    if (!config.isDev) return;
    gameRoomRef.current?.send('devBotLook', { heroId, team, direction });
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
        abilities: createPracticeAbilityStates(heroId),
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

  const contextValue = useMemo<NetworkContextType>(() => ({
    quickPlay,
    rankedPlay,
    getRankedTokenHoldStatus,
    startPracticeGame,
    startTutorialGame,
    joinLobby,
    joinMatchmakingLobby,
    ensureParty,
    joinParty,
    leaveParty,
    setPartyHero,
    setPartyReady,
    setPartyMode,
    setPartyBotFill,
    addPartyBot,
    kickPartyMember,
    startParty,
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
    joinGameRoom,
    getRunningGameReconnect,
    reconnectRunningGame,
    leaveGame,
    disconnect,
    sendMovementCommands,
    selectHero,
    devSetHero,
    devFillUltimate,
    devEndGame,
    setDevImmune,
    setDevTimeFrozen,
    setDevBotsRooted,
    setDevBotBrainEnabled,
    addGameBot,
    devBotSkill,
    devBotLook,
    selectTeam,
    setReady,
    matchStartGateKey,
    reportMatchSceneReady,
    reportPlayer,
    requestVoiceToken,
  }), [
    addGameBot,
    addLobbyBot,
    addPartyBot,
    devBotLook,
    devBotSkill,
    devEndGame,
    devFillUltimate,
    devSetHero,
    disconnect,
    finalizeMapVote,
    getRankedTokenHoldStatus,
    ensureParty,
    getRunningGameReconnect,
    joinGameRoom,
    joinLobby,
    joinMatchmakingLobby,
    joinParty,
    kickPartyMember,
    kickPlayer,
    leaveGame,
    leaveLobby,
    leaveParty,
    matchStartGateKey,
    quickPlay,
    rankedPlay,
    reconnectRunningGame,
    removeLobbyBot,
    reportMapVotePreviewsReady,
    reportMatchSceneReady,
    reportPlayer,
    requestVoiceToken,
    selectHero,
    selectTeam,
    sendMovementCommands,
    setDevBotBrainEnabled,
    setDevBotsRooted,
    setDevImmune,
    setDevTimeFrozen,
    setLobbyReady,
    setLobbyTeam,
    setPartyHero,
    setPartyBotFill,
    setPartyMode,
    setPartyReady,
    setReady,
    startGame,
    startParty,
    startPracticeGame,
    startTutorialGame,
    updateLobbyBotDifficulty,
    updateLobbyBotHero,
    updateLobbyBotTeam,
    voteMap,
  ]);

  // ==================== RENDER ====================

  return (
    <NetworkContext.Provider value={contextValue}>
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
