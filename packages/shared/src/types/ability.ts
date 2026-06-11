import type { Vec3 } from './vector.js';

export type AbilityType = 
  | 'movement'
  | 'offensive'
  | 'defensive'
  | 'utility'
  | 'ultimate';

export type AbilityTargeting = 
  | 'instant'      // Activates immediately
  | 'direction'    // Fires in look direction
  | 'ground'       // Target a ground position
  | 'self'         // Affects self only
  | 'area';        // Area effect

export interface AbilityDefinition {
  id: string;
  name: string;
  type: AbilityType;
  targeting: AbilityTargeting;
  cooldown: number;          // Seconds
  duration?: number;         // For channeled/lasting abilities
  charges?: number;          // Number of charges (default 1)
  chargeRegenTime?: number;  // Time to regen one charge
  resourceCost?: number;     // For ultimate charge system
  description: string;
}

export interface AbilityState {
  abilityId: string;
  cooldownRemaining: number;
  charges: number;
  isActive: boolean;
  activatedAt?: number;
}

export interface AbilityCast {
  abilityId: string;
  playerId: string;
  timestamp: number;
  direction?: { x: number; y: number; z: number };
  targetPosition?: { x: number; y: number; z: number };
}

export interface AbilityCastOriginHint {
  abilityId: string;
  socketName: string;
  origin: Vec3;
  sampledAtMs?: number;
}
