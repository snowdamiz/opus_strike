import type { AbilityActiveState } from './types';

export function getLocalChronosTimebreakTempoMultiplier(
  _now = Date.now(),
  _activeAbilities?: Record<string, AbilityActiveState>
): number {
  return 1;
}
