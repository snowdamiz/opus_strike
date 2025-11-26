import type { Vec3, Team, GameConfig } from '@voxel-strike/shared';
import { FLAG_PICKUP_RADIUS, FLAG_CAPTURE_RADIUS, FLAG_CARRIER_SPEED_PENALTY } from '@voxel-strike/shared';
import { vec3Distance } from '@voxel-strike/shared';
import { FlagManager, FlagState } from './FlagManager.js';

export interface CTFPlayer {
  id: string;
  team: Team;
  position: Vec3;
  isAlive: boolean;
  hasFlag: boolean;
}

export interface CTFEvent {
  type: 'pickup' | 'drop' | 'capture' | 'return';
  team: Team;
  playerId: string;
  position: Vec3;
  timestamp: number;
}

export class CTFGameMode {
  private flagManager: FlagManager;
  private config: GameConfig;
  private eventListeners: ((event: CTFEvent) => void)[] = [];
  
  private redScore: number = 0;
  private blueScore: number = 0;

  constructor(config: GameConfig) {
    this.config = config;
    this.flagManager = new FlagManager();
  }

  initialize(redBase: Vec3, blueBase: Vec3): void {
    this.flagManager.initialize(redBase, blueBase);
    this.redScore = 0;
    this.blueScore = 0;
  }

  update(players: Map<string, CTFPlayer>, deltaTime: number): void {
    // Update flag timers
    this.flagManager.update(deltaTime);

    // Check for auto-returns
    const redFlag = this.flagManager.getFlag('red');
    const blueFlag = this.flagManager.getFlag('blue');

    if (redFlag.state === 'dropped' && 
        Date.now() - (redFlag.droppedAt ?? 0) >= this.config.flagReturnTimeSeconds * 1000) {
      this.flagManager.returnFlag('red');
      this.emitEvent({
        type: 'return',
        team: 'red',
        playerId: '',
        position: redFlag.basePosition,
        timestamp: Date.now(),
      });
    }

    if (blueFlag.state === 'dropped' && 
        Date.now() - (blueFlag.droppedAt ?? 0) >= this.config.flagReturnTimeSeconds * 1000) {
      this.flagManager.returnFlag('blue');
      this.emitEvent({
        type: 'return',
        team: 'blue',
        playerId: '',
        position: blueFlag.basePosition,
        timestamp: Date.now(),
      });
    }

    // Check player interactions
    for (const player of players.values()) {
      if (!player.isAlive) continue;

      this.checkFlagPickup(player, players);
      this.checkFlagCapture(player);
      this.checkFlagReturn(player);
    }
  }

  private checkFlagPickup(player: CTFPlayer, players: Map<string, CTFPlayer>): void {
    // Can't pick up flag if already carrying one
    if (player.hasFlag) return;

    // Check enemy flag
    const enemyTeam = player.team === 'red' ? 'blue' : 'red';
    const enemyFlag = this.flagManager.getFlag(enemyTeam);

    // Can only pick up if at base or dropped
    if (enemyFlag.state === 'carried') return;

    const distance = vec3Distance(player.position, enemyFlag.position);
    
    if (distance <= FLAG_PICKUP_RADIUS) {
      this.flagManager.pickupFlag(enemyTeam, player.id);
      
      // Update player state
      player.hasFlag = true;

      this.emitEvent({
        type: 'pickup',
        team: enemyTeam,
        playerId: player.id,
        position: player.position,
        timestamp: Date.now(),
      });
    }
  }

  private checkFlagCapture(player: CTFPlayer): void {
    if (!player.hasFlag) return;

    // Check if at own base
    const ownFlag = this.flagManager.getFlag(player.team);
    
    // Can only capture if own flag is at base
    if (ownFlag.state !== 'at_base') return;

    const distance = vec3Distance(player.position, ownFlag.basePosition);
    
    if (distance <= FLAG_CAPTURE_RADIUS) {
      // Capture!
      const capturedTeam = player.team === 'red' ? 'blue' : 'red';
      this.flagManager.captureFlag(capturedTeam);
      
      // Update score
      if (player.team === 'red') {
        this.redScore++;
      } else {
        this.blueScore++;
      }

      player.hasFlag = false;

      this.emitEvent({
        type: 'capture',
        team: capturedTeam,
        playerId: player.id,
        position: player.position,
        timestamp: Date.now(),
      });
    }
  }

  private checkFlagReturn(player: CTFPlayer): void {
    // Check own flag for return
    const ownFlag = this.flagManager.getFlag(player.team);
    
    // Can only return if dropped
    if (ownFlag.state !== 'dropped') return;

    const distance = vec3Distance(player.position, ownFlag.position);
    
    if (distance <= FLAG_PICKUP_RADIUS) {
      this.flagManager.returnFlag(player.team);

      this.emitEvent({
        type: 'return',
        team: player.team,
        playerId: player.id,
        position: ownFlag.basePosition,
        timestamp: Date.now(),
      });
    }
  }

  onPlayerDeath(player: CTFPlayer): void {
    if (player.hasFlag) {
      const flagTeam = player.team === 'red' ? 'blue' : 'red';
      this.flagManager.dropFlag(flagTeam, player.position);
      player.hasFlag = false;

      this.emitEvent({
        type: 'drop',
        team: flagTeam,
        playerId: player.id,
        position: player.position,
        timestamp: Date.now(),
      });
    }
  }

  getScore(): { red: number; blue: number } {
    return { red: this.redScore, blue: this.blueScore };
  }

  getFlag(team: Team): FlagState {
    return this.flagManager.getFlag(team);
  }

  isGameWon(): Team | null {
    if (this.redScore >= this.config.scoreToWin) return 'red';
    if (this.blueScore >= this.config.scoreToWin) return 'blue';
    return null;
  }

  getCarrierSpeedPenalty(): number {
    return FLAG_CARRIER_SPEED_PENALTY;
  }

  onEvent(listener: (event: CTFEvent) => void): () => void {
    this.eventListeners.push(listener);
    return () => {
      const index = this.eventListeners.indexOf(listener);
      if (index !== -1) {
        this.eventListeners.splice(index, 1);
      }
    };
  }

  private emitEvent(event: CTFEvent): void {
    for (const listener of this.eventListeners) {
      listener(event);
    }
  }

  reset(): void {
    this.flagManager.reset();
    this.redScore = 0;
    this.blueScore = 0;
  }
}

