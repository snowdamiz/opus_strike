import type { Vec3, InputState, PlayerMovementState, HeroId } from '@voxel-strike/shared';
import { 
  DASH_DISTANCE,
  DASH_DURATION,
  DASH_COOLDOWN,
  BLINK_MAX_DISTANCE,
  BLINK_COOLDOWN,
} from '@voxel-strike/shared';
import { vec3Length, vec3Normalize, vec3Scale, vec3Add, createVec3 } from '@voxel-strike/shared';
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
  
  // Dash state
  private isDashing: boolean = false;
  private dashTimer: number = 0;
  private dashDirection: Vec3 = createVec3();
  private dashCooldown: number = 0;
  
  // Blink state
  private isBlinking: boolean = false;
  private blinkTarget: Vec3 | null = null;
  private blinkCooldown: number = 0;

  constructor(world: PhysicsWorld, playerId: string) {
    this.world = world;
    this.playerId = playerId;
  }

  update(input: AbilityMovementInput): AbilityMovementResult {
    const { position, velocity, input: playerInput, forward, right, deltaTime, heroId } = input;
    
    let newPosition = { ...position };
    let newVelocity = { ...velocity };

    // Update cooldowns
    this.dashCooldown = Math.max(0, this.dashCooldown - deltaTime);
    this.blinkCooldown = Math.max(0, this.blinkCooldown - deltaTime);

    // Handle dash
    if (this.isDashing) {
      const result = this.updateDash(position, deltaTime);
      newPosition = result.position;
      newVelocity = result.velocity;
    }

    // Handle blink
    if (this.isBlinking && this.blinkTarget) {
      newPosition = { ...this.blinkTarget };
      newVelocity = createVec3();
      this.isBlinking = false;
      this.blinkTarget = null;
    }

    // Trigger abilities based on hero
    if (heroId === 'pulse' && playerInput.ability2 && this.dashCooldown <= 0 && !this.isDashing) {
      // Calculate dash direction from input
      let dashDir = createVec3();
      
      if (playerInput.moveForward) dashDir = vec3Add(dashDir, forward);
      if (playerInput.moveBackward) dashDir = vec3Add(dashDir, vec3Scale(forward, -1));
      if (playerInput.moveLeft) dashDir = vec3Add(dashDir, vec3Scale(right, -1));
      if (playerInput.moveRight) dashDir = vec3Add(dashDir, right);
      
      if (vec3Length(dashDir) > 0) {
        this.executeDash(vec3Normalize(dashDir));
      } else {
        // Dash forward if no direction
        this.executeDash(forward);
      }
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

  private updateDash(position: Vec3, deltaTime: number): { position: Vec3; velocity: Vec3 } {
    this.dashTimer -= deltaTime;
    
    if (this.dashTimer <= 0) {
      this.isDashing = false;
      this.dashCooldown = DASH_COOLDOWN;
      return { position, velocity: createVec3() };
    }

    // Move at constant speed during dash
    const dashSpeed = DASH_DISTANCE / DASH_DURATION;
    const movement = vec3Scale(this.dashDirection, dashSpeed * deltaTime);
    
    const newPosition = vec3Add(position, movement);
    const velocity = vec3Scale(this.dashDirection, dashSpeed);

    return { position: newPosition, velocity };
  }

  executeDash(direction: Vec3): void {
    if (this.dashCooldown > 0 || this.isDashing) return;
    
    this.isDashing = true;
    this.dashTimer = DASH_DURATION;
    this.dashDirection = vec3Normalize(direction);
  }

  executeBlink(targetPosition: Vec3): void {
    if (this.blinkCooldown > 0 || this.isBlinking) return;
    
    // Validate target position (basic bounds check)
    // In a full implementation, we'd check for collisions along the path
    
    this.isBlinking = true;
    this.blinkTarget = { ...targetPosition };
    this.blinkCooldown = BLINK_COOLDOWN;
  }

  getDashCooldown(): number {
    return this.dashCooldown;
  }

  getBlinkCooldown(): number {
    return this.blinkCooldown;
  }

  isDashActive(): boolean {
    return this.isDashing;
  }
}

