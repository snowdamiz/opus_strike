export const BLAZE_PRIMARY_SKILLS = ['fireball_rockets', 'scrapshot'] as const;

export type BlazePrimarySkill = (typeof BLAZE_PRIMARY_SKILLS)[number];

export const DEFAULT_BLAZE_PRIMARY_SKILL: BlazePrimarySkill = 'fireball_rockets';

export function isBlazePrimarySkill(value: unknown): value is BlazePrimarySkill {
  return typeof value === 'string' && BLAZE_PRIMARY_SKILLS.includes(value as BlazePrimarySkill);
}
