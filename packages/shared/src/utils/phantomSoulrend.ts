import {
  PHANTOM_PRIMARY_MAGAZINE_SIZE,
  PHANTOM_DIRE_BALL_SPEED,
  PHANTOM_SOULREND_MAGAZINE_SIZE,
  PHANTOM_SOULREND_SPEED,
} from '../constants/heroes.js';
import {
  DEFAULT_PHANTOM_PRIMARY_SKILL,
  type PhantomPrimarySkill,
} from '../types/loadout.js';

export function getPhantomPrimaryMagazineSize(skill: PhantomPrimarySkill): number {
  return skill === 'soulrend_daggers'
    ? PHANTOM_SOULREND_MAGAZINE_SIZE
    : PHANTOM_PRIMARY_MAGAZINE_SIZE;
}

export function getPhantomPrimaryAbilityId(
  skill: PhantomPrimarySkill
): 'phantom_dire_ball' | 'phantom_soulrend_daggers' {
  return skill === 'soulrend_daggers'
    ? 'phantom_soulrend_daggers'
    : 'phantom_dire_ball';
}

export function getPhantomPrimaryProjectileSpeed(skill: PhantomPrimarySkill): number {
  return skill === 'soulrend_daggers'
    ? PHANTOM_SOULREND_SPEED
    : PHANTOM_DIRE_BALL_SPEED;
}

export function normalizePhantomPrimarySkill(value: unknown): PhantomPrimarySkill {
  return value === 'soulrend_daggers' ? value : DEFAULT_PHANTOM_PRIMARY_SKILL;
}
