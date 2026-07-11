import type { HeroDefinition, HeroId, HeroStats } from '../types/hero.js';
import type { AbilityDefinition } from '../types/ability.js';
import {
  BLAZE_FLAMETHROWER_BURN_DAMAGE,
  BLAZE_FLAMETHROWER_BURN_INTERVAL_MS,
  BLAZE_FLAMETHROWER_BURN_TICKS,
  BLAZE_FLAMETHROWER_DAMAGE,
  BLAZE_FLAMETHROWER_FUEL_DRAIN,
  BLAZE_FLAMETHROWER_FUEL_REGEN,
  BLAZE_GEARSTORM_RADIUS,
} from './physics.js';

// Default hero stats - used as fallback when no hero is selected
export const DEFAULT_HERO_STATS: HeroStats = {
  maxHealth: 180,
  moveSpeed: 4.08,
  jumpForce: 8.3,
  size: { width: 0.8, height: 1.8, depth: 0.8 },
};

// Helper to get hero stats with fallback
export function getHeroStats(heroId: HeroId | null | undefined): HeroStats {
  if (heroId && HERO_DEFINITIONS[heroId]) {
    return HERO_DEFINITIONS[heroId].stats;
  }
  return DEFAULT_HERO_STATS;
}

export const PHANTOM_PRIMARY_MAGAZINE_SIZE = 12;
export const PHANTOM_PRIMARY_RELOAD_SECONDS = 2;
export const PHANTOM_PRIMARY_RELOAD_MS = PHANTOM_PRIMARY_RELOAD_SECONDS * 1000;
export const PHANTOM_DIRE_BALL_DAMAGE = 18;
export const PHANTOM_DIRE_BALL_SPEED = 91;
export const PHANTOM_DIRE_BALL_COLLISION_RADIUS = 0.21;
export const PHANTOM_SOULREND_DAMAGE = 14;
export const PHANTOM_SOULREND_MAGAZINE_SIZE = 10;
export const PHANTOM_SOULREND_SPEED = 120;
export const PHANTOM_SOULREND_COLLISION_RADIUS = 0.16;
export const PHANTOM_SOULREND_RICOCHET_RADIUS = 8;
export const PHANTOM_PRIMARY_FIRE_READY_MS = 240;
export const PHANTOM_PRIMARY_COOLDOWN_MS = 250;
export const HERO_OUT_OF_COMBAT_REGEN_DELAY_MS = 4000;
export const HERO_OUT_OF_COMBAT_REGEN_CAP_RATIO = 0.5;
export const HERO_OUT_OF_COMBAT_REGEN_PER_SECOND = 10;
export const PHANTOM_VOID_RAY_COOLDOWN_SECONDS = 5;
export const PHANTOM_VOID_RAY_COOLDOWN_MS = PHANTOM_VOID_RAY_COOLDOWN_SECONDS * 1000;
export const PHANTOM_VOID_RAY_DAMAGE = 51;
export const PHANTOM_VOID_RAY_COLLISION_RADIUS = 0.45;
export const VOID_RAY_CHARGE_TIME = 1000; // milliseconds to fully charge void ray
export const PHANTOM_RIFT_BOLT_DAMAGE = 22;
export const PHANTOM_RIFT_BOLT_SPEED = 12;
export const PHANTOM_RIFT_BOLT_MAX_DISTANCE = 30;
export const PHANTOM_RIFT_BOLT_COLLISION_RADIUS = 0.38;
export const PHANTOM_RIFT_BOLT_COOLDOWN_SECONDS = 6;
export const PHANTOM_RIFT_BOLT_COOLDOWN_MS = PHANTOM_RIFT_BOLT_COOLDOWN_SECONDS * 1000;
export const PHANTOM_RIFT_BOLT_LIFETIME_MS = PHANTOM_RIFT_BOLT_COOLDOWN_MS;
export const PHANTOM_BLINK_DISTANCE = 8;
export const PHANTOM_VOID_ZONE_RADIUS = 3;
export const PHANTOM_VOID_ZONE_DAMAGE = 12;
export const PHANTOM_VOID_ZONE_DURATION_SECONDS = 4;
export const PHANTOM_VOID_ZONE_DAMAGE_INTERVAL_MS = 500;
export const PHANTOM_PERSONAL_SHIELD_ABSORBED_HITS = 1;
export const PHANTOM_VEIL_SPEED_BONUS_PERCENT = 30;
export const PHANTOM_VEIL_SPEED_MULTIPLIER = 1 + PHANTOM_VEIL_SPEED_BONUS_PERCENT / 100;

export const HOOKSHOT_CHAIN_HOOKS_DAMAGE = 16;
export const HOOKSHOT_CHAIN_HOOKS_COOLDOWN_MS = 475;
export const HOOKSHOT_CHAIN_HOOKS_COOLDOWN_SECONDS = HOOKSHOT_CHAIN_HOOKS_COOLDOWN_MS / 1000;
export const HOOKSHOT_CHAIN_HOOKS_MAX_DISTANCE = 17.5;
export const HOOKSHOT_CHAIN_HOOKS_COLLISION_RADIUS = 0.22;
export const HOOKSHOT_DRAG_HOOK_DAMAGE = 24;
export const HOOKSHOT_DRAG_HOOK_COOLDOWN_SECONDS = 6;
export const HOOKSHOT_DRAG_HOOK_COOLDOWN_MS = HOOKSHOT_DRAG_HOOK_COOLDOWN_SECONDS * 1000;
export const HOOKSHOT_DRAG_HOOK_MAX_DISTANCE = 24;
export const HOOKSHOT_DRAG_HOOK_COLLISION_RADIUS = 0.28;
export const HOOKSHOT_DRAG_HOOK_PULL_FRONT_DISTANCE = 1.35;
export const HOOKSHOT_DRAG_HOOK_PULL_MAX_DURATION_MS = 1500;
export const HOOKSHOT_DRAG_HOOK_PULL_STOP_DISTANCE = 0.32;
export const HOOKSHOT_DRAG_HOOK_RETRACT_SPEED = 55;
export const HOOKSHOT_GROUND_HOOKS_RADIUS = 13.9;
export const HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS = 3;
export const HOOKSHOT_GROUND_HOOKS_HOOKS_PER_TARGET = 3;

export const CHRONOS_LIFELINE_RADIUS = 14;
export const CHRONOS_LIFELINE_ALLY_HEAL = 70;
export const CHRONOS_LIFELINE_SELF_HEAL = 25;
export const CHRONOS_LIFELINE_MAX_TARGETS = 3;
export const CHRONOS_LIFELINE_RELEASE_DELAY_MS = 210;
export const CHRONOS_LIFELINE_BEAM_DURATION_MS = 620;
export const CHRONOS_LIFELINE_SOURCE_HEIGHT = 1.18;
export const CHRONOS_LIFELINE_TARGET_HEIGHT = 1.02;
export const CHRONOS_VERDANT_PULSE_DAMAGE = 16;
export const CHRONOS_PRIMARY_MAGAZINE_SIZE = 20;
export const CHRONOS_PRIMARY_RELOAD_SECONDS = 1.8;
export const CHRONOS_PRIMARY_RELOAD_MS = CHRONOS_PRIMARY_RELOAD_SECONDS * 1000;
export const CHRONOS_VERDANT_PULSE_COOLDOWN_MS = 300;
export const CHRONOS_VERDANT_PULSE_FIRE_READY_MS = 140;
export const CHRONOS_VERDANT_PULSE_SPEED = 68;
export const CHRONOS_VERDANT_PULSE_COLLISION_RADIUS = 0.18;
export const CHRONOS_VERDANT_PULSE_AIM_DISTANCE = 120;
export const CHRONOS_VERDANT_PULSE_SPAWN_FORWARD_OFFSET = 0.82;
export const CHRONOS_AEGIS_SHIELD_MAX_HP = 500;
export const CHRONOS_AEGIS_SHIELD_RECHARGE_PER_SECOND = 80;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE = 11;
export const CHRONOS_TIMEBREAK_RADIUS = CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE = Math.PI / 5;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_MAX_VERTICAL_DELTA = 4.5;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_KNOCKBACK_FORCE = 13.5;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_VERTICAL_FORCE = 3.2;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_AUTHORITY_MS = 650;
export const CHRONOS_TIMEBREAK_RELEASE_DELAY_MS = 420;
export const CHRONOS_ASCENDANT_PARADOX_DURATION_MS = 10000;
export const CHRONOS_ASCENDANT_PARADOX_LIFT_VERTICAL_FORCE = 18.5;
export const CHRONOS_ASCENDANT_PARADOX_LIFT_FORWARD_FORCE = 4.2;
export const CHRONOS_ASCENDANT_PARADOX_LIFT_POSITION_BOOST = 0.75;
export const CHRONOS_ASCENDANT_PARADOX_MAX_ELEVATION_GAIN = 22;
export const CHRONOS_ASCENDANT_PARADOX_SPEED_MULTIPLIER = 1.38;
export const CHRONOS_ASCENDANT_PARADOX_AIR_ACCEL_MULTIPLIER = 1.9;
export const CHRONOS_ASCENDANT_PARADOX_GRAVITY_SCALE = 0.18;
export const CHRONOS_ASCENDANT_PARADOX_VERTICAL_ACCEL = 22;
export const CHRONOS_ASCENDANT_PARADOX_MAX_ASCEND_SPEED = 14;
export const CHRONOS_ASCENDANT_PARADOX_MAX_DESCEND_SPEED = -5.5;
export const CHRONOS_ASCENDANT_PARADOX_HOVER_DAMPING = 7.5;
export const CHRONOS_ASCENDANT_PARADOX_HORIZONTAL_DAMPING = 8;
export const CHRONOS_ASCENDANT_PARADOX_HORIZONTAL_STOP_SPEED = 0.12;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE = 24;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_RADIUS = 3.8;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_MIN_VISUAL_RADIUS_SCALE = 2.4;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_VISUAL_RADIUS_SCALE = 3.1;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_COLLISION_RADIUS =
  CHRONOS_VERDANT_PULSE_COLLISION_RADIUS * CHRONOS_ASCENDANT_PARADOX_PULSE_VISUAL_RADIUS_SCALE;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS = 360;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_SPEED = 54;

export const BLAZE_ROCKET_FIRE_INTERVAL_MS = 400;
export const BLAZE_PRIMARY_MAGAZINE_SIZE = 10;
export const BLAZE_PRIMARY_RELOAD_SECONDS = 1.5;
export const BLAZE_PRIMARY_RELOAD_MS = BLAZE_PRIMARY_RELOAD_SECONDS * 1000;
export const BLAZE_ROCKET_SPEED = 117.6;
export const BLAZE_ROCKET_DAMAGE = 24;
export const BLAZE_ROCKET_COLLISION_RADIUS = 0.21;
export const BLAZE_ROCKET_SPLASH_RADIUS = 2.8;
export const BLAZE_SCRAPSHOT_PELLET_COUNT = 6;
export const BLAZE_SCRAPSHOT_PELLET_DAMAGE = 8;
export const BLAZE_SCRAPSHOT_MAGAZINE_SIZE = 6;
export const BLAZE_SCRAPSHOT_RANGE = 14;
export const BLAZE_SCRAPSHOT_FULL_DAMAGE_RANGE = 4;
export const BLAZE_SCRAPSHOT_SPREAD_RADIANS = 0.14;
export const BLAZE_SCRAPSHOT_FALLOFF_SCALE = 0.75;
export const BLAZE_SCRAPSHOT_AEGIS_COLLISION_RADIUS = 0.06;
export const BLAZE_BOMB_COOLDOWN_SECONDS = 5;
export const BLAZE_BOMB_COOLDOWN_MS = BLAZE_BOMB_COOLDOWN_SECONDS * 1000;
export const BLAZE_BOMB_DAMAGE = 51;
export const BLAZE_BOMB_SPLASH_RADIUS = 4;
export const BLAZE_BOMB_MAX_RANGE = 60;
export const BLAZE_BOMB_MIN_RANGE = 3;
export const BLAZE_BOMB_AEGIS_COLLISION_RADIUS = 0.65;
export const BLAZE_PHOSPHOR_FLARE_COOLDOWN_SECONDS = 6;
export const BLAZE_PHOSPHOR_FLARE_COOLDOWN_MS = BLAZE_PHOSPHOR_FLARE_COOLDOWN_SECONDS * 1000;
export const BLAZE_PHOSPHOR_FLARE_DAMAGE = 12;
export const BLAZE_PHOSPHOR_FLARE_DAMAGE_INTERVAL_MS = 500;
export const BLAZE_PHOSPHOR_FLARE_DURATION_SECONDS = 4;
export const BLAZE_PHOSPHOR_FLARE_DURATION_MS = BLAZE_PHOSPHOR_FLARE_DURATION_SECONDS * 1000;
export const BLAZE_PHOSPHOR_FLARE_RADIUS = 3.4;
export const BLAZE_PHOSPHOR_FLARE_MAX_RANGE = 32;
export const BLAZE_PHOSPHOR_FLARE_MIN_RANGE = 2.5;
export const BLAZE_PHOSPHOR_FLARE_AEGIS_COLLISION_RADIUS = 0.2;
export const BLAZE_AFTERBURNER_COOLDOWN_SECONDS = 7;
export const BLAZE_AFTERBURNER_TRAIL_DAMAGE = 6;
export const BLAZE_AFTERBURNER_TRAIL_DAMAGE_INTERVAL_MS = 600;
export const BLAZE_AFTERBURNER_TRAIL_DURATION_SECONDS = 2.4;
export const BLAZE_AFTERBURNER_TRAIL_DURATION_MS = BLAZE_AFTERBURNER_TRAIL_DURATION_SECONDS * 1000;
export const BLAZE_AFTERBURNER_TRAIL_RADIUS = 1.35;
export const BLAZE_AFTERBURNER_TRAIL_SAMPLE_SPACING = 0.45;
export const BLAZE_FLAMETHROWER_COLLISION_RADIUS = 0.42;
export const BLAZE_GEARSTORM_DAMAGE = 14;
export const BLAZE_GEARSTORM_DAMAGE_INTERVAL_MS = 400;
export const BLAZE_GEARSTORM_DURATION_SECONDS = 6;
export const BLAZE_GEARSTORM_DURATION_MS = BLAZE_GEARSTORM_DURATION_SECONDS * 1000;
export const BLAZE_PHOENIX_DIVE_DAMAGE = 80;
export const BLAZE_PHOENIX_DIVE_RADIUS = 5;
export const BLAZE_PHOENIX_DIVE_MAX_RANGE = BLAZE_BOMB_MAX_RANGE;

export type AbilityCardStatFormat = 'number' | 'seconds';

export interface AbilityCardStat {
  value: number;
  label: string;
  format?: AbilityCardStatFormat;
  prefix?: string;
  suffix?: string;
}

export const ABILITY_CARD_STATS = {
  phantom_dire_ball: [
    { value: PHANTOM_DIRE_BALL_DAMAGE, label: 'dmg' },
    { value: PHANTOM_PRIMARY_MAGAZINE_SIZE, label: 'ammo' },
    { value: PHANTOM_PRIMARY_RELOAD_SECONDS, label: 'reload', format: 'seconds' },
  ],
  phantom_soulrend_daggers: [
    { value: PHANTOM_SOULREND_DAMAGE, label: 'dmg' },
    { value: 1, label: 'ricochet' },
    { value: PHANTOM_SOULREND_MAGAZINE_SIZE, label: 'ammo' },
    { value: PHANTOM_PRIMARY_RELOAD_SECONDS, label: 'reload', format: 'seconds' },
  ],
  phantom_void_ray: [
    { value: PHANTOM_VOID_RAY_DAMAGE, label: 'dmg' },
    { value: VOID_RAY_CHARGE_TIME / 1000, label: 'charge', format: 'seconds' },
  ],
  phantom_rift_bolt: [
    { value: PHANTOM_RIFT_BOLT_DAMAGE, label: 'dmg' },
    { value: PHANTOM_RIFT_BOLT_SPEED, label: 'speed' },
    { value: PHANTOM_RIFT_BOLT_MAX_DISTANCE, label: 'range' },
  ],
  phantom_blink: [
    { value: PHANTOM_VOID_ZONE_DAMAGE, label: 'dmg/tick' },
  ],
  phantom_personal_shield: [
    { value: PHANTOM_PERSONAL_SHIELD_ABSORBED_HITS, label: 'hit', prefix: 'absorbs ' },
  ],
  phantom_veil: [
    { value: PHANTOM_VEIL_SPEED_BONUS_PERCENT, label: 'speed', prefix: '+', suffix: '%' },
  ],
  hookshot_basic_attack: [
    { value: HOOKSHOT_CHAIN_HOOKS_DAMAGE, label: 'dmg' },
  ],
  hookshot_heavy_attack: [
    { value: HOOKSHOT_DRAG_HOOK_DAMAGE, label: 'dmg' },
  ],
  hookshot_ground_hooks: [
    { value: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS, label: 'root', format: 'seconds' },
    { value: HOOKSHOT_GROUND_HOOKS_RADIUS, label: 'radius' },
  ],
  blaze_rocket: [
    { value: BLAZE_ROCKET_DAMAGE, label: 'dmg' },
    { value: BLAZE_PRIMARY_MAGAZINE_SIZE, label: 'ammo' },
    { value: BLAZE_PRIMARY_RELOAD_SECONDS, label: 'reload', format: 'seconds' },
  ],
  blaze_scrapshot: [
    { value: BLAZE_SCRAPSHOT_PELLET_DAMAGE, label: `dmg x${BLAZE_SCRAPSHOT_PELLET_COUNT}` },
    { value: BLAZE_SCRAPSHOT_MAGAZINE_SIZE, label: 'ammo' },
    { value: BLAZE_PRIMARY_RELOAD_SECONDS, label: 'reload', format: 'seconds' },
  ],
  blaze_bomb: [
    { value: BLAZE_BOMB_DAMAGE, label: 'dmg' },
  ],
  blaze_phosphor_flare: [
    { value: BLAZE_PHOSPHOR_FLARE_DAMAGE, label: 'dmg/tick' },
    { value: BLAZE_PHOSPHOR_FLARE_RADIUS, label: 'radius' },
    { value: BLAZE_PHOSPHOR_FLARE_DURATION_SECONDS, label: 'duration', format: 'seconds' },
  ],
  blaze_flamethrower: [
    { value: BLAZE_FLAMETHROWER_DAMAGE, label: 'dmg/tick' },
    { value: BLAZE_FLAMETHROWER_BURN_DAMAGE, label: `burn dmg x${BLAZE_FLAMETHROWER_BURN_TICKS}` },
    { value: BLAZE_FLAMETHROWER_BURN_INTERVAL_MS / 1000, label: 'burn interval', suffix: 's' },
    { value: BLAZE_FLAMETHROWER_FUEL_DRAIN, label: 'drain', suffix: '/s' },
    { value: BLAZE_FLAMETHROWER_FUEL_REGEN, label: 'regen', suffix: '/s' },
  ],
  blaze_afterburner: [
    { value: BLAZE_AFTERBURNER_TRAIL_DAMAGE, label: 'dmg/tick' },
    { value: BLAZE_AFTERBURNER_TRAIL_RADIUS, label: 'trail radius' },
    { value: BLAZE_AFTERBURNER_TRAIL_DURATION_SECONDS, label: 'trail duration', format: 'seconds' },
  ],
  blaze_airstrike: [
    { value: BLAZE_GEARSTORM_DAMAGE, label: 'dmg/tick' },
    { value: BLAZE_GEARSTORM_RADIUS, label: 'radius' },
    { value: BLAZE_GEARSTORM_DURATION_SECONDS, label: 'duration', format: 'seconds' },
  ],
  blaze_phoenix_dive: [
    { value: BLAZE_PHOENIX_DIVE_DAMAGE, label: 'impact dmg' },
    { value: BLAZE_PHOENIX_DIVE_RADIUS, label: 'radius' },
  ],
  chronos_verdant_pulse: [
    { value: CHRONOS_VERDANT_PULSE_DAMAGE, label: 'dmg' },
    { value: CHRONOS_PRIMARY_MAGAZINE_SIZE, label: 'ammo' },
    { value: CHRONOS_PRIMARY_RELOAD_SECONDS, label: 'reload', format: 'seconds' },
    { value: CHRONOS_ASCENDANT_PARADOX_PULSE_DAMAGE, label: 'dmg with AOE during F' },
  ],
  chronos_lifeline_conduit: [
    { value: CHRONOS_LIFELINE_ALLY_HEAL, label: 'ally heal' },
    { value: CHRONOS_LIFELINE_SELF_HEAL, label: 'self heal' },
    { value: CHRONOS_LIFELINE_MAX_TARGETS, label: 'targets' },
  ],
} as const satisfies Record<string, readonly AbilityCardStat[]>;

export const HERO_DEFINITIONS: Record<HeroId, HeroDefinition> = {
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    role: 'flanker',
    movementFocus: 'blink',
    stats: {
      maxHealth: 180,
      moveSpeed: 3.18,
      jumpForce: 8.3,
      size: { width: 0.8, height: 1.8, depth: 0.8 },
    },
    passive: {
      name: 'No Passive',
      description: 'Phantom does not have a separate passive effect.',
    },
    ability1: { abilityId: 'phantom_blink', defaultKey: 'KeyE' },
    ability2: { abilityId: 'phantom_personal_shield', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'phantom_veil', defaultKey: 'KeyF' },
    description: 'A stealthy flanker who uses short-range teleportation to outmaneuver enemies.',
  },

  hookshot: {
    id: 'hookshot',
    name: 'Hookshot',
    role: 'mobile',
    movementFocus: 'grapple',
    stats: {
      maxHealth: 200,
      moveSpeed: 3.63,
      jumpForce: 7.9,
      size: { width: 0.8, height: 1.8, depth: 0.8 },
    },
    passive: {
      name: 'No Passive',
      description: 'Hookshot does not have a separate passive effect.',
    },
    ability1: { abilityId: 'hookshot_grapple', defaultKey: 'KeyE' },
    ability2: { abilityId: 'hookshot_anchor_wall', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'hookshot_ground_hooks', defaultKey: 'KeyF' },
    description: 'A highly mobile fighter who uses grappling hooks and anchor walls to reshape fights.',
  },

  blaze: {
    id: 'blaze',
    name: 'Blaze',
    role: 'assault',
    movementFocus: 'aerial',
    stats: {
      maxHealth: 200,
      moveSpeed: 3.63,
      jumpForce: 9.0,
      size: { width: 0.9, height: 1.9, depth: 0.9 },
    },
    passive: {
      name: 'No Passive',
      description: 'Blaze does not have a separate passive effect.',
    },
    ability1: { abilityId: 'blaze_flamethrower', defaultKey: 'KeyE' },
    ability2: { abilityId: 'blaze_rocketjump', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'blaze_airstrike', defaultKey: 'KeyF' },
    description: 'An assault specialist with sustained fire pressure and explosive abilities.',
  },

  chronos: {
    id: 'chronos',
    name: 'Chronos',
    role: 'support-tank',
    movementFocus: 'temporal',
    stats: {
      maxHealth: 240,
      moveSpeed: 3.48,
      jumpForce: 8.1,
      size: { width: 0.78, height: 1.9, depth: 0.78 },
    },
    passive: {
      name: 'No Passive',
      description: 'Chronos does not have a separate passive effect.',
    },
    ability1: { abilityId: 'chronos_lifeline_conduit', defaultKey: 'KeyE' },
    ability2: { abilityId: 'chronos_timebreak', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'chronos_ascendant_paradox', defaultKey: 'KeyF' },
    description: 'A time-warping support tank who bends momentum, protects allies, and turns pressure into recovery.',
  },

};

export const ABILITY_DEFINITIONS: Record<string, AbilityDefinition> = {
  // Phantom Abilities
  phantom_blink: {
    id: 'phantom_blink',
    name: 'Blink',
    type: 'movement',
    targeting: 'direction',
    cooldown: 10,
    charges: 2,
    chargeRegenTime: 10, // Both charges reset after 10 seconds
    description: 'Instantly teleport in your aim direction, leaving a void zone at the destination. 2 charges.',
  },
  phantom_void_ray: {
    id: 'phantom_void_ray',
    name: 'Void Ray',
    type: 'offensive',
    targeting: 'direction',
    cooldown: PHANTOM_VOID_RAY_COOLDOWN_SECONDS,
    description: 'Hold to charge for 1 second, then release a piercing long-range beam.',
  },
  phantom_rift_bolt: {
    id: 'phantom_rift_bolt',
    name: 'Rift Bolt',
    type: 'movement',
    targeting: 'direction',
    cooldown: PHANTOM_RIFT_BOLT_COOLDOWN_SECONDS,
    duration: PHANTOM_RIFT_BOLT_LIFETIME_MS / 1000,
    description: 'Fire a slow void orb that deals damage on impact. Re-press secondary fire to teleport to it.',
  },
  phantom_personal_shield: {
    id: 'phantom_personal_shield',
    name: 'Shadow Bubble',
    type: 'defensive',
    targeting: 'self',
    cooldown: 10,
    duration: 10,
    description: 'Surround yourself with a protective shadow bubble that absorbs one hit or lasts 10 seconds.',
  },
  phantom_veil: {
    id: 'phantom_veil',
    name: 'Phantom Veil',
    type: 'ultimate',
    targeting: 'self',
    cooldown: 0,
    duration: 6,
    resourceCost: 100,
    description: 'Become invisible and move 30% faster for 6 seconds. Attacking breaks invisibility.',
  },

  // Hookshot Abilities
  hookshot_grapple: {
    id: 'hookshot_grapple',
    name: 'Grapple Pull',
    type: 'movement',
    targeting: 'direction',
    cooldown: 6,
    description: 'Fire a quick medium-range hook that grabs geometry and pulls you in.',
  },
  hookshot_anchor_wall: {
    id: 'hookshot_anchor_wall',
    name: 'Anchor Wall',
    type: 'defensive',
    targeting: 'direction',
    cooldown: 8,
    duration: 6.25,
    description: 'Launch a ground anchor that raises a solid barricade in your aim direction.',
  },
  hookshot_ground_hooks: {
    id: 'hookshot_ground_hooks',
    name: 'Ground Hooks',
    type: 'ultimate',
    targeting: 'area',
    cooldown: 0,
    duration: HOOKSHOT_GROUND_HOOKS_ROOT_DURATION_SECONDS,
    resourceCost: 100,
    description: 'Root nearby enemies for 3 seconds as three ground hooks tear up around each target and tether them in place.',
  },
  hookshot_basic_attack: {
    id: 'hookshot_basic_attack',
    name: 'Chain Hooks',
    type: 'offensive',
    targeting: 'direction',
    cooldown: HOOKSHOT_CHAIN_HOOKS_COOLDOWN_SECONDS,
    description: 'Fire short-range hooks attached by rope that shoot forward and retract.',
  },
  hookshot_heavy_attack: {
    id: 'hookshot_heavy_attack',
    name: 'Drag Hook',
    type: 'offensive',
    targeting: 'direction',
    cooldown: HOOKSHOT_DRAG_HOOK_COOLDOWN_SECONDS,
    description: 'Fire a long-range hook that attaches to heroes and pulls them in front of you.',
  },

  // Blaze Abilities
  blaze_bomb: {
    id: 'blaze_bomb',
    name: 'Meteor Strike',
    type: 'offensive',
    targeting: 'ground',
    cooldown: BLAZE_BOMB_COOLDOWN_SECONDS,
    description: 'Mark a target zone, then call a blazing meteor down at an angle.',
  },
  blaze_phosphor_flare: {
    id: 'blaze_phosphor_flare',
    name: 'Phosphor Flare',
    type: 'offensive',
    targeting: 'ground',
    cooldown: BLAZE_PHOSPHOR_FLARE_COOLDOWN_SECONDS,
    duration: BLAZE_PHOSPHOR_FLARE_DURATION_SECONDS,
    description: 'Lob a thermite canister that burns a ground zone for 4 seconds.',
  },
  blaze_flamethrower: {
    id: 'blaze_flamethrower',
    name: 'Flamethrower',
    type: 'offensive',
    targeting: 'direction',
    cooldown: 0,
    description: 'Hold to spray a short-range cone of flame. Hits ignite enemies for lingering burn damage. Consumes fuel that regenerates when not firing.',
  },
  blaze_rocketjump: {
    id: 'blaze_rocketjump',
    name: 'Rocket Jump',
    type: 'movement',
    targeting: 'instant',
    cooldown: 8,
    description: 'Launch yourself upward and forward with an explosion.',
  },
  blaze_afterburner: {
    id: 'blaze_afterburner',
    name: 'Afterburner Dash',
    type: 'movement',
    targeting: 'direction',
    cooldown: BLAZE_AFTERBURNER_COOLDOWN_SECONDS,
    description: 'Dash horizontally in your facing direction, leaving a damaging fire trail behind you.',
  },
  blaze_airstrike: {
    id: 'blaze_airstrike',
    name: 'Infernal Gearstorm',
    type: 'ultimate',
    targeting: 'instant',
    cooldown: 0,
    duration: BLAZE_GEARSTORM_DURATION_SECONDS,
    resourceCost: 100,
    description: 'Ignite a massive area around yourself, scorching the ground while flaming cogs spin through the air.',
  },
  blaze_phoenix_dive: {
    id: 'blaze_phoenix_dive',
    name: 'Phoenix Dive',
    type: 'ultimate',
    targeting: 'ground',
    cooldown: 0,
    resourceCost: 100,
    description: 'Launch high into the air, then crash down at a targeted location in a huge fiery explosion.',
  },

  // Chronos Abilities
  chronos_lifeline_conduit: {
    id: 'chronos_lifeline_conduit',
    name: 'Lifeline Conduit',
    type: 'utility',
    targeting: 'area',
    cooldown: 15,
    charges: 3,
    chargeRegenTime: 15,
    description: 'Press E to queue Lifeline. While the pyramid pulses, LMB heals up to 3 nearby teammates for a large amount; RMB heals only Chronos for less. 3 charges; cooldown begins after all charges are spent.',
  },
  chronos_timebreak: {
    id: 'chronos_timebreak',
    name: 'Timebreak',
    type: 'utility',
    targeting: 'direction',
    cooldown: 6,
    description: 'Send a forward temporal shockwave that knocks enemy heroes away from Chronos.',
  },
  chronos_ascendant_paradox: {
    id: 'chronos_ascendant_paradox',
    name: 'Ascendant Paradox',
    type: 'ultimate',
    targeting: 'self',
    cooldown: 0,
    duration: CHRONOS_ASCENDANT_PARADOX_DURATION_MS / 1000,
    resourceCost: 100,
    description: 'Lift off for 10 seconds and supercharge Verdant Pulse into larger green AOE blasts while airborne.',
  },

};

export function getHeroDefinition(heroId: HeroId): HeroDefinition {
  return HERO_DEFINITIONS[heroId];
}

export function getAbilityDefinition(abilityId: string): AbilityDefinition | undefined {
  return ABILITY_DEFINITIONS[abilityId];
}

export const ALL_HERO_IDS: HeroId[] = Object.keys(HERO_DEFINITIONS) as HeroId[];
