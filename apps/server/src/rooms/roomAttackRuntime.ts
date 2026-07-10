import {
  BLAZE_BOMB_AEGIS_COLLISION_RADIUS,
  BLAZE_BOMB_COOLDOWN_MS,
  BLAZE_BOMB_DAMAGE,
  BLAZE_BOMB_MAX_RANGE,
  BLAZE_BOMB_SPLASH_RADIUS,
  BLAZE_PHOSPHOR_FLARE_AEGIS_COLLISION_RADIUS,
  BLAZE_PHOSPHOR_FLARE_COOLDOWN_MS,
  BLAZE_PHOSPHOR_FLARE_DAMAGE,
  BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
  BLAZE_PHOSPHOR_FLARE_RADIUS,
  BLAZE_ROCKET_COLLISION_RADIUS,
  BLAZE_ROCKET_DAMAGE,
  BLAZE_ROCKET_FIRE_INTERVAL_MS,
  BLAZE_ROCKET_SPLASH_RADIUS,
  BLAZE_SCRAPSHOT_AEGIS_COLLISION_RADIUS,
  BLAZE_SCRAPSHOT_PELLET_DAMAGE,
  BLAZE_SCRAPSHOT_RANGE,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS,
  CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE,
  CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
  CHRONOS_VERDANT_PULSE_COLLISION_RADIUS,
  CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
  CHRONOS_VERDANT_PULSE_DAMAGE,
  HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS,
  HOOKSHOT_CHAIN_HOOKS_COOLDOWN_MS,
  HOOKSHOT_CHAIN_HOOKS_DAMAGE,
  HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE,
  HOOKSHOT_DRAG_HOOK_COLLISION_RADIUS,
  HOOKSHOT_DRAG_HOOK_COOLDOWN_MS,
  HOOKSHOT_DRAG_HOOK_DAMAGE,
  HOOKSHOT_DRAG_HOOK_MAX_DISTANCE,
  PHANTOM_DIRE_BALL_COLLISION_RADIUS,
  PHANTOM_DIRE_BALL_DAMAGE,
  PHANTOM_PRIMARY_COOLDOWN_MS,
  PHANTOM_VOID_RAY_COLLISION_RADIUS,
  PHANTOM_VOID_RAY_COOLDOWN_MS,
  PHANTOM_VOID_RAY_DAMAGE,
  type BlazePrimarySkill,
  type BlazeSecondarySkill,
  type HeroId,
} from '@voxel-strike/shared';
import type { PlainVec3 } from './bot-ai';

export type AttackMode = 'primary' | 'secondary';
export type AttackTargetTeam = 'enemy' | 'any';

export interface AttackConfig {
  damage: number;
  range: number;
  cooldownMs: number;
  coneDot: number;
  radius?: number;
  collisionRadius?: number;
  targetTeam?: AttackTargetTeam;
  damageType: string;
}

export interface SkillImpactHint {
  impactPosition?: PlainVec3;
  interceptedByChronosAegis?: boolean;
  targetIds?: string[];
}

export type AttackCastKind =
  | 'phantom_dire_ball'
  | 'phantom_void_ray'
  | 'hookshot_basic_attack'
  | 'hookshot_heavy_attack'
  | 'chronos_verdant_pulse';

export type AttackDamageResolutionAction =
  | 'chronos_aegis_absorb'
  | 'none'
  | 'area_damage'
  | 'direct_damage';

export interface AttackDamageResolutionPlan {
  action: AttackDamageResolutionAction;
  startHookshotDragPull: boolean;
}

export const PRIMARY_ATTACKS: Partial<Record<HeroId, AttackConfig>> = {
  phantom: {
    damage: PHANTOM_DIRE_BALL_DAMAGE,
    range: 30,
    cooldownMs: PHANTOM_PRIMARY_COOLDOWN_MS,
    coneDot: Math.cos(0.18),
    collisionRadius: PHANTOM_DIRE_BALL_COLLISION_RADIUS,
    damageType: 'dire_ball',
  },
  hookshot: {
    damage: HOOKSHOT_CHAIN_HOOKS_DAMAGE,
    range: HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE,
    cooldownMs: HOOKSHOT_CHAIN_HOOKS_COOLDOWN_MS,
    coneDot: Math.cos(0.2),
    collisionRadius: HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS,
    damageType: 'chain_hooks',
  },
  blaze: {
    damage: BLAZE_ROCKET_DAMAGE,
    range: 36,
    cooldownMs: BLAZE_ROCKET_FIRE_INTERVAL_MS,
    coneDot: Math.cos(0.22),
    radius: BLAZE_ROCKET_SPLASH_RADIUS,
    collisionRadius: BLAZE_ROCKET_COLLISION_RADIUS,
    damageType: 'rocket',
  },
  chronos: {
    damage: CHRONOS_VERDANT_PULSE_DAMAGE,
    range: 34,
    cooldownMs: CHRONOS_VERDANT_PULSE_COOLDOWN_MS,
    coneDot: Math.cos(0.18),
    collisionRadius: CHRONOS_VERDANT_PULSE_COLLISION_RADIUS,
    damageType: 'verdant_pulse',
  },
};

export const BLAZE_SCRAPSHOT_ATTACK: AttackConfig = {
  damage: BLAZE_SCRAPSHOT_PELLET_DAMAGE,
  range: BLAZE_SCRAPSHOT_RANGE,
  cooldownMs: BLAZE_ROCKET_FIRE_INTERVAL_MS,
  coneDot: 1,
  collisionRadius: BLAZE_SCRAPSHOT_AEGIS_COLLISION_RADIUS,
  damageType: 'scrapshot',
};

export const BLAZE_PHOSPHOR_FLARE_ATTACK: AttackConfig = {
  damage: BLAZE_PHOSPHOR_FLARE_DAMAGE,
  range: BLAZE_PHOSPHOR_FLARE_MAX_RANGE,
  cooldownMs: BLAZE_PHOSPHOR_FLARE_COOLDOWN_MS,
  coneDot: 1,
  radius: BLAZE_PHOSPHOR_FLARE_RADIUS,
  collisionRadius: BLAZE_PHOSPHOR_FLARE_AEGIS_COLLISION_RADIUS,
  damageType: 'phosphor_flare',
};

export const SECONDARY_ATTACKS: Partial<Record<HeroId, AttackConfig>> = {
  phantom: {
    damage: PHANTOM_VOID_RAY_DAMAGE,
    range: 42,
    cooldownMs: PHANTOM_VOID_RAY_COOLDOWN_MS,
    coneDot: Math.cos(0.12),
    collisionRadius: PHANTOM_VOID_RAY_COLLISION_RADIUS,
    damageType: 'void_ray',
  },
  hookshot: {
    damage: HOOKSHOT_DRAG_HOOK_DAMAGE,
    range: HOOKSHOT_DRAG_HOOK_MAX_DISTANCE,
    cooldownMs: HOOKSHOT_DRAG_HOOK_COOLDOWN_MS,
    coneDot: Math.cos(0.14),
    collisionRadius: HOOKSHOT_DRAG_HOOK_COLLISION_RADIUS,
    targetTeam: 'any',
    damageType: 'drag_hook',
  },
  blaze: {
    damage: BLAZE_BOMB_DAMAGE,
    range: BLAZE_BOMB_MAX_RANGE,
    cooldownMs: BLAZE_BOMB_COOLDOWN_MS,
    coneDot: Math.cos(0.32),
    radius: BLAZE_BOMB_SPLASH_RADIUS,
    damageType: 'bomb',
  },
};

export interface AttackPreflightInput {
  isHeroId: boolean;
  playerState: string;
  mode: AttackMode;
  attackExists: boolean;
  isCoolingDown: boolean;
  phantomPrimaryReady: boolean;
  chronosPrimaryReady: boolean;
  phantomPrimaryShotAvailable: boolean;
  blazePrimaryShotAvailable: boolean;
  chronosPrimaryShotAvailable: boolean;
}

export function getRoomAttackConfig(input: {
  heroId: HeroId;
  mode: AttackMode;
  chronosAscendantActive: boolean;
  blazePrimarySkill?: BlazePrimarySkill;
  blazeSecondarySkill?: BlazeSecondarySkill;
}): AttackConfig | null {
  if (input.heroId === 'blaze' && input.mode === 'primary' && input.blazePrimarySkill === 'scrapshot') {
    return BLAZE_SCRAPSHOT_ATTACK;
  }
  if (input.heroId === 'blaze' && input.mode === 'secondary' && input.blazeSecondarySkill === 'phosphor_flare') {
    return BLAZE_PHOSPHOR_FLARE_ATTACK;
  }
  const baseAttack = input.mode === 'primary'
    ? PRIMARY_ATTACKS[input.heroId]
    : SECONDARY_ATTACKS[input.heroId];
  if (!baseAttack) return null;

  if (input.heroId === 'chronos' && input.mode === 'primary' && input.chronosAscendantActive) {
    return {
      ...baseAttack,
      damage: CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE,
      cooldownMs: CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS,
      radius: CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS,
      collisionRadius: CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS,
      range: Math.max(baseAttack.range, 42),
      damageType: 'ascendant_verdant_pulse',
    };
  }

  return baseAttack;
}

export function shouldResolveBlazeSecondaryAttack(input: {
  skill: BlazeSecondarySkill;
  secondaryFire: boolean;
  previousSecondaryFire: boolean;
}): boolean {
  return input.skill === 'phosphor_flare'
    ? input.secondaryFire && !input.previousSecondaryFire
    : !input.secondaryFire && input.previousSecondaryFire;
}

export function getAttackPreflightRejection(input: AttackPreflightInput): { reason: string; logEvent: boolean } | null {
  if (!input.isHeroId || input.playerState !== 'alive') {
    return { reason: `attack_invalid_state:${input.mode}`, logEvent: true };
  }
  if (!input.attackExists) {
    return { reason: `attack_missing_config:${input.mode}`, logEvent: true };
  }
  if (input.isCoolingDown) {
    return { reason: `attack_cooldown:${input.mode}`, logEvent: false };
  }
  if (input.mode === 'primary' && !input.phantomPrimaryReady) {
    return { reason: 'phantom_primary_not_ready', logEvent: false };
  }
  if (input.mode === 'primary' && !input.chronosPrimaryReady) {
    return { reason: 'chronos_primary_not_ready', logEvent: false };
  }
  if (input.mode === 'primary' && !input.phantomPrimaryShotAvailable) {
    return { reason: 'phantom_primary_no_ammo', logEvent: false };
  }
  if (input.mode === 'primary' && !input.blazePrimaryShotAvailable) {
    return { reason: 'blaze_primary_no_ammo', logEvent: false };
  }
  if (input.mode === 'primary' && !input.chronosPrimaryShotAvailable) {
    return { reason: 'chronos_primary_no_ammo', logEvent: false };
  }
  return null;
}

export function getChronosAegisCollisionRadiusForAttack(attack: Pick<AttackConfig, 'damageType'>): number {
  switch (attack.damageType) {
    case 'chain_hooks':
      return HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS;
    case 'drag_hook':
      return HOOKSHOT_DRAG_HOOK_COLLISION_RADIUS;
    case 'dire_ball':
      return PHANTOM_DIRE_BALL_COLLISION_RADIUS;
    case 'rocket':
      return BLAZE_ROCKET_COLLISION_RADIUS;
    case 'scrapshot':
      return BLAZE_SCRAPSHOT_AEGIS_COLLISION_RADIUS;
    case 'bomb':
      return BLAZE_BOMB_AEGIS_COLLISION_RADIUS;
    case 'phosphor_flare':
      return BLAZE_PHOSPHOR_FLARE_AEGIS_COLLISION_RADIUS;
    case 'verdant_pulse':
      return CHRONOS_VERDANT_PULSE_COLLISION_RADIUS;
    case 'ascendant_verdant_pulse':
      return CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS;
    default:
      return 0;
  }
}

export function buildAttackImpactHint(input: {
  aegisBlocksAttack: boolean;
  aegisPoint?: PlainVec3 | null;
}): SkillImpactHint {
  return input.aegisBlocksAttack && input.aegisPoint
    ? {
      impactPosition: input.aegisPoint,
      interceptedByChronosAegis: true,
    }
    : {};
}

export function getAttackCastKind(input: {
  heroId: HeroId;
  mode: AttackMode;
}): AttackCastKind | null {
  if (input.heroId === 'phantom') {
    return input.mode === 'primary' ? 'phantom_dire_ball' : 'phantom_void_ray';
  }
  if (input.heroId === 'hookshot') {
    return input.mode === 'primary' ? 'hookshot_basic_attack' : 'hookshot_heavy_attack';
  }
  if (input.heroId === 'chronos' && input.mode === 'primary') {
    return 'chronos_verdant_pulse';
  }
  return null;
}

export function withHookshotHeavyAttackTargetHint(input: {
  impactHint: SkillImpactHint;
  mode: AttackMode;
  aegisBlocksAttack: boolean;
  targetId?: string | null;
}): SkillImpactHint {
  return {
    ...input.impactHint,
    targetIds: input.mode === 'secondary' && !input.aegisBlocksAttack && input.targetId
      ? [input.targetId]
      : undefined,
  };
}

export function getAttackDamageResolutionPlan(input: {
  heroId: HeroId;
  mode: AttackMode;
  aegisBlocksAttack: boolean;
  hasPrimaryTarget: boolean;
  attackRadius?: number;
}): AttackDamageResolutionPlan {
  if (input.aegisBlocksAttack) {
    return {
      action: 'chronos_aegis_absorb',
      startHookshotDragPull: false,
    };
  }

  if (!input.hasPrimaryTarget) {
    return {
      action: 'none',
      startHookshotDragPull: false,
    };
  }

  return {
    action: input.attackRadius && input.attackRadius > 0 ? 'area_damage' : 'direct_damage',
    startHookshotDragPull: input.heroId === 'hookshot' && input.mode === 'secondary',
  };
}
