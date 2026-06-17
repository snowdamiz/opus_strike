import type { GamePhase } from '@voxel-strike/shared';

const GAME_PHASES = new Set<string>([
  'waiting',
  'hero_select',
  'countdown',
  'playing',
  'round_end',
  'game_end',
]);

export function normalizeGamePhase(value: unknown, fallback: GamePhase = 'waiting'): GamePhase {
  return typeof value === 'string' && GAME_PHASES.has(value) ? value as GamePhase : fallback;
}
