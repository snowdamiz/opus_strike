import type { AbilityActiveState } from './types';
import { POWERUP_ABILITY_ATTACK_SPEED_MULTIPLIER } from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';

export function getLocalChronosTimebreakTempoMultiplier(
  now = Date.now(),
  _activeAbilities?: Record<string, AbilityActiveState>
): number {
  const boostUntil = useGameStore.getState().localPlayer?.powerupBoostUntil ?? 0;
  return boostUntil > now ? POWERUP_ABILITY_ATTACK_SPEED_MULTIPLIER : 1;
}
