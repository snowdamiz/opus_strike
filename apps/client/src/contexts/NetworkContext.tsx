import { createContext, useContext, useRef, useCallback, ReactNode } from 'react';
import { Client, Room } from 'colyseus.js';
import { useGameStore, LobbyPlayer, LobbyInfo } from '../store/gameStore';
import { config } from '../config/environment';
import { getClientId } from '../utils/clientId';
import type { HeroId, Team, PlayerInput, Player } from '@voxel-strike/shared';

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

export function NetworkProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<Client | null>(null);
  const lobbyRoomRef = useRef<Room | null>(null);
  const gameRoomRef = useRef<Room | null>(null);

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

  // Initialize client
  const getClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new Client(config.serverUrl);
    }
    return clientRef.current;
  }, []);

  // Fetch available lobbies
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

  // Create a new lobby
  const createLobby = useCallback(async (playerName: string, lobbyName?: string, isPrivate?: boolean) => {
    setLoading(true);

    try {
      // Clean up any existing connections before creating new lobby
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
  }, [getClient, setLoading, setPlayerId, setCurrentLobby, setIsLobbyHost, setAppPhase, setConnected]);

  // Join an existing lobby
  const joinLobby = useCallback(async (playerName: string, lobbyId: string) => {
    setLoading(true);

    try {
      // Clean up any existing connections before joining new lobby
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
  }, [getClient, setLoading, setPlayerId, setAppPhase, setConnected]);

  // Setup lobby room listeners
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
      
      // Update all players' isHost status
      const store = useGameStore.getState();
      const updatedPlayers = new Map<string, LobbyPlayer>();
      store.lobbyPlayers.forEach((p, id) => {
        updatedPlayers.set(id, { ...p, isHost: id === data.newHostId });
      });
      setLobbyPlayers(updatedPlayers);
    });

    // Track if we've already started joining a game to prevent double-joins
    let isJoiningGame = false;
    
    room.onMessage('gameStarting', async (data: { gameRoomId: string; players: { playerId: string; playerName: string; team: string }[] }) => {
      // Prevent handling duplicate gameStarting messages
      if (isJoiningGame) {
        console.log('[Lobby] Ignoring duplicate gameStarting message, already joining a game');
        return;
      }
      isJoiningGame = true;
      
      console.log('Game starting! Room:', data.gameRoomId);
      
      // Find our assigned team
      const myAssignment = data.players.find(p => p.playerId === room.sessionId);
      const myTeam = myAssignment?.team || 'red';
      
      // Join the game room
      try {
        await joinGameRoom(data.gameRoomId, playerName, myTeam);
      } catch (error) {
        console.error('Failed to join game room:', error);
        isJoiningGame = false; // Reset on error so they can try again
      }
    });

    room.onMessage('kicked', (data: { reason: string }) => {
      console.log('Kicked from lobby:', data.reason);
      leaveLobby();
    });

    room.onMessage('duplicateSession', (data: { reason: string }) => {
      console.log('Duplicate session detected in lobby:', data.reason);
      // The server will disconnect us - no need to do anything, onLeave will handle cleanup
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

  // Leave lobby
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

  // Lobby actions
  const setLobbyReady = useCallback((ready: boolean) => {
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.send('ready', { ready });
    }
  }, []);

  const setLobbyTeam = useCallback((team: string) => {
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.send('setTeam', { team });
    }
  }, []);

  const startGame = useCallback(() => {
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.send('startGame');
    }
  }, []);

  const kickPlayer = useCallback((playerId: string) => {
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.send('kick', { playerId });
    }
  }, []);

  // Track if we're currently in the process of joining a game room
  const isJoiningGameRef = useRef(false);
  
  // Join game room (called when game starts from lobby)
  const joinGameRoom = useCallback(async (gameRoomId: string, playerName: string, team?: string) => {
    // Prevent concurrent join attempts
    if (isJoiningGameRef.current) {
      console.log('[joinGameRoom] Already joining a game room, ignoring duplicate call');
      return;
    }
    isJoiningGameRef.current = true;
    
    setLoading(true);

    try {
      // Clean up any existing game room connection before joining new one
      if (gameRoomRef.current) {
        console.log('Cleaning up existing game room before joining new one');
        try {
          gameRoomRef.current.leave(false);
        } catch (e) {
          console.log('Error leaving old game room:', e);
        }
        gameRoomRef.current = null;
      }
      
      // Clear any existing player data from store to prevent duplicates
      const store = useGameStore.getState();
      store.setPlayers(new Map());
      
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
      isJoiningGameRef.current = false; // Reset on error so they can try again
      throw error;
    }
  }, [getClient, setLoading, setRoomId, setAppPhase]);

  // Setup game room listeners (extracted from original connect function)
  const setupGameListeners = useCallback((room: Room, playerName: string) => {
    const sessionId = room.sessionId;

    // Helper to create player from schema data
    const createPlayerData = (schemaPlayer: any, id: string): Player => {
      return {
        id,
        name: schemaPlayer.name || 'Unknown',
        team: (schemaPlayer.team || 'red') as Team,
        heroId: (schemaPlayer.heroId || null) as HeroId | null,
        state: (schemaPlayer.state || 'alive') as any,
        isReady: schemaPlayer.isReady || false,
        position: { 
          x: schemaPlayer.position?.x ?? 0, 
          y: schemaPlayer.position?.y ?? 1, 
          z: schemaPlayer.position?.z ?? 0 
        },
        velocity: { 
          x: schemaPlayer.velocity?.x ?? 0, 
          y: schemaPlayer.velocity?.y ?? 0, 
          z: schemaPlayer.velocity?.z ?? 0 
        },
        lookYaw: schemaPlayer.lookYaw ?? 0,
        lookPitch: schemaPlayer.lookPitch ?? 0,
        health: schemaPlayer.health ?? 100,
        maxHealth: schemaPlayer.maxHealth ?? 100,
        ultimateCharge: schemaPlayer.ultimateCharge ?? 0,
        movement: {
          isGrounded: true,
          isSprinting: false,
          isCrouching: false,
          isSliding: false,
          slideTimeRemaining: 0,
          isWallRunning: false,
          wallRunSide: null,
          isGrappling: false,
          grapplePoint: null,
          isJetpacking: false,
          jetpackFuel: 100,
          isGliding: false,
        },
        abilities: {},
        hasFlag: schemaPlayer.hasFlag || false,
        respawnTime: null,
        spawnProtectionUntil: null,
        stats: { 
          kills: 0, 
          deaths: 0, 
          assists: 0, 
          flagCaptures: 0, 
          flagReturns: 0 
        },
      };
    };

    // Create default local player immediately so movement works
    const defaultPlayer: Player = {
      id: sessionId,
      name: playerName,
      team: 'red',
      heroId: null,
      state: 'alive',
      isReady: false,
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      lookYaw: 0,
      lookPitch: 0,
      health: 100,
      maxHealth: 100,
      ultimateCharge: 0,
      movement: {
        isGrounded: true,
        isSprinting: false,
        isCrouching: false,
        isSliding: false,
        slideTimeRemaining: 0,
        isWallRunning: false,
        wallRunSide: null,
        isGrappling: false,
        grapplePoint: null,
        isJetpacking: false,
        jetpackFuel: 100,
        isGliding: false,
      },
      abilities: {},
      hasFlag: false,
      respawnTime: null,
      spawnProtectionUntil: null,
      stats: { kills: 0, deaths: 0, assists: 0, flagCaptures: 0, flagReturns: 0 },
    };
    setLocalPlayer(defaultPlayer);
    
    // Store the local player name for ghost detection - this is set ONCE and won't change
    const localPlayerName = playerName;
    
    // Immediately cleanup any ghost players that might exist from previous sessions
    useGameStore.getState().cleanupGhostPlayers();

    // Helper function to sync a player from schema to store
    const syncPlayerFromSchema = (schemaPlayer: any, id: string) => {
      if (id === sessionId) {
        // Our own player - update local player with server data
        // Get FRESH state to avoid overwriting ultimateCharge with stale data
        const store = useGameStore.getState();
        if (store.localPlayer) {
          const updated = {
            ...store.localPlayer,
            heroId: schemaPlayer.heroId || store.localPlayer.heroId,
            team: schemaPlayer.team || store.localPlayer.team,
            health: schemaPlayer.health ?? store.localPlayer.health,
            maxHealth: schemaPlayer.maxHealth ?? store.localPlayer.maxHealth,
            state: schemaPlayer.state || store.localPlayer.state,
            // Explicitly preserve ultimateCharge - it's managed by playerStates message
            ultimateCharge: store.localPlayer.ultimateCharge,
          };
          setLocalPlayer(updated);
        }
      } else {
        // Skip ghost players: same name as us but different ID (stale session from before reload)
        // Use captured localPlayerName from closure - guaranteed to be set
        if (schemaPlayer.name === localPlayerName) {
          console.log(`[SCHEMA SYNC] Ignoring ghost player: ${schemaPlayer.name} (${id})`);
          return;
        }
        
        // Other player - add/update in store
        const playerData = createPlayerData(schemaPlayer, id);
        updatePlayer(id, playerData);
      }
    };

    // Set up MapSchema callbacks
    const playersMap = room.state.players as any;
    if (playersMap && typeof playersMap.onAdd === 'function') {
      playersMap.onAdd((schemaPlayer: any, id: string) => {
        console.log('Player added via onAdd:', id, schemaPlayer?.name);
        syncPlayerFromSchema(schemaPlayer, id);

        if (typeof schemaPlayer?.onChange === 'function') {
          schemaPlayer.onChange(() => {
            syncPlayerFromSchema(schemaPlayer, id);
          });
        }
      });

      playersMap.onRemove((schemaPlayer: any, id: string) => {
        console.log('Player removed via onRemove:', id);
        if (id !== sessionId) {
          removePlayer(id);
        }
      });
    }

    // Polling for state sync
    let lastLoggedPlayerCount = -1;
    let pollCount = 0;
    const syncInterval = setInterval(() => {
      if (!room.state) return;
      pollCount++;

      // Sync phase
      if (room.state.phase) {
        const store = useGameStore.getState();
        if (room.state.phase !== store.gamePhase) {
          console.log('Phase synced:', room.state.phase);
          setGamePhase(room.state.phase as any);
        }
      }

      // Sync all players
      if (room.state.players) {
        const playersMap = room.state.players as any;
        const currentStore = useGameStore.getState();
        
        let serverPlayerCount = 0;
        const serverPlayerIds: string[] = [];
        
        if (playersMap.$items instanceof Map) {
          playersMap.$items.forEach((schemaPlayer: any, id: string) => {
            serverPlayerCount++;
            serverPlayerIds.push(id);
            processPlayer(schemaPlayer, id, currentStore);
          });
        }
        else if (typeof playersMap.forEach === 'function') {
          try {
            playersMap.forEach((schemaPlayer: any, id: string) => {
              serverPlayerCount++;
              serverPlayerIds.push(id);
              processPlayer(schemaPlayer, id, currentStore);
            });
          } catch (e) {
            // Silent fail
          }
        }
        
        if (serverPlayerCount !== lastLoggedPlayerCount || pollCount % 100 === 1) {
          console.log(`POLL #${pollCount}: Server=${serverPlayerCount} players`);
          lastLoggedPlayerCount = serverPlayerCount;
        }
        
        // Periodic ghost cleanup every 10 polls (500ms)
        if (pollCount % 10 === 0) {
          useGameStore.getState().cleanupGhostPlayers();
        }
        
        function processPlayer(schemaPlayer: any, id: string, _store: any) {
          if (id === sessionId) {
            // For the local player, get FRESH state to avoid overwriting ultimateCharge
            // with stale data from the captured store snapshot
            const freshStore = useGameStore.getState();
            if (freshStore.localPlayer) {
              const updated = {
                ...freshStore.localPlayer,
                heroId: schemaPlayer.heroId || freshStore.localPlayer.heroId,
                team: schemaPlayer.team || freshStore.localPlayer.team,
                health: schemaPlayer.health ?? freshStore.localPlayer.health,
                maxHealth: schemaPlayer.maxHealth ?? freshStore.localPlayer.maxHealth,
                state: schemaPlayer.state || freshStore.localPlayer.state,
                // Explicitly preserve ultimateCharge from fresh state
                ultimateCharge: freshStore.localPlayer.ultimateCharge,
              };
              setLocalPlayer(updated);
            }
            return;
          }

          // For other players, get fresh state to avoid stale data
          const otherStore = useGameStore.getState();
          
          // Skip ghost players: same name as us but different ID (stale session from before reload)
          // Use captured localPlayerName from closure - guaranteed to be set
          if (schemaPlayer.name === localPlayerName) {
            console.log(`[POLL] Ignoring ghost player: ${schemaPlayer.name} (${id})`);
            return;
          }
          
          const existingPlayer = otherStore.players.get(id);
          if (!existingPlayer) {
            const playerData = createPlayerData(schemaPlayer, id);
            updatePlayer(id, playerData);
          } else {
            const positionUpdated = {
              ...existingPlayer,
              position: {
                x: schemaPlayer.position?.x ?? existingPlayer.position.x,
                y: schemaPlayer.position?.y ?? existingPlayer.position.y,
                z: schemaPlayer.position?.z ?? existingPlayer.position.z,
              },
              velocity: {
                x: schemaPlayer.velocity?.x ?? existingPlayer.velocity.x,
                y: schemaPlayer.velocity?.y ?? existingPlayer.velocity.y,
                z: schemaPlayer.velocity?.z ?? existingPlayer.velocity.z,
              },
              lookYaw: schemaPlayer.lookYaw ?? existingPlayer.lookYaw,
              lookPitch: schemaPlayer.lookPitch ?? existingPlayer.lookPitch,
              state: schemaPlayer.state || existingPlayer.state,
              heroId: schemaPlayer.heroId || existingPlayer.heroId,
              team: schemaPlayer.team || existingPlayer.team,
            };
            updatePlayer(id, positionUpdated);
          }
        }
      }
    }, 50);

    // Handle explicit messages
    room.onMessage('phaseChange', (data: { phase: string; endTime: number }) => {
      console.log('Phase change message:', data.phase);
      setGamePhase(data.phase as any);
      setPhaseEndTime(data.endTime);
    });

    room.onMessage('playerJoined', (data: { playerId: string; playerName: string; team?: string; heroId?: string; position?: { x: number; y: number; z: number } }) => {
      console.log(`Player joined message: ${data.playerName} (${data.playerId})`);
      
      if (data.playerId !== sessionId) {
        // Skip ghost players: same name as us but different ID (stale session from before reload)
        // Use captured localPlayerName from closure - guaranteed to be set
        if (data.playerName === localPlayerName) {
          console.log(`[JOIN MSG] Ignoring ghost player: ${data.playerName} (${data.playerId})`);
          return;
        }
        
        const currentStore = useGameStore.getState();
        if (!currentStore.players.has(data.playerId)) {
          const newPlayer: Player = {
            id: data.playerId,
            name: data.playerName,
            team: (data.team || 'red') as Team,
            heroId: (data.heroId || null) as HeroId | null,
            state: 'selecting',
            isReady: false,
            position: data.position || { x: 0, y: 1, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
            lookYaw: 0,
            lookPitch: 0,
            health: 100,
            maxHealth: 100,
            ultimateCharge: 0,
            movement: {
              isGrounded: true,
              isSprinting: false,
              isCrouching: false,
              isSliding: false,
              slideTimeRemaining: 0,
              isWallRunning: false,
              wallRunSide: null,
              isGrappling: false,
              grapplePoint: null,
              isJetpacking: false,
              jetpackFuel: 100,
              isGliding: false,
            },
            abilities: {},
            hasFlag: false,
            respawnTime: null,
            spawnProtectionUntil: null,
            stats: { kills: 0, deaths: 0, assists: 0, flagCaptures: 0, flagReturns: 0 },
          };
          updatePlayer(data.playerId, newPlayer);
        }
      }
    });

    room.onMessage('playerStates', (data: { players: any[] }) => {
      for (const serverPlayer of data.players) {
        // Skip ghost players: same name as us but different ID (stale session from before reload)
        // Use captured localPlayerName from closure - guaranteed to be set
        if (serverPlayer.id !== sessionId && serverPlayer.name === localPlayerName) {
          console.log(`[STATES MSG] Ignoring ghost player: ${serverPlayer.name} (${serverPlayer.id})`);
          continue;
        }
        
        if (serverPlayer.id === sessionId) {
          // IMPORTANT: Get FRESH state for each update to avoid stale closure issues
          // This prevents race conditions where concurrent handlers (syncPlayerFromSchema,
          // processPlayer) might update the state between when we captured it and now.
          const freshStore = useGameStore.getState();
          if (freshStore.localPlayer) {
            const localUltCharge = freshStore.localPlayer.ultimateCharge;
            const serverUltCharge = serverPlayer.ultimateCharge ?? localUltCharge;
            
            // Race condition protection for ultimateCharge:
            // 1. If server sends value MORE than 50 higher than local → stale high value after we used ultimate
            // 2. If server sends value LOWER than local AND local is > 5 → stale low value (like initial 0)
            //    We allow small decreases (< 5) for edge cases and accept 0 when local is also near 0
            let ultimateCharge = serverUltCharge;
            const serverJumpedUp = serverUltCharge > localUltCharge + 50;
            const serverDroppedDown = serverUltCharge < localUltCharge && localUltCharge > 5;
            
            if (serverJumpedUp) {
              // Server sent stale high value after we used ultimate - keep local (which should be ~0)
              ultimateCharge = localUltCharge;
            } else if (serverDroppedDown) {
              // Server sent lower value but local is already higher - likely stale/out-of-order message
              // Keep the higher local value since charge should only increase (until ultimate is used)
              ultimateCharge = localUltCharge;
            }
            // Otherwise accept server value (normal progression or legitimate reset to 0)
            
            const updated = {
              ...freshStore.localPlayer,
              health: serverPlayer.health ?? freshStore.localPlayer.health,
              maxHealth: serverPlayer.maxHealth ?? freshStore.localPlayer.maxHealth,
              ultimateCharge,
              state: serverPlayer.state || freshStore.localPlayer.state,
              heroId: serverPlayer.heroId || freshStore.localPlayer.heroId,
              team: serverPlayer.team || freshStore.localPlayer.team,
              hasFlag: serverPlayer.hasFlag ?? freshStore.localPlayer.hasFlag,
              abilities: serverPlayer.abilities || freshStore.localPlayer.abilities,
            };
            setLocalPlayer(updated);
          }
        } else {
          // For other players, get fresh state to avoid stale data
          const otherPlayerStore = useGameStore.getState();
          const existingPlayer = otherPlayerStore.players.get(serverPlayer.id);
          if (existingPlayer) {
            const updatedPlayer: Player = {
              ...existingPlayer,
              name: serverPlayer.name || existingPlayer.name,
              team: (serverPlayer.team || existingPlayer.team) as Team,
              heroId: (serverPlayer.heroId || existingPlayer.heroId) as HeroId | null,
              state: serverPlayer.state || existingPlayer.state,
              position: serverPlayer.position || existingPlayer.position,
              velocity: serverPlayer.velocity || existingPlayer.velocity,
              lookYaw: serverPlayer.lookYaw ?? existingPlayer.lookYaw,
              lookPitch: serverPlayer.lookPitch ?? existingPlayer.lookPitch,
              health: serverPlayer.health ?? existingPlayer.health,
              maxHealth: serverPlayer.maxHealth ?? existingPlayer.maxHealth,
              ultimateCharge: serverPlayer.ultimateCharge ?? existingPlayer.ultimateCharge,
              hasFlag: serverPlayer.hasFlag ?? existingPlayer.hasFlag,
              abilities: serverPlayer.abilities || existingPlayer.abilities,
            };
            updatePlayer(serverPlayer.id, updatedPlayer);
          } else {
            const newPlayer: Player = {
              id: serverPlayer.id,
              name: serverPlayer.name || 'Unknown',
              team: (serverPlayer.team || 'red') as Team,
              heroId: (serverPlayer.heroId || null) as HeroId | null,
              state: serverPlayer.state || 'alive',
              isReady: false,
              position: serverPlayer.position || { x: 0, y: 1, z: 0 },
              velocity: serverPlayer.velocity || { x: 0, y: 0, z: 0 },
              lookYaw: serverPlayer.lookYaw ?? 0,
              lookPitch: serverPlayer.lookPitch ?? 0,
              health: serverPlayer.health ?? 100,
              maxHealth: serverPlayer.maxHealth ?? 100,
              ultimateCharge: serverPlayer.ultimateCharge ?? 0,
              movement: {
                isGrounded: true,
                isSprinting: false,
                isCrouching: false,
                isSliding: false,
                slideTimeRemaining: 0,
                isWallRunning: false,
                wallRunSide: null,
                isGrappling: false,
                grapplePoint: null,
                isJetpacking: false,
                jetpackFuel: 100,
                isGliding: false,
              },
              abilities: serverPlayer.abilities || {},
              hasFlag: serverPlayer.hasFlag ?? false,
              respawnTime: null,
              spawnProtectionUntil: null,
              stats: { kills: 0, deaths: 0, assists: 0, flagCaptures: 0, flagReturns: 0 },
            };
            updatePlayer(serverPlayer.id, newPlayer);
          }
        }
      }
    });

    room.onMessage('playerLeft', (data: { playerId: string }) => {
      console.log(`Player left: ${data.playerId}`);
      removePlayer(data.playerId);
    });

    // Handle ability usage confirmation from server
    room.onMessage('abilityUsed', (data: { playerId: string; abilityId: string; success: boolean }) => {
      console.log(`Ability used: ${data.abilityId} by ${data.playerId}, success: ${data.success}`);
    });

    // Handle void zone events (from phantom blink)
    room.onMessage('voidZoneCreated', (data: { id: string; position: { x: number; y: number; z: number }; radius: number; duration: number; startTime: number; ownerId: string; ownerTeam: 'red' | 'blue' }) => {
      // Skip if this is our own void zone (we already created it client-side for instant feedback)
      const store = useGameStore.getState();
      if (data.ownerId === sessionId) {
        console.log(`Void zone from server (our own, skipping duplicate)`);
        return;
      }
      console.log(`Void zone created by ${data.ownerId} at (${data.position.x.toFixed(1)}, ${data.position.y.toFixed(1)}, ${data.position.z.toFixed(1)})`);
      store.addVoidZone(data);
    });

    room.onMessage('voidZoneExpired', (data: { id: string }) => {
      console.log(`Void zone expired: ${data.id}`);
      useGameStore.getState().removeVoidZone(data.id);
    });

    room.onMessage('playerDamaged', (data: { targetId: string; damage: number; sourceId: string; damageType: string }) => {
      console.log(`Player ${data.targetId} took ${data.damage} damage from ${data.damageType}`);
    });

    room.onMessage('playerKilled', (data: { victimId: string; killerId: string; position: { x: number; y: number; z: number } }) => {
      console.log(`Player ${data.victimId} killed by ${data.killerId}`);
    });

    // Handle being kicked due to duplicate session (reconnection from another tab/window)
    room.onMessage('duplicateSession', (data: { reason: string }) => {
      console.log('Duplicate session detected:', data.reason);
      // The server will disconnect us - no need to do anything, onLeave will handle cleanup
    });

    room.onError((code, message) => {
      console.error('Room error:', code, message);
    });

    room.onLeave((code) => {
      console.log('Left room:', code);
      clearInterval(syncInterval);
      // Don't call reset() - just clean up game state but preserve player name
      setConnected(false);
      setRoomId(null);
      setGamePhase('waiting' as any);
      resetLobby();
      setAppPhase('browsing_lobbies');
    });

    setConnected(true);
  }, [setConnected, setGamePhase, setPhaseEndTime, setLocalPlayer, updatePlayer, removePlayer, setAppPhase, setRoomId, resetLobby]);

  // Leave the current game and return to lobby browser (keeps player name)
  const leaveGame = useCallback(() => {
    if (gameRoomRef.current) {
      gameRoomRef.current.leave();
      gameRoomRef.current = null;
    }
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.leave();
      lobbyRoomRef.current = null;
    }
    // Reset the joining flag so user can join a new game
    isJoiningGameRef.current = false;
    // Reset game state but keep player name
    setRoomId(null);
    setConnected(false);
    resetLobby();
    setGamePhase('waiting' as any);
    setAppPhase('browsing_lobbies');
  }, [setRoomId, setConnected, resetLobby, setGamePhase, setAppPhase]);

  const disconnect = useCallback(() => {
    if (gameRoomRef.current) {
      gameRoomRef.current.leave();
      gameRoomRef.current = null;
    }
    if (lobbyRoomRef.current) {
      lobbyRoomRef.current.leave();
      lobbyRoomRef.current = null;
    }
    if (clientRef.current) {
      clientRef.current = null;
    }
    isJoiningGameRef.current = false;
    reset();
  }, [reset]);

  const sendInput = useCallback((input: PlayerInput) => {
    if (gameRoomRef.current) {
      gameRoomRef.current.send('input', input);
    }
  }, []);

  const selectHero = useCallback((heroId: HeroId) => {
    console.log('Sending selectHero:', heroId);
    if (gameRoomRef.current) {
      gameRoomRef.current.send('selectHero', { heroId });
    }
  }, []);

  const selectTeam = useCallback((team: Team) => {
    console.log('Sending selectTeam:', team);
    if (gameRoomRef.current) {
      gameRoomRef.current.send('selectTeam', { team });
    }
  }, []);

  const setReady = useCallback((ready: boolean) => {
    console.log('Sending ready:', ready);
    if (gameRoomRef.current) {
      gameRoomRef.current.send('ready', { ready });
    }
  }, []);

  // NPC/Bot operations
  const spawnNpc = useCallback((heroId: HeroId, team?: Team, position?: { x: number; y: number; z: number }, name?: string) => {
    if (gameRoomRef.current) {
      // Only include team if specified, otherwise server will pick opposite team
      const data: any = { heroId, position, name };
      if (team) data.team = team;
      gameRoomRef.current.send('spawnNpc', data);
    }
  }, []);

  const damageNpc = useCallback((npcId: string, damage: number) => {
    if (gameRoomRef.current) {
      gameRoomRef.current.send('damageNpc', { npcId, damage });
    }
  }, []);

  const killNpc = useCallback((npcId: string) => {
    if (gameRoomRef.current) {
      gameRoomRef.current.send('killNpc', { npcId });
    }
  }, []);

  const killAllNpcs = useCallback(() => {
    if (gameRoomRef.current) {
      gameRoomRef.current.send('killAllNpcs', {});
    }
  }, []);

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

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork must be used within a NetworkProvider');
  }
  return context;
}
