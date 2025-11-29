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

export interface VoidZoneData {
  id: string;
  position: { x: number; y: number; z: number };
  radius: number;
  duration: number;
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

export interface DireBallData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
}

export interface VoidRayData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

// Blaze projectile types
export interface RocketData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
}

export interface BombData {
  id: string;
  targetPosition: { x: number; y: number; z: number };
  startPosition: { x: number; y: number; z: number };
  startTime: number;
  impactTime: number; // When the bomb lands
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  hasExploded: boolean;
}

// Hookshot projectile types
export interface HookProjectileData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  state: 'extending' | 'retracting';
  maxDistance: number;
  startPosition: { x: number; y: number; z: number };
}

export interface DragHookData {
  id: string;
  position: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  state: 'flying' | 'attached' | 'pulling';
  targetId?: string; // Player ID if hooked
  startPosition: { x: number; y: number; z: number };
}

export interface GrappleTrapData {
  id: string;
  position: { x: number; y: number; z: number }; // Target/landing position
  startPosition?: { x: number; y: number; z: number }; // Where it was thrown from
  velocity?: { x: number; y: number; z: number }; // Initial throw velocity for grenade arc
  startTime: number;
  duration: number;
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  radius: number;
  hookedPlayers: string[]; // IDs of players hooked
}

export interface SwingLineData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  attachPoint: { x: number; y: number; z: number };
  startTime: number;
  duration: number;
  ownerId: string;
  isActive: boolean;
  // Apex-style grapple state
  state: 'extending' | 'attached' | 'swinging' | 'done';
}

// Earth Wall - Hookshot E ability (hook slides on ground, wall rises behind it)
export interface EarthWallData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number }; // Horizontal direction of travel
  startTime: number;
  duration: number; // How long the wall stays up (3 seconds)
  ownerId: string;
  ownerTeam: 'red' | 'blue';
  maxDistance: number; // How far the hook travels
  hookProgress: number; // 0-1, how far the hook has traveled
  wallSegments: { x: number; y: number; z: number; height: number }[]; // Wall segments created
}

export interface GrappleLineData {
  id: string;
  startPosition: { x: number; y: number; z: number };
  endPosition: { x: number; y: number; z: number };
  startTime: number;
  ownerId: string;
  state: 'extending' | 'attached' | 'pulling' | 'retracting' | 'done';
}

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
  
  // Void zones (from phantom blink)
  voidZones: VoidZoneData[];
  
  // Dire balls (phantom primary fire projectiles)
  direBalls: DireBallData[];
  
  // Void rays (phantom charged secondary fire)
  voidRays: VoidRayData[];
  
  // Void ray charging state
  voidRayCharging: boolean;
  voidRayChargeStart: number;
  
  // Blaze projectiles
  rockets: RocketData[];
  bombs: BombData[];
  
  // Blaze bomb targeting state
  bombTargeting: boolean;
  bombTargetValid: boolean;
  
  // Blaze air strike targeting state
  airStrikeTargeting: boolean;
  airStrikeTargetValid: boolean;
  
  // Blaze jetpack state
  jetpackActive: boolean;
  jetpackFuel: number; // 0-100

  // Hookshot projectiles
  hookProjectiles: HookProjectileData[];
  dragHooks: DragHookData[];
  grappleTraps: GrappleTrapData[];
  swingLines: SwingLineData[];
  grappleLines: GrappleLineData[];
  earthWalls: EarthWallData[];
  
  // Hookshot grapple trap targeting state
  grappleTrapTargeting: boolean;
  grappleTrapTargetValid: boolean;

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
  
  // Void zone actions
  addVoidZone: (zone: VoidZoneData) => void;
  removeVoidZone: (id: string) => void;
  clearExpiredVoidZones: () => void;
  
  // Dire ball actions
  addDireBall: (ball: DireBallData) => void;
  removeDireBall: (id: string) => void;
  clearExpiredDireBalls: () => void;
  
  // Void ray actions
  addVoidRay: (ray: VoidRayData) => void;
  removeVoidRay: (id: string) => void;
  clearExpiredVoidRays: () => void;
  setVoidRayCharging: (charging: boolean, startTime?: number) => void;
  
  // Blaze rocket actions
  addRocket: (rocket: RocketData) => void;
  removeRocket: (id: string) => void;
  clearExpiredRockets: () => void;
  
  // Blaze bomb actions
  addBomb: (bomb: BombData) => void;
  removeBomb: (id: string) => void;
  clearExpiredBombs: () => void;
  setBombTargeting: (targeting: boolean, valid?: boolean) => void;
  
  // Blaze air strike actions
  setAirStrikeTargeting: (targeting: boolean, valid?: boolean) => void;
  
  // Blaze jetpack actions
  setJetpackActive: (active: boolean) => void;
  setJetpackFuel: (fuel: number) => void;
  
  // Hookshot projectile actions
  addHookProjectile: (hook: HookProjectileData) => void;
  updateHookProjectile: (id: string, updates: Partial<HookProjectileData>) => void;
  removeHookProjectile: (id: string) => void;
  clearExpiredHookProjectiles: () => void;
  
  addDragHook: (hook: DragHookData) => void;
  updateDragHook: (id: string, updates: Partial<DragHookData>) => void;
  removeDragHook: (id: string) => void;
  clearExpiredDragHooks: () => void;
  
  addGrappleTrap: (trap: GrappleTrapData) => void;
  updateGrappleTrap: (id: string, updates: Partial<GrappleTrapData>) => void;
  removeGrappleTrap: (id: string) => void;
  clearExpiredGrappleTraps: () => void;
  setGrappleTrapTargeting: (targeting: boolean, valid?: boolean) => void;
  
  addSwingLine: (line: SwingLineData) => void;
  updateSwingLine: (id: string, updates: Partial<SwingLineData>) => void;
  removeSwingLine: (id: string) => void;
  clearExpiredSwingLines: () => void;
  
  addGrappleLine: (line: GrappleLineData) => void;
  updateGrappleLine: (id: string, updates: Partial<GrappleLineData>) => void;
  removeGrappleLine: (id: string) => void;
  clearExpiredGrappleLines: () => void;
  
  // Earth wall actions (E ability)
  addEarthWall: (wall: EarthWallData) => void;
  updateEarthWall: (id: string, updates: Partial<EarthWallData>) => void;
  removeEarthWall: (id: string) => void;
  clearExpiredEarthWalls: () => void;
  
  // Ghost cleanup
  cleanupGhostPlayers: () => void;
  
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
  voidZones: [] as VoidZoneData[],
  direBalls: [] as DireBallData[],
  voidRays: [] as VoidRayData[],
  voidRayCharging: false,
  voidRayChargeStart: 0,
  rockets: [] as RocketData[],
  bombs: [] as BombData[],
  bombTargeting: false,
  bombTargetValid: false,
  airStrikeTargeting: false,
  airStrikeTargetValid: false,
  jetpackActive: false,
  jetpackFuel: 100,
  hookProjectiles: [] as HookProjectileData[],
  dragHooks: [] as DragHookData[],
  grappleTraps: [] as GrappleTrapData[],
  swingLines: [] as SwingLineData[],
  grappleLines: [] as GrappleLineData[],
  earthWalls: [] as EarthWallData[],
  grappleTrapTargeting: false,
  grappleTrapTargetValid: false,
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

  // Remove any "ghost" players that have the same name as the local player but different ID
  cleanupGhostPlayers: () => {
    const { players, localPlayer } = get();
    if (!localPlayer) return;
    
    const localName = localPlayer.name;
    const localId = localPlayer.id;
    
    let hasGhosts = false;
    const cleanedPlayers = new Map<string, Player>();
    
    players.forEach((player, id) => {
      // Keep the player if it's the local player OR has a different name
      if (id === localId || player.name !== localName) {
        cleanedPlayers.set(id, player);
      } else {
        hasGhosts = true;
        console.log(`[CLEANUP] Removing ghost player: ${player.name} (${id})`);
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

  addVoidZone: (zone) => set((state) => ({
    voidZones: [...state.voidZones, zone]
  })),
  
  removeVoidZone: (id) => set((state) => ({
    voidZones: state.voidZones.filter(z => z.id !== id)
  })),
  
  clearExpiredVoidZones: () => set((state) => {
    const now = Date.now();
    return {
      voidZones: state.voidZones.filter(z => (now - z.startTime) / 1000 < z.duration)
    };
  }),

  addDireBall: (ball) => set((state) => ({
    direBalls: [...state.direBalls, ball]
  })),
  
  removeDireBall: (id) => set((state) => ({
    direBalls: state.direBalls.filter(b => b.id !== id)
  })),
  
  clearExpiredDireBalls: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 3000; // 3 seconds in ms
    return {
      direBalls: state.direBalls.filter(b => now - b.startTime < LIFETIME)
    };
  }),

  addVoidRay: (ray) => set((state) => ({
    voidRays: [...state.voidRays, ray]
  })),
  
  removeVoidRay: (id) => set((state) => ({
    voidRays: state.voidRays.filter(r => r.id !== id)
  })),
  
  clearExpiredVoidRays: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 500; // 0.5 seconds - rays are quick
    return {
      voidRays: state.voidRays.filter(r => now - r.startTime < LIFETIME)
    };
  }),
  
  setVoidRayCharging: (charging, startTime = 0) => set({
    voidRayCharging: charging,
    voidRayChargeStart: startTime,
  }),

  // Blaze rocket actions
  addRocket: (rocket) => set((state) => {
    // Prevent duplicate rockets
    if (state.rockets.some(r => r.id === rocket.id)) {
      return state;
    }
    return { rockets: [...state.rockets, rocket] };
  }),
  
  removeRocket: (id) => set((state) => ({
    rockets: state.rockets.filter(r => r.id !== id)
  })),
  
  clearExpiredRockets: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 5000; // 5 seconds in ms
    return {
      rockets: state.rockets.filter(r => now - r.startTime < LIFETIME)
    };
  }),
  
  // Blaze bomb actions
  addBomb: (bomb) => set((state) => {
    // Prevent duplicate bombs
    if (state.bombs.some(b => b.id === bomb.id)) {
      return state;
    }
    return { bombs: [...state.bombs, bomb] };
  }),
  
  removeBomb: (id) => set((state) => ({
    bombs: state.bombs.filter(b => b.id !== id)
  })),
  
  clearExpiredBombs: () => set((state) => {
    const now = Date.now();
    const TOTAL_LIFETIME = 5000; // Remove bombs 5 seconds after they were created (fall + explosion)
    return {
      bombs: state.bombs.filter(b => now - b.startTime < TOTAL_LIFETIME)
    };
  }),
  
  setBombTargeting: (targeting, valid = false) => set({
    bombTargeting: targeting,
    bombTargetValid: valid
  }),
  
  setAirStrikeTargeting: (targeting, valid = false) => set({
    airStrikeTargeting: targeting,
    airStrikeTargetValid: valid
  }),
  
  setJetpackActive: (active) => set({ jetpackActive: active }),
  setJetpackFuel: (fuel) => set({ jetpackFuel: Math.max(0, Math.min(100, fuel)) }),

  // Hookshot projectile actions
  addHookProjectile: (hook) => set((state) => {
    if (state.hookProjectiles.some(h => h.id === hook.id)) return state;
    return { hookProjectiles: [...state.hookProjectiles, hook] };
  }),
  
  updateHookProjectile: (id, updates) => set((state) => ({
    hookProjectiles: state.hookProjectiles.map(h => 
      h.id === id ? { ...h, ...updates } : h
    )
  })),
  
  removeHookProjectile: (id) => set((state) => ({
    hookProjectiles: state.hookProjectiles.filter(h => h.id !== id)
  })),
  
  clearExpiredHookProjectiles: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 2000; // 2 seconds max for hook projectiles
    return {
      hookProjectiles: state.hookProjectiles.filter(h => now - h.startTime < LIFETIME)
    };
  }),
  
  addDragHook: (hook) => set((state) => {
    if (state.dragHooks.some(h => h.id === hook.id)) return state;
    return { dragHooks: [...state.dragHooks, hook] };
  }),
  
  updateDragHook: (id, updates) => set((state) => ({
    dragHooks: state.dragHooks.map(h => 
      h.id === id ? { ...h, ...updates } : h
    )
  })),
  
  removeDragHook: (id) => set((state) => ({
    dragHooks: state.dragHooks.filter(h => h.id !== id)
  })),
  
  clearExpiredDragHooks: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 5000; // 5 seconds max for drag hooks (includes pull time)
    return {
      dragHooks: state.dragHooks.filter(h => now - h.startTime < LIFETIME)
    };
  }),
  
  addGrappleTrap: (trap) => set((state) => {
    if (state.grappleTraps.some(t => t.id === trap.id)) return state;
    return { grappleTraps: [...state.grappleTraps, trap] };
  }),
  
  updateGrappleTrap: (id, updates) => set((state) => ({
    grappleTraps: state.grappleTraps.map(t => 
      t.id === id ? { ...t, ...updates } : t
    )
  })),
  
  removeGrappleTrap: (id) => set((state) => ({
    grappleTraps: state.grappleTraps.filter(t => t.id !== id)
  })),
  
  clearExpiredGrappleTraps: () => set((state) => {
    const now = Date.now();
    return {
      grappleTraps: state.grappleTraps.filter(t => (now - t.startTime) / 1000 < t.duration)
    };
  }),
  
  setGrappleTrapTargeting: (targeting, valid = false) => set({
    grappleTrapTargeting: targeting,
    grappleTrapTargetValid: valid
  }),
  
  addSwingLine: (line) => set((state) => {
    if (state.swingLines.some(l => l.id === line.id)) return state;
    return { swingLines: [...state.swingLines, line] };
  }),
  
  updateSwingLine: (id, updates) => set((state) => ({
    swingLines: state.swingLines.map(l => 
      l.id === id ? { ...l, ...updates } : l
    )
  })),
  
  removeSwingLine: (id) => set((state) => ({
    swingLines: state.swingLines.filter(l => l.id !== id)
  })),
  
  clearExpiredSwingLines: () => set((state) => {
    const now = Date.now();
    return {
      swingLines: state.swingLines.filter(l => (now - l.startTime) / 1000 < l.duration)
    };
  }),
  
  addGrappleLine: (line) => set((state) => {
    if (state.grappleLines.some(l => l.id === line.id)) return state;
    return { grappleLines: [...state.grappleLines, line] };
  }),
  
  updateGrappleLine: (id, updates) => set((state) => ({
    grappleLines: state.grappleLines.map(l => 
      l.id === id ? { ...l, ...updates } : l
    )
  })),
  
  removeGrappleLine: (id) => set((state) => ({
    grappleLines: state.grappleLines.filter(l => l.id !== id)
  })),
  
  clearExpiredGrappleLines: () => set((state) => {
    const now = Date.now();
    const LIFETIME = 6000; // 6 seconds max - enough for hook extension + player pull
    return {
      grappleLines: state.grappleLines.filter(l => now - l.startTime < LIFETIME)
    };
  }),
  
  // Earth wall actions (E ability)
  addEarthWall: (wall) => set((state) => {
    if (state.earthWalls.some(w => w.id === wall.id)) return state;
    return { earthWalls: [...state.earthWalls, wall] };
  }),
  
  updateEarthWall: (id, updates) => set((state) => ({
    earthWalls: state.earthWalls.map(w => 
      w.id === id ? { ...w, ...updates } : w
    )
  })),
  
  removeEarthWall: (id) => set((state) => ({
    earthWalls: state.earthWalls.filter(w => w.id !== id)
  })),
  
  clearExpiredEarthWalls: () => set((state) => {
    const now = Date.now();
    return {
      earthWalls: state.earthWalls.filter(w => {
        const elapsed = (now - w.startTime) / 1000;
        // Wall stays for duration (3s) + travel time (hook takes ~1s to fully extend)
        return elapsed < w.duration + 1.5;
      })
    };
  }),

  reset: () => set(initialState),
  
  resetLobby: () => set({
    currentLobbyId: null,
    currentLobbyName: null,
    lobbyPlayers: new Map(),
    isLobbyHost: false,
  }),
}));

