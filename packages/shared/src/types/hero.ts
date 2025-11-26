export type HeroId = 
  | 'phantom'
  | 'hookshot'
  | 'blaze'
  | 'glacier'
  | 'pulse'
  | 'sentinel';

export type HeroRole = 'flanker' | 'mobile' | 'assault' | 'tank' | 'support' | 'defense';

export type MovementFocus = 'blink' | 'grapple' | 'aerial' | 'parkour' | 'speed' | 'grounded';

export interface HeroStats {
  maxHealth: number;
  moveSpeed: number;
  jumpForce: number;
  size: { width: number; height: number; depth: number };
}

export interface HeroDefinition {
  id: HeroId;
  name: string;
  role: HeroRole;
  movementFocus: MovementFocus;
  stats: HeroStats;
  passive: PassiveDefinition;
  ability1: AbilitySlot;
  ability2: AbilitySlot;
  ultimate: AbilitySlot;
  description: string;
}

export interface PassiveDefinition {
  name: string;
  description: string;
}

export interface AbilitySlot {
  abilityId: string;
  defaultKey: string;
}

