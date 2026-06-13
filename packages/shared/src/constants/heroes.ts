import type { HeroDefinition, HeroId, HeroStats } from '../types/hero.js';
import type { AbilityDefinition } from '../types/ability.js';

// Default hero stats - used as fallback when no hero is selected
export const DEFAULT_HERO_STATS: HeroStats = {
  maxHealth: 200,
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
export const PHANTOM_PRIMARY_FIRE_READY_MS = 240;
export const PHANTOM_VOID_RAY_COOLDOWN_SECONDS = 3;
export const PHANTOM_VOID_RAY_COOLDOWN_MS = PHANTOM_VOID_RAY_COOLDOWN_SECONDS * 1000;
export const PHANTOM_BLINK_DISTANCE = 8;
export const PHANTOM_SHADOWSTEP_DISTANCE = 12;

export const CHRONOS_LIFELINE_RADIUS = 14;
export const CHRONOS_LIFELINE_HEAL = 40;
export const CHRONOS_LIFELINE_MAX_TARGETS = 3;
export const CHRONOS_LIFELINE_RELEASE_DELAY_MS = 210;
export const CHRONOS_LIFELINE_BEAM_DURATION_MS = 620;
export const CHRONOS_LIFELINE_SOURCE_HEIGHT = 1.18;
export const CHRONOS_LIFELINE_TARGET_HEIGHT = 1.02;
export const CHRONOS_VERDANT_PULSE_DAMAGE = 16;
export const CHRONOS_VERDANT_PULSE_COOLDOWN_MS = 250;
export const CHRONOS_VERDANT_PULSE_FIRE_READY_MS = 140;
export const CHRONOS_VERDANT_PULSE_SPEED = 68;
export const CHRONOS_VERDANT_PULSE_AIM_DISTANCE = 120;
export const CHRONOS_VERDANT_PULSE_SPAWN_FORWARD_OFFSET = 0.82;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE = 11;
export const CHRONOS_TIMEBREAK_RADIUS = CHRONOS_TIMEBREAK_SHOCKWAVE_RANGE;
export const CHRONOS_TIMEBREAK_SHOCKWAVE_HALF_ANGLE = Math.PI / 5;
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
export const CHRONOS_ASCENDANT_PARADOX_PULSE_COOLDOWN_MS = 360;
export const CHRONOS_ASCENDANT_PARADOX_PULSE_SPEED = 54;

export const HERO_DEFINITIONS: Record<HeroId, HeroDefinition> = {
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    role: 'flanker',
    movementFocus: 'blink',
    stats: {
      maxHealth: 200,
      moveSpeed: 3.18,
      jumpForce: 8.3,
      size: { width: 0.8, height: 1.8, depth: 0.8 },
    },
    passive: {
      name: 'Shadow Step',
      description: 'Move 10% faster when not taking damage for 3 seconds',
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
      maxHealth: 225,
      moveSpeed: 3.63,
      jumpForce: 7.9,
      size: { width: 0.8, height: 1.8, depth: 0.8 },
    },
    passive: {
      name: 'Momentum Master',
      description: 'Gain 15% bonus speed after hook movement for 2 seconds',
    },
    ability1: { abilityId: 'hookshot_grapple', defaultKey: 'KeyE' },
    ability2: { abilityId: 'hookshot_anchor_wall', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'hookshot_grapple_trap', defaultKey: 'KeyF' },
    description: 'A highly mobile fighter who uses grappling hooks and anchor walls to reshape fights.',
  },

  blaze: {
    id: 'blaze',
    name: 'Blaze',
    role: 'assault',
    movementFocus: 'aerial',
    stats: {
      maxHealth: 225,
      moveSpeed: 3.63,
      jumpForce: 9.0,
      size: { width: 0.9, height: 1.9, depth: 0.9 },
    },
    passive: {
      name: 'Afterburner',
      description: 'Flamethrower fuel regenerates 50% faster after getting a kill',
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
      maxHealth: 275,
      moveSpeed: 3.48,
      jumpForce: 8.1,
      size: { width: 0.78, height: 1.9, depth: 0.78 },
    },
    passive: {
      name: 'Temporal Bulwark',
      description: 'A front-line support-tank built to stabilize allies with shields, healing, and tempo control.',
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
    description: 'Instantly teleport a short distance in your movement direction. 2 charges.',
  },
  phantom_shadowstep: {
    id: 'phantom_shadowstep',
    name: 'Shadow Step',
    type: 'movement',
    targeting: 'ground',
    cooldown: 10,
    duration: 0.8,
    description: 'Mark a location and teleport there after a brief delay.',
  },
  phantom_void_ray: {
    id: 'phantom_void_ray',
    name: 'Void Ray',
    type: 'offensive',
    targeting: 'direction',
    cooldown: PHANTOM_VOID_RAY_COOLDOWN_SECONDS,
    description: 'Charge, then release a piercing beam at long range.',
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
  hookshot_grapple_trap: {
    id: 'hookshot_grapple_trap',
    name: 'Grapple Trap',
    type: 'ultimate',
    targeting: 'ground',
    cooldown: 0,
    duration: 8,
    resourceCost: 100,
    description: 'Throw a grapple device that hooks enemies in its AOE, holding them and dealing damage.',
  },
  hookshot_basic_attack: {
    id: 'hookshot_basic_attack',
    name: 'Chain Hooks',
    type: 'offensive',
    targeting: 'direction',
    cooldown: 0,
    description: 'Fire short-range hooks attached by rope that shoot forward and retract.',
  },
  hookshot_heavy_attack: {
    id: 'hookshot_heavy_attack',
    name: 'Drag Hook',
    type: 'offensive',
    targeting: 'direction',
    cooldown: 4,
    description: 'Fire a long-range hook that attaches to enemy heroes and pulls them toward you.',
  },

  // Blaze Abilities
  blaze_bomb: {
    id: 'blaze_bomb',
    name: 'Meteor Strike',
    type: 'offensive',
    targeting: 'ground',
    cooldown: 8,
    description: 'Mark a target zone, then call a blazing meteor down at an angle.',
  },
  blaze_flamethrower: {
    id: 'blaze_flamethrower',
    name: 'Flamethrower',
    type: 'offensive',
    targeting: 'direction',
    cooldown: 0,
    description: 'Hold to spray a short-range cone of flame. Consumes fuel that regenerates when grounded.',
  },
  blaze_rocketjump: {
    id: 'blaze_rocketjump',
    name: 'Rocket Jump',
    type: 'movement',
    targeting: 'instant',
    cooldown: 8,
    description: 'Launch yourself with an explosion. Deals damage to nearby enemies.',
  },
  blaze_airstrike: {
    id: 'blaze_airstrike',
    name: 'Infernal Gearstorm',
    type: 'ultimate',
    targeting: 'instant',
    cooldown: 0,
    duration: 5,
    resourceCost: 100,
    description: 'Ignite a massive area around yourself, scorching the ground while flaming cogs spin through the air.',
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
    description: 'Auto-target up to 3 teammates in the area, or Chronos if no teammate is nearby, and send green healing beams. 3 charges; cooldown begins after all charges are spent.',
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

// Phantom ability constants
export const VOID_RAY_CHARGE_TIME = 1000; // milliseconds to fully charge void ray
