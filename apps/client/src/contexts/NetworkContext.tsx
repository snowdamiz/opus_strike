import { createContext, useContext, useRef, useCallback, ReactNode } from 'react';
import { Client, Room } from 'colyseus.js';
import { useGameStore, LobbyPlayer, LobbyInfo } from '../store/gameStore';
import { config } from '../config/environment';
import { getClientId } from '../utils/clientId';
import type { HeroId, Team, PlayerInput } from '@voxel-strike/shared';

// Import extracted handlers
import {
  createDefaultLocalPlayer,
  syncPlayerFromSchema,
  setupPlayerJoinedHandler,
  setupPlayerStatesHandler,
  setupVoidZoneHandlers,
  setupCombatHandlers,
  setupPollingSync,
} from './gameMessageHandlers';

// ============================================================================
// CONTEXT TYPE
// ============================================================================

interface NetworkContextType {
  // Lobby operations
  fetchLobbies: () => Promise<LobbyInfo[]>;
  createLobby: (playerName: string, lobbyName?: string, isPrivate?: boolean) => Promise<void>;
  joinLobby: (playerName: string, lobbyId: string) => Promise<void>;
  leaveLobby: () => void;
  setLobbyReady: (ready: boolean) => void;
  setLobbyTeam: (team: string) => void;
  startGame: () => void;
  kickPlayer: (playerId: string) => void;

  // Game operations
  joinGameRoom: (gameRoomId: string, playerName: string, team?: string) => Promise<void>;
  leaveGame: () => void;
  disconnect: () => void;
  sendInput: (input: PlayerInput) => void;
  selectHero: (heroId: HeroId) => void;
  selectTeam: (team: Team) => void;
  setReady: (ready: boolean) => void;

  // NPC/Bot operations (for testing)
  spawnNpc: (heroId: HeroId, team?: Team, position?: { x: number; y: number; z: number }, name?: string) => void;
  damageNpc: (npcId: string, damage: number) => void;
  killNpc: (npcId: string) => void;
  killAllNpcs: () => void;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

export function NetworkProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<Client | null>(null);
  const lobbyRoomRef = useRef<Room | null>(null);
  const gameRoomRef = useRef<Room | null>(null);
  const isJoiningGameRef = useRef(false);

  const {
    setConnected,
    setLoading,
    setRoomId,
    setPlayerId,
    setAppPhase,
    setGamePhase,
    setPhaseEndTime,
    setLocalPlayer,
    updatePlayer,
    removePlayer,
    setAvailableLobbies,
    setCurrentLobby,
    setLobbyPlayers,
    updateLobbyPlayer,
    removeLobbyPlayer,
    setIsLobbyHost,
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
      const httpUrl = config.serverUrl.replace('ws://', 'http://').replace('wss://', 'https://');
      const response = await fetch(`${httpUrl}/lobbies`);
      const data = await response.json();
      const lobbies = data.lobbies || [];
      setAvailableLobbies(lobbies);
      return lobbies;
    } catch (error) {
      console.error('Failed to fetch lobbies:', error);
      return [];
    }
  }, [setAvailableLobbies]);

  const cleanupExistingConnections = useCallback(() => {
    if (lobbyRoomRef.current) {
      try {
        lobbyRoomRef.current.leave(false);
      } catch (e) {
        console.log('Error leaving old lobby room:', e);
      }
      lobbyRoomRef.current = null;
    }
    if (gameRoomRef.current) {
      try {
        gameRoomRef.current.leave(false);
      } catch (e) {
        console.log('Error leaving old game room:', e);
      }
      gameRoomRef.current = null;
    }
  }, []);

  const setupLobbyListeners = useCallback((room: Room, playerName: string) => {
    room.onMessage('lobbyState', (data: { lobbyId: string; name: string; hostId: string; status: string; players: any[] }) => {
      console.log('Received lobby state:', data);
      setCurrentLobby(data.lobbyId, data.name);
      setIsLobbyHost(data.hostId === room.sessionId);

      const playersMap = new Map<string, LobbyPlayer>();
      for (const p of data.players) {
        playersMap.set(p.id, {
          id: p.id,
          name: p.name,
          isHost: p.isHost,
          isReady: p.isReady,
          team: p.team,
        });
      }
      setLobbyPlayers(playersMap);
    });

    room.onMessage('playerJoined', (data: { playerId: string; playerName: string; isHost: boolean }) => {
      console.log('Player joined lobby:', data.playerName);
      updateLobbyPlayer(data.playerId, {
        id: data.playerId,
        name: data.playerName,
        isHost: data.isHost,
        isReady: false,
        team: '',
      });
    });

    room.onMessage('playerLeft', (data: { playerId: string }) => {
      console.log('Player left lobby:', data.playerId);
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

    room.onMessage('hostChanged', (data: { newHostId: string; newHostName: string }) => {
      console.log('Host changed to:', data.newHostName);
      setIsLobbyHost(data.newHostId === room.sessionId);

      const store = useGameStore.getState();
      const updatedPlayers = new Map<string, LobbyPlayer>();
      store.lobbyPlayers.forEach((p, id) => {
        updatedPlayers.set(id, { ...p, isHost: id === data.newHostId });
      });
      setLobbyPlayers(updatedPlayers);
    });

    let isJoiningGame = false;
    room.onMessage('gameStarting', async (data: { gameRoomId: string; players: { playerId: string; playerName: string; team: string }[] }) => {
      if (isJoiningGame) {
        console.log('[Lobby] Ignoring duplicate gameStarting message');
        return;
      }
      isJoiningGame = true;

      console.log('Game starting! Room:', data.gameRoomId);
      const myAssignment = data.players.find(p => p.playerId === room.sessionId);
      const myTeam = myAssignment?.team || 'red';

      try {
        await joinGameRoom(data.gameRoomId, playerName, myTeam);
      } catch (error) {
        console.error('Failed to join game room:', error);
        isJoiningGame = false;
      }
    });

    room.onMessage('kicked', (data: { reason: string }) => {
      console.log('Kicked from lobby:', data.reason);
      leaveLobby();
    });

    room.onMessage('duplicateSession', (data: { reason: string }) => {
      console.log('Duplicate session detected in lobby:', data.reason);
    });

    room.onMessage('error', (data: { message: string }) => {
      console.error('Lobby error:', data.message);
    });

    room.onError((code, message) => {
      console.error('Lobby room error:', code, message);
    });

    room.onLeave((code) => {
      console.log('Left lobby room:', code);
      resetLobby();
    });
  }, [setCurrentLobby, setIsLobbyHost, setLobbyPlayers, updateLobbyPlayer, removeLobbyPlayer, resetLobby]);

  const createLobby = useCallback(async (playerName: string, lobbyName?: string, isPrivate?: boolean) => {
    setLoading(true);

    try {
      cleanupExistingConnections();

      const client = getClient();
      const clientId = getClientId();

      console.log('Creating lobby with clientId:', clientId);

      lobbyRoomRef.current = await client.create('lobby_room', {
        playerName,
        lobbyName: lobbyName || `${playerName}'s Lobby`,
        isPrivate: isPrivate || false,
        clientId,
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      setCurrentLobby(lobbyRoomRef.current.id, lobbyName || `${playerName}'s Lobby`);
      setIsLobbyHost(true);
      setAppPhase('in_lobby');
      setConnected(true);
      setLoading(false);

      console.log('Created lobby:', lobbyRoomRef.current.id);
    } catch (error) {
      console.error('Failed to create lobby:', error);
      setLoading(false);
      throw error;
    }
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setCurrentLobby, setIsLobbyHost, setAppPhase, setConnected]);

  const joinLobby = useCallback(async (playerName: string, lobbyId: string) => {
    setLoading(true);

    try {
      cleanupExistingConnections();

      const client = getClient();
      const clientId = getClientId();

      console.log('Joining lobby with clientId:', clientId);

      lobbyRoomRef.current = await client.joinById(lobbyId, {
        playerName,
        clientId,
      });

      setupLobbyListeners(lobbyRoomRef.current, playerName);

      setPlayerId(lobbyRoomRef.current.sessionId);
      setAppPhase('in_lobby');
      setConnected(true);
      setLoading(false);

      console.log('Joined lobby:', lobbyRoomRef.current.id);
    } catch (error) {
      console.error('Failed to join lobby:', error);
      setLoading(false);
      throw error;
    }
  }, [getClient, cleanupExistingConnections, setupLobbyListeners, setLoading, setPlayerId, setAppPhase, setConnected]);

  const leaveLobby = useCallback(() => {
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

  const startGame = useCallback(() => {
    lobbyRoomRef.current?.send('startGame');
  }, []);

  const kickPlayer = useCallback((playerId: string) => {
    lobbyRoomRef.current?.send('kick', { playerId });
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
    const actions = { setLocalPlayer, updatePlayer, setGamePhase };

    // Set up MapSchema callbacks
    const playersMap = room.state.players as any;
    if (playersMap && typeof playersMap.onAdd === 'function') {
      playersMap.onAdd((schemaPlayer: any, id: string) => {
        console.log('Player added via onAdd:', id, schemaPlayer?.name);
        syncPlayerFromSchema(schemaPlayer, id, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });

        if (typeof schemaPlayer?.onChange === 'function') {
          schemaPlayer.onChange(() => {
            syncPlayerFromSchema(schemaPlayer, id, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });
          });
        }
      });

      playersMap.onRemove((_schemaPlayer: any, id: string) => {
        console.log('Player removed via onRemove:', id);
        if (id !== sessionId) {
          removePlayer(id);
        }
      });
    }

    // Set up polling sync
    const syncInterval = setupPollingSync(room, sessionId, localPlayerName, actions);

    // Set up message handlers
    room.onMessage('phaseChange', (data: { phase: string; endTime: number }) => {
      console.log('Phase change message:', data.phase);
      setGamePhase(data.phase as any);
      setPhaseEndTime(data.endTime);
    });

    setupPlayerJoinedHandler(room, sessionId, localPlayerName, updatePlayer);
    setupPlayerStatesHandler(room, sessionId, localPlayerName, { setLocalPlayer, updatePlayer });
    setupVoidZoneHandlers(room, sessionId);
    setupCombatHandlers(room);

    room.onMessage('playerLeft', (data: { playerId: string }) => {
      console.log(`Player left: ${data.playerId}`);
      removePlayer(data.playerId);
    });

    room.onMessage('duplicateSession', (data: { reason: string }) => {
      console.log('Duplicate session detected:', data.reason);
    });

    room.onError((code, message) => {
      console.error('Room error:', code, message);
    });

    room.onLeave((code) => {
      console.log('Left room:', code);
      clearInterval(syncInterval);
      setConnected(false);
      setRoomId(null);
      setGamePhase('waiting' as any);
      resetLobby();
      setAppPhase('browsing_lobbies');
    });

    setConnected(true);
  }, [setConnected, setGamePhase, setPhaseEndTime, setLocalPlayer, updatePlayer, removePlayer, setAppPhase, setRoomId, resetLobby]);

  const joinGameRoom = useCallback(async (gameRoomId: string, playerName: string, team?: string) => {
    if (isJoiningGameRef.current) {
      console.log('[joinGameRoom] Already joining a game room, ignoring duplicate call');
      return;
    }
    isJoiningGameRef.current = true;

    setLoading(true);

    try {
      if (gameRoomRef.current) {
        console.log('Cleaning up existing game room');
        try {
          gameRoomRef.current.leave(false);
        } catch (e) {
          console.log('Error leaving old game room:', e);
        }
        gameRoomRef.current = null;
      }

      useGameStore.getState().setPlayers(new Map());

      const client = getClient();
      const clientId = getClientId();

      console.log('Joining game room with clientId:', clientId);

      gameRoomRef.current = await client.joinById(gameRoomId, {
        playerName,
        preferredTeam: team,
        clientId,
      });

      setupGameListeners(gameRoomRef.current, playerName);

      setRoomId(gameRoomRef.current.id);
      setAppPhase('in_game');
      setLoading(false);

      console.log('Joined game room:', gameRoomRef.current.id);
    } catch (error) {
      console.error('Failed to join game room:', error);
      setLoading(false);
      isJoiningGameRef.current = false;
      throw error;
    }
  }, [getClient, setupGameListeners, setLoading, setRoomId, setAppPhase]);

  const leaveGame = useCallback(() => {
    gameRoomRef.current?.leave();
    gameRoomRef.current = null;
    lobbyRoomRef.current?.leave();
    lobbyRoomRef.current = null;
    isJoiningGameRef.current = false;
    setRoomId(null);
    setConnected(false);
    resetLobby();
    setGamePhase('waiting' as any);
    setAppPhase('browsing_lobbies');
  }, [setRoomId, setConnected, resetLobby, setGamePhase, setAppPhase]);

  const disconnect = useCallback(() => {
    gameRoomRef.current?.leave();
    gameRoomRef.current = null;
    lobbyRoomRef.current?.leave();
    lobbyRoomRef.current = null;
    clientRef.current = null;
    isJoiningGameRef.current = false;
    reset();
  }, [reset]);

  // ==================== GAME ACTIONS ====================

  const sendInput = useCallback((input: PlayerInput) => {
    gameRoomRef.current?.send('input', input);
  }, []);

  const selectHero = useCallback((heroId: HeroId) => {
    console.log('Sending selectHero:', heroId);
    gameRoomRef.current?.send('selectHero', { heroId });
  }, []);

  const selectTeam = useCallback((team: Team) => {
    console.log('Sending selectTeam:', team);
    gameRoomRef.current?.send('selectTeam', { team });
  }, []);

  const setReady = useCallback((ready: boolean) => {
    console.log('Sending ready:', ready);
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
      createLobby,
      joinLobby,
      leaveLobby,
      setLobbyReady,
      setLobbyTeam,
      startGame,
      kickPlayer,
      joinGameRoom,
      leaveGame,
      disconnect,
      sendInput,
      selectHero,
      selectTeam,
      setReady,
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
