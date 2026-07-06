import { Schema, MapSchema, defineTypes } from '@colyseus/schema';
import type { PlayerInput } from '@voxel-strike/shared';
import { Vec3Schema, MovementState, AbilityStateSchema } from './Components';

export class Player extends Schema {
  id: string = '';
  name: string = '';
  role: string = 'combat';
  team: string = 'red';
  heroId: string = '';
  skinId: string = '';
  state: string = 'spectating';
  isReady: boolean = false;
  isBot: boolean = false;
  botDifficulty: string = 'normal';
  botProfileId: string = '';
  rankTier: string = 'unranked';
  rankTierLabel: string = 'Unranked';
  rankDivision: number = 0;
  rankDivisionIndex: number = -1;
  rankLabel: string = 'Unranked';
  rankIconKey: string = 'unranked';
  rankIsRanked: boolean = false;
  rankPlacementRemaining: number = 5;

  // Runtime transform; streamed through selfMovementAuthority/playerTransformsV2 instead of Colyseus patches.
  position: Vec3Schema = new Vec3Schema();
  velocity: Vec3Schema = new Vec3Schema();
  lookYaw: number = 0;
  lookPitch: number = 0;

  // Runtime vitals; streamed through playerVitals instead of Colyseus patches.
  health: number = 100;
  maxHealth: number = 100;
  // Battle-royale body shield; absorbs damage before health while alive.
  shield: number = 0;
  maxShield: number = 0;
  // Battle-royale knockdown shield; absorbs damage to downedHealth once raised.
  knockdownShieldHealth: number = 0;
  knockdownShieldMaxHealth: number = 0;
  knockdownShieldActive: boolean = false;
  downedHealth: number = 0;
  downedMaxHealth: number = 0;
  downedStartedAt: number = 0;
  downedRemainingMs: number = 0;
  downedExpiresAt: number = 0;
  reviveStartedAt: number = 0;
  reviveCompletesAt: number = 0;
  reviveByPlayerId: string = '';
  ultimateCharge: number = 0;

  // Movement state
  movement: MovementState = new MovementState();

  // Abilities
  abilities = new MapSchema<AbilityStateSchema>();

  // CTF
  hasFlag: boolean = false;

  // Respawn
  respawnTime: number = 0;
  spawnProtectionUntil: number = 0;

  // Match stats
  kills: number = 0;
  deaths: number = 0;
  assists: number = 0;
  flagCaptures: number = 0;
  flagReturns: number = 0;

  // Input (not synced)
  lastInput: PlayerInput | null = null;
}

defineTypes(Player, {
  id: 'string',
  name: 'string',
  role: 'string',
  team: 'string',
  heroId: 'string',
  skinId: 'string',
  state: 'string',
  isReady: 'boolean',
  isBot: 'boolean',
  botDifficulty: 'string',
  botProfileId: 'string',
  rankTier: 'string',
  rankTierLabel: 'string',
  rankDivision: 'number',
  rankDivisionIndex: 'number',
  rankLabel: 'string',
  rankIconKey: 'string',
  rankIsRanked: 'boolean',
  rankPlacementRemaining: 'number',
});
