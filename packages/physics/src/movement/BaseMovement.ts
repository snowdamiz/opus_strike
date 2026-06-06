import type { Vec3, InputState, PlayerMovementState, HeroStats } from '@voxel-strike/shared';
import { 
  SPRINT_MULTIPLIER,
  CROUCH_MULTIPLIER,
  GRAVITY,
  DEFAULT_HERO_STATS,
  // CS-style bunny hop constants
  BHOP_GROUND_ACCEL,
  BHOP_AIR_ACCEL,
  BHOP_AIR_SPEED_CAP,
  BHOP_MAX_VELOCITY,
  BHOP_GROUND_FRICTION,
  BHOP_NO_INPUT_FRICTION_MULTIPLIER,
  BHOP_GROUND_STOP_THRESHOLD,
  BHOP_STOP_SPEED,
  BHOP_TIMING_WINDOW,
  BHOP_LANDING_SPEED_RETENTION,
} from '@voxel-strike/shared';
import { vec3Length, createVec3 } from '@voxel-strike/shared';
import type { PhysicsWorld } from '../PhysicsWorld.js';
import { checkGround } from '../CollisionDetection.js';

export interface BaseMovementInput {
  position: Vec3;
  velocity: Vec3;
  input: InputState;
  forward: Vec3;
  right: Vec3;
  deltaTime: number;
  movementState: PlayerMovementState;
}

export interface BaseMovementResult {
  position: Vec3;
  velocity: Vec3;
  isGrounded: boolean;
}

/**
 * CS-Style Movement Controller
 * 
 * Implements Quake/Source engine style movement physics:
 * - Air strafing: gain speed by moving mouse + holding strafe keys
 * - Bunny hopping: preserve momentum by jumping immediately on landing
 * - Ground friction: slows you down when grounded
 * - Air acceleration: responsive air control with speed gain mechanics
 */
export class BaseMovement {
  private world: PhysicsWorld;
  private playerId: string;
  
  private moveSpeed: number = DEFAULT_HERO_STATS.moveSpeed;
  private jumpForce: number = DEFAULT_HERO_STATS.jumpForce;
  
  // Coyote time and jump buffering for responsive feel
  private coyoteTime: number = 0;
  private jumpBuffer: number = 0;
  
  // Bunny hop tracking
  private timeSinceLanding: number = 0;
  private wasGroundedLastFrame: boolean = false;
  
  private readonly COYOTE_TIME_MAX = 0.15;
  private readonly JUMP_BUFFER_MAX = 0.1;

  constructor(world: PhysicsWorld, playerId: string) {
    this.world = world;
    this.playerId = playerId;
  }

  setStats(stats: HeroStats): void {
    this.moveSpeed = stats.moveSpeed;
    this.jumpForce = stats.jumpForce;
  }

  update(input: BaseMovementInput): BaseMovementResult {
    const { position, velocity, input: playerInput, forward, right, deltaTime, movementState } = input;
    
    const newPosition = { ...position };
    let newVelocity = { ...velocity };

    // Check ground
    const groundInfo = checkGround(this.world, position, this.playerId);
    let isGrounded = groundInfo.isGrounded;

    // Track landing for bunny hop timing
    if (isGrounded && !this.wasGroundedLastFrame) {
      // Just landed
      this.timeSinceLanding = 0;
      
      // Apply landing speed retention
      const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
      if (horizontalSpeed > 0) {
        const retainedSpeed = horizontalSpeed * BHOP_LANDING_SPEED_RETENTION;
        const ratio = retainedSpeed / horizontalSpeed;
        newVelocity.x *= ratio;
        newVelocity.z *= ratio;
      }
    } else if (isGrounded) {
      this.timeSinceLanding += deltaTime;
    }
    
    this.wasGroundedLastFrame = isGrounded;

    // Coyote time - allow jumping briefly after leaving ground
    if (isGrounded) {
      this.coyoteTime = this.COYOTE_TIME_MAX;
    } else {
      this.coyoteTime = Math.max(0, this.coyoteTime - deltaTime);
    }

    // Jump buffer - remember jump input briefly
    if (playerInput.jump) {
      this.jumpBuffer = this.JUMP_BUFFER_MAX;
    } else {
      this.jumpBuffer = Math.max(0, this.jumpBuffer - deltaTime);
    }

    // Calculate wish direction (the direction player wants to move)
    const wishDir = createVec3();
    
    if (playerInput.moveForward) {
      wishDir.x += forward.x;
      wishDir.z += forward.z;
    }
    if (playerInput.moveBackward) {
      wishDir.x -= forward.x;
      wishDir.z -= forward.z;
    }
    if (playerInput.moveLeft) {
      wishDir.x -= right.x;
      wishDir.z -= right.z;
    }
    if (playerInput.moveRight) {
      wishDir.x += right.x;
      wishDir.z += right.z;
    }

    // Normalize wish direction
    const wishDirLen = vec3Length(wishDir);
    if (wishDirLen > 0) {
      wishDir.x /= wishDirLen;
      wishDir.z /= wishDirLen;
    }

    // Calculate target speed (wish speed)
    let wishSpeed = this.moveSpeed;
    if (playerInput.sprint && !playerInput.crouch) {
      wishSpeed *= SPRINT_MULTIPLIER;
    }
    if (playerInput.crouch) {
      wishSpeed *= CROUCH_MULTIPLIER;
    }

    // Apply movement based on grounded state
    if (isGrounded || this.coyoteTime > 0) {
      // Ground movement with friction
      newVelocity = this.applyGroundMovement(newVelocity, wishDir, wishSpeed, deltaTime);
    } else {
      // Air movement with strafe acceleration
      newVelocity = this.applyAirMovement(newVelocity, wishDir, wishSpeed, deltaTime);
    }

    // Apply gravity when not grounded
    if (!isGrounded && !movementState.isWallRunning && !movementState.isGrappling) {
      newVelocity.y += GRAVITY * deltaTime;
    }

    // Jump
    const canJump = (isGrounded || this.coyoteTime > 0) && !movementState.isSliding;
    if (this.jumpBuffer > 0 && canJump) {
      newVelocity.y = this.jumpForce;
      this.coyoteTime = 0;
      this.jumpBuffer = 0;
      isGrounded = false;
    }

    // Ground snap
    if (isGrounded && newVelocity.y < 0) {
      newVelocity.y = 0;
      newPosition.y = groundInfo.distance < 0.5 
        ? position.y - groundInfo.distance + 0.01
        : position.y;
    }

    // Clamp maximum horizontal velocity
    const horizontalSpeed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
    if (horizontalSpeed > BHOP_MAX_VELOCITY) {
      const scale = BHOP_MAX_VELOCITY / horizontalSpeed;
      newVelocity.x *= scale;
      newVelocity.z *= scale;
    }

    // Update position
    newPosition.x += newVelocity.x * deltaTime;
    newPosition.y += newVelocity.y * deltaTime;
    newPosition.z += newVelocity.z * deltaTime;

    // Clamp vertical position (safety net)
    if (newPosition.y < 0.9) {
      newPosition.y = 0.9;
      newVelocity.y = 0;
      isGrounded = true;
    }

    return {
      position: newPosition,
      velocity: newVelocity,
      isGrounded,
    };
  }

  /**
   * Ground movement with friction
   * Uses Source engine style ground acceleration
   */
  private applyGroundMovement(velocity: Vec3, wishDir: Vec3, wishSpeed: number, dt: number): Vec3 {
    const newVelocity = { ...velocity };
    const hasMovementInput = wishDir.x !== 0 || wishDir.z !== 0;
    
    // Apply friction first
    const speed = Math.sqrt(newVelocity.x * newVelocity.x + newVelocity.z * newVelocity.z);
    
    if (speed > 0) {
      // Calculate friction drop
      const friction = hasMovementInput
        ? BHOP_GROUND_FRICTION
        : BHOP_GROUND_FRICTION * BHOP_NO_INPUT_FRICTION_MULTIPLIER;
      const control = speed < BHOP_STOP_SPEED ? BHOP_STOP_SPEED : speed;
      const drop = control * friction * dt;
      
      // Scale velocity by friction
      let newSpeed = speed - drop;
      if (newSpeed < 0) newSpeed = 0;

      if (!hasMovementInput && newSpeed < BHOP_GROUND_STOP_THRESHOLD) {
        newSpeed = 0;
      }
      
      if (newSpeed !== speed) {
        const ratio = newSpeed / speed;
        newVelocity.x *= ratio;
        newVelocity.z *= ratio;
      }
    }
    
    // Then accelerate if there's input
    if (hasMovementInput) {
      return this.accelerate(newVelocity, wishDir, wishSpeed, BHOP_GROUND_ACCEL, dt);
    }
    
    return newVelocity;
  }

  /**
   * Air movement with strafe acceleration
   * This is the core of CS-style bunny hopping!
   * 
   * Key insight: Air acceleration uses a capped wish speed, but the actual
   * velocity can exceed this cap through proper strafing (perpendicular movement).
   */
  private applyAirMovement(velocity: Vec3, wishDir: Vec3, wishSpeed: number, dt: number): Vec3 {
    // Cap the wish speed for air movement
    // This is what creates the strafe acceleration effect
    const airWishSpeed = Math.min(wishSpeed, BHOP_AIR_SPEED_CAP);
    
    return this.accelerate(velocity, wishDir, airWishSpeed, BHOP_AIR_ACCEL, dt);
  }

  /**
   * Quake/Source engine acceleration function
   * This is the magic that makes bunny hopping work!
   * 
   * The key insight: acceleration is based on the component of velocity
   * that's NOT in the wish direction. So if you're moving perpendicular
   * to your wish direction (strafing), you get full acceleration.
   * 
   * @param velocity Current velocity
   * @param wishDir Normalized direction player wants to move
   * @param wishSpeed Speed player wants to reach
   * @param accel Acceleration rate
   * @param dt Delta time
   */
  private accelerate(velocity: Vec3, wishDir: Vec3, wishSpeed: number, accel: number, dt: number): Vec3 {
    const newVelocity = { ...velocity };
    
    // No input = no acceleration
    if (wishDir.x === 0 && wishDir.z === 0) {
      return newVelocity;
    }
    
    // Current speed in the wish direction
    const currentSpeed = newVelocity.x * wishDir.x + newVelocity.z * wishDir.z;
    
    // How much speed we want to add
    const addSpeed = wishSpeed - currentSpeed;
    
    // Can't accelerate if already going faster than wish speed in that direction
    if (addSpeed <= 0) {
      return newVelocity;
    }
    
    // Calculate acceleration amount
    let accelSpeed = accel * dt * wishSpeed;
    
    // Cap acceleration to not overshoot
    if (accelSpeed > addSpeed) {
      accelSpeed = addSpeed;
    }
    
    // Apply acceleration in wish direction
    newVelocity.x += accelSpeed * wishDir.x;
    newVelocity.z += accelSpeed * wishDir.z;
    
    return newVelocity;
  }

  /**
   * Check if player is in bunny hop timing window
   * Used for effects and feedback
   */
  isInBhopWindow(): boolean {
    return this.timeSinceLanding < BHOP_TIMING_WINDOW;
  }

  /**
   * Get current horizontal speed for UI feedback
   */
  getHorizontalSpeed(velocity: Vec3): number {
    return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
  }
}
