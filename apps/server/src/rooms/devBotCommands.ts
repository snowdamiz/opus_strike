import type { HeroId, PlayerInput } from '@voxel-strike/shared';

export type DevBotSkillSlot = 'primary' | 'secondary' | 'ability1' | 'ability2' | 'ultimate';
export type DevBotLookDirection = 'up' | 'down';

export interface DevBotSkillCommand {
  slot: DevBotSkillSlot;
  skillKey: string;
}

export interface DevBotSkillOverride extends DevBotSkillCommand {
  expiresAt: number;
}

export interface DevBotLookOverride {
  direction: DevBotLookDirection;
  pitch: number;
  expiresAt: number;
}

export const DEV_BOT_SKILL_HOLD_MS = 10_000;
export const DEV_BOT_LOOK_HOLD_MS = 10_000;

export const DEV_BOT_LOOK_PITCH: Record<DevBotLookDirection, number> = {
  up: Math.PI / 2,
  down: -Math.PI / 2,
};

const DEV_BOT_SKILL_ALIASES: Record<string, DevBotSkillCommand> = {
  lmb: { slot: 'primary', skillKey: 'lmb' },
  m1: { slot: 'primary', skillKey: 'lmb' },
  mouse1: { slot: 'primary', skillKey: 'lmb' },
  leftmouse: { slot: 'primary', skillKey: 'lmb' },
  mouseleft: { slot: 'primary', skillKey: 'lmb' },
  primary: { slot: 'primary', skillKey: 'lmb' },
  fire: { slot: 'primary', skillKey: 'lmb' },
  attack: { slot: 'primary', skillKey: 'lmb' },
  rmb: { slot: 'secondary', skillKey: 'rmb' },
  m2: { slot: 'secondary', skillKey: 'rmb' },
  mouse2: { slot: 'secondary', skillKey: 'rmb' },
  rightmouse: { slot: 'secondary', skillKey: 'rmb' },
  mouseright: { slot: 'secondary', skillKey: 'rmb' },
  secondary: { slot: 'secondary', skillKey: 'rmb' },
  altfire: { slot: 'secondary', skillKey: 'rmb' },
  shield: { slot: 'secondary', skillKey: 'rmb' },
  e: { slot: 'ability1', skillKey: 'e' },
  ability1: { slot: 'ability1', skillKey: 'e' },
  q: { slot: 'ability2', skillKey: 'q' },
  ability2: { slot: 'ability2', skillKey: 'q' },
  f: { slot: 'ultimate', skillKey: 'f' },
  ult: { slot: 'ultimate', skillKey: 'f' },
  ultimate: { slot: 'ultimate', skillKey: 'f' },
};

export function resolveDevBotSkillOverride(skillKey: string): DevBotSkillCommand | null {
  const normalized = skillKey.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const keyWithoutDomPrefix = normalized.startsWith('key') ? normalized.slice(3) : normalized;
  return DEV_BOT_SKILL_ALIASES[keyWithoutDomPrefix] ?? null;
}

export function resolveDevBotLookDirection(direction: string): DevBotLookDirection | null {
  const normalized = direction.trim().toLowerCase();
  return normalized === 'up' || normalized === 'down' ? normalized : null;
}

type DevBotSkillInput = Pick<
  PlayerInput,
  'primaryFire' | 'secondaryFire' | 'reload' | 'ability1' | 'ability2' | 'ultimate'
>;

export function applyDevBotSkillOverride<TInput extends DevBotSkillInput>(
  input: TInput,
  heroId: HeroId | string | null | undefined,
  override: DevBotSkillOverride | null
): TInput {
  if (!override) return input;

  input.primaryFire = false;
  input.secondaryFire = false;
  input.reload = false;
  input.ability1 = false;
  input.ability2 = false;
  input.ultimate = false;

  switch (override.slot) {
    case 'primary':
      input.primaryFire = true;
      break;
    case 'secondary':
      input.secondaryFire = true;
      break;
    case 'ability1':
      input.ability1 = true;
      if (heroId === 'chronos') {
        input.primaryFire = true;
      }
      break;
    case 'ability2':
      input.ability2 = true;
      break;
    case 'ultimate':
      input.ultimate = true;
      break;
  }

  return input;
}

export function applyDevBotLookOverride<TInput extends Pick<PlayerInput, 'lookPitch'>>(
  input: TInput,
  override: DevBotLookOverride | null
): TInput {
  if (!override) return input;
  input.lookPitch = override.pitch;
  return input;
}
