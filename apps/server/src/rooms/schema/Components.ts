import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema';

export class Vec3Schema extends Schema {
  x: number = 0;
  y: number = 0;
  z: number = 0;
}
defineTypes(Vec3Schema, {
  x: 'number',
  y: 'number',
  z: 'number',
});

export class QuaternionSchema extends Schema {
  x: number = 0;
  y: number = 0;
  z: number = 0;
  w: number = 1;
}
defineTypes(QuaternionSchema, {
  x: 'number',
  y: 'number',
  z: 'number',
  w: 'number',
});

export class MovementState extends Schema {
  isGrounded: boolean = true;
  isSliding: boolean = false;
  isWallRunning: boolean = false;
  wallRunSide: string = '';
  isGrappling: boolean = false;
  isJetpacking: boolean = false;
  jetpackFuel: number = 100;
  isGliding: boolean = false;
}
defineTypes(MovementState, {
  isGrounded: 'boolean',
  isSliding: 'boolean',
  isWallRunning: 'boolean',
  wallRunSide: 'string',
  isGrappling: 'boolean',
  isJetpacking: 'boolean',
  jetpackFuel: 'number',
  isGliding: 'boolean',
});

export class AbilityStateSchema extends Schema {
  abilityId: string = '';
  cooldownRemaining: number = 0;
  charges: number = 1;
  isActive: boolean = false;
  activatedAt: number = 0;
}
defineTypes(AbilityStateSchema, {
  abilityId: 'string',
  cooldownRemaining: 'number',
  charges: 'number',
  isActive: 'boolean',
  activatedAt: 'number',
});

export class Flag extends Schema {
  team: string = 'red';
  position: Vec3Schema = new Vec3Schema();
  basePosition: Vec3Schema = new Vec3Schema();
  carrierId: string = '';
  isAtBase: boolean = true;
  droppedAt: number = 0;
}
defineTypes(Flag, {
  team: 'string',
  position: Vec3Schema,
  basePosition: Vec3Schema,
  carrierId: 'string',
  isAtBase: 'boolean',
  droppedAt: 'number',
});

export class TeamState extends Schema {
  score: number = 0;
  flag: Flag = new Flag();
}
defineTypes(TeamState, {
  score: 'number',
  flag: Flag,
});
