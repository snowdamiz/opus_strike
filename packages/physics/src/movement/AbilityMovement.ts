import type { Vec3, InputState, PlayerMovementState, HeroId } from '@voxel-strike/shared';
import { 
  ABILITY_DEFINITIONS,
  PHANTOM_BLINK_DISTANCE,
  PLAYER_RADIUS,
  calculateLookDirection,
} from '@voxel-strike/shared';
import { vec3Scale, vec3Add, createVec3 } from '@voxel-strike/shared';
import type { PhysicsWorld } from '../PhysicsWorld.js';

export interface AbilityMovementInput {
  position: Vec3;
  velocity: Vec3;
  input: InputState;
  forward: Vec3;
  right: Vec3;
  lookYaw: number;
  lookPitch: number;
  deltaTime: number;
  movementState: PlayerMovementState;
  heroId: HeroId | null;
}

export interface AbilityMovementResult {
  position: Vec3;
  velocity: Vec3;
}

export class AbilityMovement {
  private world: PhysicsWorld;
  private playerId: string;
  
  // Blink state
  private isBlinking: boolean = false;
  private blinkTarget: Vec3 | null = null;
  private blinkCooldown: number = 0;

  constructor(world: PhysicsWorld, playerId: string) {
    this.world = world;
    this.playerId = playerId;
  }

  update(input: AbilityMovementInput): AbilityMovementResult {
    const { position, velocity, input: playerInput, lookYaw, lookPitch, deltaTime, heroId } = input;
    
    let newPosition = { ...position };
    let newVelocity = { ...velocity };

    // Update cooldowns
    this.blinkCooldown = Math.max(0, this.blinkCooldown - deltaTime);

    // Handle blink
    if (this.isBlinking && this.blinkTarget) {
      newPosition = { ...this.blinkTarget };
      newVelocity = createVec3();
      this.isBlinking = false;
      this.blinkTarget = null;
    }

    if (heroId === 'phantom' && playerInput.ability1 && this.blinkCooldown <= 0 && !this.isBlinking) {
      const blinkDir = calculateLookDirection(lookYaw, lookPitch);
      const hit = this.world.sphereCast(position, PLAYER_RADIUS, blinkDir, PHANTOM_BLINK_DISTANCE, this.playerId);
      const blinkDistance = hit ? Math.max(0, hit.distance - PLAYER_RADIUS) : PHANTOM_BLINK_DISTANCE;
      if (blinkDistance >= 0.5) {
        this.executeBlink(vec3Add(position, vec3Scale(blinkDir, blinkDistance)));
      }
    }

    return {
      position: newPosition,
      velocity: newVelocity,
    };
  }

  executeBlink(targetPosition: Vec3): void {
    if (this.blinkCooldown > 0 || this.isBlinking) return;
    
    // Validate target position (basic bounds check)
    // In a full implementation, we'd check for collisions along the path
    
    this.isBlinking = true;
    this.blinkTarget = { ...targetPosition };
    this.blinkCooldown = ABILITY_DEFINITIONS.phantom_blink?.cooldown ?? 10;
  }

  getBlinkCooldown(): number {
    return this.blinkCooldown;
  }
}
