import type { Vec3, Quaternion } from './vector.js';
import type { HeroId } from './hero.js';
import type { AbilityState } from './ability.js';

export type Team = 'red' | 'blue';

export type PlayerState = 
  | 'spectating'
  | 'selecting'     // Hero select
  | 'spawning'
  | 'alive'
  | 'dead';

export interface PlayerMovementState {
  isGrounded: boolean;
  isSliding: boolean;
  isWallRunning: boolean;
  wallRunSide: 'left' | 'right' | null;
  isGrappling: boolean;
  grapplePoint: Vec3 | null;
  isJetpacking: boolean;
  jetpackFuel: number;
  isGliding: boolean;
}

export interface PlayerInput {
  tick: number;
  moveForward: boolean;
  moveBackward: boolean;
  moveLeft: boolean;
  moveRight: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  primaryFire: boolean;
  secondaryFire: boolean;
  ability1: boolean;
  ability2: boolean;
  ultimate: boolean;
  interact: boolean;
  lookYaw: number;
  lookPitch: number;
  timestamp: number;
  // Client position/velocity for sync (server-authoritative games should validate)
  position?: Vec3;
  velocity?: Vec3;
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  flagCaptures: number;
  flagReturns: number;
}

export interface Player {
  id: string;
  name: string;
  team: Team;
  heroId: HeroId | null;
  state: PlayerState;
  isReady: boolean;
  
  // Transform
  position: Vec3;
  velocity: Vec3;
  rotation?: Quaternion;
  lookYaw: number;
  lookPitch: number;
  
  // Health
  health: number;
  maxHealth: number;
  ultimateCharge: number;
  
  // Movement state
  movement: PlayerMovementState;
  
  // Abilities
  abilities: Record<string, AbilityState>;
  
  // CTF
  hasFlag: boolean;
  
  // Respawn
  respawnTime: number | null;
  spawnProtectionUntil: number | null;
  
  // Match stats
  stats: PlayerStats;
}

export interface PlayerSnapshot {
  id: string;
  position: Vec3;
  velocity: Vec3;
  lookYaw: number;
  lookPitch: number;
  health: number;
  state: PlayerState;
  movement: PlayerMovementState;
  abilities: Record<string, AbilityState>;
  hasFlag: boolean;
}

