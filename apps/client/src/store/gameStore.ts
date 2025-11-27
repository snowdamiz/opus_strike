import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  GamePhase, 
  Player, 
  Team,
  HeroId,
  Vec3,
  PlayerInput,
  GameStateSync,
} from '@voxel-strike/shared';

export interface LobbyInfo {
  roomId: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  status: string;
}

export interface LobbyPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  team: string;
}

export interface UserStats {
  totalGames: number;
  totalWins: number;
  totalKills: number;
  totalDeaths: number;
  totalCaptures: number;
}

export type AppPhase = 'menu' | 'browsing_lobbies' | 'in_lobby' | 'in_game';

interface GameStore {
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
  ultimateEffectType: string | null; // e.g., 'phantom_veil', 'pulse_haste'
  ultimateEffectEndTime: number;
  
  // Client-side cooldowns (for instant UI feedback)
  clientCooldowns: Record<string, number>; // abilityId -> cooldown end timestamp
  clientCharges: Record<string, number>; // abilityId -> current charges
  
  // Slide visual effects
  slideIntensity: number; // 0-1 intensity for slide visual effects
  
  // Actions
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
  
  reset: () => void;
  resetLobby: () => void;
}

const initialState = {
  walletAddress: null as string | null,
  userId: null as string | null,
  userStats: null as UserStats | null,
  isConnected: false,
  isLoading: false,
  roomId: null,
  playerId: null,
  playerName: '',
  appPhase: 'menu' as AppPhase,
  availableLobbies: [] as LobbyInfo[],
  currentLobbyId: null as string | null,
  currentLobbyName: null as string | null,
  lobbyPlayers: new Map<string, LobbyPlayer>(),
  isLobbyHost: false,
  gamePhase: 'waiting' as GamePhase,
  tick: 0,
  serverTime: 0,
  redScore: 0,
  blueScore: 0,
  redFlag: null,
  blueFlag: null,
  players: new Map<string, Player>(),
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
  clientCooldowns: {} as Record<string, number>,
  clientCharges: {} as Record<string, number>,
  slideIntensity: 0,
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

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
    const { playerId } = get();
    const players = new Map<string, Player>();
    
    for (const snapshot of state.players) {
      const existingPlayer = get().players.get(snapshot.id);
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
  },

  updateLocalPlayer: (updates) => {
    const { localPlayer, players } = get();
    if (!localPlayer) {
      console.log('updateLocalPlayer called but no localPlayer yet');
      return;
    }

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
  },

  updatePlayer: (playerId, player) => {
    const { players, localPlayer } = get();
    const updatedPlayers = new Map(players);
    updatedPlayers.set(playerId, player);

    set({
      players: updatedPlayers,
      localPlayer: playerId === localPlayer?.id ? player : localPlayer,
    });
  },

  removePlayer: (playerId) => {
    const { players } = get();
    const updatedPlayers = new Map(players);
    updatedPlayers.delete(playerId);
    set({ players: updatedPlayers });
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

  // Lobby actions
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

  reset: () => set(initialState),
  
  resetLobby: () => set({
    currentLobbyId: null,
    currentLobbyName: null,
    lobbyPlayers: new Map(),
    isLobbyHost: false,
  }),
}));

