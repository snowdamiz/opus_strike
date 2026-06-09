import {
  ABILITY_DEFINITIONS,
  CHRONOS_TIMEBREAK_ALLY_SPEED_MULTIPLIER,
  CHRONOS_TIMEBREAK_ENEMY_SPEED_MULTIPLIER,
  CHRONOS_TIMEBREAK_RADIUS,
} from '@voxel-strike/shared';
import { useGameStore } from '../../store/gameStore';
import type { AbilityActiveState } from './types';

const CHRONOS_TIMEBREAK_ABILITY_ID = 'chronos_timebreak';

function isClientActiveAbility(state: AbilityActiveState | undefined, now: number, durationMs: number): boolean {
  return Boolean(state?.active && now >= state.startTime && now - state.startTime < durationMs);
}

function isServerTimebreakActive(
  ability: { isActive: boolean; activatedAt?: number } | undefined,
  now: number,
  durationMs: number
): boolean {
  const activatedAt = ability?.activatedAt ?? 0;
  return Boolean(ability?.isActive && now >= activatedAt && now - activatedAt < durationMs);
}

function isWithinTimebreakRadius(
  source: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number }
): boolean {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const dz = target.z - source.z;
  return dx * dx + dy * dy + dz * dz <= CHRONOS_TIMEBREAK_RADIUS * CHRONOS_TIMEBREAK_RADIUS;
}

export function getLocalChronosTimebreakTempoMultiplier(
  now = Date.now(),
  activeAbilities?: Record<string, AbilityActiveState>
): number {
  const store = useGameStore.getState();
  const localPlayer = store.localPlayer;
  if (!localPlayer || localPlayer.state !== 'alive') return 1;

  const durationMs = (ABILITY_DEFINITIONS[CHRONOS_TIMEBREAK_ABILITY_ID]?.duration ?? 0) * 1000;
  const appliedCasterIds = new Set<string>();
  let multiplier = 1;

  if (isClientActiveAbility(activeAbilities?.[CHRONOS_TIMEBREAK_ABILITY_ID], now, durationMs)) {
    multiplier *= CHRONOS_TIMEBREAK_ALLY_SPEED_MULTIPLIER;
    appliedCasterIds.add(localPlayer.id);
  }

  for (const caster of store.players.values()) {
    if (caster.heroId !== 'chronos' || caster.state !== 'alive') continue;
    if (appliedCasterIds.has(caster.id)) continue;
    if (!isServerTimebreakActive(caster.abilities?.[CHRONOS_TIMEBREAK_ABILITY_ID], now, durationMs)) continue;
    if (!isWithinTimebreakRadius(caster.position, localPlayer.position)) continue;

    multiplier *= caster.team === localPlayer.team
      ? CHRONOS_TIMEBREAK_ALLY_SPEED_MULTIPLIER
      : CHRONOS_TIMEBREAK_ENEMY_SPEED_MULTIPLIER;
    appliedCasterIds.add(caster.id);
  }

  return Math.max(0.35, Math.min(1.65, multiplier));
}
