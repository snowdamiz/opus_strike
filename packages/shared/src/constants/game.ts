import type { GameConfig } from '../types/game.js';
import {
  DEFAULT_GAMEPLAY_MODE,
  getGameplayModeRules,
  type GameplayMode,
} from '../types/gameplayMode.js';

export const CAPTURE_THE_FLAG_SCORE_TO_WIN = 3;
export const TEAM_DEATHMATCH_SCORE_TO_WIN = 30;

export const DEFAULT_GAME_CONFIG: GameConfig = {
  gameplayMode: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).id,
  maxPlayers: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).maxPlayers,
  minPlayers: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).minPlayers,
  teamSize: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).maxTeamSize,
  maxTeams: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).maxTeams,
  scoreToWin: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).scoreToWin,
  roundTimeSeconds: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).roundTimeSeconds,
  respawnTimeSeconds: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).respawnTimeSeconds,
  spawnProtectionSeconds: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).spawnProtectionSeconds,
  flagReturnTimeSeconds: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).flagReturnTimeSeconds,
  heroSelectTimeSeconds: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).heroSelectTimeSeconds,
  countdownSeconds: getGameplayModeRules(DEFAULT_GAMEPLAY_MODE).countdownSeconds,
};

export function createGameConfigForGameplayMode(gameplayMode: GameplayMode = DEFAULT_GAMEPLAY_MODE): GameConfig {
  const rules = getGameplayModeRules(gameplayMode);
  return {
    gameplayMode: rules.id,
    maxPlayers: rules.maxPlayers,
    minPlayers: rules.minPlayers,
    teamSize: rules.maxTeamSize,
    maxTeams: rules.maxTeams,
    scoreToWin: rules.scoreToWin,
    roundTimeSeconds: rules.roundTimeSeconds,
    respawnTimeSeconds: rules.respawnTimeSeconds,
    spawnProtectionSeconds: rules.spawnProtectionSeconds,
    flagReturnTimeSeconds: rules.flagReturnTimeSeconds,
    heroSelectTimeSeconds: rules.heroSelectTimeSeconds,
    countdownSeconds: rules.countdownSeconds,
  };
}

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

export const POWERUP_HEALTH_RESTORE_RATIO = 0.2;
export const POWERUP_ABILITY_ATTACK_SPEED_MULTIPLIER = 1.15;
export const POWERUP_MOVEMENT_SPEED_MULTIPLIER = 1.1;
export const POWERUP_BUFF_DURATION_MS = 15000;
export const POWERUP_PICKUP_RADIUS = 1.45;
export const POWERUP_RESPAWN_SECONDS = 28;

export const DAMAGE_FALLOFF_START = 15;
export const DAMAGE_FALLOFF_END = 40;
export const DAMAGE_FALLOFF_MIN_MULTIPLIER = 0.5;

export const KILL_ASSIST_WINDOW_MS = 10000; // 10 seconds
export const ASSIST_DAMAGE_THRESHOLD = 0.25; // 25% of max health

export const BATTLE_ROYAL_DOWNED_DURATION_MS = 60_000;
export const BATTLE_ROYAL_REVIVE_DURATION_MS = 5_000;
export const BATTLE_ROYAL_DOWNED_MAX_HP = 75;
export const BATTLE_ROYAL_REVIVED_HEALTH = 35;
export const BATTLE_ROYAL_CRAWL_SPEED_MULTIPLIER = 0.32;
export const BATTLE_ROYAL_REVIVE_RADIUS = 2.4;
