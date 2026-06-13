import { create } from 'zustand';
import { UNSTUCK_COOLDOWN_MS, createRandomSeed, type GameEndEvent, type PlayerPingsMessage, type VoxelMapTheme } from '@voxel-strike/shared';
import {
  clearAllDeathVisuals,
  clearVisualState,
  removePlayerLiveVisualState,
  removePlayerVisualState,
  setPlayerVisualTransform,
} from './visualStore';
import { resetGameTiming } from './gameTimingStore';

// Import types
import type {
  GamePhase,
  Player,
  Vec3,
  PlayerInput,
  LobbyPlayer,
  LobbyWagerState,
  MapVoteOption,
  MapVoteRecord,
  WagerPaymentIntent,
  WagerPaymentTransaction,
  RankedEntryQuote,
  UserStats,
  MatchmakingStatus,
  AppPhase,
} from './types';

// Import slices
import {
  createProjectileSlice,
  projectileInitialState,
  type ProjectileSlice,
} from './slices/projectiles';

// Re-export all types for backwards compatibility
export type {
  LobbyPlayer,
  LobbyWagerState,
  MapVoteOption,
  MapVoteRecord,
  WagerPaymentIntent,
  WagerPaymentTransaction,
  RankedEntryQuote,
  UserStats,
  MatchmakingStatus,
  AppPhase,
} from './types';

export type {
  VoidZoneData,
  DireBallData,
  VoidRayData,
  RocketData,
  BombData,
  ChronosPulseData,
  ChronosTimebreakData,
  HookProjectileData,
  DragHookData,
  GrappleTrapData,
  GrappleLineData,
  EarthWallData,
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
  isPracticeMode: boolean;
  isPracticePreparing: boolean;

  // App phase (different from game phase)
  appPhase: AppPhase;

  // Lobby state
  currentLobbyId: string | null;
  currentLobbyName: string | null;
  currentLobbyWager: LobbyWagerState;
  lobbyPlayers: Map<string, LobbyPlayer>;
  isLobbyHost: boolean;
  mapVoteOptions: MapVoteOption[];
  mapVotes: Map<string, string>;
  mapVotePhaseEndTime: number | null;
  selectedMapOptionId: string | null;
  matchmakingStatus: MatchmakingStatus;

  // Game state
  gamePhase: GamePhase;
  matchSummary: GameEndEvent | null;
  appliedExperienceMatchId: string | null;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'] | null;

  // Teams
  redScore: number;
  blueScore: number;
  redFlag: { position: Vec3; carrierId: string | null; isAtBase: boolean } | null;
  blueFlag: { position: Vec3; carrierId: string | null; isAtBase: boolean } | null;

  // Players
  players: Map<string, Player>;
  localPlayer: Player | null;
  playerPings: Map<string, number | null>;

  // Timing
  roundTimeRemaining: number;
  phaseEndTime: number | null;

  // Input
  pendingInputs: PlayerInput[];
  lastProcessedTick: number;

  // Ultimate effect state
  ultimateEffectActive: boolean;
  ultimateEffectType: string | null;
  ultimateEffectEndTime: number;

  // Client-side cooldowns
  clientCooldowns: Record<string, number>;
  clientCharges: Record<string, number>;
  unstuckCooldownUntil: number;
  unstuckRequestId: number;

  // Slide visual effects
  slideIntensity: number;

}

interface CoreActions {
  setWalletAddress: (address: string | null) => void;
  setUser: (userId: string | null, name: string, stats: UserStats | null) => void;
  setConnected: (connected: boolean) => void;
  setLoading: (loading: boolean) => void;
  setRoomId: (roomId: string | null) => void;
  setPlayerId: (playerId: string | null) => void;
  setPlayerName: (name: string) => void;
  setPracticeMode: (enabled: boolean) => void;
  setPracticePreparing: (preparing: boolean) => void;
  setAppPhase: (phase: AppPhase) => void;
  setMatchmakingStatus: (status: MatchmakingStatus) => void;
  setGamePhase: (phase: GamePhase) => void;
  setMatchSummary: (summary: GameEndEvent | null) => void;
  clearMatchSummary: () => void;
  setPhaseEndTime: (time: number | null) => void;
  setMapSeed: (seed: number) => void;
  setMapThemeId: (themeId: VoxelMapTheme['id'] | null) => void;
  updateLocalPlayer: (updates: Partial<Player>) => void;
  setLocalPlayer: (player: Player) => void;
  setPlayers: (players: Map<string, Player>) => void;
  updatePlayer: (playerId: string, player: Player) => void;
  removePlayer: (playerId: string) => void;
  setPlayerPings: (message: PlayerPingsMessage) => void;
  addPendingInput: (input: PlayerInput) => void;
  clearProcessedInputs: (tick: number) => void;

  // Lobby actions
  setCurrentLobby: (lobbyId: string | null, lobbyName: string | null) => void;
  setCurrentLobbyWager: (wager: LobbyWagerState) => void;
  setLobbyPlayers: (players: Map<string, LobbyPlayer>) => void;
  updateLobbyPlayer: (playerId: string, player: LobbyPlayer) => void;
  removeLobbyPlayer: (playerId: string) => void;
  setIsLobbyHost: (isHost: boolean) => void;
  setMapVoteState: (options: MapVoteOption[], votes: MapVoteRecord[], phaseEndTime: number | null, selectedOptionId?: string | null) => void;
  setMapVotes: (votes: MapVoteRecord[], selectedOptionId?: string | null) => void;
  clearMapVote: () => void;

  // UI Actions
  setUltimateEffect: (active: boolean, type?: string | null, endTime?: number) => void;
  setClientCooldown: (abilityId: string, endTime: number) => void;
  setClientCharges: (abilityId: string, charges: number) => void;
  clearClientCooldowns: () => void;
  requestUnstuck: () => boolean;
  setSlideIntensity: (intensity: number) => void;

  // Ghost cleanup
  cleanupGhostPlayers: () => void;

  reset: () => void;
  resetLobby: () => void;
}

// ============================================================================
// COMBINED STORE TYPE
// ============================================================================

type GameStore = CoreState & CoreActions & ProjectileSlice;

const MAX_PENDING_INPUTS = 128;
const HIDDEN_VISIBILITY_STATES = new Set(['hidden', 'last_known', 'audible']);

function shouldKeepPlayerLiveVisual(player: Player): boolean {
  return !HIDDEN_VISIBILITY_STATES.has(player.visibility ?? 'visible');
}

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
  isPracticeMode: false,
  isPracticePreparing: false,
  appPhase: 'menu',
  currentLobbyId: null,
  currentLobbyName: null,
  currentLobbyWager: { enabled: false },
  lobbyPlayers: new Map(),
  isLobbyHost: false,
  mapVoteOptions: [],
  mapVotes: new Map(),
  mapVotePhaseEndTime: null,
  selectedMapOptionId: null,
  matchmakingStatus: {
    matchMode: null,
    rankBandId: null,
    rankBandLabel: null,
    averageCompetitiveRating: null,
    averageVisibleRank: null,
    rankSearchDistance: null,
    queuedHumanCount: null,
    provisionalHumanCount: null,
    requiredPlayers: null,
    rankedCoverChargeLamports: null,
    rankedEntryQuoteId: null,
  },
  gamePhase: 'waiting',
  matchSummary: null,
  appliedExperienceMatchId: null,
  mapSeed: createRandomSeed(),
  mapThemeId: null,
  redScore: 0,
  blueScore: 0,
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
};

const initialState = {
  ...coreInitialState,
  ...projectileInitialState,
};

// ============================================================================
// STORE CREATION
// ============================================================================

export const useGameStore = create<GameStore>((set, get, store) => ({
  // Spread initial state
  ...initialState,

  // Include slice actions
  ...createProjectileSlice(set, get, store),

  // ==================== CORE ACTIONS ====================

  setWalletAddress: (address) => set((state) => state.walletAddress === address ? state : { walletAddress: address }),
  setUser: (userId, name, stats) => set((state) => (
    state.userId === userId && state.playerName === name && state.userStats === stats
      ? state
      : { userId, playerName: name, userStats: stats }
  )),
  setConnected: (connected) => set((state) => state.isConnected === connected ? state : { isConnected: connected }),
  setLoading: (loading) => set((state) => state.isLoading === loading ? state : { isLoading: loading }),
  setRoomId: (roomId) => set((state) => state.roomId === roomId ? state : { roomId }),
  setPlayerId: (playerId) => set((state) => state.playerId === playerId ? state : { playerId }),
  setPlayerName: (name) => set((state) => state.playerName === name ? state : { playerName: name }),
  setPracticeMode: (enabled) => set((state) => {
    if (enabled) {
      return state.isPracticeMode ? state : { isPracticeMode: true };
    }

    return state.isPracticeMode || state.isPracticePreparing
      ? { isPracticeMode: false, isPracticePreparing: false }
      : state;
  }),
  setPracticePreparing: (preparing) => set((state) => (
    state.isPracticePreparing === preparing ? state : { isPracticePreparing: preparing }
  )),
  setAppPhase: (phase) => set((state) => state.appPhase === phase ? state : { appPhase: phase }),
  setMatchmakingStatus: (status) => set({ matchmakingStatus: status }),
  setGamePhase: (phase) => {
    if (phase !== 'playing' && phase !== 'countdown') {
      clearAllDeathVisuals();
    }
    set((state) => state.gamePhase === phase ? state : { gamePhase: phase });
  },
  setMatchSummary: (summary) => set((state) => {
    if (!summary) {
      return state.matchSummary === null ? state : { matchSummary: null };
    }

    const summaryKey = summary.matchId ?? `${summary.endedAt}`;
    const localSummary = state.playerId
      ? summary.players.find((player) => player.playerId === state.playerId)
      : null;
    const shouldApplyStats = Boolean(
      localSummary
      && state.userStats
      && state.appliedExperienceMatchId !== summaryKey
    );

    if (!shouldApplyStats || !localSummary || !state.userStats) {
      return {
        matchSummary: summary,
        gamePhase: 'game_end',
      };
    }

    const ratingDelta = summary.matchMode === 'ranked' && typeof localSummary.ratingDelta === 'number'
      ? localSummary.ratingDelta
      : null;
    const competitiveRating = ratingDelta === null
      ? state.userStats.competitiveRating
      : Math.max(0, state.userStats.competitiveRating + ratingDelta);

    return {
      matchSummary: summary,
      appliedExperienceMatchId: summaryKey,
      gamePhase: 'game_end',
      userStats: {
        ...state.userStats,
        totalGames: state.userStats.totalGames + 1,
        totalWins: state.userStats.totalWins + (localSummary.outcome === 'win' ? 1 : 0),
        totalLosses: state.userStats.totalLosses + (localSummary.outcome === 'loss' ? 1 : 0),
        totalDraws: state.userStats.totalDraws + (localSummary.outcome === 'draw' ? 1 : 0),
        totalKills: state.userStats.totalKills + localSummary.stats.kills,
        totalDeaths: state.userStats.totalDeaths + localSummary.stats.deaths,
        totalAssists: state.userStats.totalAssists + localSummary.stats.assists,
        totalCaptures: state.userStats.totalCaptures + localSummary.stats.flagCaptures,
        totalFlagReturns: state.userStats.totalFlagReturns + localSummary.stats.flagReturns,
        totalScore: state.userStats.totalScore + localSummary.score,
        totalExperience: state.userStats.totalExperience + localSummary.experienceGained,
        competitiveRating,
        rankedGames: ratingDelta === null ? state.userStats.rankedGames : state.userStats.rankedGames + 1,
        rankedWins: state.userStats.rankedWins + (ratingDelta !== null && localSummary.outcome === 'win' ? 1 : 0),
        rankedLosses: state.userStats.rankedLosses + (ratingDelta !== null && localSummary.outcome === 'loss' ? 1 : 0),
        rankedDraws: state.userStats.rankedDraws + (ratingDelta !== null && localSummary.outcome === 'draw' ? 1 : 0),
        rankedPlacementsRemaining: ratingDelta === null
          ? state.userStats.rankedPlacementsRemaining
          : Math.max(0, state.userStats.rankedPlacementsRemaining - 1),
        rankedPeakRating: Math.max(state.userStats.rankedPeakRating, competitiveRating),
        rankedLastMatchAt: ratingDelta === null ? state.userStats.rankedLastMatchAt : new Date(summary.endedAt).toISOString(),
      },
    };
  }),
  clearMatchSummary: () => set((state) => state.matchSummary === null ? state : { matchSummary: null }),
  setPhaseEndTime: (time) => set((state) => state.phaseEndTime === time ? state : { phaseEndTime: time }),
  setMapSeed: (seed) => set((state) => {
    const mapSeed = seed >>> 0;
    return state.mapSeed === mapSeed ? state : { mapSeed };
  }),
  setMapThemeId: (themeId) => set((state) => (
    state.mapThemeId === themeId ? state : { mapThemeId: themeId }
  )),

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
    const { playerId, playerPings } = get();
    const localPlayer = playerId ? players.get(playerId) ?? null : null;
    const nextPlayerPings = new Map<string, number | null>();

    playerPings.forEach((pingMs, id) => {
      if (players.has(id)) {
        nextPlayerPings.set(id, pingMs);
      }
    });

    set({ players, localPlayer, playerPings: nextPlayerPings });

    // Update visual store for bulk player updates (initial sync)
    players.forEach((player, id) => {
      if (shouldKeepPlayerLiveVisual(player)) {
        setPlayerVisualTransform(id, player.position, player.lookYaw);
      } else {
        removePlayerLiveVisualState(id);
      }
    });
  },

  updatePlayer: (playerId, player) => {
    const { players, localPlayer } = get();
    if (players.get(playerId) === player) return;

    const updatedPlayers = new Map(players);
    updatedPlayers.set(playerId, player);

    set({
      players: updatedPlayers,
      localPlayer: playerId === localPlayer?.id ? player : localPlayer,
    });

    // Update visual store for individual player updates
    if (shouldKeepPlayerLiveVisual(player)) {
      setPlayerVisualTransform(playerId, player.position, player.lookYaw);
    } else {
      removePlayerLiveVisualState(playerId);
    }
  },

  removePlayer: (playerId) => {
    const { players, playerPings } = get();
    if (!players.has(playerId)) return;

    const updatedPlayers = new Map(players);
    updatedPlayers.delete(playerId);
    removePlayerVisualState(playerId);
    const updatedPings = new Map(playerPings);
    updatedPings.delete(playerId);
    set({ players: updatedPlayers, playerPings: updatedPings });
  },

  setPlayerPings: (message) => {
    set((state) => {
      const nextPings = new Map(state.playerPings);
      const currentIds = new Set<string>();
      let changed = false;

      for (const ping of message.players) {
        currentIds.add(ping.playerId);
        if (nextPings.get(ping.playerId) !== ping.pingMs) {
          nextPings.set(ping.playerId, ping.pingMs);
          changed = true;
        }
      }

      for (const playerId of Array.from(nextPings.keys())) {
        if (!currentIds.has(playerId)) {
          nextPings.delete(playerId);
          changed = true;
        }
      }

      return changed ? { playerPings: nextPings } : state;
    });
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
      players.forEach((player, id) => {
        if (id !== localId && player.name === localName) {
          removePlayerVisualState(id);
        }
      });
      set({ players: cleanedPlayers });
    }
  },

  addPendingInput: (input) => {
    set((state) => ({
      pendingInputs: state.pendingInputs.length >= MAX_PENDING_INPUTS
        ? [...state.pendingInputs.slice(state.pendingInputs.length - MAX_PENDING_INPUTS + 1), input]
        : [...state.pendingInputs, input],
    }));
  },

  clearProcessedInputs: (tick) => {
    set((state) => {
      let firstUnprocessed = 0;
      while (firstUnprocessed < state.pendingInputs.length && state.pendingInputs[firstUnprocessed].tick <= tick) {
        firstUnprocessed++;
      }

      if (firstUnprocessed === 0 && state.lastProcessedTick === tick) {
        return state;
      }

      return {
        pendingInputs: firstUnprocessed === 0
          ? state.pendingInputs
          : state.pendingInputs.slice(firstUnprocessed),
        lastProcessedTick: tick,
      };
    });
  },

  // ==================== LOBBY ACTIONS ====================

  setCurrentLobby: (lobbyId, lobbyName) => set({
    currentLobbyId: lobbyId,
    currentLobbyName: lobbyName,
  }),

  setCurrentLobbyWager: (wager) => set({ currentLobbyWager: wager }),

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

  setIsLobbyHost: (isHost) => set((state) => state.isLobbyHost === isHost ? state : { isLobbyHost: isHost }),

  setMapVoteState: (options, votes, phaseEndTime, selectedOptionId = null) => set({
    mapVoteOptions: options,
    mapVotes: new Map(votes.map((vote) => [vote.playerId, vote.optionId])),
    mapVotePhaseEndTime: phaseEndTime,
    selectedMapOptionId: selectedOptionId,
  }),

  setMapVotes: (votes, selectedOptionId = null) => set({
    mapVotes: new Map(votes.map((vote) => [vote.playerId, vote.optionId])),
    selectedMapOptionId: selectedOptionId,
  }),

  clearMapVote: () => set({
    mapVoteOptions: [],
    mapVotes: new Map(),
    mapVotePhaseEndTime: null,
    selectedMapOptionId: null,
  }),

  // ==================== UI ACTIONS ====================

  setUltimateEffect: (active, type = null, endTime = 0) => set((state) => (
    state.ultimateEffectActive === active &&
    state.ultimateEffectType === type &&
    state.ultimateEffectEndTime === endTime
      ? state
      : {
        ultimateEffectActive: active,
        ultimateEffectType: type,
        ultimateEffectEndTime: endTime,
      }
  )),

  setClientCooldown: (abilityId, endTime) => set((state) => (
    state.clientCooldowns[abilityId] === endTime
      ? state
      : { clientCooldowns: { ...state.clientCooldowns, [abilityId]: endTime } }
  )),

  setClientCharges: (abilityId, charges) => set((state) => (
    state.clientCharges[abilityId] === charges
      ? state
      : { clientCharges: { ...state.clientCharges, [abilityId]: charges } }
  )),

  clearClientCooldowns: () => set({ clientCooldowns: {}, clientCharges: {} }),

  requestUnstuck: () => {
    const now = Date.now();
    const { gamePhase, localPlayer, unstuckCooldownUntil } = get();
    const isActiveGame = gamePhase === 'playing' || gamePhase === 'countdown';

    if (!isActiveGame || localPlayer?.state !== 'alive' || now < unstuckCooldownUntil) {
      return false;
    }

    set((state) => ({
      unstuckCooldownUntil: now + UNSTUCK_COOLDOWN_MS,
      unstuckRequestId: state.unstuckRequestId + 1,
    }));
    return true;
  },

  setSlideIntensity: (intensity) => set((state) => state.slideIntensity === intensity ? state : { slideIntensity: intensity }),

  // ==================== RESET ACTIONS ====================

  reset: () => {
    clearVisualState();
    resetGameTiming();
    set(initialState);
  },

  resetLobby: () => set({
    currentLobbyId: null,
    currentLobbyName: null,
    currentLobbyWager: { enabled: false },
    lobbyPlayers: new Map(),
    isLobbyHost: false,
    mapVoteOptions: [],
    mapVotes: new Map(),
    mapVotePhaseEndTime: null,
    selectedMapOptionId: null,
    matchmakingStatus: {
      matchMode: null,
      rankBandId: null,
      rankBandLabel: null,
      averageCompetitiveRating: null,
      averageVisibleRank: null,
      rankSearchDistance: null,
      queuedHumanCount: null,
      provisionalHumanCount: null,
      requiredPlayers: null,
      rankedCoverChargeLamports: null,
      rankedEntryQuoteId: null,
    },
  }),
}));
