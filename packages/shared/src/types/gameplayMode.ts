export const GAMEPLAY_MODES = ['capture_the_flag', 'team_deathmatch'] as const;

export type GameplayMode = typeof GAMEPLAY_MODES[number];

export const DEFAULT_GAMEPLAY_MODE: GameplayMode = 'capture_the_flag';

export function isGameplayMode(value: unknown): value is GameplayMode {
  return typeof value === 'string' && (GAMEPLAY_MODES as readonly string[]).includes(value);
}

export function getGameplayModeLabel(mode: GameplayMode): string {
  switch (mode) {
    case 'team_deathmatch':
      return 'Team Deathmatch';
    case 'capture_the_flag':
    default:
      return 'Capture the Flag';
  }
}
