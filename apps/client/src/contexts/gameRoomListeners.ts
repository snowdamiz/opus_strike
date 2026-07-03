import type { Room } from 'colyseus.js';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_MATCH_PERSPECTIVE,
  isGameplayMode,
  isMatchPerspective,
  normalizeVoxelMapSizeId,
  type GameEndEvent,
  type HeroId,
  type HeroSkinId,
  type MapProfileId,
  type PlayerPingRequestMessage,
  type PlayerPingsMessage,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
import { normalizeMapProfileId, useGameStore } from '../store/gameStore';
import { useStreamerStore } from '../store/streamerStore';
import type { VoiceTokenResponse } from '../voice/types';
import { disconnectVoice } from '../voice/voiceControls';
import { clearRunningGameSession } from '../utils/runningGameSession';
import {
  getStreamerMapTransitionKey,
  preloadStreamerMapTransitionTarget,
} from '../utils/streamerMapTransition';
import {
  movementStateFromPlayer,
  resetLocalMovementPrediction,
} from '../movement/localPrediction';
import {
  createDefaultLocalPlayer,
  syncPlayerFromSchema,
  setupPlayerJoinedHandler,
  setupPlayerTransformsHandler,
  setupPlayerInterestHandler,
  setupSelfMovementAuthorityHandler,
  setupPlayerVitalsHandler,
  setupMatchSnapshotHandler,
  setupPowerupHandlers,
  setupVoidZoneHandlers,
  setupCombatHandlers,
  forgetPlayerNetId,
  stopRemotePhantomCharge,
  clearDelayedGameplayEffects,
} from './gameMessageHandlers';
import { normalizeGamePhase } from './gamePhase';
import { setupPollingSync } from './gamePollingSync';
import { measureNetworkMessage } from './networkMessageMetrics';
import { loggers } from '../utils/logger';
import { useChatStore } from '../store/chatStore';

type MutableRef<T> = { current: T };
type SchemaPlayerCollection = {
  onAdd?: (callback: (schemaPlayer: unknown, id: string) => void) => void;
  onRemove?: (callback: (schemaPlayer: unknown, id: string) => void) => void;
};
type SchemaPlayerWithChange = {
  name?: unknown;
  onChange?: (callback: () => void) => void;
};

interface PendingVoiceTokenRequest {
  resolve: (response: VoiceTokenResponse) => void;
  reject: (error: Error) => void;
  timeoutId: number;
}

interface PendingPlayerReportRequest {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: number;
}

interface SetupGameListenersOptions {
  playerName: string;
  gameRoomRef: MutableRef<Room | null>;
  isJoiningGameRef: MutableRef<boolean>;
  voiceTokenRequestsRef: MutableRef<Map<string, PendingVoiceTokenRequest>>;
  playerReportRequestsRef: MutableRef<Map<string, PendingPlayerReportRequest>>;
  rejectPendingVoiceTokenRequests: (message: string) => void;
  rejectPendingPlayerReportRequests: (message: string) => void;
  setMatchStartGateKey: (key: number | null) => void;
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
  mapSize?: VoxelMapSizeId | null;
  mapProfileId?: MapProfileId | null;
  pregeneratedMapId?: string | null;
  mapArtifactId?: string | null;
  position?: { x: number; y: number; z: number };
  movementEpoch?: number;
  ackSeq?: number;
  collisionRevision?: number;
}

interface MatchCancelledMessage {
  reason?: string;
  message?: string;
  roomId?: string;
  requiredHumanPlayers?: number;
  connectedHumanPlayers?: number;
  serverTime?: number;
  blockedPlayerId?: string;
  blockedPlayerName?: string;
  networkQuality?: {
    reason?: string | null;
    sampleCount?: number;
    successfulSamples?: number;
    timeoutCount?: number;
    consecutiveTimeouts?: number;
    timeoutRatio?: number;
    averagePingMs?: number | null;
    peakPingMs?: number | null;
    jitterMs?: number | null;
    observationMs?: number;
    windowMs?: number;
  };
}

interface StreamerObserverJoinedMessage {
  roomId?: string;
  sessionId?: string;
  streamerObserverCount?: number;
  streamerObserverSeatCount?: number;
  streamerManagedBotGame?: boolean;
  streamerFeedMode?: string | null;
  streamerCameraMode?: string | null;
  endlessMatch?: boolean;
}

const STREAMER_MAP_TRANSITION_LEAD_MS = 360;

export function setupGameRoomListeners(
  room: Room,
  {
    playerName,
    gameRoomRef,
    isJoiningGameRef,
    voiceTokenRequestsRef,
    playerReportRequestsRef,
    rejectPendingVoiceTokenRequests,
    rejectPendingPlayerReportRequests,
    setMatchStartGateKey,
  }: SetupGameListenersOptions
): void {
  const {
    setConnected,
    setLoading,
    setRoomId,
    setPracticeMode,
    setAppPhase,
    setGamePhase,
    setPhaseEndTime,
    setMapSeed,
    setMapThemeId,
    setMapSize,
    setPregeneratedMapIdentity,
    setLocalPlayer,
    updatePlayer,
    removePlayer,
    setMatchSummary,
    setPlayerPings,
    clearMatchSummary,
    resetLobby,
  } = useGameStore.getState();
  const sessionId = room.sessionId;
  const localPlayerName = playerName;
  let streamerMapTransitionSerial = 0;

  const applyIncomingMapState = (data: {
    mapSeed: number;
    mapThemeId?: VoxelMapTheme['id'] | null;
    mapSize?: VoxelMapSizeId | null;
    mapProfileId?: MapProfileId | null;
    pregeneratedMapId?: string | null;
    mapArtifactId?: string | null;
  }) => {
    setMapSeed(data.mapSeed);
    setMapThemeId(data.mapThemeId ?? null);
    setMapSize(data.mapSize);
    useGameStore.getState().setMapProfileId(data.mapProfileId);
    setPregeneratedMapIdentity(data.pregeneratedMapId, data.mapArtifactId);
  };

  const applyIncomingMapStateWithStreamerTransition = (data: {
    mapSeed: number;
    mapThemeId?: VoxelMapTheme['id'] | null;
    mapSize?: VoxelMapSizeId | null;
    mapProfileId?: MapProfileId | null;
    pregeneratedMapId?: string | null;
    mapArtifactId?: string | null;
  }) => {
    const nextMapSize = normalizeVoxelMapSizeId(data.mapSize);
    const nextMapProfileId = normalizeMapProfileId(data.mapProfileId);
    const current = useGameStore.getState();
    const mapChanged = (
      data.mapSeed !== current.mapSeed ||
      (data.mapThemeId ?? null) !== current.mapThemeId ||
      nextMapSize !== current.mapSize ||
      nextMapProfileId !== current.mapProfileId ||
      (data.pregeneratedMapId ?? null) !== current.pregeneratedMapId ||
      (data.mapArtifactId ?? null) !== current.mapArtifactId
    );

    if (!useStreamerStore.getState().isActive || !mapChanged) {
      applyIncomingMapState(data);
      return;
    }

    const transitionKey = getStreamerMapTransitionKey({
      mapSeed: data.mapSeed,
      mapThemeId: data.mapThemeId ?? null,
      mapSize: nextMapSize,
      mapProfileId: nextMapProfileId,
      pregeneratedMapId: data.pregeneratedMapId ?? null,
    });
    const transitionSerial = ++streamerMapTransitionSerial;
    useStreamerStore.getState().beginSceneTransition({
      key: transitionKey,
      reason: 'map_rotation',
    });

    const leadPromise = new Promise<void>((resolve) => {
      window.setTimeout(resolve, STREAMER_MAP_TRANSITION_LEAD_MS);
    });
    void Promise.allSettled([
      preloadStreamerMapTransitionTarget({
        mapSeed: data.mapSeed,
        mapThemeId: data.mapThemeId ?? null,
        mapSize: nextMapSize,
        mapProfileId: nextMapProfileId,
        pregeneratedMapId: data.pregeneratedMapId ?? null,
      }, 'streamer-phase-change'),
      leadPromise,
    ]).then(() => {
      if (transitionSerial !== streamerMapTransitionSerial) return;
      if (!useStreamerStore.getState().isActive || gameRoomRef.current !== room) return;
      applyIncomingMapState(data);
    }).catch((error) => {
      loggers.network.warn('streamer phase map transition failed', error);
      if (
        transitionSerial === streamerMapTransitionSerial &&
        useStreamerStore.getState().isActive &&
        gameRoomRef.current === room
      ) {
        applyIncomingMapState(data);
      }
    });
  };

  setLocalPlayer(createDefaultLocalPlayer(sessionId, playerName));
  useGameStore.getState().cleanupGhostPlayers();

  const playersMap = room.state.players as SchemaPlayerCollection | undefined;
  if (playersMap && typeof playersMap.onAdd === 'function' && typeof playersMap.onRemove === 'function') {
    playersMap.onAdd((schemaPlayer, id) => {
      const schemaPlayerWithChange = schemaPlayer as SchemaPlayerWithChange;
      loggers.network.debug('player added via schema', id, schemaPlayerWithChange.name);
      syncPlayerFromSchema(schemaPlayer, id, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });

      if (typeof schemaPlayerWithChange.onChange === 'function') {
        schemaPlayerWithChange.onChange(() => {
          syncPlayerFromSchema(schemaPlayer, id, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });
        });
      }
    });

    playersMap.onRemove((_schemaPlayer, id) => {
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

  room.onMessage('streamerObserverJoined', measureNetworkMessage('streamerObserverJoined', (data: StreamerObserverJoinedMessage) => {
    loggers.network.info('streamer observer session acknowledged', {
      roomId: data.roomId ?? room.id,
      sessionId: data.sessionId ?? room.sessionId,
      streamerObserverCount: data.streamerObserverCount,
      streamerObserverSeatCount: data.streamerObserverSeatCount,
      streamerManagedBotGame: data.streamerManagedBotGame === true,
      streamerFeedMode: data.streamerFeedMode ?? null,
      streamerCameraMode: data.streamerCameraMode ?? null,
      endlessMatch: data.endlessMatch === true,
    });
  }));

  room.onMessage('phaseChange', measureNetworkMessage('phaseChange', (data: {
    phase: string;
    endTime: number;
    mapSeed?: number;
    mapThemeId?: VoxelMapTheme['id'] | null;
    mapSize?: VoxelMapSizeId | null;
    mapProfileId?: MapProfileId | null;
    pregeneratedMapId?: string | null;
    mapArtifactId?: string | null;
  }) => {
    loggers.network.debug('phase change message', data.phase);
    if (typeof data.mapSeed === 'number') {
      applyIncomingMapStateWithStreamerTransition({
        mapSeed: data.mapSeed,
        mapThemeId: data.mapThemeId ?? null,
        mapSize: data.mapSize,
        mapProfileId: data.mapProfileId,
        pregeneratedMapId: data.pregeneratedMapId,
        mapArtifactId: data.mapArtifactId,
      });
    }
    const nextPhase = normalizeGamePhase(data.phase);
    setGamePhase(nextPhase);
    setPhaseEndTime(data.endTime);
    if (nextPhase !== 'hero_select') {
      setMatchStartGateKey(null);
    }
  }));

  room.onMessage('matchStartGate', measureNetworkMessage('matchStartGate', (data: MatchStartGateMessage) => {
    if (!data || typeof data.key !== 'number' || !Number.isInteger(data.key)) return;

    if (typeof data.mapSeed === 'number') {
      applyIncomingMapState({
        mapSeed: data.mapSeed,
        mapThemeId: data.mapThemeId ?? null,
        mapSize: data.mapSize,
        mapProfileId: data.mapProfileId,
        pregeneratedMapId: data.pregeneratedMapId,
        mapArtifactId: data.mapArtifactId,
      });
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
      const movementEpoch = Number.isFinite(data.movementEpoch)
        ? Math.max(0, Math.trunc(data.movementEpoch as number))
        : 0;
      const ackSeq = Number.isFinite(data.ackSeq)
        ? Math.max(0, Math.trunc(data.ackSeq as number))
        : 0;
      const collisionRevision = Number.isFinite(data.collisionRevision)
        ? Math.max(0, Math.trunc(data.collisionRevision as number))
        : 0;
      const nextPlayer = {
        ...localPlayer,
        state: 'spawning' as const,
        position: { ...position },
        velocity: { x: 0, y: 0, z: 0 },
      };
      setLocalPlayer(nextPlayer);
      resetLocalMovementPrediction(movementStateFromPlayer(nextPlayer), movementEpoch, nextPlayer.id, {
        lastAckSeq: ackSeq,
        collisionRevision,
      });
    }

    setMatchStartGateKey(data.key);
  }));

  room.onMessage('gameEnd', measureNetworkMessage('gameEnd', (data: GameEndEvent) => {
    loggers.network.info('game ended', data.finalScore);
    clearRunningGameSession(room.id);
    useGameStore.setState({
      gameplayMode: isGameplayMode(data.gameplayMode) ? data.gameplayMode : DEFAULT_GAMEPLAY_MODE,
      matchPerspective: isMatchPerspective(data.matchPerspective) ? data.matchPerspective : DEFAULT_MATCH_PERSPECTIVE,
    });
    setMatchSummary(data);
    setGamePhase('game_end');
    setPhaseEndTime(null);
  }));

  room.onMessage('matchCancelled', measureNetworkMessage('matchCancelled', (data: MatchCancelledMessage) => {
    loggers.network.warn('match cancelled', {
      reason: data.reason,
      message: data.message,
      roomId: data.roomId,
      requiredHumanPlayers: data.requiredHumanPlayers,
      connectedHumanPlayers: data.connectedHumanPlayers,
      blockedPlayerId: data.blockedPlayerId,
      blockedPlayerName: data.blockedPlayerName,
      networkQuality: data.networkQuality,
    });
    disconnectVoice('match_cancelled');
    clearRunningGameSession(room.id);
    rejectPendingVoiceTokenRequests(data.message || 'match cancelled before start');
    rejectPendingPlayerReportRequests(data.message || 'match cancelled before start');
    clearDelayedGameplayEffects();
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
  setupPowerupHandlers(room);
  setupVoidZoneHandlers(room, sessionId);
  setupCombatHandlers(room);

  room.onMessage('playerPingRequest', measureNetworkMessage('playerPingRequest', (data: PlayerPingRequestMessage) => {
    if (!data || typeof data.nonce !== 'string') return;
    room.send('playerPingResponse', { nonce: data.nonce });
  }));

  room.onMessage('playerPings', measureNetworkMessage('playerPings', (data: PlayerPingsMessage) => {
    setPlayerPings(data);
  }));

  room.onMessage('chat', measureNetworkMessage('chat', (data: unknown) => {
    useChatStore.getState().addIncomingMessage('game', data);
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

  room.onMessage('devHeroChanged', measureNetworkMessage('devHeroChanged', (data: { heroId: HeroId; skinId?: HeroSkinId | null; health: number; maxHealth: number }) => {
    loggers.network.debug('developer hero switch confirmed', data.heroId);
    const store = useGameStore.getState();
    if (store.localPlayer) {
      setLocalPlayer({
        ...store.localPlayer,
        heroId: data.heroId,
        skinId: data.skinId ?? store.localPlayer.skinId,
        health: data.health,
        maxHealth: data.maxHealth,
      });
    }
  }));

  room.onMessage('devSkinChanged', measureNetworkMessage('devSkinChanged', (data: { heroId: HeroId; skinId: HeroSkinId }) => {
    loggers.network.debug('developer skin switch confirmed', data.skinId);
    const store = useGameStore.getState();
    if (store.localPlayer?.heroId === data.heroId) {
      setLocalPlayer({
        ...store.localPlayer,
        skinId: data.skinId,
      });
    }
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
    clearDelayedGameplayEffects();
    disconnectVoice('left_game_room');
    if (gameRoomRef.current === room) {
      gameRoomRef.current = null;
    } else {
      return;
    }
    isJoiningGameRef.current = false;
    setLoading(false);
    setConnected(false);
    setRoomId(null);
    setPracticeMode(false);
    setMatchStartGateKey(null);
    setGamePhase('waiting');
    resetLobby();
    setAppPhase('menu');
  });

  setConnected(true);
}
