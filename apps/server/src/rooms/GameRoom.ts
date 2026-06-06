import { Room, Client } from 'colyseus';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { Vec3Schema, AbilityStateSchema } from './schema/Components';
import {
  DEFAULT_GAME_CONFIG,
  TICK_RATE,
  TICK_INTERVAL_MS,
  HERO_DEFINITIONS,
  ABILITY_DEFINITIONS,
  getHeroStats,
  ALL_HERO_IDS,
  createRandomSeed,
  PROCEDURAL_MAP_ORIGIN,
  PROCEDURAL_MAP_WORLD_SIZE,
  generateProceduralVoxelMap,
  isInsideBoundaryPolygon,
  constrainToBoundaryPolygon,
  clampToBoundaryPolygon,
  isSolidBlock,
  FLAG_CAPTURE_RADIUS,
  FLAG_PICKUP_RADIUS,
  ULTIMATE_CHARGE_PER_CAPTURE,
  ULTIMATE_CHARGE_PER_KILL,
  ULTIMATE_CHARGE_PER_SECOND,
  BLAZE_FLAMETHROWER_MAX_FUEL,
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_FLAMETHROWER_RANGE,
  BLAZE_FLAMETHROWER_CONE_HALF_ANGLE,
  BLAZE_FLAMETHROWER_DAMAGE,
  BLAZE_FLAMETHROWER_DAMAGE_INTERVAL,
  BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET,
  BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
  BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
} from '@voxel-strike/shared';
import type { 
  BotDifficulty,
  HeroId, 
  Team, 
  PlayerInput,
  VoxelChunk,
  VoxelMapManifest,
} from '@voxel-strike/shared';
import { simulateSharedMovement, type MovementTerrainAdapter } from '@voxel-strike/physics';

// Import extracted ability handlers
import {
  VoidZone,
  VOID_ZONE_RADIUS,
  VOID_ZONE_DAMAGE,
  VOID_ZONE_DURATION,
  VOID_ZONE_DAMAGE_INTERVAL,
  initializePlayerAbilities,
  resetAbilityCooldowns,
  tryUseAbility,
  executeAbility,
  updateAbilityCooldowns,
  updateActiveAbilities,
} from './abilityHandlers';

interface CreateOptions {
  lobbyId?: string;
  lobbyName?: string;
  botAssignments?: BotAssignment[];
}

interface JoinOptions {
  playerName?: string;
  preferredTeam?: Team;
  clientId?: string;
}

interface BotAssignment {
  playerId: string;
  playerName: string;
  team: Team;
  isBot: true;
  botDifficulty?: BotDifficulty;
  botProfileId?: string;
}

interface BotBrain {
  nextThinkAt: number;
  intent: BotIntent;
  stuckTime: number;
  lastPosition: { x: number; y: number; z: number };
  strafeDirection: -1 | 1;
  reverseUntil: number;
}

interface BotBlackboard {
  nearestEnemy: Player | null;
  enemyCarrier: Player | null;
  nearestAlly: Player | null;
  alliedCarrier: Player | null;
  droppedFriendlyFlag: { x: number; y: number; z: number } | null;
  enemyFlagPosition: { x: number; y: number; z: number };
  ownBasePosition: { x: number; y: number; z: number };
  nearbyEnemyCount: number;
  nearbyAllyCount: number;
}

interface AttackConfig {
  damage: number;
  range: number;
  cooldownMs: number;
  coneDot: number;
  radius?: number;
  damageType: string;
}

type BotIntent =
  | 'selecting'
  | 'seek_enemy_flag'
  | 'carry_flag_home'
  | 'return_friendly_flag'
  | 'defend_carrier'
  | 'chase_enemy_carrier'
  | 'fight_enemy'
  | 'retreat_or_reposition'
  | 'respawning';

// Track previous press state to detect edges for both humans and server-owned bots.
const playerPressState = new Map<string, {
  primaryFire: boolean;
  secondaryFire: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
}>();
const MAP_MIN_X = PROCEDURAL_MAP_ORIGIN.x;
const MAP_MAX_X = PROCEDURAL_MAP_ORIGIN.x + PROCEDURAL_MAP_WORLD_SIZE.x;
const MAP_MIN_Z = PROCEDURAL_MAP_ORIGIN.z;
const MAP_MAX_Z = PROCEDURAL_MAP_ORIGIN.z + PROCEDURAL_MAP_WORLD_SIZE.z;
const BLAZE_FLAMETHROWER_CONE_DOT = Math.cos(BLAZE_FLAMETHROWER_CONE_HALF_ANGLE);
const BOT_THINK_INTERVAL_MS = 200;
const DAMAGE_HISTORY_WINDOW_MS = 10000;
const PRIMARY_ATTACKS: Record<HeroId, AttackConfig> = {
  phantom: { damage: 18, range: 30, cooldownMs: 550, coneDot: Math.cos(0.18), damageType: 'dire_ball' },
  hookshot: { damage: 16, range: 22, cooldownMs: 600, coneDot: Math.cos(0.2), damageType: 'chain_hooks' },
  blaze: { damage: 28, range: 36, cooldownMs: 850, coneDot: Math.cos(0.22), damageType: 'rocket' },
  glacier: { damage: 42, range: 3.4, cooldownMs: 750, coneDot: Math.cos(0.72), damageType: 'ice_mallet' },
  pulse: { damage: 16, range: 30, cooldownMs: 360, coneDot: Math.cos(0.16), damageType: 'pulse_burst' },
  sentinel: { damage: 20, range: 26, cooldownMs: 650, coneDot: Math.cos(0.2), damageType: 'sentinel_bolt' },
};
const SECONDARY_ATTACKS: Partial<Record<HeroId, AttackConfig>> = {
  phantom: { damage: 34, range: 42, cooldownMs: 1200, coneDot: Math.cos(0.12), damageType: 'void_ray' },
  hookshot: { damage: 24, range: 28, cooldownMs: 3600, coneDot: Math.cos(0.14), damageType: 'drag_hook' },
  blaze: { damage: 34, range: 35, cooldownMs: 2600, coneDot: Math.cos(0.32), radius: 4, damageType: 'bomb' },
  glacier: { damage: 12, range: 6, cooldownMs: 1200, coneDot: Math.cos(0.8), damageType: 'frost_storm' },
  pulse: { damage: 14, range: 18, cooldownMs: 900, coneDot: Math.cos(0.24), damageType: 'pulse_dash_hit' },
  sentinel: { damage: 10, range: 8, cooldownMs: 1400, coneDot: Math.cos(0.9), damageType: 'barrier_bash' },
};

export class GameRoom extends Room<GameState> {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly config = DEFAULT_GAME_CONFIG;
  private lobbyId: string | null = null;
  private lobbyName: string | null = null;
  private voidZones: VoidZone[] = [];
  private voidZoneIdCounter: number = 0;
  private npcIdCounter: number = 0;
  private spawnedNpcs: Set<string> = new Set(); // Track NPC IDs
  private authoritativePositionUntil: Map<string, number> = new Map();
  private flamethrowerLastDamageTick: Map<string, number> = new Map();
  private botBrains: Map<string, BotBrain> = new Map();
  private attackCooldownUntil: Map<string, number> = new Map();
  private damageHistory: Map<string, Map<string, { damage: number; timestamp: number }>> = new Map();
  private devInvulnerablePlayers: Set<string> = new Set();
  private devImmunePlayers: Set<string> = new Set();
  private mapManifest: VoxelMapManifest | null = null;
  private mapChunkLookup: Map<string, VoxelChunk> = new Map();
  private movementTerrain: MovementTerrainAdapter = {
    getGroundY: (position: { x: number; y: number; z: number }) => this.getProceduralGroundY(position),
    clampPosition: (position: { x: number; y: number; z: number }) => this.clampToPlayableMap(position),
  };
  
  // Track clientId -> sessionId mapping for reconnection detection
  private clientIdToSessionId: Map<string, string> = new Map();
  private sessionIdToClientId: Map<string, string> = new Map();

  onCreate(options: CreateOptions) {
    this.lobbyId = options.lobbyId || null;
    this.lobbyName = options.lobbyName || null;
    console.log('Game room created:', this.roomId, 'from lobby:', this.lobbyId || 'direct');

    // Initialize state
    this.setState(new GameState());
    this.state.roomId = this.roomId;
    this.state.config = this.config;
    this.state.mapSeed = createRandomSeed();
    this.refreshMapManifest();
    console.log(`[GameRoom] Map seed: ${this.state.mapSeed}`);
    this.resetFlags();
    this.createBotsFromAssignments(options.botAssignments || []);

    // Set up tick loop
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    // Handle messages
    this.onMessage('input', (client, input: PlayerInput) => {
      this.handleInput(client, input);
    });

    this.onMessage('selectHero', (client, data: { heroId: HeroId }) => {
      try {
        this.handleHeroSelect(client, data.heroId);
      } catch (error) {
        console.error('[GameRoom] Failed to apply hero selection:', error);
        client.send('devCommandError', { message: 'Failed to switch hero' });
      }
    });

    this.onMessage('devSetHero', (client, data: { heroId: HeroId }) => {
      try {
        this.handleDevSetHero(client, data.heroId);
      } catch (error) {
        console.error('[GameRoom] Failed to apply dev hero switch:', error);
        client.send('devCommandError', { message: 'Failed to switch hero' });
      }
    });

    this.onMessage('selectTeam', (client, data: { team: Team }) => {
      this.handleTeamSelect(client, data.team);
    });

    this.onMessage('ready', (client, data: { ready: boolean }) => {
      this.handleReady(client, data.ready);
    });

    this.onMessage('chat', (client, data: { message: string; teamOnly: boolean }) => {
      this.handleChat(client, data.message, data.teamOnly);
    });

    if (this.isDevelopmentMode()) {
      // Development-only entity helpers. Production bots are lobby participants.
      this.onMessage('spawnNpc', (client, data: { heroId: HeroId; team: Team; position?: { x: number; y: number; z: number }; name?: string }) => {
        this.handleSpawnNpc(client, data);
      });

      this.onMessage('damageNpc', (client, data: { npcId: string; damage: number }) => {
        this.handleDamageNpc(client, data);
      });

      this.onMessage('killNpc', (client, data: { npcId: string }) => {
        this.handleKillNpc(client, data);
      });

      this.onMessage('killAllNpcs', (client) => {
        this.handleKillAllNpcs(client);
      });

      this.onMessage('setDevFly', (client, data: { enabled: boolean }) => {
        this.handleSetDevFly(client, Boolean(data.enabled));
      });

      this.onMessage('setDevImmune', (client, data: { enabled: boolean }) => {
        this.handleSetDevImmune(client, Boolean(data.enabled));
      });
    }
  }

  onJoin(client: Client, options: JoinOptions) {
    console.log(`[GameRoom] Player joining: sessionId=${client.sessionId}, name=${options.playerName}, clientId=${options.clientId}`);
    console.log(`[GameRoom] Current players in room: ${this.state.players.size}, clientId map size: ${this.clientIdToSessionId.size}`);

    // Handle reconnection: if same clientId exists, kick the old session
    if (options.clientId) {
      const existingSessionId = this.clientIdToSessionId.get(options.clientId);
      console.log(`[GameRoom] Checking for existing session with clientId ${options.clientId}: found=${existingSessionId}`);
      
      if (existingSessionId && existingSessionId !== client.sessionId) {
        console.log(`[GameRoom] DUPLICATE DETECTED! Kicking old session: ${existingSessionId}`);
        
        // Find and disconnect the old client
        const oldClient = this.clients.find(c => c.sessionId === existingSessionId);
        if (oldClient) {
          // Send a message to the old client before kicking
          oldClient.send('duplicateSession', { reason: 'Connected from another tab/window' });
          oldClient.leave(4000); // Custom code for duplicate session
        }
        
        // Clean up old session data (onLeave will also be called, but let's be safe)
        const oldPlayer = this.state.players.get(existingSessionId);
        if (oldPlayer?.hasFlag) {
          this.dropFlag(oldPlayer);
        }
        this.state.players.delete(existingSessionId);
        playerPressState.delete(existingSessionId);
        this.sessionIdToClientId.delete(existingSessionId);
        
        // Broadcast that old player left
        this.broadcast('playerLeft', { playerId: existingSessionId });
      }
      
      // Register this client's ID mapping
      this.clientIdToSessionId.set(options.clientId, client.sessionId);
      this.sessionIdToClientId.set(client.sessionId, options.clientId);
    }

    // Initialize ability press state tracking
    this.initializePressState(client.sessionId);

    // Send existing players to the new client BEFORE adding the new player
    this.state.players.forEach((existingPlayer, id) => {
      client.send('playerJoined', {
        playerId: id,
        playerName: existingPlayer.name,
        team: existingPlayer.team,
        heroId: existingPlayer.heroId,
        isReady: existingPlayer.isReady,
        isBot: existingPlayer.isBot,
        botDifficulty: existingPlayer.botDifficulty,
        botProfileId: existingPlayer.botProfileId,
        position: {
          x: existingPlayer.position.x,
          y: existingPlayer.position.y,
          z: existingPlayer.position.z,
        },
      });
    });

    // Create player
    const player = new Player();
    player.id = client.sessionId;
    player.name = options.playerName || `Player${this.state.players.size + 1}`;
    player.team = this.assignTeam(options.preferredTeam);
    player.state = 'selecting';
    player.isBot = false;
    player.botDifficulty = '';
    player.botProfileId = '';

    // Set spawn position
    this.placePlayerAtSpawn(player);

    this.state.players.set(client.sessionId, player);

    // Broadcast join to all clients (including the new one)
    this.broadcast('playerJoined', {
      playerId: client.sessionId,
      playerName: player.name,
      team: player.team,
      heroId: player.heroId,
      isReady: player.isReady,
      isBot: player.isBot,
      position: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
      },
    });

    console.log(`[GameRoom] Player join complete. Total players now: ${this.state.players.size}`);
    this.state.players.forEach((p, id) => {
      console.log(`[GameRoom]   - ${p.name} (${id}) on team ${p.team}`);
    });

    // Check if we should start hero select
    this.checkPhaseTransition();
  }

  onLeave(client: Client, consented: boolean) {
    console.log('Player left:', client.sessionId, 'consented:', consented);

    const player = this.state.players.get(client.sessionId);
    
    // Handle flag drop if carrying
    if (player?.hasFlag) {
      this.dropFlag(player);
    }

    this.state.players.delete(client.sessionId);
    playerPressState.delete(client.sessionId);
    this.authoritativePositionUntil.delete(client.sessionId);
    this.devInvulnerablePlayers.delete(client.sessionId);
    this.devImmunePlayers.delete(client.sessionId);
    
    // Clean up clientId mappings
    const clientId = this.sessionIdToClientId.get(client.sessionId);
    if (clientId) {
      // Only remove from clientIdToSessionId if it still points to this session
      // (it may have been updated to point to a new session if this was a duplicate kick)
      if (this.clientIdToSessionId.get(clientId) === client.sessionId) {
        this.clientIdToSessionId.delete(clientId);
      }
      this.sessionIdToClientId.delete(client.sessionId);
    }

    this.broadcast('playerLeft', {
      playerId: client.sessionId,
    });

    // Check if game should end
    this.checkPhaseTransition();
  }

  onDispose() {
    console.log('Room disposing:', this.roomId);
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
    }
  }

  private tick() {
    this.state.tick++;
    this.state.serverTime = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;
    this.updateBots(this.state.serverTime, dt);

    // Update based on phase
    switch (this.state.phase) {
      case 'hero_select':
        // Broadcast player states so players can see each other in lobby
        this.broadcastPlayerStates();
        break;
      case 'countdown':
        this.updateCountdown();
        // Broadcast player states during countdown
        this.broadcastPlayerStates();
        break;
      case 'playing':
        this.updatePlaying();
        break;
      case 'round_end':
        this.updateRoundEnd();
        break;
    }
  }

  private updateCountdown() {
    if (this.state.phaseEndTime && Date.now() >= this.state.phaseEndTime) {
      this.startPlaying();
    }
  }

  private updatePlaying() {
    const now = Date.now();
    const dt = TICK_INTERVAL_MS / 1000;

    // Update round timer
    if (this.state.roundStartTime) {
      const elapsed = (now - this.state.roundStartTime) / 1000;
      this.state.roundTimeRemaining = Math.max(0, this.config.roundTimeSeconds - elapsed);

      if (this.state.roundTimeRemaining <= 0) {
        this.endRound();
      }
    }

    // Update each player
    this.state.players.forEach(player => {
      // Handle respawns
      if (player.state === 'dead' && player.respawnTime) {
        if (now >= player.respawnTime) {
          this.respawnPlayer(player);
        }
        return;
      }

      if (player.state !== 'alive') return;

      // Update ability cooldowns
      updateAbilityCooldowns(player, dt);

      // Passive ultimate charge
      if (player.ultimateCharge < 100) {
        player.ultimateCharge = Math.min(100, player.ultimateCharge + ULTIMATE_CHARGE_PER_SECOND * dt);
      }

      // Process active abilities (like Phantom Veil)
      updateActiveAbilities(player, now);
    });

    // Update void zones (damage enemies inside)
    this.updateVoidZones(now);

    // Update held Blaze flamethrowers
    this.updateBlazeFlamethrowers(now, dt);

    // Update physics simulation (simplified)
    this.updatePhysics();

    // Update CTF objective interactions after movement.
    this.updateCTFObjectives(now);

    // Broadcast player positions/states via message (workaround for schema sync issues)
    this.broadcastPlayerStates();
  }

  // Ability cooldown and active ability updates are now in abilityHandlers.ts

  private broadcastPlayerStates() {
    const playerStates: any[] = [];
    
    this.state.players.forEach((player, id) => {
      // Convert abilities MapSchema to plain object
      const abilities: Record<string, any> = {};
      player.abilities.forEach((ability, abilityId) => {
        abilities[abilityId] = {
          abilityId: ability.abilityId,
          cooldownRemaining: ability.cooldownRemaining,
          charges: ability.charges,
          isActive: ability.isActive,
        };
      });

    playerStates.push({
        id,
        name: player.name,
        team: player.team,
        heroId: player.heroId,
        state: player.state,
        isReady: player.isReady,
        isBot: player.isBot,
        botDifficulty: player.botDifficulty,
        botProfileId: player.botProfileId,
        position: {
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
        },
        velocity: {
          x: player.velocity.x,
          y: player.velocity.y,
          z: player.velocity.z,
        },
        lookYaw: player.lookYaw,
        lookPitch: player.lookPitch,
        health: player.health,
        maxHealth: player.maxHealth,
        ultimateCharge: player.ultimateCharge,
        hasFlag: player.hasFlag,
        abilities, // Include abilities in state sync
        stats: {
          kills: player.kills,
          deaths: player.deaths,
          assists: player.assists,
          flagCaptures: player.flagCaptures,
          flagReturns: player.flagReturns,
        },
      });
    });

    if (playerStates.length > 0) {
      this.broadcast('playerStates', {
        players: playerStates,
        mapSeed: this.state.mapSeed,
        redScore: this.state.redTeam.score,
        blueScore: this.state.blueTeam.score,
        redFlag: this.getFlagSync('red'),
        blueFlag: this.getFlagSync('blue'),
        roundTimeRemaining: this.state.roundTimeRemaining,
      });
    }
  }

  private updateRoundEnd() {
    if (this.state.phaseEndTime && Date.now() >= this.state.phaseEndTime) {
      // Check if game should end
      if (this.state.redTeam.score >= this.config.scoreToWin || 
          this.state.blueTeam.score >= this.config.scoreToWin) {
        this.endGame();
      } else {
        this.startHeroSelect();
      }
    }
  }

  private handleInput(client: Client, input: PlayerInput & { position?: { x: number; y: number; z: number }; velocity?: { x: number; y: number; z: number } }) {
    const player = this.state.players.get(client.sessionId);
    if (!player || player.state !== 'alive') return;

    // Store input for processing
    player.lastInput = input;

    // Update look direction immediately
    player.lookYaw = input.lookYaw;
    player.lookPitch = input.lookPitch;

    if (this.isDevelopmentMode() && input.devFly) {
      this.disablePlayerSkills(player);
      if (input.position && this.isFiniteVec3(input.position)) {
        player.position.x = input.position.x;
        player.position.y = input.position.y;
        player.position.z = input.position.z;
      }
      if (input.velocity && this.isFiniteVec3(input.velocity)) {
        player.velocity.x = input.velocity.x;
        player.velocity.y = input.velocity.y;
        player.velocity.z = input.velocity.z;
      }
      return;
    }

    const shouldAcceptClientPosition = Date.now() >= (this.authoritativePositionUntil.get(client.sessionId) ?? 0);

    // Use client-reported position after server-side spawn placement has had time to sync.
    if (input.position && shouldAcceptClientPosition) {
      player.position.x = Math.max(MAP_MIN_X, Math.min(MAP_MAX_X, input.position.x));
      player.position.y = Math.max(-10, Math.min(100, input.position.y));
      player.position.z = Math.max(MAP_MIN_Z, Math.min(MAP_MAX_Z, input.position.z));
    }
    if (input.velocity && shouldAcceptClientPosition) {
      player.velocity.x = input.velocity.x;
      player.velocity.y = input.velocity.y;
      player.velocity.z = input.velocity.z;
    }

    // Handle ability inputs (detect key press, not hold)
    this.processPlayerInput(player, input);
  }

  private handleAbilityUse(player: Player, slot: 'ability1' | 'ability2' | 'ultimate') {
    const result = tryUseAbility(player, slot);
    if (!result.success || !result.abilityId || !result.abilityState || !result.abilityDef) {
      return;
    }

    // Execute ability effect with context for void zone creation
    executeAbility(player, result.abilityId, result.abilityState, result.abilityDef, {
      createVoidZone: (position, ownerId, ownerTeam) => this.createVoidZone(position, ownerId, ownerTeam),
    });

    // Broadcast ability use
    this.broadcast('abilityUsed', {
      playerId: player.id,
      abilityId: result.abilityId,
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
      direction: { 
        yaw: player.lookYaw, 
        pitch: player.lookPitch 
      },
    });
  }

  private createBotsFromAssignments(assignments: BotAssignment[]): void {
    assignments.forEach((assignment, index) => {
      const bot = new Player();
      bot.id = assignment.playerId;
      bot.name = assignment.playerName;
      bot.team = assignment.team;
      bot.state = 'selecting';
      bot.isReady = false;
      bot.isBot = true;
      bot.botDifficulty = assignment.botDifficulty || 'normal';
      bot.botProfileId = assignment.botProfileId || '';

      this.placePlayerAtSpawn(bot);

      this.state.players.set(bot.id, bot);
      this.initializePressState(bot.id);
      this.botBrains.set(bot.id, {
        nextThinkAt: 0,
        intent: 'selecting',
        stuckTime: 0,
        lastPosition: { x: bot.position.x, y: bot.position.y, z: bot.position.z },
        strafeDirection: index % 2 === 0 ? 1 : -1,
        reverseUntil: 0,
      });
    });
  }

  private initializePressState(playerId: string): void {
    playerPressState.set(playerId, {
      primaryFire: false,
      secondaryFire: false,
      ability1: false,
      ability2: false,
      ultimate: false,
    });
  }

  private processPlayerInput(player: Player, input: PlayerInput): void {
    if (player.state !== 'alive') return;

    const pressState = playerPressState.get(player.id);
    if (!pressState) {
      this.initializePressState(player.id);
    }
    const previous = playerPressState.get(player.id)!;

    if (input.primaryFire) {
      this.tryResolveAttack(player, 'primary');
    }
    if (input.secondaryFire && !previous.secondaryFire) {
      this.tryResolveAttack(player, 'secondary');
    }

    if (input.ability1 && !previous.ability1) {
      this.handleAbilityUse(player, 'ability1');
    }
    if (input.ability2 && !previous.ability2) {
      this.handleAbilityUse(player, 'ability2');
    }
    if (input.ultimate && !previous.ultimate) {
      this.handleAbilityUse(player, 'ultimate');
    }

    previous.primaryFire = input.primaryFire;
    previous.secondaryFire = input.secondaryFire;
    previous.ability1 = input.ability1;
    previous.ability2 = input.ability2;
    previous.ultimate = input.ultimate;
  }

  private tryResolveAttack(player: Player, mode: 'primary' | 'secondary'): void {
    const heroId = player.heroId as HeroId;
    if (!heroId) return;

    const attack = mode === 'primary' ? PRIMARY_ATTACKS[heroId] : SECONDARY_ATTACKS[heroId];
    if (!attack) return;

    const cooldownKey = `${player.id}:${mode}`;
    const now = Date.now();
    if (now < (this.attackCooldownUntil.get(cooldownKey) || 0)) return;
    this.attackCooldownUntil.set(cooldownKey, now + attack.cooldownMs);

    const veil = player.abilities.get('phantom_veil');
    if (veil?.isActive) {
      veil.isActive = false;
    }

    const primaryTarget = this.findTargetInAimCone(player, attack.range, attack.coneDot);
    if (!primaryTarget) return;

    if (attack.radius && attack.radius > 0) {
      this.applyAreaDamage(player, primaryTarget.position, attack.radius, attack.damage, attack.damageType);
    } else {
      this.applyDamage(primaryTarget, attack.damage, player.id, attack.damageType);
    }

    if (heroId === 'hookshot' && mode === 'secondary') {
      this.pullTargetTowardSource(primaryTarget, player, 2.5);
    }
  }

  private findTargetInAimCone(source: Player, range: number, minDot: number): Player | null {
    const origin = {
      x: source.position.x,
      y: source.position.y + 1.2,
      z: source.position.z,
    };
    const cosPitch = Math.cos(source.lookPitch);
    const forward = {
      x: -Math.sin(source.lookYaw) * cosPitch,
      y: Math.sin(source.lookPitch),
      z: -Math.cos(source.lookYaw) * cosPitch,
    };
    let bestTarget: Player | null = null;
    let bestDistance = range;

    this.state.players.forEach((target) => {
      if (target.state !== 'alive') return;
      if (target.id === source.id) return;
      if (target.team === source.team) return;

      const toTarget = {
        x: target.position.x - origin.x,
        y: target.position.y + 0.9 - origin.y,
        z: target.position.z - origin.z,
      };
      const distance = Math.sqrt(toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z);
      if (distance <= 0.0001 || distance > range) return;

      const dot = (toTarget.x * forward.x + toTarget.y * forward.y + toTarget.z * forward.z) / distance;
      if (dot < minDot) return;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = target;
      }
    });

    return bestTarget;
  }

  private applyAreaDamage(source: Player, center: { x: number; y: number; z: number }, radius: number, damage: number, damageType: string): void {
    const radiusSq = radius * radius;
    this.state.players.forEach((target) => {
      if (target.state !== 'alive') return;
      if (target.id === source.id) return;
      if (target.team === source.team) return;

      const dx = target.position.x - center.x;
      const dy = target.position.y - center.y;
      const dz = target.position.z - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq > radiusSq) return;

      const falloff = 1 - Math.sqrt(distSq) / radius * 0.45;
      this.applyDamage(target, Math.max(1, Math.round(damage * falloff)), source.id, damageType);
    });
  }

  private applyDamage(target: Player, rawDamage: number, sourceId: string | null, damageType: string): boolean {
    if (target.state !== 'alive' || rawDamage <= 0) return false;

    const source = sourceId ? this.state.players.get(sourceId) : null;
    if (source && source.id !== target.id && source.team === target.team) return false;

    const now = Date.now();
    if (target.spawnProtectionUntil && now < target.spawnProtectionUntil) return false;
    if (
      this.isDevelopmentMode()
      && (this.devInvulnerablePlayers.has(target.id) || this.devImmunePlayers.has(target.id))
    ) {
      return false;
    }

    const damage = Math.max(1, Math.round(rawDamage * this.getDamageTakenMultiplier(target)));
    target.health = Math.max(0, target.health - damage);

    if (source && source.id !== target.id) {
      source.ultimateCharge = Math.min(100, source.ultimateCharge + damage / Math.max(1, target.maxHealth) * 12);
      this.recordDamage(target.id, source.id, damage, now);
    }

    this.broadcast('playerDamaged', {
      targetId: target.id,
      damage,
      sourceId,
      damageType,
      newHealth: target.health,
      sourcePosition: source ? this.vec3SchemaToPlain(source.position) : null,
      targetPosition: this.vec3SchemaToPlain(target.position),
      sourceHeroId: source?.heroId || null,
      targetHeroId: target.heroId || null,
    });

    if (target.health <= 0) {
      this.handlePlayerDeath(target, sourceId || '');
      return true;
    }

    return false;
  }

  private recordDamage(targetId: string, sourceId: string, damage: number, timestamp: number): void {
    let history = this.damageHistory.get(targetId);
    if (!history) {
      history = new Map();
      this.damageHistory.set(targetId, history);
    }
    const existing = history.get(sourceId);
    history.set(sourceId, {
      damage: (existing?.damage || 0) + damage,
      timestamp,
    });
  }

  private getDamageTakenMultiplier(player: Player): number {
    let multiplier = 1;

    if (player.abilities.get('sentinel_fortify')?.isActive) {
      multiplier *= 0.5;
    }
    if (player.abilities.get('glacier_frostshield')?.isActive) {
      multiplier *= 0.75;
    }
    if (player.abilities.get('glacier_fortress')?.isActive) {
      multiplier *= 0.5;
    }

    return multiplier;
  }

  private pullTargetTowardSource(target: Player, source: Player, distance: number): void {
    const dx = source.position.x - target.position.x;
    const dz = source.position.z - target.position.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (len <= 0.001) return;

    target.position.x += dx / len * distance;
    target.position.z += dz / len * distance;
  }

  private getActiveSpeedMultiplier(player: Player): number {
    let multiplier = 1;
    if (player.abilities.get('phantom_veil')?.isActive) multiplier *= 1.3;
    if (player.abilities.get('pulse_speedboost')?.isActive) multiplier *= 1.3;
    if (player.abilities.get('pulse_haste')?.isActive) multiplier *= 1.5;
    return multiplier;
  }

  private updateCTFObjectives(now: number): void {
    this.updateCarriedFlagPositions();
    this.checkFlagReturns();

    this.state.players.forEach((player) => {
      if (player.state !== 'alive') return;

      const playerTeam = player.team as Team;
      const enemyTeam = playerTeam === 'red' ? 'blue' : 'red';
      const ownFlag = this.getFlagByTeam(playerTeam);
      const enemyFlag = this.getFlagByTeam(enemyTeam);

      if (!ownFlag.isAtBase && !ownFlag.carrierId && this.distance2D(player.position, ownFlag.position) <= FLAG_PICKUP_RADIUS) {
        this.returnFlagToBase(playerTeam, player.id);
        player.flagReturns++;
        player.ultimateCharge = Math.min(100, player.ultimateCharge + 10);
      }

      if (!player.hasFlag && !enemyFlag.carrierId && this.distance2D(player.position, enemyFlag.position) <= FLAG_PICKUP_RADIUS) {
        enemyFlag.carrierId = player.id;
        enemyFlag.isAtBase = false;
        enemyFlag.droppedAt = 0;
        player.hasFlag = true;
        this.broadcast('flagPickup', {
          team: enemyTeam,
          playerId: player.id,
          position: this.vec3SchemaToPlain(player.position),
          timestamp: now,
        });
      }

      if (player.hasFlag && ownFlag.isAtBase && this.distance2D(player.position, ownFlag.basePosition) <= FLAG_CAPTURE_RADIUS) {
        this.captureFlag(player, enemyTeam, now);
      }
    });
  }

  private updateCarriedFlagPositions(): void {
    for (const team of ['red', 'blue'] as const) {
      const flag = this.getFlagByTeam(team);
      if (!flag.carrierId) continue;
      const carrier = this.state.players.get(flag.carrierId);
      if (!carrier || carrier.state !== 'alive') {
        flag.carrierId = '';
        continue;
      }
      flag.position.x = carrier.position.x;
      flag.position.y = carrier.position.y + 1.4;
      flag.position.z = carrier.position.z;
    }
  }

  private captureFlag(player: Player, capturedTeam: Team, now: number): void {
    const flag = this.getFlagByTeam(capturedTeam);
    flag.position.x = flag.basePosition.x;
    flag.position.y = flag.basePosition.y;
    flag.position.z = flag.basePosition.z;
    flag.carrierId = '';
    flag.isAtBase = true;
    flag.droppedAt = 0;

    player.hasFlag = false;
    player.flagCaptures++;
    player.ultimateCharge = Math.min(100, player.ultimateCharge + ULTIMATE_CHARGE_PER_CAPTURE);

    if (player.team === 'red') {
      this.state.redTeam.score++;
    } else {
      this.state.blueTeam.score++;
    }

    this.broadcast('flagCapture', {
      team: capturedTeam,
      playerId: player.id,
      position: this.vec3SchemaToPlain(player.position),
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      timestamp: now,
    });

    if (this.state.redTeam.score >= this.config.scoreToWin || this.state.blueTeam.score >= this.config.scoreToWin) {
      this.endRound();
    } else {
      this.returnFlagToBase(capturedTeam, player.id, false);
    }
  }

  private returnFlagToBase(team: Team, playerId = '', broadcast = true): void {
    const flag = this.getFlagByTeam(team);
    flag.position.x = flag.basePosition.x;
    flag.position.y = flag.basePosition.y;
    flag.position.z = flag.basePosition.z;
    flag.carrierId = '';
    flag.isAtBase = true;
    flag.droppedAt = 0;

    if (broadcast) {
      this.broadcast('flagReturn', {
        team,
        playerId,
        position: this.vec3SchemaToPlain(flag.position),
        timestamp: Date.now(),
      });
    }
  }

  private updateBots(now: number, dt: number): void {
    this.botBrains.forEach((brain, botId) => {
      const bot = this.state.players.get(botId);
      if (!bot?.isBot) {
        this.botBrains.delete(botId);
        return;
      }

      if (this.state.phase === 'hero_select' && bot.state === 'selecting') {
        let changedSelectionState = false;
        if (!bot.heroId) {
          this.setPlayerHero(bot, this.selectRandomBotHero());
          changedSelectionState = true;
        }
        if (!bot.isReady) {
          bot.isReady = true;
          changedSelectionState = true;
        }
        brain.intent = 'selecting';
        if (changedSelectionState) {
          this.checkPhaseTransition();
        }
      }

      if (this.state.phase !== 'playing' && this.state.phase !== 'countdown') {
        return;
      }

      if (bot.state !== 'alive') {
        bot.lastInput = this.createEmptyBotInput(bot, now);
        brain.intent = bot.state === 'dead' ? 'respawning' : brain.intent;
        return;
      }

      const botInput = this.createBotInput(bot, brain, now, dt);
      bot.lastInput = botInput;
      bot.lookYaw = botInput.lookYaw;
      bot.lookPitch = botInput.lookPitch;
      this.processPlayerInput(bot, botInput);
    });
  }

  private createBotInput(bot: Player, brain: BotBrain, now: number, dt: number): PlayerInput {
    const blackboard = this.getBotBlackboard(bot);
    if (now >= brain.nextThinkAt) {
      brain.intent = this.chooseBotIntent(bot, blackboard);
      brain.nextThinkAt = now + BOT_THINK_INTERVAL_MS;

      const moved = this.distance2D(bot.position, brain.lastPosition);
      brain.stuckTime = moved < 0.08 ? brain.stuckTime + BOT_THINK_INTERVAL_MS / 1000 : 0;
      brain.lastPosition = { x: bot.position.x, y: bot.position.y, z: bot.position.z };
      if (brain.stuckTime > 0.9) {
        brain.strafeDirection *= -1;
        brain.reverseUntil = now + 500;
        brain.stuckTime = 0;
      }
    }

    const movementTarget = this.getBotMovementTarget(bot, brain.intent, blackboard);
    const aimTarget = blackboard.nearestEnemy || blackboard.enemyCarrier;
    const targetForLook = aimTarget || movementTarget || this.getEnemyFlagPosition(bot.team as Team);
    const yawPitch = this.getYawPitchToward(bot, targetForLook);
    const enemyDistance = aimTarget ? this.distance3D(bot.position, aimTarget.position) : Infinity;
    const shouldFight = Boolean(aimTarget && enemyDistance <= this.getBotAttackRange(bot));
    const isLongMove = movementTarget ? this.distance2D(bot.position, movementTarget) > 9 : false;
    const recovering = now < brain.reverseUntil;

    const input = this.createEmptyBotInput(bot, now);
    input.lookYaw = yawPitch.yaw;
    input.lookPitch = shouldFight ? yawPitch.pitch : 0;
    input.moveForward = !recovering;
    input.moveBackward = recovering;
    input.moveLeft = recovering && brain.strafeDirection < 0;
    input.moveRight = recovering && brain.strafeDirection > 0;
    input.sprint = isLongMove || bot.hasFlag || brain.intent !== 'fight_enemy';
    input.jump = recovering || brain.stuckTime > 0.45;
    input.crouch = input.sprint && isLongMove && !shouldFight;
    input.primaryFire = shouldFight;
    input.secondaryFire = shouldFight && enemyDistance <= this.getBotSecondaryRange(bot) && now % 1500 < BOT_THINK_INTERVAL_MS;

    this.applyBotAbilityHeuristics(bot, input, brain.intent, enemyDistance, blackboard, now);

    if (dt <= 0) {
      input.moveForward = false;
    }

    return input;
  }

  private applyBotAbilityHeuristics(
    bot: Player,
    input: PlayerInput,
    intent: BotIntent,
    enemyDistance: number,
    blackboard: BotBlackboard,
    now: number
  ): void {
    const heroId = bot.heroId as HeroId;
    const objectiveIntent = intent === 'seek_enemy_flag' || intent === 'carry_flag_home' || intent === 'return_friendly_flag';
    const underPressure = enemyDistance < 12 || bot.health / Math.max(1, bot.maxHealth) < 0.45;
    const pulseAbility = now % 1200 < BOT_THINK_INTERVAL_MS;
    const pulseUltimate = now % 1800 < BOT_THINK_INTERVAL_MS;

    switch (heroId) {
      case 'phantom':
        input.ability1 = pulseAbility && (objectiveIntent || enemyDistance < 16);
        input.ability2 = pulseAbility && underPressure && enemyDistance < 20;
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (bot.hasFlag || underPressure);
        break;
      case 'hookshot':
        input.ability1 = pulseAbility && (objectiveIntent || enemyDistance < 24);
        input.ability2 = pulseAbility && enemyDistance < 28;
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (objectiveIntent || enemyDistance < 12);
        break;
      case 'blaze':
        input.ability1 = enemyDistance < BLAZE_FLAMETHROWER_RANGE;
        input.ability2 = pulseAbility && (underPressure || intent === 'retreat_or_reposition');
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (blackboard.nearbyEnemyCount >= 2 || objectiveIntent);
        break;
      case 'glacier':
        input.ability1 = pulseAbility && (objectiveIntent || input.jump);
        input.ability2 = pulseAbility && underPressure;
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (underPressure || objectiveIntent);
        break;
      case 'pulse':
        input.ability1 = pulseAbility && (objectiveIntent || Boolean(blackboard.nearestAlly));
        input.ability2 = pulseAbility && (objectiveIntent || enemyDistance < 14);
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (bot.hasFlag || blackboard.nearbyAllyCount >= 1);
        break;
      case 'sentinel':
        input.ability1 = pulseAbility && (underPressure || intent === 'return_friendly_flag');
        input.ability2 = pulseAbility && (enemyDistance < 18 || intent === 'chase_enemy_carrier');
        input.ultimate = pulseUltimate && bot.ultimateCharge >= 100 && (underPressure || intent === 'return_friendly_flag');
        break;
    }
  }

  private getBotBlackboard(bot: Player): BotBlackboard {
    const botTeam = bot.team as Team;
    const enemyTeam = botTeam === 'red' ? 'blue' : 'red';
    let nearestEnemy: Player | null = null;
    let nearestEnemyDistance = Infinity;
    let nearestAlly: Player | null = null;
    let nearestAllyDistance = Infinity;
    let enemyCarrier: Player | null = null;
    let alliedCarrier: Player | null = null;
    let nearbyEnemyCount = 0;
    let nearbyAllyCount = 0;

    this.state.players.forEach((candidate) => {
      if (candidate.id === bot.id || candidate.state !== 'alive') return;

      const distance = this.distance3D(bot.position, candidate.position);
      if (candidate.team === bot.team) {
        if (distance < nearestAllyDistance) {
          nearestAlly = candidate;
          nearestAllyDistance = distance;
        }
        if (candidate.hasFlag) {
          alliedCarrier = candidate;
        }
        if (distance <= 16) nearbyAllyCount++;
      } else {
        if (distance < nearestEnemyDistance) {
          nearestEnemy = candidate;
          nearestEnemyDistance = distance;
        }
        if (candidate.hasFlag) {
          enemyCarrier = candidate;
        }
        if (distance <= 16) nearbyEnemyCount++;
      }
    });

    const ownFlag = this.getFlagByTeam(botTeam);
    const enemyFlag = this.getFlagByTeam(enemyTeam);

    return {
      nearestEnemy,
      enemyCarrier,
      nearestAlly,
      alliedCarrier,
      droppedFriendlyFlag: !ownFlag.isAtBase && !ownFlag.carrierId ? this.vec3SchemaToPlain(ownFlag.position) : null,
      enemyFlagPosition: enemyFlag.carrierId
        ? this.vec3SchemaToPlain(this.state.players.get(enemyFlag.carrierId)?.position || enemyFlag.position)
        : this.vec3SchemaToPlain(enemyFlag.position),
      ownBasePosition: this.vec3SchemaToPlain(ownFlag.basePosition),
      nearbyEnemyCount,
      nearbyAllyCount,
    };
  }

  private chooseBotIntent(bot: Player, blackboard: BotBlackboard): BotIntent {
    if (bot.state === 'dead') return 'respawning';
    if (!bot.heroId || this.state.phase === 'hero_select') return 'selecting';
    if (bot.health / Math.max(1, bot.maxHealth) < 0.28) return 'retreat_or_reposition';
    if (bot.hasFlag) return 'carry_flag_home';
    if (blackboard.enemyCarrier) return 'chase_enemy_carrier';
    if (blackboard.droppedFriendlyFlag) return 'return_friendly_flag';
    if (blackboard.nearestEnemy && this.distance3D(bot.position, blackboard.nearestEnemy.position) <= 18) return 'fight_enemy';
    if (blackboard.alliedCarrier) return 'defend_carrier';
    return 'seek_enemy_flag';
  }

  private getBotMovementTarget(bot: Player, intent: BotIntent, blackboard: BotBlackboard): { x: number; y: number; z: number } {
    switch (intent) {
      case 'carry_flag_home':
      case 'retreat_or_reposition':
        return blackboard.ownBasePosition;
      case 'return_friendly_flag':
        return blackboard.droppedFriendlyFlag || blackboard.ownBasePosition;
      case 'defend_carrier':
        return this.vec3SchemaToPlain(blackboard.alliedCarrier?.position || bot.position);
      case 'chase_enemy_carrier':
        return this.vec3SchemaToPlain(blackboard.enemyCarrier?.position || bot.position);
      case 'fight_enemy':
        return this.vec3SchemaToPlain(blackboard.nearestEnemy?.position || bot.position);
      case 'seek_enemy_flag':
      case 'selecting':
      case 'respawning':
      default:
        return blackboard.enemyFlagPosition;
    }
  }

  private getEnemyFlagPosition(team: Team): { x: number; y: number; z: number } {
    const enemyTeam = team === 'red' ? 'blue' : 'red';
    return this.vec3SchemaToPlain(this.getFlagByTeam(enemyTeam).position);
  }

  private getBotAttackRange(bot: Player): number {
    const heroId = bot.heroId as HeroId;
    return PRIMARY_ATTACKS[heroId]?.range ?? 18;
  }

  private getBotSecondaryRange(bot: Player): number {
    const heroId = bot.heroId as HeroId;
    return SECONDARY_ATTACKS[heroId]?.range ?? 0;
  }

  private getYawPitchToward(source: Player, target: Player | { x: number; y: number; z: number }): { yaw: number; pitch: number } {
    const targetPosition = 'position' in target ? target.position : target;
    const dx = targetPosition.x - source.position.x;
    const dy = targetPosition.y + ('position' in target ? 0.9 : 0) - (source.position.y + 1.2);
    const dz = targetPosition.z - source.position.z;
    const horizontal = Math.sqrt(dx * dx + dz * dz);
    return {
      yaw: Math.atan2(-dx, -dz),
      pitch: Math.max(-0.8, Math.min(0.8, Math.atan2(dy, horizontal))),
    };
  }

  private createEmptyBotInput(bot: Player, now: number): PlayerInput {
    return {
      tick: this.state.tick,
      moveForward: false,
      moveBackward: false,
      moveLeft: false,
      moveRight: false,
      jump: false,
      crouch: false,
      sprint: false,
      primaryFire: false,
      secondaryFire: false,
      ability1: false,
      ability2: false,
      ultimate: false,
      interact: false,
      lookYaw: bot.lookYaw,
      lookPitch: bot.lookPitch,
      timestamp: now,
    };
  }

  private getFlagByTeam(team: Team) {
    return team === 'red' ? this.state.redTeam.flag : this.state.blueTeam.flag;
  }

  private getFlagSync(team: Team) {
    const flag = this.getFlagByTeam(team);
    return {
      position: this.vec3SchemaToPlain(flag.position),
      carrierId: flag.carrierId || null,
      isAtBase: flag.isAtBase,
    };
  }

  private vec3SchemaToPlain(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    return { x: position.x, y: position.y, z: position.z };
  }

  private distance2D(a: { x: number; z: number }, b: { x: number; z: number }): number {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  private distance3D(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  private handleHeroSelect(client: Client, heroId: HeroId) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    const isSelectionPhase = this.state.phase === 'hero_select' || this.state.phase === 'waiting';
    const isActiveDevRoom = this.isDevelopmentMode()
      && (this.state.phase === 'countdown' || this.state.phase === 'playing' || this.state.phase === 'round_end');

    if (!isSelectionPhase && !isActiveDevRoom) return;

    if (!this.setPlayerHero(player, heroId)) {
      if (this.isDevelopmentMode()) {
        client.send('devCommandError', { message: `Invalid hero: ${heroId}` });
      }
      return;
    }

    if (isActiveDevRoom) {
      client.send('devHeroChanged', {
        heroId,
        health: player.health,
        maxHealth: player.maxHealth,
      });
    }
  }

  private handleDevSetHero(client: Client, heroId: HeroId) {
    if (!this.isDevelopmentMode()) {
      client.send('devCommandError', { message: 'Developer commands are disabled' });
      return;
    }

    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (!this.setPlayerHero(player, heroId)) {
      client.send('devCommandError', { message: `Invalid hero: ${heroId}` });
      return;
    }

    client.send('devHeroChanged', {
      heroId,
      health: player.health,
      maxHealth: player.maxHealth,
    });
  }

  private setPlayerHero(player: Player, heroId: HeroId): boolean {
    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) return false;

    player.heroId = heroId;
    player.maxHealth = heroDef.stats.maxHealth;
    player.health = player.maxHealth;
    player.ultimateCharge = 0;
    this.disablePlayerSkills(player);
    if (player.lastInput) {
      player.lastInput = {
        ...player.lastInput,
        primaryFire: false,
        secondaryFire: false,
        ability1: false,
        ability2: false,
        ultimate: false,
      };
    }

    if (heroId === 'blaze') {
      player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
    }

    // Initialize abilities for this hero
    initializePlayerAbilities(player, heroId);

    console.log(`${player.name} selected ${heroDef.name}`);
    return true;
  }

  private selectRandomBotHero(): HeroId {
    return ALL_HERO_IDS[Math.floor(Math.random() * ALL_HERO_IDS.length)] ?? 'phantom';
  }

  private isDevelopmentMode(): boolean {
    return process.env.NODE_ENV !== 'production';
  }

  private handleSetDevFly(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) return;

    if (enabled) {
      this.devInvulnerablePlayers.add(client.sessionId);
    } else {
      this.devInvulnerablePlayers.delete(client.sessionId);
    }
  }

  private handleSetDevImmune(client: Client, enabled: boolean): void {
    if (!this.isDevelopmentMode()) return;

    if (enabled) {
      this.devImmunePlayers.add(client.sessionId);
    } else {
      this.devImmunePlayers.delete(client.sessionId);
    }
  }

  private refreshMapManifest(): void {
    this.mapManifest = generateProceduralVoxelMap(this.state.mapSeed);
    this.mapChunkLookup.clear();
    for (const chunk of this.mapManifest.chunks) {
      this.mapChunkLookup.set(this.getChunkKey(chunk.coord.x, chunk.coord.y, chunk.coord.z), chunk);
    }
  }

  private getMapManifest(): VoxelMapManifest {
    if (!this.mapManifest || this.mapManifest.seed !== this.state.mapSeed) {
      this.refreshMapManifest();
    }
    return this.mapManifest!;
  }

  private getChunkKey(x: number, y: number, z: number): string {
    return `${x}:${y}:${z}`;
  }

  private worldToGrid(value: number, origin: number, voxelSize: number): number {
    return Math.floor((value - origin) / voxelSize);
  }

  private getBlockAtWorld(position: { x: number; y: number; z: number }): number {
    const manifest = this.getMapManifest();
    const gx = this.worldToGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
    const gy = this.worldToGrid(position.y, manifest.origin.y, manifest.voxelSize.y);
    const gz = this.worldToGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

    if (gx < 0 || gx >= manifest.size.x || gy < 0 || gy >= manifest.size.y || gz < 0 || gz >= manifest.size.z) {
      return 0;
    }

    const cx = Math.floor(gx / manifest.chunkSize.x);
    const cy = Math.floor(gy / manifest.chunkSize.y);
    const cz = Math.floor(gz / manifest.chunkSize.z);
    const chunk = this.mapChunkLookup.get(this.getChunkKey(cx, cy, cz));
    if (!chunk) return 0;

    const lx = gx - cx * manifest.chunkSize.x;
    const ly = gy - cy * manifest.chunkSize.y;
    const lz = gz - cz * manifest.chunkSize.z;
    return chunk.blocks[lx + chunk.size.x * (lz + chunk.size.z * ly)] || 0;
  }

  private getProceduralGroundY(position: { x: number; y: number; z: number }): number | null {
    const manifest = this.getMapManifest();
    const gx = this.worldToGrid(position.x, manifest.origin.x, manifest.voxelSize.x);
    const gz = this.worldToGrid(position.z, manifest.origin.z, manifest.voxelSize.z);

    if (gx < 0 || gx >= manifest.size.x || gz < 0 || gz >= manifest.size.z) {
      return null;
    }

    const startY = Math.max(0, Math.min(
      manifest.size.y - 1,
      this.worldToGrid(position.y - 0.15, manifest.origin.y, manifest.voxelSize.y)
    ));

    for (let gy = startY; gy >= 0; gy--) {
      const block = this.getBlockAtWorld({
        x: position.x,
        y: manifest.origin.y + (gy + 0.5) * manifest.voxelSize.y,
        z: position.z,
      });
      if (isSolidBlock(block)) {
        return manifest.origin.y + (gy + 1) * manifest.voxelSize.y;
      }
    }

    return null;
  }

  private clampToPlayableMap(position: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    const manifest = this.getMapManifest();
    const clampedBoundary = clampToBoundaryPolygon(position.x, position.z, manifest.boundary);

    return {
      x: Math.max(MAP_MIN_X, Math.min(MAP_MAX_X, clampedBoundary.x)),
      y: Math.max(-20, Math.min(120, position.y)),
      z: Math.max(MAP_MIN_Z, Math.min(MAP_MAX_Z, clampedBoundary.z)),
    };
  }

  private isBotSpaceBlocked(position: { x: number; y: number; z: number }): boolean {
    const manifest = this.getMapManifest();
    if (!isInsideBoundaryPolygon(position.x, position.z, manifest.boundary)) {
      return true;
    }

    const radius = 0.45;
    const diagonal = radius * 0.707;
    const offsets = [
      { x: 0, z: 0 },
      { x: radius, z: 0 },
      { x: -radius, z: 0 },
      { x: 0, z: radius },
      { x: 0, z: -radius },
      { x: diagonal, z: diagonal },
      { x: diagonal, z: -diagonal },
      { x: -diagonal, z: diagonal },
      { x: -diagonal, z: -diagonal },
    ];
    const ySamples = [position.y - 0.35, position.y + 0.15, position.y + 0.65];

    for (const y of ySamples) {
      for (const offset of offsets) {
        if (isSolidBlock(this.getBlockAtWorld({
          x: position.x + offset.x,
          y,
          z: position.z + offset.z,
        }))) {
          return true;
        }
      }
    }

    return false;
  }

  private isBotPathBlocked(
    previous: { x: number; y: number; z: number },
    next: { x: number; y: number; z: number }
  ): boolean {
    const dx = next.x - previous.x;
    const dz = next.z - previous.z;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const steps = Math.max(1, Math.ceil(distance / 0.25));

    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (this.isBotSpaceBlocked({
        x: previous.x + dx * t,
        y: previous.y + (next.y - previous.y) * t,
        z: previous.z + dz * t,
      })) {
        return true;
      }
    }

    return false;
  }

  private resolveBotCollision(
    previous: { x: number; y: number; z: number },
    desired: { x: number; y: number; z: number }
  ): { position: { x: number; y: number; z: number }; blockedX: boolean; blockedZ: boolean } {
    const manifest = this.getMapManifest();
    const constrained = constrainToBoundaryPolygon(previous.x, previous.z, desired.x, desired.z, manifest.boundary);
    const next = { ...desired, x: constrained.x, z: constrained.z };

    if (!this.isBotPathBlocked(previous, next)) {
      return { position: next, blockedX: false, blockedZ: false };
    }

    const xOnly = { ...next, z: previous.z };
    if (!this.isBotPathBlocked(previous, xOnly)) {
      return { position: xOnly, blockedX: false, blockedZ: true };
    }

    const zOnly = { ...next, x: previous.x };
    if (!this.isBotPathBlocked(previous, zOnly)) {
      return { position: zOnly, blockedX: true, blockedZ: false };
    }

    return { position: { ...previous, y: next.y }, blockedX: true, blockedZ: true };
  }

  private isFiniteVec3(position: { x: number; y: number; z: number }): boolean {
    return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
  }

  private disablePlayerSkills(player: Player) {
    player.abilities.forEach(ability => {
      ability.isActive = false;
    });
    player.movement.isGrappling = false;
    player.movement.isJetpacking = false;
    player.movement.isGliding = false;
    player.movement.isSliding = false;
    player.movement.slideTimeRemaining = 0;
  }

  private handleTeamSelect(client: Client, team: Team) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Check team balance
    const teamCount = this.getTeamCount(team);
    const otherTeamCount = this.getTeamCount(team === 'red' ? 'blue' : 'red');

    if (teamCount > otherTeamCount) {
      // Team is full
      return;
    }

    player.team = team;
    
    this.placePlayerAtSpawn(player);
  }

  private handleReady(client: Client, ready: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    console.log(`${player.name} ready: ${ready}, hero: ${player.heroId}`);
    player.isReady = ready;
    this.checkPhaseTransition();
  }

  private handleChat(client: Client, message: string, teamOnly: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    // Filter out empty messages
    if (!message.trim()) return;

    // Limit message length
    const sanitizedMessage = message.substring(0, 200);

    if (teamOnly) {
      // Send to team only
      this.state.players.forEach((p, sessionId) => {
        if (p.team === player.team) {
          this.clients.find(c => c.sessionId === sessionId)?.send('chat', {
            playerId: client.sessionId,
            playerName: player.name,
            message: sanitizedMessage,
            teamOnly: true,
            timestamp: Date.now(),
          });
        }
      });
    } else {
      this.broadcast('chat', {
        playerId: client.sessionId,
        playerName: player.name,
        message: sanitizedMessage,
        teamOnly: false,
        timestamp: Date.now(),
      });
    }
  }

  private checkPhaseTransition() {
    const playerCount = this.state.players.size;
    console.log(`checkPhaseTransition: phase=${this.state.phase}, players=${playerCount}`);

    switch (this.state.phase) {
      case 'waiting':
        // Need at least 2 players to start (or 1 for testing)
        if (playerCount >= 1) {
          this.startHeroSelect();
        }
        break;

      case 'hero_select':
        // Check if all players are ready
        let allReady = true;
        let readyCount = 0;
        this.state.players.forEach(p => {
          console.log(`  Player ${p.name}: heroId=${p.heroId}, isReady=${p.isReady}`);
          if (!p.heroId || !p.isReady) {
            allReady = false;
          } else {
            readyCount++;
          }
        });

        console.log(`  allReady=${allReady}, readyCount=${readyCount}/${playerCount}`);

        if (allReady && playerCount >= 1) {
          console.log('All players ready, starting countdown!');
          this.startCountdown();
        }

        // Check timeout
        if (this.state.phaseEndTime && Date.now() >= this.state.phaseEndTime) {
          this.state.players.forEach(p => {
            if (!p.heroId) {
              this.setPlayerHero(p, p.isBot ? this.selectRandomBotHero() : 'phantom');
            }
          });
          this.startCountdown();
        }
        break;
    }
  }

  private startHeroSelect() {
    this.state.phase = 'hero_select';
    this.state.phaseEndTime = Date.now() + this.config.heroSelectTimeSeconds * 1000;

    this.state.players.forEach(player => {
      if (player.isBot) {
        player.state = 'selecting';
        player.heroId = '';
        player.isReady = false;
        player.abilities.clear();
        this.disablePlayerSkills(player);
      }
    });

    this.broadcast('phaseChange', {
      phase: 'hero_select',
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
    });
  }

  private startCountdown() {
    this.state.phase = 'countdown';
    this.state.phaseEndTime = Date.now() + this.config.countdownSeconds * 1000;

    // Set all players to spawning
    this.state.players.forEach(player => {
      player.state = 'spawning';
      this.placePlayerAtSpawn(player);
    });

    this.broadcast('phaseChange', {
      phase: 'countdown',
      endTime: this.state.phaseEndTime,
      mapSeed: this.state.mapSeed,
    });
    this.broadcastPlayerStates();
  }

  private startPlaying() {
    this.state.phase = 'playing';
    this.state.roundStartTime = Date.now();
    this.state.roundTimeRemaining = this.config.roundTimeSeconds;
    this.state.phaseEndTime = 0;

    // Set all players to alive
    this.state.players.forEach(player => {
      player.state = 'alive';
      player.health = player.maxHealth;
      player.spawnProtectionUntil = Date.now() + this.config.spawnProtectionSeconds * 1000;
      this.placePlayerAtSpawn(player);
      if (player.heroId === 'blaze') {
        player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
        player.movement.isJetpacking = false;
      }
      
      // Reset ability cooldowns
      resetAbilityCooldowns(player);
    });

    // Reset flags
    this.resetFlags();

    this.broadcast('phaseChange', {
      phase: 'playing',
      endTime: Date.now() + this.config.roundTimeSeconds * 1000,
      mapSeed: this.state.mapSeed,
    });
    this.broadcastPlayerStates();
  }

  private endRound() {
    this.state.phase = 'round_end';
    this.state.phaseEndTime = Date.now() + 5000; // 5 second intermission

    const winningTeam = this.state.redTeam.score > this.state.blueTeam.score ? 'red' : 
                        this.state.blueTeam.score > this.state.redTeam.score ? 'blue' : null;

    this.broadcast('roundEnd', {
      winningTeam,
      redScore: this.state.redTeam.score,
      blueScore: this.state.blueTeam.score,
      nextPhase: this.state.redTeam.score >= this.config.scoreToWin || 
                 this.state.blueTeam.score >= this.config.scoreToWin ? 'game_end' : 'hero_select',
    });
  }

  private endGame() {
    this.state.phase = 'game_end';

    const winningTeam = this.state.redTeam.score > this.state.blueTeam.score ? 'red' : 'blue';

    this.broadcast('gameEnd', {
      winningTeam,
      finalScore: {
        red: this.state.redTeam.score,
        blue: this.state.blueTeam.score,
      },
    });

    // Reset room after delay
    setTimeout(() => {
      this.state.phase = 'waiting';
      this.state.mapSeed = createRandomSeed();
      this.refreshMapManifest();
      this.state.redTeam.score = 0;
      this.state.blueTeam.score = 0;
      this.resetFlags();
      
      this.state.players.forEach(player => {
        player.state = 'selecting';
        player.heroId = '';
        player.isReady = false;
        player.kills = 0;
        player.deaths = 0;
        player.assists = 0;
        player.flagCaptures = 0;
        player.flagReturns = 0;
        player.ultimateCharge = 0;
        player.abilities.clear();
      });
    }, 10000);
  }

  private resetFlags() {
    const positions = this.getMapManifest();

    this.state.redTeam.flag.position.x = positions.flagZones.red.x;
    this.state.redTeam.flag.position.y = positions.flagZones.red.y;
    this.state.redTeam.flag.position.z = positions.flagZones.red.z;
    this.state.redTeam.flag.isAtBase = true;
    this.state.redTeam.flag.carrierId = '';
    this.state.redTeam.flag.droppedAt = 0;

    this.state.redTeam.flag.basePosition.x = positions.flagZones.red.x;
    this.state.redTeam.flag.basePosition.y = positions.flagZones.red.y;
    this.state.redTeam.flag.basePosition.z = positions.flagZones.red.z;

    this.state.blueTeam.flag.position.x = positions.flagZones.blue.x;
    this.state.blueTeam.flag.position.y = positions.flagZones.blue.y;
    this.state.blueTeam.flag.position.z = positions.flagZones.blue.z;
    this.state.blueTeam.flag.isAtBase = true;
    this.state.blueTeam.flag.carrierId = '';
    this.state.blueTeam.flag.droppedAt = 0;
    this.state.blueTeam.flag.basePosition.x = positions.flagZones.blue.x;
    this.state.blueTeam.flag.basePosition.y = positions.flagZones.blue.y;
    this.state.blueTeam.flag.basePosition.z = positions.flagZones.blue.z;
  }

  private updateVoidZones(now: number) {
    // Remove expired void zones
    this.voidZones = this.voidZones.filter(zone => {
      const elapsed = (now - zone.startTime) / 1000;
      if (elapsed >= zone.duration) {
        // Broadcast zone expired
        this.broadcast('voidZoneExpired', { id: zone.id });
        return false;
      }
      return true;
    });

    // Apply damage to players in active void zones
    for (const zone of this.voidZones) {
      this.state.players.forEach((player) => {
        // Skip dead players, same team, and the zone owner
        if (player.state !== 'alive') return;
        if (player.team === zone.ownerTeam) return;
        if (player.id === zone.ownerId) return;

        // Check spawn protection
        if (player.spawnProtectionUntil && now < player.spawnProtectionUntil) return;

        // Check if player is in the zone
        const dx = player.position.x - zone.position.x;
        const dz = player.position.z - zone.position.z;
        const distSq = dx * dx + dz * dz;
        
        if (distSq <= zone.radius * zone.radius) {
          // Check damage interval
          const lastDamage = zone.lastDamageTick.get(player.id) || 0;
          if (now - lastDamage >= VOID_ZONE_DAMAGE_INTERVAL) {
            zone.lastDamageTick.set(player.id, now);
            this.applyDamage(player, zone.damage, zone.ownerId, 'void_zone');
          }
        }
      });
    }
  }

  private updateBlazeFlamethrowers(now: number, dt: number) {
    this.state.players.forEach((player) => {
      if (player.heroId !== 'blaze') return;

      player.movement.isJetpacking = false;

      const isFiring = player.state === 'alive' && Boolean(player.lastInput?.ability1);
      if (isFiring && player.movement.jetpackFuel > 0) {
        player.movement.jetpackFuel = Math.max(
          0,
          player.movement.jetpackFuel - BLAZE_FLAMETHROWER_FUEL_DRAIN * dt
        );
        this.applyFlamethrowerDamage(player, now);
        return;
      }

      if (player.movement.jetpackFuel < BLAZE_FLAMETHROWER_MAX_FUEL) {
        player.movement.jetpackFuel = Math.min(
          BLAZE_FLAMETHROWER_MAX_FUEL,
          player.movement.jetpackFuel + BLAZE_FLAMETHROWER_FUEL_REGEN * dt
        );
      }
    });
  }

  private applyFlamethrowerDamage(source: Player, now: number) {
    const pitch = source.lookPitch;
    const cosPitch = Math.cos(pitch);
    const forward = {
      x: -Math.sin(source.lookYaw) * cosPitch,
      y: Math.sin(pitch),
      z: -Math.cos(source.lookYaw) * cosPitch,
    };
    const right = {
      x: Math.cos(source.lookYaw),
      y: 0,
      z: -Math.sin(source.lookYaw),
    };
    const horizontalForward = {
      x: -Math.sin(source.lookYaw),
      z: -Math.cos(source.lookYaw),
    };

    const origin = {
      x:
        source.position.x +
        horizontalForward.x * BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET +
        right.x * BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
      y: source.position.y + BLAZE_FLAMETHROWER_SOCKET_HAND_HEIGHT,
      z:
        source.position.z +
        horizontalForward.z * BLAZE_FLAMETHROWER_SOCKET_FORWARD_OFFSET +
        right.z * BLAZE_FLAMETHROWER_SOCKET_SIDE_OFFSET,
    };

    const rangeSq = BLAZE_FLAMETHROWER_RANGE * BLAZE_FLAMETHROWER_RANGE;

    this.state.players.forEach((target) => {
      if (target.state !== 'alive') return;
      if (target.id === source.id) return;
      if (target.team === source.team) return;
      if (target.spawnProtectionUntil && now < target.spawnProtectionUntil) return;

      const toTarget = {
        x: target.position.x - origin.x,
        y: target.position.y + 0.9 - origin.y,
        z: target.position.z - origin.z,
      };
      const distSq = toTarget.x * toTarget.x + toTarget.y * toTarget.y + toTarget.z * toTarget.z;
      if (distSq > rangeSq || distSq <= 0.0001) return;

      const distance = Math.sqrt(distSq);
      const dot = (
        toTarget.x * forward.x +
        toTarget.y * forward.y +
        toTarget.z * forward.z
      ) / distance;
      if (dot < BLAZE_FLAMETHROWER_CONE_DOT) return;

      const tickKey = `${source.id}:${target.id}`;
      const lastDamage = this.flamethrowerLastDamageTick.get(tickKey) || 0;
      if (now - lastDamage < BLAZE_FLAMETHROWER_DAMAGE_INTERVAL) return;

      const falloff = 1 - (distance / BLAZE_FLAMETHROWER_RANGE) * 0.35;
      const damage = Math.max(1, Math.round(BLAZE_FLAMETHROWER_DAMAGE * falloff));
      this.flamethrowerLastDamageTick.set(tickKey, now);
      this.applyDamage(target, damage, source.id, 'flamethrower');
    });
  }

  private handlePlayerDeath(player: Player, killerId: string) {
    if (player.state === 'dead') return;

    const killer = this.state.players.get(killerId);
    
    player.state = 'dead';
    player.health = 0;
    player.deaths++;
    player.respawnTime = Date.now() + this.config.respawnTimeSeconds * 1000;
    
    // Drop flag if carrying
    if (player.hasFlag) {
      this.dropFlag(player);
    }

    if (killer) {
      killer.kills++;
      killer.ultimateCharge = Math.min(100, killer.ultimateCharge + ULTIMATE_CHARGE_PER_KILL);
    }

    const now = Date.now();
    const assistIds: string[] = [];
    const history = this.damageHistory.get(player.id);
    if (history) {
      history.forEach((entry, sourceId) => {
        if (sourceId === killerId) return;
        if (now - entry.timestamp > DAMAGE_HISTORY_WINDOW_MS) return;
        const assister = this.state.players.get(sourceId);
        if (!assister || assister.team === player.team) return;
        assister.assists++;
        assister.ultimateCharge = Math.min(100, assister.ultimateCharge + 8);
        assistIds.push(sourceId);
      });
      this.damageHistory.delete(player.id);
    }

    this.broadcast('playerKilled', {
      victimId: player.id,
      killerId,
      assistIds,
      position: { x: player.position.x, y: player.position.y, z: player.position.z },
    });
  }

  private createVoidZone(position: { x: number; y: number; z: number }, ownerId: string, ownerTeam: 'red' | 'blue') {
    const zone: VoidZone = {
      id: `void_${this.voidZoneIdCounter++}`,
      position: { ...position },
      radius: VOID_ZONE_RADIUS,
      damage: VOID_ZONE_DAMAGE,
      duration: VOID_ZONE_DURATION,
      startTime: Date.now(),
      ownerId,
      ownerTeam,
      lastDamageTick: new Map(),
    };

    this.voidZones.push(zone);

    // Broadcast zone creation to all clients
    this.broadcast('voidZoneCreated', {
      id: zone.id,
      position: zone.position,
      radius: zone.radius,
      duration: zone.duration,
      startTime: zone.startTime,
      ownerId: zone.ownerId,
      ownerTeam: zone.ownerTeam,
    });

    return zone;
  }

  private checkFlagReturns() {
    // Check if flags should auto-return
    const flags = [this.state.redTeam.flag, this.state.blueTeam.flag];
    for (const flag of flags) {
      if (!flag.isAtBase && !flag.carrierId && flag.droppedAt) {
        if (Date.now() - flag.droppedAt >= this.config.flagReturnTimeSeconds * 1000) {
          this.returnFlagToBase(flag.team as Team);
        }
      }
    }
  }

  private dropFlag(player: Player) {
    if (!player.hasFlag) return;

    const enemyTeam = player.team === 'red' ? this.state.blueTeam : this.state.redTeam;
    const flag = enemyTeam.flag;

    flag.position.x = player.position.x;
    flag.position.y = player.position.y;
    flag.position.z = player.position.z;
    flag.carrierId = '';
    flag.droppedAt = Date.now();
    flag.isAtBase = false;

    player.hasFlag = false;

    this.broadcast('flagDrop', {
      team: player.team === 'red' ? 'blue' : 'red',
      playerId: player.id,
      position: { x: flag.position.x, y: flag.position.y, z: flag.position.z },
    });
  }

  private respawnPlayer(player: Player) {
    player.state = 'alive';
    player.health = player.maxHealth;
    player.respawnTime = 0;
    player.spawnProtectionUntil = Date.now() + this.config.spawnProtectionSeconds * 1000;

    this.placePlayerAtSpawn(player);
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    if (player.heroId === 'blaze') {
      player.movement.jetpackFuel = BLAZE_FLAMETHROWER_MAX_FUEL;
      player.movement.isJetpacking = false;
    }

    // Reset ability cooldowns on respawn
    resetAbilityCooldowns(player);
  }

  private updatePhysics() {
    this.state.players.forEach(player => {
      if (player.state !== 'alive' || !player.lastInput) return;

      const input = player.lastInput;
      if (this.isDevelopmentMode() && input.devFly) return;

      const previousPosition = this.vec3SchemaToPlain(player.position);
      const heroId = player.heroId as HeroId;
      const heroStats = getHeroStats(heroId);
      const dt = TICK_INTERVAL_MS / 1000;
      const result = simulateSharedMovement({
        position: this.vec3SchemaToPlain(player.position),
        velocity: this.vec3SchemaToPlain(player.velocity),
        movement: {
          isGrounded: player.movement.isGrounded,
          isSprinting: player.movement.isSprinting,
          isCrouching: player.movement.isCrouching,
          isSliding: player.movement.isSliding,
          slideTimeRemaining: player.movement.slideTimeRemaining,
          isWallRunning: player.movement.isWallRunning,
          wallRunSide: player.movement.wallRunSide === 'left' || player.movement.wallRunSide === 'right'
            ? player.movement.wallRunSide
            : null,
          isGrappling: player.movement.isGrappling,
          grapplePoint: null,
          isJetpacking: player.movement.isJetpacking,
          jetpackFuel: player.movement.jetpackFuel,
          isGliding: player.movement.isGliding,
        },
        heroStats,
        input,
        lookYaw: player.lookYaw,
        deltaTime: dt,
        terrain: this.movementTerrain,
        flagCarrier: player.hasFlag,
        activeSpeedMultiplier: this.getActiveSpeedMultiplier(player),
      });

      let nextPosition = result.position;
      let nextVelocity = result.velocity;
      if (player.isBot || this.spawnedNpcs.has(player.id)) {
        if (this.isBotSpaceBlocked(previousPosition)) {
          this.placePlayerAtSpawn(player);
          return;
        }

        const resolved = this.resolveBotCollision(previousPosition, result.position);
        nextPosition = resolved.position;
        nextVelocity = {
          ...result.velocity,
          x: resolved.blockedX ? 0 : result.velocity.x,
          z: resolved.blockedZ ? 0 : result.velocity.z,
        };
      }

      player.position.x = nextPosition.x;
      player.position.y = nextPosition.y;
      player.position.z = nextPosition.z;
      player.velocity.x = nextVelocity.x;
      player.velocity.y = nextVelocity.y;
      player.velocity.z = nextVelocity.z;
      player.movement.isGrounded = result.movement.isGrounded;
      player.movement.isSprinting = result.movement.isSprinting;
      player.movement.isCrouching = result.movement.isCrouching;
      player.movement.isSliding = result.movement.isSliding;
      player.movement.slideTimeRemaining = result.movement.slideTimeRemaining;
      player.movement.isWallRunning = result.movement.isWallRunning;
      player.movement.wallRunSide = result.movement.wallRunSide || '';
      player.movement.isGrappling = result.movement.isGrappling;
      player.movement.isJetpacking = result.movement.isJetpacking;
      player.movement.jetpackFuel = result.movement.jetpackFuel;
      player.movement.isGliding = result.movement.isGliding;

      if (player.position.y < -10) {
        this.placePlayerAtSpawn(player);
      }
    });
  }

  private assignTeam(preferred?: Team): string {
    const redCount = this.getTeamCount('red');
    const blueCount = this.getTeamCount('blue');

    if (preferred) {
      const preferredCount = preferred === 'red' ? redCount : blueCount;
      const otherCount = preferred === 'red' ? blueCount : redCount;
      
      if (preferredCount <= otherCount) {
        return preferred;
      }
    }

    // Assign to smaller team
    return redCount <= blueCount ? 'red' : 'blue';
  }

  private getTeamCount(team: Team): number {
    let count = 0;
    this.state.players.forEach(p => {
      if (p.team === team) count++;
    });
    return count;
  }

  private getSpawnPosition(team: Team): { x: number; y: number; z: number } {
    const spawnPoints = this.getMapManifest().spawnPoints[team];
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    return {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
    };
  }

  private placePlayerAtSpawn(player: Player): void {
    const spawn = this.getSpawnPosition(player.team as Team);
    player.position.x = spawn.x;
    player.position.y = spawn.y;
    player.position.z = spawn.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;
    this.authoritativePositionUntil.set(player.id, Date.now() + 1200);
  }

  // ===== NPC/BOT HANDLING =====
  
  private handleSpawnNpc(client: Client, data: { heroId: HeroId; team?: Team; position?: { x: number; y: number; z: number }; name?: string }) {
    const { heroId, position, name } = data;
    let { team } = data;
    
    // Validate hero
    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) {
      client.send('npcError', { message: `Invalid hero: ${heroId}` });
      return;
    }

    // If no team specified, spawn on OPPOSITE team of the requesting player
    // This ensures NPCs can be damaged by the spawner
    if (!team) {
      const requestingPlayer = this.state.players.get(client.sessionId);
      if (requestingPlayer) {
        team = requestingPlayer.team === 'red' ? 'blue' : 'red';
        console.log(`NPC team defaulted to ${team} (opposite of ${requestingPlayer.name}'s team)`);
      } else {
        team = 'blue'; // fallback
      }
    }

    // Generate NPC ID and name
    const npcId = `npc_${this.npcIdCounter++}`;
    const npcName = name || `${heroDef.name}_${this.npcIdCounter}`;

    // Create NPC player entity
    const npc = new Player();
    npc.id = npcId;
    npc.name = npcName;
    npc.team = team;
    npc.heroId = heroId;
    npc.state = 'alive';
    npc.isReady = true;
    
    // Set position - use provided position or spawn near requesting player
    if (position) {
      npc.position.x = position.x;
      npc.position.y = position.y;
      npc.position.z = position.z;
    } else {
      // Spawn near the requesting player
      const requestingPlayer = this.state.players.get(client.sessionId);
      if (requestingPlayer) {
        const angle = requestingPlayer.lookYaw + (Math.random() - 0.5) * 0.5;
        const distance = 5 + Math.random() * 5;
        npc.position.x = requestingPlayer.position.x + Math.sin(angle) * distance;
        npc.position.y = requestingPlayer.position.y;
        npc.position.z = requestingPlayer.position.z + Math.cos(angle) * distance;
      } else {
        // Default spawn
        npc.position.x = 0;
        npc.position.y = 5;
        npc.position.z = 0;
      }
    }
    
    // Set health based on hero
    npc.maxHealth = heroDef.stats.maxHealth;
    npc.health = npc.maxHealth;
    npc.ultimateCharge = 0;
    
    // Random look direction
    npc.lookYaw = Math.random() * Math.PI * 2;
    npc.lookPitch = 0;

    // Initialize abilities for this NPC
    initializePlayerAbilities(npc, heroId);

    // Add to game state
    this.state.players.set(npcId, npc);
    this.spawnedNpcs.add(npcId);

    console.log(`NPC spawned: ${npcName} (${heroId}) on ${team} team at (${npc.position.x.toFixed(1)}, ${npc.position.y.toFixed(1)}, ${npc.position.z.toFixed(1)})`);

    // Broadcast NPC spawn to all clients
    this.broadcast('playerJoined', {
      playerId: npcId,
      playerName: npcName,
      team: team,
      heroId: heroId,
      isNpc: true,
      position: {
        x: npc.position.x,
        y: npc.position.y,
        z: npc.position.z,
      },
    });

    // Send confirmation to requesting client
    client.send('npcSpawned', {
      npcId,
      name: npcName,
      heroId,
      team,
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
    });
  }

  private handleDamageNpc(client: Client, data: { npcId: string; damage: number }) {
    const { npcId, damage } = data;
    
    // Find NPC (support partial matching)
    let targetId = npcId;
    if (!this.spawnedNpcs.has(npcId)) {
      for (const id of this.spawnedNpcs) {
        if (id.includes(npcId)) {
          targetId = id;
          break;
        }
      }
    }

    if (!this.spawnedNpcs.has(targetId)) {
      client.send('npcError', { message: `NPC not found: ${npcId}` });
      return;
    }

    const npc = this.state.players.get(targetId);
    if (!npc) {
      this.spawnedNpcs.delete(targetId);
      client.send('npcError', { message: `NPC data not found: ${targetId}` });
      return;
    }

    // Apply damage
    const oldHealth = npc.health;
    npc.health = Math.max(0, npc.health - damage);

    // Broadcast damage event
    this.broadcast('playerDamaged', {
      targetId: targetId,
      damage: damage,
      sourceId: client.sessionId,
      damageType: 'console',
      newHealth: npc.health,
      sourcePosition: this.state.players.get(client.sessionId)
        ? this.vec3SchemaToPlain(this.state.players.get(client.sessionId)!.position)
        : null,
      targetPosition: this.vec3SchemaToPlain(npc.position),
      sourceHeroId: this.state.players.get(client.sessionId)?.heroId || null,
      targetHeroId: npc.heroId || null,
    });

    console.log(`NPC ${npc.name} took ${damage} damage: ${oldHealth} -> ${npc.health}`);

    // Check for death
    if (npc.health <= 0) {
      this.handleNpcDeath(npc, client.sessionId);
    }

    // Send confirmation
    client.send('npcDamaged', {
      npcId: targetId,
      name: npc.name,
      damage,
      health: npc.health,
      maxHealth: npc.maxHealth,
      killed: npc.health <= 0,
    });
  }

  private handleKillNpc(client: Client, data: { npcId: string }) {
    const { npcId } = data;
    
    // Find NPC (support partial matching)
    let targetId = npcId;
    if (!this.spawnedNpcs.has(npcId)) {
      for (const id of this.spawnedNpcs) {
        if (id.includes(npcId)) {
          targetId = id;
          break;
        }
      }
    }

    if (!this.spawnedNpcs.has(targetId)) {
      client.send('npcError', { message: `NPC not found: ${npcId}` });
      return;
    }

    const npc = this.state.players.get(targetId);
    if (!npc) {
      this.spawnedNpcs.delete(targetId);
      return;
    }

    const npcName = npc.name;
    this.handleNpcDeath(npc, client.sessionId);

    client.send('npcKilled', {
      npcId: targetId,
      name: npcName,
    });
  }

  private handleKillAllNpcs(client: Client) {
    const count = this.spawnedNpcs.size;
    
    for (const npcId of this.spawnedNpcs) {
      const npc = this.state.players.get(npcId);
      if (npc) {
        this.handleNpcDeath(npc, client.sessionId);
      }
    }

    client.send('allNpcsKilled', { count });
  }

  private handleNpcDeath(npc: Player, killerId: string) {
    const killer = this.state.players.get(killerId);
    
    // Broadcast kill event
    this.broadcast('playerKilled', {
      victimId: npc.id,
      killerId,
      position: { x: npc.position.x, y: npc.position.y, z: npc.position.z },
      isNpc: true,
    });

    // Give killer credit
    if (killer && !this.spawnedNpcs.has(killerId)) {
      killer.kills++;
      killer.ultimateCharge = Math.min(100, killer.ultimateCharge + 20);
    }

    console.log(`NPC ${npc.name} eliminated by ${killer?.name || killerId}`);

    // Remove NPC from game
    this.state.players.delete(npc.id);
    this.spawnedNpcs.delete(npc.id);

    // Broadcast player left
    this.broadcast('playerLeft', {
      playerId: npc.id,
      isNpc: true,
    });
  }

  // Check if a player ID is an NPC
  isNpc(playerId: string): boolean {
    return this.spawnedNpcs.has(playerId);
  }
}
