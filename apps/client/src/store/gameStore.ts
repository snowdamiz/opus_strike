import { create } from 'zustand';
import {
  DEFAULT_GAMEPLAY_MODE,
  DEFAULT_VOXEL_MAP_SIZE_ID,
  createRandomSeed,
  normalizeVoxelMapSizeId,
  type GameplayMode,
  type GameEndEvent,
  type PlayerPingsMessage,
  type PowerupPickupRuntimeState,
  type VoxelMapSizeId,
  type VoxelMapTheme,
} from '@voxel-strike/shared';
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

export type ObserverFlySpeedPreset = 'low' | 'med' | 'high';

export interface ObserverFlySpeed {
  base: number;
  sprint: number;
}

export interface PowerupPickupCollectionState {
  pickupId: string;
  collectedAt: number;
}

export const OBSERVER_FLY_SPEED_PRESETS = {
  low: { base: 6, sprint: 12 },
  med: { base: 12, sprint: 23 },
  high: { base: 18, sprint: 34 },
} as const satisfies Record<ObserverFlySpeedPreset, ObserverFlySpeed>;

const DEFAULT_OBSERVER_FLY_SPEED_PRESET: ObserverFlySpeedPreset = 'high';

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
  isTutorialMode: boolean;
  tutorialCompletionOverlayOpen: boolean;
  isPracticePreparing: boolean;

  // App phase (different from game phase)
  appPhase: AppPhase;

  // Lobby state
  currentLobbyId: string | null;
  currentLobbyName: string | null;
  currentLobbyWager: LobbyWagerState;
  lobbyPlayers: Map<string, LobbyPlayer>;
  isLobbyHost: boolean;
  lobbyObserversEnabled: boolean;
  maxLobbyObservers: number;
  lobbyError: string | null;
  mapVoteOptions: MapVoteOption[];
  mapVotes: Map<string, string>;
  mapVotePhaseEndTime: number | null;
  selectedMapOptionId: string | null;
  matchmakingStatus: MatchmakingStatus;

  // Game state
  gameplayMode: GameplayMode;
  gamePhase: GamePhase;
  matchSummary: GameEndEvent | null;
  appliedExperienceMatchId: string | null;
  mapSeed: number;
  mapThemeId: VoxelMapTheme['id'] | null;
  mapSize: VoxelMapSizeId;
  powerupPickups: Map<string, PowerupPickupRuntimeState>;
  powerupPickupCollections: Map<string, PowerupPickupCollectionState>;

  // Teams
  redScore: number;
  blueScore: number;
  redFlag: { position: Vec3; carrierId: string | null; isAtBase: boolean } | null;
  blueFlag: { position: Vec3; carrierId: string | null; isAtBase: boolean } | null;

  // Players
  players: Map<string, Player>;
  localPlayer: Player | null;
  playerPings: Map<string, number | null>;
  isObserverMode: boolean;
  observerFlySpeedPreset: ObserverFlySpeedPreset;

  // Timing
  roundTimeRemaining: number;
  phaseEndTime: number | null;
  gameClockFrozen: boolean;

  // Ultimate effect state
  ultimateEffectActive: boolean;
  ultimateEffectType: string | null;
  ultimateEffectEndTime: number;

  // Client-side cooldowns
  clientCooldowns: Record<string, number>;
  clientCharges: Record<string, number>;
  chronosLifelineQueued: boolean;
  lastSkillCastAt: number;
  lastPrimaryFireAt: number;

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
  setTutorialMode: (enabled: boolean) => void;
  setTutorialCompletionOverlayOpen: (open: boolean) => void;
  setPracticePreparing: (preparing: boolean) => void;
  setAppPhase: (phase: AppPhase) => void;
  setMatchmakingStatus: (status: MatchmakingStatus) => void;
  setGamePhase: (phase: GamePhase) => void;
  setMatchSummary: (summary: GameEndEvent | null) => void;
  clearMatchSummary: () => void;
  setPhaseEndTime: (time: number | null) => void;
  setMapSeed: (seed: number) => void;
  setMapThemeId: (themeId: VoxelMapTheme['id'] | null) => void;
  setMapSize: (mapSize: VoxelMapSizeId | string | null | undefined) => void;
  setPowerupPickups: (pickups: PowerupPickupRuntimeState[]) => void;
  updatePowerupPickup: (pickup: PowerupPickupRuntimeState) => void;
  recordPowerupPickupCollection: (collection: PowerupPickupCollectionState) => void;
  clearPowerupPickups: () => void;
  updateLocalPlayer: (updates: Partial<Player>) => void;
  setLocalPlayer: (player: Player) => void;
  setPlayers: (players: Map<string, Player>) => void;
  updatePlayer: (playerId: string, player: Player) => void;
  removePlayer: (playerId: string) => void;
  setPlayerPings: (message: PlayerPingsMessage) => void;
  setObserverFlySpeedPreset: (preset: ObserverFlySpeedPreset) => void;
  // Lobby actions
  setCurrentLobby: (lobbyId: string | null, lobbyName: string | null) => void;
  setCurrentLobbyWager: (wager: LobbyWagerState) => void;
  setLobbyPlayers: (players: Map<string, LobbyPlayer>) => void;
  updateLobbyPlayer: (playerId: string, player: LobbyPlayer) => void;
  removeLobbyPlayer: (playerId: string) => void;
  setIsLobbyHost: (isHost: boolean) => void;
  setLobbyObserverSettings: (enabled: boolean, maxObservers: number) => void;
  setLobbyError: (message: string | null) => void;
  setObserverMode: (enabled: boolean) => void;
  setMapVoteState: (options: MapVoteOption[], votes: MapVoteRecord[], phaseEndTime: number | null, selectedOptionId?: string | null) => void;
  setMapVotes: (votes: MapVoteRecord[], selectedOptionId?: string | null) => void;
  clearMapVote: () => void;

  // UI Actions
  setUltimateEffect: (active: boolean, type?: string | null, endTime?: number) => void;
  setClientCooldown: (abilityId: string, endTime: number) => void;
  setClientCharges: (abilityId: string, charges: number) => void;
  clearClientCooldowns: () => void;
  setChronosLifelineQueuedHud: (queued: boolean) => void;
  recordSkillCast: (timestampMs?: number) => void;
  recordPrimaryFire: (timestampMs?: number) => void;
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

const HIDDEN_VISIBILITY_STATES = new Set(['hidden', 'last_known', 'audible']);

function shouldKeepPlayerLiveVisual(player: Player): boolean {
  return !HIDDEN_VISIBILITY_STATES.has(player.visibility ?? 'visible');
}

function shouldKeepChronosLifelineQueued(
  queued: boolean,
  previousLocalPlayer: Player | null,
  nextLocalPlayer: Player | null
): boolean {
  return queued && nextLocalPlayer?.heroId === 'chronos' && previousLocalPlayer?.id === nextLocalPlayer.id;
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
  isTutorialMode: false,
  tutorialCompletionOverlayOpen: false,
  isPracticePreparing: false,
  appPhase: 'menu',
  currentLobbyId: null,
  currentLobbyName: null,
  currentLobbyWager: { enabled: false },
  lobbyPlayers: new Map(),
  isLobbyHost: false,
  lobbyObserversEnabled: false,
  maxLobbyObservers: 0,
  lobbyError: null,
  mapVoteOptions: [],
  mapVotes: new Map(),
  mapVotePhaseEndTime: null,
  selectedMapOptionId: null,
  gameplayMode: DEFAULT_GAMEPLAY_MODE,
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
    capacityBlocked: false,
    capacityMaxPlayers: null,
    rankedCoverChargeLamports: null,
    rankedEntryQuoteId: null,
  },
  gamePhase: 'waiting',
  matchSummary: null,
  appliedExperienceMatchId: null,
  mapSeed: createRandomSeed(),
  mapThemeId: null,
  mapSize: DEFAULT_VOXEL_MAP_SIZE_ID,
  powerupPickups: new Map(),
  powerupPickupCollections: new Map(),
  redScore: 0,
  blueScore: 0,
  redFlag: null,
  blueFlag: null,
  players: new Map(),
  localPlayer: null,
  playerPings: new Map(),
  isObserverMode: false,
  observerFlySpeedPreset: DEFAULT_OBSERVER_FLY_SPEED_PRESET,
  roundTimeRemaining: 0,
  phaseEndTime: null,
  gameClockFrozen: false,
  ultimateEffectActive: false,
  ultimateEffectType: null,
  ultimateEffectEndTime: 0,
  clientCooldowns: {},
  clientCharges: {},
  chronosLifelineQueued: false,
  lastSkillCastAt: 0,
  lastPrimaryFireAt: 0,
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

    return state.isPracticeMode || state.isTutorialMode || state.isPracticePreparing
      ? { isPracticeMode: false, isTutorialMode: false, isPracticePreparing: false }
      : state;
  }),
  setTutorialMode: (enabled) => set((state) => (
    state.isTutorialMode === enabled && (enabled || !state.tutorialCompletionOverlayOpen)
      ? state
      : { isTutorialMode: enabled, tutorialCompletionOverlayOpen: enabled ? state.tutorialCompletionOverlayOpen : false }
  )),
  setTutorialCompletionOverlayOpen: (open) => set((state) => (
    state.tutorialCompletionOverlayOpen === open ? state : { tutorialCompletionOverlayOpen: open }
  )),
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
    return state.mapSeed === mapSeed ? state : { mapSeed, powerupPickups: new Map(), powerupPickupCollections: new Map() };
  }),
  setMapThemeId: (themeId) => set((state) => (
    state.mapThemeId === themeId ? state : { mapThemeId: themeId, powerupPickups: new Map(), powerupPickupCollections: new Map() }
  )),
  setMapSize: (mapSize) => set((state) => {
    const normalizedMapSize = normalizeVoxelMapSizeId(mapSize);
    return state.mapSize === normalizedMapSize ? state : { mapSize: normalizedMapSize, powerupPickups: new Map(), powerupPickupCollections: new Map() };
  }),

  setPowerupPickups: (pickups) => set({
    powerupPickups: new Map(pickups.map((pickup) => [pickup.pickupId, pickup])),
  }),

  updatePowerupPickup: (pickup) => set((state) => {
    const next = new Map(state.powerupPickups);
    next.set(pickup.pickupId, pickup);
    return { powerupPickups: next };
  }),

  recordPowerupPickupCollection: (collection) => set((state) => {
    const next = new Map(state.powerupPickupCollections);
    next.set(collection.pickupId, collection);
    return { powerupPickupCollections: next };
  }),

  clearPowerupPickups: () => set((state) => (
    state.powerupPickups.size === 0 && state.powerupPickupCollections.size === 0
      ? state
      : { powerupPickups: new Map(), powerupPickupCollections: new Map() }
  )),

  updateLocalPlayer: (updates) => {
    const { localPlayer, players, chronosLifelineQueued } = get();
    if (!localPlayer) return;

    const updatedPlayer = { ...localPlayer, ...updates };
    const updatedPlayers = new Map(players);
    updatedPlayers.set(localPlayer.id, updatedPlayer);

    set({
      localPlayer: updatedPlayer,
      players: updatedPlayers,
      chronosLifelineQueued: shouldKeepChronosLifelineQueued(chronosLifelineQueued, localPlayer, updatedPlayer),
    });
  },

  setLocalPlayer: (player) => {
    const { players, localPlayer, chronosLifelineQueued } = get();
    const updatedPlayers = new Map(players);
    updatedPlayers.set(player.id, player);

    set({
      localPlayer: player,
      players: updatedPlayers,
      playerId: player.id,
      chronosLifelineQueued: shouldKeepChronosLifelineQueued(chronosLifelineQueued, localPlayer, player),
    });
  },

  setPlayers: (players) => {
    const { playerId, playerPings, localPlayer: previousLocalPlayer, chronosLifelineQueued } = get();
    const localPlayer = playerId ? players.get(playerId) ?? null : null;
    const nextPlayerPings = new Map<string, number | null>();

    playerPings.forEach((pingMs, id) => {
      if (players.has(id)) {
        nextPlayerPings.set(id, pingMs);
      }
    });

    set({
      players,
      localPlayer,
      playerPings: nextPlayerPings,
      chronosLifelineQueued: shouldKeepChronosLifelineQueued(chronosLifelineQueued, previousLocalPlayer, localPlayer),
    });

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
    const { players, localPlayer, chronosLifelineQueued } = get();
    if (players.get(playerId) === player) return;

    const updatedPlayers = new Map(players);
    updatedPlayers.set(playerId, player);
    const nextLocalPlayer = playerId === localPlayer?.id ? player : localPlayer;

    set({
      players: updatedPlayers,
      localPlayer: nextLocalPlayer,
      chronosLifelineQueued: shouldKeepChronosLifelineQueued(chronosLifelineQueued, localPlayer, nextLocalPlayer),
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

  setLobbyObserverSettings: (enabled, maxObservers) => set((state) => {
    const normalizedMax = Math.max(0, Math.floor(maxObservers));
    return state.lobbyObserversEnabled === enabled && state.maxLobbyObservers === normalizedMax
      ? state
      : { lobbyObserversEnabled: enabled, maxLobbyObservers: normalizedMax };
  }),

  setLobbyError: (message) => set((state) => state.lobbyError === message ? state : { lobbyError: message }),

  setObserverMode: (enabled) => set((state) => (
    state.isObserverMode === enabled ? state : { isObserverMode: enabled }
  )),

  setObserverFlySpeedPreset: (preset) => set((state) => (
    state.observerFlySpeedPreset === preset ? state : { observerFlySpeedPreset: preset }
  )),

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

  setChronosLifelineQueuedHud: (queued) => set((state) => (
    state.chronosLifelineQueued === queued ? state : { chronosLifelineQueued: queued }
  )),

  recordSkillCast: (timestampMs = Date.now()) => set((state) => (
    state.lastSkillCastAt === timestampMs ? state : { lastSkillCastAt: timestampMs }
  )),

  recordPrimaryFire: (timestampMs = Date.now()) => set((state) => (
    state.lastPrimaryFireAt === timestampMs ? state : { lastPrimaryFireAt: timestampMs }
  )),

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
    lobbyObserversEnabled: false,
    maxLobbyObservers: 0,
    lobbyError: null,
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
      capacityBlocked: false,
      capacityMaxPlayers: null,
      rankedCoverChargeLamports: null,
      rankedEntryQuoteId: null,
    },
    gameplayMode: DEFAULT_GAMEPLAY_MODE,
  }),
}));
