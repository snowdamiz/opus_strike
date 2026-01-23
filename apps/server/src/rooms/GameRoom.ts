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
  SCI_FI_CTF_POSITIONS,
} from '@voxel-strike/shared';
import type { 
  HeroId, 
  Team, 
  PlayerInput,
} from '@voxel-strike/shared';

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
}

interface JoinOptions {
  playerName?: string;
  preferredTeam?: Team;
  clientId?: string;
}

// Track last ability press state to detect key press (not hold)
const playerAbilityPressState = new Map<string, { ability1: boolean; ability2: boolean; ultimate: boolean }>();

export class GameRoom extends Room<GameState> {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly config = DEFAULT_GAME_CONFIG;
  private lobbyId: string | null = null;
  private lobbyName: string | null = null;
  private voidZones: VoidZone[] = [];
  private voidZoneIdCounter: number = 0;
  private npcIdCounter: number = 0;
  private spawnedNpcs: Set<string> = new Set(); // Track NPC IDs
  
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

    // Set up tick loop
    this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS);

    // Handle messages
    this.onMessage('input', (client, input: PlayerInput) => {
      this.handleInput(client, input);
    });

    this.onMessage('selectHero', (client, data: { heroId: HeroId }) => {
      this.handleHeroSelect(client, data.heroId);
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

    // NPC/Bot commands for testing
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
        playerAbilityPressState.delete(existingSessionId);
        this.sessionIdToClientId.delete(existingSessionId);
        
        // Broadcast that old player left
        this.broadcast('playerLeft', { playerId: existingSessionId });
      }
      
      // Register this client's ID mapping
      this.clientIdToSessionId.set(options.clientId, client.sessionId);
      this.sessionIdToClientId.set(client.sessionId, options.clientId);
    }

    // Initialize ability press state tracking
    playerAbilityPressState.set(client.sessionId, { ability1: false, ability2: false, ultimate: false });

    // Send existing players to the new client BEFORE adding the new player
    this.state.players.forEach((existingPlayer, id) => {
      client.send('playerJoined', {
        playerId: id,
        playerName: existingPlayer.name,
        team: existingPlayer.team,
        heroId: existingPlayer.heroId,
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

    // Set spawn position
    const spawn = this.getSpawnPosition(player.team as Team);
    player.position.x = spawn.x;
    player.position.y = spawn.y;
    player.position.z = spawn.z;

    this.state.players.set(client.sessionId, player);

    // Broadcast join to all clients (including the new one)
    this.broadcast('playerJoined', {
      playerId: client.sessionId,
      playerName: player.name,
      team: player.team,
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
    playerAbilityPressState.delete(client.sessionId);
    
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

      // Passive ultimate charge (2% per second)
      if (player.ultimateCharge < 100) {
        player.ultimateCharge = Math.min(100, player.ultimateCharge + 2 * dt);
      }

      // Process active abilities (like Phantom Veil)
      updateActiveAbilities(player, now);
    });

    // Check flag returns
    this.checkFlagReturns();

    // Update void zones (damage enemies inside)
    this.updateVoidZones(now);

    // Update physics simulation (simplified)
    this.updatePhysics();

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
      });
    });

    if (playerStates.length > 0) {
      this.broadcast('playerStates', { players: playerStates });
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

    // Use client-reported position for now (trust client for smoother sync)
    if (input.position) {
      player.position.x = Math.max(-95, Math.min(95, input.position.x));
      player.position.y = Math.max(-10, Math.min(100, input.position.y));
      player.position.z = Math.max(-95, Math.min(95, input.position.z));
    }
    if (input.velocity) {
      player.velocity.x = input.velocity.x;
      player.velocity.y = input.velocity.y;
      player.velocity.z = input.velocity.z;
    }

    // Handle ability inputs (detect key press, not hold)
    const prevState = playerAbilityPressState.get(client.sessionId);
    if (prevState) {
      // Ability 1 (E key)
      if (input.ability1 && !prevState.ability1) {
        this.handleAbilityUse(player, 'ability1');
      }
      // Ability 2 (Q key)
      if (input.ability2 && !prevState.ability2) {
        this.handleAbilityUse(player, 'ability2');
      }
      // Ultimate (F key)
      if (input.ultimate && !prevState.ultimate) {
        this.handleAbilityUse(player, 'ultimate');
      }

      // Update press state
      prevState.ability1 = input.ability1;
      prevState.ability2 = input.ability2;
      prevState.ultimate = input.ultimate;
    }
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

  private handleHeroSelect(client: Client, heroId: HeroId) {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (this.state.phase !== 'hero_select' && this.state.phase !== 'waiting') return;

    const heroDef = HERO_DEFINITIONS[heroId];
    if (!heroDef) return;

    player.heroId = heroId;
    player.maxHealth = heroDef.stats.maxHealth;
    player.health = player.maxHealth;
    player.ultimateCharge = 0;

    // Initialize abilities for this hero
    initializePlayerAbilities(player, heroId);

    console.log(`${player.name} selected ${heroDef.name}`);
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
    
    // Update spawn position
    const spawn = this.getSpawnPosition(team);
    player.position.x = spawn.x;
    player.position.y = spawn.y;
    player.position.z = spawn.z;
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
          // Assign default heroes to players without one
          this.state.players.forEach(p => {
            if (!p.heroId) {
              p.heroId = 'phantom'; // Default hero
              const def = HERO_DEFINITIONS.phantom;
              p.maxHealth = def.stats.maxHealth;
              p.health = p.maxHealth;
              initializePlayerAbilities(p, 'phantom');
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

    this.broadcast('phaseChange', {
      phase: 'hero_select',
      endTime: this.state.phaseEndTime,
    });
  }

  private startCountdown() {
    this.state.phase = 'countdown';
    this.state.phaseEndTime = Date.now() + this.config.countdownSeconds * 1000;

    // Set all players to spawning
    this.state.players.forEach(player => {
      player.state = 'spawning';
      const spawn = this.getSpawnPosition(player.team as Team);
      player.position.x = spawn.x;
      player.position.y = spawn.y;
      player.position.z = spawn.z;
    });

    this.broadcast('phaseChange', {
      phase: 'countdown',
      endTime: this.state.phaseEndTime,
    });
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
      
      // Reset ability cooldowns
      resetAbilityCooldowns(player);
    });

    // Reset flags
    this.resetFlags();

    this.broadcast('phaseChange', {
      phase: 'playing',
      endTime: Date.now() + this.config.roundTimeSeconds * 1000,
    });
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
    // Red flag at red base - adjusted for new map
    this.state.redTeam.flag.position.x = -20;
    this.state.redTeam.flag.position.y = 10;
    this.state.redTeam.flag.position.z = 0;
    this.state.redTeam.flag.isAtBase = true;
    this.state.redTeam.flag.carrierId = '';

    this.state.redTeam.flag.basePosition.x = -20;
    this.state.redTeam.flag.basePosition.y = 10;
    this.state.redTeam.flag.basePosition.z = 0;

    // Blue flag at blue base - adjusted for new map
    this.state.blueTeam.flag.position.x = 20;
    this.state.blueTeam.flag.position.y = 10;
    this.state.blueTeam.flag.position.z = 0;
    this.state.blueTeam.flag.isAtBase = true;
    this.state.blueTeam.flag.carrierId = '';
    this.state.blueTeam.flag.basePosition.x = 20;
    this.state.blueTeam.flag.basePosition.y = 10;
    this.state.blueTeam.flag.basePosition.z = 0;
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
            // Apply damage
            player.health -= zone.damage;
            zone.lastDamageTick.set(player.id, now);

            // Broadcast damage event
            this.broadcast('playerDamaged', {
              targetId: player.id,
              damage: zone.damage,
              sourceId: zone.ownerId,
              damageType: 'void_zone',
            });

            // Check for kill
            if (player.health <= 0) {
              this.handlePlayerDeath(player, zone.ownerId);
            }
          }
        }
      });
    }
  }

  private handlePlayerDeath(player: Player, killerId: string) {
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
      // Add ultimate charge for kill
      killer.ultimateCharge = Math.min(100, killer.ultimateCharge + 20);
    }

    this.broadcast('playerKilled', {
      victimId: player.id,
      killerId,
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
          flag.position.x = flag.basePosition.x;
          flag.position.y = flag.basePosition.y;
          flag.position.z = flag.basePosition.z;
          flag.isAtBase = true;
          flag.droppedAt = 0;
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

    const spawn = this.getSpawnPosition(player.team as Team);
    player.position.x = spawn.x;
    player.position.y = spawn.y;
    player.position.z = spawn.z;
    player.velocity.x = 0;
    player.velocity.y = 0;
    player.velocity.z = 0;

    // Reset ability cooldowns on respawn
    resetAbilityCooldowns(player);
  }

  private updatePhysics() {
    this.state.players.forEach(player => {
      if (player.state !== 'alive' || !player.lastInput) return;

      const input = player.lastInput;
      const heroId = player.heroId as HeroId;

      // Get movement parameters from hero config
      const heroStats = getHeroStats(heroId);
      let moveSpeed = heroStats.moveSpeed;
      const dt = TICK_INTERVAL_MS / 1000;

      // Check for active speed-modifying abilities
      const veilAbility = player.abilities.get('phantom_veil');
      if (veilAbility?.isActive) {
        moveSpeed *= 1.3; // 30% speed boost during Phantom Veil
      }

      const speedBoostAbility = player.abilities.get('pulse_speedboost');
      if (speedBoostAbility?.isActive) {
        moveSpeed *= 1.3; // 30% speed boost
      }

      const hasteAbility = player.abilities.get('pulse_haste');
      if (hasteAbility?.isActive) {
        moveSpeed *= 1.5; // 50% speed boost
      }

      // Calculate move direction
      let dx = 0, dz = 0;
      if (input.moveForward) dz -= 1;
      if (input.moveBackward) dz += 1;
      if (input.moveLeft) dx -= 1;
      if (input.moveRight) dx += 1;

      // Normalize
      const len = Math.sqrt(dx * dx + dz * dz);
      if (len > 0) {
        dx /= len;
        dz /= len;
      }

      // Apply rotation
      const cos = Math.cos(player.lookYaw);
      const sin = Math.sin(player.lookYaw);
      const moveX = dx * cos - dz * sin;
      const moveZ = dx * sin + dz * cos;

      // Apply speed
      let speed = moveSpeed;
      if (input.sprint) speed *= 1.4;
      if (input.crouch) speed *= 0.5;
      if (player.hasFlag) speed *= 0.85; // Flag carrier penalty

      // Update velocity
      player.velocity.x = moveX * speed;
      player.velocity.z = moveZ * speed;

      // Apply gravity (reduced for floatier feel)
      player.velocity.y -= 20 * dt;

      // Update position
      player.position.x += player.velocity.x * dt;
      player.position.y += player.velocity.y * dt;
      player.position.z += player.velocity.z * dt;

      // Ground collision - basic fallback (client handles proper terrain collision)
      if (player.position.y < -10) {
        // Respawn if fallen off the map
        const spawn = this.getSpawnPosition(player.team as Team);
        player.position.x = spawn.x;
        player.position.y = spawn.y;
        player.position.z = spawn.z;
        player.velocity.y = 0;
      }

      // Clamp to larger bounds for new map
      player.position.x = Math.max(-95, Math.min(95, player.position.x));
      player.position.z = Math.max(-95, Math.min(95, player.position.z));
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
    // Use configured spawn positions from shared map config
    const spawnPoints = SCI_FI_CTF_POSITIONS.spawnPoints[team];
    const spawn = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

    return {
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
    };
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
