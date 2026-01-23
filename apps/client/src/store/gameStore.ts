import { create } from 'zustand';
import type { GameStateSync } from '@voxel-strike/shared';
import { setPlayerVisualPosition, setPlayerVisualRotation } from './visualStore';

// Import types
import type {
  GamePhase,
  Player,
  Vec3,
  PlayerInput,
  LobbyInfo,
  LobbyPlayer,
  UserStats,
  AppPhase,
} from './types';

// Import slices
import {
  createProjectileSlice,
  projectileInitialState,
  type ProjectileSlice,
} from './slices/projectiles';

import {
  createGlacierSlice,
  glacierInitialState,
  type GlacierSlice,
} from './slices/glacier';

// Re-export all types for backwards compatibility
export type {
  LobbyInfo,
  LobbyPlayer,
  UserStats,
  AppPhase,
} from './types';

export type {
  VoidZoneData,
  DireBallData,
  VoidRayData,
  RocketData,
  BombData,
  HookProjectileData,
  DragHookData,
  GrappleTrapData,
  SwingLineData,
  GrappleLineData,
  EarthWallData,
  IceMalletSwingData,
  IceWallSegmentData,
  IceWallRushData,
} from './types';

// ============================================================================
// CORE STATE INTERFACE (non-slice state)
// ============================================================================

interface CoreState {
  // Wallet/Auth state
  walletAddress: string | null;
  userId: string | null;
  userStats: UserStats | null;

  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  roomId: string | null;
  playerId: string | null;
  playerName: string;

  // App phase (different from game phase)
  appPhase: AppPhase;

  // Lobby state
  availableLobbies: LobbyInfo[];
  currentLobbyId: string | null;
  currentLobbyName: string | null;
  lobbyPlayers: Map<string, LobbyPlayer>;
  isLobbyHost: boolean;

  // Game state
  gamePhase: GamePhase;
  tick: number;
  serverTime: number;

  // Teams
  redScore: number;
  blueScore: number;
  redFlag: { position: Vec3; carrierId: string | null; isAtBase: boolean } | null;
  blueFlag: { position: Vec3; carrierId: string | null; isAtBase: boolean } | null;

  // Players
  players: Map<string, Player>;
  localPlayer: Player | null;

  // Timing
  roundTimeRemaining: number;
  phaseEndTime: number | null;

  // Input
  pendingInputs: PlayerInput[];
  lastProcessedTick: number;

  // UI State
  shadowStepTargeting: boolean;
  shadowStepValid: boolean;

  // Ultimate effect state
  ultimateEffectActive: boolean;
  ultimateEffectType: string | null;
  ultimateEffectEndTime: number;

  // Client-side cooldowns
  clientCooldowns: Record<string, number>;
  clientCharges: Record<string, number>;

  // Slide visual effects
  slideIntensity: number;

  // Debug mode (performance monitor)
  debugMode: boolean;
}

interface CoreActions {
  setWalletAddress: (address: string | null) => void;
  setUser: (userId: string | null, name: string, stats: UserStats | null) => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setRoomId: (roomId: string | null) => void;
  setPlayerId: (playerId: string | null) => void;
  setPlayerName: (name: string) => void;
  setAppPhase: (phase: AppPhase) => void;
  setGamePhase: (phase: GamePhase) => void;
  setPhaseEndTime: (time: number | null) => void;
  updateGameState: (state: GameStateSync) => void;
  updateLocalPlayer: (updates: Partial<Player>) => void;
  setLocalPlayer: (player: Player) => void;
  setPlayers: (players: Map<string, Player>) => void;
  updatePlayer: (playerId: string, player: Player) => void;
  removePlayer: (playerId: string) => void;
  addPendingInput: (input: PlayerInput) => void;
  clearProcessedInputs: (tick: number) => void;

  // Lobby actions
  setAvailableLobbies: (lobbies: LobbyInfo[]) => void;
  setCurrentLobby: (lobbyId: string | null, lobbyName: string | null) => void;
  setLobbyPlayers: (players: Map<string, LobbyPlayer>) => void;
  updateLobbyPlayer: (playerId: string, player: LobbyPlayer) => void;
  removeLobbyPlayer: (playerId: string) => void;
  setIsLobbyHost: (isHost: boolean) => void;

  // UI Actions
  setShadowStepTargeting: (targeting: boolean, valid?: boolean) => void;
  setUltimateEffect: (active: boolean, type?: string | null, endTime?: number) => void;
  setClientCooldown: (abilityId: string, endTime: number) => void;
  setClientCharges: (abilityId: string, charges: number) => void;
  clearClientCooldowns: () => void;
  setSlideIntensity: (intensity: number) => void;
  setDebugMode: (enabled: boolean) => void;
  toggleDebugMode: () => void;

  // Ghost cleanup
  cleanupGhostPlayers: () => void;

  reset: () => void;
  resetLobby: () => void;
}

// ============================================================================
// COMBINED STORE TYPE
// ============================================================================

type GameStore = CoreState & CoreActions & ProjectileSlice & GlacierSlice;

// ============================================================================
// INITIAL STATE
// ============================================================================

const coreInitialState: CoreState = {
  walletAddress: null,
  userId: null,
  userStats: null,
  isConnected: false,
  isLoading: false,
  roomId: null,
  playerId: null,
  playerName: '',
  appPhase: 'menu',
  availableLobbies: [],
  currentLobbyId: null,
  currentLobbyName: null,
  lobbyPlayers: new Map(),
  isLobbyHost: false,
  gamePhase: 'waiting',
  tick: 0,
  serverTime: 0,
  redScore: 0,
  blueScore: 0,
  redFlag: null,
  blueFlag: null,
  players: new Map(),
  localPlayer: null,
  roundTimeRemaining: 0,
  phaseEndTime: null,
  pendingInputs: [],
  lastProcessedTick: 0,
  shadowStepTargeting: false,
  shadowStepValid: false,
  ultimateEffectActive: false,
  ultimateEffectType: null,
  ultimateEffectEndTime: 0,
  clientCooldowns: {},
  clientCharges: {},
  slideIntensity: 0,
  debugMode: false,
};

const initialState = {
  ...coreInitialState,
  ...projectileInitialState,
  ...glacierInitialState,
};

// ============================================================================
// STORE CREATION
// ============================================================================

export const useGameStore = create<GameStore>((set, get, store) => ({
  // Spread initial state
  ...initialState,

  // Include slice actions
  ...createProjectileSlice(set, get, store),
  ...createGlacierSlice(set, get, store),

  // ==================== CORE ACTIONS ====================

  setWalletAddress: (address) => set({ walletAddress: address }),
  setUser: (userId, name, stats) => set({ userId, playerName: name, userStats: stats }),
  setConnected: (connected) => set({ isConnected: connected }),
  setLoading: (loading) => set({ isLoading: loading }),
  setRoomId: (roomId) => set({ roomId }),
  setPlayerId: (playerId) => set({ playerId }),
  setPlayerName: (name) => set({ playerName: name }),
  setAppPhase: (phase) => set({ appPhase: phase }),
  setGamePhase: (phase) => set({ gamePhase: phase }),
  setPhaseEndTime: (time) => set({ phaseEndTime: time }),

  updateGameState: (state) => {
    // NOTE: We update players Map entries in-place for position/rotation data to avoid
    // triggering React re-renders on every server tick. The Map reference only changes
    // when players are added/removed. Position data flows to visualStore (non-reactive)
    // for 60fps interpolation, while gameStore tracks authoritative game state.
    const { playerId, players: existingPlayers } = get();

    // Build set of snapshot IDs for removal detection
    const snapshotIds = new Set(state.players.map(p => p.id));

    // Check if any players need to be removed (not in snapshot)
    let needsRemoval = false;
    for (const [id] of existingPlayers) {
      if (!snapshotIds.has(id)) {
        needsRemoval = true;
        break;
      }
    }

    // If no removals needed, update in-place without changing Map reference
    if (!needsRemoval) {
      // Update existing players in-place for position/rotation data
      for (const snapshot of state.players) {
        const existingPlayer = existingPlayers.get(snapshot.id);
        if (existingPlayer) {
          // Update in-place for position/rotation (high-frequency, visual-only)
          existingPlayer.position = snapshot.position;
          existingPlayer.velocity = snapshot.velocity;
          existingPlayer.lookYaw = snapshot.lookYaw;
          existingPlayer.lookPitch = snapshot.lookPitch;

          // Update other fields (these are game events that MAY warrant re-renders)
          existingPlayer.health = snapshot.health;
          existingPlayer.state = snapshot.state;
          existingPlayer.movement = snapshot.movement;
          existingPlayer.abilities = snapshot.abilities;
          existingPlayer.hasFlag = snapshot.hasFlag;
        }
      }

      const localPlayer = playerId ? existingPlayers.get(playerId) ?? null : null;

      // Same Map reference - no re-renders for position updates
      set({
        tick: state.tick,
        serverTime: state.serverTime,
        gamePhase: state.phase,
        redScore: state.redScore,
        blueScore: state.blueScore,
        redFlag: state.redFlag,
        blueFlag: state.blueFlag,
        roundTimeRemaining: state.roundTimeRemaining,
        players: existingPlayers,
        localPlayer,
      });

      // Update visual store with authoritative server positions for interpolation
      state.players.forEach((snapshot) => {
        setPlayerVisualPosition(snapshot.id, snapshot.position);
        setPlayerVisualRotation(snapshot.id, snapshot.lookYaw);
      });
      return;
    }

    // If removals needed, create new Map (changes reference, triggers re-render)
    const players = new Map<string, Player>();
    for (const snapshot of state.players) {
      const existingPlayer = existingPlayers.get(snapshot.id);
      if (existingPlayer) {
        players.set(snapshot.id, {
          ...existingPlayer,
          position: snapshot.position,
          velocity: snapshot.velocity,
          lookYaw: snapshot.lookYaw,
          lookPitch: snapshot.lookPitch,
          health: snapshot.health,
          state: snapshot.state,
          movement: snapshot.movement,
          abilities: snapshot.abilities,
          hasFlag: snapshot.hasFlag,
        });
      }
    }

    const localPlayer = playerId ? players.get(playerId) ?? null : null;

    set({
      tick: state.tick,
      serverTime: state.serverTime,
      gamePhase: state.phase,
      redScore: state.redScore,
      blueScore: state.blueScore,
      redFlag: state.redFlag,
      blueFlag: state.blueFlag,
      roundTimeRemaining: state.roundTimeRemaining,
      players,
      localPlayer,
    });

    // Update visual store with authoritative server positions for interpolation
    players.forEach((player, id) => {
      setPlayerVisualPosition(id, player.position);
      setPlayerVisualRotation(id, player.lookYaw);
    });
  },

  updateLocalPlayer: (updates) => {
    const { localPlayer, players } = get();
    if (!localPlayer) return;

    const updatedPlayer = { ...localPlayer, ...updates };
    const updatedPlayers = new Map(players);
    updatedPlayers.set(localPlayer.id, updatedPlayer);

    set({
      localPlayer: updatedPlayer,
      players: updatedPlayers,
    });
  },

  setLocalPlayer: (player) => {
    const { players } = get();
    const updatedPlayers = new Map(players);
    updatedPlayers.set(player.id, player);

    set({
      localPlayer: player,
      players: updatedPlayers,
      playerId: player.id,
    });
  },

  setPlayers: (players) => {
    const { playerId } = get();
    const localPlayer = playerId ? players.get(playerId) ?? null : null;
    set({ players, localPlayer });

    // Update visual store for bulk player updates (initial sync)
    players.forEach((player, id) => {
      setPlayerVisualPosition(id, player.position);
      setPlayerVisualRotation(id, player.lookYaw);
    });
  },

  updatePlayer: (playerId, player) => {
    const { players, localPlayer } = get();
    const updatedPlayers = new Map(players);
    updatedPlayers.set(playerId, player);

    set({
      players: updatedPlayers,
      localPlayer: playerId === localPlayer?.id ? player : localPlayer,
    });

    // Update visual store for individual player updates
    setPlayerVisualPosition(playerId, player.position);
    setPlayerVisualRotation(playerId, player.lookYaw);
  },

  removePlayer: (playerId) => {
    const { players } = get();
    const updatedPlayers = new Map(players);
    updatedPlayers.delete(playerId);
    set({ players: updatedPlayers });
  },

  cleanupGhostPlayers: () => {
    const { players, localPlayer } = get();
    if (!localPlayer) return;

    const localName = localPlayer.name;
    const localId = localPlayer.id;

    let hasGhosts = false;
    const cleanedPlayers = new Map<string, Player>();

    players.forEach((player, id) => {
      if (id === localId || player.name !== localName) {
        cleanedPlayers.set(id, player);
      } else {
        hasGhosts = true;
      }
    });

    if (hasGhosts) {
      set({ players: cleanedPlayers });
    }
  },

  addPendingInput: (input) => {
    set((state) => ({
      pendingInputs: [...state.pendingInputs, input],
    }));
  },

  clearProcessedInputs: (tick) => {
    set((state) => ({
      pendingInputs: state.pendingInputs.filter((i) => i.tick > tick),
      lastProcessedTick: tick,
    }));
  },

  // ==================== LOBBY ACTIONS ====================

  setAvailableLobbies: (lobbies) => set({ availableLobbies: lobbies }),

  setCurrentLobby: (lobbyId, lobbyName) => set({
    currentLobbyId: lobbyId,
    currentLobbyName: lobbyName,
  }),

  setLobbyPlayers: (players) => set({ lobbyPlayers: players }),

  updateLobbyPlayer: (playerId, player) => {
    const { lobbyPlayers } = get();
    const updated = new Map(lobbyPlayers);
    updated.set(playerId, player);
    set({ lobbyPlayers: updated });
  },

  removeLobbyPlayer: (playerId) => {
    const { lobbyPlayers } = get();
    const updated = new Map(lobbyPlayers);
    updated.delete(playerId);
    set({ lobbyPlayers: updated });
  },

  setIsLobbyHost: (isHost) => set({ isLobbyHost: isHost }),

  // ==================== UI ACTIONS ====================

  setShadowStepTargeting: (targeting, valid = false) => set({
    shadowStepTargeting: targeting,
    shadowStepValid: valid
  }),

  setUltimateEffect: (active, type = null, endTime = 0) => set({
    ultimateEffectActive: active,
    ultimateEffectType: type,
    ultimateEffectEndTime: endTime,
  }),

  setClientCooldown: (abilityId, endTime) => set((state) => ({
    clientCooldowns: { ...state.clientCooldowns, [abilityId]: endTime }
  })),

  setClientCharges: (abilityId, charges) => set((state) => ({
    clientCharges: { ...state.clientCharges, [abilityId]: charges }
  })),

  clearClientCooldowns: () => set({ clientCooldowns: {}, clientCharges: {} }),

  setSlideIntensity: (intensity) => set({ slideIntensity: intensity }),

  setDebugMode: (enabled) => set({ debugMode: enabled }),
  toggleDebugMode: () => set((state) => ({ debugMode: !state.debugMode })),

  // ==================== RESET ACTIONS ====================

  reset: () => set(initialState),

  resetLobby: () => set({
    currentLobbyId: null,
    currentLobbyName: null,
    lobbyPlayers: new Map(),
    isLobbyHost: false,
  }),
}));
