import { createContext, useContext, useRef, useCallback, ReactNode } from 'react';
import { Client, Room } from 'colyseus.js';
import { useGameStore } from '../store/gameStore';
import type { HeroId, Team, PlayerInput, Player } from '@voxel-strike/shared';

interface NetworkContextType {
  connect: (serverUrl: string, playerName: string) => Promise<void>;
  disconnect: () => void;
  sendInput: (input: PlayerInput) => void;
  selectHero: (heroId: HeroId) => void;
  selectTeam: (team: Team) => void;
  setReady: (ready: boolean) => void;
}

const NetworkContext = createContext<NetworkContextType | null>(null);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const clientRef = useRef<Client | null>(null);
  const roomRef = useRef<Room | null>(null);

  const {
    setConnected,
    setLoading,
    setRoomId,
    setPlayerId,
    setGamePhase,
    setPhaseEndTime,
    setLocalPlayer,
    updatePlayer,
    removePlayer,
    reset,
  } = useGameStore();

  const connect = useCallback(async (serverUrl: string, playerName: string) => {
    setLoading(true);

    try {
      clientRef.current = new Client(serverUrl);

      roomRef.current = await clientRef.current.joinOrCreate('game_room', {
        playerName,
      });

      const room = roomRef.current;
      const sessionId = room.sessionId;

      console.log('Connected to room:', room.id, 'as', sessionId);

      setRoomId(room.id);
      setPlayerId(sessionId);

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
            isSliding: false,
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
          isSliding: false,
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

      // Debug: Log initial state structure
      console.log('Room state available:', !!room.state);
      if (room.state) {
        const playersMap = room.state.players as any;
        console.log('Initial state structure:', {
          phase: room.state.phase,
          hasPlayers: !!room.state.players,
          playersType: typeof room.state.players,
          playersConstructor: room.state.players?.constructor?.name,
          hasOnAdd: typeof playersMap?.onAdd === 'function',
          hasForEach: typeof playersMap?.forEach === 'function',
        });
        
        // Try to get the full state as JSON
        try {
          const stateJson = (room.state as any).toJSON?.() ?? JSON.stringify(room.state);
          console.log('Full room state JSON:', stateJson);
        } catch (e) {
          console.log('Could not serialize state:', e);
        }
      }

      // Helper function to sync a player from schema to store
      const syncPlayerFromSchema = (schemaPlayer: any, id: string) => {
        if (id === sessionId) {
          // Our own player - update local player with server data
          const store = useGameStore.getState();
          if (store.localPlayer) {
            const updated = {
              ...store.localPlayer,
              heroId: schemaPlayer.heroId || store.localPlayer.heroId,
              team: schemaPlayer.team || store.localPlayer.team,
              health: schemaPlayer.health ?? store.localPlayer.health,
              maxHealth: schemaPlayer.maxHealth ?? store.localPlayer.maxHealth,
              state: schemaPlayer.state || store.localPlayer.state,
            };
            setLocalPlayer(updated);
          }
        } else {
          // Other player - add/update in store
          const playerData = createPlayerData(schemaPlayer, id);
          updatePlayer(id, playerData);
        }
      };

      // Debug: Inspect the players MapSchema structure
      const playersMap = room.state.players as any;
      console.log('Players map inspection:', {
        size: playersMap.size,
        '$items': playersMap.$items,
        '$items size': playersMap.$items?.size,
        'keys from $items': playersMap.$items ? Array.from(playersMap.$items.keys()) : 'N/A',
        'toJSON': typeof playersMap.toJSON === 'function' ? playersMap.toJSON() : 'N/A',
        'prototype': Object.getPrototypeOf(playersMap)?.constructor?.name,
      });
      
      // Try to access internal $items Map directly (Colyseus MapSchema v2 internal storage)
      const getPlayersFromMap = (): Map<string, any> => {
        if (playersMap.$items && playersMap.$items instanceof Map) {
          return playersMap.$items;
        }
        // Fallback: try to convert to regular iteration
        const result = new Map<string, any>();
        try {
          if (typeof playersMap.forEach === 'function') {
            playersMap.forEach((v: any, k: string) => result.set(k, v));
          }
        } catch (e) {
          console.error('Failed to iterate playersMap:', e);
        }
        return result;
      };

      // Set up MapSchema callbacks
      if (playersMap && typeof playersMap.onAdd === 'function') {
        console.log('Setting up MapSchema onAdd/onRemove callbacks');
        
        // Process existing players from $items
        console.log('Checking for existing players...');
        const existingPlayers = getPlayersFromMap();
        console.log('Found', existingPlayers.size, 'existing players in $items');
        existingPlayers.forEach((schemaPlayer, id) => {
          console.log('Processing existing player:', id, schemaPlayer?.name);
          syncPlayerFromSchema(schemaPlayer, id);
        });
        
        // Set up callbacks for future additions
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
      } else {
        console.warn('MapSchema callbacks not available');
      }

      // Polling for state sync - this ensures players get synced even if callbacks fail
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
          
          // Try multiple methods to get players
          let serverPlayerCount = 0;
          const serverPlayerIds: string[] = [];
          
          // Method 1: Try $items (internal MapSchema storage)
          if (playersMap.$items instanceof Map) {
            playersMap.$items.forEach((schemaPlayer: any, id: string) => {
              serverPlayerCount++;
              serverPlayerIds.push(id);
              processPlayer(schemaPlayer, id, currentStore);
            });
          }
          // Method 2: Try forEach 
          else if (typeof playersMap.forEach === 'function') {
            try {
              playersMap.forEach((schemaPlayer: any, id: string) => {
                serverPlayerCount++;
                serverPlayerIds.push(id);
                processPlayer(schemaPlayer, id, currentStore);
              });
            } catch (e) {
              // Silent fail, try next method
            }
          }
          // Method 3: Try iterating own properties
          if (serverPlayerCount === 0) {
            for (const key of Object.keys(playersMap)) {
              if (key.startsWith('$') || key.startsWith('_') || typeof playersMap[key] !== 'object') continue;
              const schemaPlayer = playersMap[key];
              if (schemaPlayer && typeof schemaPlayer === 'object' && 'name' in schemaPlayer) {
                serverPlayerCount++;
                serverPlayerIds.push(key);
                processPlayer(schemaPlayer, key, currentStore);
              }
            }
          }
          
          // Log periodically or when count changes
          if (serverPlayerCount !== lastLoggedPlayerCount || pollCount % 100 === 1) {
            console.log(`POLL #${pollCount}: Server=${serverPlayerCount} players [${serverPlayerIds.join(',')}], Store=${currentStore.players.size} players`);
            if (pollCount === 1) {
              console.log('PlayersMap structure:', {
                keys: Object.keys(playersMap),
                hasItems: !!playersMap.$items,
                itemsType: playersMap.$items?.constructor?.name,
                size: playersMap.size,
              });
            }
            lastLoggedPlayerCount = serverPlayerCount;
          }
          
          function processPlayer(schemaPlayer: any, id: string, store: any) {
            if (id === sessionId) {
              if (store.localPlayer) {
                const updated = {
                  ...store.localPlayer,
                  heroId: schemaPlayer.heroId || store.localPlayer.heroId,
                  team: schemaPlayer.team || store.localPlayer.team,
                  health: schemaPlayer.health ?? store.localPlayer.health,
                  maxHealth: schemaPlayer.maxHealth ?? store.localPlayer.maxHealth,
                  state: schemaPlayer.state || store.localPlayer.state,
                };
                setLocalPlayer(updated);
              }
              return;
            }

            const existingPlayer = store.players.get(id);
            if (!existingPlayer) {
              const playerData = createPlayerData(schemaPlayer, id);
              console.log('POLL: Adding new player:', id, playerData.name);
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
      }, 50); // 20 times per second

      // Listen for state changes to catch when players are added
      room.onStateChange.once((state) => {
        console.log('First state change received!');
        const pm = state.players as any;
        console.log('State after first change:', {
          phase: state.phase,
          playersSize: pm?.size,
          '$itemsSize': pm?.$items?.size,
        });
        
        // Try to get players from the state now
        if (pm?.$items instanceof Map && pm.$items.size > 0) {
          console.log('Found players in $items after state change!');
          pm.$items.forEach((player: any, id: string) => {
            console.log('Player from $items:', id, player?.name);
            syncPlayerFromSchema(player, id);
          });
        }
      });
      
      // Handle explicit messages
      room.onMessage('phaseChange', (data: { phase: string; endTime: number }) => {
        console.log('Phase change message:', data.phase);
        setGamePhase(data.phase as any);
        setPhaseEndTime(data.endTime);
      });

      room.onMessage('playerJoined', (data: { playerId: string; playerName: string; team?: string; heroId?: string; position?: { x: number; y: number; z: number } }) => {
        console.log(`Player joined message: ${data.playerName} (${data.playerId})`);
        
        // If this is another player, create them in the store
        if (data.playerId !== sessionId) {
          const currentStore = useGameStore.getState();
          if (!currentStore.players.has(data.playerId)) {
            console.log('Creating player from playerJoined message:', data.playerId, data);
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
                isSliding: false,
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

      // Handle player state updates (positions, etc.) via message
      room.onMessage('playerStates', (data: { players: any[] }) => {
        // Log occasionally to confirm we're receiving updates
        if (Math.random() < 0.02) { // ~2% of messages
          console.log('Received playerStates:', data.players.length, 'players');
        }
        const currentStore = useGameStore.getState();
        
        for (const serverPlayer of data.players) {
          if (serverPlayer.id === sessionId) {
            // Update local player's server-authoritative state (health, etc.)
            if (currentStore.localPlayer) {
              const updated = {
                ...currentStore.localPlayer,
                health: serverPlayer.health ?? currentStore.localPlayer.health,
                maxHealth: serverPlayer.maxHealth ?? currentStore.localPlayer.maxHealth,
                state: serverPlayer.state || currentStore.localPlayer.state,
                heroId: serverPlayer.heroId || currentStore.localPlayer.heroId,
                team: serverPlayer.team || currentStore.localPlayer.team,
                hasFlag: serverPlayer.hasFlag ?? currentStore.localPlayer.hasFlag,
              };
              setLocalPlayer(updated);
            }
          } else {
            // Update other player's full state including position
            const existingPlayer = currentStore.players.get(serverPlayer.id);
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
                hasFlag: serverPlayer.hasFlag ?? existingPlayer.hasFlag,
              };
              updatePlayer(serverPlayer.id, updatedPlayer);
            } else {
              // Player not in store yet - create them
              console.log('Creating player from playerStates:', serverPlayer.id, serverPlayer.name);
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
                ultimateCharge: 0,
                movement: {
                  isGrounded: true,
                  isSliding: false,
                  isWallRunning: false,
                  wallRunSide: null,
                  isGrappling: false,
                  grapplePoint: null,
                  isJetpacking: false,
                  jetpackFuel: 100,
                  isGliding: false,
                },
                abilities: {},
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

      room.onError((code, message) => {
        console.error('Room error:', code, message);
      });

      room.onLeave((code) => {
        console.log('Left room:', code);
        clearInterval(syncInterval);
        setConnected(false);
        reset();
      });

      setConnected(true);
      setLoading(false);

    } catch (error) {
      console.error('Failed to connect:', error);
      setLoading(false);
      throw error;
    }
  }, [setConnected, setLoading, setRoomId, setPlayerId, setGamePhase, setPhaseEndTime, setLocalPlayer, updatePlayer, removePlayer, reset]);

  const disconnect = useCallback(() => {
    if (roomRef.current) {
      roomRef.current.leave();
      roomRef.current = null;
    }
    if (clientRef.current) {
      clientRef.current = null;
    }
    reset();
  }, [reset]);

  const sendInput = useCallback((input: PlayerInput) => {
    if (roomRef.current) {
      roomRef.current.send('input', input);
    }
  }, []);

  const selectHero = useCallback((heroId: HeroId) => {
    console.log('Sending selectHero:', heroId);
    if (roomRef.current) {
      roomRef.current.send('selectHero', { heroId });
    }
  }, []);

  const selectTeam = useCallback((team: Team) => {
    console.log('Sending selectTeam:', team);
    if (roomRef.current) {
      roomRef.current.send('selectTeam', { team });
    }
  }, []);

  const setReady = useCallback((ready: boolean) => {
    console.log('Sending ready:', ready);
    if (roomRef.current) {
      roomRef.current.send('ready', { ready });
    }
  }, []);

  return (
    <NetworkContext.Provider value={{
      connect,
      disconnect,
      sendInput,
      selectHero,
      selectTeam,
      setReady,
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
