import { Room, Client } from 'colyseus';
import { GameState } from './schema/GameState';
import { Player } from './schema/Player';
import { Vec3Schema } from './schema/Components';
import { 
  DEFAULT_GAME_CONFIG, 
  TICK_RATE, 
  TICK_INTERVAL_MS,
  HERO_DEFINITIONS,
} from '@voxel-strike/shared';
import type { 
  HeroId, 
  Team, 
  PlayerInput,
} from '@voxel-strike/shared';

interface CreateOptions {
  lobbyId?: string;
  lobbyName?: string;
}

interface JoinOptions {
  playerName?: string;
  preferredTeam?: Team;
}

export class GameRoom extends Room<GameState> {
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private readonly config = DEFAULT_GAME_CONFIG;
  private lobbyId: string | null = null;
  private lobbyName: string | null = null;

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
  }

  onJoin(client: Client, options: JoinOptions) {
    console.log('Player joined:', client.sessionId, options.playerName);

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

    // Check if we should start hero select
    this.checkPhaseTransition();
  }

  onLeave(client: Client) {
    console.log('Player left:', client.sessionId);

    const player = this.state.players.get(client.sessionId);
    
    // Handle flag drop if carrying
    if (player?.hasFlag) {
      this.dropFlag(player);
    }

    this.state.players.delete(client.sessionId);

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
    // Update round timer
    if (this.state.roundStartTime) {
      const elapsed = (Date.now() - this.state.roundStartTime) / 1000;
      this.state.roundTimeRemaining = Math.max(0, this.config.roundTimeSeconds - elapsed);

      if (this.state.roundTimeRemaining <= 0) {
        this.endRound();
      }
    }

    // Update respawns
    this.state.players.forEach(player => {
      if (player.state === 'dead' && player.respawnTime) {
        if (Date.now() >= player.respawnTime) {
          this.respawnPlayer(player);
        }
      }
    });

    // Check flag returns
    this.checkFlagReturns();

    // Update physics simulation (simplified)
    this.updatePhysics();

    // Broadcast player positions/states via message (workaround for schema sync issues)
    this.broadcastPlayerStates();
  }

  private broadcastPlayerStates() {
    const playerStates: any[] = [];
    
    this.state.players.forEach((player, id) => {
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
        hasFlag: player.hasFlag,
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
    // In a production game, you'd validate this against server physics
    if (input.position) {
      // Basic validation: clamp to larger bounds for new map
      player.position.x = Math.max(-95, Math.min(95, input.position.x));
      player.position.y = Math.max(-10, Math.min(100, input.position.y));
      player.position.z = Math.max(-95, Math.min(95, input.position.z));
    }
    if (input.velocity) {
      player.velocity.x = input.velocity.x;
      player.velocity.y = input.velocity.y;
      player.velocity.z = input.velocity.z;
    }
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
  }

  private updatePhysics() {
    this.state.players.forEach(player => {
      if (player.state !== 'alive' || !player.lastInput) return;

      const input = player.lastInput;
      const heroId = player.heroId as HeroId;
      const heroDef = heroId ? HERO_DEFINITIONS[heroId] : null;

      // Get movement parameters
      const moveSpeed = heroDef?.stats.moveSpeed ?? 12;
      const dt = TICK_INTERVAL_MS / 1000;

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

      // Apply gravity
      player.velocity.y -= 30 * dt;

      // Update position
      player.position.x += player.velocity.x * dt;
      player.position.y += player.velocity.y * dt;
      player.position.z += player.velocity.z * dt;

      // Ground collision - basic fallback (client handles proper terrain collision)
      // Just prevent falling through the absolute floor
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
    // Spawn positions for the new GLB map
    // Players spawn high and fall down to avoid spawning inside geometry
    const baseX = team === 'red' ? -20 : 20;
    const offsets = [
      { x: -3, z: -3 },
      { x: -3, z: 3 },
      { x: 3, z: -3 },
      { x: 3, z: 3 },
      { x: 0, z: 0 },
    ];
    
    const offset = offsets[Math.floor(Math.random() * offsets.length)];
    
    return {
      x: baseX + offset.x,
      y: 50, // Spawn high above the map, player will fall down
      z: offset.z,
    };
  }
}
