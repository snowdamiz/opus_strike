import type { HeroDefinition, HeroId, HeroStats } from '../types/hero.js';
import type { AbilityDefinition } from '../types/ability.js';

// Default hero stats - used as fallback when no hero is selected
export const DEFAULT_HERO_STATS: HeroStats = {
  maxHealth: 200,
  moveSpeed: 9,
  jumpForce: 8.5,
  size: { width: 0.8, height: 1.8, depth: 0.8 },
};

// Helper to get hero stats with fallback
export function getHeroStats(heroId: HeroId | null | undefined): HeroStats {
  if (heroId && HERO_DEFINITIONS[heroId]) {
    return HERO_DEFINITIONS[heroId].stats;
  }
  return DEFAULT_HERO_STATS;
}

export const HERO_DEFINITIONS: Record<HeroId, HeroDefinition> = {
  phantom: {
    id: 'phantom',
    name: 'Phantom',
    role: 'flanker',
    movementFocus: 'blink',
    stats: {
      maxHealth: 175,
      moveSpeed: 7, // Reduced 20% from 10 for better balance
      jumpForce: 8.5,
      size: { width: 0.8, height: 1.8, depth: 0.8 },
    },
    passive: {
      name: 'Shadow Step',
      description: 'Move 10% faster when not taking damage for 3 seconds',
    },
    ability1: { abilityId: 'phantom_blink', defaultKey: 'KeyE' },
    ability2: { abilityId: 'phantom_shadowstep', defaultKey: 'KeyQ' },
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
      moveSpeed: 8,
      jumpForce: 8.1,
      size: { width: 0.8, height: 1.8, depth: 0.8 },
    },
    passive: {
      name: 'Momentum Master',
      description: 'Gain 15% bonus speed after swinging for 2 seconds',
    },
    ability1: { abilityId: 'hookshot_grapple', defaultKey: 'KeyE' },
    ability2: { abilityId: 'hookshot_swing', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'hookshot_zipline', defaultKey: 'KeyF' },
    description: 'A highly mobile fighter who uses grappling hooks to swing across the battlefield.',
  },

  blaze: {
    id: 'blaze',
    name: 'Blaze',
    role: 'assault',
    movementFocus: 'aerial',
    stats: {
      maxHealth: 200,
      moveSpeed: 8,
      jumpForce: 9.3,
      size: { width: 0.9, height: 1.9, depth: 0.9 },
    },
    passive: {
      name: 'Afterburner',
      description: 'Jetpack fuel regenerates 50% faster after getting a kill',
    },
    ability1: { abilityId: 'blaze_jetpack', defaultKey: 'KeyE' },
    ability2: { abilityId: 'blaze_rocketjump', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'blaze_airstrike', defaultKey: 'KeyF' },
    description: 'An aerial assault specialist with jetpack-powered mobility and explosive abilities.',
  },

  glacier: {
    id: 'glacier',
    name: 'Glacier',
    role: 'tank',
    movementFocus: 'parkour',
    stats: {
      maxHealth: 350,
      moveSpeed: 7,
      jumpForce: 7.3,
      size: { width: 1.0, height: 2.0, depth: 1.0 },
    },
    passive: {
      name: 'Permafrost',
      description: 'Take 20% less damage when sliding or wall running',
    },
    ability1: { abilityId: 'glacier_iceslide', defaultKey: 'KeyE' },
    ability2: { abilityId: 'glacier_wallclimb', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'glacier_fortress', defaultKey: 'KeyF' },
    description: 'A tank who combines ice-powered parkour with defensive abilities.',
  },

  pulse: {
    id: 'pulse',
    name: 'Pulse',
    role: 'support',
    movementFocus: 'speed',
    stats: {
      maxHealth: 175,
      moveSpeed: 9,
      jumpForce: 8.5,
      size: { width: 0.7, height: 1.7, depth: 0.7 },
    },
    passive: {
      name: 'Quick Recovery',
      description: 'Health regeneration starts after 2 seconds instead of 5',
    },
    ability1: { abilityId: 'pulse_speedboost', defaultKey: 'KeyE' },
    ability2: { abilityId: 'pulse_dash', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'pulse_haste', defaultKey: 'KeyF' },
    description: 'A support specialist who enhances team mobility with speed-boosting abilities.',
  },

  sentinel: {
    id: 'sentinel',
    name: 'Sentinel',
    role: 'defense',
    movementFocus: 'grounded',
    stats: {
      maxHealth: 300,
      moveSpeed: 7.5,
      jumpForce: 7.3,
      size: { width: 0.9, height: 1.9, depth: 0.9 },
    },
    passive: {
      name: 'Fortified',
      description: 'Cannot be knocked back while standing still',
    },
    ability1: { abilityId: 'sentinel_fortify', defaultKey: 'KeyE' },
    ability2: { abilityId: 'sentinel_barrier', defaultKey: 'KeyQ' },
    ultimate: { abilityId: 'sentinel_dome', defaultKey: 'KeyF' },
    description: 'A defensive anchor who excels at holding positions and protecting teammates.',
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
    name: 'Grapple Hook',
    type: 'movement',
    targeting: 'direction',
    cooldown: 6,
    description: 'Fire a grappling hook that pulls you toward the hit point.',
  },
  hookshot_swing: {
    id: 'hookshot_swing',
    name: 'Swing Line',
    type: 'movement',
    targeting: 'direction',
    cooldown: 8,
    duration: 3,
    description: 'Fire a rope that lets you swing in an arc, building momentum.',
  },
  hookshot_zipline: {
    id: 'hookshot_zipline',
    name: 'Zipline',
    type: 'ultimate',
    targeting: 'direction',
    cooldown: 0,
    duration: 15,
    resourceCost: 100,
    description: 'Deploy a zipline that teammates can use for rapid traversal.',
  },

  // Blaze Abilities
  blaze_jetpack: {
    id: 'blaze_jetpack',
    name: 'Jetpack',
    type: 'movement',
    targeting: 'self',
    cooldown: 0,
    description: 'Hold to fly upward. Consumes fuel that regenerates when grounded.',
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
    name: 'Air Strike',
    type: 'ultimate',
    targeting: 'ground',
    cooldown: 0,
    duration: 3,
    resourceCost: 100,
    description: 'Mark an area for a devastating aerial bombardment.',
  },

  // Glacier Abilities
  glacier_iceslide: {
    id: 'glacier_iceslide',
    name: 'Ice Slide',
    type: 'movement',
    targeting: 'instant',
    cooldown: 6,
    duration: 2,
    description: 'Create an ice path that boosts your slide speed and duration.',
  },
  glacier_wallclimb: {
    id: 'glacier_wallclimb',
    name: 'Frost Climb',
    type: 'movement',
    targeting: 'instant',
    cooldown: 10,
    duration: 3,
    description: 'Freeze handholds into walls, allowing vertical climbing.',
  },
  glacier_fortress: {
    id: 'glacier_fortress',
    name: 'Frozen Fortress',
    type: 'ultimate',
    targeting: 'instant',
    cooldown: 0,
    duration: 8,
    resourceCost: 100,
    description: 'Create ice walls around yourself. Gain 50% damage reduction.',
  },

  // Pulse Abilities
  pulse_speedboost: {
    id: 'pulse_speedboost',
    name: 'Speed Aura',
    type: 'utility',
    targeting: 'self',
    cooldown: 12,
    duration: 4,
    description: 'Boost movement speed of yourself and nearby allies by 30%.',
  },
  pulse_dash: {
    id: 'pulse_dash',
    name: 'Quick Dash',
    type: 'movement',
    targeting: 'direction',
    cooldown: 5,
    charges: 2,
    chargeRegenTime: 5,
    description: 'Dash quickly in your movement direction.',
  },
  pulse_haste: {
    id: 'pulse_haste',
    name: 'Team Haste',
    type: 'ultimate',
    targeting: 'self',
    cooldown: 0,
    duration: 8,
    resourceCost: 100,
    description: 'All teammates gain 50% movement speed and instant ability cooldowns.',
  },

  // Sentinel Abilities
  sentinel_fortify: {
    id: 'sentinel_fortify',
    name: 'Fortify',
    type: 'defensive',
    targeting: 'self',
    cooldown: 10,
    duration: 4,
    description: 'Root yourself in place. Gain 50% damage reduction and CC immunity.',
  },
  sentinel_barrier: {
    id: 'sentinel_barrier',
    name: 'Energy Barrier',
    type: 'defensive',
    targeting: 'direction',
    cooldown: 15,
    duration: 5,
    description: 'Deploy a barrier that blocks enemy projectiles and movement.',
  },
  sentinel_dome: {
    id: 'sentinel_dome',
    name: 'Shield Dome',
    type: 'ultimate',
    targeting: 'instant',
    cooldown: 0,
    duration: 10,
    resourceCost: 100,
    description: 'Create a large dome shield. Allies inside regenerate health.',
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

