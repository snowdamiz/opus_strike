import type { Vec3, InputState, PlayerMovementState, HeroId } from '@voxel-strike/shared';
import { 
  BLINK_MAX_DISTANCE,
  BLINK_COOLDOWN,
} from '@voxel-strike/shared';
import { vec3Normalize, vec3Scale, vec3Add, createVec3 } from '@voxel-strike/shared';
import type { PhysicsWorld } from '../PhysicsWorld.js';

export interface AbilityMovementInput {
  position: Vec3;
  velocity: Vec3;
  input: InputState;
  forward: Vec3;
  right: Vec3;
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
    const { position, velocity, input: playerInput, forward, deltaTime, heroId } = input;
    
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
      // Blink in look direction
      const blinkDir = vec3Normalize({
        x: forward.x,
        y: 0,
        z: forward.z,
      });
      const blinkTarget = vec3Add(position, vec3Scale(blinkDir, BLINK_MAX_DISTANCE));
      this.executeBlink(blinkTarget);
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
    this.blinkCooldown = BLINK_COOLDOWN;
  }

  getBlinkCooldown(): number {
    return this.blinkCooldown;
  }
}
