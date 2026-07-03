export const GAMEPLAY_MODES = ['capture_the_flag', 'team_deathmatch', 'battle_royal'] as const;
export const CUSTOM_LOBBY_GAMEPLAY_MODES = ['capture_the_flag', 'team_deathmatch'] as const;

export type GameplayMode = typeof GAMEPLAY_MODES[number];
export type CustomLobbyGameplayMode = typeof CUSTOM_LOBBY_GAMEPLAY_MODES[number];

export const DEFAULT_GAMEPLAY_MODE: GameplayMode = 'capture_the_flag';
export const BATTLE_ROYAL_GAMEPLAY_MODE: GameplayMode = 'battle_royal';
export const RANKED_GAMEPLAY_MODE: GameplayMode = BATTLE_ROYAL_GAMEPLAY_MODE;

export type GameplayScoreModel = 'ctf_flags' | 'team_kills' | 'last_team_alive';
export type GameplayRespawnPolicy = 'timed' | 'none_after_active_play';
export type GameplayMatchEndPolicy = 'score_limit' | 'round_time_or_score' | 'last_team_alive';
export type GameplayMapFamilyId = 'ctf_arena' | 'battle_royal_large';
export type GameplayMapProfileId = 'ctf_arena' | 'tdm_arena' | 'battle_royal_large';

export interface GameplayModeRules {
  id: GameplayMode;
  label: string;
  maxPlayers: number;
  minPlayers: number;
  maxTeamSize: number;
  maxTeams: number;
  scoreToWin: number;
  roundTimeSeconds: number;
  respawnTimeSeconds: number;
  spawnProtectionSeconds: number;
  flagReturnTimeSeconds: number;
  heroSelectTimeSeconds: number;
  countdownSeconds: number;
  scoreModel: GameplayScoreModel;
  respawnPolicy: GameplayRespawnPolicy;
  matchEndPolicy: GameplayMatchEndPolicy;
  mapFamilyId: GameplayMapFamilyId;
  mapProfileId: GameplayMapProfileId;
  flagsEnabled: boolean;
  teamScoresEnabled: boolean;
  safeZoneEnabled: boolean;
  powerupsEnabled: boolean;
  botsEnabled: boolean;
  rankedEnabled: boolean;
  capacityWeight: number;
  expectedRoomCost: number;
}

export const GAMEPLAY_MODE_RULES = {
  capture_the_flag: {
    id: 'capture_the_flag',
    label: 'Capture the Flag',
    maxPlayers: 8,
    minPlayers: 2,
    maxTeamSize: 4,
    maxTeams: 2,
    scoreToWin: 3,
    roundTimeSeconds: 600,
    respawnTimeSeconds: 8,
    spawnProtectionSeconds: 3,
    flagReturnTimeSeconds: 30,
    heroSelectTimeSeconds: 30,
    countdownSeconds: 10,
    scoreModel: 'ctf_flags',
    respawnPolicy: 'timed',
    matchEndPolicy: 'score_limit',
    mapFamilyId: 'ctf_arena',
    mapProfileId: 'ctf_arena',
    flagsEnabled: true,
    teamScoresEnabled: true,
    safeZoneEnabled: false,
    powerupsEnabled: true,
    botsEnabled: true,
    rankedEnabled: false,
    capacityWeight: 1,
    expectedRoomCost: 8,
  },
  team_deathmatch: {
    id: 'team_deathmatch',
    label: 'Team Deathmatch',
    maxPlayers: 8,
    minPlayers: 2,
    maxTeamSize: 4,
    maxTeams: 2,
    scoreToWin: 30,
    roundTimeSeconds: 600,
    respawnTimeSeconds: 8,
    spawnProtectionSeconds: 3,
    flagReturnTimeSeconds: 30,
    heroSelectTimeSeconds: 30,
    countdownSeconds: 10,
    scoreModel: 'team_kills',
    respawnPolicy: 'timed',
    matchEndPolicy: 'round_time_or_score',
    mapFamilyId: 'ctf_arena',
    mapProfileId: 'tdm_arena',
    flagsEnabled: false,
    teamScoresEnabled: true,
    safeZoneEnabled: false,
    powerupsEnabled: true,
    botsEnabled: true,
    rankedEnabled: false,
    capacityWeight: 1,
    expectedRoomCost: 8,
  },
  battle_royal: {
    id: 'battle_royal',
    label: 'Battle Royal',
    maxPlayers: 33,
    minPlayers: 12,
    maxTeamSize: 3,
    maxTeams: 11,
    scoreToWin: 0,
    roundTimeSeconds: 1200,
    respawnTimeSeconds: 0,
    spawnProtectionSeconds: 3,
    flagReturnTimeSeconds: 0,
    heroSelectTimeSeconds: 45,
    countdownSeconds: 12,
    scoreModel: 'last_team_alive',
    respawnPolicy: 'none_after_active_play',
    matchEndPolicy: 'last_team_alive',
    mapFamilyId: 'battle_royal_large',
    mapProfileId: 'battle_royal_large',
    flagsEnabled: false,
    teamScoresEnabled: false,
    safeZoneEnabled: true,
    powerupsEnabled: true,
    botsEnabled: true,
    rankedEnabled: true,
    capacityWeight: 33 / 8,
    expectedRoomCost: 33,
  },
} as const satisfies Record<GameplayMode, GameplayModeRules>;

export function isGameplayMode(value: unknown): value is GameplayMode {
  return typeof value === 'string' && (GAMEPLAY_MODES as readonly string[]).includes(value);
}

export function isCustomLobbyGameplayMode(value: unknown): value is CustomLobbyGameplayMode {
  return typeof value === 'string' && (CUSTOM_LOBBY_GAMEPLAY_MODES as readonly string[]).includes(value);
}

export function getGameplayModeRules(mode: GameplayMode = DEFAULT_GAMEPLAY_MODE): GameplayModeRules {
  return GAMEPLAY_MODE_RULES[mode];
}

export function isBattleRoyalMode(gameplayMode: GameplayMode): boolean {
  return gameplayMode === 'battle_royal';
}

export function getGameplayModeLabel(mode: GameplayMode): string {
  return getGameplayModeRules(mode).label;
}

export function getGameplayModeCapacityCost(gameplayMode: GameplayMode, reservedPlayers: number): number {
  const rules = getGameplayModeRules(gameplayMode);
  return Math.max(Math.ceil(reservedPlayers * rules.capacityWeight), rules.expectedRoomCost);
}
