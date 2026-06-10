import type { Vec3 } from './vector.js';
import type { Player, Team } from './player.js';

export type GamePhase = 
  | 'waiting'       // Waiting for players
  | 'hero_select'   // Players selecting heroes
  | 'countdown'     // Pre-round countdown
  | 'playing'       // Active gameplay
  | 'round_end'     // Round ended, showing scores
  | 'game_end';     // Game over

export type MatchOutcome = 'win' | 'loss' | 'draw';

export interface Flag {
  team: Team;
  position: Vec3;
  basePosition: Vec3;
  carrierId: string | null;
  isAtBase: boolean;
  droppedAt: number | null;
  returnTimer: number | null;
}

export interface TeamState {
  score: number;
  flag: Flag;
  spawnPoints: Vec3[];
}

export interface GameConfig {
  maxPlayers: number;
  teamSize: number;
  scoreToWin: number;
  roundTimeSeconds: number;
  respawnTimeSeconds: number;
  spawnProtectionSeconds: number;
  flagReturnTimeSeconds: number;
  heroSelectTimeSeconds: number;
  countdownSeconds: number;
}

export interface GameState {
  roomId: string;
  phase: GamePhase;
  tick: number;
  serverTime: number;
  
  // Teams
  redTeam: TeamState;
  blueTeam: TeamState;
  
  // Players
  players: Map<string, Player>;
  
  // Timing
  roundStartTime: number | null;
  roundTimeRemaining: number;
  phaseEndTime: number | null;
  
  // Config
  config: GameConfig;
}

export interface RoundResult {
  winningTeam: Team | null;  // null for draw
  redScore: number;
  blueScore: number;
  duration: number;
  mvpPlayerId: string | null;
}

export interface MatchResult {
  winningTeam: Team | null;
  finalScore: { red: number; blue: number };
  rounds: RoundResult[];
  duration: number;
  playerStats: Map<string, PlayerMatchStats>;
}

export interface PlayerMatchStats {
  playerId: string;
  playerName: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
  damageDealt: number;
  healingDone: number;
}
