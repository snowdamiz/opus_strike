import type { GamePhase, GameConfig, Team, HeroId, Vec3 } from '@voxel-strike/shared';
import { DEFAULT_GAME_CONFIG, ULTIMATE_CHARGE_PER_KILL, ULTIMATE_CHARGE_PER_ASSIST, ULTIMATE_CHARGE_PER_CAPTURE, SCI_FI_CTF_POSITIONS } from '@voxel-strike/shared';
import { CTFGameMode, CTFPlayer, CTFEvent } from '../ctf/CTFGameMode.js';
import { SpawnManager } from './SpawnManager.js';
import { AbilitySystem } from '../abilities/AbilitySystem.js';

export interface MatchPlayer {
  id: string;
  name: string;
  team: Team;
  heroId: HeroId | null;
  isReady: boolean;
  isAlive: boolean;
  health: number;
  maxHealth: number;
  position: Vec3;
  hasFlag: boolean;
  respawnTime: number | null;
  spawnProtectionUntil: number | null;
  stats: PlayerMatchStats;
}

export interface PlayerMatchStats {
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
  damageDealt: number;
  healingDone: number;
}

export interface MatchEvent {
  type: 'kill' | 'assist' | 'respawn' | 'phase_change' | 'round_end' | 'match_end';
  data: any;
  timestamp: number;
}

export class MatchManager {
  private config: GameConfig;
  private phase: GamePhase = 'waiting';
  private ctfMode: CTFGameMode;
  private spawnManager: SpawnManager;
  private abilitySystem: AbilitySystem;
  
  private players: Map<string, MatchPlayer> = new Map();
  private phaseStartTime: number = 0;
  private phaseEndTime: number | null = null;
  private roundStartTime: number | null = null;
  
  private eventListeners: ((event: MatchEvent) => void)[] = [];
  private damageHistory: Map<string, { attackerId: string; damage: number; timestamp: number }[]> = new Map();

  constructor(config: GameConfig = DEFAULT_GAME_CONFIG) {
    this.config = config;
    this.ctfMode = new CTFGameMode(config);
    this.spawnManager = new SpawnManager();
    this.abilitySystem = new AbilitySystem();

    // Listen to CTF events
    this.ctfMode.onEvent((event) => this.handleCTFEvent(event));
  }

  initialize(): void {
    const { spawnPoints, flagZones } = SCI_FI_CTF_POSITIONS;

    // Set up spawn points from map config
    this.spawnManager.setSpawnPoints('red', spawnPoints.red);
    this.spawnManager.setSpawnPoints('blue', spawnPoints.blue);

    // Initialize CTF with configured flag positions
    this.ctfMode.initialize(
      flagZones.red,
      flagZones.blue
    );
  }

  addPlayer(id: string, name: string): MatchPlayer {
    const team = this.assignTeam();
    const player: MatchPlayer = {
      id,
      name,
      team,
      heroId: null,
      isReady: false,
      isAlive: false,
      health: 100,
      maxHealth: 100,
      position: this.spawnManager.getSpawnPoint(team),
      hasFlag: false,
      respawnTime: null,
      spawnProtectionUntil: null,
      stats: {
        kills: 0,
        deaths: 0,
        assists: 0,
        flagCaptures: 0,
        flagReturns: 0,
        damageDealt: 0,
        healingDone: 0,
      },
    };

    this.players.set(id, player);
    this.damageHistory.set(id, []);
    return player;
  }

  removePlayer(id: string): void {
    const player = this.players.get(id);
    if (player?.hasFlag) {
      this.ctfMode.onPlayerDeath(this.toCTFPlayer(player));
    }
    
    this.players.delete(id);
    this.damageHistory.delete(id);
    this.abilitySystem.unregisterHero(id);
  }

  selectHero(playerId: string, heroId: HeroId): boolean {
    const player = this.players.get(playerId);
    if (!player) return false;
    if (this.phase !== 'waiting' && this.phase !== 'hero_select') return false;

    player.heroId = heroId;
    return true;
  }

  setReady(playerId: string, ready: boolean): void {
    const player = this.players.get(playerId);
    if (player) {
      player.isReady = ready;
    }
  }

  update(deltaTime: number): void {
    const now = Date.now();

    switch (this.phase) {
      case 'waiting':
        this.updateWaiting();
        break;
      case 'hero_select':
        this.updateHeroSelect(now);
        break;
      case 'countdown':
        this.updateCountdown(now);
        break;
      case 'playing':
        this.updatePlaying(deltaTime, now);
        break;
      case 'round_end':
        this.updateRoundEnd(now);
        break;
    }
  }

  private updateWaiting(): void {
    if (this.players.size >= 2) {
      this.startHeroSelect();
    }
  }

  private updateHeroSelect(now: number): void {
    // Check if all players ready
    let allReady = true;
    for (const player of this.players.values()) {
      if (!player.heroId || !player.isReady) {
        allReady = false;
        break;
      }
    }

    if (allReady) {
      this.startCountdown();
      return;
    }

    // Check timeout
    if (this.phaseEndTime && now >= this.phaseEndTime) {
      // Assign default heroes
      for (const player of this.players.values()) {
        if (!player.heroId) {
          player.heroId = 'phantom';
        }
      }
      this.startCountdown();
    }
  }

  private updateCountdown(now: number): void {
    if (this.phaseEndTime && now >= this.phaseEndTime) {
      this.startPlaying();
    }
  }

  private updatePlaying(deltaTime: number, now: number): void {
    // Update CTF
    const ctfPlayers = new Map<string, CTFPlayer>();
    for (const [id, player] of this.players) {
      ctfPlayers.set(id, this.toCTFPlayer(player));
    }
    this.ctfMode.update(ctfPlayers, deltaTime);

    // Update abilities
    this.abilitySystem.update(deltaTime);

    // Update respawns
    for (const player of this.players.values()) {
      if (!player.isAlive && player.respawnTime && now >= player.respawnTime) {
        this.respawnPlayer(player.id);
      }
    }

    // Check round timer
    if (this.roundStartTime) {
      const elapsed = (now - this.roundStartTime) / 1000;
      if (elapsed >= this.config.roundTimeSeconds) {
        this.endRound();
      }
    }

    // Check win condition
    const winner = this.ctfMode.isGameWon();
    if (winner) {
      this.endRound();
    }
  }

  private updateRoundEnd(now: number): void {
    if (this.phaseEndTime && now >= this.phaseEndTime) {
      const score = this.ctfMode.getScore();
      if (score.red >= this.config.scoreToWin || score.blue >= this.config.scoreToWin) {
        this.endMatch();
      } else {
        this.startHeroSelect();
      }
    }
  }

  private startHeroSelect(): void {
    this.phase = 'hero_select';
    this.phaseStartTime = Date.now();
    this.phaseEndTime = this.phaseStartTime + this.config.heroSelectTimeSeconds * 1000;

    this.emitEvent({
      type: 'phase_change',
      data: { phase: 'hero_select', endTime: this.phaseEndTime },
      timestamp: Date.now(),
    });
  }

  private startCountdown(): void {
    this.phase = 'countdown';
    this.phaseStartTime = Date.now();
    this.phaseEndTime = this.phaseStartTime + this.config.countdownSeconds * 1000;

    // Move players to spawn
    for (const player of this.players.values()) {
      player.position = this.spawnManager.getSpawnPoint(player.team);
    }

    this.emitEvent({
      type: 'phase_change',
      data: { phase: 'countdown', endTime: this.phaseEndTime },
      timestamp: Date.now(),
    });
  }

  private startPlaying(): void {
    this.phase = 'playing';
    this.phaseStartTime = Date.now();
    this.roundStartTime = Date.now();
    this.phaseEndTime = null;

    // Spawn all players
    for (const player of this.players.values()) {
      player.isAlive = true;
      player.health = player.maxHealth;
      player.spawnProtectionUntil = Date.now() + this.config.spawnProtectionSeconds * 1000;
    }

    this.emitEvent({
      type: 'phase_change',
      data: { phase: 'playing' },
      timestamp: Date.now(),
    });
  }

  private endRound(): void {
    this.phase = 'round_end';
    this.phaseStartTime = Date.now();
    this.phaseEndTime = this.phaseStartTime + 5000; // 5 second intermission

    const score = this.ctfMode.getScore();
    const winner = score.red > score.blue ? 'red' : score.blue > score.red ? 'blue' : null;

    this.emitEvent({
      type: 'round_end',
      data: { winner, score },
      timestamp: Date.now(),
    });
  }

  private endMatch(): void {
    this.phase = 'game_end';
    
    const score = this.ctfMode.getScore();
    const winner = score.red > score.blue ? 'red' : 'blue';

    this.emitEvent({
      type: 'match_end',
      data: { winner, score },
      timestamp: Date.now(),
    });
  }

  applyDamage(targetId: string, attackerId: string, damage: number): void {
    const target = this.players.get(targetId);
    const attacker = this.players.get(attackerId);
    
    if (!target || !target.isAlive) return;

    // Check spawn protection
    if (target.spawnProtectionUntil && Date.now() < target.spawnProtectionUntil) {
      return;
    }

    // Record damage for assists
    const history = this.damageHistory.get(targetId) ?? [];
    history.push({ attackerId, damage, timestamp: Date.now() });
    this.damageHistory.set(targetId, history);

    // Apply damage
    target.health = Math.max(0, target.health - damage);

    if (attacker) {
      attacker.stats.damageDealt += damage;
    }

    // Check death
    if (target.health <= 0) {
      this.onPlayerDeath(targetId, attackerId);
    }
  }

  private onPlayerDeath(targetId: string, killerId: string | null): void {
    const target = this.players.get(targetId);
    if (!target) return;

    target.isAlive = false;
    target.stats.deaths++;
    target.respawnTime = Date.now() + this.config.respawnTimeSeconds * 1000;

    // Handle flag drop
    if (target.hasFlag) {
      this.ctfMode.onPlayerDeath(this.toCTFPlayer(target));
      target.hasFlag = false;
    }

    // Award kill
    if (killerId) {
      const killer = this.players.get(killerId);
      if (killer) {
        killer.stats.kills++;
        this.abilitySystem.addUltimateCharge(killerId, ULTIMATE_CHARGE_PER_KILL);
      }
    }

    // Award assists
    const assistIds = this.getAssists(targetId, killerId);
    for (const assistId of assistIds) {
      const assister = this.players.get(assistId);
      if (assister) {
        assister.stats.assists++;
        this.abilitySystem.addUltimateCharge(assistId, ULTIMATE_CHARGE_PER_ASSIST);
      }
    }

    this.emitEvent({
      type: 'kill',
      data: { 
        targetId, 
        killerId, 
        assistIds,
        position: target.position 
      },
      timestamp: Date.now(),
    });

    // Clear damage history
    this.damageHistory.set(targetId, []);
  }

  private getAssists(targetId: string, killerId: string | null): string[] {
    const history = this.damageHistory.get(targetId) ?? [];
    const now = Date.now();
    const assistWindow = 10000; // 10 seconds
    const assistThreshold = 0.25; // 25% of max health

    const target = this.players.get(targetId);
    if (!target) return [];

    const damageByPlayer = new Map<string, number>();
    
    for (const entry of history) {
      if (now - entry.timestamp > assistWindow) continue;
      if (entry.attackerId === killerId) continue;
      
      const current = damageByPlayer.get(entry.attackerId) ?? 0;
      damageByPlayer.set(entry.attackerId, current + entry.damage);
    }

    const threshold = target.maxHealth * assistThreshold;
    const assists: string[] = [];
    
    for (const [playerId, damage] of damageByPlayer) {
      if (damage >= threshold) {
        assists.push(playerId);
      }
    }

    return assists;
  }

  private respawnPlayer(playerId: string): void {
    const player = this.players.get(playerId);
    if (!player) return;

    player.isAlive = true;
    player.health = player.maxHealth;
    player.position = this.spawnManager.getSpawnPoint(player.team);
    player.respawnTime = null;
    player.spawnProtectionUntil = Date.now() + this.config.spawnProtectionSeconds * 1000;

    this.emitEvent({
      type: 'respawn',
      data: { playerId, position: player.position },
      timestamp: Date.now(),
    });
  }

  private handleCTFEvent(event: CTFEvent): void {
    if (event.type === 'capture') {
      const player = this.players.get(event.playerId);
      if (player) {
        player.stats.flagCaptures++;
        player.hasFlag = false;
        this.abilitySystem.addUltimateCharge(event.playerId, ULTIMATE_CHARGE_PER_CAPTURE);
      }
    } else if (event.type === 'return') {
      const player = this.players.get(event.playerId);
      if (player) {
        player.stats.flagReturns++;
      }
    } else if (event.type === 'pickup') {
      const player = this.players.get(event.playerId);
      if (player) {
        player.hasFlag = true;
      }
    }
  }

  private assignTeam(): Team {
    let redCount = 0;
    let blueCount = 0;
    
    for (const player of this.players.values()) {
      if (player.team === 'red') redCount++;
      else blueCount++;
    }

    return redCount <= blueCount ? 'red' : 'blue';
  }

  private toCTFPlayer(player: MatchPlayer): CTFPlayer {
    return {
      id: player.id,
      team: player.team,
      position: player.position,
      isAlive: player.isAlive,
      hasFlag: player.hasFlag,
    };
  }

  getPhase(): GamePhase {
    return this.phase;
  }

  getPlayers(): Map<string, MatchPlayer> {
    return new Map(this.players);
  }

  getScore(): { red: number; blue: number } {
    return this.ctfMode.getScore();
  }

  getRoundTimeRemaining(): number {
    if (!this.roundStartTime || this.phase !== 'playing') return 0;
    const elapsed = (Date.now() - this.roundStartTime) / 1000;
    return Math.max(0, this.config.roundTimeSeconds - elapsed);
  }

  onEvent(listener: (event: MatchEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  private emitEvent(event: MatchEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }
}

