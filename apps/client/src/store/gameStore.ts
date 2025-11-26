import { create } from 'zustand';
import type { 
  GamePhase, 
  Player, 
  Team,
  HeroId,
  Vec3,
  PlayerInput,
  GameStateSync,
} from '@voxel-strike/shared';

interface GameStore {
  // Connection state
  isConnected: boolean;
  isLoading: boolean;
  roomId: string | null;
  playerId: string | null;
  
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
  
  // Actions
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setRoomId: (roomId: string | null) => void;
  setPlayerId: (playerId: string | null) => void;
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
  reset: () => void;
}

const initialState = {
  isConnected: false,
  isLoading: false,
  roomId: null,
  playerId: null,
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
};

export const useGameStore = create<GameStore>((set, get) => ({
  ...initialState,

  setConnected: (connected) => set({ isConnected: connected }),
  setLoading: (loading) => set({ isLoading: loading }),
  setRoomId: (roomId) => set({ roomId }),
  setPlayerId: (playerId) => set({ playerId }),
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

  reset: () => set(initialState),
}));

