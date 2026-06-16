import type { GameConfig } from '../types/game.js';

export const DEFAULT_GAME_CONFIG: GameConfig = {
  maxPlayers: 8,
  teamSize: 4,
  scoreToWin: 3,
  roundTimeSeconds: 600, // 10 minutes
  respawnTimeSeconds: 8,
  spawnProtectionSeconds: 3,
  flagReturnTimeSeconds: 30,
  heroSelectTimeSeconds: 30,
  countdownSeconds: 10,
};

export const TICK_RATE = 20; // Server ticks per second
export const TICK_INTERVAL_MS = 1000 / TICK_RATE; // 50ms

export const CLIENT_INTERPOLATION_DELAY = 100; // ms
export const INPUT_BUFFER_SIZE = 64;
export const MAX_PREDICTION_TICKS = 10;

export const ULTIMATE_CHARGE_MAX = 100;
export const ULTIMATE_CHARGE_PER_KILL = 15;
export const ULTIMATE_CHARGE_PER_ASSIST = 8;
export const ULTIMATE_CHARGE_PER_CAPTURE = 25;
export const ULTIMATE_CHARGE_PER_SECOND = 1;

export const FLAG_PICKUP_RADIUS = 2;
export const FLAG_CAPTURE_RADIUS = 3;
export const FLAG_CARRIER_SPEED_PENALTY = 0.85;

export const DAMAGE_FALLOFF_START = 15;
export const DAMAGE_FALLOFF_END = 40;
export const DAMAGE_FALLOFF_MIN_MULTIPLIER = 0.5;

export const KILL_ASSIST_WINDOW_MS = 10000; // 10 seconds
export const ASSIST_DAMAGE_THRESHOLD = 0.25; // 25% of max health
